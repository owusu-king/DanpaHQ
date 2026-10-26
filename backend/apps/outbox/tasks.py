"""Outbox dispatcher.

Runs on a Celery beat schedule. Claims a batch with ``SELECT ... FOR UPDATE SKIP
LOCKED`` so several dispatcher replicas can run without processing the same row
twice, which is what makes this safe to scale horizontally.
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from .models import OutboxEvent, OutboxStatus

logger = logging.getLogger("outbox")

BATCH_SIZE = 100

#: How long an event may sit in ``processing`` before the dispatcher assumes the
#: worker holding it is gone. Claiming marks a batch ``processing`` in its own
#: committed transaction, so a worker killed mid-batch used to leave those rows
#: in a status nothing ever queries again — permanently. For the money domain
#: that meant a lost ``lease.activated.v1`` leaving a live tenancy with no rent
#: schedule at all, and a lost ``payment.succeeded.v1`` leaving a paid tenant
#: with no confirmation. Far longer than any handler takes; dispatch is
#: at-least-once and every handler already recognises a redelivery.
STALE_PROCESSING_MINUTES = 15

#: Populated by feature apps at import time: {"lease.signed.v1": [handler, ...]}
HANDLERS: dict[str, list] = {}


def subscribe(event_name: str):
    def decorator(fn):
        HANDLERS.setdefault(event_name, []).append(fn)
        return fn

    return decorator


def reclaim_stale_processing() -> int:
    """Return abandoned claims to the retry path.

    Only rows whose claim is older than the grace period, and only back to
    ``failed`` — so they re-enter through the same backoff and dead-letter rules
    as any other retry rather than looping instantly.
    """
    cutoff = timezone.now() - timezone.timedelta(minutes=STALE_PROCESSING_MINUTES)
    with transaction.atomic():
        stale = list(
            OutboxEvent.objects.select_for_update(skip_locked=True).filter(
                status=OutboxStatus.PROCESSING,
                updated_at__lte=cutoff,
            )[:BATCH_SIZE]
        )
        if not stale:
            return 0
        OutboxEvent.objects.filter(id__in=[event.id for event in stale]).update(
            status=OutboxStatus.FAILED,
            available_at=timezone.now(),
            last_error="reclaimed: dispatcher stopped while the event was being processed",
            updated_at=timezone.now(),
        )
    logger.warning(
        "outbox reclaimed abandoned events",
        extra={"event": "outbox_reclaimed", "count": len(stale)},
    )
    return len(stale)


@shared_task(name="outbox.dispatch_pending")
def dispatch_pending() -> dict[str, int]:
    published = failed = 0
    reclaimed = reclaim_stale_processing()

    with transaction.atomic():
        batch = list(
            OutboxEvent.objects.select_for_update(skip_locked=True)
            .filter(
                status__in=[OutboxStatus.PENDING, OutboxStatus.FAILED],
                available_at__lte=timezone.now(),
            )
            .order_by("created_at")[:BATCH_SIZE]
        )
        ids = [event.id for event in batch]
        # ``updated_at`` is the claim's clock: `reclaim_stale_processing` reads
        # it to decide whether the worker that took this row is still alive. A
        # queryset update does not run ``auto_now``, so it is stamped here.
        OutboxEvent.objects.filter(id__in=ids).update(
            status=OutboxStatus.PROCESSING, updated_at=timezone.now()
        )

    for event in batch:
        try:
            for handler in HANDLERS.get(event.name, []):
                # The whole event, not just the payload. Dispatch is
                # at-least-once, so a handler with a side effect has to be able
                # to recognise a redelivery - and the only thing that identifies
                # one is the event id. Two offers of viewing times carry
                # identical payloads and must produce two notifications; the
                # same offer retried must produce one.
                handler(event)
        except Exception as exc:
            failed += 1
            event.attempts += 1
            event.last_error = f"{type(exc).__name__}: {exc}"[:2000]
            if event.attempts >= event.max_attempts:
                event.status = OutboxStatus.DEAD
                logger.error(
                    "outbox event exhausted retries",
                    extra={"event": "outbox_dead", "kind": event.name},
                )
            else:
                event.status = OutboxStatus.FAILED
                event.available_at = timezone.now() + timezone.timedelta(
                    seconds=event.backoff_seconds()
                )
            event.save(
                update_fields=["attempts", "last_error", "status", "available_at", "updated_at"]
            )
        else:
            published += 1
            OutboxEvent.objects.filter(id=event.id).update(
                status=OutboxStatus.PUBLISHED, published_at=timezone.now()
            )

    return {"published": published, "failed": failed, "reclaimed": reclaimed}
