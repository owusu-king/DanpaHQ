"""Identity maintenance jobs."""

from __future__ import annotations

from celery import shared_task
from django.utils import timezone

from .models import AuthChallenge, ChallengeStatus, Session


@shared_task(name="identity.purge_expired_challenges")
def purge_expired_challenges() -> dict[str, int]:
    """Delete spent OTP challenges.

    Data minimisation, not housekeeping: a challenge row ties a phone number to
    an IP address and a device at a moment in time. Once it can no longer be
    used, keeping it is holding personal data with no purpose.

    Failed challenges are kept for 30 days because they are the evidence trail
    for a brute-force attempt; the audit log records the attempt regardless.
    """
    now = timezone.now()

    consumed, _ = AuthChallenge.objects.filter(
        status__in=[ChallengeStatus.VERIFIED, ChallengeStatus.EXPIRED, ChallengeStatus.CANCELLED],
        expires_at__lte=now - timezone.timedelta(days=1),
    ).delete()

    stale_failed, _ = AuthChallenge.objects.filter(
        status=ChallengeStatus.FAILED, updated_at__lte=now - timezone.timedelta(days=30)
    ).delete()

    expired = AuthChallenge.objects.filter(
        status=ChallengeStatus.PENDING, expires_at__lte=now
    ).update(status=ChallengeStatus.EXPIRED)

    return {"deleted": consumed + stale_failed, "marked_expired": expired}


@shared_task(name="identity.purge_expired_sessions")
def purge_expired_sessions() -> dict[str, int]:
    """Remove sessions that expired long ago.

    Revoked sessions are kept for 90 days: "when did I sign out of that device"
    is a question a security incident asks.
    """
    cutoff = timezone.now() - timezone.timedelta(days=90)
    deleted, _ = Session.objects.filter(expires_at__lte=cutoff).delete()
    return {"deleted": deleted}
