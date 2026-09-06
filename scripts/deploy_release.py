#!/usr/bin/env python3
"""Install and verify a staged release under a deployment-host process lock."""

import argparse
import fcntl
import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


def atomic_write(path: Path, content: str) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content)
    os.replace(temporary, path)


def verify_health(url: str, version: str) -> None:
    for _ in range(30):
        try:
            with urlopen(url, timeout=5) as response:
                data = json.load(response)
            if data.get("status") == "ok" and data.get("version") == version:
                return
        except (URLError, ValueError, TimeoutError):
            pass
        time.sleep(5)
    raise RuntimeError("Deployed release did not report the expected healthy version")


def deploy(directory: Path, staging: Path, source: str, version: str, health_url: str) -> None:
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
        if manifest.exists():
            atomic_write(directory / "previous-compose.yaml", manifest.read_text())
        record = directory / "deployment.json"
        if record.exists():
            atomic_write(directory / "previous-deployment.json", record.read_text())
        atomic_write(manifest, (staging / "docker-compose.yaml").read_text())
        subprocess.run(["docker", "compose", "up", "-d"], cwd=directory, check=True)
        verify_health(health_url, version)
        atomic_write(record, json.dumps({"source": source, "version": version}) + "\n")
        print(f"Verified release {version} ({source})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("staging", type=Path)
    parser.add_argument("source")
    parser.add_argument("version")
    parser.add_argument("health_url")
    arguments = parser.parse_args()
    deploy(**vars(arguments))


if __name__ == "__main__":
    main()
