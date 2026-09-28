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


def test_same_version_requires_exact_build_identity(monkeypatch):
    from io import BytesIO

    monkeypatch.setattr(
        release,
        "urlopen",
        lambda *args, **kwargs: BytesIO(b'{"status":"ok","version":"1.0.0","buildId":"old-build"}'),
    )
    monkeypatch.setattr(release.time, "sleep", lambda *args: None)
    with pytest.raises(RuntimeError, match="expected healthy version"):
        release.verify_health("http://controlled/health", "1.0.0", "new-build")
    release.verify_health("http://controlled/health", "1.0.0", "old-build")


def test_new_deployment_records_version_and_build_id(tmp_path, monkeypatch):
    import json

    host = tmp_path / "host"
    host.mkdir()
    (host / ".env").touch()
    source = "a" * 40
    staged = stage(tmp_path, "new-stage", [source])
    health = Mock()
    monkeypatch.setattr(release.subprocess, "run", Mock())
    monkeypatch.setattr(release, "verify_health", health)
    monkeypatch.setattr(release, "verify_artifact", lambda *args: "exact-image-id")
    release.deploy(host, staged, source, "1.0.0", "http://controlled/health", IMAGE, "unique-build")
    health.assert_called_once_with("http://controlled/health", "1.0.0", "unique-build")
    record = json.loads((host / "deployment.json").read_text())
    assert (record["version"], record["build_id"]) == ("1.0.0", "unique-build")


def test_health_check_retries_dropped_connections_and_non_object_bodies(monkeypatch):
    from http.client import RemoteDisconnected
    from io import BytesIO

    replies = [
        RemoteDisconnected("Remote end closed connection without response"),
        RemoteDisconnected("Remote end closed connection without response"),
        b"[]",
        b'{"status":"ok","version":"1.0.0","buildId":"build"}',
    ]

    def urlopen(*args, **kwargs):
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return BytesIO(reply)

    monkeypatch.setattr(release, "urlopen", urlopen)
    monkeypatch.setattr(release.time, "sleep", lambda *args: None)
    release.verify_health("http://controlled/health", "1.0.0", "build")
    assert replies == []


def failing_host(tmp_path, monkeypatch, healthy):
    """A host whose releases verify only while their version is in healthy."""
    host = tmp_path / "host"
    host.mkdir()
    (host / ".env").touch()
    run = Mock()

    def health(url, version, *build):
        if version not in healthy:
            raise RuntimeError(f"{version} did not report the expected healthy version")

    monkeypatch.setattr(release.subprocess, "run", run)
    monkeypatch.setattr(release, "verify_health", Mock(side_effect=health))
    monkeypatch.setattr(release, "verify_artifact", lambda *args: "sha256:synthetic")
    return host, run


def image(digit):
    return "registry.invalid/synthetic@sha256:" + digit * 64


def compose_ups(run):
    return sum("up" in call.args[0] for call in run.call_args_list)


def test_failed_health_restores_verified_release_and_reraises(tmp_path, monkeypatch, capsys):
    import json

    source = "a" * 40
    host, run = failing_host(tmp_path, monkeypatch, {"good"})
    good = stage(tmp_path, "good", [source])
    bad = stage(tmp_path, "bad", [source])
    release.deploy(host, good, source, "good", "http://controlled/health", image("1"), "b-good")
    run.reset_mock()
    with pytest.raises(RuntimeError, match="bad did not report"):
        release.deploy(host, bad, source, "bad", "http://controlled/health", image("2"), "b-bad")
    assert (host / "docker-compose.yaml").read_text() == "good"
    assert compose_ups(run) == 2
    release.verify_health.assert_called_with("http://controlled/health", "good", "b-good")
    assert json.loads((host / "deployment.json").read_text())["version"] == "good"
    assert (host / ".accepted-source").read_text() == source + "\n"
    assert "Rolled back to b-good" in capsys.readouterr().out


def test_failed_pull_restores_compose_without_restarting(tmp_path, monkeypatch):
    from subprocess import CalledProcessError

    source = "a" * 40
    host, run = failing_host(tmp_path, monkeypatch, {"good"})
    release.deploy(host, stage(tmp_path, "good", [source]), source, "good", "http://h", image("1"))
    run.reset_mock()
    run.side_effect = CalledProcessError(1, ["docker", "compose", "pull"])
    with pytest.raises(CalledProcessError):
        release.deploy(
            host, stage(tmp_path, "bad", [source]), source, "bad", "http://h", image("2")
        )
    assert (host / "docker-compose.yaml").read_text() == "good"
    assert compose_ups(run) == 0


def test_failed_rollback_still_reports_the_original_error(tmp_path, monkeypatch, capsys):
    source = "a" * 40
    healthy = {"good"}
    host, _ = failing_host(tmp_path, monkeypatch, healthy)
    release.deploy(host, stage(tmp_path, "good", [source]), source, "good", "http://h", image("1"))
    healthy.clear()
    with pytest.raises(RuntimeError, match="bad did not report"):
        release.deploy(
            host, stage(tmp_path, "bad", [source]), source, "bad", "http://h", image("2")
        )
    assert "Rollback to good failed" in capsys.readouterr().out


def test_repeated_failures_keep_previous_files_on_verified_releases(tmp_path, monkeypatch):
    import json

    source = "a" * 40
    host, _ = failing_host(tmp_path, monkeypatch, {"first", "second"})
    for name, digit in (("first", "1"), ("second", "2")):
        release.deploy(
            host, stage(tmp_path, name, [source]), source, name, "http://h", image(digit)
        )
    for name, digit in (("bad-B", "3"), ("bad-C", "4")):
        with pytest.raises(RuntimeError):
            release.deploy(
                host, stage(tmp_path, name, [source]), source, name, "http://h", image(digit)
            )
    assert (host / "docker-compose.yaml").read_text() == "second"
    assert (host / "verified-compose.yaml").read_text() == "second"
    assert (host / "previous-compose.yaml").read_text() == "first"
    assert json.loads((host / "deployment.json").read_text())["image_reference"] == image("2")
    previous = json.loads((host / "previous-deployment.json").read_text())
    assert previous["image_reference"] == image("1")


@pytest.mark.parametrize("names_recorded_image", [True, False])
def test_first_run_seeds_verified_compose_only_from_the_recorded_image(
    tmp_path, monkeypatch, capsys, names_recorded_image
):
    import json

    source = "a" * 40
    host, run = failing_host(tmp_path, monkeypatch, set())
    installed = "image: " + (image("1") if names_recorded_image else image("9")) + "\n"
    (host / "docker-compose.yaml").write_text(installed)
    (host / "deployment.json").write_text(
        json.dumps({"version": "legacy", "build_id": None, "image_reference": image("1")})
    )
    with pytest.raises(RuntimeError):
        release.deploy(
            host, stage(tmp_path, "bad", [source]), source, "bad", "http://h", image("2")
        )
    output = capsys.readouterr().out
    if names_recorded_image:
        assert (host / "verified-compose.yaml").read_text() == installed
        assert (host / "docker-compose.yaml").read_text() == installed
        assert compose_ups(run) == 2
        release.verify_health.assert_called_with("http://h", "legacy")
        assert "rollback is unavailable" not in output
    else:
        assert not (host / "verified-compose.yaml").exists()
        assert (host / "docker-compose.yaml").read_text() == "bad"
        assert compose_ups(run) == 1
        assert "rollback is unavailable for this attempt" in output
