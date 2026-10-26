"""Rent: what is owed, what was paid, and who agrees it was.

This is the slice that answers the third failure the product was built around -
*once you have paid there is no record you can hold up later*.

Two decisions shape everything here:

**A payment is a claim until both sides agree it.** Either party can record one;
the other confirms or disputes it. A payment both parties have confirmed is the
receipt, and it is the thing a tenant can hold up eight months later. One party
asserting a payment alone is evidence of an assertion, no more, and the model
says which it is rather than blurring them.

**Nothing here moves money.** Rent in this market is paid in cash, by mobile
money, or into a bank account, and it will keep being paid that way long after
this platform exists. Recording those payments honestly is worth more than
pretending to collect them. Taking payment is Phase 5, and this module will not
change shape when it arrives - a provider will simply record here too.

The schedule is built the way Ghanaian tenancies actually work: a large amount
due at the start covering several months, then the next block when that runs
out. Monthly invoicing would be a foreign shape imposed on the market.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.core.fields import MoneyField
from apps.core.models import BaseModel


class ChargeKind(models.TextChoices):
    ADVANCE = "advance", "Advance rent"
    DEPOSIT = "deposit", "Refundable deposit"
    AGENCY_FEE = "agency_fee", "Agency fee"
    RENT = "rent", "Rent"


class ChargeStatus(models.TextChoices):
    DUE = "due", "Due"
    PART_PAID = "part_paid", "Partly paid"
    PAID = "paid", "Paid"
    WAIVED = "waived", "Waived"
    WRITTEN_OFF = "written_off", "Written off"
    ADJUSTED = "adjusted", "Resolved with adjustments"
    #: The period this charge covers is never going to happen: the tenancy
    #: ended before it, or a replacement agreement took over the term.
    #:
    #: Deliberately not `WAIVED`. Waiving is a provider deciding to forgive a
    #: debt that exists, and it belongs in the record as that decision. This is
    #: the opposite claim — that no debt was ever incurred, because nobody was
    #: living there to incur it.
    CANCELLED = "cancelled", "Cancelled — the tenancy ended"


class RentReminderStage(models.TextChoices):
    """The restrained reminder cadence defined by the payment architecture."""

    DUE_IN_7_DAYS = "due_in_7_days", "Due in 7 days"
    DUE_IN_3_DAYS = "due_in_3_days", "Due in 3 days"
    DUE_TOMORROW = "due_tomorrow", "Due tomorrow"
    DUE_TODAY = "due_today", "Due today"
    OVERDUE_1_DAY = "overdue_1_day", "1 day overdue"
    OVERDUE_3_DAYS = "overdue_3_days", "3 days overdue"
    OVERDUE_7_DAYS = "overdue_7_days", "7 days overdue"


class PaymentMethod(models.TextChoices):
    MOMO = "momo", "Mobile money"
    CASH = "cash", "Cash"
    BANK = "bank", "Bank transfer"
    CHEQUE = "cheque", "Cheque"
    OTHER = "other", "Other"


class PaymentStatus(models.TextChoices):
    #: Recorded by one side, not yet agreed by the other.
    CLAIMED = "claimed", "Recorded, awaiting confirmation"
    CONFIRMED = "confirmed", "Confirmed by both"
    DISPUTED = "disputed", "Disputed"


class PaymentVerificationSource(models.TextChoices):
    PARTY_CONFIRMATION = "party_confirmation", "Confirmed by both parties"
    PSP = "psp", "Confirmed server-side by payment provider"


class PaymentSource(models.TextChoices):
    PLATFORM_PSP = "PLATFORM_PSP", "Processed through Danpa HQ"
    EXTERNAL = "EXTERNAL", "Paid externally and recorded through Danpa HQ"


class PaymentEvidence(models.TextChoices):
    AWAITING_COUNTERPARTY_CONFIRMATION = (
        "AWAITING_COUNTERPARTY_CONFIRMATION",
        "Awaiting counterparty confirmation",
    )
    PSP_CONFIRMED = "PSP_CONFIRMED", "Confirmed by payment provider"
    COUNTERPARTY_CONFIRMED = "COUNTERPARTY_CONFIRMED", "Confirmed by counterparty"
    DISPUTED = "DISPUTED", "Disputed"
    ADMIN_VERIFIED = "ADMIN_VERIFIED", "Verified by Danpa HQ administration"


class ObligationAdjustmentKind(models.TextChoices):
    """Non-cash decisions that reduce what remains collectible."""

    WAIVER = "waiver", "Waiver"
    WRITE_OFF = "write_off", "Write-off"


class ExpenseCategory(models.TextChoices):
    MAINTENANCE = "maintenance", "Maintenance"
    UTILITIES = "utilities", "Utilities"
    STAFF = "staff", "Staff"
    TAX = "tax", "Tax or levy"
    SUPPLIES = "supplies", "Supplies"
    OTHER = "other", "Other"


class PropertyExpense(BaseModel):
    """An internal expense record. It records money; it does not transfer it."""

    organization = models.ForeignKey(
        "organization.Organization",
        on_delete=models.PROTECT,
        related_name="property_expenses",
    )
    property = models.ForeignKey(
        "property.Property",
        on_delete=models.PROTECT,
        related_name="expenses",
    )
    amount = MoneyField()
    category = models.CharField(
        max_length=20, choices=ExpenseCategory.choices, default=ExpenseCategory.OTHER
    )
    incurred_on = models.DateField()
    note = models.CharField(max_length=300, blank=True)
    recorded_by = models.ForeignKey(
        "identity.User",
        on_delete=models.PROTECT,
        related_name="property_expenses_recorded",
    )

    class Meta:
        db_table = "rent_property_expense"
        ordering = ("-incurred_on", "-created_at")
        indexes = [
            models.Index(fields=["organization", "-incurred_on"], name="expense_org_date_idx"),
            models.Index(fields=["property", "-incurred_on"], name="expense_property_idx"),
        ]


class RentCharge(BaseModel):
    """One amount owed, covering one period."""

    lease = models.ForeignKey("lease.Lease", on_delete=models.PROTECT, related_name="charges")
    kind = models.CharField(max_length=16, choices=ChargeKind.choices)

    amount = MoneyField()
    due_on = models.DateField()
    #: What the money buys. Null for a deposit or a fee, which buy no period.
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)

    status = models.CharField(max_length=16, choices=ChargeStatus.choices, default=ChargeStatus.DUE)
    #: Only ever the sum of confirmed payments. A claim does not settle a debt.
    amount_paid = MoneyField(null=True)
    settled_at = models.DateTimeField(null=True, blank=True)
    waived_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "rent_charge"
        ordering = ("due_on", "kind")
        indexes = [
            models.Index(fields=["lease", "due_on"], name="charge_lease_idx"),
            models.Index(
                fields=["due_on"],
                name="charge_outstanding_idx",
                condition=models.Q(status__in=["due", "part_paid"]),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind} of {self.amount_minor} due {self.due_on}"

    @property
    def outstanding_minor(self) -> int:
        if self.status == ChargeStatus.CANCELLED:
            return 0
        return max(
            (self.amount_minor or 0) - (self.amount_paid_minor or 0) - self.adjusted_minor,
            0,
        )

    def _adjustment_total(self, kind: str | None = None) -> int:
        cached = getattr(self, "_prefetched_objects_cache", {}).get("adjustments")
        rows = cached if cached is not None else self.adjustments.all()
        return sum(row.amount_minor or 0 for row in rows if kind is None or row.kind == kind)

    @property
    def adjusted_minor(self) -> int:
        return self._adjustment_total()

    @property
    def waived_minor(self) -> int:
        return self._adjustment_total(ObligationAdjustmentKind.WAIVER)

    @property
    def written_off_minor(self) -> int:
        return self._adjustment_total(ObligationAdjustmentKind.WRITE_OFF)

    @property
    def is_settled(self) -> bool:
        """Nothing further is expected on this charge.

        A cancelled charge counts, which is what keeps it out of `is_overdue`:
        a month nobody lived through cannot be late.
        """
        return self.status in (
            ChargeStatus.PAID,
            ChargeStatus.WAIVED,
            ChargeStatus.WRITTEN_OFF,
            ChargeStatus.ADJUSTED,
            ChargeStatus.CANCELLED,
        )

    @property
    def is_overdue(self) -> bool:
        """Computed, never stored.

        A stored "overdue" flag is only as true as the last time a job ran, and
        a tenant being told they are late when they are not is the kind of thing
        that loses trust permanently.
        """
        return not self.is_settled and self.due_on < timezone.now().date()

    @property
    def days_overdue(self) -> int:
        if not self.is_overdue:
            return 0
        return (timezone.now().date() - self.due_on).days

    @property
    def has_dispute(self) -> bool:
        return self.payments.filter(status=PaymentStatus.DISPUTED).exists()

    @property
    def effective_status(self) -> str:
        if self.has_dispute and self.outstanding_minor > 0:
            return "disputed"
        if self.is_overdue:
            return "overdue"
        return self.status


class ObligationAdjustment(BaseModel):
    """Immutable, non-cash evidence that part of an obligation was released.

    A waiver and a write-off are accounting decisions, not payments. Keeping
    them as additive records preserves the original charge and prevents either
    action from masquerading as money received.
    """

    obligation = models.ForeignKey(
        RentCharge,
        on_delete=models.PROTECT,
        related_name="adjustments",
    )
    kind = models.CharField(max_length=16, choices=ObligationAdjustmentKind.choices)
    amount = MoneyField()
    reason = models.CharField(max_length=300)
    actor = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="rent_obligation_adjustments",
    )
    effective_at = models.DateTimeField()

    class Meta:
        db_table = "rent_obligation_adjustment"
        ordering = ("effective_at", "created_at")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount_minor__gt=0),
                name="rent_obligation_adjustment_positive",
            )
        ]
        indexes = [
            models.Index(
                fields=["obligation", "effective_at"],
                name="rent_obligation_adjustment_idx",
            )
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Obligation adjustments are immutable; post another adjustment.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Obligation adjustments cannot be deleted.")


class RentReminder(BaseModel):
    """One durable reminder checkpoint for a lease's obligations due together.

    Several charges commonly fall due on move-in day. The reminder is grouped
    by lease and date so advance rent, deposit and agency fee produce one useful
    message rather than three notifications arriving together.
    """

    lease = models.ForeignKey(
        "lease.Lease", on_delete=models.PROTECT, related_name="rent_reminders"
    )
    due_on = models.DateField()
    stage = models.CharField(max_length=24, choices=RentReminderStage.choices)
    emitted_at = models.DateTimeField()

    class Meta:
        db_table = "rent_reminder"
        ordering = ("-emitted_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["lease", "due_on", "stage"],
                name="rent_reminder_checkpoint_unique",
            )
        ]
        indexes = [models.Index(fields=["lease", "-emitted_at"], name="rent_reminder_lease_idx")]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Rent reminders are immutable delivery evidence.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Rent reminders cannot be deleted.")


class RentPayment(BaseModel):
    """A payment one party says happened.

    Not a transfer. The money moved in cash, over mobile money, or through a
    bank; this is the record of it, and it is only worth anything once the other
    party agrees.
    """

    lease = models.ForeignKey("lease.Lease", on_delete=models.PROTECT, related_name="payments")
    charge = models.ForeignKey(
        RentCharge, null=True, blank=True, on_delete=models.PROTECT, related_name="payments"
    )

    amount = MoneyField()
    paid_on = models.DateField()
    method = models.CharField(max_length=16, choices=PaymentMethod.choices)
    #: The mobile money transaction id, the bank reference, the cheque number.
    #: What makes a claim checkable against something outside this platform.
    reference = models.CharField(max_length=120, blank=True)
    note = models.CharField(max_length=300, blank=True)
    evidence_file = models.ForeignKey(
        "files.StoredFile",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="rent_payment_evidence",
    )

    status = models.CharField(
        max_length=16, choices=PaymentStatus.choices, default=PaymentStatus.CLAIMED
    )
    #: Keeps an external/offline claim visibly distinct from a PSP-confirmed
    #: transaction. A server callback never impersonates the landlord's manual
    #: confirmation and a screenshot can never set this to PSP.
    verification_source = models.CharField(
        max_length=24,
        choices=PaymentVerificationSource.choices,
        default=PaymentVerificationSource.PARTY_CONFIRMATION,
    )
    recorded_by = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="payments_recorded"
    )
    confirmed_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payments_confirmed",
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    disputed_at = models.DateTimeField(null=True, blank=True)
    dispute_reason = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = "rent_payment"
        ordering = ("-paid_on", "-created_at")
        indexes = [
            models.Index(fields=["lease", "-paid_on"], name="payment_lease_idx"),
            models.Index(
                fields=["lease", "-created_at"],
                name="payment_unconfirmed_idx",
                condition=models.Q(status="claimed"),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.amount_minor} on {self.paid_on} ({self.status})"

    @property
    def is_confirmed(self) -> bool:
        return self.status == PaymentStatus.CONFIRMED

    @property
    def recorded_by_tenant(self) -> bool:
        return str(self.recorded_by_id) == str(self.lease.tenant_id)

    @property
    def payment_source(self) -> str:
        return (
            PaymentSource.PLATFORM_PSP
            if self.verification_source == PaymentVerificationSource.PSP
            else PaymentSource.EXTERNAL
        )

    @property
    def payment_provider(self) -> str:
        transaction = getattr(self, "provider_transaction", None)
        return transaction.provider.upper() if transaction else "NONE"

    @property
    def payment_channel(self) -> str:
        transaction = getattr(self, "provider_transaction", None)
        if transaction is not None:
            return {
                "mobile_money": "MOBILE_MONEY",
                "card": "CARD",
                "bank_transfer": "BANK_TRANSFER",
            }.get(transaction.payment_method, "OTHER")
        return {
            PaymentMethod.MOMO: "MOBILE_MONEY",
            PaymentMethod.BANK: "BANK_TRANSFER",
            PaymentMethod.CASH: "CASH",
        }.get(self.method, "OTHER")

    @property
    def payment_evidence(self) -> str:
        if self.verification_source == PaymentVerificationSource.PSP:
            return PaymentEvidence.PSP_CONFIRMED
        if self.status == PaymentStatus.CONFIRMED:
            return PaymentEvidence.COUNTERPARTY_CONFIRMED
        if self.status == PaymentStatus.DISPUTED:
            return PaymentEvidence.DISPUTED
        return PaymentEvidence.AWAITING_COUNTERPARTY_CONFIRMATION

    @property
    def lifecycle_status(self) -> str:
        if self.status == PaymentStatus.CLAIMED:
            return (
                "AWAITING_PROVIDER_CONFIRMATION"
                if self.recorded_by_tenant
                else "AWAITING_TENANT_CONFIRMATION"
            )
        return self.status.upper()
