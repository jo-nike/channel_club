"""Version-aware CI metadata and guarded Docker release publication.

Run from the repository root with python3 -m scripts.release.
"""

import argparse
import json
import re
import secrets
import subprocess
from pathlib import Path

from .version import check


def metadata(ref: str, source: str, version: str) -> dict[str, str]:
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Expected full source commit ID")
    if ref == "refs/heads/master":
        release_tag = ""
    elif ref == f"refs/tags/v{version}":
        release_tag = version
    else:
        raise ValueError("Only master or a vX.Y.Z tag matching the application version can publish")
    return {
        "version": version,
        "build_id": f"{version}-build-{source[:7]}-{secrets.token_hex(8)}",
        "revision": source,
        "release_tag": release_tag,
    }


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], check=True, capture_output=True, text=True)


def image_reference(image: str, tag: str) -> str:
    refs = json.loads(
        run("image", "inspect", f"{image}:{tag}", "--format", "{{json .RepoDigests}}").stdout
    )
    matching = [r for r in refs if re.fullmatch(re.escape(image) + r"@sha256:[0-9a-f]{64}", r)]
    if len(matching) != 1:
        raise ValueError("Expected exactly one registry digest for the pushed image")
    return matching[0]


def existing_release(image: str, version: str, source: str) -> str | None:
    target = f"{image}:{version}"
    probe = subprocess.run(
        ["docker", "manifest", "inspect", target],
        capture_output=True,
        text=True,
        check=False,
    )
    if probe.returncode:
        # Fail closed on auth, transport, registry and parsing failures. Docker's
        # missing-manifest response is the only permission to create a new tag.
        error = probe.stderr.strip().lower()
        if error in {
            f"no such manifest: {target}".lower(),
            "manifest unknown",
            "manifest unknown: manifest unknown",
        }:
            return None
        raise RuntimeError(f"Could not determine whether release {version} exists")
    manifest = json.loads(probe.stdout)
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 2:
        raise ValueError("Unexpected registry manifest")
    run("pull", target)
    labels = json.loads(
        run("image", "inspect", target, "--format", "{{json .Config.Labels}}").stdout
    )
    if not isinstance(labels, dict) or (
        labels.get("org.opencontainers.image.version") != version
        or labels.get("org.opencontainers.image.revision") != source
    ):
        raise ValueError(
            "Existing release tag belongs to a different version/source; refusing replacement"
        )
    return image_reference(image, version)


def publish(image: str, version: str, source: str, build_id: str, release_tag: str) -> str:
    if release_tag:
        if release_tag != version:
            raise ValueError("Release tag must match application version")
        existing = existing_release(image, version, source)
        if existing:
            return existing
    # The caller has scanned this exact local build before entering publication.
    run("push", f"{image}:{build_id}")
    reference = image_reference(image, build_id)
    if release_tag:
        # Check again immediately before promotion in case another attempt has
        # completed while this build was running. Reuse that artifact on retries.
        existing = existing_release(image, version, source)
        if existing:
            return existing
        run("tag", f"{image}:{build_id}", f"{image}:{version}")
        run("push", f"{image}:{version}")
        if image_reference(image, version) != reference:
            raise RuntimeError("Release tag did not resolve to the scanned image")
    return reference


def write_output(path: Path, values: dict[str, str]) -> None:
    with path.open("a") as output:
        for key, value in values.items():
            if "\n" in value or "\r" in value:
                raise ValueError("Invalid multiline workflow output")
            output.write(f"{key}={value}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    meta = sub.add_parser("metadata")
    meta.add_argument("--ref", required=True)
    meta.add_argument("--source", required=True)
    meta.add_argument("--output", required=True, type=Path)
    for name in ("existing", "publish"):
        command = sub.add_parser(name)
        command.add_argument("--image", required=True)
        command.add_argument("--source", required=True)
        command.add_argument("--release-tag", default="")
        command.add_argument("--output", required=True, type=Path)
        if name == "publish":
            command.add_argument("--build-id", required=True)
    args = parser.parse_args()
    version = check()
    if args.command == "metadata":
        result = metadata(args.ref, args.source, version)
    elif args.command == "existing":
        if args.release_tag and args.release_tag != version:
            raise ValueError("Release tag must match application version")
        reference = existing_release(args.image, version, args.source) if args.release_tag else None
        result = {
            "exists": "true" if reference else "false",
            "image_reference": reference or "",
        }
    else:
        reference = publish(args.image, version, args.source, args.build_id, args.release_tag)
        result = {"image_reference": reference}
    write_output(args.output, result)


if __name__ == "__main__":
    main()
