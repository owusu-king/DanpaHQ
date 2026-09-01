"""The financial invariants that a service guard alone was not enough to keep.

Each test here corresponds to a way money could have gone wrong that the code
believed was already impossible:

- an allocation or a waiver could be rewritten by any queryset that reached it,
  because the guard lived in `Model.save` and `QuerySet.update` never calls it;
- a provider could confirm a payment without a completion time, and the
  confirmation crashed halfway through posting it;
- a provider event about something else entirely was answered with a 4xx, which
  a provider retries and eventually responds to by disabling the endpoint the
  real payments arrive on;
- authenticated provider evidence Rooomly could not match to anything was
  recorded in a table nothing ever read;
- an outbox event whose worker died stayed claimed for ever, which for a rent
  schedule means a live tenancy that owes nothing at all;
- a duplicate tap recorded two external payments, or two waivers.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from django.db import DatabaseError, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict, ValidationFailed
from apps.lease import services as lease_services
from apps.payments import reconciliation
from apps.payments import services as payment_services
from apps.payments.models import (
    PaymentAllocation,
    PaymentTransaction,
    ProviderWebhook,
    ReconciliationKind,
    WebhookStatus,
)
from apps.payments.paystack import PaystackPaymentProvider
from apps.payments.providers import UnhandledProviderEvent
from apps.rent import services as rent_services
from apps.rent.models import ChargeStatus, ObligationAdjustment, RentPayment

pytestmark = pytest.mark.django_db

SECRET = "test-payment-webhook-secret"  # nosec B105
PAYSTACK_KEY = "sk_test_integrity"  # nosec B105


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
def obligation(landlord, user, unit):
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
    return lease, rent_services.build_schedule(lease)[0]


def _signed(payload: dict) -> tuple[bytes, dict]:
    body = json.dumps(payload).encode()
    signature = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    return body, {"X-Payment-Signature": signature}


def _success_payload(intent, *, transaction_id="psp_txn_1", event_id="evt_1", **overrides):
    payload = {
        "event_id": event_id,
        "event_type": "payment.succeeded",
        "provider_reference": intent.provider_reference,
        "provider_transaction_id": transaction_id,
        "status": "succeeded",
        "amount_minor": intent.amount_minor,
        "currency": intent.amount_currency,
        "payment_method": intent.payment_method,
        "occurred_at": timezone.now().isoformat(),
    }
    payload.update(overrides)
    return payload


def _paystack_signed(payload: dict) -> tuple[bytes, dict]:
    body = json.dumps(payload).encode()
    signature = hmac.new(PAYSTACK_KEY.encode(), body, hashlib.sha512).hexdigest()
    return body, {"X-Paystack-Signature": signature}


def _paid(user, charge):
    intent = payment_services.create_intent(
        obligation=charge, user=user, payment_method="mobile_money"
    )
    body, headers = _signed(_success_payload(intent))
    payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
    return intent


def _counts(result: dict) -> tuple[int, int, int]:
    """(ageing, breached, acknowledged) — the three an alerting test is about."""
    return result["ageing"], result["breached"], result["acknowledged"]


class TestFinancialRecordsAreAppendOnlyAtTheEngine:
    """A guard in `Model.save` is only as strong as the path that calls it.

    `QuerySet.update()` and `QuerySet.delete()` never do. Transactions, ledger
    lines and receipts have had an engine-level trigger since `payments/0002`;
    the row that says which obligation a payment settled, and the row that says
    a provider forgave a debt, did not.
    """

    def test_an_allocation_cannot_be_rewritten_by_a_queryset(self, landlord, user, obligation):
        _, charge = obligation
        _paid(user, charge)
        allocation = PaymentAllocation.objects.get()

        with pytest.raises(DatabaseError), transaction.atomic():
            PaymentAllocation.objects.filter(id=allocation.id).update(amount_minor=1)

        allocation.refresh_from_db()
        assert allocation.amount_minor == charge.amount_minor

    def test_an_allocation_cannot_be_deleted_by_a_queryset(self, landlord, user, obligation):
        _, charge = obligation
        _paid(user, charge)

        with pytest.raises(DatabaseError), transaction.atomic():
            PaymentAllocation.objects.all().delete()

        assert PaymentAllocation.objects.count() == 1

    def test_a_waiver_cannot_be_rewritten_or_removed(self, landlord, user, obligation):
        lease, charge = obligation
        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        charge.refresh_from_db()
        rent_services.adjust_obligation(
            charge=charge,
            user=landlord,
            kind="waiver",
            amount_minor=1000,
            reason="Goodwill on move-out",
        )
        adjustment = ObligationAdjustment.objects.get()

        with pytest.raises(DatabaseError), transaction.atomic():
            ObligationAdjustment.objects.filter(id=adjustment.id).update(amount_minor=999999)
        with pytest.raises(DatabaseError), transaction.atomic():
            ObligationAdjustment.objects.all().delete()

        adjustment.refresh_from_db()
        assert adjustment.amount_minor == 1000
        assert ObligationAdjustment.objects.count() == 1


class TestProviderEvidenceMustBeComplete:
    """A success Rooomly cannot fully record must fail closed, not half-post."""

    def test_a_confirmation_without_a_completion_time_is_refused(self, landlord, user, obligation):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        event = payment_services.VerifiedProviderEvent(
            event_id="evt_no_time",
            event_type="payment.succeeded",
            provider_reference=intent.provider_reference,
            provider_transaction_id="psp_no_time",
            status="succeeded",
            amount_minor=intent.amount_minor,
            currency=intent.amount_currency,
            payment_method=intent.payment_method,
            occurred_at=None,
        )
        with pytest.raises(ValidationFailed):
            payment_services._process_verified_event(
                event=event, provider_name="memory", evidence_source="test"
            )
        charge.refresh_from_db()
        assert charge.amount_paid_minor in (None, 0)

    def test_a_final_state_without_a_transaction_reference_is_refused(
        self, landlord, user, obligation
    ):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        event = payment_services.VerifiedProviderEvent(
            event_id="evt_no_txn",
            event_type="payment.failed",
            provider_reference=intent.provider_reference,
            provider_transaction_id="",
            status="failed",
            amount_minor=intent.amount_minor,
            currency=intent.amount_currency,
            payment_method=intent.payment_method,
            occurred_at=timezone.now(),
        )
        with pytest.raises(ValidationFailed):
            payment_services._process_verified_event(
                event=event, provider_name="memory", evidence_source="test"
            )

    @override_settings(PAYSTACK_SECRET_KEY=PAYSTACK_KEY, PAYMENT_BACKEND="paystack")
    def test_paystack_success_without_paid_at_is_rejected_at_the_adapter(self):
        provider = PaystackPaymentProvider()
        body, headers = _paystack_signed(
            {
                "event": "charge.success",
                "data": {
                    "id": 991,
                    "status": "success",
                    "channel": "mobile_money",
                    "reference": "rmp_missing_time",
                    "amount": 150000,
                    "currency": "GHS",
                },
            }
        )
        with pytest.raises(ValidationFailed):
            provider.verify_webhook(raw_body=body, headers=headers)


class TestUnrelatedProviderEventsAreAcknowledged:
    """A PSP sends events for the whole account, not only for Rooomly rent."""

    @override_settings(PAYSTACK_SECRET_KEY=PAYSTACK_KEY, PAYMENT_BACKEND="paystack")
    @pytest.mark.parametrize(
        "event_name",
        ["transfer.success", "refund.processed", "customeridentification.success"],
    )
    def test_an_account_level_event_is_ignored_not_refused(self, event_name):
        provider = PaystackPaymentProvider()
        body, headers = _paystack_signed({"event": event_name, "data": {"id": 5}})
        with pytest.raises(UnhandledProviderEvent):
            provider.verify_webhook(raw_body=body, headers=headers)

    @override_settings(PAYSTACK_SECRET_KEY=PAYSTACK_KEY, PAYMENT_BACKEND="paystack")
    def test_the_webhook_endpoint_answers_an_ignored_event_with_200(self):
        api = APIClient()
        body, headers = _paystack_signed({"event": "transfer.success", "data": {"id": 5}})
        response = api.post(
            "/api/v1/webhooks/payments/paystack/",
            data=body,
            content_type="application/json",
            HTTP_X_PAYSTACK_SIGNATURE=headers["X-Paystack-Signature"],
        )
        assert response.status_code == 200, response.data
        assert response.data == {"received": True, "ignored": True}
        row = ProviderWebhook.objects.get()
        assert row.status == WebhookStatus.IGNORED
        assert row.event_type == "transfer.success"
        assert row.signature_valid is True


class TestUnmatchedProviderEvidenceIsSurfaced:
    def test_a_signed_callback_matching_no_intent_reaches_the_exception_queue(self):
        """The only trace of an orphaned provider charge is the callback itself.

        An intent whose row was rolled back after the provider had accepted the
        checkout cannot be found by any sweep over Rooomly's intents, because
        there is no intent. The refused callback survives in `ProviderWebhook`,
        and until now nothing ever looked at that table.
        """
        ProviderWebhook.objects.create(
            provider="memory",
            event_id="evt_orphan",
            event_type="payment.succeeded",
            payload_hash="a" * 64,
            signature_valid=True,
            status=WebhookStatus.FAILED,
            error_message="The provider evidence does not match a payment attempt.",
        )
        ProviderWebhook.objects.update(created_at=timezone.now() - timedelta(hours=2))

        assert reconciliation.sweep_unmatched_provider_events() == 1
        exception = reconciliation.ReconciliationException.objects.get()
        assert exception.kind == ReconciliationKind.UNMATCHED_PROVIDER_EVENT
        assert exception.provider_reference == "evt_orphan"

        # And a second sweep does not turn one problem into a queue of them.
        assert reconciliation.sweep_unmatched_provider_events() == 0
        assert reconciliation.ReconciliationException.objects.count() == 1

    def test_a_processed_callback_is_never_raised(self, landlord, user, obligation):
        _, charge = obligation
        _paid(user, charge)
        ProviderWebhook.objects.update(created_at=timezone.now() - timedelta(hours=2))

        assert reconciliation.sweep_unmatched_provider_events() == 0
        assert not reconciliation.ReconciliationException.objects.exists()


class TestRentMutationsReplayInsteadOfDuplicating:
    """The clients already sent an Idempotency-Key; the server ignored it."""

    def test_one_key_records_one_external_payment(self, landlord, user, obligation):
        lease, charge = obligation
        api = APIClient()
        api.force_authenticate(user=landlord)
        payload = {
            "lease_id": str(lease.id),
            "charge_id": str(charge.id),
            "amount_minor": 50000,
            "paid_on": date.today().isoformat(),
            "method": "cash",
        }
        key = "rent-record-duplicate-tap-0001"

        first = api.post("/api/v1/rent/payments/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key)
        second = api.post(
            "/api/v1/rent/payments/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key
        )

        assert first.status_code == 201, first.data
        assert second.status_code == 201
        assert second.headers.get("X-Idempotent-Replay") == "true"
        assert first.data["id"] == second.data["id"]
        assert RentPayment.objects.filter(lease=lease).count() == 1

    def test_one_key_records_one_waiver(self, landlord, user, obligation):
        lease, charge = obligation
        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        api = APIClient()
        api.force_authenticate(user=landlord)
        payload = {"amount_minor": 25000, "reason": "Agreed at move-out", "confirmed": True}
        key = "rent-waive-duplicate-tap-0001"

        first = api.post(
            f"/api/v1/rent/charges/{charge.id}/waive/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        second = api.post(
            f"/api/v1/rent/charges/{charge.id}/waive/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )

        assert first.status_code == 200, first.data
        assert second.headers.get("X-Idempotent-Replay") == "true"
        assert ObligationAdjustment.objects.filter(obligation=charge).count() == 1
        assert ObligationAdjustment.objects.get().amount_minor == 25000


class TestTheTwoRailsAgreeOnPartPayment:
    """A part payment was recordable in cash and refused through checkout.

    `rent.record_payment` has always accepted part of an outstanding charge —
    a tenant who brings two thirds of the advance gets it recorded. Digital
    checkout demanded the whole balance. The same two thirds was therefore
    acceptable if handed over in a stairwell and refused if it went through the
    processor, which pushed exactly the payments Rooomly most wants on-platform
    off it. One rule now, enforced on the server for both.
    """

    def test_a_part_payment_settles_part_of_the_charge(self, landlord, user, obligation):
        _, charge = obligation
        full = charge.outstanding_minor
        part = full // 3

        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money", amount_minor=part
        )
        assert intent.amount_minor == part

        body, headers = _signed(_success_payload(intent))
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

        charge.refresh_from_db()
        assert charge.status == ChargeStatus.PART_PAID
        assert charge.amount_paid_minor == part
        assert charge.outstanding_minor == full - part

        # The whole financial record, at the part amount — not a lesser event.
        allocation = PaymentAllocation.objects.get()
        assert allocation.amount_minor == part
        transaction_row = PaymentTransaction.objects.get()
        assert transaction_row.amount_minor == part
        assert transaction_row.ledger_entries.count() == 2
        assert transaction_row.receipt.breakdown["payment"]["amount_minor"] == part

    def test_two_part_payments_settle_the_charge_exactly_once(self, landlord, user, obligation):
        _, charge = obligation
        full = charge.outstanding_minor
        first = full // 4

        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money", amount_minor=first
        )
        body, headers = _signed(_success_payload(intent, transaction_id="psp_part_1"))
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

        charge.refresh_from_db()
        second = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        assert second.amount_minor == full - first
        body, headers = _signed(
            _success_payload(second, transaction_id="psp_part_2", event_id="evt_2")
        )
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

        charge.refresh_from_db()
        assert charge.status == ChargeStatus.PAID
        assert charge.amount_paid_minor == full
        assert charge.outstanding_minor == 0
        assert sum(row.amount_minor for row in PaymentAllocation.objects.all()) == full

    def test_a_part_payment_can_never_exceed_what_is_outstanding(self, landlord, user, obligation):
        _, charge = obligation
        with pytest.raises(Conflict):
            payment_services.create_intent(
                obligation=charge,
                user=user,
                payment_method="mobile_money",
                amount_minor=charge.outstanding_minor + 1,
            )

    def test_a_trivial_part_payment_is_refused_but_a_small_balance_is_not(
        self, landlord, user, obligation
    ):
        """The floor exists because the provider bears the transaction fee.

        Forty payments of one pesewa would cost a landlord forty fees to collect
        forty pesewas. It must never trap somebody who genuinely owes less than
        the floor, so settling the whole remaining balance is always allowed.
        """
        _, charge = obligation
        with pytest.raises(ValidationFailed, match="part payment must be at least"):
            payment_services.create_intent(
                obligation=charge, user=user, payment_method="mobile_money", amount_minor=1
            )

        # Reduce the balance below the floor, then pay all of it.
        charge.amount_paid_minor = charge.amount_minor - 900
        charge.amount_paid_currency = charge.amount_currency
        charge.status = ChargeStatus.PART_PAID
        charge.save(update_fields=["amount_paid_minor", "amount_paid_currency", "status"])

        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money", amount_minor=900
        )
        assert intent.amount_minor == 900

    def test_the_amount_a_landlord_could_record_is_the_amount_a_tenant_could_pay(
        self, landlord, user, obligation
    ):
        """The invariant the disagreement violated, stated directly."""
        lease, charge = obligation
        part = charge.outstanding_minor // 2

        # The external rail accepts it...
        payment = rent_services.record_payment(
            lease=lease,
            user=landlord,
            data={
                "charge_id": str(charge.id),
                "amount_minor": part,
                "paid_on": date.today(),
                "method": "cash",
            },
        )
        assert payment.amount_minor == part

        # ...and so does the digital one, for the balance that is left.
        charge.refresh_from_db()
        intent = payment_services.create_intent(
            obligation=charge,
            user=user,
            payment_method="mobile_money",
            amount_minor=part,
        )
        assert intent.amount_minor == part

    def test_a_pending_part_payment_cannot_overpay_a_shrunken_obligation(
        self, landlord, user, obligation
    ):
        """A waiver landing mid-flight must not let the payment overshoot."""
        lease, charge = obligation
        part = charge.outstanding_minor // 2
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money", amount_minor=part
        )

        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        charge.refresh_from_db()
        rent_services.adjust_obligation(
            charge=charge,
            user=landlord,
            kind="waiver",
            amount_minor=charge.outstanding_minor - (part - 100),
            reason="Negotiated at move-out",
        )

        body, headers = _signed(_success_payload(intent))
        with pytest.raises(Conflict, match="obligation changed"):
            payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        charge.refresh_from_db()
        assert charge.amount_paid_minor in (None, 0)
        assert not PaymentAllocation.objects.exists()

    def test_the_offer_states_the_terms_it_will_be_judged_by(self, landlord, user, obligation):
        lease, charge = obligation
        availability = payment_services.digital_payment_availability(lease=lease, user=user)
        assert availability["available"] is True
        assert availability["allows_partial"] is True
        assert availability["minimum_part_minor"] == 5000
        assert availability["outstanding_minor"] == charge.outstanding_minor
        assert availability["currency"] == charge.amount_currency

    def test_every_refusal_has_the_same_shape(self, landlord, user, obligation):
        """A client must never have to feature-detect a "no"."""
        lease, _ = obligation
        refusal = payment_services.digital_payment_availability(lease=lease, user=landlord)
        assert refusal["available"] is False
        assert set(refusal) == {
            "available",
            "reason",
            "methods",
            "allows_partial",
            "minimum_part_minor",
            "outstanding_minor",
            "currency",
        }


class TestOneAuthorityForCollectionReadiness:
    """The dashboard and the checkout must answer from the same fact.

    Readiness used to come from a *person's* `BANK_ACCOUNT` trust stamp while
    the payment path resolved a *Portfolio's* provider-verified destination. A
    provider could be told payments were not ready while checkout worked, or
    told they were ready while an intent would fail closed.
    """

    def _collection(self, prop, user):
        from apps.property.capabilities import PropertyCapability, property_capabilities

        return property_capabilities(prop=prop, user=user)[
            PropertyCapability.PAYMENT_COLLECTION.value
        ]

    def test_no_rail_means_nobody_is_told_they_are_ready(self, landlord, user, unit):
        with override_settings(PAYMENT_BACKEND=""):
            state = self._collection(unit.property, landlord)
        assert state["allowed"] is False
        assert state["missing"] == ["payment_rail"]

    def test_readiness_ignores_the_persons_bank_stamp(self, landlord, user, unit):
        """The stamp is about a person; the money goes to a Portfolio."""
        from apps.trust.models import SubjectType, Verification, VerificationKind

        before = self._collection(unit.property, landlord)["allowed"]
        Verification.objects.filter(
            subject_type=SubjectType.USER,
            subject_id=str(landlord.id),
            kind=VerificationKind.BANK_ACCOUNT,
        ).delete()
        assert self._collection(unit.property, landlord)["allowed"] is before

    @override_settings(
        PAYMENT_BACKEND="paystack",
        PAYSTACK_SECRET_KEY="sk_test_" + "0" * 32,
        PAYSTACK_PLATFORM_CHARGE_BPS="300",
    )
    def test_readiness_and_checkout_refuse_together(self, landlord, user, obligation):
        """The two answers move as one, which is the whole point."""
        from apps.payments.providers import reset_payment_provider

        lease, charge = obligation
        reset_payment_provider()
        try:
            state = self._collection(lease.unit.property, landlord)
            assert state["allowed"] is False
            assert state["missing"] == ["payout_destination"]

            # And the tenant is not offered something the Portfolio cannot take.
            availability = payment_services.digital_payment_availability(lease=lease, user=user)
            assert availability["available"] is False
            with pytest.raises(Conflict):
                payment_services.create_intent(
                    obligation=charge, user=user, payment_method="mobile_money"
                )
        finally:
            reset_payment_provider()

    def test_recording_cash_follows_property_authority_not_collection_readiness(
        self, landlord, user, obligation
    ):
        """Two questions that were collapsed into one flag.

        A provider with no payout destination has not lost the ability to
        acknowledge money somebody physically handed them.
        """
        from apps.property.capabilities import PropertyCapability, property_capabilities

        lease, charge = obligation
        with override_settings(PAYMENT_BACKEND=""):
            capabilities = property_capabilities(prop=lease.unit.property, user=landlord)
            assert capabilities[PropertyCapability.PAYMENT_COLLECTION.value]["allowed"] is False
            assert capabilities[PropertyCapability.LEASES.value]["allowed"] is True

            payment = rent_services.record_payment(
                lease=lease,
                user=landlord,
                data={
                    "charge_id": str(charge.id),
                    "amount_minor": 1000,
                    "paid_on": date.today(),
                    "method": "cash",
                },
            )
        assert payment.payment_source == "EXTERNAL"


class TestTheExceptionQueueHasAnOwner:
    """A queue nobody is paged for is a queue nobody reads."""

    def _open_one(self, **overrides):
        payload = {
            "kind": ReconciliationKind.UNALLOCATED_TRANSACTION,
            "provider": "memory",
            "provider_reference": "psp_alert_1",
        }
        payload.update(overrides)
        return reconciliation.open_exception(**payload)

    def test_opening_one_says_so_at_the_moment_it_is_found(self, caplog):
        with caplog.at_level(logging.ERROR, logger="payments.reconciliation"):
            row = self._open_one()
        records = [
            item
            for item in caplog.records
            if getattr(item, "event", "") == reconciliation.ALERT_EVENT_OPENED
        ]
        assert len(records) == 1
        assert records[0].levelno == logging.ERROR
        assert records[0].reference == str(row.id)
        assert records[0].kind == ReconciliationKind.UNALLOCATED_TRANSACTION

    def test_a_fresh_exception_is_not_re_alerted(self, caplog):
        self._open_one()
        with caplog.at_level(logging.ERROR, logger="payments.reconciliation"):
            assert _counts(reconciliation.alert_open_exceptions()) == (0, 0, 0)

    def test_an_ignored_exception_gets_louder(self, caplog):
        row = self._open_one()
        reconciliation.ReconciliationException.objects.filter(id=row.id).update(
            detected_at=timezone.now() - timedelta(hours=6)
        )
        with caplog.at_level(logging.ERROR, logger="payments.reconciliation"):
            assert _counts(reconciliation.alert_open_exceptions()) == (1, 0, 0)

        reconciliation.ReconciliationException.objects.filter(id=row.id).update(
            detected_at=timezone.now() - timedelta(hours=30)
        )
        caplog.clear()
        with caplog.at_level(logging.ERROR, logger="payments.reconciliation"):
            assert _counts(reconciliation.alert_open_exceptions()) == (0, 1, 0)
        breach = [
            item
            for item in caplog.records
            if getattr(item, "event", "") == reconciliation.ALERT_EVENT_BREACHED
        ]
        assert len(breach) == 1
        assert breach[0].levelno == logging.CRITICAL

    def test_a_resolved_exception_stops_alerting(self, caplog):
        from apps.operations.models import ManagementRole, ManagementUser

        row = self._open_one()
        reconciliation.ReconciliationException.objects.filter(id=row.id).update(
            detected_at=timezone.now() - timedelta(hours=30)
        )
        operator = ManagementUser.objects.create(
            email="ops-alerts@rooomly.test",
            first_name="Ops",
            last_name="Admin",
            role=ManagementRole.OPERATIONS_ADMIN,
        )
        reconciliation.resolve_exception(
            exception_id=row.id,
            management_actor=operator,
            status=reconciliation.ReconciliationStatus.RESOLVED,
            note="Checked against the provider dashboard; the callback was a duplicate.",
        )
        assert _counts(reconciliation.alert_open_exceptions()) == (0, 0, 0)

    def test_the_workspace_shows_how_long_it_has_been_ignored(self):
        from apps.payments.operations import payment_operations_snapshot

        row = self._open_one()
        reconciliation.ReconciliationException.objects.filter(id=row.id).update(
            detected_at=timezone.now() - timedelta(hours=30)
        )
        counts = payment_operations_snapshot()["counts"]
        assert counts["open_exceptions"] == 1
        assert counts["breached_exceptions"] == 1
        assert counts["oldest_open_age_hours"] >= 30
        assert counts["breach_after_hours"] == 24

    def test_the_alert_carries_no_tenant_detail(self, caplog):
        """An alert stream is not a place to put somebody's rent."""
        with caplog.at_level(logging.ERROR, logger="payments.reconciliation"):
            self._open_one()
        record = next(
            item
            for item in caplog.records
            if getattr(item, "event", "") == reconciliation.ALERT_EVENT_OPENED
        )
        assert not hasattr(record, "tenant")
        assert not hasattr(record, "amount_minor")
        assert "GH" not in record.getMessage()


