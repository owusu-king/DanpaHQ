"""What Danpa HQ asks a Portfolio to pay, priced by the server.

An invoice is the billing half of a subscription payment. It answers *why*
Danpa HQ is charging this Portfolio — which plan, which billing cycle, what
credit — and the Payments Core answers *how the money moved*: a `PaymentIntent`
settles it, and only a server-confirmed provider result marks it paid
(ADR 0032 §10). Nothing on an invoice is taken from a browser.

**Priced once, at issue.** The amount is copied from the plan row when the
invoice is issued, together with any credit for unused paid time, so a price
edited while a checkout is open never changes what the payer was shown.

**Paid and void are final.** A paid invoice is financial history and a void one
is the record that a checkout was abandoned or replaced. Neither is edited: the
model refuses it and so does the database.
"""

from __future__ import annotations

from django.db import models
from django.db.models import F, Q

from apps.core.fields import MoneyField
from apps.core.models import BaseModel

from .subscription import BillingInterval


class InvoiceStatus(models.TextChoices):
    OPEN = "open", "Open"
    PAID = "paid", "Paid"
    VOID = "void", "Void"


class InvoiceKind(models.TextChoices):
    #: Moving to a plan that costs more. A new paid period starts on payment.
    PLAN_CHANGE = "plan_change", "Plan change"
    #: Paying for the next period of the plan the Portfolio is already on.
    RENEWAL = "renewal", "Renewal"


FINAL_INVOICE_STATUSES = (InvoiceStatus.PAID, InvoiceStatus.VOID)


class BillingInvoice(BaseModel):
    billing_account = models.ForeignKey(
        "billing.BillingAccount", on_delete=models.PROTECT, related_name="invoices"
    )
    #: The live subscription this was issued against. Settlement refuses an
    #: invoice whose subscription has since been replaced or moved elsewhere.
    subscription = models.ForeignKey(
        "billing.Subscription", on_delete=models.PROTECT, related_name="invoices"
    )
    number = models.CharField(max_length=40, unique=True)
    kind = models.CharField(max_length=16, choices=InvoiceKind.choices)
    #: The plan the Portfolio was on when this was issued, and the plan it buys.
    #: Both are kept so a payment that lands after an administrative change can
    #: be recognised as stale instead of applied over it.
    from_plan = models.ForeignKey("billing.Plan", on_delete=models.PROTECT, related_name="+")
    plan = models.ForeignKey("billing.Plan", on_delete=models.PROTECT, related_name="+")
    billing_interval = models.CharField(max_length=12, choices=BillingInterval.choices)

    #: The plan's price for this interval at issue.
    list_price = MoneyField()
    #: Already-paid, unused time on the previous plan, taken off the list price.
    credit = MoneyField()
    #: What is charged. Always the list price less the credit, always positive.
    amount = MoneyField()

    status = models.CharField(
        max_length=8, choices=InvoiceStatus.choices, default=InvoiceStatus.OPEN
    )
    issued_at = models.DateTimeField()
    #: After this an open invoice cannot start a new payment; checkout reprices
    #: from current state instead. A payment already in flight still settles it.
    expires_at = models.DateTimeField()
    issued_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    #: The service period this paid for, fixed when the payment is confirmed.
    period_start = models.DateTimeField(null=True, blank=True)
    period_end = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    void_reason = models.CharField(max_length=40, blank=True)

    class Meta:
        db_table = "billing_invoice"
        ordering = ("-issued_at",)
        indexes = [
            models.Index(
                fields=["billing_account", "-issued_at"], name="billing_invoice_account_idx"
            )
        ]
        constraints = [
            # One checkout at a time per Portfolio. Two open invoices would be
            # two prices for one decision, and a payer could settle both.
            models.UniqueConstraint(
                fields=["billing_account"],
                condition=Q(status="open"),
                name="billing_one_open_invoice_per_account",
            ),
            models.CheckConstraint(
                condition=Q(amount_minor__gt=0), name="billing_invoice_amount_positive"
            ),
            models.CheckConstraint(
                condition=Q(credit_minor__gte=0), name="billing_invoice_credit_not_negative"
            ),
            models.CheckConstraint(
                condition=Q(list_price_minor=F("amount_minor") + F("credit_minor")),
                name="billing_invoice_amount_is_price_less_credit",
            ),
            models.CheckConstraint(
                condition=Q(amount_currency=F("list_price_currency"))
                & Q(credit_currency=F("list_price_currency")),
                name="billing_invoice_one_currency",
            ),
            models.CheckConstraint(
                condition=(
                    Q(status="open")
                    | Q(
                        status="paid",
                        paid_at__isnull=False,
                        period_start__isnull=False,
                        period_end__isnull=False,
                    )
                    | Q(status="void", voided_at__isnull=False)
                ),
                name="billing_invoice_status_has_its_facts",
            ),
        ]

    def __str__(self) -> str:
        return self.number

    def save(self, *args, **kwargs):
        if not self._state.adding:
            previous = (
                type(self).objects.filter(pk=self.pk).values_list("status", flat=True).first()
            )
            if previous in FINAL_INVOICE_STATUSES:
                raise RuntimeError(
                    "A paid or void invoice is final; issue another rather than editing it."
                )
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Invoices are financial history and cannot be deleted.")
