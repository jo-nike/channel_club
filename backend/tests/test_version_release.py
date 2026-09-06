"""Release behavior with synthetic registry commands; never publishes an image."""

import importlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
release = importlib.import_module("scripts.release")
versioning = importlib.import_module("scripts.version")
SOURCE = "a" * 40
IMAGE = "registry.invalid/channel-club"
DIGEST = IMAGE + "@sha256:" + "b" * 64


def test_version_update_preserves_dependencies_and_catches_drift(tmp_path):
    for name in [
        "backend/pyproject.toml",
        "backend/uv.lock",
        "frontend/package.json",
        "frontend/package-lock.json",
    ]:
        target = tmp_path / name
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    before = json.loads((tmp_path / "frontend/package-lock.json").read_text())["packages"]
    versioning.set_version("1.2.3", tmp_path)
    assert versioning.check(tmp_path) == "1.2.3"
    after = json.loads((tmp_path / "frontend/package-lock.json").read_text())["packages"]
    assert {k: v for k, v in before.items() if k} == {k: v for k, v in after.items() if k}
    path = tmp_path / "frontend/package.json"
    path.write_text(path.read_text().replace('"version": "1.2.3"', '"version": "1.2.4"'))
    with pytest.raises(ValueError, match="versions differ"):
        versioning.check(tmp_path)


def test_branch_and_tag_metadata_keep_semantic_version_and_unique_builds():
    first = release.metadata("refs/heads/master", SOURCE, "1.0.0")
    second = release.metadata("refs/heads/master", SOURCE, "1.0.0")
    assert first["version"] == second["version"] == "1.0.0"
    assert first["build_id"] != second["build_id"]
    assert first["release_tag"] == ""
    assert release.metadata("refs/tags/v1.0.0", SOURCE, "1.0.0")["release_tag"] == "1.0.0"


@pytest.mark.parametrize(
    "ref", ["refs/tags/v2.0.0", "refs/tags/v01.0.0", "refs/tags/v1.0.0-rc1", "refs/heads/other"]
)
def test_mismatching_refs_do_not_publish(ref):
    with pytest.raises(ValueError, match="matching"):
        release.metadata(ref, SOURCE, "1.0.0")


def test_only_explicit_missing_manifest_allows_new_release(monkeypatch):
    mock = Mock(
        return_value=subprocess.CompletedProcess([], 1, stderr=f"no such manifest: {IMAGE}:1.0.0\n")
    )
    monkeypatch.setattr(release.subprocess, "run", mock)
    assert release.existing_release(IMAGE, "1.0.0", SOURCE) is None
    # The deployed Gitea registry returns this exact missing-tag response.
    mock.return_value = subprocess.CompletedProcess([], 1, stderr="manifest unknown\n")
    assert release.existing_release(IMAGE, "1.0.0", SOURCE) is None
    for error in [
        "unauthorized",
        "connection refused",
        "timeout",
        "manifest unknown after authentication failed",
    ]:
        mock.return_value = subprocess.CompletedProcess([], 1, stderr=error)
        with pytest.raises(RuntimeError, match="Could not determine"):
            release.existing_release(IMAGE, "1.0.0", SOURCE)


@pytest.mark.parametrize("matching", [True, False])
def test_existing_release_labels_must_match(monkeypatch, matching):
    labels = {
        "org.opencontainers.image.version": "1.0.0",
        "org.opencontainers.image.revision": SOURCE if matching else "c" * 40,
    }
    outputs = [json.dumps({"schemaVersion": 2}), "", json.dumps(labels), json.dumps([DIGEST])]
    monkeypatch.setattr(
        release.subprocess,
        "run",
        Mock(side_effect=[subprocess.CompletedProcess([], 0, stdout=value) for value in outputs]),
    )
    if matching:
        assert release.existing_release(IMAGE, "1.0.0", SOURCE) == DIGEST
    else:
        with pytest.raises(ValueError, match="refusing replacement"):
            release.existing_release(IMAGE, "1.0.0", SOURCE)


def test_master_publishes_only_unique_build_tag(monkeypatch):
    run = Mock()
    monkeypatch.setattr(release, "run", run)
    monkeypatch.setattr(release, "image_reference", lambda *args: DIGEST)
    monkeypatch.setattr(
        release, "existing_release", Mock(side_effect=AssertionError("Master checked release tag"))
    )
    assert release.publish(IMAGE, "1.0.0", SOURCE, "unique-build", "") == DIGEST
    run.assert_called_once_with("push", IMAGE + ":unique-build")


def test_release_retry_reuses_existing_image_without_push(monkeypatch):
    monkeypatch.setattr(release, "existing_release", lambda *args: DIGEST)
    run = Mock()
    monkeypatch.setattr(release, "run", run)
    assert release.publish(IMAGE, "1.0.0", SOURCE, "new-build", "1.0.0") == DIGEST
    run.assert_not_called()


def test_new_release_promotes_same_scanned_image(monkeypatch):
    monkeypatch.setattr(release, "existing_release", lambda *args: None)
    monkeypatch.setattr(release, "image_reference", lambda *args: DIGEST)
    run = Mock()
    monkeypatch.setattr(release, "run", run)
    assert release.publish(IMAGE, "1.0.0", SOURCE, "scanned-build", "1.0.0") == DIGEST
    assert [call.args for call in run.call_args_list] == [
        ("push", IMAGE + ":scanned-build"),
        ("tag", IMAGE + ":scanned-build", IMAGE + ":1.0.0"),
        ("push", IMAGE + ":1.0.0"),
    ]
