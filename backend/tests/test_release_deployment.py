"""Controlled host-side deployment orchestration; no production commands run."""

import importlib.util
import multiprocessing
import time
from pathlib import Path
from unittest.mock import Mock

import pytest

MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "deploy_release.py"
spec = importlib.util.spec_from_file_location("deploy_release", MODULE_PATH)
IMAGE = "registry.invalid/synthetic@sha256:" + "1" * 64
assert spec is not None and spec.loader is not None
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def stage(root, name, history):
    path = root / name
    path.mkdir()
    (path / "source-history").write_text("\n".join(history))
    (path / "docker-compose.yaml").write_text(name)
    return path


def test_ops01_delayed_older_commit_is_refused(tmp_path, monkeypatch):
    host = tmp_path / "host"
    host.mkdir()
    (host / ".env").touch()
    older, newer = "a" * 40, "b" * 40
    old_stage = stage(tmp_path, "old", [older])
    new_stage = stage(tmp_path, "new", [newer, older])
    run = Mock()
    health = Mock()
    monkeypatch.setattr(release.subprocess, "run", run)
    monkeypatch.setattr(release, "verify_health", health)
    monkeypatch.setattr(release, "verify_artifact", lambda *args: "sha256:synthetic")
    release.deploy(host, new_stage, newer, "new", "http://controlled/health", IMAGE)
    with pytest.raises(RuntimeError, match="Stale"):
        release.deploy(host, old_stage, older, "old", "http://controlled/health", IMAGE)
    assert (host / "docker-compose.yaml").read_text() == "new"
    assert run.call_count == 2
    assert health.call_count == 1


def deployment_process(host, staging, source, version, started, release_gate, trace):
    def record(event):
        with trace.open("a") as output:
            output.write(f"{version}:{event}\n")

    def run(*args, **kwargs):
        if "up" in args[0]:
            record("install")

    def health(*args):
        record("verify-start")
        if started is not None:
            started.set()
            assert release_gate.wait(5)
        record("verify-end")

    release.subprocess.run = run
    release.__dict__.update(verify_health=health, verify_artifact=lambda *args: "sha256:synthetic")
    release.deploy(host, staging, source, version, "http://controlled/health", IMAGE)


def test_ops01_independent_processes_hold_lock_through_verification(tmp_path):
    host = tmp_path / "host"
    host.mkdir()
    (host / ".env").touch()
    older, newer = "a" * 40, "b" * 40
    old_stage = stage(tmp_path, "old", [older])
    new_stage = stage(tmp_path, "new", [newer, older])
    context = multiprocessing.get_context("spawn")
    started, gate = context.Event(), context.Event()
    trace = tmp_path / "trace"
    first = context.Process(
        target=deployment_process, args=(host, old_stage, older, "old", started, gate, trace)
    )
    second = context.Process(
        target=deployment_process, args=(host, new_stage, newer, "new", None, gate, trace)
    )
    first.start()
    try:
        assert started.wait(5)
        second.start()
        time.sleep(0.1)
        assert trace.read_text().splitlines() == ["old:install", "old:verify-start"]
        gate.set()
        first.join(5)
        second.join(5)
        assert first.exitcode == second.exitcode == 0
        assert trace.read_text().splitlines() == [
            "old:install",
            "old:verify-start",
            "old:verify-end",
            "new:install",
            "new:verify-start",
            "new:verify-end",
        ]
    finally:
        for process in (first, second):
            if process.is_alive():
                process.terminate()
                process.join(5)


@pytest.mark.parametrize(
    "actual_id, actual_reference",
    [
        ("sha256:old-build", IMAGE),
        ("sha256:new-build", "registry.invalid/synthetic:mutable"),
    ],
)
def test_ops02_old_image_or_wrong_reference_cannot_verify(
    tmp_path, monkeypatch, actual_id, actual_reference
):
    from subprocess import CompletedProcess

    values = ["sha256:new-build", "container", actual_id, actual_reference]
    monkeypatch.setattr(
        release.subprocess,
        "run",
        Mock(side_effect=[CompletedProcess([], 0, stdout=value) for value in values]),
    )
    with pytest.raises(RuntimeError, match="immutable image"):
        release.verify_artifact(tmp_path, IMAGE)


def test_ops02_rebuild_records_exact_previous_artifact(tmp_path, monkeypatch):
    import json

    host = tmp_path / "host"
    host.mkdir()
    (host / ".env").touch()
    source = "a" * 40
    old_stage = stage(tmp_path, "build-one", [source])
    new_stage = stage(tmp_path, "build-two", [source])
    second_image = "registry.invalid/synthetic@sha256:" + "2" * 64
    monkeypatch.setattr(release.subprocess, "run", Mock())
    monkeypatch.setattr(release, "verify_health", Mock())
    monkeypatch.setattr(
        release, "verify_artifact", lambda directory, reference: "id-" + reference[-1]
    )
    release.deploy(host, old_stage, source, "build-one", "http://controlled/health", IMAGE)
    release.deploy(host, new_stage, source, "build-two", "http://controlled/health", second_image)
    old = json.loads((host / "previous-deployment.json").read_text())
    current = json.loads((host / "deployment.json").read_text())
    assert old["image_reference"] == IMAGE
    assert current["image_reference"] == second_image
    assert old["image_id"] != current["image_id"]
    assert (host / "previous-compose.yaml").read_text() == "build-one"
