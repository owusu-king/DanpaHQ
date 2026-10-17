"""Changing a Portfolio's plan from the customer side.

Two different acts share one entry point, because to the person choosing a plan
they are one decision.

**Paying for more.** An upgrade or a renewal issues a server-priced
`BillingInvoice` and settles it through the existing Payments Core — the same
provider adapter, webhook, attempt, immutable transaction, ledger and receipt
that rent uses. The plan moves only when the provider's result is confirmed
server-side (ADR 0032 §10). A browser returning from checkout is a prompt to
ask, never proof, and a failed payment leaves the subscription exactly as it
was.

**Paying for less.** A downgrade takes no money. Part-way through a paid period
the Portfolio keeps what it paid for and moves when the period ends; otherwise
it moves now. Either way nothing is deleted (ADR 0032 §8), and the quote names
every limit the Portfolio would sit above before anybody confirms.

Every mutation here is owner/admin only, and every refusal is a sentence a
person can act on.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone

from apps.core.exceptions import Conflict, NotFound, ProviderUnavailable, ValidationFailed

from .. import catalogue
from ..models import (
    LIVE_STATUSES,
    BillingAccount,
    BillingAccountStatus,
    BillingEventType,
    BillingInterval,
    BillingInvoice,
    InvoiceKind,
    InvoiceStatus,
    Plan,
    Subscription,
    SubscriptionStatus,
)
from ..policies import entitlement_policy
from . import entitlement_service, invoice_service, periods, subscription_service
from .subscription_service import _write_event

UPGRADE = "upgrade"
DOWNGRADE = "downgrade"
RENEWAL = "renewal"
CURRENT = "current"


@dataclass(frozen=True, slots=True)
class Quote:
    """What a plan change would do, priced and dated by the server."""

    direction: str
    plan: Plan
    current_plan: Plan
    interval: str
    currency: str
    list_price_minor: int = 0
    credit_minor: int = 0
    amount_minor: int = 0
    #: "on_payment" for anything paid, "period_end" or "now" for a downgrade.
    effective: str = "now"
    effective_at: datetime | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    over_limit: list = field(default_factory=list)
    #: For a downgrade: what would stay fully active, and what may be chosen.
    resource_choice: dict | None = None
    blocked_code: str = ""
    blocked_reason: str = ""

    @property
    def requires_payment(self) -> bool:
        return self.direction in (UPGRADE, RENEWAL)

    @property
    def invoice_kind(self) -> str:
        return InvoiceKind.RENEWAL if self.direction == RENEWAL else InvoiceKind.PLAN_CHANGE


# --- reading -------------------------------------------------------------------


def live_subscription(*, organization, lock: bool = False) -> Subscription | None:
    rows = Subscription.objects.filter(
        billing_account__organization=organization, status__in=LIVE_STATUSES
    ).select_related("plan", "scheduled_plan", "billing_account")
    if lock:
        rows = rows.select_for_update(of=("self",))
    return rows.first()


def open_checkout(*, account):
    """The open invoice and the payment live at the provider for it, if any.

    "Live" means it reached the provider and its window has not closed. An
    attempt that never reached a provider, or whose window has passed, holds
    nothing up: it is released whenever a new decision needs the slot.
    """
    from apps.payments.models import OPEN_INTENT_STATUSES, PaymentIntent

    if account is None:
        return None, None
    invoice = (
        BillingInvoice.objects.filter(billing_account=account, status=InvoiceStatus.OPEN)
        .select_related("plan", "from_plan", "billing_account")
        .first()
    )
    if invoice is None:
        return None, None
    intent = (
        PaymentIntent.objects.filter(
            billing_invoice=invoice,
            status__in=OPEN_INTENT_STATUSES,
            expires_at__gt=timezone.now(),
        )
        .exclude(provider_reference="")
        .select_related("billing_invoice__plan", "billing_invoice__from_plan")
        .order_by("-created_at")
        .first()
    )
    return invoice, intent


def renewal_open(subscription: Subscription | None, now) -> bool:
    """Whether the next period of the current plan may be paid for now."""
    if subscription is None or invoice_service.funding(subscription) != "paid":
        return False
    if subscription.cancel_at_period_end or subscription.scheduled_plan_id:
        return False
    if subscription.status in (SubscriptionStatus.GRACE_PERIOD, SubscriptionStatus.PAST_DUE):
        return True
    return (
        subscription.status == SubscriptionStatus.ACTIVE
        and subscription.current_period_end is not None
        and subscription.current_period_end - now <= timedelta(days=catalogue.RENEWAL_WINDOW_DAYS)
    )


def quote(*, organization, plan_code: str, interval: str, now=None) -> Quote:
    """Price and date a move to `plan_code` without changing anything."""
    now = now or timezone.now()
    if interval not in BillingInterval.values:
        raise ValidationFailed("Choose monthly or annual billing.")
    subscription = live_subscription(organization=organization)
    current = subscription.plan if subscription is not None else Plan.objects.get(code="FREE")
    plan = Plan.objects.filter(code=str(plan_code or "").strip().upper(), is_active=True).first()
    if plan is None or (not plan.is_public and plan.id != current.id):
        raise ValidationFailed("Choose one of Danpa HQ's plans.")

    common = {
        "plan": plan,
        "current_plan": current,
        "interval": interval,
        "currency": plan.monthly_price_currency,
    }
    list_price = _price(plan, interval)

    if plan.id == current.id:
        if not renewal_open(subscription, now):
            return Quote(
                direction=CURRENT,
                list_price_minor=list_price or 0,
                blocked_code="current_plan",
                blocked_reason=f"{plan.name} is already this Portfolio's plan.",
                **common,
            )
        direction = RENEWAL
    elif _rank(plan) > _rank(current):
        direction = UPGRADE
    else:
        direction = DOWNGRADE

    over = entitlement_service.projected_over_limit(organization=organization, plan=plan)
    account = (
        subscription.billing_account
        if subscription is not None
        else BillingAccount.objects.filter(organization=organization).first()
    )

    if direction == DOWNGRADE:
        paid_period = (
            subscription is not None
            and subscription.status == SubscriptionStatus.ACTIVE
            and invoice_service.funding(subscription) == "paid"
            and subscription.current_period_end is not None
            and subscription.current_period_end > now
        )
        from . import resource_access_service

        _, live = open_checkout(account=account)
        return Quote(
            direction=DOWNGRADE,
            list_price_minor=list_price or 0,
            effective="period_end" if paid_period else "now",
            effective_at=subscription.current_period_end if paid_period else now,
            over_limit=over,
            resource_choice=resource_access_service.downgrade_choice(
                organization=organization, plan=plan
            ),
            blocked_code="checkout_in_progress" if live is not None else "",
            blocked_reason=(
                "Finish or cancel the payment in progress before changing plan."
                if live is not None
                else ""
            ),
            **common,
        )

    if list_price is None or list_price <= 0:
        return Quote(
            direction=direction,
            over_limit=over,
            blocked_code="interval_not_offered",
            blocked_reason=f"{_interval_label(interval)} billing isn't offered for {plan.name}.",
            **common,
        )

    credit = (
        invoice_service.unused_paid_credit_minor(subscription=subscription, now=now)
        if direction == UPGRADE
        else 0
    )
    start = _renewal_start(subscription, now) if direction == RENEWAL else now
    blocked_code = blocked_reason = ""
    if list_price - credit <= 0:
        blocked_code = "credit_exceeds_price"
        blocked_reason = (
            f"Your unused {current.name} time is worth more than this. Choose annual "
            "billing, or change plan when your current period ends."
        )
    elif account is not None and account.status == BillingAccountStatus.CLOSED:
        blocked_code = "billing_closed"
        blocked_reason = "Billing for this Portfolio is closed."

    return Quote(
        direction=direction,
        list_price_minor=list_price,
        credit_minor=min(credit, list_price),
        amount_minor=max(list_price - credit, 0),
        effective="on_payment",
        period_start=start,
        period_end=periods.period_end(start, interval),
        over_limit=over,
        blocked_code=blocked_code,
        blocked_reason=blocked_reason,
        **common,
    )


def checkout_intent(*, organization, intent_id):
    """One subscription payment belonging to this Portfolio, or 404."""
    from apps.payments.models import PaymentIntent, PaymentPurpose

    intent = (
        PaymentIntent.objects.select_related(
            "billing_invoice__plan",
            "billing_invoice__from_plan",
            "billing_invoice__billing_account",
        )
        .filter(
            id=intent_id,
            purpose=PaymentPurpose.SUBSCRIPTION_INVOICE,
            billing_invoice__billing_account__organization=organization,
        )
        .first()
    )
    if intent is None:
        raise NotFound("We could not find that payment.")
    return intent


# --- paying for more ----------------------------------------------------------


def start_checkout(*, organization, user, plan_code: str, interval: str, payment_method: str):
    """Issue — or reuse — the invoice for a paid change, and open its payment.

    Idempotent on its durable anchors, which is what makes it safe behind
    `idempotent_mutation(external_calls=True)`: an unexpired invoice for the same
    change is reused rather than issued twice, and the Payments Core resumes the
    open intent for that invoice rather than creating a second.
    """
    from apps.payments import services as payment_services
    from apps.payments.models import DigitalPaymentMethod
    from apps.payments.providers import get_payment_provider

    entitlement_policy.assert_can(
        organization=organization, user=user, permission=entitlement_policy.CHANGE_PLAN
    )
    if payment_method not in DigitalPaymentMethod.values:
        raise ValidationFailed("Choose mobile money, card or bank transfer.")
    # Before anything is written: no rail means no invoice and no attempt.
    get_payment_provider().ensure_available()
    invoice = _prepare_invoice(
        organization=organization, user=user, plan_code=plan_code, interval=interval
    )
    return payment_services.create_invoice_intent(
        invoice=invoice, user=user, payment_method=payment_method
    )


@transaction.atomic
def _prepare_invoice(*, organization, user, plan_code: str, interval: str) -> BillingInvoice:
    from apps.payments import services as payment_services

    now = timezone.now()
    account = subscription_service.ensure_billing_account(organization=organization)
    # The account row is the lock for "one checkout decision at a time".
    account = BillingAccount.objects.select_for_update().get(id=account.id)
    subscription = live_subscription(organization=organization, lock=True)
    if subscription is None:
        subscription_service.ensure_free_subscription(organization=organization, actor=user)
        subscription = live_subscription(organization=organization, lock=True)

    offer = quote(organization=organization, plan_code=plan_code, interval=interval, now=now)
    if offer.blocked_reason:
        raise Conflict(offer.blocked_reason, details={"reason": offer.blocked_code})
    if not offer.requires_payment:
        raise Conflict(
            "Moving to a plan that costs less does not need a payment.",
            details={"reason": "no_payment_needed"},
        )

    existing = (
        BillingInvoice.objects.select_for_update(of=("self",))
        .filter(billing_account=account, status=InvoiceStatus.OPEN)
        .first()
    )
    if existing is not None:
        if (
            existing.subscription_id == subscription.id
            and existing.from_plan_id == subscription.plan_id
            and existing.plan_id == offer.plan.id
            and existing.billing_interval == offer.interval
            and existing.kind == offer.invoice_kind
            and existing.expires_at > now
        ):
            return existing
        # A different decision replaces the open one — unless its payment is
        # live at the provider, in which case this raises and the payer is told
        # to finish or cancel it. Two open checkouts could both be paid.
        payment_services.release_invoice_intents(invoice_id=existing.id)
        invoice_service.void(
            existing, reason="expired" if existing.expires_at <= now else "superseded", actor=user
        )

    return invoice_service.issue(
        account=account,
        subscription=subscription,
        kind=offer.invoice_kind,
        plan=offer.plan,
        interval=offer.interval,
        list_price_minor=offer.list_price_minor,
        credit_minor=offer.credit_minor,
        currency=offer.currency,
        user=user,
        now=now,
    )


def lock_invoice_for_new_payment(*, invoice_id, user) -> BillingInvoice:
    """The invoice a new payment attempt is about to open against, locked."""
    invoice = (
        BillingInvoice.objects.select_for_update(of=("self",))
        .select_related("plan", "billing_account__organization")
        .filter(id=invoice_id)
        .first()
    )
    if invoice is None:
        raise NotFound("We could not find that checkout.")
    entitlement_policy.assert_can(
        organization=invoice.billing_account.organization,
        user=user,
        permission=entitlement_policy.CHANGE_PLAN,
    )
    assert_open_for_new_attempt(invoice)
    return invoice


def assert_open_for_new_attempt(invoice: BillingInvoice) -> None:
    if invoice.status != InvoiceStatus.OPEN:
        raise Conflict(
            "This checkout is no longer open. Start again from Change plan.",
            details={"reason": "checkout_closed"},
        )
    if invoice.expires_at <= timezone.now():
        raise Conflict(
            "This checkout has expired. Start again from Change plan.",
            details={"reason": "checkout_expired"},
        )


def assert_may_pay(*, intent, user) -> None:
    """Only a Portfolio owner or administrator acts on its subscription payments."""
    entitlement_policy.assert_can(
        organization=intent.billing_invoice.billing_account.organization,
        user=user,
        permission=entitlement_policy.CHANGE_PLAN,
    )


def refresh_checkout(*, organization, user, intent_id):
    """Ask the provider what happened, and apply it through the one boundary."""
    from apps.payments import services as payment_services
    from apps.payments.models import OPEN_INTENT_STATUSES

    entitlement_policy.assert_can(
        organization=organization, user=user, permission=entitlement_policy.CHANGE_PLAN
    )
    intent = checkout_intent(organization=organization, intent_id=intent_id)
    if intent.status in OPEN_INTENT_STATUSES and intent.provider_reference:
        # A provider that cannot answer right now is not a payment decision. The
        # signed webhook and the reconciliation sweep both still will; the payer
        # sees the state Danpa HQ already holds rather than an error about
        # somebody else's outage.
        with contextlib.suppress(ProviderUnavailable):
            payment_services.refresh_intent_from_provider(intent=intent, user=user)
    return checkout_intent(organization=organization, intent_id=intent_id)


def retry_checkout(*, organization, user, intent_id):
    from apps.payments import services as payment_services

    entitlement_policy.assert_can(
        organization=organization, user=user, permission=entitlement_policy.CHANGE_PLAN
    )
    intent = checkout_intent(organization=organization, intent_id=intent_id)
    payment_services.retry_intent(intent=intent, user=user)
    return checkout_intent(organization=organization, intent_id=intent_id)


def cancel_checkout(*, organization, user, intent_id):
    """Stop an unpaid checkout, once the provider agrees nothing was taken."""
    from apps.payments import services as payment_services
    from apps.payments.models import IntentStatus

    entitlement_policy.assert_can(
        organization=organization, user=user, permission=entitlement_policy.CHANGE_PLAN
    )
    intent = checkout_intent(organization=organization, intent_id=intent_id)
    intent = payment_services.cancel_invoice_intent(intent=intent, user=user)
    if intent.status == IntentStatus.CANCELLED:
        _void_if_abandoned(invoice_id=intent.billing_invoice_id, actor=user)
    return checkout_intent(organization=organization, intent_id=intent_id)


@transaction.atomic
def _void_if_abandoned(*, invoice_id, actor) -> None:
    from apps.payments.models import OPEN_INTENT_STATUSES, PaymentIntent

    invoice = BillingInvoice.objects.select_for_update().filter(id=invoice_id).first()
    if invoice is None or invoice.status != InvoiceStatus.OPEN:
        return
    if PaymentIntent.objects.filter(
        billing_invoice=invoice, status__in=OPEN_INTENT_STATUSES
    ).exists():
        return
    invoice_service.void(invoice, reason="cancelled", actor=actor)


# --- paying for less ----------------------------------------------------------


@transaction.atomic
def change_plan_without_payment(
    *, organization, user, plan_code: str, keep_active: dict | None = None
) -> Subscription:
    """Move to a cheaper plan: at the end of a paid period, or now if none.

    `keep_active` names the properties and units to keep fully active if the
    move takes the Portfolio above the cheaper plan's allowance. Without it the
    documented fallback decides — the client never does.
    """
    from apps.payments import services as payment_services

    from . import resource_access_service

    entitlement_policy.assert_can(
        organization=organization, user=user, permission=entitlement_policy.CHANGE_PLAN
    )
    account = subscription_service.ensure_billing_account(organization=organization)
    account = BillingAccount.objects.select_for_update().get(id=account.id)
    subscription = live_subscription(organization=organization, lock=True)
    if subscription is None:
        subscription_service.ensure_free_subscription(organization=organization, actor=user)
        subscription = live_subscription(organization=organization, lock=True)

    offer = quote(
        organization=organization, plan_code=plan_code, interval=subscription.billing_interval
    )
    if offer.direction != DOWNGRADE:
        raise Conflict(
            "Moving to a plan that costs more goes through checkout.",
            details={"reason": "payment_required"},
        )
    if offer.blocked_reason:
        raise Conflict(offer.blocked_reason, details={"reason": offer.blocked_code})

    # Saved before the move, so the move applies it — now, or when the paid
    # period ends. Refused whole if it asks for more than the plan includes.
    resource_access_service.save_choice(
        organization=organization, user=user, plan=offer.plan, keep_active=keep_active
    )

    existing = (
        BillingInvoice.objects.select_for_update(of=("self",))
        .filter(billing_account=account, status=InvoiceStatus.OPEN)
        .first()
    )
    if existing is not None:
        payment_services.release_invoice_intents(invoice_id=existing.id)
        invoice_service.void(existing, reason="superseded", actor=user)

    if offer.effective == "now":
        return subscription_service.change_plan(
            organization=organization,
            plan_code=offer.plan.code,
            actor=user,
            reason="Changed by the Portfolio",
        )

    # Part-way through a paid period: keep what was paid for, move at its end.
    if offer.plan.code == "FREE":
        subscription.cancel_at_period_end = True
        subscription.scheduled_plan = None
        event_type = BillingEventType.CANCELLED
    else:
        subscription.cancel_at_period_end = False
        subscription.scheduled_plan = offer.plan
        event_type = BillingEventType.CHANGE_SCHEDULED
    subscription.save(update_fields=["cancel_at_period_end", "scheduled_plan", "updated_at"])
    _write_event(
        account=account,
        subscription=subscription,
        event_type=event_type,
        from_plan_code=subscription.plan.code,
        to_plan_code=offer.plan.code,
        from_status=subscription.status,
        to_status=subscription.status,
        actor=user,
        reason="Scheduled for the end of the paid period",
    )
    return subscription


@transaction.atomic
def keep_current_plan(*, organization, user) -> Subscription | None:
    """Undo a scheduled downgrade or cancellation before the period ends."""
    entitlement_policy.assert_can(
        organization=organization, user=user, permission=entitlement_policy.CHANGE_PLAN
    )
    subscription = live_subscription(organization=organization, lock=True)
    if subscription is None or not (
        subscription.cancel_at_period_end or subscription.scheduled_plan_id
    ):
        return subscription
    target = "FREE" if subscription.cancel_at_period_end else subscription.scheduled_plan.code
    subscription.cancel_at_period_end = False
    subscription.scheduled_plan = None
    subscription.save(update_fields=["cancel_at_period_end", "scheduled_plan", "updated_at"])
    # What was chosen to keep active belonged to the change that is now off.
    from . import resource_access_service

    resource_access_service.clear_choice(organization=organization)
    _write_event(
        account=subscription.billing_account,
        subscription=subscription,
        event_type=BillingEventType.SCHEDULED_CHANGE_CANCELLED,
        from_plan_code=subscription.plan.code,
        to_plan_code=target,
        from_status=subscription.status,
        to_status=subscription.status,
        actor=user,
        reason="Kept the current plan",
    )
    return subscription


# --- what the provider workspace reads ------------------------------------------


def overview(*, organization, user) -> dict:
    """The viewer- and payment-specific half of the Plan & billing read."""
    from apps.payments.models import DigitalPaymentMethod
    from apps.payments.providers import get_payment_provider

    can_change = entitlement_policy.can(
        organization=organization, user=user, permission=entitlement_policy.CHANGE_PLAN
    )
    can_view_invoices = entitlement_policy.can(
        organization=organization, user=user, permission=entitlement_policy.VIEW_INVOICES
    )
    now = timezone.now()
    subscription = live_subscription(organization=organization)
    account = BillingAccount.objects.filter(organization=organization).first()

    try:
        provider = get_payment_provider()
        provider.ensure_available()
        rail = {"available": True, "methods": list(DigitalPaymentMethod.values)}
    except ProviderUnavailable:
        rail = {"available": False, "methods": []}

    _, live = open_checkout(account=account) if can_change else (None, None)
    return {
        "viewer": {"can_change_plan": can_change, "can_view_invoices": can_view_invoices},
        "checkout": {**rail, "open": checkout_payload(live) if live is not None else None},
        "renewal": {"available": can_change and renewal_open(subscription, now)},
        "invoices": invoice_rows(account=account) if can_view_invoices else [],
    }


def invoice_rows(*, account, limit: int = 12) -> list[dict]:
    """Invoices with what happened to their payment, newest first.

    Only invoices that meant something to the payer: paid ones, and unpaid ones
    whose payment reached the provider and is pending or failed. A checkout
    somebody opened and walked away from before paying is not a billing record.
    """
    from apps.payments.models import IntentStatus, PaymentIntent, TransactionStatus

    if account is None:
        return []
    invoices = list(
        BillingInvoice.objects.filter(billing_account=account)
        .select_related("plan")
        .order_by("-issued_at")[:50]
    )
    attempts: dict = {}
    for intent in (
        PaymentIntent.objects.filter(billing_invoice__in=invoices)
        .exclude(provider_reference="")
        .order_by("-created_at")
    ):
        attempts.setdefault(intent.billing_invoice_id, []).append(intent)

    rows = []
    for invoice in invoices:
        tries = attempts.get(invoice.id, [])
        latest = tries[0] if tries else None
        if invoice.status == InvoiceStatus.PAID:
            paid = next((row for row in tries if row.status == IntentStatus.SUCCEEDED), latest)
            transaction_row = (
                paid.transactions.filter(status=TransactionStatus.SUCCEEDED)
                .select_related("receipt")
                .first()
                if paid is not None
                else None
            )
            receipt = getattr(transaction_row, "receipt", None) if transaction_row else None
            payment = {
                "status": IntentStatus.SUCCEEDED,
                "method": paid.payment_method if paid else "",
                "occurred_at": _iso(invoice.paid_at),
                "failure_message": "",
                "receipt_id": str(receipt.id) if receipt else None,
            }
        elif latest is not None and latest.status in (
            IntentStatus.PENDING,
            IntentStatus.PROCESSING,
            IntentStatus.FAILED,
        ):
            payment = {
                "status": latest.status,
                "method": latest.payment_method,
                "occurred_at": _iso(latest.updated_at),
                "failure_message": latest.failure_message,
                "receipt_id": None,
            }
        else:
            continue
        rows.append({**invoice_payload(invoice), "payment": payment})
        if len(rows) >= limit:
            break
    return rows


def plan_ref(plan: Plan | None) -> dict | None:
    return {"code": plan.code, "name": plan.name} if plan is not None else None


def invoice_payload(invoice: BillingInvoice) -> dict:
    return {
        "id": str(invoice.id),
        "number": invoice.number,
        "kind": invoice.kind,
        "status": invoice.status,
        "plan": plan_ref(invoice.plan),
        "billing_interval": invoice.billing_interval,
        "list_price_minor": invoice.list_price_minor,
        "credit_minor": invoice.credit_minor,
        "amount_minor": invoice.amount_minor,
        "currency": invoice.amount_currency,
        "issued_at": _iso(invoice.issued_at),
        "expires_at": _iso(invoice.expires_at),
        "paid_at": _iso(invoice.paid_at),
        "period_start": _iso(invoice.period_start),
        "period_end": _iso(invoice.period_end),
    }


def checkout_payload(intent) -> dict:
    from apps.payments.models import OPEN_INTENT_STATUSES, IntentStatus, TransactionStatus

    receipt_id = None
    if intent.status == IntentStatus.SUCCEEDED:
        transaction_row = (
            intent.transactions.filter(status=TransactionStatus.SUCCEEDED)
            .select_related("receipt")
            .first()
        )
        receipt = getattr(transaction_row, "receipt", None) if transaction_row else None
        receipt_id = str(receipt.id) if receipt else None
    return {
        "id": str(intent.id),
        "status": intent.status,
        "payment_method": intent.payment_method,
        "provider": intent.provider,
        "amount_minor": intent.amount_minor,
        "currency": intent.amount_currency,
        "expires_at": _iso(intent.expires_at),
        "failure_code": intent.failure_code,
        "failure_message": intent.failure_message,
        # Only an open attempt can be continued; a finished one hands back
        # nothing a client could mistake for a way to pay again.
        "next_action": intent.next_action if intent.status in OPEN_INTENT_STATUSES else {},
        "receipt_id": receipt_id,
        "invoice": invoice_payload(intent.billing_invoice),
    }


def quote_payload(offer: Quote) -> dict:
    return {
        "direction": offer.direction,
        "plan": plan_ref(offer.plan),
        "current_plan": plan_ref(offer.current_plan),
        "billing_interval": offer.interval,
        "currency": offer.currency,
        "list_price_minor": offer.list_price_minor,
        "credit_minor": offer.credit_minor,
        "amount_minor": offer.amount_minor,
        "requires_payment": offer.requires_payment,
        "effective": offer.effective,
        "effective_at": _iso(offer.effective_at),
        "period_start": _iso(offer.period_start),
        "period_end": _iso(offer.period_end),
        "over_limit": offer.over_limit,
        "resource_choice": offer.resource_choice,
        "blocked": (
            {"code": offer.blocked_code, "message": offer.blocked_reason}
            if offer.blocked_reason
            else None
        ),
    }


# --- helpers ------------------------------------------------------------------


def _price(plan: Plan, interval: str) -> int | None:
    if interval == BillingInterval.ANNUAL:
        return plan.annual_price_minor
    return plan.monthly_price_minor


def _rank(plan: Plan) -> int:
    try:
        return catalogue.UPGRADE_ORDER.index(plan.code)
    except ValueError:
        return -1


def _interval_label(interval: str) -> str:
    return "Annual" if interval == BillingInterval.ANNUAL else "Monthly"


def _renewal_start(subscription: Subscription, now):
    """Where a renewal's period begins — the same rule `invoice_service.settle` applies."""
    if (
        subscription.status == SubscriptionStatus.ACTIVE
        and subscription.current_period_end is not None
        and subscription.current_period_end > now
    ):
        return subscription.current_period_end
    if (
        subscription.status == SubscriptionStatus.GRACE_PERIOD
        and subscription.current_period_start is not None
    ):
        return subscription.current_period_start
    return now


def _iso(value):
    return value.isoformat() if value else None
