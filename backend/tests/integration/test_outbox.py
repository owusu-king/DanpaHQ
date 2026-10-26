import pytest
from django.db import transaction
from django.utils import timezone

from apps.core.events import DomainEvent
from apps.outbox import tasks
from apps.outbox.models import OutboxEvent, OutboxStatus
from apps.outbox.services import emit

pytestmark = pytest.mark.django_db(transaction=True)


def test_event_rolls_back_with_its_transaction():
    """The point of the outbox: no notification for work that never happened."""
    try:
        with transaction.atomic():
            emit(DomainEvent("lease.signed.v1", "lease", "l1", {}))
            raise RuntimeError("business rule failed")
    except RuntimeError:
        pass
    assert OutboxEvent.objects.count() == 0


def test_dispatcher_publishes_pending_events():
    """Handlers receive the whole event, not only the payload.

    Dispatch is at-least-once, so a handler with a side effect has to be able to
    recognise a redelivery, and only the event id identifies one.
    """
    received = []
    tasks.HANDLERS.clear()
    tasks.subscribe("lease.signed.v1")(received.append)

    emit(DomainEvent("lease.signed.v1", "lease", "l2", {"amount_minor": 150000}))
    result = tasks.dispatch_pending()

    assert result["published"] == 1
    assert len(received) == 1
    assert received[0].name == "lease.signed.v1"
    assert received[0].payload == {"amount_minor": 150000}
    assert received[0].id is not None
    assert OutboxEvent.objects.get().status == OutboxStatus.PUBLISHED


def test_failed_handler_schedules_a_retry():
    tasks.HANDLERS.clear()

    @tasks.subscribe("lease.signed.v1")
    def _boom(_event):
        raise ValueError("provider down")

    emit(DomainEvent("lease.signed.v1", "lease", "l3", {}))
    tasks.dispatch_pending()

    event = OutboxEvent.objects.get()
    assert event.status == OutboxStatus.FAILED
    assert event.attempts == 1
    assert event.available_at > timezone.now()
    assert "provider down" in event.last_error


def test_events_go_dead_rather_than_retrying_forever():
    tasks.HANDLERS.clear()

    @tasks.subscribe("lease.signed.v1")
    def _boom(_event):
        raise ValueError("permanent")

    emit(DomainEvent("lease.signed.v1", "lease", "l4", {}))
    OutboxEvent.objects.update(attempts=7, max_attempts=8)
    tasks.dispatch_pending()

    assert OutboxEvent.objects.get().status == OutboxStatus.DEAD


def test_an_abandoned_claim_is_reclaimed_and_delivered():
    """A worker that dies mid-batch must not lose the event it was holding.

    Claiming a batch commits `processing` in its own transaction, and nothing
    ever queried that status again. For the money domain that meant a lost
    `lease.activated.v1` leaving a live tenancy with no rent schedule at all,
    and a lost `payment.succeeded.v1` leaving a paid tenant with no receipt
    notification — silently, for ever.
    """
    received = []
    tasks.HANDLERS.clear()
    tasks.subscribe("lease.activated.v1")(received.append)

    emit(DomainEvent("lease.activated.v1", "lease", "l5", {}))
    stale = timezone.now() - timezone.timedelta(minutes=tasks.STALE_PROCESSING_MINUTES + 1)
    OutboxEvent.objects.update(status=OutboxStatus.PROCESSING, updated_at=stale)

    result = tasks.dispatch_pending()

    assert result["reclaimed"] == 1
    assert result["published"] == 1
    assert len(received) == 1
    assert OutboxEvent.objects.get().status == OutboxStatus.PUBLISHED


def test_a_live_claim_is_left_alone():
    """The grace period is what stops the reclaim racing a working dispatcher."""
    tasks.HANDLERS.clear()
    emit(DomainEvent("lease.activated.v1", "lease", "l6", {}))
    OutboxEvent.objects.update(status=OutboxStatus.PROCESSING, updated_at=timezone.now())

    assert tasks.reclaim_stale_processing() == 0
    assert OutboxEvent.objects.get().status == OutboxStatus.PROCESSING
