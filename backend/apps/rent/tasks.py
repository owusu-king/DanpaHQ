"""Scheduled, deduplicated reminders for authoritative rent obligations.

Automated reminders are a paid capability. This module names the capability,
never a plan: which plans include `AUTOMATED_RENT_REMINDERS` is a row in the
billing catalogue, and moving it is a data change rather than an edit here.

The gate is on the *scheduled* reminder only. Nothing else a tenant depends on
is affected: receipts, payment confirmations, lease notices and the rent ledger
itself are unconditional, and a tenant can always see what they owe.
"""

from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from apps.billing import catalogue
from apps.billing import enforcement as billing
from apps.core.events import DomainEvent
from apps.outbox.services import emit

from .models import ChargeStatus, RentCharge, RentReminder, RentReminderStage

REMINDER_STAGE_BY_DAYS = {
    7: RentReminderStage.DUE_IN_7_DAYS,
    3: RentReminderStage.DUE_IN_3_DAYS,
    1: RentReminderStage.DUE_TOMORROW,
    0: RentReminderStage.DUE_TODAY,
    -1: RentReminderStage.OVERDUE_1_DAY,
    -3: RentReminderStage.OVERDUE_3_DAYS,
    -7: RentReminderStage.OVERDUE_7_DAYS,
}


@shared_task(name="rent.emit_due_reminders")
def emit_due_reminders() -> dict[str, int]:
    """Emit each lease/date checkpoint once, even when several charges share it.

    A reminder is written in the same transaction as its outbox event. Repeated
    beat runs, worker retries, and two workers racing therefore cannot produce a
    second notification for the same checkpoint.
    """

    today = timezone.localdate()
    due_dates = [today + timedelta(days=days) for days in REMINDER_STAGE_BY_DAYS]
    groups = list(
        RentCharge.objects.filter(
            lease__status="active",
            status__in=(ChargeStatus.DUE, ChargeStatus.PART_PAID),
            due_on__in=due_dates,
        )
        # `order_by()` before `distinct()` is load-bearing. `Meta.ordering` is
        # ("due_on", "kind"), and Django adds ordering columns to the SELECT for
        # a DISTINCT — so a checkpoint with rent, deposit, advance and agency
        # charges came back four times and was processed four times. The
        # get_or_create made that harmless but not free: four transactions and
        # four row locks for one reminder.
        .order_by()
        .values_list("lease_id", "due_on")
        .distinct()
    )
    entitled = _leases_entitled_to_reminders({lease_id for lease_id, _ in groups})

    emitted = 0
    unentitled = 0
    for lease_id, due_on in groups:
        stage = REMINDER_STAGE_BY_DAYS.get((due_on - today).days)
        if stage is None:
            continue
        if lease_id not in entitled:
            # No reminder row is written, deliberately. Recording that a
            # checkpoint was skipped would make it un-emittable the day the
            # Portfolio upgrades, and an upgrade should start working now
            # rather than at the next checkpoint.
            unentitled += 1
            continue
        with transaction.atomic():
            # The lease is the group lock. It serializes two scheduled workers
            # without coupling reminder identity to whichever charge is first.
            from apps.lease.models import Lease

            lease = Lease.objects.select_for_update().filter(id=lease_id, status="active").first()
            if lease is None:
                continue
            open_charges = RentCharge.objects.select_for_update().filter(
                lease=lease,
                due_on=due_on,
                status__in=(ChargeStatus.DUE, ChargeStatus.PART_PAID),
            )
            if not any(charge.outstanding_minor > 0 for charge in open_charges):
                continue
            reminder, created = RentReminder.objects.get_or_create(
                lease=lease,
                due_on=due_on,
                stage=stage,
                defaults={"emitted_at": timezone.now()},
            )
            if not created:
                continue
            emit(
                DomainEvent(
                    "rent.payment_reminder.v1",
                    "rent_reminder",
                    str(reminder.id),
                    {"stage": stage},
                )
            )
            emitted += 1
    return {"emitted": emitted, "unentitled": unentitled}


def _leases_entitled_to_reminders(lease_ids: set) -> set:
    """Which of these leases sit under a Portfolio that includes reminders.

    Resolved once per Portfolio rather than once per lease: a beat run touches
    many leases and few Portfolios, and the entitlement answer is identical for
    every lease under one of them.

    A property held by no Portfolio resolves to no entitlement, which is the
    same answer the entitlement service gives a Portfolio with no subscription.
    An automated reminder is something a Portfolio buys, and a property outside
    every Portfolio has nobody to have bought it.
    """
    if not lease_ids:
        return set()

    from apps.lease.models import Lease
    from apps.organization.models import Organization

    rows = set(
        Lease.objects.filter(
            id__in=lease_ids,
            unit__property__organization_relationships__ended_at__isnull=True,
        )
        .values_list("id", "unit__property__organization_relationships__organization_id")
        .distinct()
    )
    if not rows:
        return set()

    allowed = {
        organization.id
        for organization in Organization.objects.filter(
            id__in={organization_id for _, organization_id in rows}
        )
        if billing.has_feature(organization=organization, key=catalogue.AUTOMATED_RENT_REMINDERS)
    }
    return {lease_id for lease_id, organization_id in rows if organization_id in allowed}
