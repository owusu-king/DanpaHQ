"""Immutable financial records around licensed-provider payment attempts."""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.core.fields import MoneyField
from apps.core.models import BaseModel


class IntentStatus(models.TextChoices):
    CREATED = "created", "Created"
    PENDING = "pending", "Waiting for payment"
    PROCESSING = "processing", "Confirmation in progress"
    SUCCEEDED = "succeeded", "Paid"
    FAILED = "failed", "Failed"
    EXPIRED = "expired", "Expired"
    CANCELLED = "cancelled", "Cancelled"


OPEN_INTENT_STATUSES = (IntentStatus.CREATED, IntentStatus.PENDING, IntentStatus.PROCESSING)


class DigitalPaymentMethod(models.TextChoices):
    MOBILE_MONEY = "mobile_money", "Mobile Money"
    CARD = "card", "Card"
    BANK_TRANSFER = "bank_transfer", "Bank transfer"


class TransactionStatus(models.TextChoices):
    SUCCEEDED = "succeeded", "Succeeded"
    FAILED = "failed", "Failed"
    REVERSED = "reversed", "Reversed"


class LedgerDirection(models.TextChoices):
    DEBIT = "debit", "Debit"
    CREDIT = "credit", "Credit"


class SettlementStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    PROCESSING = "processing", "Processing"
    SETTLED = "settled", "Settled"
    FAILED = "failed", "Failed"
    REVERSED = "reversed", "Reversed"


class AttemptStatus(models.TextChoices):
    STARTED = "started", "Started"
    PENDING = "pending", "Waiting for the payer"
    SUCCEEDED = "succeeded", "Succeeded"
    FAILED = "failed", "Failed"
    TIMED_OUT = "timed_out", "Timed out"
    ABANDONED = "abandoned", "Abandoned"


OPEN_ATTEMPT_STATUSES = (AttemptStatus.STARTED, AttemptStatus.PENDING)


class PayoutMethod(models.TextChoices):
    MOBILE_MONEY = "mobile_money", "Mobile Money"
    BANK = "bank", "Bank account"


class PayoutProfileStatus(models.TextChoices):
    UNVERIFIED = "unverified", "Not yet verified"
    VERIFIED = "verified", "Verified with the provider"
    REJECTED = "rejected", "Rejected by the provider"
    DISABLED = "disabled", "Disabled"


class PayoutProvisioningStatus(models.TextChoices):
    PENDING = "pending", "Creating with provider"
    NEEDS_RECONCILIATION = "needs_reconciliation", "Checking with provider"
    SUCCEEDED = "succeeded", "Destination created"
    FAILED = "failed", "Provider refused destination"


class ProviderFeeBearer(models.TextChoices):
    PLATFORM = "account", "Rooomly"
    SUBACCOUNT = "subaccount", "Provider"


class RefundStatus(models.TextChoices):
    REQUESTED = "requested", "Requested"
    APPROVED = "approved", "Approved"
    PROCESSING = "processing", "Processing"
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"
    REJECTED = "rejected", "Rejected"


class ReconciliationKind(models.TextChoices):
    """Every way Rooomly's record and the provider's can disagree.

    Named for what is actually wrong rather than for severity, because the
    recovery differs per kind and a single "mismatch" bucket would need
    re-diagnosing every time somebody opened one.
    """

    PROVIDER_SUCCEEDED_INTERNAL_PENDING = (
        "provider_succeeded_internal_pending",
        "Provider says paid, Rooomly says pending",
    )
    PROVIDER_SUCCEEDED_INTERNAL_FAILED = (
        "provider_succeeded_internal_failed",
        "Provider says paid, Rooomly says failed",
    )
    INTERNAL_SUCCEEDED_PROVIDER_MISSING = (
        "internal_succeeded_provider_missing",
        "Rooomly says paid, provider has no record",
    )
    AMOUNT_MISMATCH = "amount_mismatch", "Amounts disagree"
    CURRENCY_MISMATCH = "currency_mismatch", "Currencies disagree"
    DUPLICATE_PROVIDER_TRANSACTION = (
        "duplicate_provider_transaction",
        "One provider transaction seen twice",
    )
    MISSING_SETTLEMENT = "missing_settlement", "Settled payment with no settlement record"
    SETTLEMENT_AMOUNT_MISMATCH = "settlement_amount_mismatch", "Settlement amount disagrees"
    REVERSAL = "reversal", "Provider reversed a confirmed payment"
    REFUND_DISCREPANCY = "refund_discrepancy", "Refund records disagree"
    UNALLOCATED_TRANSACTION = (
        "unallocated_transaction",
        "Confirmed money not allocated to an obligation",
    )
    UNMATCHED_PROVIDER_EVENT = (
        "unmatched_provider_event",
        "Authenticated provider evidence Rooomly could not apply",
    )


