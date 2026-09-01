"""Payment-intent lifecycle and server-side provider confirmation."""

from __future__ import annotations

import hashlib
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import (
    Conflict,
    NotFound,
    PermissionDenied,
    ProviderUnavailable,
    ValidationFailed,
)
from apps.core.money import Money
from apps.outbox.services import emit
from apps.rent.models import (
    ChargeStatus,
    PaymentVerificationSource,
    RentCharge,
    RentPayment,
)
from apps.rent.models import (
    PaymentStatus as RentPaymentStatus,
)

from .models import (
    OPEN_ATTEMPT_STATUSES,
    OPEN_INTENT_STATUSES,
    AttemptStatus,
    DigitalPaymentMethod,
    IntentStatus,
    LedgerDirection,
    LedgerEntry,
    PaymentAllocation,
    PaymentAttempt,
    PaymentIntent,
    PaymentTransaction,
    ProviderFeeBearer,
    ProviderWebhook,
    Receipt,
    Settlement,
    TransactionStatus,
    WebhookStatus,
)
from .providers import UnhandledProviderEvent, VerifiedProviderEvent, get_payment_provider
from .receipts import build_external_snapshot, build_snapshot, render_pdf


def _intent_ttl() -> timedelta:
    return timedelta(minutes=int(getattr(settings, "PAYMENT_INTENT_TTL_MINUTES", 30)))


def _minimum_part_minor() -> int:
    """The floor under a part payment, in the currency subunit.

    A floor exists because the receiving Portfolio bears the processor's
    transaction fee. Without one, forty payments of one pesewa would cost a
    landlord forty fees to collect forty pesewas, which is a cost transfer onto
    the person owed the money.

    Settling the *entire* remaining balance is always allowed however small it
    is, so the floor can never trap somebody who owes less than it.
    """
    return max(int(getattr(settings, "PAYMENT_MINIMUM_PART_MINOR", 5000)), 1)


def resolve_payable_amount(*, obligation: RentCharge, requested_minor: int | None) -> int:
    """How much of this obligation this intent is for.

    One rule for both rails. `rent.record_payment` has always accepted a part
    payment of an outstanding charge — a tenant who brings two thirds of the
    advance in cash gets it recorded — while digital checkout demanded the whole
    balance. The same two thirds was therefore recordable if it was handed over
    in a stairwell and refused if it went through the processor, which pushed
    exactly the payments Rooomly most wants on-platform off it.

    The bounds are the ones the external rail already enforces: positive, and no
    more than is outstanding. Overpayment stays impossible.
    """
    outstanding = obligation.outstanding_minor
    if outstanding <= 0:
        raise Conflict("That obligation is already settled.")
    if requested_minor is None:
        return outstanding
    amount = int(requested_minor)
    if amount <= 0:
        raise ValidationFailed("Enter the amount you want to pay.")
    if amount > outstanding:
        raise Conflict("That is more than this obligation still owes.")
    minimum = _minimum_part_minor()
    if amount < outstanding and amount < minimum:
        raise ValidationFailed(
            "A part payment must be at least "
            f"{Money(minimum, obligation.amount_currency)}, "
            "or the whole remaining balance."
        )
    return amount


def get_intent_or_404(pk, *, user) -> PaymentIntent:
    intent = (
        PaymentIntent.objects.filter(id=pk)
        .select_related("lease__unit__property", "tenant", "obligation")
        .first()
    )
    if intent is None:
        raise NotFound("We could not find that payment attempt.")
    if str(intent.tenant_id) != str(user.id) and not intent.lease.unit.property.is_managed_by(user):
        raise PermissionDenied("You do not have access to that payment attempt.")
    return intent


def intents_for(*, user):
    return PaymentIntent.objects.filter(tenant=user).select_related(
        "lease__unit__property", "obligation"
    )


def get_receipt_or_404(pk, *, user) -> Receipt:
    receipt = (
        Receipt.objects.filter(id=pk)
        .select_related(
            "transaction__intent__tenant",
            "transaction__intent__lease__unit__property",
            "rent_record__lease__tenant",
            "rent_record__lease__unit__property",
        )
        .first()
    )
    if receipt is None:
        raise NotFound("We could not find that receipt.")
    lease = (
        receipt.transaction.intent.lease if receipt.transaction_id else receipt.rent_record.lease
    )
    is_tenant = str(lease.tenant_id) == str(user.id)
    if not is_tenant and not lease.unit.property.is_managed_by(user):
        raise PermissionDenied("You do not have access to that receipt.")
    return receipt


def _unavailable(reason: str = "") -> dict:
    """One shape for every "no", so a client never has to feature-detect it."""
    return {
        "available": False,
        "reason": reason,
        "methods": [],
        "allows_partial": False,
        "minimum_part_minor": _minimum_part_minor(),
        "outstanding_minor": 0,
        "currency": "GHS",
    }


def digital_payment_availability(*, lease, user) -> dict:
    """Whether this tenant may honestly be offered hosted checkout now.

    This is a read-only capability answer. It checks the configured rail and
    beneficiary routing without creating an intent or contacting checkout.
    """
    if str(lease.tenant_id) != str(user.id):
        return _unavailable()
    from apps.lease.models import LeaseStatus

    if lease.status not in (LeaseStatus.ACTIVE, LeaseStatus.ENDED):
        return _unavailable("Online payment starts after the agreement is active.")
    charge = (
        RentCharge.objects.filter(
            lease=lease,
            status__in=(ChargeStatus.DUE, ChargeStatus.PART_PAID),
        )
        .order_by("due_on", "created_at")
        .first()
    )
    if charge is None or charge.outstanding_minor <= 0:
        return _unavailable()
    try:
        provider = get_payment_provider()
        provider.ensure_available()
        _collection_routing_snapshot(
            provider=provider,
            lease=lease,
            amount_minor=charge.outstanding_minor,
        )
    except (Conflict, PermissionDenied, ProviderUnavailable, ValidationFailed):
        return _unavailable("Online payment is not available for this home yet.")
    return {
        "available": True,
        "reason": "",
        "methods": list(DigitalPaymentMethod.values),
        # The part-payment contract, so a client can offer the same choice the
        # off-platform record already offers instead of guessing at the rule.
        "allows_partial": True,
        "minimum_part_minor": _minimum_part_minor(),
        "outstanding_minor": charge.outstanding_minor,
        "currency": charge.amount_currency,
    }


