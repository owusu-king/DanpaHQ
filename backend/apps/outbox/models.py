"""Transactional outbox.

The problem it solves: a Celery task queued inside a database transaction can be
picked up by a worker *before* the transaction commits (or after it rolls back),
so the worker sends an SMS about a payment that never happened. Over unreliable
networks with real money involved, that is not an acceptable failure mode.

The fix: the event is a row in the same database, written in the same
transaction as the state change. A dispatcher polls committed rows and hands
them to Celery. The event and the state change now succeed or fail together.
"""

from __future__ import annotations

from django.core.serializers.json import DjangoJSONEncoder
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class OutboxStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    PROCESSING = "processing", "Processing"
    PUBLISHED = "published", "Published"
    FAILED = "failed", "Failed"
    DEAD = "dead", "Dead letter"


class OutboxEvent(BaseModel):
    name = models.CharField(max_length=100, db_index=True)  # "lease.signed.v1"
    aggregate_type = models.CharField(max_length=64)
    aggregate_id = models.CharField(max_length=64)
    # Every identifier in this system is a UUID and most events carry one, so
    # the default encoder would raise TypeError on a routine payload. The same
    # encoder handles the datetimes and Decimals events also carry.
    payload = models.JSONField(default=dict, encoder=DjangoJSONEncoder)

    status = models.CharField(
        max_length=16, choices=OutboxStatus.choices, default=OutboxStatus.PENDING
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=8)
    available_at = models.DateTimeField(default=timezone.now)
    published_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)

    request_id = models.CharField(max_length=64, blank=True)
    trace = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)

    class Meta:
        db_table = "outbox_event"
        indexes = [
            # The dispatcher's only query: pending work that is due.
            models.Index(
                fields=["status", "available_at"],
                name="outbox_due_idx",
                condition=models.Q(status__in=["pending", "failed"]),
            ),
            models.Index(fields=["aggregate_type", "aggregate_id"], name="outbox_aggregate_idx"),
        ]

    def backoff_seconds(self) -> int:
        """Exponential backoff, capped at an hour."""
        return min(2**self.attempts * 5, 3600)

    def __str__(self) -> str:
        return f"{self.name} ({self.status})"
