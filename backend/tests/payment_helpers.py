from datetime import date


def confirm_initial_payment(lease):
    """Establish a paid tenancy through the real counterparty confirmation path."""
    from apps.rent import services

    for charge in lease.charges.filter(due_on=lease.starts_on):
        if charge.outstanding_minor:
            payment = services.record_payment(
                lease=lease,
                user=lease.tenant,
                data={
                    "charge_id": charge.id,
                    "amount_minor": charge.outstanding_minor,
                    "paid_on": date.today(),
                },
            )
            services.confirm_payment(payment=payment, user=lease.landlord)
    lease.refresh_from_db()
    return lease


def legacy_active_lease(lease):
    """Seed an already-active historical lease with debt, independent of new acceptance.

    These fixtures exercise collection and history for pre-existing tenancies.
    New acceptance and activation tests must use the payment-gated services.
    """
    from django.db import transaction
    from django.utils import timezone

    from apps.core.events import DomainEvent
    from apps.lease.models import Lease, LeaseStatus
    from apps.occupancy.services import ensure_for_lease
    from apps.outbox.services import emit

    assert lease.both_accepted
    with transaction.atomic():
        Lease.objects.filter(pk=lease.pk).update(
            status=LeaseStatus.ACTIVE, activated_at=timezone.now()
        )
        lease.refresh_from_db()
        ensure_for_lease(lease=lease, actor=lease.landlord)
        if lease.supersedes_id is not None:
            Lease.objects.filter(pk=lease.supersedes_id).update(
                status=LeaseStatus.SUPERSEDED, superseded_at=timezone.now()
            )
            emit(DomainEvent("lease.superseded.v1", "lease", str(lease.supersedes_id), {
                "superseded_by_lease_id": str(lease.id), "tenant_id": str(lease.tenant_id),
            }))
        emit(DomainEvent("lease.activated.v1", "lease", str(lease.id), {
            "tenant_id": str(lease.tenant_id), "landlord_id": str(lease.landlord_id),
            "unit_id": str(lease.unit_id),
        }))
    lease.refresh_from_db()
    return lease
