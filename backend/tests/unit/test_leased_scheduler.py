from threading import Event
from unittest.mock import Mock

import psycopg
import pytest
from celery.beat import PersistentScheduler, Service

from apps.core.scheduling import LeasedScheduler
from config.celery import app


def test_lease_is_checked_before_any_due_task_is_published(monkeypatch):
    events = []
    lease = Mock()
    lease.execute.side_effect = lambda query: events.append("lease")
    monkeypatch.setattr(PersistentScheduler, "tick", lambda self: events.append("publish") or 2)
    scheduler = LeasedScheduler(app=app, lease=lease, stopped=Event(), lazy=True)
    assert scheduler.tick() == 2
    assert events == ["lease", "publish"]


def test_lease_loss_prevents_publishing(monkeypatch):
    lease = Mock()
    lease.execute.side_effect = psycopg.OperationalError("lease lost")
    publish = Mock()
    monkeypatch.setattr(PersistentScheduler, "tick", publish)
    scheduler = LeasedScheduler(app=app, lease=lease, stopped=Event(), lazy=True)
    with pytest.raises(psycopg.OperationalError):
        scheduler.tick()
    publish.assert_not_called()


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
