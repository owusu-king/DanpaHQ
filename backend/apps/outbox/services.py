from __future__ import annotations

from django.db import transaction

from apps.core.context import get_context
from apps.core.events import DomainEvent

from .models import OutboxEvent


def emit(event: DomainEvent) -> OutboxEvent:
    """Record a domain event for publication after the current transaction commits.

    Must be called inside ``transaction.atomic``; if the surrounding work rolls
    back, so does the event.
    """
    ctx = get_context()
    return OutboxEvent.objects.create(
        name=event.name,
        aggregate_type=event.aggregate_type,
        aggregate_id=str(event.aggregate_id),
        payload=event.payload,
        request_id=ctx.request_id,
        trace={"actor_id": ctx.actor_id, "source": ctx.source},
    )


def emit_after_commit(event: DomainEvent) -> None:
    transaction.on_commit(lambda: emit(event))
