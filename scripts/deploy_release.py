#!/usr/bin/env python3
"""Install and verify a staged release under a deployment-host process lock."""

import argparse
import fcntl
import http.client
import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen


def atomic_write(path: Path, content: str) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content)
    os.replace(temporary, path)


def verify_health(url: str, version: str, build_id: str | None = None) -> None:
    for _ in range(30):
        try:
            with urlopen(url, timeout=5) as response:
                data = json.load(response)
            if (
                isinstance(data, dict)
                and data.get("status") == "ok"
                and data.get("version") == version
                and (build_id is None or data.get("buildId") == build_id)
            ):
                return
        # Resets and malformed replies while the container restarts are retried;
        # URLError and TimeoutError are OSError subclasses.
        except (OSError, http.client.HTTPException, ValueError):
            pass
        time.sleep(5)
    raise RuntimeError("Deployed release did not report the expected healthy version")


def verify_artifact(directory: Path, image_reference: str) -> str:
    def output(*arguments: str) -> str:
        return subprocess.run(
            ["docker", *arguments],
            cwd=directory,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    expected_id = output("image", "inspect", "--format", "{{.Id}}", image_reference)
    container = output("compose", "ps", "-q", "iptv-viewer")
    if not container or "\n" in container:
        raise RuntimeError("Expected exactly one running application container")
    actual_id = output("inspect", "--format", "{{.Image}}", container)
    actual_reference = output("inspect", "--format", "{{.Config.Image}}", container)
    if actual_id != expected_id or actual_reference != image_reference:
        raise RuntimeError(
            "Running container does not match the requested immutable image"
        )
    return actual_id


def deploy(
    directory: Path,
    staging: Path,
    source: str,
    version: str,
    health_url: str,
    image_reference: str,
    build_id: str | None = None,
) -> None:
    if not re.fullmatch(r"[a-zA-Z0-9._:/-]+@sha256:[0-9a-f]{64}", image_reference):
        raise ValueError("An immutable registry image digest is required")
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Expected full source commit ID")
    history = set((staging / "source-history").read_text().splitlines())
    if source not in history:
        raise ValueError("Source commit is absent from staged history")
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / ".deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not (directory / ".env").is_file():
            raise RuntimeError("Host-managed .env is missing")
        accepted = directory / ".accepted-source"
        if accepted.exists() and accepted.read_text().strip() not in history:
            raise RuntimeError(
                "Stale or divergent release refused; explicit rollback required"
            )
        # Advance before installation: even a failed health check cannot permit
        # an older runner to overwrite a newer accepted source revision.
        atomic_write(accepted, source + "\n")
        manifest = directory / "docker-compose.yaml"
        if manifest.exists():
            atomic_write(directory / "previous-compose.yaml", manifest.read_text())
        record = directory / "deployment.json"
        if record.exists():
            atomic_write(directory / "previous-deployment.json", record.read_text())
        atomic_write(manifest, (staging / "docker-compose.yaml").read_text())
        subprocess.run(
            ["docker", "compose", "pull", "iptv-viewer"], cwd=directory, check=True
        )
        subprocess.run(["docker", "compose", "up", "-d"], cwd=directory, check=True)
        # Old records use version as their build identifier. New releases must
        # match both semantic version and exact build, even on same-version reruns.
        if build_id is None:
            verify_health(health_url, version)
        else:
            verify_health(health_url, version, build_id)
        image_id = verify_artifact(directory, image_reference)
        atomic_write(
            record,
            json.dumps(
                {
                    "source": source,
                    "version": version,
                    "build_id": build_id,
                    "image_reference": image_reference,
                    "image_id": image_id,
                }
            )
            + "\n",
        )
        print(f"Verified release {version} ({source})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("staging", type=Path)
    parser.add_argument("source")
    parser.add_argument("version")
    parser.add_argument("health_url")
    parser.add_argument("image_reference")
    parser.add_argument("--build-id")
    arguments = parser.parse_args()
    deploy(**vars(arguments))


if __name__ == "__main__":
    main()
