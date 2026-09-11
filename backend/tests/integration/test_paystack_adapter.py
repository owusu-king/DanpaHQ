"""The Paystack adapter, tested without touching Paystack.

Every outbound call is stubbed. What is under test is the translation layer —
the part that decides what a Paystack status *means* — plus the two guards that
exist to make a mistake cheap: the signature check and the live-key refusal.

Nothing here proves Rooomly can take a payment. That takes Paystack's sandbox
with real keys, and it is the next step rather than this one.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from django.test import override_settings

from apps.core.exceptions import PermissionDenied, ProviderUnavailable, ValidationFailed
from apps.payments.paystack import PaystackPaymentProvider

TEST_KEY = "sk_test_" + "0" * 32  # nosec B105
LIVE_KEY = "sk_live_" + "0" * 32  # nosec B105


def _signed(payload: dict, key: str = TEST_KEY) -> tuple[bytes, dict]:
    """Sign the way Paystack does: HMAC-SHA512, hex, over the exact bytes."""
    body = json.dumps(payload).encode()
    signature = hmac.new(key.encode(), body, hashlib.sha512).hexdigest()
    return body, {"X-Paystack-Signature": signature}


def _charge(**overrides) -> dict:
    data = {
        "id": 302961,
        "reference": "rmp_abc123",
        "amount": 150000,
        "currency": "GHS",
        "status": "success",
        "channel": "mobile_money",
        "paid_at": "2026-08-28T10:00:00.000Z",
    }
    data.update(overrides)
    return {"event": "charge.success", "data": data}


class TestWebhookAuthenticity:
    @pytest.fixture(autouse=True)
    def _test_key(self, settings):
        settings.PAYSTACK_SECRET_KEY = TEST_KEY
        settings.PAYSTACK_ALLOW_LIVE = False

    def test_a_correctly_signed_callback_is_translated(self):
        body, headers = _signed(_charge())
        event = PaystackPaymentProvider().verify_webhook(raw_body=body, headers=headers)

        assert event.provider_transaction_id == "302961"
        assert event.provider_reference == "rmp_abc123"
        assert event.status == "succeeded"
        assert event.payment_method == "mobile_money"
        # Paystack's subunit is the pesewa and Rooomly's `amount_minor` is the
        # pesewa. Nothing converts, and this is the assertion that keeps it so.
        assert event.amount_minor == 150000
        assert event.currency == "GHS"
        # Paystack sends no event id, so one is composed. Uniqueness on
        # (provider, event_id) is what makes a redelivery a no-op.
        assert event.event_id == "charge.success:302961"

    def test_an_unsigned_callback_is_refused(self):
        body, _ = _signed(_charge())
        with pytest.raises(PermissionDenied):
            PaystackPaymentProvider().verify_webhook(raw_body=body, headers={})

    def test_a_callback_signed_with_the_wrong_key_is_refused(self):
        body, headers = _signed(_charge(), key="sk_test_" + "9" * 32)
        with pytest.raises(PermissionDenied):
            PaystackPaymentProvider().verify_webhook(raw_body=body, headers=headers)

    def test_a_tampered_body_is_refused(self):
        body, headers = _signed(_charge())
        tampered = body.replace(b'"amount": 150000', b'"amount": 1')
        with pytest.raises(PermissionDenied):
            PaystackPaymentProvider().verify_webhook(raw_body=tampered, headers=headers)

    def test_sha256_is_not_accepted(self):
        """Paystack uses SHA-512. Signing with the algorithm most providers use
        must not pass, or the check is decorative."""
        payload = _charge()
        body = json.dumps(payload).encode()
        wrong = hmac.new(TEST_KEY.encode(), body, hashlib.sha256).hexdigest()
        with pytest.raises(PermissionDenied):
            PaystackPaymentProvider().verify_webhook(
                raw_body=body, headers={"X-Paystack-Signature": wrong}
            )

    def test_the_header_is_read_case_insensitively(self):
        body, headers = _signed(_charge())
        lowered = {"x-paystack-signature": headers["X-Paystack-Signature"]}
        event = PaystackPaymentProvider().verify_webhook(raw_body=body, headers=lowered)
        assert event.status == "succeeded"


class TestTranslation:
    """Vendor vocabulary stops at the adapter, and is never guessed at."""

    @pytest.fixture(autouse=True)
    def _test_key(self, settings):
        settings.PAYSTACK_SECRET_KEY = TEST_KEY
        settings.PAYSTACK_ALLOW_LIVE = False

    @pytest.mark.parametrize(
        "paystack_status,expected",
        [
            ("success", "succeeded"),
            ("failed", "failed"),
            ("abandoned", "pending"),
            ("reversed", "reversed"),
            ("pending", "pending"),
            ("ongoing", "processing"),
        ],
    )
    def test_known_statuses_map(self, paystack_status, expected):
        body, headers = _signed(_charge(status=paystack_status))
        event = PaystackPaymentProvider().verify_webhook(raw_body=body, headers=headers)
        assert event.status == expected

    def test_an_unknown_status_is_refused_rather_than_guessed(self):
        """An unfamiliar financial state belongs in reconciliation.

        Mapping it to the nearest-looking value is how a provider's new status
        silently becomes a wrong balance.
        """
        body, headers = _signed(_charge(status="something_new"))
        with pytest.raises(ValidationFailed, match="does not map"):
            PaystackPaymentProvider().verify_webhook(raw_body=body, headers=headers)

    @pytest.mark.parametrize(
        "channel,expected",
        [
            ("mobile_money", "mobile_money"),
            ("card", "card"),
            ("bank", "bank_transfer"),
            ("ussd", "bank_transfer"),
        ],
    )
    def test_channels_map_to_payment_methods(self, channel, expected):
        body, headers = _signed(_charge(channel=channel))
        event = PaystackPaymentProvider().verify_webhook(raw_body=body, headers=headers)
        assert event.payment_method == expected

    def test_an_unknown_channel_is_refused(self):
        body, headers = _signed(_charge(channel="carrier_pigeon"))
        with pytest.raises(ValidationFailed, match="unknown channel"):
            PaystackPaymentProvider().verify_webhook(raw_body=body, headers=headers)


class TestLiveModeGuard:
    """A live key does nothing until somebody has said live, out loud."""

    @override_settings(PAYSTACK_SECRET_KEY=LIVE_KEY, PAYSTACK_ALLOW_LIVE=False)
    def test_a_live_key_alone_moves_no_money(self):
        with pytest.raises(ProviderUnavailable, match="live mode has not been enabled"):
            PaystackPaymentProvider().initiate(intent=None)

    @override_settings(PAYSTACK_SECRET_KEY=LIVE_KEY, PAYSTACK_ALLOW_LIVE=False)
    def test_a_live_key_cannot_even_authenticate_a_callback(self):
        """The guard is on the key, not on one operation.

        A callback verified under a live key would let production process real
        money through a deployment nobody had switched on.
        """
        body, headers = _signed(_charge(), key=LIVE_KEY)
        with pytest.raises(ProviderUnavailable):
            PaystackPaymentProvider().verify_webhook(raw_body=body, headers=headers)

    @override_settings(PAYSTACK_SECRET_KEY=LIVE_KEY, PAYSTACK_ALLOW_LIVE=True)
    def test_an_explicit_switch_permits_live(self):
        body, headers = _signed(_charge(), key=LIVE_KEY)
        event = PaystackPaymentProvider().verify_webhook(raw_body=body, headers=headers)
        assert event.status == "succeeded"

    @override_settings(PAYSTACK_SECRET_KEY="")
    def test_no_key_is_an_honest_refusal(self):
        with pytest.raises(ProviderUnavailable, match="not configured"):
            PaystackPaymentProvider().initiate(intent=None)


class TestOutboundCalls:
    """The request Rooomly sends, and what it makes of the answer."""

    @pytest.fixture(autouse=True)
    def _test_key(self, settings):
        settings.PAYSTACK_SECRET_KEY = TEST_KEY
        settings.PAYSTACK_ALLOW_LIVE = False

    def _response(self, payload, status_code=200):
        class _R:
            def __init__(self):
                self.status_code = status_code

            def json(self):
                return payload

        return _R()

    def test_verify_translates_a_successful_transaction(self):
        payload = {
            "status": True,
            "data": {
                "id": 302961,
                "status": "success",
                "amount": 150000,
                "currency": "GHS",
                "channel": "card",
                "paid_at": "2026-08-28T10:00:00.000Z",
            },
        }
        with patch("apps.payments.paystack.requests.request", return_value=self._response(payload)):
            state = PaystackPaymentProvider().query_payment(provider_reference="rmp_abc123")

        assert state.found is True
        assert state.status == "succeeded"
        assert state.amount_minor == 150000
        assert state.payment_method == "card"

    def test_a_checkout_the_payer_has_not_finished_is_not_a_failure(self):
        """Paystack's `abandoned` is an open checkout, not a declined payment.

        The status check that runs as checkout opens always sees it: nobody has
        had time to pay. Read as `failed`, it failed every payment before the
        payer could approve it.
        """
        payload = {
            "status": True,
            "data": {
                "id": 302962,
                "status": "abandoned",
                "amount": 8900,
                "currency": "GHS",
                "channel": "mobile_money",
                "paid_at": None,
            },
        }
        with patch("apps.payments.paystack.requests.request", return_value=self._response(payload)):
            state = PaystackPaymentProvider().query_payment(provider_reference="rmb_abc123")

        assert state.found is True
        assert state.status == "pending"
        assert state.raw_status == "abandoned"

    def test_a_timeout_is_not_reported_as_a_failed_payment(self):
        """The distinction that stops money going missing.

        A timeout means Paystack may well have accepted the request. Calling
        that a failure would let a retry charge somebody twice.
        """
        import requests as requests_module

        with (
            patch(
                "apps.payments.paystack.requests.request",
                side_effect=requests_module.Timeout(),
            ),
            pytest.raises(ProviderUnavailable, match="did not respond in time"),
        ):
            PaystackPaymentProvider().query_payment(provider_reference="rmp_abc123")

    def test_a_provider_outage_is_not_a_payment_decision(self):
        with (
            patch(
                "apps.payments.paystack.requests.request",
                return_value=self._response({}, status_code=503),
            ),
            pytest.raises(ProviderUnavailable),
        ):
            PaystackPaymentProvider().query_payment(provider_reference="rmp_abc123")

    def test_refused_credentials_are_reported_as_unavailable(self):
        with (
            patch(
                "apps.payments.paystack.requests.request",
                return_value=self._response({"status": False}, status_code=401),
            ),
            pytest.raises(ProviderUnavailable, match="credentials"),
        ):
            PaystackPaymentProvider().query_payment(provider_reference="rmp_abc123")

    def test_initiation_sends_pesewas_and_restricts_the_channel(self):
        """Two invariants in one request.

        The amount must leave as the same integer it is stored as, and the
        channel must be restricted to what the tenant chose — otherwise a payer
        offered every option could pay by card against a mobile-money intent,
        and the confirmation would reject a payment that really happened.
        """
        captured = {}

        def _capture(method, url, **kwargs):
            captured["method"] = method
            captured["url"] = url
            captured["json"] = kwargs.get("json")
            captured["timeout"] = kwargs.get("timeout")
            return self._response(
                {
                    "status": True,
                    "data": {
                        "reference": "rmp_abc123",
                        "authorization_url": "https://checkout.paystack.com/x",
                        "access_code": "acc_inline_123",
                    },
                }
            )

        class _Intent:
            id = "11111111-1111-1111-1111-111111111111"
            obligation_id = "22222222-2222-2222-2222-222222222222"
            lease_id = "33333333-3333-3333-3333-333333333333"
            tenant_id = "44444444-4444-4444-4444-444444444444"
            tenant = type("T", (), {"email": "ama@example.com"})()
            amount_minor = 150000
            amount_currency = "GHS"
            payment_method = "mobile_money"
            client_reference = "rmp_abc123"
            provider_subaccount_reference = "ACCT_provider123"
            platform_charge_minor = 4500
            provider_fee_bearer = "account"

        with patch("apps.payments.paystack.requests.request", side_effect=_capture):
            result = PaystackPaymentProvider().initiate(intent=_Intent())

        assert captured["json"]["amount"] == 150000
        assert captured["json"]["currency"] == "GHS"
        assert captured["json"]["channels"] == ["mobile_money"]
        # Our own reference is the outbound idempotency key: initiating twice
        # with it returns the same transaction instead of charging twice.
        assert captured["json"]["reference"] == "rmp_abc123"
        assert captured["json"]["subaccount"] == "ACCT_provider123"
        assert captured["json"]["transaction_charge"] == 4500
        assert captured["json"]["bearer"] == "account"
        assert captured["timeout"] is not None, "an outbound call with no timeout"
        assert result.next_action["type"] == "redirect"
        assert result.next_action["access_code"] == "acc_inline_123"

    def test_a_non_ghs_intent_is_refused_before_any_call(self):
        class _Intent:
            amount_currency = "NGN"

        with (
            patch("apps.payments.paystack.requests.request") as call,
            pytest.raises(ValidationFailed, match="GHS"),
        ):
            PaystackPaymentProvider().initiate(intent=_Intent())
        # The refusal happens before anything leaves the building.
        call.assert_not_called()

    def test_settlement_lookup_refuses_rather_than_inventing_an_answer(self):
        """Paystack settles in batches; there is no per-transaction lookup.

        Refusing is correct. `reconciliation.sweep_settlements` logs and skips,
        and the settlement stays `pending` — which is true.
        """
        with pytest.raises(ProviderUnavailable, match="batches"):
            PaystackPaymentProvider().query_settlement(provider_transaction_id="302961")

    def test_subaccount_provisioning_keeps_only_masked_provider_references(self):
        captured = {}

        def _capture(method, url, **kwargs):
            captured["json"] = kwargs["json"]
            return self._response(
                {
                    "status": True,
                    "data": {
                        "id": 1151727,
                        "subaccount_code": "ACCT_6uujpqtzmnufzkw",
                        "account_number": "0123456047",
                        "account_name": "OSU PROPERTIES",
                        "settlement_bank": "GCB Bank",
                        "is_verified": True,
                        "active": True,
                    },
                },
                status_code=201,
            )

        with patch("apps.payments.paystack.requests.request", side_effect=_capture):
            destination = PaystackPaymentProvider().provision_payout_destination(
                business_name="Osu Properties",
                bank_code="040",
                account_number="0123456047",
                provisioning_reference="019d-provisioning-operation",
            )

        assert captured["json"]["percentage_charge"] == 0
        assert captured["json"]["settlement_bank"] == "040"
        assert "bank_code" not in captured["json"]
        metadata = json.loads(captured["json"]["metadata"])
        assert metadata["rooomly_provisioning_reference"] == "019d-provisioning-operation"
        assert destination.token_reference == "ACCT_6uujpqtzmnufzkw"
        assert destination.provider_account_id == "1151727"
        assert destination.masked_account.endswith("6047")
        assert "0123456047" not in destination.masked_account
        assert destination.verified is True

    def test_ambiguous_subaccount_create_is_found_by_provisioning_metadata(self):
        calls = []

        def _lookup(method, url, **kwargs):
            calls.append((method, url, kwargs))
            if url.endswith("/subaccount"):
                return self._response(
                    {
                        "status": True,
                        "data": [
                            {
                                "id": 1151727,
                                "subaccount_code": "ACCT_recovered",
                                "metadata": json.dumps(
                                    {"rooomly_provisioning_reference": "019d-operation"}
                                ),
                            }
                        ],
                        "meta": {"pageCount": 1},
                    }
                )
            assert url.endswith("/subaccount/ACCT_recovered")
            return self._response(
                {
                    "status": True,
                    "data": {
                        "id": 1151727,
                        "subaccount_code": "ACCT_recovered",
                        "account_number": "0123456047",
                        "account_name": "OSU PROPERTIES",
                        "settlement_bank": "GCB Bank",
                        "is_verified": True,
                        "active": True,
                    },
                }
            )

        with patch("apps.payments.paystack.requests.request", side_effect=_lookup):
            destination = PaystackPaymentProvider().find_payout_destination(
                provisioning_reference="019d-operation"
            )

        assert destination is not None
        assert destination.token_reference == "ACCT_recovered"
        assert destination.masked_account == "****** 6047"
        assert [method for method, _, _ in calls] == ["GET", "GET"]

    def test_subaccount_refresh_reads_paystacks_current_verification_state(self):
        captured = {}

        def _fetch(method, url, **kwargs):
            captured.update({"method": method, "url": url, **kwargs})
            return self._response(
                {
                    "status": True,
                    "data": {
                        "id": 1151727,
                        "subaccount_code": "ACCT_verifiedlater",
                        "account_number": "0240000000",
                        "account_name": "OSU PROPERTIES",
                        "settlement_bank": "MTN",
                        "is_verified": True,
                        "active": True,
                    },
                }
            )

        with patch("apps.payments.paystack.requests.request", side_effect=_fetch):
            destination = PaystackPaymentProvider().get_payout_destination(
                provider_reference="ACCT_verifiedlater"
            )

        assert captured["method"] == "GET"
        assert captured["url"].endswith("/subaccount/ACCT_verifiedlater")
        assert destination.verified is True
        assert destination.token_reference == "ACCT_verifiedlater"

    def test_subaccount_refresh_rejects_an_invalid_provider_reference(self):
        with (
            patch("apps.payments.paystack.requests.request") as call,
            pytest.raises(ValidationFailed, match="reference is invalid"),
        ):
            PaystackPaymentProvider().get_payout_destination(provider_reference="../../transaction")
        call.assert_not_called()

    def test_ghana_payout_institutions_are_structured_by_method(self):
        captured = {}

        def _banks(method, url, **kwargs):
            captured.update(kwargs["params"])
            return self._response(
                {
                    "status": True,
                    "data": [
                        {"name": "GCB Bank", "code": "040", "active": True},
                        {"name": "Disabled Bank", "code": "999", "active": False},
                    ],
                }
            )

        with patch("apps.payments.paystack.requests.request", side_effect=_banks):
            rows = PaystackPaymentProvider().list_payout_institutions(method="bank")

        assert captured == {
            "country": "ghana",
            "currency": "GHS",
            "type": "ghipss",
            "perPage": 100,
        }
        assert [(row.code, row.name, row.method) for row in rows] == [("040", "GCB Bank", "bank")]

    def test_bank_resolution_returns_only_a_name_and_masked_account(self):
        captured = {}

        def _resolve(method, url, **kwargs):
            captured.update(kwargs["params"])
            return self._response(
                {
                    "status": True,
                    "data": {
                        "account_number": "0123456047",
                        "account_name": "OSU PROPERTIES",
                    },
                }
            )

        with patch("apps.payments.paystack.requests.request", side_effect=_resolve):
            result = PaystackPaymentProvider().resolve_payout_account(
                method="bank",
                bank_code="040",
                account_number="0123456047",
            )

        assert captured == {"account_number": "0123456047", "bank_code": "040"}
        assert result.account_name == "OSU PROPERTIES"
        assert result.masked_account == "****** 6047"

    def test_batch_settlements_and_transactions_are_fully_paginated(self):
        calls = []

        def _page(method, url, **kwargs):
            params = kwargs.get("params") or {}
            calls.append((url, params.copy()))
            page = params["page"]
            if url.endswith("/settlement"):
                rows = (
                    [
                        {
                            "id": 3090024,
                            "status": "success",
                            "currency": "GHS",
                            "settlement_date": "2026-08-28T08:00:00Z",
                        }
                    ]
                    if page == 1
                    else []
                )
                return self._response({"status": True, "data": rows, "meta": {"pageCount": 2}})
            assert url.endswith("/settlement/3090024/transactions")
            rows = (
                [
                    {
                        "id": 302961,
                        "reference": "rmp_abc123",
                        "amount": 150000,
                        "fees": 2900,
                        "currency": "GHS",
                    }
                ]
                if page == 1
                else [
                    {
                        "id": 302962,
                        "reference": "rmp_def456",
                        "amount": 90000,
                        "fees": 1900,
                        "currency": "GHS",
                    }
                ]
            )
            return self._response({"status": True, "data": rows, "meta": {"pageCount": 2}})

        with patch("apps.payments.paystack.requests.request", side_effect=_page):
            batches = PaystackPaymentProvider().list_settlement_batches(
                since=datetime(2026, 8, 27, tzinfo=UTC),
                provider_account_id="1151727",
            )

        assert len(batches) == 1
        assert batches[0].provider_settlement_reference == "3090024"
        assert batches[0].status == "settled"
        assert [row.provider_transaction_id for row in batches[0].transactions] == [
            "302961",
            "302962",
        ]
        settlement_call = next(params for url, params in calls if url.endswith("/settlement"))
        assert settlement_call["subaccount"] == "1151727"


class TestRegistration:
    @pytest.fixture(autouse=True)
    def _configured(self, settings):
        settings.PAYMENT_BACKEND = "paystack"
        settings.PAYSTACK_SECRET_KEY = TEST_KEY

    def test_the_registry_returns_the_paystack_adapter(self):
        from apps.payments.providers import get_payment_provider, reset_payment_provider

        reset_payment_provider()
        try:
            provider = get_payment_provider("paystack")
            assert provider.name == "paystack"
            assert isinstance(provider, PaystackPaymentProvider)
        finally:
            reset_payment_provider()

    def test_asking_for_a_different_provider_is_refused(self):
        from apps.payments.providers import get_payment_provider, reset_payment_provider

        reset_payment_provider()
        try:
            with pytest.raises(PermissionDenied):
                get_payment_provider("memory")
        finally:
            reset_payment_provider()