def create_intent(
    *,
    obligation: RentCharge,
    user,
    payment_method: str,
    amount_minor: int | None = None,
) -> PaymentIntent:
    """Create — or resume — an intent priced only from server state.

    ``amount_minor`` is what the payer asked to put towards this obligation, and
    it is a *request*, not the price: the server bounds it against the locked
    outstanding balance and would rather refuse than accept a figure it cannot
    justify. Omitting it means the whole remaining balance.

    **Three phases, and the middle one holds nothing.** This used to be one
    `@transaction.atomic` that took `SELECT ... FOR UPDATE` on the tenant's
    `RentCharge` and then called Paystack inside it, with a twenty-second
    timeout. Every checkout pinned a database connection and a rent row for as
    long as the provider felt like taking, which is how a provider's bad
    afternoon becomes Rooomly's — and it was the exact thing ADR 0027's own
    Consequences section says these services must not do.

    So: reserve under a lock and commit; call the provider holding nothing;
    record the answer under a lock and commit.

    **Resuming is what makes that safe.** The reservation is durable before the
    network call, so a lost or ambiguous response leaves a real intent behind
    rather than nothing. Calling this again with the same obligation, amount and
    method finds that intent and re-initiates it — and because
    `client_reference` is the provider's own idempotency key, re-initiating
    reaches the same provider transaction rather than opening a second one. That
    is also what lets the HTTP layer retry after a crash without duplicating a
    charge.
    """
    intent, resumed = _reserve_intent(
        obligation_id=obligation.id,
        user=user,
        payment_method=payment_method,
        requested_minor=amount_minor,
    )
    if intent.provider_reference and intent.status in OPEN_INTENT_STATUSES:
        # Already live at the provider. The caller is a replay of a request that
        # got further than it realised; hand back what exists.
        return intent

    return _initiate_reserved_intent(intent=intent, user=user, resumed=resumed)


@transaction.atomic
def _reserve_intent(
    *, obligation_id, user, payment_method: str, requested_minor: int | None
) -> tuple[PaymentIntent, bool]:
    """Phase one: decide, and write the row. No network happens in here.

    Returns the intent and whether it was resumed rather than created, so the
    audit trail can tell the difference between a first attempt and a recovery.
    """
    obligation = (
        RentCharge.objects.select_for_update()
        .select_related("lease__unit__property", "lease__tenant", "lease__landlord")
        .filter(id=obligation_id)
        .first()
    )
    if obligation is None:
        raise NotFound("We could not find that payment obligation.")
    lease = obligation.lease
    if str(lease.tenant_id) != str(user.id):
        raise PermissionDenied("Only the tenant who owes this can start its digital payment.")
    from apps.lease.models import LeaseStatus

    if lease.status not in (LeaseStatus.ACTIVE, LeaseStatus.ENDED):
        raise Conflict("Digital payment can only start for an active or ended agreement.")
    if payment_method not in DigitalPaymentMethod.values:
        raise ValidationFailed("Choose a supported digital payment method.")
    if obligation.status not in (ChargeStatus.DUE, ChargeStatus.PART_PAID):
        raise Conflict("That obligation no longer has an outstanding payment.")
    amount_minor = resolve_payable_amount(obligation=obligation, requested_minor=requested_minor)

    # Expired attempts stop holding the one-open-attempt database gate.
    expired_rows = PaymentIntent.objects.select_for_update().filter(
        obligation=obligation,
        status__in=OPEN_INTENT_STATUSES,
        expires_at__lte=timezone.now(),
    )
    for expired in expired_rows:
        _expire_intent(expired)

    existing = (
        PaymentIntent.objects.select_for_update()
        .filter(obligation=obligation, status__in=OPEN_INTENT_STATUSES)
        .first()
    )
    if existing is not None:
        resumed = _resume_or_refuse(
            existing=existing,
            user=user,
            payment_method=payment_method,
            amount_minor=amount_minor,
        )
        if resumed is not None:
            return resumed, True
        # Otherwise the open reservation was cancelled just above and this
        # transaction continues into a fresh one. Falling through rather than
        # raising matters: an exception here would roll back that cancellation
        # and leave the gate held by an intent nothing will ever initiate.

    provider = get_payment_provider()
    # Fail before a row is created: there is no checkout and no money has been
    # requested. Clients must never mistake a local placeholder for an actual
    # PSP attempt. This is a configuration read, not a network call.
    provider.ensure_available()

    routing = _collection_routing_snapshot(
        provider=provider,
        lease=lease,
        amount_minor=amount_minor,
    )

    intent = PaymentIntent(
        tenant=user,
        lease=lease,
        obligation=obligation,
        payment_method=payment_method,
        provider=provider.name,
        expires_at=timezone.now() + _intent_ttl(),
        metadata={"obligation_kind": obligation.kind},
        **routing,
    )
    intent.amount_minor = amount_minor
    intent.amount_currency = obligation.amount_currency
    intent.client_reference = f"rmp_{intent.id.hex}"
    intent.save()

    record(
        action=AuditAction.CREATE,
        aggregate_type="payment_intent",
        aggregate_id=intent.id,
        actor=user,
        metadata={
            "lease_id": str(lease.id),
            "obligation_id": str(obligation.id),
            "amount_minor": amount_minor,
            "currency": intent.amount_currency,
            "provider": intent.provider,
            "beneficiary_organization_id": (
                str(intent.beneficiary_organization_id)
                if intent.beneficiary_organization_id
                else None
            ),
            "platform_charge_minor": intent.platform_charge_minor,
            "provider_fee_bearer": intent.provider_fee_bearer,
            "phase": "reserved",
        },
    )
    return intent, False


