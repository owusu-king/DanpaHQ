"""Real database boundaries for payment-gated tenancy activation."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from threading import Barrier

import pytest
from django.db import close_old_connections, connections
from django.utils import timezone

from apps.core.exceptions import Conflict
from apps.lease import services as leases
from apps.lease.models import Lease, LeaseStatus
from apps.occupancy.models import Occupancy
from apps.outbox.models import OutboxEvent
from apps.payments import services as payments
from apps.payments.models import PaymentIntent, PaymentTransaction
from apps.tenancy.models import Tenancy
from tests.integration.test_lease import CANONICAL_TERMS
from tests.integration.test_payment_core import address as address
from tests.integration.test_payment_core import unit as payment_unit

pytestmark = pytest.mark.django_db(transaction=True)
unit = payment_unit


def accepted(*, landlord, tenant, unit, canonical=False, components=False):
    terms = {
        **(CANONICAL_TERMS if canonical else {}),
        "rent_minor": 10000,
        "advance_months": 1,
        "term_months": 1,
        "deposit_months": 1 if components else 0,
        "agency_fee_months": 1 if components else 0,
        "starts_on": date.today(),
    }
    lease = leases.draft_lease(user=landlord, unit=unit, tenant=tenant, data=terms)
    if canonical:
        leases.ready_lease(lease=lease, user=landlord)
    leases.offer_lease(lease=lease, user=landlord)
    if canonical:
        leases.record_tenant_review(lease=lease, user=tenant)
    return leases.accept_lease(lease=lease, user=tenant, acknowledged=True)


def activation_count(lease):
    return OutboxEvent.objects.filter(name="lease.activated.v1", aggregate_id=str(lease.id)).count()


def confirm(intent, *, event_id, status="succeeded"):
    from tests.integration.test_payment_core import signed_event

    raw, headers = signed_event(intent, event_id=event_id, status=status)
    return payments.process_webhook(provider_name="memory", raw_body=raw, headers=headers)


@pytest.mark.parametrize("canonical", [False, True])
def test_acceptance_creates_full_initial_obligations_without_activating(
    settings, landlord, user, unit, canonical
):
    settings.LEASE_ACTIVATION_REQUIREMENT = "disabled"
    lease = accepted(
        landlord=landlord, tenant=user, unit=unit, canonical=canonical, components=True
    )
    charges = list(lease.charges.order_by("created_at"))
    assert sorted(charge.amount_minor for charge in charges) == [10000, 10000, 10000]
    assert {charge.kind for charge in charges} == {"advance", "deposit", "agency_fee"}
    assert lease.tenancy_id is None and not Occupancy.objects.filter(lease=lease).exists()
    if canonical:
        assert lease.status == LeaseStatus.TENANT_ACCEPTED
        lease = leases.confirm_lease(lease=lease, user=landlord)
    assert lease.status == LeaseStatus.AWAITING_ACTIVATION
    assert lease.activation_requirement == "initial_payment"
    for index, charge in enumerate(charges):
        intent = payments.create_intent(obligation=charge, user=user, payment_method="mobile_money")
        lease.refresh_from_db()
        assert lease.status == LeaseStatus.AWAITING_ACTIVATION
        confirm(intent, event_id=f"component-{index}")
        lease.refresh_from_db()
        assert lease.status == (
            LeaseStatus.ACTIVE if index == 2 else LeaseStatus.AWAITING_ACTIVATION
        )
    assert activation_count(lease) == 1
    assert Tenancy.objects.filter(activation_lease=lease).count() == 1
    assert Occupancy.objects.filter(lease=lease).count() == 1


def test_pending_failed_retry_and_delayed_success_stay_consistent(landlord, user, unit):
    lease = accepted(landlord=landlord, tenant=user, unit=unit)
    intent = payments.create_intent(
        obligation=lease.charges.get(), user=user, payment_method="card"
    )
    confirm(intent, event_id="pending", status="pending")
    confirm(intent, event_id="failure", status="failed")
    lease.refresh_from_db()
    assert lease.status == LeaseStatus.AWAITING_ACTIVATION and lease.tenancy_id is None
    assert activation_count(lease) == 0
    payments.retry_intent(intent=intent, user=user)
    # A genuine late callback is still evidence even after the local attempt expires.
    PaymentIntent.objects.filter(pk=intent.pk).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    from tests.integration.test_payment_core import signed_event

    raw, headers = signed_event(intent, event_id="paid")
    payments.process_webhook(provider_name="memory", raw_body=raw, headers=headers)
    payments.process_webhook(provider_name="memory", raw_body=raw, headers=headers)
    lease.refresh_from_db()
    intent.refresh_from_db()
    assert intent.status == "succeeded" and lease.status == LeaseStatus.ACTIVE
    assert intent.transactions.filter(status="succeeded").count() == 1
    assert activation_count(lease) == 1
    assert lease.charges.get().outstanding_minor == 0


def test_legacy_activation_flag_cannot_bypass_payment(landlord, user, unit):
    lease = accepted(landlord=landlord, tenant=user, unit=unit)
    Lease.objects.filter(pk=lease.pk).update(activation_requirement="lease_accepted")
    with pytest.raises(Conflict, match="upfront"):
        leases.activate_lease(lease=lease, actor=landlord, satisfied_requirement="lease_accepted")
    lease.refresh_from_db()
    assert lease.status == LeaseStatus.AWAITING_ACTIVATION and lease.tenancy_id is None


def test_concurrent_duplicate_webhooks_activate_and_post_money_once(landlord, user, unit):
    from tests.integration.test_payment_core import signed_event

    lease = accepted(landlord=landlord, tenant=user, unit=unit)
    charge = lease.charges.get()
    intent = payments.create_intent(obligation=charge, user=user, payment_method="mobile_money")
    raw, headers = signed_event(intent, event_id="concurrent-payment")
    barrier = Barrier(2)

    def deliver():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            row = payments.process_webhook(provider_name="memory", raw_body=raw, headers=headers)
            return str(row.id)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: deliver(), range(2)))
    assert results == [str(intent.id), str(intent.id)]
    lease.refresh_from_db()
    assert lease.status == LeaseStatus.ACTIVE and activation_count(lease) == 1
    tx = PaymentTransaction.objects.get(intent=intent, status="succeeded")
    assert tx.allocations.count() == 1 and tx.ledger_entries.count() == 2
    assert tx.receipt and tx.settlement
    assert Tenancy.objects.filter(activation_lease=lease).count() == 1
    assert Occupancy.objects.filter(lease=lease).count() == 1


def test_concurrent_component_confirmations_activate_once(landlord, user, unit):
    from tests.integration.test_payment_core import signed_event

    lease = accepted(landlord=landlord, tenant=user, unit=unit, components=True)
    charges = list(lease.charges.order_by("created_at"))
    intents = [payments.create_intent(obligation=charge, user=user, payment_method="card")
               for charge in charges]
    confirm(intents[0], event_id="first-component")
    events = [signed_event(intent, event_id=f"final-component-{index}")
              for index, intent in enumerate(intents[1:])]
    barrier = Barrier(2)

    def deliver(event):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            raw, headers = event
            payments.process_webhook(provider_name="memory", raw_body=raw, headers=headers)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(deliver, events))
    lease.refresh_from_db()
    assert lease.status == LeaseStatus.ACTIVE and activation_count(lease) == 1
    assert PaymentTransaction.objects.filter(intent__lease=lease, status="succeeded").count() == 3
    assert Tenancy.objects.filter(activation_lease=lease).count() == 1
    assert Occupancy.objects.filter(lease=lease).count() == 1


def test_paid_legacy_lease_can_retry_reviewed_activation_over_http(
    landlord, user, unit, monkeypatch
):
    from rest_framework.test import APIClient

    lease = accepted(landlord=landlord, tenant=user, unit=unit)
    Lease.objects.filter(pk=lease.pk).update(activation_requirement="lease_accepted")
    lease.refresh_from_db()
    assert payments.digital_payment_availability(lease=lease, user=user)["available"] is True
    intent = payments.create_intent(
        obligation=lease.charges.get(), user=user, payment_method="card"
    )

    def needs_review(**kwargs):
        raise Conflict("Provider authority needs review.")

    with monkeypatch.context() as patch:
        patch.setattr(leases, "activate_lease", needs_review)
        confirm(intent, event_id="paid-legacy-review")
    lease.refresh_from_db()
    assert lease.status == LeaseStatus.AWAITING_ACTIVATION
    assert leases.initial_payment_satisfied(lease)
    api = APIClient()
    api.force_authenticate(user=landlord)
    for _ in range(2):
        response = api.post(f"/api/v1/leases/{lease.id}/activate/", {}, format="json")
        assert response.status_code == 200, response.data
        assert response.data["status"] == "active"
    assert activation_count(lease) == 1
    assert PaymentTransaction.objects.filter(intent=intent, status="succeeded").count() == 1
    assert Tenancy.objects.filter(activation_lease=lease).count() == 1
    assert Occupancy.objects.filter(lease=lease).count() == 1
