"""Building the schedule, recording payments, agreeing them.

The confirmation rule is the whole point: whoever records a payment cannot also
confirm it. A receipt both parties stand behind is worth something in a dispute;
one party's word about their own payment is not, and the platform must not let
the two look alike.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.outbox.services import emit

from .models import (
    ChargeKind,
    ChargeStatus,
    ExpenseCategory,
    ObligationAdjustment,
    ObligationAdjustmentKind,
    PaymentStatus,
    PaymentVerificationSource,
    PropertyExpense,
    RentCharge,
    RentPayment,
)

#: Ghanaian tenancies are paid in blocks, not monthly instalments. A 30-day
#: month is the approximation the lease already uses for its end date.
DAYS_PER_MONTH = 30


@transaction.atomic
def record_expense(*, organization, prop, user, data: dict) -> PropertyExpense:
    """Record an internal cost; this deliberately does not move money."""
    from apps.organization.services import can_access_property

    if (
        not can_access_property(prop=prop, user=user)
        or not prop.organization_relationships.filter(
            organization=organization, ended_at__isnull=True
        ).exists()
    ):
        raise PermissionDenied("You cannot record expenses for this property.")
    amount_minor = int(data.get("amount_minor") or 0)
    if amount_minor <= 0:
        raise ValidationFailed("Enter the expense amount.")
    if not data.get("incurred_on"):
        raise ValidationFailed("Enter the date of the expense.")
    if data["incurred_on"] > timezone.localdate():
        raise ValidationFailed("An expense date cannot be in the future.")
    category = data.get("category", ExpenseCategory.OTHER)
    if category not in ExpenseCategory.values:
        raise ValidationFailed("Choose a valid expense category.")

    expense = PropertyExpense(
        organization=organization,
        property=prop,
        category=category,
        incurred_on=data["incurred_on"],
        note=str(data.get("note", ""))[:300],
        recorded_by=user,
    )
    expense.amount_minor = amount_minor
    expense.amount_currency = data.get("amount_currency", "GHS")
    expense.save()
    record(
        action=AuditAction.MONEY_MOVEMENT,
        aggregate_type="property_expense",
        aggregate_id=expense.id,
        actor=user,
        metadata={
            "organization_id": str(organization.id),
            "property_id": str(prop.id),
            "amount_minor": amount_minor,
            "category": category,
            "record_only": True,
        },
    )
    return expense


@transaction.atomic
def build_schedule(lease) -> list[RentCharge]:
    """Work out everything the tenancy owes, once, when it goes live.

    The shape follows how these tenancies actually run: a large amount at the
    start covering several months, then the next block when that runs out.
    """
    from apps.lease.models import Lease, LeaseStatus

    # The lease is the lock for the whole schedule. Without it the guard below
    # is a read followed by a write: two deliveries of `lease.activated.v1`
    # arriving together would both see no charges and both write a full
    # schedule, and nothing in the table forbids the duplicate — a tenant
    # billed twice for one tenancy.
    Lease.objects.select_for_update().filter(pk=lease.pk).first()

    # "Already built" is answered before "may we build", and the order matters.
    # `lease.activated.v1` is delivered at least once, so a redelivery can
    # arrive after the tenancy has ended — the worker was down, the event was
    # reclaimed, the dispatcher was behind. Asking the lifecycle question first
    # made that redelivery raise `Conflict` on a schedule that already existed
    # and was already correct, so the event failed, retried, and finally
    # dead-lettered: a permanent red mark for work that was complete.
    if RentCharge.objects.filter(lease=lease).exists():
        return list(RentCharge.objects.filter(lease=lease))

    # Only a genuinely new schedule is a lifecycle question. Billing a tenancy
    # that is over remains refused.
    if (
        lease.status == LeaseStatus.ENDED
        or lease.ended_on is not None
        or (lease.ends_on is not None and timezone.localdate() > lease.ends_on)
    ):
        raise Conflict("An ended or expired agreement cannot generate new rent obligations.")

    rent = lease.rent_minor or 0
    currency = lease.rent_currency or "GHS"
    charges: list[RentCharge] = []

    def add(kind, months, due_on, period_start=None, period_end=None):
        if months <= 0:
            return
        charge = RentCharge(
            lease=lease,
            kind=kind,
            due_on=due_on,
            period_start=period_start,
            period_end=period_end,
        )
        charge.amount_minor = rent * months
        charge.amount_currency = currency
        charge.save()
        charges.append(charge)

    start = lease.starts_on
    advance = lease.advance_months or 0

    # Everything due before the keys change hands.
    if advance:
        add(
            ChargeKind.ADVANCE,
            advance,
            start,
            period_start=start,
            period_end=start + timedelta(days=DAYS_PER_MONTH * advance),
        )
    add(ChargeKind.DEPOSIT, lease.deposit_months or 0, start)
    add(ChargeKind.AGENCY_FEE, lease.agency_fee_months or 0, start)

    # Then the rest of the term, in blocks the same size as the advance. A
    # tenancy whose advance covers the whole term has nothing further to pay,
    # which is the common case for a one-year advance on a one-year term.
    covered = advance
    block = advance or lease.term_months
    while block and covered < (lease.term_months or 0):
        remaining = lease.term_months - covered
        months = min(block, remaining)
        period_start = start + timedelta(days=DAYS_PER_MONTH * covered)
        add(
            ChargeKind.RENT,
            months,
            period_start,
            period_start=period_start,
            period_end=period_start + timedelta(days=DAYS_PER_MONTH * months),
        )
        covered += months

    record(
        action=AuditAction.CREATE,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=None,
        metadata={"event": "rent_schedule_built", "charges": len(charges)},
    )
    return charges


def get_payment_or_404(pk) -> RentPayment:
    payment = (
        RentPayment.objects.filter(id=pk)
        .select_related(
            "lease__unit__property__owner",
            "lease__unit__property__address__locality__district__region",
            "lease__tenant",
            "lease__landlord",
            "lease__bed",
            "charge",
            "recorded_by",
            "confirmed_by",
            "evidence_file",
        )
        .first()
    )
    if payment is None:
        raise NotFound("We could not find that payment.")
    return payment


def assert_party(lease, user) -> None:
    if str(lease.tenant_id) != str(user.id) and not lease.unit.property.is_managed_by(user):
        raise PermissionDenied("You do not have access to that tenancy.")


def assert_payment_capability_if_provider(lease, user) -> None:
    """Tenants may answer claims; external recording needs property authority.

    A payout destination is intentionally irrelevant. Cash or a direct bank/MoMo
    transfer already reached the provider outside Danpa HQ, so requiring Paystack
    setup would conflate evidence recording with platform collection.
    """
    if str(lease.tenant_id) == str(user.id):
        return
    from apps.property.capabilities import PropertyCapability, assert_property_capability

    assert_property_capability(
        prop=lease.unit.property,
        user=user,
        capability=PropertyCapability.LEASES,
    )


@transaction.atomic
def record_payment(*, lease, user, data: dict) -> RentPayment:
    """Say that money changed hands. The other side has to agree."""
    assert_party(lease, user)
    assert_payment_capability_if_provider(lease, user)

    amount_minor = data.get("amount_minor")
    if not amount_minor or int(amount_minor) <= 0:
        raise ValidationFailed("Enter the amount that was paid.")
    if not data.get("paid_on"):
        raise ValidationFailed("Enter the date it was paid.")
    if data["paid_on"] > timezone.now().date():
        raise ValidationFailed("That date is in the future.")

    is_provider = str(lease.tenant_id) != str(user.id)
    if is_provider and not data.get("charge_id"):
        raise ValidationFailed("Choose the outstanding obligation this payment belongs to.")

    charge = None
    if data.get("charge_id"):
        charge = (
            RentCharge.objects.select_for_update()
            .prefetch_related("adjustments")
            .filter(id=data["charge_id"], lease=lease)
            .first()
        )
        if charge is None:
            raise NotFound("We could not find that charge.")
        if charge.outstanding_minor <= 0:
            raise Conflict("That obligation no longer has an outstanding balance.")
        if int(amount_minor) > charge.outstanding_minor:
            raise Conflict("That payment would exceed the obligation's outstanding balance.")

    evidence_file = None
    if data.get("evidence_file_id"):
        from apps.files.models import FilePurpose, StoredFile

        evidence_file = StoredFile.objects.filter(id=data["evidence_file_id"]).first()
        if evidence_file is None or not evidence_file.is_owned_by(user):
            raise NotFound("We could not find that payment evidence.")
        if evidence_file.purpose != FilePurpose.PAYMENT_EVIDENCE:
            raise ValidationFailed("Choose a file uploaded as payment evidence.")
        if not evidence_file.is_usable:
            raise ValidationFailed("That payment evidence is still being checked.")

    payment = RentPayment(
        lease=lease,
        charge=charge,
        paid_on=data["paid_on"],
        method=data.get("method", "momo"),
        reference=(data.get("reference") or "")[:120],
        note=(data.get("note") or "")[:300],
        evidence_file=evidence_file,
        verification_source=PaymentVerificationSource.PARTY_CONFIRMATION,
        recorded_by=user,
    )
    payment.amount_minor = int(amount_minor)
    payment.amount_currency = data.get("amount_currency", lease.rent_currency or "GHS")
    payment.save()

    record(
        action=AuditAction.MONEY_MOVEMENT,
        aggregate_type="rent_payment",
        aggregate_id=payment.id,
        actor=user,
        metadata={
            "lease_id": str(lease.id),
            "amount_minor": payment.amount_minor,
            "method": payment.method,
            "source": "EXTERNAL",
            "evidence": "AWAITING_COUNTERPARTY_CONFIRMATION",
            "evidence_file_id": str(evidence_file.id) if evidence_file else None,
            "recorded_by_tenant": payment.recorded_by_tenant,
        },
    )
    emit(
        DomainEvent(
            "rent.payment_recorded.v1",
            "rent_payment",
            str(payment.id),
            {
                "lease_id": str(lease.id),
                "amount_minor": payment.amount_minor,
                "charge_id": str(charge.id) if charge else None,
                "method": payment.method,
                "recorded_by_tenant": payment.recorded_by_tenant,
            },
        )
    )
    return payment


@transaction.atomic
def confirm_payment(*, payment: RentPayment, user) -> RentPayment:
    """Agree that it happened. Only the party who did not record it may.

    This is the line that makes the record worth anything: a receipt is two
    people agreeing, not one person asserting.
    """
    lease = payment.lease
    assert_party(lease, user)
    assert_payment_capability_if_provider(lease, user)

    if str(payment.recorded_by_id) == str(user.id):
        raise PermissionDenied(
            "The other party has to confirm this, not the person who recorded it."
        )
    if payment.status != PaymentStatus.CLAIMED:
        raise Conflict("That payment record has already been answered.")

    charge = None
    if payment.charge_id:
        charge = (
            RentCharge.objects.select_for_update()
            .prefetch_related("adjustments")
            .get(id=payment.charge_id)
        )
        if payment.amount_minor > charge.outstanding_minor:
            raise Conflict(
                "That payment is now larger than the obligation's outstanding balance. "
                "Review the newer adjustments before confirming it."
            )

    payment.status = PaymentStatus.CONFIRMED
    payment.confirmed_by = user
    payment.confirmed_at = timezone.now()
    payment.disputed_at = None
    payment.dispute_reason = ""
    payment.save(
        update_fields=[
            "status",
            "confirmed_by",
            "confirmed_at",
            "disputed_at",
            "dispute_reason",
            "updated_at",
        ]
    )

    if charge is not None:
        _resettle(charge)

    receipt = None
    if payment.verification_source == PaymentVerificationSource.PARTY_CONFIRMATION:
        from apps.payments.services import create_external_receipt

        receipt = create_external_receipt(payment)

    record(
        action=AuditAction.MONEY_MOVEMENT,
        aggregate_type="rent_payment",
        aggregate_id=payment.id,
        actor=user,
        changes={"status": [PaymentStatus.CLAIMED, PaymentStatus.CONFIRMED]},
        metadata={
            "source": "EXTERNAL",
            "evidence": "COUNTERPARTY_CONFIRMED",
            "receipt_id": str(receipt.id) if receipt else None,
        },
    )
    emit(
        DomainEvent(
            "rent.payment_confirmed.v1",
            "rent_payment",
            str(payment.id),
            {
                "lease_id": str(lease.id),
                "amount_minor": payment.amount_minor,
                "receipt_id": str(receipt.id) if receipt else None,
            },
        )
    )
    return payment


@transaction.atomic
def dispute_payment(*, payment: RentPayment, user, reason: str = "") -> RentPayment:
    """Say it did not happen, or not like that. Never deletes the claim."""
    lease = payment.lease
    assert_party(lease, user)
    assert_payment_capability_if_provider(lease, user)

    if payment.verification_source == PaymentVerificationSource.PSP:
        raise Conflict(
            "A provider-confirmed payment cannot be changed through the offline claim workflow. "
            "It requires payment reconciliation."
        )

    if str(payment.recorded_by_id) == str(user.id):
        raise PermissionDenied("You cannot dispute your own record. Correct it instead.")

    if payment.status == PaymentStatus.DISPUTED:
        raise Conflict("That payment record is already disputed.")

    charge = None
    if payment.charge_id:
        # Same lock `confirm_payment` takes, for the same reason: both end in
        # `_resettle`, which recomputes the charge's paid total from every
        # confirmed payment. Without the lock a dispute and a confirmation of
        # two different claims against one charge can each read the set before
        # the other commits, and the later write silently discards the earlier.
        charge = RentCharge.objects.select_for_update().get(id=payment.charge_id)

    was_confirmed = payment.status == PaymentStatus.CONFIRMED
    payment.status = PaymentStatus.DISPUTED
    payment.disputed_at = timezone.now()
    payment.dispute_reason = reason[:300]
    payment.confirmed_by = None
    payment.confirmed_at = None
    payment.save(
        update_fields=[
            "status",
            "disputed_at",
            "dispute_reason",
            "confirmed_by",
            "confirmed_at",
            "updated_at",
        ]
    )

    if charge is not None and was_confirmed:
        _resettle(charge)

    record(
        action=AuditAction.MONEY_MOVEMENT,
        aggregate_type="rent_payment",
        aggregate_id=payment.id,
        actor=user,
        changes={
            "status": [
                PaymentStatus.CONFIRMED if was_confirmed else PaymentStatus.CLAIMED,
                PaymentStatus.DISPUTED,
            ]
        },
        metadata={
            "reason": reason[:200],
            "source": "EXTERNAL",
            "evidence": "DISPUTED",
        },
    )
    emit(
        DomainEvent(
            "rent.payment_disputed.v1",
            "rent_payment",
            str(payment.id),
            {"lease_id": str(lease.id)},
        )
    )
    return payment


def _resettle(charge: RentCharge) -> None:
    """Recompute a charge from confirmed payments and immutable adjustments.

    Claims never move a balance. If they did, either party could clear their own
    debt by asserting it was paid.
    """
    total = (
        charge.payments.filter(status=PaymentStatus.CONFIRMED)
        .aggregate(total=Sum("amount_minor"))
        .get("total")
        or 0
    )
    charge.amount_paid_minor = total
    charge.amount_paid_currency = charge.amount_currency

    if charge.status != ChargeStatus.CANCELLED:
        adjustments = charge.adjustments.aggregate(total=Sum("amount_minor")).get("total") or 0
        waiver = (
            charge.adjustments.filter(kind=ObligationAdjustmentKind.WAIVER)
            .aggregate(total=Sum("amount_minor"))
            .get("total")
            or 0
        )
        write_off = adjustments - waiver
        resolved = total + adjustments
        if resolved >= (charge.amount_minor or 0):
            # Any non-cash adjustment keeps this out of Paid. Paid means money
            # was actually received for the whole obligation.
            if not adjustments:
                charge.status = ChargeStatus.PAID
            elif waiver and not write_off and not total:
                charge.status = ChargeStatus.WAIVED
            elif write_off and not waiver and not total:
                charge.status = ChargeStatus.WRITTEN_OFF
            else:
                charge.status = ChargeStatus.ADJUSTED
            charge.settled_at = charge.settled_at or timezone.now()
        elif resolved > 0:
            # A partial non-cash adjustment does not make an obligation
            # "partly paid". The unadjusted remainder is still due; the
            # adjustment rows carry the released amount and its meaning.
            charge.status = ChargeStatus.PART_PAID if total > 0 else ChargeStatus.DUE
            charge.settled_at = None
        else:
            charge.status = ChargeStatus.DUE
            charge.settled_at = None

    charge.save(
        update_fields=[
            "amount_paid_minor",
            "amount_paid_currency",
            "status",
            "settled_at",
            "updated_at",
        ]
    )


def apply_confirmed_payment(payment: RentPayment) -> None:
    """Apply an independently confirmed payment to its obligation.

    The digital-payment context owns provider verification; rent remains the
    one owner of charge settlement arithmetic.
    """
    if payment.status != PaymentStatus.CONFIRMED or payment.charge_id is None:
        raise ValidationFailed("Only a confirmed payment tied to a charge can settle it.")
    _resettle(payment.charge)


@transaction.atomic
def adjust_obligation(
    *,
    charge: RentCharge,
    user,
    kind: str,
    amount_minor: int | None,
    reason: str,
) -> ObligationAdjustment:
    """Post an immutable waiver/write-off without pretending money was paid."""
    from .permissions import ObligationCapability, assert_obligation_capability

    if kind not in ObligationAdjustmentKind.values:
        raise ValidationFailed("Choose a valid obligation adjustment.")
    capability = (
        ObligationCapability.WAIVE
        if kind == ObligationAdjustmentKind.WAIVER
        else ObligationCapability.WRITE_OFF
    )
    # Re-read under the transaction before checking the lifecycle. An owner may
    # have ended the tenancy in another request since this charge was loaded.
    charge = (
        RentCharge.objects.select_for_update()
        .select_related("lease__unit__property", "lease__landlord")
        .prefetch_related("adjustments")
        .get(id=charge.id)
    )
    assert_obligation_capability(charge=charge, user=user, capability=capability)

    note = (reason or "").strip()
    if not note:
        raise ValidationFailed("Enter a reason for this financial adjustment.")
    remaining = charge.outstanding_minor
    amount = remaining if amount_minor is None else int(amount_minor)
    if remaining <= 0:
        raise Conflict("That obligation no longer has an outstanding balance.")
    if amount <= 0:
        raise ValidationFailed("Enter a positive adjustment amount.")
    if amount > remaining:
        raise Conflict("That adjustment would exceed the outstanding balance.")

    adjustment = ObligationAdjustment(
        obligation=charge,
        kind=kind,
        reason=note[:300],
        actor=user,
        effective_at=timezone.now(),
    )
    adjustment.amount_minor = amount
    adjustment.amount_currency = charge.amount_currency or "GHS"
    adjustment.save()
    _resettle(charge)

    record(
        action=AuditAction.MONEY_MOVEMENT,
        aggregate_type="rent_obligation_adjustment",
        aggregate_id=adjustment.id,
        actor=user,
        metadata={
            "lease_id": str(charge.lease_id),
            "obligation_id": str(charge.id),
            "kind": kind,
            "amount_minor": amount,
            "original_amount_minor": charge.amount_minor,
            "remaining_minor": max(remaining - amount, 0),
            "reason": note[:300],
            "non_cash_adjustment": True,
        },
    )
    event_type = (
        "rent.obligation_waived.v1"
        if kind == ObligationAdjustmentKind.WAIVER
        else "rent.obligation_written_off.v1"
    )
    emit(
        DomainEvent(
            event_type,
            "rent_obligation_adjustment",
            str(adjustment.id),
            {
                "lease_id": str(charge.lease_id),
                "obligation_id": str(charge.id),
                "amount_minor": amount,
            },
        )
    )
    return adjustment


def waive_charge(
    *, charge: RentCharge, user, reason: str = "", amount_minor: int | None = None
) -> RentCharge:
    """Compatibility wrapper; the evidence is the adjustment, never a rewrite."""
    adjust_obligation(
        charge=charge,
        user=user,
        kind=ObligationAdjustmentKind.WAIVER,
        amount_minor=amount_minor,
        reason=reason,
    )
    charge.refresh_from_db()
    return charge


def write_off_charge(
    *, charge: RentCharge, user, reason: str, amount_minor: int | None = None
) -> RentCharge:
    adjust_obligation(
        charge=charge,
        user=user,
        kind=ObligationAdjustmentKind.WRITE_OFF,
        amount_minor=amount_minor,
        reason=reason,
    )
    charge.refresh_from_db()
    return charge


def closing_financial_summary(*, lease) -> dict:
    """A read model derived from obligations, adjustments, payments and refunds."""
    charges = list(
        RentCharge.objects.filter(lease=lease)
        .exclude(status=ChargeStatus.CANCELLED)
        .prefetch_related("adjustments")
    )
    rent_kinds = {ChargeKind.ADVANCE, ChargeKind.RENT}
    unresolved_before_adjustments = {
        charge.id: max((charge.amount_minor or 0) - (charge.amount_paid_minor or 0), 0)
        for charge in charges
    }
    unpaid_rent = sum(
        unresolved_before_adjustments[charge.id] for charge in charges if charge.kind in rent_kinds
    )
    other_charges = sum(
        unresolved_before_adjustments[charge.id]
        for charge in charges
        if charge.kind not in rent_kinds
    )
    waived = sum(charge.waived_minor for charge in charges)
    written_off = sum(charge.written_off_minor for charge in charges)

    # A decided, not-yet-completed refund is a live credit owed to the tenant.
    # Completed refunds remain visible in history but no longer reduce the live
    # balance a second time.
    from apps.payments.models import Refund, RefundStatus

    refunds = Refund.objects.filter(transaction__intent__lease=lease)
    credits = (
        refunds.filter(status__in=[RefundStatus.APPROVED, RefundStatus.PROCESSING])
        .aggregate(total=Sum("amount_minor"))
        .get("total")
        or 0
    )
    refunded = (
        refunds.filter(status=RefundStatus.COMPLETED)
        .aggregate(total=Sum("amount_minor"))
        .get("total")
        or 0
    )
    net = unpaid_rent + other_charges - waived - written_off - credits
    ended_on = lease.ended_on
    tenancy = getattr(lease, "tenancy", None)
    if ended_on is None and tenancy is not None:
        ended_on = tenancy.ended_on
    return {
        "is_post_tenancy": lease.status == "ended",
        "tenancy_ended_on": ended_on,
        "unpaid_rent_minor": unpaid_rent,
        "other_charges_minor": other_charges,
        "credits_minor": credits,
        "refunded_minor": refunded,
        "waived_minor": waived,
        "written_off_minor": written_off,
        "outstanding_balance_minor": max(net, 0),
        "credit_balance_minor": max(-net, 0),
        "currency": lease.rent_currency or "GHS",
    }


def close_schedule(*, lease, through=None, reason: str) -> int:
    """Stop billing for periods that are never going to happen.

    The schedule is written in full the moment a tenancy goes live, because
    that is when the term is known. The consequence nobody had handled is that
    a tenancy which stops early leaves the rest of its year sitting in the
    database marked `due` — and those charges went on ageing into "overdue"
    forever, on a provider's dashboard, for a room that somebody had already
    moved out of.

    ``through`` is the last day still genuinely owed:

    - **A tenancy that ended** passes today. Charges already due are real
      arrears and stay owed — somebody who left owing two months still owes
      them, and clearing that would quietly forgive a debt. Only the unrun
      remainder is closed.
    - **An agreement replaced by an amendment** passes ``None``, closing the
      whole unpaid schedule. The replacement covers the same term and bills it
      afresh, so leaving both would bill the tenant twice for one tenancy.

    A charge with money against it is never touched. What was actually paid is
    evidence, and it stays exactly as it is.
    """
    # "Nothing paid against it" is two conditions, because the amount is
    # nullable: a charge nobody has paid carries NULL, not zero.
    charges = RentCharge.objects.filter(
        lease=lease, status__in=[ChargeStatus.DUE, ChargeStatus.PART_PAID]
    ).filter(Q(amount_paid_minor__isnull=True) | Q(amount_paid_minor=0))
    if through is not None:
        charges = charges.filter(due_on__gt=through)

    closed = 0
    for charge in list(charges):
        charge.status = ChargeStatus.CANCELLED
        charge.save(update_fields=["status", "updated_at"])
        record(
            action=AuditAction.UPDATE,
            aggregate_type="rent_charge",
            aggregate_id=charge.id,
            actor=None,
            changes={"status": [ChargeStatus.DUE, ChargeStatus.CANCELLED]},
            metadata={"reason": reason, "lease_id": str(lease.id)},
        )
        closed += 1
    return closed


def payment_record(*, lease_ids, today=None) -> dict:
    """What the rent ledger can say about a set of leases, and on whose word.

    Read by the Housing Passport for one tenancy's leases. Every count is a
    count of something both parties (or a payment provider) stand behind, a
    claim still waiting for the other side, or a disagreement - never a blend.
    A tenancy with nothing recorded returns zeros, which the caller must treat
    as an absence of records rather than as a poor record.

    Overdue is a charge past its due date with money still outstanding. Waived,
    written-off and cancelled charges are decisions, not debts, and are left out.
    """
    today = today or timezone.localdate()
    ids = list(lease_ids)
    payments = RentPayment.objects.filter(lease_id__in=ids)
    confirmed = list(payments.filter(status=PaymentStatus.CONFIRMED).order_by("paid_on"))

    on_time = late = 0
    charges = (
        RentCharge.objects.filter(lease_id__in=ids)
        .exclude(status__in=[ChargeStatus.WAIVED, ChargeStatus.WRITTEN_OFF, ChargeStatus.CANCELLED])
        .prefetch_related("adjustments", "payments")
    )
    overdue = 0
    for charge in charges:
        if charge.status == ChargeStatus.PAID:
            settled = [
                row for row in charge.payments.all() if row.status == PaymentStatus.CONFIRMED
            ]
            last = max(settled, key=lambda row: row.paid_on, default=None)
            if last and last.paid_on <= charge.due_on:
                on_time += 1
            elif last:
                late += 1
        elif (
            charge.status in {ChargeStatus.DUE, ChargeStatus.PART_PAID}
            and charge.due_on < today
            and charge.outstanding_minor > 0
        ):
            overdue += 1

    return {
        "confirmed_count": len(confirmed),
        "confirmed_total_minor": sum(row.amount_minor or 0 for row in confirmed),
        # Of the confirmed payments, those a payment provider confirmed
        # server-side rather than the other party confirming by hand.
        "provider_confirmed_count": sum(
            1 for row in confirmed if row.verification_source == PaymentVerificationSource.PSP
        ),
        "awaiting_confirmation_count": payments.filter(status=PaymentStatus.CLAIMED).count(),
        "disputed_count": payments.filter(status=PaymentStatus.DISPUTED).count(),
        "charges_on_time": on_time,
        "charges_late": late,
        "charges_overdue": overdue,
        "first_paid_on": confirmed[0].paid_on if confirmed else None,
        "last_paid_on": confirmed[-1].paid_on if confirmed else None,
    }


def rental_history(*, user) -> dict:
    """A tenant's record, in a form they can show a future landlord.

    This is the thing this market has no equivalent of. A tenant with two years
    of confirmed payments has something to bargain with; today they have
    nothing, and every new landlord starts from suspicion.

    Only confirmed payments count. A record padded with one-sided claims would
    be worth exactly as much as the claims are.
    """
    from apps.lease.models import Lease, LeaseStatus

    leases = (
        Lease.objects.filter(tenant=user)
        .select_related("unit__property__address__locality", "landlord")
        .order_by("-starts_on")
    )

    confirmed = RentPayment.objects.filter(lease__tenant=user, status=PaymentStatus.CONFIRMED)
    total_confirmed = confirmed.aggregate(total=Sum("amount_minor")).get("total") or 0

    charges = RentCharge.objects.filter(lease__tenant=user).exclude(status=ChargeStatus.WAIVED)
    settled_on_time = 0
    settled_late = 0
    for charge in charges.filter(status=ChargeStatus.PAID):
        last = charge.payments.filter(status=PaymentStatus.CONFIRMED).order_by("-paid_on").first()
        if last and last.paid_on <= charge.due_on:
            settled_on_time += 1
        elif last:
            settled_late += 1

    return {
        "tenancies": leases,
        "tenancies_total": leases.count(),
        "tenancies_active": leases.filter(status=LeaseStatus.ACTIVE).count(),
        "payments_confirmed": confirmed.count(),
        "total_confirmed_minor": total_confirmed,
        "charges_settled_on_time": settled_on_time,
        "charges_settled_late": settled_late,
        "outstanding_minor": sum(
            charge.outstanding_minor
            for charge in charges.filter(status__in=[ChargeStatus.DUE, ChargeStatus.PART_PAID])
        ),
    }