class ReconciliationStatus(models.TextChoices):
    OPEN = "open", "Open"
    INVESTIGATING = "investigating", "Being investigated"
    RESOLVED = "resolved", "Resolved"
    ACCEPTED = "accepted", "Accepted as expected"


OPEN_EXCEPTION_STATUSES = (ReconciliationStatus.OPEN, ReconciliationStatus.INVESTIGATING)


class WebhookStatus(models.TextChoices):
    RECEIVED = "received", "Received"
    PROCESSED = "processed", "Processed"
    REJECTED = "rejected", "Rejected"
    FAILED = "failed", "Failed"
    #: Authenticated, well-formed, and about something else entirely — an
    #: account-level transfer or dispute event. Kept as evidence that it
    #: arrived and was deliberately not acted on.
    IGNORED = "ignored", "Ignored"


class PaymentPurpose(models.TextChoices):
    """What an intent settles. The rail is shared; the business reason is not.

    Rent and a Rooomly subscription move through one payment implementation —
    the same provider adapter, webhook, attempt, transaction, ledger and receipt
    boundary — but they are different obligations with different owners: a
    `RentCharge` a tenant owes a Portfolio, and a `BillingInvoice` a Portfolio
    owes Rooomly. Nothing about one may be inferred from the other, which is why
    every branch in `services` asks this field rather than guessing from which
    foreign key happens to be set.
    """

    RENT_OBLIGATION = "rent_obligation", "Rent obligation"
    SUBSCRIPTION_INVOICE = "subscription_invoice", "Rooomly subscription"


