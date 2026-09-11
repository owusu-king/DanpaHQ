"""What happens to a paid subscription when its period ends.

Rooomly subscriptions are prepaid. A Portfolio pays for a month or a year —
mobile money has no card on file to charge again — and when that period ends one
of three things is true:

1. It chose to leave: it moves to Free (`cancel_at_period_end`).
2. It chose a cheaper plan: it moves to that plan, whose next period is now due.
3. Otherwise the next period of its plan is due.

A period that is due and unpaid enters **grace**, and grace still grants the
plan (ADR 0032 §9): a renewal a person has not got round to yet has not taken
away what they bought. When grace runs out the subscription is **past due** and
Free's limits apply. Nothing is removed: what is above Free's allowance is
restricted instead (`resource_access_service`), and renewing makes it eligible
to be reactivated.

Scheduled rather than triggered, because the event it reacts to is time passing.
Each subscription moves in its own transaction under its own lock, and every
transition is written to the billing timeline and the audit log.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .. import catalogue
from ..models import BillingEventType, Subscription, SubscriptionStatus
from . import periods, resource_access_service, subscription_service
from .subscription_service import _write_event


def advance_subscriptions(*, now=None, limit: int = 200) -> dict[str, int]:
    now = now or timezone.now()
    counts = {"moved_to_free": 0, "plan_changed": 0, "entered_grace": 0, "past_due": 0}

    due = Subscription.objects.filter(
        status=SubscriptionStatus.ACTIVE,
        current_period_end__isnull=False,
        current_period_end__lte=now,
    ).values_list("id", flat=True)[:limit]
    for subscription_id in list(due):
        for outcome in _close_period(subscription_id=subscription_id, now=now):
            counts[outcome] += 1

    lapsed = Subscription.objects.filter(
        status=SubscriptionStatus.GRACE_PERIOD,
        grace_expires_at__isnull=False,
        grace_expires_at__lte=now,
    ).values_list("id", flat=True)[:limit]
    for subscription_id in list(lapsed):
        if _end_grace(subscription_id=subscription_id, now=now):
            counts["past_due"] += 1
    return counts


@transaction.atomic
def _close_period(*, subscription_id, now) -> list[str]:
    subscription = (
        Subscription.objects.select_for_update(of=("self",))
        .select_related("plan", "scheduled_plan", "billing_account__organization")
        .filter(id=subscription_id)
        .first()
    )
    # Re-checked under the lock: a renewal confirmed a moment ago has already
    # moved the period on, and must not be sent into grace behind its back.
    if (
        subscription is None
        or subscription.status != SubscriptionStatus.ACTIVE
        or subscription.current_period_end is None
        or subscription.current_period_end > now
    ):
        return []

    if subscription.cancel_at_period_end:
        # `change_plan` restricts what is above Free's allowance, keeping what
        # the Portfolio chose to keep when it cancelled.
        subscription_service.change_plan(
            organization=subscription.billing_account.organization,
            plan_code="FREE",
            actor=None,
            reason="Moved to Free when the paid period ended",
        )
        return ["moved_to_free"]

    outcomes = []
    ended_at = subscription.current_period_end
    account = subscription.billing_account

    if subscription.scheduled_plan_id:
        previous_code = subscription.plan.code
        subscription.plan = subscription.scheduled_plan
        subscription.scheduled_plan = None
        subscription.save(update_fields=["plan", "scheduled_plan", "updated_at"])
        _write_event(
            account=account,
            subscription=subscription,
            event_type=BillingEventType.PLAN_CHANGED,
            from_plan_code=previous_code,
            to_plan_code=subscription.plan.code,
            from_status=subscription.status,
            to_status=subscription.status,
            reason="Scheduled change applied when the paid period ended",
        )
        outcomes.append("plan_changed")

    # The next period is now the one owed. Recording it here is what lets a
    # renewal during grace pay for the time grace already covered.
    subscription.status = SubscriptionStatus.GRACE_PERIOD
    subscription.current_period_start = ended_at
    subscription.current_period_end = periods.period_end(ended_at, subscription.billing_interval)
    subscription.grace_expires_at = ended_at + timedelta(days=catalogue.GRACE_DAYS)
    subscription.save(
        update_fields=[
            "status",
            "current_period_start",
            "current_period_end",
            "grace_expires_at",
            "updated_at",
        ]
    )
    _write_event(
        account=account,
        subscription=subscription,
        event_type=BillingEventType.ENTERED_GRACE,
        from_plan_code=subscription.plan.code,
        to_plan_code=subscription.plan.code,
        from_status=SubscriptionStatus.ACTIVE,
        to_status=SubscriptionStatus.GRACE_PERIOD,
        reason="Paid period ended without a renewal",
    )
    outcomes.append("entered_grace")

    if "plan_changed" in outcomes:
        # Grace grants the plan the Portfolio moved to, so its limits are the
        # ones in force from here — including what was chosen to keep.
        resource_access_service.reconcile(organization=account.organization, now=now)
    return outcomes


@transaction.atomic
def _end_grace(*, subscription_id, now) -> bool:
    subscription = (
        Subscription.objects.select_for_update(of=("self",))
        .select_related("plan", "billing_account__organization")
        .filter(id=subscription_id)
        .first()
    )
    if (
        subscription is None
        or subscription.status != SubscriptionStatus.GRACE_PERIOD
        or subscription.grace_expires_at is None
        or subscription.grace_expires_at > now
    ):
        return False
    subscription.status = SubscriptionStatus.PAST_DUE
    subscription.save(update_fields=["status", "updated_at"])
    _write_event(
        account=subscription.billing_account,
        subscription=subscription,
        event_type=BillingEventType.PAST_DUE,
        from_plan_code=subscription.plan.code,
        to_plan_code=subscription.plan.code,
        from_status=SubscriptionStatus.GRACE_PERIOD,
        to_status=SubscriptionStatus.PAST_DUE,
        reason="Grace ended without a renewal",
    )
    # Past due no longer grants the plan, so Free's limits are in force: what is
    # above them is restricted, never removed, until a renewal and a deliberate
    # reactivation bring it back.
    resource_access_service.reconcile(
        organization=subscription.billing_account.organization, now=now
    )
    return True
