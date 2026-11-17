from threading import Event
from unittest.mock import Mock

import psycopg
import pytest
from celery.beat import PersistentScheduler, Service

from apps.core import scheduling
from apps.core.scheduling import LeasedScheduler
from config.celery import app


def test_lease_is_checked_before_any_due_task_is_published(monkeypatch):
    events = []
    lease = Mock()
    lease.execute.side_effect = lambda query: events.append("lease")
    monkeypatch.setattr(
        PersistentScheduler, "apply_entry", lambda *args, **kwargs: events.append("publish")
    )
    scheduler = LeasedScheduler(app=app, lease=lease, stopped=Event(), lazy=True)
    scheduler.check_lease()
    scheduler.apply_entry(Mock())
    assert events == ["lease", "lease", "publish"]


def test_lease_loss_prevents_publishing(monkeypatch):
    lease = Mock()
    publish = Mock()
    monkeypatch.setattr(PersistentScheduler, "apply_entry", publish)
    scheduler = LeasedScheduler(app=app, lease=lease, stopped=Event(), lazy=True)
    scheduler.check_lease()
    lease.execute.side_effect = psycopg.OperationalError("lease lost")
    with pytest.raises(psycopg.OperationalError):
        scheduler.apply_entry(Mock())
    publish.assert_not_called()


def test_idle_ticks_only_check_the_lease_at_the_heartbeat_interval(monkeypatch):
    clock = Mock(return_value=100)
    monkeypatch.setattr(scheduling, "monotonic", clock)
    monkeypatch.setattr(PersistentScheduler, "tick", lambda self: 2)
    lease = Mock()
    scheduler = LeasedScheduler(app=app, lease=lease, stopped=Event(), lazy=True)
    for instant in (100, 100.01, 102, 129, 130):
        clock.return_value = instant
        assert scheduler.tick() == 2
    assert lease.execute.call_count == 2


def test_shutdown_closes_inline_beat_before_the_lease_can_be_released(tmp_path):
    from functools import partial

    stopped = Event()
    stopped.set()
    lease = Mock()
    service = Service(
        app=app, schedule_filename=str(tmp_path / "beat"), max_interval=2,
        scheduler_cls=partial(LeasedScheduler, lease=lease, stopped=stopped),
    )
    service.start()
    assert service._is_stopped.is_set()
    lease.execute.assert_not_called()
