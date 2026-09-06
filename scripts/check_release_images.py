#!/usr/bin/env python3
"""OPS-02 Docker integration probe using isolated synthetic images and containers.

Requires an already installed alpine:latest image. Never pulls or publishes.
Uses local image content IDs; registry digest resolution remains a CI boundary.
"""

import json
import subprocess
import tempfile
import uuid
from pathlib import Path

from .deploy_release import verify_artifact


def run(*args: str, directory: Path) -> str:
    return subprocess.run(
        ["docker", *args], cwd=directory, check=True, text=True, capture_output=True
    ).stdout.strip()


def main() -> None:
    project = "iptv-remediation-" + uuid.uuid4().hex[:12]
    image_ids = []
    with tempfile.TemporaryDirectory(prefix=project) as temporary:
        directory = Path(temporary)
        manifest = directory / "docker-compose.yaml"
        try:
            run("image", "inspect", "alpine:latest", directory=directory)
            for build in ("first", "second"):
                (directory / "Dockerfile").write_text(
                    "FROM alpine:latest\n"
                    f'LABEL remediation.fixture="{project}" remediation.source="same-commit" '
                    f'remediation.build="{build}"\nCMD ["sleep", "300"]\n'
                )
                image_file = directory / f"{build}.iid"
                run(
                    "build",
                    "--pull=false",
                    "--network=none",
                    "--iidfile",
                    str(image_file),
                    ".",
                    directory=directory,
                )
                image_ids.append(image_file.read_text().strip())
            assert image_ids[0] != image_ids[1], "Rebuild must produce a distinct artifact"
            observed = []
            for expected in [image_ids[0], image_ids[1], image_ids[0]]:
                manifest.write_text(
                    f"name: {project}\nservices:\n  iptv-viewer:\n"
                    f"    image: {expected}\n    pull_policy: never\n"
                )
                run("compose", "up", "-d", "--pull", "never", directory=directory)
                observed.append(verify_artifact(directory, expected))
            assert observed == [image_ids[0], image_ids[1], image_ids[0]]
            print(json.dumps({"builds": image_ids, "running_then_rollback": observed}))
        finally:
            if manifest.exists():
                run("compose", "down", "--remove-orphans", directory=directory)
            for image_id in image_ids:
                run("image", "rm", image_id, directory=directory)


if __name__ == "__main__":
    main()
