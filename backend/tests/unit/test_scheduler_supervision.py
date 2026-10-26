"""A lost scheduler lease must stop beat before its session is closed."""

from types import SimpleNamespace
from unittest.mock import Mock

import psycopg
import pytest
from django.core.management.base import CommandError

from apps.core.management.commands import run_scheduler


@pytest.mark.parametrize("cause", ["lost_database", "exited_child", "shutdown"])
def test_scheduler_stops_child_before_releasing_its_lease(monkeypatch, cause):
    events = []
    child = Mock()
    child.poll.return_value = None
    child.terminate.side_effect = lambda: events.append("terminate")
    child.wait.side_effect = lambda **_: events.append("wait")

    class Lease:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            events.append("release")

        def execute(self, *_):
            if cause == "lost_database":
                raise psycopg.OperationalError("test lease lost")
            child.poll.return_value = 1

    stopped = SimpleNamespace(is_set=lambda: False, wait=lambda _: cause == "shutdown")
    monkeypatch.setattr(run_scheduler.threading, "Event", lambda: stopped)
    monkeypatch.setattr(run_scheduler.signal, "signal", lambda *_: None)
    monkeypatch.setattr(run_scheduler.psycopg, "connect", lambda **_: Lease())
    monkeypatch.setattr(run_scheduler.connection, "get_connection_params", lambda: {})
    monkeypatch.setattr(run_scheduler, "acquire", lambda _: True)
    monkeypatch.setattr(run_scheduler.subprocess, "Popen", lambda *_: child)
    if cause == "shutdown":
        run_scheduler.Command().handle()
    else:
        with pytest.raises(CommandError):
            run_scheduler.Command().handle()
    if cause != "exited_child":
        assert events == ["terminate", "wait", "release"]
    else:
        assert events == ["release"]  # Already dead: no second termination.
