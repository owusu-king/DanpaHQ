"""Issuing, settling and voiding a Portfolio's subscription invoices.

The billing half of a subscription payment. `payments.services` owns the money —
provider, attempt, immutable transaction, ledger, receipt — and calls `settle`
from inside its own confirmation transaction, so "the invoice is paid" and "the
Portfolio is on the plan it paid for" commit together or not at all.

Nothing here talks to a provider, and nothing here can be reached from a browser
without the Payments Core having confirmed the money first.
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import Conflict

from .. import catalogue
from ..models import (
    LIVE_STATUSES,
    BillingEventType,
    BillingInvoice,
    InvoiceKind,
    InvoiceStatus,
    Subscription,
    SubscriptionStatus,
)
from . import periods
from .subscription_service import _write_event


def issue(
    *,
    account,
    subscription: Subscription,
    kind: str,
    plan,
    interval: str,
    list_price_minor: int,
    credit_minor: int,
    currency: str,
    user,
    now,
) -> BillingInvoice:
    """Price an invoice from server state and write it. The caller holds the lock."""
    invoice = BillingInvoice(
        billing_account=account,
        subscription=subscription,
        kind=kind,
        from_plan=subscription.plan,
        plan=plan,
        billing_interval=interval,
        issued_at=now,
        expires_at=now + timedelta(minutes=catalogue.INVOICE_TTL_MINUTES),
        issued_by=user,
    )
    # From the tail of the id, like receipt numbers: these are UUIDv7 and the
    # head is a clock reading, so two invoices in one millisecond would collide.
    invoice.number = f"RB-{now:%Y}-{invoice.id.hex[-12:].upper()}"
    invoice.list_price_minor = list_price_minor
    invoice.list_price_currency = currency
    invoice.credit_minor = credit_minor
    invoice.credit_currency = currency
    invoice.amount_minor = list_price_minor - credit_minor
    invoice.amount_currency = currency
    invoice.save()
    record(
        action=AuditAction.CREATE,
        aggregate_type="billing_invoice",
        aggregate_id=invoice.id,
        actor=user,
        metadata={
            "organization_id": str(account.organization_id),
            "number": invoice.number,
            "kind": kind,
            "from_plan": subscription.plan.code,
            "plan": plan.code,
            "billing_interval": interval,
            "list_price_minor": list_price_minor,
            "credit_minor": credit_minor,
            "amount_minor": invoice.amount_minor,
            "currency": currency,
        },
    )
    return invoice


def void(invoice: BillingInvoice, *, reason: str, actor=None) -> BillingInvoice:
    """Close an unpaid invoice. Its intents must already be closed by the caller."""
    invoice.status = InvoiceStatus.VOID
    invoice.voided_at = timezone.now()
    invoice.void_reason = reason[:40]
    invoice.save(update_fields=["status", "voided_at", "void_reason", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="billing_invoice",
        aggregate_id=invoice.id,
        actor=actor,
        changes={"status": [InvoiceStatus.OPEN, InvoiceStatus.VOID]},
        metadata={"reason": reason[:40]},
    )
    return invoice


def lock_payable(*, invoice_id, amount_minor: int, currency: str) -> BillingInvoice:
    """The invoice a confirmed payment is about to settle, locked, or a refusal.

    Refusals are `Conflict` on purpose: the Payments Core turns them into a
    failed webhook and the reconciliation sweep turns that into an exception a
    person must look at. Money that arrived for an invoice that no longer wants
    it is never silently applied and never silently dropped.
    """
    invoice = (
        BillingInvoice.objects.select_for_update(of=("self",))
        .select_related("plan", "from_plan", "billing_account")
        .filter(id=invoice_id)
        .first()
    )
    if invoice is None:
        raise Conflict("That invoice does not exist; reconcile this payment manually.")
    if invoice.status == InvoiceStatus.PAID:
        raise Conflict("That invoice was already paid; reconcile this payment manually.")
    if invoice.status != InvoiceStatus.OPEN:
        raise Conflict(
            "That checkout was replaced while this payment was pending; reconcile it manually."
        )
    if invoice.amount_minor != amount_minor or invoice.amount_currency != currency:
        raise Conflict("The payment does not match its invoice; reconcile it manually.")
    return invoice


def settle(*, invoice: BillingInvoice, paid_at, provider: str) -> BillingInvoice:
    """Mark a locked invoice paid and give the Portfolio what it bought.

    Runs inside the Payments Core's confirmation transaction. The subscription
    is re-read under lock and must still be the one the invoice was priced
    against, on the plan it was priced from: an administrative change that
    landed while the payer was approving the charge makes the price wrong, and a
    wrong price is reconciled by a person rather than applied by a sweep.
    """
    subscription = (
        Subscription.objects.select_for_update(of=("self",))
        .select_related("plan", "billing_account")
        .filter(id=invoice.subscription_id)
        .first()
    )
    if subscription is None or subscription.status not in LIVE_STATUSES:
        raise Conflict(
            "The subscription changed while this payment was pending; reconcile it manually."
        )
    if subscription.plan_id != invoice.from_plan_id:
        raise Conflict("The plan changed while this payment was pending; reconcile it manually.")

    previous_code = subscription.plan.code
    previous_status = subscription.status
    extends_paid_period = (
        invoice.kind == InvoiceKind.RENEWAL
        and previous_status == SubscriptionStatus.ACTIVE
        and subscription.current_period_end is not None
        and subscription.current_period_end > paid_at
    )
    if extends_paid_period:
        # Renewed early. The new period starts when the paid one ends, so
        # paying a week ahead never costs the week.
        start = subscription.current_period_end
    elif (
        invoice.kind == InvoiceKind.RENEWAL
        and previous_status == SubscriptionStatus.GRACE_PERIOD
        and subscription.current_period_start is not None
    ):
        # Renewed during grace. Grace is time the plan kept working, so the
        # period that was due is the period being paid for.
        start = subscription.current_period_start
    else:
        start = paid_at
    end = periods.period_end(start, invoice.billing_interval)

    subscription.plan = invoice.plan
    subscription.billing_interval = invoice.billing_interval
    subscription.status = SubscriptionStatus.ACTIVE
    if not extends_paid_period:
        subscription.current_period_start = start
    subscription.current_period_end = end
    subscription.provider = provider
    subscription.cancel_at_period_end = False
    subscription.scheduled_plan = None
    subscription.grace_expires_at = None
    subscription.cancelled_at = None
    subscription.save(
        update_fields=[
            "plan",
            "billing_interval",
            "status",
            "current_period_start",
            "current_period_end",
            "provider",
            "cancel_at_period_end",
            "scheduled_plan",
            "grace_expires_at",
            "cancelled_at",
            "updated_at",
        ]
    )

    invoice.status = InvoiceStatus.PAID
    invoice.paid_at = paid_at
    invoice.period_start = start
    invoice.period_end = end
    invoice.save(update_fields=["status", "paid_at", "period_start", "period_end", "updated_at"])

    _write_event(
        account=subscription.billing_account,
        subscription=subscription,
        event_type=(
            BillingEventType.RENEWED
            if invoice.kind == InvoiceKind.RENEWAL
            else BillingEventType.PLAN_CHANGED
        ),
        from_plan_code=previous_code,
        to_plan_code=invoice.plan.code,
        from_status=previous_status,
        to_status=SubscriptionStatus.ACTIVE,
        actor=invoice.issued_by,
        reason=f"Paid invoice {invoice.number}",
    )
    return invoice


def funding(subscription: Subscription | None) -> str:
    """How the plan a Portfolio is on is paid for.

    `paid` is a subscription with a paid period behind it — including one whose
    renewal is now due. `complimentary` is a paid plan with no paid period at
    all: an administrative grant, which has nothing to renew and must never be
    shown to the customer as a charge. `free` costs nothing.
    """
    if subscription is None:
        return "free"
    plan = subscription.plan
    if plan.monthly_price_minor <= 0 and not plan.annual_price_minor:
        return "free"
    return "paid" if subscription.current_period_end is not None else "complimentary"


def unused_paid_credit_minor(*, subscription: Subscription | None, now) -> int:
    """The value of paid time the Portfolio has not used yet, on its current plan.

    Summed over every paid invoice inside the current paid span — the period in
    progress and any period renewed early — so an upgrade credits exactly what
    was bought and not yet used. Only invoices for the plan the subscription is
    on count, and only from the start of the current span: an upgrade resets
    that start, so time already credited once cannot be credited again.
    """
    if subscription is None or subscription.status != SubscriptionStatus.ACTIVE:
        return 0
    if funding(subscription) != "paid" or subscription.current_period_start is None:
        return 0
    rows = BillingInvoice.objects.filter(
        subscription=subscription,
        plan_id=subscription.plan_id,
        status=InvoiceStatus.PAID,
        period_start__gte=subscription.current_period_start,
        period_end__gt=now,
    )
    return sum(
        periods.unused_credit_minor(
            list_price_minor=row.list_price_minor,
            period_start=row.period_start,
            period_end=row.period_end,
            now=now,
        )
        for row in rows
    )