class TestExceptionsReachSomebodyOutsideTheQueue:
    """A queue nobody is paged for is a queue nobody reads.

    The escalating log line was half the job. These hold the other half: that an
    alert leaves the process, that it names an owner, that acknowledging it
    quietens the paging without closing anything, and that nothing in it is a
    tenant's business made public.
    """

    ENDPOINT = "https://alerts.rooomly.test/hook"

    def _open_one(self, **overrides):
        payload = {
            "kind": ReconciliationKind.UNALLOCATED_TRANSACTION,
            "provider": "memory",
            "provider_reference": "psp_alert_1",
        }
        payload.update(overrides)
        return reconciliation.open_exception(**payload)

    def _age(self, row, hours):
        reconciliation.ReconciliationException.objects.filter(id=row.id).update(
            detected_at=timezone.now() - timedelta(hours=hours)
        )

    def test_opening_one_posts_it_to_the_configured_endpoint(self):
        from apps.payments import alerts

        sent = []

        def capture(url, json=None, timeout=None):
            sent.append({"url": url, "payload": json})

            class _R:
                status_code = 200

            return _R()

        with (
            override_settings(
                PAYMENT_ALERT_WEBHOOK_URL=self.ENDPOINT,
                PAYMENT_ALERT_OWNER="payments-oncall",
            ),
            patch.object(alerts.requests, "post", capture),
        ):
            row = self._open_one()

        assert len(sent) == 1
        assert sent[0]["url"] == self.ENDPOINT
        payload = sent[0]["payload"]
        assert payload["exception_id"] == str(row.id)
        assert payload["owner"] == "payments-oncall"
        assert payload["severity"] == "error"
        assert payload["event"] == reconciliation.ALERT_EVENT_OPENED
        assert payload["workspace"] == "/management/payments/"

    def test_the_alert_carries_no_tenant_amount_or_payload(self, landlord, user, obligation):
        """An alert stream is copied into chat and retained by third parties.

        Built from a real exception with a real intent behind it, so this is a
        genuine test of what leaves rather than of an empty row.
        """
        from apps.payments import alerts

        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        sent = []

        def capture(url, json=None, timeout=None):
            sent.append(json)

            class _R:
                status_code = 200

            return _R()

        with (
            override_settings(PAYMENT_ALERT_WEBHOOK_URL=self.ENDPOINT),
            patch.object(alerts.requests, "post", capture),
        ):
            reconciliation.open_exception(
                kind=ReconciliationKind.AMOUNT_MISMATCH,
                provider="memory",
                provider_reference=intent.provider_reference,
                intent=intent,
                detail={
                    "rooomly_amount_minor": intent.amount_minor,
                    "provider_amount_minor": 1,
                },
            )

        blob = json.dumps(sent[0])
        assert user.display_name not in blob
        assert str(user.phone) not in blob
        assert str(intent.amount_minor) not in blob
        assert charge.lease.unit.property.title not in blob
        # The detail that was compared stays behind the audited workspace.
        assert "detail" not in sent[0]
        assert set(sent[0]) == {
            "event",
            "severity",
            "service",
            "owner",
            "exception_id",
            "kind",
            "provider",
            "status",
            "age_hours",
            "workspace",
            "runbook",
        }

    def test_an_unreachable_endpoint_never_stops_the_sweep(self):
        from apps.payments import alerts

        def explode(url, json=None, timeout=None):
            raise alerts.requests.RequestException("no route to host")

        with (
            override_settings(PAYMENT_ALERT_WEBHOOK_URL=self.ENDPOINT),
            patch.object(alerts.requests, "post", explode),
        ):
            row = self._open_one()
            self._age(row, 6)
            result = reconciliation.alert_open_exceptions()

        # The exception was still recorded and still escalated internally.
        assert reconciliation.ReconciliationException.objects.count() == 1
        assert result["ageing"] == 1
        assert result["delivered"] == 0

    def test_acknowledging_stops_the_paging_without_closing_anything(self):
        """`investigating` means a person has it, not that it is over."""
        from apps.operations.models import ManagementRole, ManagementUser
        from apps.payments.operations import payment_operations_snapshot

        row = self._open_one()
        self._age(row, 6)
        assert _counts(reconciliation.alert_open_exceptions()) == (1, 0, 0)

        operator = ManagementUser.objects.create(
            email="ack@rooomly.test",
            first_name="Ops",
            last_name="Admin",
            role=ManagementRole.OPERATIONS_ADMIN,
        )
        reconciliation.resolve_exception(
            exception_id=row.id,
            management_actor=operator,
            status=reconciliation.ReconciliationStatus.INVESTIGATING,
            note="Picked up; comparing against the provider dashboard.",
        )
        self._age(row, 6)

        assert _counts(reconciliation.alert_open_exceptions()) == (0, 0, 0)
        # Still open, still counted, still somebody's problem.
        row.refresh_from_db()
        assert row.status == reconciliation.ReconciliationStatus.INVESTIGATING
        assert payment_operations_snapshot()["counts"]["open_exceptions"] == 1

    def test_an_acknowledged_exception_that_stalls_speaks_up_again(self):
        """Acknowledgement is not a mute button with no expiry."""
        from apps.operations.models import ManagementRole, ManagementUser

        row = self._open_one()
        operator = ManagementUser.objects.create(
            email="stall@rooomly.test",
            first_name="Ops",
            last_name="Admin",
            role=ManagementRole.OPERATIONS_ADMIN,
        )
        self._age(row, 6)
        reconciliation.resolve_exception(
            exception_id=row.id,
            management_actor=operator,
            status=reconciliation.ReconciliationStatus.INVESTIGATING,
            note="Looking into it.",
        )

        self._age(row, 30)
        assert _counts(reconciliation.alert_open_exceptions()) == (0, 0, 1)

    def test_an_unanswered_exception_escalates_to_critical(self, caplog):
        row = self._open_one()
        self._age(row, 30)
        with caplog.at_level(logging.WARNING, logger="payments.reconciliation"):
            assert _counts(reconciliation.alert_open_exceptions()) == (0, 1, 0)
        breach = [
            item
            for item in caplog.records
            if getattr(item, "event", "") == reconciliation.ALERT_EVENT_BREACHED
        ]
        assert len(breach) == 1
        assert breach[0].levelno == logging.CRITICAL

    def test_an_unconfigured_endpoint_is_a_decision_not_a_crash(self):
        """No URL means the log line is the only path. It must still work."""
        row = self._open_one()
        self._age(row, 6)
        with override_settings(PAYMENT_ALERT_WEBHOOK_URL=""):
            result = reconciliation.alert_open_exceptions()
        assert result["ageing"] == 1
        assert result["delivered"] == 0
