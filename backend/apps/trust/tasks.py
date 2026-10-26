"""Scheduled trust maintenance."""

from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

from apps.core.events import DomainEvent
from apps.outbox.services import emit

from .models import Verification, VerificationStatus

logger = logging.getLogger("trust")

#: Warn this far ahead so a landlord is not surprised by a listing losing its
#: stamp the day a tenant is deciding.
EXPIRY_WARNING_DAYS = 14


@shared_task(name="trust.expire_verifications")
def expire_verifications() -> dict[str, int]:
    """Move approved-but-past-expiry rows to expired, and announce it.

    ``display_state`` already treats them as expired between runs, so this job is
    for correctness of the stored status and for the notification - not for
    preventing a stale stamp being shown.
    """
    now = timezone.now()
    due = Verification.objects.filter(
        status=VerificationStatus.APPROVED, expires_at__isnull=False, expires_at__lte=now
    )

    expired = 0
    for verification in due.iterator():
        verification.status = VerificationStatus.EXPIRED
        verification.save(update_fields=["status", "updated_at"])
        from apps.listing.services import suspend_for_verification

        suspend_for_verification(
            subject_type=verification.subject_type,
            subject_id=verification.subject_id,
            kind=verification.kind,
            reason="The verification required for this listing expired.",
        )
        if verification.subject_type == "property" and verification.kind == "property_authority":
            from apps.property.services import suspend_property_authority

            suspend_property_authority(verification=verification, expired=True)
        from apps.property.access_codes import revoke_for_verification_subject

        revoke_for_verification_subject(
            subject_type=verification.subject_type,
            subject_id=verification.subject_id,
            reason="verification_expired",
        )
        emit(
            DomainEvent(
                "trust.verification_expired.v1",
                "verification",
                str(verification.id),
                {
                    "kind": verification.kind,
                    "subject_type": verification.subject_type,
                    "subject_id": verification.subject_id,
                },
            )
        )
        expired += 1

    if expired:
        logger.info("expired verifications", extra={"event": "trust_expiry", "duration_ms": None})
    return {"expired": expired}


@shared_task(name="trust.warn_expiring_verifications")
def warn_expiring_verifications() -> dict[str, int]:
    now = timezone.now()
    horizon = now + timezone.timedelta(days=EXPIRY_WARNING_DAYS)

    warned = 0
    upcoming = Verification.objects.filter(
        status=VerificationStatus.APPROVED, expires_at__gt=now, expires_at__lte=horizon
    )
    for verification in upcoming.iterator():
        emit(
            DomainEvent(
                "trust.verification_expiring.v1",
                "verification",
                str(verification.id),
                {
                    "kind": verification.kind,
                    "subject_id": verification.subject_id,
                    "expires_at": verification.expires_at.isoformat(),
                },
            )
        )
        warned += 1
    return {"warned": warned}


@shared_task(name="trust.release_stale_claims")
def release_stale_claims() -> dict[str, int]:
    """Return abandoned review claims to the queue."""
    from .models import ReviewQueueEntry

    released = ReviewQueueEntry.objects.filter(
        resolved_at__isnull=True,
        claimed_at__isnull=False,
        claim_expires_at__lte=timezone.now(),
    ).update(claimed_by=None, claimed_at=None, claim_expires_at=None)
    return {"released": released}