class PaymentIntent(BaseModel):
    """One server-priced attempt to settle one authoritative obligation.

    A rent intent settles an outstanding `RentCharge` for its tenant; a
    subscription intent settles one `BillingInvoice` for the Portfolio that owes
    it. The model keeps the attempt separate from the resulting transaction:
    pending and failed work is financial history too and must not disappear.
    """

    purpose = models.CharField(
        max_length=24, choices=PaymentPurpose.choices, default=PaymentPurpose.RENT_OBLIGATION
    )
    tenant = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="payment_intents",
    )
    lease = models.ForeignKey(
        "lease.Lease",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="payment_intents",
    )
    obligation = models.ForeignKey(
        "rent.RentCharge",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="payment_intents",
    )
    #: The invoice a subscription payment settles. Never set for rent.
    billing_invoice = models.ForeignKey(
        "billing.BillingInvoice",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="payment_intents",
    )
    #: The owner or administrator who started a subscription payment. The
    #: Portfolio owes the invoice; this is the person who acted on it.
    initiated_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )
    amount = MoneyField()
    status = models.CharField(
        max_length=16, choices=IntentStatus.choices, default=IntentStatus.CREATED
    )
    payment_method = models.CharField(max_length=20, choices=DigitalPaymentMethod.choices)
    provider = models.CharField(max_length=40)
    client_reference = models.CharField(max_length=80, unique=True)
    provider_reference = models.CharField(max_length=120, blank=True)
    expires_at = models.DateTimeField(db_index=True)
    failure_code = models.CharField(max_length=80, blank=True)
    failure_message = models.CharField(max_length=300, blank=True)
    next_action = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    # Payout routing is snapshotted before checkout. Changing a Portfolio's
    # destination later must not redirect a payment already in flight.
    beneficiary_organization = models.ForeignKey(
        "organization.Organization",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="payment_intents",
    )
    payout_profile = models.ForeignKey(
        "payments.PayoutProfile",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="payment_intents",
    )
    provider_subaccount_reference = models.CharField(max_length=180, blank=True)
    provider_subaccount_id = models.CharField(max_length=80, blank=True)
    platform_charge_minor = models.PositiveBigIntegerField(default=0)
    provider_fee_bearer = models.CharField(
        max_length=16, choices=ProviderFeeBearer.choices, blank=True
    )

    class Meta:
        db_table = "payments_intent"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["tenant", "-created_at"], name="pay_intent_tenant_idx"),
            models.Index(fields=["provider", "provider_reference"], name="pay_intent_provider_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["obligation"],
                condition=models.Q(status__in=OPEN_INTENT_STATUSES),
                name="payments_one_open_intent_per_obligation",
            ),
            models.UniqueConstraint(
                fields=["billing_invoice"],
                condition=models.Q(status__in=OPEN_INTENT_STATUSES),
                name="payments_one_open_intent_per_invoice",
            ),
            # Exactly one kind of obligation, and exactly the fields it needs.
            # A rent intent with an invoice, or a subscription intent that names
            # a tenant, is a row that two confirmation paths could both claim.
            models.CheckConstraint(
                condition=(
                    models.Q(
                        purpose="rent_obligation",
                        tenant__isnull=False,
                        lease__isnull=False,
                        obligation__isnull=False,
                        billing_invoice__isnull=True,
                    )
                    | models.Q(
                        purpose="subscription_invoice",
                        billing_invoice__isnull=False,
                        initiated_by__isnull=False,
                        tenant__isnull=True,
                        lease__isnull=True,
                        obligation__isnull=True,
                    )
                ),
                name="payments_intent_settles_one_kind_of_obligation",
            ),
        ]

    @property
    def is_expired(self) -> bool:
        return self.expires_at <= timezone.now()

    @property
    def is_subscription(self) -> bool:
        return self.purpose == PaymentPurpose.SUBSCRIPTION_INVOICE

    @property
    def payer_id(self):
        """The person this attempt belongs to, whatever it settles."""
        return self.initiated_by_id if self.is_subscription else self.tenant_id


class PaymentTransaction(BaseModel):
    """A provider-side result. A success is never edited into a failure.

    **Many per intent, at most one of them successful.** It was one-to-one, and
    that quietly made the architecture's own retry story impossible: a failed
    attempt wrote a transaction, and the successful retry then had nowhere to
    go. Failure is financial history too — a provider's record that a payment
    was declined is exactly what a person disputing a charge needs — so the
    failures stay, and the constraint below carries the property that actually
    matters.
    """

    intent = models.ForeignKey(PaymentIntent, on_delete=models.PROTECT, related_name="transactions")
    rent_record = models.OneToOneField(
        "rent.RentPayment",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="provider_transaction",
    )
    provider = models.CharField(max_length=40)
    provider_transaction_id = models.CharField(max_length=120)
    amount = MoneyField()
    payment_method = models.CharField(max_length=20, choices=DigitalPaymentMethod.choices)
    status = models.CharField(max_length=16, choices=TransactionStatus.choices)
    paid_at = models.DateTimeField(null=True, blank=True)
    failure_code = models.CharField(max_length=80, blank=True)
    failure_message = models.CharField(max_length=300, blank=True)
    raw_provider_status = models.CharField(max_length=80, blank=True)

    class Meta:
        db_table = "payments_transaction"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "provider_transaction_id"],
                name="payments_provider_transaction_unique",
            ),
            # The one that stops an obligation being paid twice. Enforced here
            # rather than in a service, so it holds against a replayed webhook,
            # a racing worker, or code that forgets to ask.
            models.UniqueConstraint(
                fields=["intent"],
                condition=models.Q(status="succeeded"),
                name="payments_one_successful_transaction_per_intent",
            ),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Payment transactions are immutable; record a reversal separately.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Payment transactions cannot be deleted.")


