#!/usr/bin/env python3
"""Check application versions, or synchronize them with --set X.Y.Z."""

import argparse
import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)")


def check(root: Path = ROOT) -> str:
    project = tomllib.loads((root / "backend/pyproject.toml").read_text())["project"]
    version = project["version"]
    if not SEMVER.fullmatch(version):
        raise ValueError("Application version must be X.Y.Z without leading zeroes")
    package = json.loads((root / "frontend/package.json").read_text())
    lock = json.loads((root / "frontend/package-lock.json").read_text())
    uv = tomllib.loads((root / "backend/uv.lock").read_text())
    roots = [p for p in uv["package"] if p.get("source") == {"virtual": "."}]
    if len(roots) != 1 or roots[0]["name"] != project["name"]:
        raise ValueError("Python project and lockfile names differ")
    versions = [
        package["version"],
        lock["version"],
        lock["packages"][""]["version"],
        roots[0]["version"],
    ]
    if any(v != version for v in versions):
        raise ValueError("Application versions differ; run python3 scripts/version.py --set X.Y.Z")
    if package["name"] != lock["name"] or package["name"] != lock["packages"][""]["name"]:
        raise ValueError("Frontend package and lockfile names differ")
    return version


def set_version(version: str, root: Path = ROOT) -> None:
    if not SEMVER.fullmatch(version):
        raise ValueError("Application version must be X.Y.Z without leading zeroes")
    project_path = root / "backend/pyproject.toml"
    project_text = project_path.read_text()
    project = tomllib.loads(project_text)["project"]
    # Change only the application records; dependency versions remain untouched.
    updated, count = re.subn(
        r'(\[project\]\s*\n(?:(?!\[).|\n)*?\nversion\s*=\s*)"[^"]+"',
        lambda m: m[1] + json.dumps(version),
        project_text,
        count=1,
    )
    if count != 1:
        raise ValueError("Could not locate project version")
    uv_path = root / "backend/uv.lock"
    blocks = uv_path.read_text().split("[[package]]")
    found = 0
    for i, block in enumerate(blocks[1:], 1):
        parsed = tomllib.loads(block)
        if parsed.get("source") == {"virtual": "."}:
            block = re.sub(
                r'^name = "[^"]+"',
                f'name = "{project["name"]}"',
                block,
                count=1,
                flags=re.MULTILINE,
            )
            blocks[i] = re.sub(
                r'^version = "[^"]+"',
                f'version = "{version}"',
                block,
                count=1,
                flags=re.MULTILINE,
            )
            found += 1
    if found != 1:
        raise ValueError("Expected one local Python project in uv.lock")
    package_path = root / "frontend/package.json"
    package = json.loads(package_path.read_text())
    package["version"] = version
    lock_path = root / "frontend/package-lock.json"
    lock = json.loads(lock_path.read_text())
    lock.update(name=package["name"], version=version)
    lock["packages"][""].update(name=package["name"], version=version)
    project_path.write_text(updated)
    uv_path.write_text("[[package]]".join(blocks))
    package_path.write_text(json.dumps(package, indent=2) + "\n")
    lock_path.write_text(json.dumps(lock, indent=2) + "\n")
    check(root)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", dest="version")
    args = parser.parse_args()
    if args.version:
        set_version(args.version)
    print(check())


if __name__ == "__main__":
    main()
