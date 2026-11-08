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
        run_scheduler.Command().handle(in_process=False)
    else:
        with pytest.raises(CommandError):
            run_scheduler.Command().handle(in_process=False)
    if cause != "exited_child":
        assert events == ["terminate", "wait", "release"]
    else:
        assert events == ["release"]  # Already dead: no second termination.


@pytest.mark.parametrize("arguments,expected", [([], True), (["--in-process"], True),
                                              (["--subprocess"], False)])
def test_inline_scheduler_is_the_shared_default(arguments, expected):
    command = run_scheduler.Command()
    options = command.create_parser("manage.py", "run_scheduler").parse_args(arguments)
    assert options.in_process is expected


@pytest.mark.parametrize("lease_failure", [False, True])
def test_shared_inline_path_holds_lease_until_beat_stops(monkeypatch, lease_failure):
    events = []

    class Lease:
        def __enter__(self):
            events.append("held")
            return self

        def __exit__(self, *_):
            events.append("release")

    def inline(lease, stopped, schedule):
        assert events == ["held"]
        events.append("inline_stopped")
        if lease_failure:
            raise psycopg.OperationalError("test lease lost")

    spawn = Mock(side_effect=AssertionError("Inline beat must not spawn a child"))
    monkeypatch.setattr(run_scheduler.signal, "signal", lambda *_: None)
    monkeypatch.setattr(run_scheduler.psycopg, "connect", lambda **_: Lease())
    monkeypatch.setattr(run_scheduler.connection, "get_connection_params", lambda: {})
    monkeypatch.setattr(run_scheduler, "acquire", lambda _: True)
    monkeypatch.setattr(run_scheduler, "run_inline", inline)
    monkeypatch.setattr(run_scheduler.subprocess, "Popen", spawn)
    if lease_failure:
        with pytest.raises(CommandError, match="lease failed"):
            run_scheduler.Command().handle()
    else:
        run_scheduler.Command().handle()
    spawn.assert_not_called()
    assert events == ["held", "inline_stopped", "release"]