class LedgerEntry(BaseModel):
    """One immutable line in the non-custodial payment subledger."""

    transaction = models.ForeignKey(
        PaymentTransaction, on_delete=models.PROTECT, related_name="ledger_entries"
    )
    line_number = models.PositiveSmallIntegerField()
    account_reference = models.CharField(max_length=160)
    direction = models.CharField(max_length=8, choices=LedgerDirection.choices)
    amount = MoneyField()
    description = models.CharField(max_length=240)
    occurred_at = models.DateTimeField()
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "payments_ledger_entry"
        ordering = ("transaction", "line_number")
        constraints = [
            models.UniqueConstraint(
                fields=["transaction", "line_number"], name="payments_ledger_line_unique"
            )
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Ledger entries are immutable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Ledger entries cannot be deleted.")


class Receipt(BaseModel):
    transaction = models.OneToOneField(
        PaymentTransaction,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="receipt",
    )
    rent_record = models.OneToOneField(
        "rent.RentPayment",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="external_receipt",
    )
    receipt_number = models.CharField(max_length=40, unique=True)
    issued_at = models.DateTimeField()
    breakdown = models.JSONField()
    # Frozen at issue time, alongside the structured snapshot. A later PDF
    # renderer or design change must not alter the document a tenant received.
    final_pdf = models.BinaryField(null=True, blank=True, editable=False)
    final_pdf_hash = models.CharField(max_length=64, blank=True, editable=False)

    class Meta:
        db_table = "payments_receipt"
        ordering = ("-issued_at",)
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(transaction__isnull=False, rent_record__isnull=True)
                    | models.Q(transaction__isnull=True, rent_record__isnull=False)
                ),
                name="payments_receipt_exactly_one_source",
            )
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Receipts are immutable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Receipts cannot be deleted.")


class Settlement(BaseModel):
    """Provider-reported movement to the beneficiary; pending is not settled."""

    transaction = models.OneToOneField(
        PaymentTransaction, on_delete=models.PROTECT, related_name="settlement"
    )
    beneficiary = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="payment_settlements"
    )
    # New settlements point at the Portfolio that owns the provider subaccount.
    # `beneficiary` remains the signing person for historical rows and display.
    beneficiary_organization = models.ForeignKey(
        "organization.Organization",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="payment_settlements",
    )
    payout_profile = models.ForeignKey(
        "payments.PayoutProfile",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="settlements",
    )
    provider_subaccount_reference = models.CharField(max_length=180, blank=True)
    provider_subaccount_id = models.CharField(max_length=80, blank=True)
    provider = models.CharField(max_length=40)
    provider_settlement_reference = models.CharField(max_length=120, blank=True)
    gross_amount = MoneyField()
    fee_amount = MoneyField()
    net_amount = MoneyField()
    status = models.CharField(
        max_length=16, choices=SettlementStatus.choices, default=SettlementStatus.PENDING
    )
    expected_at = models.DateTimeField(null=True, blank=True)
    settled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "payments_settlement"
        ordering = ("-created_at",)


class ProviderWebhook(BaseModel):
    """Webhook receipt metadata. Raw sensitive payloads are deliberately omitted."""

    provider = models.CharField(max_length=40)
    event_id = models.CharField(max_length=160)
    event_type = models.CharField(max_length=80, blank=True)
    payload_hash = models.CharField(max_length=64)
    signature_valid = models.BooleanField(default=False)
    status = models.CharField(
        max_length=16, choices=WebhookStatus.choices, default=WebhookStatus.RECEIVED
    )
    processed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.CharField(max_length=500, blank=True)

    class Meta:
        db_table = "payments_provider_webhook"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "event_id"], name="payments_provider_event_unique"
            )
        ]


