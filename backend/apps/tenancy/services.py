"""Opening, continuing and closing a tenancy.

The whole discipline here is that a tenancy is *found* before it is created.
Getting that backwards is what would make a renewal look like a new arrangement
and split three years of history in two.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import ValidationFailed

from .models import CURRENT_STATUSES, Tenancy, TenancyStatus


def live_tenancy(*, tenant, unit, bed=None) -> Tenancy | None:
    """The current relationship for this person and exact space, if any."""
    return Tenancy.objects.filter(
        tenant=tenant, unit=unit, bed=bed, status__in=CURRENT_STATUSES
    ).first()


@transaction.atomic
def ensure_tenancy(
    *, tenant, prop, unit, activation_lease, bed=None, starts_on=None, actor=None
) -> Tenancy:
    """Activate the relationship from its accepted lease.

    ``activation_lease`` is required rather than optional. This service is the
    only production route to an active/upcoming Tenancy, and the model check
    constraint independently rejects an active row without the same evidence.
    A pending legacy context is upgraded in place so its history survives.
    """
    from apps.lease.models import LeaseStatus

    if (
        activation_lease.status != LeaseStatus.ACTIVE
        or activation_lease.tenant_id != tenant.id
        or activation_lease.unit_id != unit.id
        or activation_lease.bed_id != (bed.id if bed else None)
        or unit.property_id != prop.id
    ):
        raise ValidationFailed(
            "An active lease for this tenant and exact rental space is required."
        )
    existing = live_tenancy(tenant=tenant, unit=unit, bed=bed)
    if existing is not None:
        update_fields = []
        if existing.activation_lease_id is None:
            existing.activation_lease = activation_lease
            update_fields.append("activation_lease")
        if starts_on and existing.started_on is None:
            existing.started_on = starts_on
            update_fields.append("started_on")
        status = _status_for(starts_on or existing.started_on)
        if existing.status == TenancyStatus.PENDING_LEASE or existing.status != status:
            existing.status = status
            update_fields.append("status")
        if update_fields:
            existing.save(update_fields=[*update_fields, "updated_at"])
        return existing

    tenancy = Tenancy.objects.create(
        tenant=tenant,
        property=prop,
        unit=unit,
        bed=bed,
        activation_lease=activation_lease,
        started_on=starts_on,
        status=_status_for(starts_on),
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="tenancy",
        aggregate_id=tenancy.id,
        actor=actor,
        metadata={
            "tenant_id": str(tenant.id),
            "unit_id": str(unit.id),
            "bed_id": str(bed.id) if bed else None,
            "activation_lease_id": str(activation_lease.id),
        },
    )
    return tenancy


def _status_for(starts_on) -> str:
    """Upcoming until the start date arrives, then active.

    A tenancy agreed in July to begin in September is a real arrangement in
    August - it is simply not one anybody is living in yet, and calling it
    active would misdescribe it on the tenant's own screen.
    """
    if starts_on is None:
        return TenancyStatus.ACTIVE
    return TenancyStatus.ACTIVE if starts_on <= timezone.now().date() else TenancyStatus.UPCOMING


@transaction.atomic
def end_tenancy(*, tenancy: Tenancy, actor=None, reason: str = "", ended_on=None) -> Tenancy:
    """Close the relationship. Ending is recorded, never deleted."""
    if tenancy.status == TenancyStatus.ENDED:
        return tenancy

    previous = tenancy.status
    tenancy.status = TenancyStatus.ENDED
    tenancy.ended_on = ended_on or timezone.now().date()
    tenancy.ended_reason = reason[:300]
    tenancy.save(update_fields=["status", "ended_on", "ended_reason", "updated_at"])

    # A space winding down above its Portfolio's plan allowance becomes
    # read-only once nothing is running in it.
    from apps.billing import enforcement as billing

    billing.rental_activity_ended(unit=tenancy.unit, actor=actor)

    record(
        action=AuditAction.UPDATE,
        aggregate_type="tenancy",
        aggregate_id=tenancy.id,
        actor=actor,
        changes={"status": [previous, TenancyStatus.ENDED]},
        metadata={"reason": reason},
    )
    return tenancy


def activate_due_tenancies() -> int:
    """Move upcoming tenancies to active once their start date has arrived.

    A scheduled job rather than a computed property because the status is read
    by constraints and filters, and a property cannot be indexed. Idempotent:
    running it twice changes nothing the second time.
    """
    today = timezone.now().date()
    return Tenancy.objects.filter(status=TenancyStatus.UPCOMING, started_on__lte=today).update(
        status=TenancyStatus.ACTIVE, updated_at=timezone.now()
    )
