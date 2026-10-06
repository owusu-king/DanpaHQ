"""Scheduled alerts about a lease's own dates."""

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

#: Days before a lease ends that both parties hear about it.
EXPIRY_CHECKPOINTS = (60, 30, 7)


@shared_task(name="lease.emit_expiry_alerts")
def emit_expiry_alerts() -> dict[str, int]:
    """Tell tenant and landlord when an active lease nears its end date.

    Each (lease, checkpoint, person) is one notification: the dedupe key makes a
    repeated run, a retry or two racing workers harmless. Whether it also goes
    out as a text is the person's ``lease_expiry`` alert choice.
    """
    from apps.notifications.services import notify

    from .models import Lease, LeaseStatus

    today = timezone.localdate()
    sent = 0
    for days in EXPIRY_CHECKPOINTS:
        ends_on = today + timedelta(days=days)
        leases = Lease.objects.filter(status=LeaseStatus.ACTIVE, ends_on=ends_on).select_related(
            "tenant", "landlord", "unit__property"
        )
        for lease in leases:
            place = (
                f"{(lease.unit.property.title or 'the property')[:80]} · {lease.unit.label[:48]}"
            )
            when = f"{ends_on:%d %b %Y}"
            title = f"A lease ends in {days} days"
            for user, body in (
                (
                    lease.tenant,
                    f"Your tenancy at {place} ends on {when}. Speak to your landlord "
                    "about renewing or moving out.",
                ),
                (
                    lease.landlord,
                    f"The lease at {place} ends on {when}. Open Documents to plan a "
                    "renewal with the tenant.",
                ),
            ):
                if user is None:
                    continue
                if notify(
                    user=user,
                    kind="lease.expiring",
                    title=title,
                    body=body,
                    dedupe_key=f"lease.expiring:{lease.id}:{days}:{user.id}",
                    target_type="lease",
                    target_id=lease.id,
                ):
                    sent += 1
    return {"sent": sent}