class PaymentAttempt(BaseModel):
    """One try at paying an intent. Several may belong to one intent.

    The intent is *what somebody is paying*; an attempt is *one go at it*. They
    were the same thing while a transaction hung off the intent one-to-one,
    which meant a person who timed out, failed, then succeeded left three
    intents and no record that they had been trying to settle one charge.

    Kept separate from `PaymentTransaction` deliberately. A transaction is a
    provider-side financial fact and is immutable; an attempt is Rooomly's own
    record of a try, including the tries that produced no transaction at all —
    a timeout, or a person who closed the app at the PIN prompt. Those are the
    ones worth having, and they are exactly the ones a provider never tells us
    about.
    """

    intent = models.ForeignKey(PaymentIntent, on_delete=models.PROTECT, related_name="attempts")
    #: 1, 2, 3 within the intent. Ordering by time would be ambiguous under
    #: concurrent retries; the number is the sequence the person experienced.
    sequence = models.PositiveSmallIntegerField()
    provider = models.CharField(max_length=40)
    #: Copied from the intent so a late callback can be traced to the try it
    #: belongs to. Deliberately *not* unique per attempt: `client_reference` is
    #: the outbound idempotency key, and a provider given the same key returns
    #: the same reference — which is the behaviour that makes a retry safe.
    provider_reference = models.CharField(max_length=120, blank=True)
    payment_method = models.CharField(max_length=20, choices=DigitalPaymentMethod.choices)
    status = models.CharField(
        max_length=16, choices=AttemptStatus.choices, default=AttemptStatus.STARTED
    )
    failure_code = models.CharField(max_length=80, blank=True)
    failure_message = models.CharField(max_length=300, blank=True)
    started_at = models.DateTimeField()
    concluded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "payments_attempt"
        ordering = ("intent", "sequence")
        constraints = [
            models.UniqueConstraint(
                fields=["intent", "sequence"], name="payments_attempt_sequence_unique"
            ),
            # An intent is settled once. Two successful attempts against one
            # obligation is the duplicate-rent-payment failure this exists to
            # make impossible, so it is refused by the database rather than by
            # whichever service happens to look.
            models.UniqueConstraint(
                fields=["intent"],
                condition=models.Q(status=AttemptStatus.SUCCEEDED),
                name="payments_one_successful_attempt_per_intent",
            ),
        ]


class PaymentAllocation(BaseModel):
    """Which obligation a confirmed payment actually satisfies, and by how much.

    Before this, the link was implied: an intent named one obligation, so the
    money must have been for that. Implied is not the same as recorded, and it
    cannot express the three things this product will need — one payment across
    two obligations, a part payment, or money that arrived and has not been
    applied yet.

    Allocation is what makes *provider-confirmed* money answerable for a
    specific charge. It is not, today, the arithmetic that settles one: a
    `RentCharge`'s `amount_paid_minor` is recomputed by `rent._resettle` from
    its confirmed `RentPayment` rows, because an off-platform cash payment has
    no transaction to allocate from and must still settle the debt.

    Both records are written in the same transaction for a PSP payment and are
    expected to agree; `reconciliation.sweep_unallocated_transactions` exists
    precisely to notice when they do not. Making allocation the sole authority
    means giving external payments a synthetic transaction to hang off, which
    is a deliberate design question and not a refactor — see the payment
    checkpoint's open decisions.
    """

    transaction = models.ForeignKey(
        PaymentTransaction, on_delete=models.PROTECT, related_name="allocations"
    )
    obligation = models.ForeignKey(
        "rent.RentCharge",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="allocations",
    )
    #: A Rooomly subscription invoice this money settled. Exactly one of this
    #: and `obligation` is set, so "which debt did this money answer for" has
    #: one answer for every confirmed payment, rent or not.
    billing_invoice = models.ForeignKey(
        "billing.BillingInvoice",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="allocations",
    )
    amount = MoneyField()
    allocated_at = models.DateTimeField()
    #: Free-form, for a human reading a reconciliation later.
    note = models.CharField(max_length=240, blank=True)

    class Meta:
        db_table = "payments_allocation"
        ordering = ("-allocated_at",)
        constraints = [
            # One line per pair. A second payment towards the same charge is a
            # second transaction, and therefore a second row.
            models.UniqueConstraint(
                fields=["transaction", "obligation"], name="payments_allocation_unique"
            ),
            models.UniqueConstraint(
                fields=["transaction", "billing_invoice"],
                name="payments_allocation_invoice_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(amount_minor__gt=0),
                name="payments_allocation_positive",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(obligation__isnull=False, billing_invoice__isnull=True)
                    | models.Q(obligation__isnull=True, billing_invoice__isnull=False)
                ),
                name="payments_allocation_exactly_one_obligation",
            ),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Allocations are immutable; post a reversing allocation instead.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Allocations cannot be deleted.")


