"""Scheduled, deduplicated viewing reminders."""

from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from apps.core.events import DomainEvent
from apps.outbox.services import emit

from .models import ViewingRequest, ViewingStatus
from .services import CHECK_IN_OPENS_BEFORE


@shared_task(name="viewing.emit_due_notifications")
def emit_due_notifications() -> dict[str, int]:
    now = timezone.now()
    approaching = check_in = 0
    ids = ViewingRequest.objects.filter(
        status=ViewingStatus.CONFIRMED,
        confirmed_slot__isnull=False,
        confirmed_slot__starts_at__gt=now - timedelta(hours=4),
        confirmed_slot__starts_at__lte=now + timedelta(hours=2),
    ).values_list("id", flat=True)
    for viewing_id in ids:
        with transaction.atomic():
            viewing = (
                ViewingRequest.objects.select_for_update()
                .select_related("confirmed_slot")
                .get(id=viewing_id)
            )
            starts_at = viewing.confirmed_slot.starts_at
            if viewing.approaching_notified_at is None and now < starts_at:
                viewing.approaching_notified_at = now
                viewing.save(update_fields=["approaching_notified_at", "updated_at"])
                emit(DomainEvent("viewing.approaching.v1", "viewing", str(viewing.id), {}))
                approaching += 1
            if (
                viewing.check_in_notified_at is None
                and starts_at - CHECK_IN_OPENS_BEFORE <= now
                and now
                < starts_at + timedelta(minutes=viewing.confirmed_slot.duration_minutes + 30)
            ):
                viewing.check_in_notified_at = now
                viewing.save(update_fields=["check_in_notified_at", "updated_at"])
                emit(DomainEvent("viewing.checkin_available.v1", "viewing", str(viewing.id), {}))
                check_in += 1
    return {"approaching": approaching, "check_in": check_in}
