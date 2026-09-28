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
        raise RuntimeError("Running container does not match the requested immutable image")
    return actual_id


def roll_back(directory: Path, installed: dict | None, health_url: str, started: bool) -> None:
    """Reinstall the last verified release; the caller holds the deploy lock."""
    verified = directory / "verified-compose.yaml"
    if installed is None or not verified.exists():
        print("Deployment failed; no verified release to roll back to")
        return
    atomic_write(directory / "docker-compose.yaml", verified.read_text())
    if not started:
        # The pull failed, so the verified container is still the one running.
        print("Deployment failed before install; restored the verified Compose file")
        return
    label = installed.get("build_id") or installed["version"]
    try:
        subprocess.run(["docker", "compose", "up", "-d"], cwd=directory, check=True)
        if installed.get("build_id") is None:
            verify_health(health_url, installed["version"])
        else:
            verify_health(health_url, installed["version"], installed["build_id"])
    except Exception as error:
        print(f"Rollback to {label} failed: {error}")
        return
    print(f"Rolled back to {label}")


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
            raise RuntimeError("Stale or divergent release refused; explicit rollback required")
        # Advance before installation: even a failed health check cannot permit
        # an older runner to overwrite a newer accepted source revision.
        atomic_write(accepted, source + "\n")
        manifest = directory / "docker-compose.yaml"
        record = directory / "deployment.json"
        verified = directory / "verified-compose.yaml"
        installed = json.loads(record.read_text()) if record.exists() else None
        # Hosts from before verified-compose.yaml: the running manifest counts as
        # verified only while it still names the recorded image.
        if (
            not verified.exists()
            and installed is not None
            and manifest.exists()
            and installed.get("image_reference")
            and installed["image_reference"] in manifest.read_text()
        ):
            atomic_write(verified, manifest.read_text())
        if not verified.exists():
            print("No verified Compose file; rollback is unavailable for this attempt")
        atomic_write(manifest, (staging / "docker-compose.yaml").read_text())
        started = False
        try:
            subprocess.run(["docker", "compose", "pull", "iptv-viewer"], cwd=directory, check=True)
            started = True
            subprocess.run(["docker", "compose", "up", "-d"], cwd=directory, check=True)
            # Old records use version as their build identifier. New releases must
            # match both semantic version and exact build, even on same-version reruns.
            if build_id is None:
                verify_health(health_url, version)
            else:
                verify_health(health_url, version, build_id)
            image_id = verify_artifact(directory, image_reference)
        except Exception:
            # The original error is what CI reports, whatever the rollback does,
            # even if restoring the Compose file itself fails (a full disk, say).
            try:
                roll_back(directory, installed, health_url, started)
            except Exception as error:
                print(f"Rollback failed: {error}")
            raise
        # Rotate only on success, so previous-* always name a verified release.
        if verified.exists():
            atomic_write(directory / "previous-compose.yaml", verified.read_text())
        if record.exists():
            atomic_write(directory / "previous-deployment.json", record.read_text())
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
        atomic_write(verified, manifest.read_text())
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
