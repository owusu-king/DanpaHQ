"""Idempotency keys for unsafe requests.

A tenant on a weak network taps "Pay rent", sees a spinner, loses signal, and
taps again. Without this table that is two debits. With it, the second request
returns the first request's stored response and no second charge happens.

Design notes:

* The key is scoped to (actor, endpoint, key) so one user's key cannot collide
  with another's.
* The request body fingerprint is stored. Re-using a key with a *different* body
  is a client bug and returns 409 rather than the wrong cached response.
* A transaction-scoped advisory lock serialises concurrent claims; the unique
  constraint remains the final database invariant.
"""

from __future__ import annotations

import hashlib

from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class IdempotencyStatus(models.TextChoices):
    IN_FLIGHT = "in_flight", "In flight"
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"


def fingerprint(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


class IdempotencyKey(BaseModel):
    key = models.CharField(max_length=128)
    actor = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="idempotency_keys",
    )
    management_actor_id = models.UUIDField(null=True, blank=True, db_index=True)
    endpoint = models.CharField(max_length=200)
    request_fingerprint = models.CharField(max_length=64)

    status = models.CharField(
        max_length=16, choices=IdempotencyStatus.choices, default=IdempotencyStatus.IN_FLIGHT
    )
    response_status = models.PositiveSmallIntegerField(null=True, blank=True)
    response_body = models.JSONField(null=True, blank=True)

    #: The object the request created, so a replay can be traced to its effect.
    resource_type = models.CharField(max_length=64, blank=True)
    resource_id = models.CharField(max_length=64, blank=True)

    expires_at = models.DateTimeField(db_index=True)

    #: How long this claim may stay `in_flight` before another request may take
    #: it over. Only set by the external-call mode, which commits the claim
    #: *before* running the request so no database transaction is held across a
    #: provider's network call. The claim can therefore outlive the process that
    #: made it, and without a lease a crashed request would make its key
    #: permanently unusable — the client would retry for ever into a 409.
    #:
    #: Taking over an abandoned lease re-runs the request, so this is only safe
    #: where the domain service is independently idempotent. See
    #: `services.idempotent_mutation`.
    in_flight_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "idempotency_key"
        constraints = [
            # nulls_distinct=False is what makes the claim above true for
            # unauthenticated requests. Postgres treats NULLs as distinct by
            # default, so with actor NULL the same key would insert twice and
            # two concurrent retries would both proceed.
            models.UniqueConstraint(
                fields=["actor", "management_actor_id", "endpoint", "key"],
                name="idempotency_unique_key",
                nulls_distinct=False,
            )
        ]

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    @property
    def lease_expired(self) -> bool:
        """Whether an `in_flight` claim has outlived the request that took it.

        A claim with no lease was made by the transactional mode, which never
        commits `in_flight` — seeing one means a legacy or manual claimant owns
        it, and it is never taken over.
        """
        if self.in_flight_until is None:
            return False
        return timezone.now() >= self.in_flight_until

    def __str__(self) -> str:
        return f"{self.endpoint}:{self.key} ({self.status})"