def _resume_or_refuse(
    *, existing: PaymentIntent, user, payment_method: str, amount_minor: int
) -> PaymentIntent | None:
    """What to do about an intent that is already open on this obligation.

    Three different situations wearing the same shape, and collapsing them into
    one "already in progress" refusal is what made a lost provider response
    unrecoverable — the tenant was told to wait for something that would never
    finish, on an intent nothing would ever re-initiate.
    """
    if str(existing.tenant_id) != str(user.id):
        raise Conflict("A payment attempt for this obligation is already in progress.")

    same_request = (
        existing.amount_minor == amount_minor and existing.payment_method == payment_method
    )
    if same_request:
        # The same logical request. Either it never reached the provider and
        # this call will initiate it, or it did and the caller gets it back.
        return existing

    if existing.provider_reference:
        # A different amount or method, against a checkout that is live at the
        # provider. Two open checkouts for one charge is exactly what the
        # one-open-intent constraint exists to prevent.
        raise Conflict("A payment for this obligation is already open. Finish or cancel it first.")

    # A different request, against a reservation that never reached the
    # provider. Nothing is at risk, so it is cancelled rather than left holding
    # the gate against the payment the tenant actually wants to make.
    previous = existing.status
    existing.status = IntentStatus.CANCELLED
    existing.failure_code = "superseded_before_initiation"
    existing.failure_message = "Replaced before it reached the payment provider."
    existing.save(update_fields=["status", "failure_code", "failure_message", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="payment_intent",
        aggregate_id=existing.id,
        actor=user,
        changes={"status": [previous, IntentStatus.CANCELLED]},
        metadata={"reason": "superseded_before_initiation"},
    )
    # `None` means: cancelled, and the caller should reserve a fresh intent
    # inside this same transaction.
    return None


def _initiate_reserved_intent(*, intent: PaymentIntent, user, resumed: bool) -> PaymentIntent:
    """Phase two and three: ask the provider, then record what it said.

    Nothing is locked and no transaction is open while `initiate` runs. An
    adapter must use `client_reference` as its outbound idempotency reference,
    so this is safe to reach more than once for one reservation: an uncertain
    timeout returns `processing` rather than raising, and a genuine retry lands
    on the same provider transaction.
    """
    provider = get_payment_provider(intent.provider)
    result = provider.initiate(intent=intent)
    if result.status not in (IntentStatus.PENDING, IntentStatus.PROCESSING):
        raise ValidationFailed("The payment provider returned an invalid initiation state.")

    return _record_initiation(
        intent_id=intent.id,
        status=result.status,
        provider_reference=result.provider_reference[:120],
        next_action=result.next_action,
        user=user,
        resumed=resumed,
    )


@transaction.atomic
def _record_initiation(
    *, intent_id, status: str, provider_reference: str, next_action: dict, user, resumed: bool
) -> PaymentIntent:
    """Phase three: the provider's answer, written under a lock and committed."""
    intent = (
        PaymentIntent.objects.select_for_update()
        .select_related("lease", "obligation")
        .get(id=intent_id)
    )
    if intent.status == IntentStatus.SUCCEEDED:
        # A callback overtook the initiation response. The money is already
        # recorded and nothing here may write over it.
        return intent
    if intent.status not in OPEN_INTENT_STATUSES:
        raise Conflict("That payment attempt is no longer open.")

    intent.status = status
    intent.provider_reference = provider_reference
    intent.next_action = next_action
    intent.save(update_fields=["status", "provider_reference", "next_action", "updated_at"])

    # One attempt per initiation. A resumed reservation that already had an open
    # attempt keeps it rather than stacking a second onto the same try.
    if not intent.attempts.filter(status__in=OPEN_ATTEMPT_STATUSES).exists():
        open_attempt(intent=intent)

    record(
        action=AuditAction.UPDATE,
        aggregate_type="payment_intent",
        aggregate_id=intent.id,
        actor=user,
        metadata={
            "provider": intent.provider,
            "phase": "resumed" if resumed else "initiated",
        },
    )
    emit(
        DomainEvent(
            "payment.intent_created.v1",
            "payment_intent",
            str(intent.id),
            {"tenant_id": str(intent.tenant_id), "lease_id": str(intent.lease_id)},
        )
    )
    return intent


def _collection_routing_snapshot(*, provider, lease, amount_minor: int) -> dict:
    """Recheck provider authority and resolve the receiving Portfolio.

    Property capabilities still own the identity and property-authority checks.
    The organization-owned ``PayoutProfile`` is the source of truth for the
    receiving account, however: Paystack verifies that exact subaccount and the
    intent freezes it. Requiring the older, separate Trust bank-account stamp as
    well made checkout disagree with ``digital_payment_availability`` and asked
    tenants to complete a provider-only setup action.
    """
    from apps.property.capabilities import PropertyCapability, assert_property_capability

    try:
        assert_property_capability(
            prop=lease.unit.property,
            user=lease.landlord,
            capability=PropertyCapability.LEASES,
        )
        return _routing_snapshot(
            provider=provider,
            lease=lease,
            amount_minor=amount_minor,
        )
    except (Conflict, PermissionDenied) as exc:
        raise Conflict(
            "Online rent payment is not available for this home yet. "
            "The property provider needs to finish payment setup."
        ) from exc


def _routing_snapshot(*, provider, lease, amount_minor: int) -> dict:
    """Resolve one verified Portfolio destination and freeze its split terms."""
    if not provider.uses_subaccounts:
        return {}

    from .payouts import eligible_payout_profiles

    # The same decision the provider's dashboard readiness is computed from.
    # One queryset, so the two cannot drift apart again.
    profiles = eligible_payout_profiles(
        prop=lease.unit.property,
        member=lease.landlord,
        provider_name=provider.name,
    )
    if not profiles:
        raise Conflict(
            "The provider Portfolio does not have a verified Paystack settlement account."
        )
    if len(profiles) > 1:
        raise Conflict(
            "More than one Portfolio could receive this rent. Choose the contracting "
            "Portfolio before accepting payments."
        )
    profile = profiles[0]
    if not profile.token_reference or not profile.provider_account_id:
        raise Conflict("The provider settlement account is missing its Paystack references.")

    raw_bps = str(getattr(settings, "PAYSTACK_PLATFORM_CHARGE_BPS", "")).strip()
    try:
        basis_points = int(raw_bps)
    except ValueError as exc:
        raise ProviderUnavailable(
            "Paystack split policy is not configured. No money was requested."
        ) from exc
    if basis_points < 0 or basis_points >= 10_000:
        raise ProviderUnavailable("Paystack platform charge must be between 0 and 9,999 bps.")
    # Product policy: the receiving property owner bears Paystack's transaction
    # fee. Tenants pay exactly the authoritative obligation and Rooomly never
    # adds an undisclosed checkout surcharge.
    bearer = ProviderFeeBearer.SUBACCOUNT

    # Integer half-up rounding in the currency subunit. No floats enter a money
    # calculation, and the exact result is stored on the intent.
    platform_charge_minor = (amount_minor * basis_points + 5_000) // 10_000
    return {
        "beneficiary_organization": profile.organization,
        "payout_profile": profile,
        "provider_subaccount_reference": profile.token_reference,
        "provider_subaccount_id": profile.provider_account_id,
        "platform_charge_minor": platform_charge_minor,
        "provider_fee_bearer": bearer,
    }


@transaction.atomic
def open_attempt(*, intent: PaymentIntent) -> PaymentAttempt:
    """Record that somebody is having a go at paying this intent.

    Numbered per intent rather than timestamped, because the number is the one a
    person would recognise — "this is my third try" — and because two retries
    racing each other would otherwise be ordered by whichever transaction
    committed first.
    """
    last = (
        PaymentAttempt.objects.select_for_update()
        .filter(intent=intent)
        .order_by("-sequence")
        .first()
    )
    attempt = PaymentAttempt(
        intent=intent,
        sequence=(last.sequence + 1) if last else 1,
        provider=intent.provider,
        provider_reference=intent.provider_reference,
        payment_method=intent.payment_method,
        status=AttemptStatus.PENDING,
        started_at=timezone.now(),
    )
    attempt.save()
    return attempt


def _conclude_attempt(
    intent: PaymentIntent, status: str, *, code: str = "", message: str = ""
) -> None:
    """Close the open attempt, if there is one.

    Tolerant on purpose. An intent created before attempts existed has none,
    and a callback that arrives twice must not fail the second time — this is
    bookkeeping alongside the financial record, not the financial record.
    """
    attempt = (
        PaymentAttempt.objects.select_for_update()
        .filter(intent=intent, status__in=[AttemptStatus.STARTED, AttemptStatus.PENDING])
        .order_by("-sequence")
        .first()
    )
    if attempt is None:
        return
    attempt.status = status
    attempt.failure_code = code[:80]
    attempt.failure_message = message[:300]
    attempt.concluded_at = timezone.now()
    attempt.save(
        update_fields=["status", "failure_code", "failure_message", "concluded_at", "updated_at"]
    )


def retry_intent(*, intent: PaymentIntent, user) -> PaymentAttempt:
    """Try again at the same obligation, without creating a second obligation.

    The point of the intent surviving a failure is exactly this: the person is
    still paying *that* charge, and the record should say they tried more than
    once rather than leaving a trail of abandoned intents.

    Split the same three ways as `create_intent`, and for the same reason: the
    provider call in the middle held a transaction open for as long as the
    provider took. Nothing is held while it runs.
    """
    _open_retry(intent_id=intent.id, user=user)

    provider = get_payment_provider(intent.provider)
    result = provider.initiate(intent=intent)
    if result.status not in (IntentStatus.PENDING, IntentStatus.PROCESSING):
        raise ValidationFailed("The payment provider returned an invalid initiation state.")

    return _record_retry(
        intent_id=intent.id,
        status=result.status,
        provider_reference=result.provider_reference[:120],
        next_action=result.next_action,
        user=user,
    )


@transaction.atomic
def _open_retry(*, intent_id, user) -> None:
    """Phase one: check it may be retried, and close the try being replaced."""
    intent = PaymentIntent.objects.select_for_update().get(id=intent_id)
    if str(intent.tenant_id) != str(user.id):
        raise PermissionDenied("That payment does not belong to you.")
    if intent.status not in (IntentStatus.FAILED, IntentStatus.PROCESSING, IntentStatus.PENDING):
        raise Conflict("That payment cannot be retried.")
    if intent.is_expired:
        raise Conflict("That payment attempt has expired; start a new one.")
    if PaymentAttempt.objects.filter(intent=intent, status=AttemptStatus.SUCCEEDED).exists():
        raise Conflict("That payment already succeeded.")

    _conclude_attempt(intent, AttemptStatus.ABANDONED, code="superseded_by_retry")


@transaction.atomic
def _record_retry(
    *, intent_id, status: str, provider_reference: str, next_action: dict, user
) -> PaymentAttempt:
    """Phase three: the provider answered, so record it and open the new try."""
    intent = PaymentIntent.objects.select_for_update().get(id=intent_id)
    if intent.status == IntentStatus.SUCCEEDED:
        # A callback overtook the retry. The money is recorded; nothing here may
        # write over it, and the successful attempt is the one that counts.
        succeeded = intent.attempts.filter(status=AttemptStatus.SUCCEEDED).first()
        if succeeded is not None:
            return succeeded
        raise Conflict("That payment already succeeded.")

    intent.status = status
    intent.provider_reference = provider_reference
    intent.next_action = next_action
    intent.failure_code = ""
    intent.failure_message = ""
    intent.save(
        update_fields=[
            "status",
            "provider_reference",
            "next_action",
            "failure_code",
            "failure_message",
            "updated_at",
        ]
    )

    # A retry whose response was lost and is being re-run keeps the attempt it
    # already opened, rather than stacking a second onto one try.
    attempt = intent.attempts.filter(status__in=OPEN_ATTEMPT_STATUSES).order_by("-sequence").first()
    if attempt is None:
        attempt = open_attempt(intent=intent)

    record(
        action=AuditAction.UPDATE,
        aggregate_type="payment_intent",
        aggregate_id=intent.id,
        actor=user,
        metadata={"retry_attempt": attempt.sequence, "provider": intent.provider},
    )
    return attempt


def refresh_intent_from_provider(*, intent: PaymentIntent, user) -> PaymentIntent:
    """Ask the PSP what happened, without trusting a browser/app return.

    A return URL is only a prompt to ask. The provider query supplies the
    financial fact and the same locked transition used by authenticated
    webhooks applies it. This closes the lost-webhook gap without accepting any
    status, amount, method or transaction id from the client.
    """
    if str(intent.tenant_id) != str(user.id):
        raise PermissionDenied("That payment does not belong to you.")
    if intent.status in (IntentStatus.SUCCEEDED, IntentStatus.CANCELLED):
        return intent
    if not intent.provider_reference:
        raise Conflict("That payment has not reached the provider yet.")

    provider = get_payment_provider(intent.provider)
    provider.ensure_available()
    state = provider.query_payment(provider_reference=intent.provider_reference)
    if not state.found:
        if intent.is_expired:
            return _expire_intent_if_due(intent_id=intent.id)
        return get_intent_or_404(intent.id, user=user)
    return apply_provider_state(
        intent=intent,
        state=state,
        evidence_source="provider_query",
        requested_by=user,
    )


def provider_state_to_event(*, intent: PaymentIntent, state) -> VerifiedProviderEvent:
    """Translate one provider answer into the event the confirmation path takes.

    Deliberately shared by the tenant's return-from-checkout query and the
    reconciliation sweep. Both are Rooomly *asking* the provider rather than
    being told, and neither may relax a single check the signed-webhook path
    applies — so they build the same value and hand it to the same function.
    """
    if state.status not in ("pending", "processing", "failed", "succeeded"):
        raise ValidationFailed("The payment provider returned a state Rooomly cannot apply.")
    if state.status in ("failed", "succeeded") and not state.provider_transaction_id:
        raise ProviderUnavailable(
            "The payment provider returned a final state without a transaction reference."
        )
    if state.status == "succeeded" and state.occurred_at is None:
        raise ProviderUnavailable(
            "The payment provider confirmed payment without a completion time."
        )
    return VerifiedProviderEvent(
        event_id=f"query:{intent.provider_reference}:{state.status}",
        event_type="payment.queried",
        provider_reference=intent.provider_reference,
        provider_transaction_id=state.provider_transaction_id,
        status=state.status,
        amount_minor=state.amount_minor or intent.amount_minor,
        currency=state.currency or intent.amount_currency,
        payment_method=state.payment_method or intent.payment_method,
        occurred_at=state.occurred_at or timezone.now(),
        raw_status=state.raw_status or state.status,
    )


def apply_provider_state(
    *,
    intent: PaymentIntent,
    state,
    evidence_source: str,
    requested_by=None,
) -> PaymentIntent:
    """Apply what the provider says about one intent, through the one boundary."""
    event = provider_state_to_event(intent=intent, state=state)
    return _process_verified_event(
        provider_name=intent.provider,
        event=event,
        evidence_source=evidence_source,
        requested_by=requested_by,
    )


@transaction.atomic
def _expire_intent_if_due(*, intent_id) -> PaymentIntent:
    intent = PaymentIntent.objects.select_for_update().get(id=intent_id)
    if intent.status in OPEN_INTENT_STATUSES and intent.is_expired:
        _expire_intent(intent)
    return intent


def allocate(
    *,
    transaction_row: PaymentTransaction,
    obligation: RentCharge,
    amount_minor: int,
    note: str = "",
) -> PaymentAllocation:
    """Apply confirmed money to the obligation it satisfies.

    This is what makes a charge paid. Nothing else does — a `RentCharge` is not
    settled because a payment exists somewhere near it, but because a row here
    says this money went to that charge. That distinction is what lets one
    payment later cover two obligations, or half of one, without any of the
    surrounding code learning a new shape.

    Two invariants, both refused rather than clamped: a transaction cannot
    allocate more than it carried, and an obligation cannot be allocated more
    than it is owed. Silently trimming either would turn a reconciliation
    problem into a wrong balance.
    """
    if amount_minor <= 0:
        raise ValidationFailed("An allocation must be for a positive amount.")
    if transaction_row.amount_currency != obligation.amount_currency:
        raise ValidationFailed("An allocation cannot cross currencies.")

    already_allocated = sum(row.amount_minor for row in transaction_row.allocations.all())
    if already_allocated + amount_minor > transaction_row.amount_minor:
        raise Conflict("That allocation would exceed the money this transaction carried.")

    against_obligation = sum(
        row.amount_minor for row in PaymentAllocation.objects.filter(obligation=obligation)
    )
    adjusted = obligation.adjustments.aggregate(total=Sum("amount_minor")).get("total") or 0
    collectible = max((obligation.amount_minor or 0) - adjusted, 0)
    if against_obligation + amount_minor > collectible:
        raise Conflict("That allocation would overpay the obligation.")

    allocation = PaymentAllocation(
        transaction=transaction_row,
        obligation=obligation,
        allocated_at=transaction_row.paid_at or timezone.now(),
        note=note[:240],
    )
    allocation.amount_minor = amount_minor
    allocation.amount_currency = transaction_row.amount_currency
    allocation.save()

    record(
        action=AuditAction.MONEY_MOVEMENT,
        aggregate_type="payment_allocation",
        aggregate_id=allocation.id,
        actor=None,
        metadata={
            "transaction_id": str(transaction_row.id),
            "obligation_id": str(obligation.id),
            "amount_minor": amount_minor,
            "currency": allocation.amount_currency,
        },
    )
    return allocation


def process_webhook(*, provider_name: str, raw_body: bytes, headers) -> PaymentIntent | None:
    """Authenticate and process one PSP callback without trusting a client.

    Returns ``None`` for an authenticated event this payment flow does not act
    on. That is acknowledged rather than refused: a provider retries a 4xx and
    can eventually disable the endpoint Rooomly's payment confirmation depends
    on, so an account-wide event is recorded as ignored and answered 200.
    """
    payload_hash = hashlib.sha256(raw_body).hexdigest()
    provider = get_payment_provider(provider_name)
    try:
        event = provider.verify_webhook(raw_body=raw_body, headers=headers)
    except UnhandledProviderEvent as ignored:
        ProviderWebhook.objects.get_or_create(
            provider=provider_name,
            event_id=f"ignored:{payload_hash}",
            defaults={
                "event_type": ignored.event_type[:80],
                "payload_hash": payload_hash,
                "signature_valid": True,
                "status": WebhookStatus.IGNORED,
                "processed_at": timezone.now(),
            },
        )
        return None
    except PermissionDenied:
        ProviderWebhook.objects.get_or_create(
            provider=provider_name,
            event_id=f"invalid-signature:{payload_hash}",
            defaults={
                "payload_hash": payload_hash,
                "signature_valid": False,
                "status": WebhookStatus.REJECTED,
                "error_message": "Invalid signature",
            },
        )
        raise
    except ValidationFailed:
        ProviderWebhook.objects.get_or_create(
            provider=provider_name,
            event_id=f"invalid-payload:{payload_hash}",
            defaults={
                "payload_hash": payload_hash,
                "signature_valid": True,
                "status": WebhookStatus.REJECTED,
                "error_message": "Invalid payload",
            },
        )
        raise

    webhook, _ = ProviderWebhook.objects.get_or_create(
        provider=provider_name,
        event_id=event.event_id[:160],
        defaults={
            "event_type": event.event_type[:80],
            "payload_hash": payload_hash,
            "signature_valid": True,
        },
    )
    if webhook.payload_hash != payload_hash:
        raise Conflict("That provider event id was reused with different contents.")

    if webhook.status == WebhookStatus.PROCESSED:
        # Already applied. Answer from the record rather than asking the
        # provider again: a redelivery storm would otherwise become a query
        # storm, and the second opinion below has nothing left to protect.
        settled = (
            PaymentIntent.objects.filter(
                provider=provider_name, provider_reference=event.provider_reference
            )
            .select_related("obligation", "lease")
            .first()
        )
        if settled is not None:
            return settled

    # Paystack's own guidance, and good practice for any provider: a signed
    # callback proves who sent it, not that the payment is real. Before value is
    # granted, ask the provider directly.
    #
    # Outside the atomic block deliberately — an outbound HTTP call inside a
    # transaction holds row locks for as long as the provider takes to answer.
    event = _confirm_with_provider(provider=provider, event=event)

    try:
        return _process_verified_event(webhook=webhook, event=event)
    except (Conflict, NotFound, ValidationFailed) as exc:
        ProviderWebhook.objects.filter(id=webhook.id).update(
            status=WebhookStatus.FAILED,
            processed_at=timezone.now(),
            error_message=exc.message[:500],
            updated_at=timezone.now(),
        )
        raise


def _confirm_with_provider(*, provider, event: VerifiedProviderEvent) -> VerifiedProviderEvent:
    """Cross-check a callback against the provider's own record.

    A forged callback cannot reach here — the signature is checked first — but a
    *replayed* or altered-in-flight one is a different question, and so is a
    provider bug. Asking costs one request and removes an entire class of "the
    webhook said so" incident.

    Skipped, not failed, when the provider cannot answer: an adapter without a
    query operation is a real and supported case, and reconciliation covers the
    same ground on a slower clock.
    """
    if event.status != "succeeded":
        # Only success grants value, so only success needs the second opinion.
        return event
    try:
        state = provider.query_payment(provider_reference=event.provider_reference)
    except (ProviderUnavailable, NotImplementedError):
        return event
    if not state.found:
        raise Conflict("The provider has no record of that payment; it needs reconciliation.")
    if state.status != "succeeded":
        raise Conflict("The provider's own record does not show that payment as successful.")
    if state.amount_minor and state.amount_minor != event.amount_minor:
        raise Conflict("The callback amount does not match the provider's record.")
    if state.currency and state.currency != event.currency:
        raise Conflict("The callback currency does not match the provider's record.")
    return event


@transaction.atomic
def _process_verified_event(
    *,
    event: VerifiedProviderEvent,
    webhook: ProviderWebhook | None = None,
    provider_name: str = "",
    evidence_source: str = "webhook",
    requested_by=None,
) -> PaymentIntent:
    if webhook is not None:
        webhook = ProviderWebhook.objects.select_for_update().get(id=webhook.id)
        provider_name = webhook.provider
    if not provider_name:
        raise ValidationFailed("The provider evidence has no payment provider.")
    intent = (
        PaymentIntent.objects.select_for_update()
        .select_related("obligation", "lease__tenant", "lease__landlord", "lease__unit__property")
        .filter(provider=provider_name, provider_reference=event.provider_reference)
        .first()
    )
    if intent is None:
        raise NotFound("The provider evidence does not match a payment attempt.")
    if webhook is not None and webhook.status == WebhookStatus.PROCESSED:
        return intent
    if event.amount_minor != intent.amount_minor or event.currency != intent.amount_currency:
        raise ValidationFailed(
            "The provider callback amount or currency does not match the intent."
        )
    if event.payment_method != intent.payment_method:
        raise ValidationFailed("The provider callback payment method does not match the intent.")
    if event.status in ("succeeded", "failed") and not event.provider_transaction_id:
        # A final state is written as an immutable transaction keyed on the
        # provider's own id. Without one, two unrelated final callbacks would
        # both try to claim the empty string against a unique index.
        raise ValidationFailed(
            "The provider reported a final state without a transaction reference."
        )
    if event.status == "succeeded" and event.occurred_at is None:
        # Second line of defence behind the adapters. Everything a success
        # writes — the allocation, the ledger lines, the receipt — is dated from
        # this timestamp, so a missing one must fail closed here rather than
        # surface as an unhandled error halfway through posting the money.
        raise ValidationFailed("The provider confirmed a payment without a completion time.")

    if event.status in ("pending", "processing"):
        intent.status = IntentStatus.PROCESSING
        intent.save(update_fields=["status", "updated_at"])
        _finish_provider_evidence(webhook)
        return intent
    if event.status == "failed":
        # One failure row per provider transaction. A provider that retries
        # the same failure callback must not accumulate rows.
        if not intent.transactions.filter(
            provider_transaction_id=event.provider_transaction_id
        ).exists():
            transaction_row = PaymentTransaction(
                intent=intent,
                provider=intent.provider,
                provider_transaction_id=event.provider_transaction_id,
                payment_method=intent.payment_method,
                status=TransactionStatus.FAILED,
                failure_code="provider_failed",
                failure_message="The payment provider reported that this attempt failed.",
                raw_provider_status=event.raw_status[:80],
            )
            transaction_row.amount_minor = intent.amount_minor
            transaction_row.amount_currency = intent.amount_currency
            transaction_row.save()
        _conclude_attempt(
            intent,
            AttemptStatus.FAILED,
            code="provider_failed",
            message="The payment provider reported that this attempt failed.",
        )
        intent.status = IntentStatus.FAILED
        intent.failure_code = "provider_failed"
        intent.failure_message = "The payment was not completed."
        intent.save(update_fields=["status", "failure_code", "failure_message", "updated_at"])
        record(
            action=AuditAction.UPDATE,
            aggregate_type="payment_intent",
            aggregate_id=intent.id,
            actor=None,
            changes={"status": [IntentStatus.PROCESSING, IntentStatus.FAILED]},
            metadata={
                "provider": intent.provider,
                "evidence_source": evidence_source,
                "requested_by_id": (str(requested_by.id) if requested_by is not None else None),
            },
        )
        emit(
            DomainEvent(
                "payment.failed.v1",
                "payment_intent",
                str(intent.id),
                {"tenant_id": str(intent.tenant_id), "lease_id": str(intent.lease_id)},
            )
        )
        _finish_provider_evidence(webhook)
        return intent
    if event.status != "succeeded":
        raise ValidationFailed("That provider payment state requires reconciliation.")

    if intent.status == IntentStatus.SUCCEEDED:
        existing = intent.transactions.filter(status=TransactionStatus.SUCCEEDED).first()
        if existing is None or existing.provider_transaction_id != event.provider_transaction_id:
            raise Conflict("That succeeded intent does not match this provider transaction.")
        _finish_provider_evidence(webhook)
        return intent

    obligation = RentCharge.objects.select_for_update().get(id=intent.obligation_id)
    # An upper bound, not an equality. A part payment is deliberately less than
    # the balance; what must never happen is money arriving against an
    # obligation that has since shrunk below it — a waiver, or another payment
    # landing first — because posting it would overpay the charge.
    if intent.amount_minor > obligation.outstanding_minor:
        raise Conflict(
            "The obligation changed while this payment was pending; reconcile it manually."
        )
    if PaymentTransaction.objects.filter(
        provider=intent.provider, provider_transaction_id=event.provider_transaction_id
    ).exists():
        raise Conflict("That provider transaction was already assigned to another payment.")

    # RentCharge remains the sole obligation owner. This row appears in the
    # existing rent history but is visibly PSP-confirmed, not a two-party claim.
    rent_payment = RentPayment(
        lease=intent.lease,
        charge=obligation,
        paid_on=event.occurred_at.date(),
        method=_rent_method(intent.payment_method),
        reference=event.provider_transaction_id[:120],
        note="Confirmed server-side by payment provider.",
        status=RentPaymentStatus.CONFIRMED,
        verification_source=PaymentVerificationSource.PSP,
        recorded_by=intent.tenant,
        confirmed_at=event.occurred_at,
    )
    rent_payment.amount_minor = intent.amount_minor
    rent_payment.amount_currency = intent.amount_currency
    rent_payment.save()

    transaction_row = PaymentTransaction(
        intent=intent,
        rent_record=rent_payment,
        provider=intent.provider,
        provider_transaction_id=event.provider_transaction_id,
        payment_method=intent.payment_method,
        status=TransactionStatus.SUCCEEDED,
        paid_at=event.occurred_at,
        raw_provider_status=event.raw_status[:80],
    )
    transaction_row.amount_minor = intent.amount_minor
    transaction_row.amount_currency = intent.amount_currency
    transaction_row.save()

    from apps.rent.services import apply_confirmed_payment

    # The allocation is written before the obligation is touched. It is the
    # statement that *this* money settles *this* charge; everything downstream
    # is a consequence of it rather than a parallel opinion about it.
    allocate(
        transaction_row=transaction_row,
        obligation=obligation,
        amount_minor=transaction_row.amount_minor,
        note="Provider-confirmed rent payment",
    )
    apply_confirmed_payment(rent_payment)
    _conclude_attempt(intent, AttemptStatus.SUCCEEDED)
    _cancel_competing_intents(intent)
    _create_ledger(transaction_row)
    _create_receipt(transaction_row, obligation)
    _create_pending_settlement(transaction_row)

    previous_status = intent.status
    intent.status = IntentStatus.SUCCEEDED
    intent.failure_code = ""
    intent.failure_message = ""
    intent.next_action = {}
    intent.save(
        update_fields=[
            "status",
            "failure_code",
            "failure_message",
            "next_action",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.MONEY_MOVEMENT,
        aggregate_type="payment_transaction",
        aggregate_id=transaction_row.id,
        actor=None,
        metadata={
            "intent_id": str(intent.id),
            "lease_id": str(intent.lease_id),
            "obligation_id": str(obligation.id),
            "amount_minor": intent.amount_minor,
            "currency": intent.amount_currency,
            "provider": intent.provider,
            "server_confirmed": True,
            "evidence_source": evidence_source,
            "requested_by_id": str(requested_by.id) if requested_by is not None else None,
            "intent_status": [previous_status, IntentStatus.SUCCEEDED],
        },
    )
    emit(
        DomainEvent(
            "payment.succeeded.v1",
            "payment_transaction",
            str(transaction_row.id),
            {
                "intent_id": str(intent.id),
                "tenant_id": str(intent.tenant_id),
                "landlord_id": str(intent.lease.landlord_id),
                "lease_id": str(intent.lease_id),
                "receipt_id": str(transaction_row.receipt.id),
            },
        )
    )
    _finish_provider_evidence(webhook)
    return intent


def _finish_provider_evidence(webhook: ProviderWebhook | None) -> None:
    if webhook is not None:
        _finish_webhook(webhook)


def _finish_webhook(webhook: ProviderWebhook) -> None:
    webhook.status = WebhookStatus.PROCESSED
    webhook.processed_at = timezone.now()
    webhook.error_message = ""
    webhook.save(update_fields=["status", "processed_at", "error_message", "updated_at"])


def _expire_intent(intent: PaymentIntent) -> None:
    previous = intent.status
    intent.status = IntentStatus.EXPIRED
    intent.next_action = {}
    intent.save(update_fields=["status", "next_action", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="payment_intent",
        aggregate_id=intent.id,
        actor=None,
        changes={"status": [previous, IntentStatus.EXPIRED]},
    )
    emit(
        DomainEvent(
            "payment.intent_expired.v1",
            "payment_intent",
            str(intent.id),
            {"tenant_id": str(intent.tenant_id), "lease_id": str(intent.lease_id)},
        )
    )


def _cancel_competing_intents(winner: PaymentIntent) -> None:
    rows = (
        PaymentIntent.objects.select_for_update()
        .filter(
            obligation_id=winner.obligation_id,
            status__in=OPEN_INTENT_STATUSES,
        )
        .exclude(id=winner.id)
    )
    for intent in rows:
        previous = intent.status
        intent.status = IntentStatus.CANCELLED
        intent.next_action = {}
        intent.failure_code = "obligation_settled"
        intent.failure_message = "Another provider-confirmed payment settled this obligation."
        intent.save(
            update_fields=[
                "status",
                "next_action",
                "failure_code",
                "failure_message",
                "updated_at",
            ]
        )
        record(
            action=AuditAction.UPDATE,
            aggregate_type="payment_intent",
            aggregate_id=intent.id,
            actor=None,
            changes={"status": [previous, IntentStatus.CANCELLED]},
            metadata={"settled_by_intent_id": str(winner.id)},
        )


@transaction.atomic
def expire_due_intents() -> int:
    rows = list(
        PaymentIntent.objects.select_for_update(skip_locked=True).filter(
            status__in=OPEN_INTENT_STATUSES,
            expires_at__lte=timezone.now(),
        )[:500]
    )
    for intent in rows:
        _expire_intent(intent)
    return len(rows)


def _rent_method(payment_method: str) -> str:
    return {
        DigitalPaymentMethod.MOBILE_MONEY: "momo",
        DigitalPaymentMethod.CARD: "other",
        DigitalPaymentMethod.BANK_TRANSFER: "bank",
    }[payment_method]


def _create_ledger(transaction_row: PaymentTransaction) -> None:
    occurred_at = transaction_row.paid_at or timezone.now()
    lines = [
        (1, f"psp_settlement_in_transit:{transaction_row.provider}", LedgerDirection.DEBIT),
        (2, f"rent_obligation:{transaction_row.intent.obligation_id}", LedgerDirection.CREDIT),
    ]
    for number, account, direction in lines:
        entry = LedgerEntry(
            transaction=transaction_row,
            line_number=number,
            account_reference=account,
            direction=direction,
            description="Provider-confirmed rent obligation payment",
            occurred_at=occurred_at,
        )
        entry.amount_minor = transaction_row.amount_minor
        entry.amount_currency = transaction_row.amount_currency
        entry.save()


def _create_receipt(transaction_row: PaymentTransaction, obligation: RentCharge) -> Receipt:
    # From the tail of the id, not the head. These are UUIDv7, whose leading
    # 48 bits are a millisecond timestamp — a slice off the front is a clock
    # reading, and two receipts issued in the same quarter-second collided.
    receipt_number = f"RM-{transaction_row.created_at:%Y}-{transaction_row.id.hex[-12:].upper()}"
    issued_at = transaction_row.paid_at or timezone.now()
    snapshot = build_snapshot(
        transaction_row=transaction_row,
        obligation=obligation,
        receipt_number=receipt_number,
        issued_at=issued_at,
    )
    final_pdf = render_pdf(snapshot)
    return Receipt.objects.create(
        transaction=transaction_row,
        receipt_number=receipt_number,
        issued_at=issued_at,
        breakdown=snapshot,
        final_pdf=final_pdf,
        final_pdf_hash=hashlib.sha256(final_pdf).hexdigest(),
    )


def create_external_receipt(payment: RentPayment) -> Receipt:
    """Issue the canonical receipt for a mutually confirmed external payment.

    This deliberately creates no PaymentTransaction, allocation or settlement:
    those are PSP facts. The receipt points at the existing RentPayment claim
    that both parties confirmed and freezes exactly that evidence.
    """
    if payment.verification_source != PaymentVerificationSource.PARTY_CONFIRMATION:
        raise Conflict("Only an external payment can use the counterparty receipt path.")
    if payment.status != RentPaymentStatus.CONFIRMED or not payment.confirmed_at:
        raise Conflict("The other party must confirm this payment before a receipt is issued.")
    existing = Receipt.objects.filter(rent_record=payment).first()
    if existing is not None:
        return existing
    receipt_number = f"RM-{payment.created_at:%Y}-{payment.id.hex[-12:].upper()}"
    issued_at = payment.confirmed_at
    snapshot = build_external_snapshot(
        payment=payment,
        receipt_number=receipt_number,
        issued_at=issued_at,
    )
    final_pdf = render_pdf(snapshot)
    return Receipt.objects.create(
        rent_record=payment,
        receipt_number=receipt_number,
        issued_at=issued_at,
        breakdown=snapshot,
        final_pdf=final_pdf,
        final_pdf_hash=hashlib.sha256(final_pdf).hexdigest(),
    )


def _create_pending_settlement(transaction_row: PaymentTransaction) -> Settlement:
    row = Settlement(
        transaction=transaction_row,
        beneficiary=transaction_row.intent.lease.landlord,
        beneficiary_organization=transaction_row.intent.beneficiary_organization,
        payout_profile=transaction_row.intent.payout_profile,
        provider_subaccount_reference=transaction_row.intent.provider_subaccount_reference,
        provider_subaccount_id=transaction_row.intent.provider_subaccount_id,
        provider=transaction_row.provider,
        status="pending",
    )
    expected_fee = transaction_row.intent.platform_charge_minor
    for field, value in (
        ("gross", transaction_row.amount_minor),
        ("fee", expected_fee),
        ("net", transaction_row.amount_minor - expected_fee),
    ):
        setattr(row, f"{field}_amount_minor", value)
        setattr(row, f"{field}_amount_currency", transaction_row.amount_currency)
    row.save()
    return row
