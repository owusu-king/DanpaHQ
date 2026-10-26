"""The second half of Danpa HQ's chain, walked end to end over HTTP.

`test_core_lifecycle_smoke` proves the rental contract from registration as far
as a two-party rent record. Everything after that — processor-confirmed money,
the allocation that says which obligation it answers for, the balanced ledger,
the receipt, the settlement that is deliberately *not* the payment, and then the
end of the tenancy and what survives it — was proven only in pieces.

A chain tested only in pieces is a chain nobody has walked. This walks it, over
the same HTTP surface both clients use, and it fails if any link stops
connecting to the next.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import date

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.lease import services as lease_services
from apps.payments.models import (
    LedgerDirection,
    LedgerEntry,
    PaymentAllocation,
    PaymentTransaction,
    Settlement,
    SettlementStatus,
)
from apps.rent import services as rent_services
from apps.rent.models import ChargeStatus, RentCharge

pytestmark = pytest.mark.django_db


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


@pytest.fixture
def unit(landlord, address, approve_provider):
    from apps.property.models import Property, Unit

    prop = Property.objects.create(
        owner=landlord, address=address, title="Osu Court", property_type="apartment"
    )
    approve_provider(landlord, prop)
    return Unit.objects.create(property=prop, label="Flat 2", bedrooms=1, bathrooms=1)


@pytest.fixture
def active_lease(landlord, user, unit):
    lease = lease_services.draft_lease(
        user=landlord,
        unit=unit,
        tenant=user,
        data={
            "rent_minor": 150000,
            "advance_months": 6,
            "deposit_months": 1,
            "starts_on": date.today(),
            "term_months": 12,
        },
    )
    lease_services.offer_lease(lease=lease, user=landlord)
    lease = lease_services.accept_lease(lease=lease, user=user)
    rent_services.build_schedule(lease)
    return lease


def _signed_callback(reference: str, *, amount_minor: int, currency: str, secret: str):
    event = {
        "event_id": "smoke-evt-1",
        "event_type": "payment.succeeded",
        "provider_reference": reference,
        "provider_transaction_id": "smoke-psp-txn-1",
        "status": "succeeded",
        "amount_minor": amount_minor,
        "currency": currency,
        "payment_method": "mobile_money",
        "occurred_at": timezone.now().isoformat(),
    }
    body = json.dumps(event).encode()
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return body, signature


def test_money_flows_from_checkout_to_closing_balance(
    landlord, user, agent, active_lease, sign_in_as, settings
):
    tenant_api = APIClient()
    sign_in_as(tenant_api, user=user, device_fingerprint="money-smoke-tenant")
    provider_api = APIClient()
    sign_in_as(provider_api, user=landlord, device_fingerprint="money-smoke-provider")

    lease_id = str(active_lease.id)

    # --- the tenant is offered checkout, on the server's terms ---------------
    schedule = tenant_api.get(f"/api/v1/leases/{lease_id}/charges/")
    assert schedule.status_code == 200, schedule.data
    advance = next(row for row in schedule.data["charges"] if row["kind"] == "advance")
    availability = schedule.data["digital_payment"]
    assert availability["available"] is True, availability
    assert availability["allows_partial"] is True
    assert availability["outstanding_minor"] == advance["outstanding_minor"]

    # --- a part payment, priced by the server and never by the client --------
    part = advance["outstanding_minor"] // 2
    overreach = tenant_api.post(
        "/api/v1/payments/intents/",
        {
            "obligation_id": advance["id"],
            "payment_method": "mobile_money",
            "amount_minor": advance["outstanding_minor"] + 1,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="money-smoke-overreach-01",
    )
    assert overreach.status_code == 409, overreach.data

    intent = tenant_api.post(
        "/api/v1/payments/intents/",
        {
            "obligation_id": advance["id"],
            "payment_method": "mobile_money",
            "amount_minor": part,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="money-smoke-intent-001",
    )
    assert intent.status_code == 201, intent.data
    assert intent.data["amount_minor"] == part

    replay = tenant_api.post(
        "/api/v1/payments/intents/",
        {
            "obligation_id": advance["id"],
            "payment_method": "mobile_money",
            "amount_minor": part,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="money-smoke-intent-001",
    )
    assert replay.status_code == 201
    assert replay.data["id"] == intent.data["id"]
    assert replay.headers.get("X-Idempotent-Replay") == "true"

    # --- only a signed provider callback moves money ------------------------
    forged = APIClient().post(
        "/api/v1/webhooks/payments/memory/",
        data=b'{"status": "succeeded"}',
        content_type="application/json",
    )
    assert forged.status_code in (401, 403), forged.data
    assert not PaymentTransaction.objects.exists()

    body, signature = _signed_callback(
        intent.data["provider_reference"],
        amount_minor=part,
        currency=intent.data["amount_currency"],
        secret=settings.PAYMENT_TEST_WEBHOOK_SECRET,
    )
    confirmed = APIClient().post(
        "/api/v1/webhooks/payments/memory/",
        data=body,
        content_type="application/json",
        HTTP_X_PAYMENT_SIGNATURE=signature,
    )
    assert confirmed.status_code == 200, confirmed.data
    assert confirmed.data["intent_status"] == "succeeded"

    # The provider redelivering the same event changes nothing.
    again = APIClient().post(
        "/api/v1/webhooks/payments/memory/",
        data=body,
        content_type="application/json",
        HTTP_X_PAYMENT_SIGNATURE=signature,
    )
    assert again.status_code == 200
    assert PaymentTransaction.objects.filter(status="succeeded").count() == 1

    # --- every downstream record exists, exactly once ------------------------
    transaction_row = PaymentTransaction.objects.get(status="succeeded")
    allocation = PaymentAllocation.objects.get()
    assert allocation.transaction_id == transaction_row.id
    assert allocation.amount_minor == part

    lines = list(LedgerEntry.objects.filter(transaction=transaction_row))
    assert len(lines) == 2
    debits = sum(row.amount_minor for row in lines if row.direction == LedgerDirection.DEBIT)
    credits = sum(row.amount_minor for row in lines if row.direction == LedgerDirection.CREDIT)
    assert debits == credits == part

    # Paid is not settled, and the product must never conflate the two.
    settlement = Settlement.objects.get(transaction=transaction_row)
    assert settlement.status == SettlementStatus.PENDING
    assert settlement.settled_at is None

    # --- the receipt is readable by the parties and nobody else -------------
    receipt_id = str(transaction_row.receipt.id)
    receipt = tenant_api.get(f"/api/v1/payments/receipts/{receipt_id}/")
    assert receipt.status_code == 200, receipt.data
    assert receipt.data["source"] == "PLATFORM_PSP"
    assert receipt.data["evidence"] == "PSP_CONFIRMED"

    document = tenant_api.get(f"/api/v1/payments/receipts/{receipt_id}/document.pdf")
    assert document.status_code == 200
    assert document["Content-Type"] == "application/pdf"
    assert provider_api.get(f"/api/v1/payments/receipts/{receipt_id}/").status_code == 200

    outsider_api = APIClient()
    sign_in_as(outsider_api, user=agent, device_fingerprint="money-smoke-outsider")
    assert outsider_api.get(f"/api/v1/payments/receipts/{receipt_id}/").status_code in (403, 404)
    assert outsider_api.get(f"/api/v1/leases/{lease_id}/charges/").status_code in (403, 404)

    # --- the obligation moved by exactly the amount that arrived ------------
    charge = RentCharge.objects.get(id=advance["id"])
    assert charge.status == ChargeStatus.PART_PAID
    assert charge.amount_paid_minor == part
    assert charge.outstanding_minor == advance["outstanding_minor"] - part

    # --- ending the tenancy resolves the future, never the debt -------------
    lease_services.end_lease(lease=active_lease, user=landlord, confirmed=True)
    from apps.outbox.tasks import dispatch_pending

    assert dispatch_pending()["failed"] == 0

    charge.refresh_from_db()
    assert charge.status == ChargeStatus.PART_PAID, "incurred arrears survive the end"
    assert charge.outstanding_minor > 0

    unrun = RentCharge.objects.filter(lease=active_lease, due_on__gt=date.today())
    assert unrun.exists(), "the fixture's term should leave later periods to close"
    assert all(
        row.status == ChargeStatus.CANCELLED for row in unrun
    ), "a period nobody lived through is cancelled, never left ageing into overdue"

    # --- the surviving balance is still payable and still closable ----------
    ledger = tenant_api.get(f"/api/v1/leases/{lease_id}/charges/")
    assert ledger.status_code == 200
    summary = ledger.data["financial_summary"]
    assert summary["is_post_tenancy"] is True

    # Every charge already incurred survives, not only the part-paid one: the
    # deposit fell due on move-in day too, and a tenancy ending does not forgive
    # it. Cancelled future periods contribute nothing.
    surviving = [
        row
        for row in RentCharge.objects.filter(lease=active_lease)
        if row.status != ChargeStatus.CANCELLED
    ]
    assert summary["outstanding_balance_minor"] == sum(row.outstanding_minor for row in surviving)
    assert charge.outstanding_minor in [row.outstanding_minor for row in surviving]

    remaining = charge.outstanding_minor
    waiver = provider_api.post(
        f"/api/v1/rent/charges/{charge.id}/waive/",
        {
            "amount_minor": remaining,
            "reason": "Settled at the move-out inspection",
            "confirmed": True,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="money-smoke-waive-0001",
    )
    assert waiver.status_code == 200, waiver.data

    charge.refresh_from_db()
    # Money was received *and* the remainder released, so neither word alone is
    # true: it is not `paid`, and it is not purely `waived`.
    assert charge.status == ChargeStatus.ADJUSTED
    assert charge.outstanding_minor == 0

    closing = tenant_api.get(f"/api/v1/leases/{lease_id}/charges/").data["financial_summary"]
    assert closing["waived_minor"] == remaining
    # The waiver released this charge and nothing else; the deposit is still owed.
    assert closing["outstanding_balance_minor"] == sum(
        row.outstanding_minor
        for row in RentCharge.objects.filter(lease=active_lease)
        if row.status != ChargeStatus.CANCELLED
    )

    # --- and none of it rewrote the history the tenant can hold up later ----
    assert PaymentTransaction.objects.filter(status="succeeded").count() == 1
    assert PaymentAllocation.objects.count() == 1
    history = tenant_api.get("/api/v1/me/rental-history/")
    assert history.status_code == 200
    assert history.data["payments_confirmed"] >= 1


def test_a_redelivered_activation_after_the_tenancy_ends_is_not_a_failure(
    landlord, user, active_lease
):
    """Dispatch is at-least-once, so "late" is a state the handler must survive.

    `lease.activated.v1` can reach the dispatcher after the tenancy has already
    ended — the worker was down, the event was reclaimed from a dead claim, the
    queue was behind. `build_schedule` asked the lifecycle question before the
    already-built question, so that redelivery raised `Conflict` about a
    schedule that existed and was already correct. The event then failed,
    retried, and dead-lettered: a permanent red mark for completed work, and
    one that would drag every other subscriber on the same event down with it.
    """
    from apps.outbox.models import OutboxEvent, OutboxStatus
    from apps.outbox.tasks import dispatch_pending
    from apps.rent.handlers import on_lease_activated

    before = list(RentCharge.objects.filter(lease=active_lease).values_list("id", flat=True))
    assert before, "the fixture builds a schedule"

    lease_services.end_lease(lease=active_lease, user=landlord, confirmed=True)
    assert dispatch_pending()["failed"] == 0

    # Now replay the activation, exactly as a reclaimed event would.
    event = OutboxEvent.objects.filter(name="lease.activated.v1").first()
    assert event is not None
    on_lease_activated(event)

    after = list(RentCharge.objects.filter(lease=active_lease).values_list("id", flat=True))
    assert sorted(after) == sorted(before), "no second schedule, no second bill"

    OutboxEvent.objects.filter(id=event.id).update(
        status=OutboxStatus.PENDING, attempts=0, last_error=""
    )
    assert dispatch_pending()["failed"] == 0


def test_an_ended_tenancy_still_refuses_a_brand_new_schedule(landlord, user, unit):
    """Tolerating a redelivery must not become tolerating a new bill."""
    from apps.core.exceptions import Conflict

    lease = lease_services.draft_lease(
        user=landlord,
        unit=unit,
        tenant=user,
        data={
            "rent_minor": 150000,
            "advance_months": 6,
            "deposit_months": 1,
            "starts_on": date.today(),
            "term_months": 12,
        },
    )
    lease_services.offer_lease(lease=lease, user=landlord)
    lease = lease_services.accept_lease(lease=lease, user=user)
    RentCharge.objects.filter(lease=lease).delete()
    lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
    lease.refresh_from_db()

    with pytest.raises(Conflict, match="cannot generate new rent obligations"):
        rent_services.build_schedule(lease)
