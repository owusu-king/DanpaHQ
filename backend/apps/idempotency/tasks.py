"""Retention for completed and failed request claims."""

from celery import shared_task
from django.utils import timezone

from .models import IdempotencyKey


@shared_task(name="idempotency.purge_expired")
def purge_expired() -> int:
    """Remove response caches after their replay window has closed."""
    deleted, _ = IdempotencyKey.objects.filter(expires_at__lte=timezone.now()).delete()
    return deleted