class PayoutProfile(BaseModel):
    """Where a Portfolio's settled rent is sent.

    On the organization, not on a person. A Portfolio outlives whichever member
    happens to be signed in, and money must not follow a team member out of the
    door. `identity.User.preferred_payout_method` is a stated preference and
    says so in its own comment; this is the record.

    **Nothing here can move money on its own and nothing here is a credential.**
    The account is held as an opaque provider token plus a masked string for a
    human to recognise. Rooomly never stores a PIN, an OTP, a CVV or a raw
    account number. Paystack provisioning passes the account number through to
    the provider and persists only the returned references and masked display.
    """

    organization = models.ForeignKey(
        "organization.Organization", on_delete=models.PROTECT, related_name="payout_profiles"
    )
    method = models.CharField(max_length=20, choices=PayoutMethod.choices)
    #: The PSP that issued the token. A token is meaningless to another one.
    provider = models.CharField(max_length=40)
    #: Opaque. Whatever the provider hands back for "pay this destination".
    token_reference = models.CharField(max_length=180)
    #: Paystack's settlement list filters by numeric subaccount id, while split
    #: checkout uses the ACCT_ code above. Keep both provider identifiers.
    provider_account_id = models.CharField(max_length=80, blank=True)
    #: For a person to recognise: "024*** 4567", "**** 8901". Display only.
    masked_account = models.CharField(max_length=40)
    account_name = models.CharField(max_length=160)
    #: Bank name or mobile-money network, as the provider names it.
    institution = models.CharField(max_length=80, blank=True)
    status = models.CharField(
        max_length=16,
        choices=PayoutProfileStatus.choices,
        default=PayoutProfileStatus.UNVERIFIED,
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    #: Exactly one destination may be selected for new payment intents. The
    #: intent snapshots this row and the provider references, so changing the
    #: selection never redirects a payment already in flight.
    is_active = models.BooleanField(default=False)
    #: Who last changed the destination. The audit log holds the full history;
    #: this is here so the answer is on screen without a query.
    updated_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "payments_payout_profile"
        ordering = ("-is_active", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=["organization"],
                condition=models.Q(is_active=True),
                name="payments_one_active_payout_profile",
            )
        ]

    @property
    def can_receive_settlement(self) -> bool:
        return self.is_active and self.status == PayoutProfileStatus.VERIFIED


