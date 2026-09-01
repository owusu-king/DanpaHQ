"""The first Payment Core boundary: server-priced intent to signed callback."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import date, timedelta

import pytest
from django.conf import settings
from django.db import DatabaseError, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.core.exceptions import PermissionDenied, ProviderUnavailable, ValidationFailed
from apps.lease import services as lease_services
from apps.notifications.models import Notification
from apps.outbox.models import OutboxEvent
from apps.payments import services
from apps.payments.models import (
    IntentStatus,
    LedgerEntry,
    PaymentIntent,
    PaymentTransaction,
    ProviderWebhook,
    Receipt,
    Settlement,
    WebhookStatus,
)
from apps.rent import services as rent_services
from apps.rent.models import ChargeStatus, PaymentVerificationSource, RentPayment

pytestmark = pytest.mark.django_db


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near Oxford Street")


@pytest.fixture
def unit(landlord, address, approve_provider):
    from apps.property.models import Property, Unit

    prop = Property.objects.create(
        owner=landlord, address=address, title="Osu Court", property_type="apartment"
    )
    approve_provider(landlord, prop)
    return Unit.objects.create(property=prop, label="Flat 2", bedrooms=1, bathrooms=1)


def active_lease(landlord, tenant, unit):
    lease = lease_services.draft_lease(
        user=landlord,
        unit=unit,
        tenant=tenant,
        data={
            "rent_minor": 150000,
            "advance_months": 6,
            "deposit_months": 1,
            "starts_on": date.today(),
            "term_months": 12,
        },
    )
    lease_services.offer_lease(lease=lease, user=landlord)
    return lease_services.accept_lease(lease=lease, user=tenant)


def obligation_for(landlord, tenant, unit):
    lease = active_lease(landlord, tenant, unit)
    return lease, rent_services.build_schedule(lease)[0]


def signed_event(intent, *, event_id="evt-1", amount_minor=None, status="succeeded"):
    payload = {
        "event_id": event_id,
        "event_type": "payment.updated",
        "provider_reference": intent.provider_reference,
        "provider_transaction_id": f"txn-{event_id}",
        "status": status,
        "amount_minor": intent.amount_minor if amount_minor is None else amount_minor,
        "currency": intent.amount_currency,
        "payment_method": intent.payment_method,
        "occurred_at": timezone.now().isoformat(),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(
        settings.PAYMENT_TEST_WEBHOOK_SECRET.encode(), raw, hashlib.sha256
    ).hexdigest()
    return raw, {"X-Payment-Signature": signature}


class TestIntentBoundary:
    def test_amount_is_derived_from_the_obligation(self, landlord, user, unit):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        assert intent.amount_minor == obligation.outstanding_minor
        assert intent.amount_currency == obligation.amount_currency
        assert intent.status == IntentStatus.PENDING
        assert intent.provider == "memory"

    def test_another_user_cannot_pay_somebody_elses_obligation(self, landlord, user, agent, unit):
        _, obligation = obligation_for(landlord, user, unit)
        with pytest.raises(PermissionDenied):
            services.create_intent(obligation=obligation, user=agent, payment_method="mobile_money")

    @override_settings(PAYMENT_BACKEND="")
    def test_no_provider_means_no_placeholder_intent(self, landlord, user, unit):
        _, obligation = obligation_for(landlord, user, unit)
        with pytest.raises(ProviderUnavailable):
            services.create_intent(obligation=obligation, user=user, payment_method="mobile_money")
        assert not PaymentIntent.objects.exists()

    def test_expired_intent_releases_the_obligation_and_is_audited(self, landlord, user, unit):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        PaymentIntent.objects.filter(id=intent.id).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        assert services.expire_due_intents() == 1
        intent.refresh_from_db()
        assert intent.status == IntentStatus.EXPIRED
        assert OutboxEvent.objects.filter(
            name="payment.intent_expired.v1", aggregate_id=str(intent.id)
        ).exists()

        replacement = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        assert replacement.id != intent.id

        # A delayed, valid success for the expired provider attempt is still
        # financial truth. It settles once and closes the newer unpaid intent.
        intent.refresh_from_db()
        raw, headers = signed_event(intent, event_id="evt-delayed")
        services.process_webhook(provider_name="memory", raw_body=raw, headers=headers)
        replacement.refresh_from_db()
        assert replacement.status == IntentStatus.CANCELLED


class TestProviderConfirmation:
    def test_signed_success_creates_all_financial_records_once(self, landlord, user, unit):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        raw, headers = signed_event(intent)

        result = services.process_webhook(provider_name="memory", raw_body=raw, headers=headers)
        assert result.status == IntentStatus.SUCCEEDED
        transaction_row = PaymentTransaction.objects.get(intent=intent)
        assert transaction_row.status == "succeeded"
        lines = list(LedgerEntry.objects.filter(transaction=transaction_row))
        assert [(line.direction, line.amount_minor) for line in lines] == [
            ("debit", intent.amount_minor),
            ("credit", intent.amount_minor),
        ]
        receipt = Receipt.objects.get(transaction=transaction_row)
        assert receipt.breakdown["schema_version"] == "rooomly.payment_receipt.v1"
        assert receipt.breakdown["tenant"]["name"] == user.display_name
        assert receipt.breakdown["premises"]["property_title"] == "Osu Court"
        assert receipt.breakdown["premises"]["unit_label"] == "Flat 2"
        assert receipt.breakdown["premises"]["is_furnished"] is False
        assert receipt.breakdown["obligation"]["period_start"]
        assert receipt.breakdown["obligation"]["period_end"]
        assert receipt.breakdown["processor"]["transaction_id"] == "txn-evt-1"
        final_pdf = bytes(receipt.final_pdf)
        assert final_pdf.startswith(b"%PDF")
        assert receipt.final_pdf_hash == hashlib.sha256(final_pdf).hexdigest()
        assert Settlement.objects.get(transaction=transaction_row).status == "pending"

        rent_payment = RentPayment.objects.get(reference="txn-evt-1")
        assert rent_payment.verification_source == PaymentVerificationSource.PSP
        assert rent_payment.confirmed_by_id is None
        assert transaction_row.rent_record_id == rent_payment.id
        obligation.refresh_from_db()
        assert obligation.status == ChargeStatus.PAID

        assert AuditLog.objects.filter(
            aggregate_type="payment_transaction", aggregate_id=str(transaction_row.id)
        ).exists()
        assert OutboxEvent.objects.filter(
            name="payment.succeeded.v1", aggregate_id=str(transaction_row.id)
        ).exists()

        from apps.outbox.tasks import dispatch_pending

        dispatch_pending()
        assert Notification.objects.filter(kind="payment.succeeded").count() == 2

        # The same authenticated provider event is a replay, not another debit.
        services.process_webhook(provider_name="memory", raw_body=raw, headers=headers)
        assert PaymentTransaction.objects.count() == 1
        assert LedgerEntry.objects.count() == 2
        assert (
            RentPayment.objects.filter(verification_source=PaymentVerificationSource.PSP).count()
            == 1
        )

    def test_wrong_amount_never_settles_the_charge(self, landlord, user, unit):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        raw, headers = signed_event(intent, amount_minor=intent.amount_minor - 1)
        with pytest.raises(ValidationFailed):
            services.process_webhook(provider_name="memory", raw_body=raw, headers=headers)
        obligation.refresh_from_db()
        assert obligation.status == ChargeStatus.DUE
        assert not PaymentTransaction.objects.exists()
        assert ProviderWebhook.objects.get(event_id="evt-1").status == WebhookStatus.FAILED

    def test_forged_webhook_is_retained_and_rejected(self):
        raw = b'{"event_id":"forged"}'
        with pytest.raises(PermissionDenied):
            services.process_webhook(provider_name="memory", raw_body=raw, headers={})
        event = ProviderWebhook.objects.get()
        assert event.signature_valid is False
        assert event.status == WebhookStatus.REJECTED

    def test_ledger_history_cannot_be_edited_or_deleted(self, landlord, user, unit):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        raw, headers = signed_event(intent)
        services.process_webhook(provider_name="memory", raw_body=raw, headers=headers)
        line = LedgerEntry.objects.first()
        line.description = "rewritten"
        with pytest.raises(RuntimeError):
            line.save()
        with pytest.raises(RuntimeError):
            line.delete()
        protected = [
            (LedgerEntry, line.id, {"description": "database rewrite"}),
            (PaymentTransaction, line.transaction_id, {"raw_provider_status": "rewritten"}),
            (Receipt, Receipt.objects.get().id, {"receipt_number": "REWRITTEN"}),
        ]
        for model, row_id, changes in protected:
            with pytest.raises(DatabaseError), transaction.atomic():
                model.objects.filter(id=row_id).update(**changes)

    def test_psp_payment_cannot_be_rewritten_as_an_offline_dispute(self, landlord, user, unit):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        raw, headers = signed_event(intent)
        services.process_webhook(provider_name="memory", raw_body=raw, headers=headers)
        payment = RentPayment.objects.get(verification_source=PaymentVerificationSource.PSP)
        from apps.core.exceptions import Conflict

        with pytest.raises(Conflict):
            rent_services.dispute_payment(payment=payment, user=landlord, reason="Reversed")


class TestPaymentApi:
    @pytest.fixture
    def tenant_api(self, user, sign_in_as):
        client = APIClient()
        sign_in_as(client, user=user, device_fingerprint="payment-tenant")
        return client

    def test_intent_requires_and_replays_idempotency_key(self, tenant_api, landlord, user, unit):
        _, obligation = obligation_for(landlord, user, unit)
        payload = {"obligation_id": str(obligation.id), "payment_method": "mobile_money"}
        missing = tenant_api.post("/api/v1/payments/intents/", payload, format="json")
        assert missing.status_code == 422

        headers = {"HTTP_IDEMPOTENCY_KEY": "payment-intent-0001"}
        first = tenant_api.post("/api/v1/payments/intents/", payload, format="json", **headers)
        assert first.status_code == 201, first.data
        second = tenant_api.post("/api/v1/payments/intents/", payload, format="json", **headers)
        assert second.status_code == 201
        assert second.data["id"] == first.data["id"]
        assert second.headers["X-Idempotent-Replay"] == "true"
        assert PaymentIntent.objects.count() == 1

    def test_return_refresh_uses_provider_query_and_is_idempotent(
        self, tenant_api, landlord, user, unit
    ):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        provider_state = {
            "payments": {
                intent.provider_reference: {
                    "provider_transaction_id": "txn-return-query",
                    "status": "succeeded",
                    "amount_minor": intent.amount_minor,
                    "currency": intent.amount_currency,
                    "payment_method": intent.payment_method,
                    "occurred_at": timezone.now().isoformat(),
                }
            }
        }
        headers = {"HTTP_IDEMPOTENCY_KEY": "payment-refresh-0001"}
        with override_settings(PAYMENT_TEST_STATE=provider_state):
            first = tenant_api.post(
                f"/api/v1/payments/intents/{intent.id}/refresh/", {}, format="json", **headers
            )
            second = tenant_api.post(
                f"/api/v1/payments/intents/{intent.id}/refresh/", {}, format="json", **headers
            )
        assert first.status_code == 200, first.data
        assert first.data["status"] == "succeeded"
        assert second.headers["X-Idempotent-Replay"] == "true"
        assert PaymentTransaction.objects.filter(status="succeeded").count() == 1
        assert Receipt.objects.count() == 1
        obligation.refresh_from_db()
        assert obligation.status == ChargeStatus.PAID

    def test_return_refresh_rejects_another_tenant(self, landlord, user, agent, unit, sign_in_as):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        stranger = APIClient()
        sign_in_as(stranger, user=agent, device_fingerprint="payment-refresh-stranger")
        response = stranger.post(
            f"/api/v1/payments/intents/{intent.id}/refresh/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="payment-refresh-0002",
        )
        assert response.status_code == 403

    def test_return_refresh_rejects_provider_amount_mismatch(
        self, tenant_api, landlord, user, unit
    ):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        provider_state = {
            "payments": {
                intent.provider_reference: {
                    "provider_transaction_id": "txn-return-wrong-amount",
                    "status": "succeeded",
                    "amount_minor": intent.amount_minor - 100,
                    "currency": intent.amount_currency,
                    "payment_method": intent.payment_method,
                    "occurred_at": timezone.now().isoformat(),
                }
            }
        }
        with override_settings(PAYMENT_TEST_STATE=provider_state):
            response = tenant_api.post(
                f"/api/v1/payments/intents/{intent.id}/refresh/",
                {},
                format="json",
                HTTP_IDEMPOTENCY_KEY="payment-refresh-mismatch",
            )
        assert response.status_code == 422
        assert not PaymentTransaction.objects.exists()
        intent.refresh_from_db()
        assert intent.status == "pending"

    def test_refresh_and_retry_require_idempotency_keys(self, tenant_api, landlord, user, unit):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        refresh = tenant_api.post(
            f"/api/v1/payments/intents/{intent.id}/refresh/", {}, format="json"
        )
        retry = tenant_api.post(f"/api/v1/payments/intents/{intent.id}/retry/", {}, format="json")
        assert refresh.status_code == 422
        assert retry.status_code == 422

    def test_failed_intent_retry_endpoint_replays_without_another_attempt(
        self, tenant_api, landlord, user, unit
    ):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        raw, signed_headers = signed_event(intent, event_id="evt-api-failed", status="failed")
        services.process_webhook(provider_name="memory", raw_body=raw, headers=signed_headers)
        headers = {"HTTP_IDEMPOTENCY_KEY": "payment-retry-0001"}
        first = tenant_api.post(
            f"/api/v1/payments/intents/{intent.id}/retry/", {}, format="json", **headers
        )
        second = tenant_api.post(
            f"/api/v1/payments/intents/{intent.id}/retry/", {}, format="json", **headers
        )
        assert first.status_code == 200, first.data
        assert first.data["status"] == "pending"
        assert second.headers["X-Idempotent-Replay"] == "true"
        assert intent.attempts.count() == 2

    def test_rent_ledger_only_offers_checkout_to_the_owing_tenant(
        self, tenant_api, landlord, user, unit, sign_in_as
    ):
        lease, _ = obligation_for(landlord, user, unit)
        mine = tenant_api.get(f"/api/v1/leases/{lease.id}/charges/")
        assert mine.status_code == 200
        assert mine.data["digital_payment"] == {
            "available": True,
            "reason": "",
            "methods": ["mobile_money", "card", "bank_transfer"],
            # The part-payment terms travel with the offer, so a client never
            # has to infer the rule the server will enforce.
            "allows_partial": True,
            "minimum_part_minor": 5000,
            "outstanding_minor": 900000,
            "currency": "GHS",
        }

        provider = APIClient()
        sign_in_as(provider, user=landlord, device_fingerprint="payment-provider-ledger")
        theirs = provider.get(f"/api/v1/leases/{lease.id}/charges/")
        assert theirs.status_code == 200
        assert theirs.data["digital_payment"]["available"] is False

    def test_webhook_and_receipt_are_server_scoped(
        self, tenant_api, landlord, user, agent, unit, sign_in_as
    ):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        raw, signed_headers = signed_event(intent)
        response = APIClient().generic(
            "POST",
            "/api/v1/webhooks/payments/memory/",
            raw,
            content_type="application/json",
            HTTP_X_PAYMENT_SIGNATURE=signed_headers["X-Payment-Signature"],
        )
        assert response.status_code == 200, response.data
        receipt = Receipt.objects.get()
        mine = tenant_api.get(f"/api/v1/payments/receipts/{receipt.id}/")
        assert mine.status_code == 200
        assert mine.data["snapshot"]["schema_version"] == "rooomly.payment_receipt.v1"
        assert mine.data["final_document_available"] is True

        document = tenant_api.get(
            f"/api/v1/payments/receipts/{receipt.id}/document.pdf?disposition=inline"
        )
        assert document.status_code == 200
        assert document["Content-Type"] == "application/pdf"
        assert document["Content-Disposition"].startswith("inline;")
        assert document["ETag"] == f'"{receipt.final_pdf_hash}"'
        assert document["X-Content-Type-Options"] == "nosniff"
        assert document.content == bytes(receipt.final_pdf)

        stranger = APIClient()
        sign_in_as(stranger, user=agent, device_fingerprint="payment-stranger")
        refused = stranger.get(f"/api/v1/payments/receipts/{receipt.id}/")
        assert refused.status_code == 403
        refused_document = stranger.get(f"/api/v1/payments/receipts/{receipt.id}/document.pdf")
        assert refused_document.status_code == 403

    def test_receipt_snapshot_does_not_change_with_mutable_records(
        self, tenant_api, landlord, user, unit
    ):
        _, obligation = obligation_for(landlord, user, unit)
        intent = services.create_intent(
            obligation=obligation, user=user, payment_method="mobile_money"
        )
        raw, signed_headers = signed_event(intent, event_id="evt-frozen-receipt")
        services.process_webhook(provider_name="memory", raw_body=raw, headers=signed_headers)
        receipt = Receipt.objects.get()
        original_snapshot = receipt.breakdown
        original_pdf = bytes(receipt.final_pdf)

        user.first_name = "Changed"
        user.last_name = "Tenant"
        user.save(update_fields=["first_name", "last_name"])
        unit.property.title = "Renamed property"
        unit.property.save(update_fields=["title"])
        unit.label = "Renamed unit"
        unit.save(update_fields=["label"])

        response = tenant_api.get(f"/api/v1/payments/receipts/{receipt.id}/")
        assert response.status_code == 200
        assert response.data["snapshot"] == original_snapshot
        assert response.data["snapshot"]["tenant"]["name"] != user.display_name
        assert response.data["snapshot"]["premises"]["property_title"] == "Osu Court"
        assert response.data["snapshot"]["premises"]["unit_label"] == "Flat 2"
        receipt.refresh_from_db()
        assert bytes(receipt.final_pdf) == original_pdf
