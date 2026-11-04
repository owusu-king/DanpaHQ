"""Exercise real process exits, graceful shutdown and forced group cleanup."""

import importlib.util
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "render-supervise.py"
spec = importlib.util.spec_from_file_location("render_supervise", SCRIPT)
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


def test_standard_profile_retains_worker_isolation_and_web_concurrency(monkeypatch):
    monkeypatch.delenv("RENDER_RUNTIME_PROFILE", raising=False)
    worker, scheduler, api = supervisor.commands()
    assert "--pool=solo" not in worker
    assert scheduler[-1] == "run_scheduler"
    assert api[api.index("--threads") + 1] == "4"


def test_free_staging_uses_one_request_and_no_extra_worker_or_beat_child(monkeypatch):
    monkeypatch.setenv("RENDER_RUNTIME_PROFILE", "staging-free")
    monkeypatch.setenv("DJANGO_SETTINGS_MODULE", "config.settings.staging")
    worker, scheduler, api = supervisor.commands()
    assert "--pool=solo" in worker
    assert scheduler[-1] == "run_scheduler"
    assert api[api.index("--threads") + 1] == "1"
    assert "default,payments,notifications,media" in worker


def test_free_profile_is_rejected_for_production(monkeypatch):
    monkeypatch.setenv("RENDER_RUNTIME_PROFILE", "staging-free")
    monkeypatch.setenv("DJANGO_SETTINGS_MODULE", "config.settings.production")
    with pytest.raises(ValueError, match="only permitted with staging"):
        supervisor.commands()


@pytest.mark.parametrize("failed", [0, 1, 2])
def test_failure_of_any_essential_process_stops_all_children(monkeypatch, failed):
    children = []
    real_popen = subprocess.Popen

    def start(command, **kwargs):
        child = real_popen(command, **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(supervisor, "commands", lambda: [
        [sys.executable, "-c", "import time; time.sleep(0.1); raise SystemExit(3)"]
        if index == failed else [sys.executable, "-c", "import time; time.sleep(60)"]
        for index in range(3)
    ])
    monkeypatch.setattr(supervisor.subprocess, "Popen", start)
    assert supervisor.main() == 1
    assert len(children) == 3 and all(child.poll() is not None for child in children)


def test_shutdown_kills_a_child_that_ignores_sigterm(tmp_path):
    ready = tmp_path / "ready"
    child = subprocess.Popen([  # noqa: S603 -- fixed test program
        sys.executable, "-c",
        "import pathlib,signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); "
        f"pathlib.Path({str(ready)!r}).touch(); time.sleep(60)",
    ], start_new_session=True)
    try:
        for _ in range(100):
            if ready.exists():
                break
            threading.Event().wait(0.01)
        assert ready.exists()
        supervisor.shutdown([child], grace=0.05)
        assert child.returncode == -signal.SIGKILL
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


def test_partial_start_failure_cleans_up_already_started_children(monkeypatch):
    children = []
    real_popen = subprocess.Popen

    def start(command, **kwargs):
        if children:
            raise OSError("Cannot start second child")
        child = real_popen(command, **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(supervisor, "commands", lambda: [
        [sys.executable, "-c", "import time; time.sleep(60)"] for _ in range(3)
    ])
    monkeypatch.setattr(supervisor.subprocess, "Popen", start)
    with pytest.raises(OSError, match="second child"):
        supervisor.main()
    assert len(children) == 1 and children[0].poll() is not None


def test_sigterm_is_forwarded_and_supervisor_exits_successfully(tmp_path):
    ready = tmp_path / "ready"
    child_code = f"import pathlib,time; pathlib.Path({str(ready)!r}).touch(); time.sleep(60)"
    # Run main in its own interpreter, where SIGTERM can safely be delivered.
    harness = (
        "import importlib.util,sys; "
        f"s=importlib.util.spec_from_file_location('s',{str(SCRIPT)!r}); "
        "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
        f"m.commands=lambda:[[sys.executable,'-c',"
        f"{child_code!r}]]; "
        "sys.exit(m.main())"
    )
    process = subprocess.Popen([sys.executable, "-c", harness])  # noqa: S603 -- fixed test program
    try:
        for _ in range(200):
            if ready.exists():
                break
            threading.Event().wait(0.01)
        assert ready.exists()
        process.terminate()
        assert process.wait(timeout=5) == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
