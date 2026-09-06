"""Controlled host-side deployment orchestration; no production commands run."""

import importlib.util
import multiprocessing
import time
from pathlib import Path
from unittest.mock import Mock

import pytest

MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "deploy_release.py"
spec = importlib.util.spec_from_file_location("deploy_release", MODULE_PATH)
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
    release.deploy(host, new_stage, newer, "new", "http://controlled/health")
    with pytest.raises(RuntimeError, match="Stale"):
        release.deploy(host, old_stage, older, "old", "http://controlled/health")
    assert (host / "docker-compose.yaml").read_text() == "new"
    assert run.call_count == health.call_count == 1


def deployment_process(host, staging, source, version, started, release_gate, trace):
    def record(event):
        with trace.open("a") as output:
            output.write(f"{version}:{event}\n")

    def run(*args, **kwargs):
        record("install")

    def health(*args):
        record("verify-start")
        if started is not None:
            started.set()
            assert release_gate.wait(5)
        record("verify-end")

    release.subprocess.run = run
    release.verify_health = health
    release.deploy(host, staging, source, version, "http://controlled/health")


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