class PayoutProvisioningOperation(BaseModel):
    """One deliberate attempt to create a provider-owned payout destination.

    Paystack does not document an idempotency key for subaccount creation. This
    row is therefore committed *before* the network call and its UUID is sent in
    provider metadata. If the response is lost, Rooomly searches for that UUID;
    it never repeats the create call and risks a duplicate subaccount.

    The request fingerprint is a keyed HMAC. A plain hash of a bank account
    number is vulnerable to enumeration and would turn an idempotency table into
    a weak second copy of the number it is meant not to retain.
    """

    organization = models.ForeignKey(
        "organization.Organization",
        on_delete=models.PROTECT,
        related_name="payout_provisioning_operations",
    )
    requested_by = models.ForeignKey(
        "identity.User",
        on_delete=models.PROTECT,
        related_name="payout_provisioning_operations",
    )
    idempotency_key = models.CharField(max_length=128)
    request_fingerprint = models.CharField(max_length=64)
    provider = models.CharField(max_length=40, default="paystack")
    method = models.CharField(max_length=20, choices=PayoutMethod.choices)
    status = models.CharField(
        max_length=24,
        choices=PayoutProvisioningStatus.choices,
        default=PayoutProvisioningStatus.PENDING,
    )
    payout_profile = models.ForeignKey(
        PayoutProfile,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="provisioning_operations",
    )
    failure_code = models.CharField(max_length=80, blank=True)
    failure_message = models.CharField(max_length=300, blank=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    check_count = models.PositiveSmallIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "payments_payout_provisioning_operation"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "idempotency_key"],
                name="payments_payout_provisioning_key_unique",
            ),
            models.UniqueConstraint(
                fields=["organization"],
                condition=models.Q(
                    status__in=(
                        PayoutProvisioningStatus.PENDING,
                        PayoutProvisioningStatus.NEEDS_RECONCILIATION,
                    )
                ),
                name="payments_one_open_payout_provisioning",
            ),
        ]


class Refund(BaseModel):
    """Money going back. Additive: the original success is never rewritten."""

    transaction = models.ForeignKey(
        PaymentTransaction, on_delete=models.PROTECT, related_name="refunds"
    )
    amount = MoneyField()
    reason = models.CharField(max_length=300)
    status = models.CharField(
        max_length=16, choices=RefundStatus.choices, default=RefundStatus.REQUESTED
    )
    requested_by = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="refunds_requested"
    )
    decided_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    provider_refund_reference = models.CharField(max_length=120, blank=True)
    failure_message = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = "payments_refund"
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount_minor__gt=0), name="payments_refund_positive"
            ),
        ]


class ReconciliationException(BaseModel):
    """A disagreement between Rooomly and a provider that a person must settle.

    Deliberately a record rather than a repair. A sweep that silently corrected
    what it found would be a sweep that could silently corrupt: the whole reason
    to compare two ledgers is that you do not know in advance which one is
    wrong. So the sweep opens one of these and stops.
    """

    kind = models.CharField(max_length=48, choices=ReconciliationKind.choices)
    status = models.CharField(
        max_length=16, choices=ReconciliationStatus.choices, default=ReconciliationStatus.OPEN
    )
    provider = models.CharField(max_length=40)
    #: Whichever reference identifies the disagreement for this kind.
    provider_reference = models.CharField(max_length=160, blank=True)

    intent = models.ForeignKey(
        PaymentIntent, null=True, blank=True, on_delete=models.PROTECT, related_name="exceptions"
    )
    transaction = models.ForeignKey(
        PaymentTransaction,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="exceptions",
    )
    settlement = models.ForeignKey(
        Settlement, null=True, blank=True, on_delete=models.PROTECT, related_name="exceptions"
    )
    #: What was compared and what each side said. Never raw provider payloads.
    detail = models.JSONField(default=dict, blank=True)

    detected_at = models.DateTimeField()
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Management principals are deliberately not identity.User rows. Keep their
    # UUID alongside the legacy consumer actor field so an operations decision
    # is attributable without weakening the authentication boundary.
    resolved_by_management_id = models.UUIDField(null=True, blank=True, db_index=True)
    resolution_note = models.CharField(max_length=500, blank=True)

    class Meta:
        db_table = "payments_reconciliation_exception"
        ordering = ("-detected_at",)
        indexes = [
            models.Index(fields=["status", "-detected_at"], name="pay_recon_status_idx"),
        ]
        constraints = [
            # A sweep runs repeatedly against the same unresolved disagreement.
            # Without this, an exception nobody has got to yet becomes a hundred
            # of them, and the queue stops being readable.
            models.UniqueConstraint(
                fields=["kind", "provider", "provider_reference"],
                condition=models.Q(status__in=OPEN_EXCEPTION_STATUSES),
                name="payments_one_open_exception_per_subject",
            ),
        ]
