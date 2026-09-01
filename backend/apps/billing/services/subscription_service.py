"""Creating and moving a Portfolio's subscription.

Phases 1 to 4 of the monetization plan: every Portfolio gets a billing account and a
Free subscription the moment it exists, and a plan can be moved between the
three codes. **Nothing here charges anybody.** Paid activation belongs to the
checkout slice that follows and must go through the existing Payments Core —
a `BillingInvoice` priced by the server, settled by a `PaymentIntent`, and a
subscription that becomes active only on server-confirmed payment. A plan may
not be activated because a client came back from a checkout page.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, ValidationFailed
from apps.outbox.services import emit

from ..models import (
    LIVE_STATUSES,
    BillingAccount,
    BillingEvent,
    BillingEventType,
    BillingInterval,
    Plan,
    Subscription,
    SubscriptionStatus,
)


@transaction.atomic
def ensure_billing_account(*, organization, billing_email: str = "") -> BillingAccount:
    """One billing account per Portfolio, created on demand and only once.

    `get_or_create` against a `OneToOneField`, so two concurrent callers produce
    one row and the loser sees the winner's.
    """
    account, _ = BillingAccount.objects.get_or_create(
        organization=organization,
        defaults={"billing_email": billing_email},
    )
    return account


@transaction.atomic
def ensure_free_subscription(*, organization, actor=None) -> Subscription:
    """Put a new Portfolio on Free, without asking anybody for a card.

    Idempotent: a Portfolio that already has a live subscription — Free or paid
    — keeps it. This is called from Portfolio creation and is safe to call again
    from a backfill or a repair.
    """
    account = ensure_billing_account(organization=organization)
    existing = (
        Subscription.objects.select_for_update()
        .filter(billing_account=account, status__in=LIVE_STATUSES)
        .first()
    )
    if existing is not None:
        return existing

    free = Plan.objects.get(code="FREE")
    subscription = Subscription.objects.create(
        billing_account=account,
        plan=free,
        status=SubscriptionStatus.ACTIVE,
        billing_interval=BillingInterval.MONTHLY,
        current_period_start=timezone.now(),
        # Free has no period end and no provider reference. Inventing either
        # would mean inventing a renewal that has nothing to renew.
        current_period_end=None,
    )
    _write_event(
        account=account,
        subscription=subscription,
        event_type=BillingEventType.SUBSCRIPTION_CREATED,
        to_plan_code=free.code,
        to_status=subscription.status,
        actor=actor,
        reason="Portfolio created",
    )
    return subscription


@transaction.atomic
def change_plan(
    *, organization, plan_code: str, actor, reason: str = "", management_actor=None
) -> Subscription:
    """Move a Portfolio between plans.

    **A downgrade never removes anything.** A Business Portfolio with 24
    properties that moves to Free keeps all 24: they stay readable, editable and
    lettable, and what changes is that a 25th cannot be created. Deleting a
    provider's properties because their card expired would be the single worst
    thing this system could do, so the code does not contain a path that could.

    Paid activation does not happen here. Moving *to* a paid plan through this
    function is for an administrative grant — the customer-facing route is
    checkout, and it activates on confirmed payment.
    """
    plan = Plan.objects.filter(code=plan_code).first()
    if plan is None or not plan.is_active:
        raise ValidationFailed("Choose one of Rooomly's plans.")

    account = ensure_billing_account(organization=organization)
    subscription = (
        Subscription.objects.select_for_update()
        .filter(billing_account=account, status__in=LIVE_STATUSES)
        .select_related("plan")
        .first()
    )
    if subscription is None:
        subscription = ensure_free_subscription(organization=organization, actor=actor)
        subscription = Subscription.objects.select_for_update().get(id=subscription.id)

    if subscription.plan.code == plan.code:
        return subscription

    previous_code = subscription.plan.code
    previous_status = subscription.status
    subscription.plan = plan
    subscription.status = SubscriptionStatus.ACTIVE
    subscription.cancel_at_period_end = False
    subscription.grace_expires_at = None
    if plan.code == "FREE":
        # Back to Free: no period to renew, and no provider reference to keep
        # pointing at a subscription nobody is paying.
        subscription.current_period_end = None
        subscription.provider = ""
        subscription.provider_subscription_reference = ""
    subscription.save(
        update_fields=[
            "plan",
            "status",
            "cancel_at_period_end",
            "grace_expires_at",
            "current_period_end",
            "provider",
            "provider_subscription_reference",
            "updated_at",
        ]
    )

    _write_event(
        account=account,
        subscription=subscription,
        event_type=BillingEventType.PLAN_CHANGED,
        from_plan_code=previous_code,
        to_plan_code=plan.code,
        from_status=previous_status,
        to_status=subscription.status,
        actor=actor,
        management_actor=management_actor,
        reason=reason,
    )
    return subscription


@transaction.atomic
def cancel(*, organization, actor, at_period_end: bool = True, reason: str = "") -> Subscription:
    """Stop the subscription renewing, or end it now.

    Cancelling at period end is the default and the honest one: the Portfolio
    paid for this month and keeps it. Ending immediately drops to Free, which
    still removes nothing.
    """
    account = ensure_billing_account(organization=organization)
    subscription = (
        Subscription.objects.select_for_update()
        .filter(billing_account=account, status__in=LIVE_STATUSES)
        .select_related("plan")
        .first()
    )
    if subscription is None:
        raise Conflict("This Portfolio has no subscription to cancel.")
    if subscription.plan.code == "FREE":
        raise Conflict("Free does not renew, so there is nothing to cancel.")

    if at_period_end:
        subscription.cancel_at_period_end = True
        subscription.save(update_fields=["cancel_at_period_end", "updated_at"])
        _write_event(
            account=account,
            subscription=subscription,
            event_type=BillingEventType.CANCELLED,
            from_plan_code=subscription.plan.code,
            to_plan_code=subscription.plan.code,
            from_status=subscription.status,
            to_status=subscription.status,
            actor=actor,
            reason=reason or "Cancelled at period end",
        )
        return subscription

    return change_plan(
        organization=organization,
        plan_code="FREE",
        actor=actor,
        reason=reason or "Cancelled immediately",
    )


def _write_event(
    *,
    account: BillingAccount,
    subscription: Subscription | None,
    event_type: str,
    to_plan_code: str = "",
    from_plan_code: str = "",
    to_status: str = "",
    from_status: str = "",
    actor=None,
    management_actor=None,
    reason: str = "",
) -> BillingEvent:
    """Both histories, in one transaction.

    `BillingEvent` is billing's own queryable timeline; `audit.record` is the
    platform's tamper-evident actor trail. Neither is derived from the other —
    see the model docstring for why that is deliberate rather than duplication.
    """
    event = BillingEvent.objects.create(
        billing_account=account,
        subscription=subscription,
        event_type=event_type,
        from_plan_code=from_plan_code,
        to_plan_code=to_plan_code,
        from_status=from_status,
        to_status=to_status,
        actor=actor,
        # A staff member acting on a customer's plan is a different act from the
        # customer doing it, and the trail has to be able to tell them apart.
        actor_management_id=getattr(management_actor, "id", None),
        reason=reason[:300],
        occurred_at=timezone.now(),
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="billing_subscription",
        aggregate_id=subscription.id if subscription else account.id,
        actor=actor,
        management_actor=management_actor,
        changes={
            "plan": [from_plan_code, to_plan_code],
            "status": [from_status, to_status],
        },
        metadata={
            "organization_id": str(account.organization_id),
            "event_type": event_type,
            "reason": reason[:300],
        },
    )
    emit(
        DomainEvent(
            "billing.subscription_changed.v1",
            "billing_subscription",
            str(subscription.id) if subscription else str(account.id),
            {
                "organization_id": str(account.organization_id),
                "event_type": event_type,
                "to_plan_code": to_plan_code,
            },
        )
    )
    return event
