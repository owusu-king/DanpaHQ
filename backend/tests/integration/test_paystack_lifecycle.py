"""The whole payment lifecycle, with Paystack as the configured adapter.

`test_paystack_adapter.py` tests the adapter in isolation: signatures, status
translation, the shape of the outbound request. This tests the *system* with
that adapter plugged in — intent, checkout, callback, allocation, ledger,
receipt, settlement, reconciliation — against authentic Paystack payload shapes,
with HTTP mocked only at the `requests` boundary.

**What this can and cannot prove.** It cannot prove Paystack's Ghana sandbox
behaves as documented; only an account can, and every item in
`PAYSTACK_INTEGRATION.md` that needs one is still open. What it proves is the
half that is Rooomly's own: that given a response of the shape Paystack
documents, this system does the right thing — and, more usefully, that given a
*wrong* one it refuses rather than guessing. The sandbox exercise then has a
much shorter list to confirm, and a failing test here is a Rooomly bug rather
than an integration surprise.

Every test names the go-live checklist item it covers.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import date, timedelta

import pytest
import requests as requests_module
from django.test import override_settings
from django.utils import timezone

from apps.core.exceptions import Conflict, NotFound, ProviderUnavailable, ValidationFailed
from apps.lease import services as lease_services
from apps.payments import payouts, reconciliation, settlements
from apps.payments import services as payment_services
from apps.payments.models import (
    IntentStatus,
    LedgerDirection,
    LedgerEntry,
    PaymentAllocation,
    PaymentAttempt,
    PaymentIntent,
    PaymentTransaction,
    ProviderWebhook,
    ReconciliationKind,
    Settlement,
    SettlementStatus,
    TransactionStatus,
    WebhookStatus,
)
from apps.payments.providers import reset_payment_provider
from apps.rent import services as rent_services
from apps.rent.models import ChargeStatus, PaymentVerificationSource, RentPayment

pytestmark = pytest.mark.django_db

TEST_KEY = "sk_test_" + "0" * 32  # nosec B105
SUBACCOUNT_CODE = "ACCT_lifecycle01"
SUBACCOUNT_ID = "1151727"

PAYSTACK_SETTINGS = {
    "PAYMENT_BACKEND": "paystack",
    "PAYSTACK_SECRET_KEY": TEST_KEY,
    "PAYSTACK_PLATFORM_CHARGE_BPS": "300",
    "PAYSTACK_CALLBACK_URL": "https://app.rooomly.test/payments/return",
}


# --- a stand-in Paystack -------------------------------------------------------


class FakePaystack:
    """Routes on (method, path) and answers in Paystack's documented shapes.

    Deliberately not a `Mock`: the point is to be *wrong* in the ways a real
    provider is wrong — a timeout, a 500, a transaction that verify does not
    know about — and a recorded call list so the outbound request can be
    asserted rather than assumed.
    """

    def __init__(self):
        self.calls: list[dict] = []
        self.transactions: dict[str, dict] = {}
        self.settlements: list[dict] = []
        self.settlement_transactions: dict[str, list[dict]] = {}
        self.fail_next_initialize: Exception | None = None
        self.initialize_count = 0

    # -- what the tests set up --------------------------------------------------

    def charge(self, reference: str, **fields) -> dict:
        row = {
            "id": fields.get("id", 302961),
            "reference": reference,
            "amount": fields.get("amount", 150000),
            "currency": fields.get("currency", "GHS"),
            "status": fields.get("status", "success"),
            "channel": fields.get("channel", "mobile_money"),
            "paid_at": fields.get("paid_at", "2026-08-28T10:00:00.000Z"),
        }
        self.transactions[reference] = row
        return row

    def settle(self, *, reference: str, settlement_id="stl_1", fees=2250, status="success"):
        self.settlements.append(
            {
                "id": settlement_id,
                "status": status,
                "currency": "GHS",
                "settlement_date": "2026-08-30T12:00:00.000Z",
            }
        )
        row = self.transactions[reference]
        self.settlement_transactions.setdefault(settlement_id, []).append(
            {
                "id": row["id"],
                "reference": reference,
                "amount": row["amount"],
                "fees": fees,
                "currency": "GHS",
            }
        )

    # -- the requests boundary --------------------------------------------------

    def __call__(self, method, url, **kwargs):
        path = url.replace("https://api.paystack.co", "")
        self.calls.append(
            {
                "method": method,
                "path": path,
                "json": kwargs.get("json"),
                "params": kwargs.get("params"),
            }
        )

        if method == "POST" and path == "/transaction/initialize":
            self.initialize_count += 1
            if self.fail_next_initialize is not None:
                error, self.fail_next_initialize = self.fail_next_initialize, None
                raise error
            reference = kwargs["json"]["reference"]
            return _ok(
                {
                    "reference": reference,
                    "authorization_url": f"https://checkout.paystack.com/{reference}",
                    "access_code": "acc_1",
                }
            )

        if method == "GET" and path.startswith("/transaction/verify/"):
            reference = path.rsplit("/", 1)[-1]
            row = self.transactions.get(reference)
            if row is None:
                # Paystack answers `status: false` for a reference it has never
                # seen, which must read as "no record", never as "failed".
                return _response({"status": False, "message": "Transaction not found"})
            return _ok(row)

        if method == "GET" and path == "/settlement":
            return _paginated(self.settlements)

        if method == "GET" and path.startswith("/settlement/") and path.endswith("/transactions"):
            settlement_id = path.split("/")[2]
            return _paginated(self.settlement_transactions.get(settlement_id, []))

        if method == "GET" and path.startswith("/subaccount/"):
            return _ok(
                {
                    "subaccount_code": SUBACCOUNT_CODE,
                    "id": SUBACCOUNT_ID,
                    "account_number": "0123456789",
                    "account_name": "Osu Properties",
                    "settlement_bank": "Test Bank",
                    "is_verified": True,
                    "active": True,
                }
            )

        raise AssertionError(f"unexpected Paystack call: {method} {path}")


def _response(payload, status_code=200):
    class _R:
        def __init__(self):
            self.status_code = status_code

        def json(self):
            return payload

    return _R()


def _ok(data):
    return _response({"status": True, "data": data})


def _paginated(rows):
    return _response({"status": True, "data": rows, "meta": {"pageCount": 1}})


def signed(payload: dict) -> tuple[bytes, dict]:
    """HMAC-SHA512 over the exact bytes, the way Paystack signs."""
    body = json.dumps(payload).encode()
    return body, {
        "X-Paystack-Signature": hmac.new(TEST_KEY.encode(), body, hashlib.sha512).hexdigest()
    }


def charge_event(row: dict, event: str = "charge.success") -> dict:
    return {"event": event, "data": dict(row)}


# --- fixtures ------------------------------------------------------------------


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


@pytest.fixture
def portfolio(landlord, address, approve_provider):
    from apps.organization import services as organization_services
    from apps.property import services as property_services
    from tests.conftest import approve_provider_standing

    organization = organization_services.create_organization(
        user=landlord,
        data={
            "name": "Osu Properties",
            "organization_type": "individual_owner",
            "activities": ["residential"],
        },
    )
    approve_provider_standing(landlord)
    prop = property_services.create_private_property(
        user=landlord,
        organization=organization,
        data={"title": "Osu block", "property_type": "residential", "address_id": address.id},
    )
    approve_provider(landlord, prop)
    space = property_services.add_unit(
        prop=prop,
        user=landlord,
        data={"label": "Flat A", "space_type": "apartment", "bedrooms": 1},
    )
    return organization, space


@pytest.fixture
def paystack(landlord, portfolio):
    """A verified Portfolio destination, and the fake provider behind it."""
    organization, _ = portfolio
    payouts.set_payout_destination(
        organization=organization,
        user=landlord,
        data={
            "method": "bank",
            "provider": "paystack",
            "token_reference": SUBACCOUNT_CODE,
            "provider_account_id": SUBACCOUNT_ID,
            "masked_account": "****** 6789",
            "account_name": "Osu Properties",
        },
    )
    payouts.mark_payout_verified(organization=organization)
    reset_payment_provider()
    yield FakePaystack()
    reset_payment_provider()


@pytest.fixture
def obligation(landlord, user, portfolio):
    _, space = portfolio
    lease = lease_services.draft_lease(
        user=landlord,
        unit=space,
        tenant=user,
        data={
            "rent_minor": 150000,
            "advance_months": 1,
            "deposit_months": 0,
            "agency_fee_months": 0,
            "starts_on": date.today(),
            "term_months": 12,
        },
    )
    lease = lease_services.offer_lease(lease=lease, user=landlord)
    lease = lease_services.accept_lease(lease=lease, user=user)
    return lease, rent_services.build_schedule(lease)[0]


def _patch(fake):
    return pytest.MonkeyPatch.context()


@pytest.fixture
def live(paystack, monkeypatch):
    """Paystack configured, with its HTTP boundary replaced."""
    monkeypatch.setattr("apps.payments.paystack.requests.request", paystack)
    with override_settings(**PAYSTACK_SETTINGS):
        yield paystack


# --- the lifecycle -------------------------------------------------------------


class TestCheckout:
    """Checklist: the amount arrives as pesewas; the channel is restricted."""

    def test_initiation_sends_the_split_and_the_exact_pesewa_amount(
        self, live, landlord, user, obligation
    ):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )

        sent = next(c for c in live.calls if c["path"] == "/transaction/initialize")["json"]
        assert sent["amount"] == charge.amount_minor == 150000
        assert sent["currency"] == "GHS"
        assert sent["reference"] == intent.client_reference
        assert sent["channels"] == ["mobile_money"]
        assert sent["subaccount"] == SUBACCOUNT_CODE
        assert sent["bearer"] == "subaccount"
        # 300 bps of 150000, half-up, in the subunit. No float touched it.
        assert sent["transaction_charge"] == 4500
        assert sent["callback_url"] == PAYSTACK_SETTINGS["PAYSTACK_CALLBACK_URL"]

        assert intent.status == IntentStatus.PENDING
        assert intent.next_action["url"].startswith("https://checkout.paystack.com/")
        assert intent.next_action["access_code"] == "acc_1"

    @pytest.mark.parametrize(
        ("method", "channels"),
        [
            ("mobile_money", ["mobile_money"]),
            ("card", ["card"]),
            ("bank_transfer", ["bank", "bank_transfer", "ussd"]),
        ],
    )
    def test_each_channel_is_offered_only_what_the_tenant_chose(
        self, live, landlord, user, obligation, method, channels
    ):
        """Checklist: one payment on each channel.

        Restricting `channels` is what stops a payer settling by card against an
        intent that says mobile money — which would then fail its own method
        check on a payment that really happened.
        """
        _, charge = obligation
        payment_services.create_intent(obligation=charge, user=user, payment_method=method)
        sent = next(c for c in live.calls if c["path"] == "/transaction/initialize")["json"]
        assert sent["channels"] == channels


class TestSuccess:
    def test_a_signed_success_produces_the_whole_financial_record(
        self, live, landlord, user, obligation
    ):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        row = live.charge(intent.provider_reference, amount=charge.amount_minor)
        body, headers = signed(charge_event(row))

        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)

        intent.refresh_from_db()
        charge.refresh_from_db()
        assert intent.status == IntentStatus.SUCCEEDED
        assert charge.status == ChargeStatus.PAID

        transaction_row = PaymentTransaction.objects.get(status=TransactionStatus.SUCCEEDED)
        assert transaction_row.provider_transaction_id == str(row["id"])
        assert transaction_row.amount_minor == charge.amount_minor

        allocation = PaymentAllocation.objects.get()
        assert allocation.amount_minor == charge.amount_minor

        lines = list(LedgerEntry.objects.filter(transaction=transaction_row))
        assert len(lines) == 2
        debit = sum(r.amount_minor for r in lines if r.direction == LedgerDirection.DEBIT)
        credit = sum(r.amount_minor for r in lines if r.direction == LedgerDirection.CREDIT)
        assert debit == credit == charge.amount_minor

        assert transaction_row.receipt.final_pdf
        rent_row = RentPayment.objects.get(charge=charge)
        assert rent_row.verification_source == PaymentVerificationSource.PSP

        settlement = Settlement.objects.get(transaction=transaction_row)
        assert settlement.status == SettlementStatus.PENDING

    def test_the_callback_is_cross_checked_against_verify(self, live, landlord, user, obligation):
        """A signature proves who sent it, not that the payment is real."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        row = live.charge(intent.provider_reference, amount=charge.amount_minor)
        body, headers = signed(charge_event(row))
        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)
        assert any(c["path"].startswith("/transaction/verify/") for c in live.calls)

    def test_a_callback_verify_does_not_recognise_is_refused(
        self, live, landlord, user, obligation
    ):
        """Signed, well-formed, and not backed by anything at the provider."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        # Never registered with the fake, so verify answers `status: false`.
        row = {
            "id": 999001,
            "reference": intent.provider_reference,
            "amount": charge.amount_minor,
            "currency": "GHS",
            "status": "success",
            "channel": "mobile_money",
            "paid_at": "2026-08-28T10:00:00.000Z",
        }
        body, headers = signed(charge_event(row))
        with pytest.raises(Conflict, match="no record"):
            payment_services.process_webhook(
                provider_name="paystack", raw_body=body, headers=headers
            )
        assert not PaymentTransaction.objects.exists()


class TestWrongEvidence:
    """Checklist-adjacent: the refusals that keep a wrong number out."""

    def _intent(self, live, user, charge):
        return payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )

    def test_an_amount_that_disagrees_with_the_intent_is_refused(
        self, live, landlord, user, obligation
    ):
        _, charge = obligation
        intent = self._intent(live, user, charge)
        row = live.charge(intent.provider_reference, amount=charge.amount_minor - 100)
        body, headers = signed(charge_event(row))
        with pytest.raises((Conflict, ValidationFailed)):
            payment_services.process_webhook(
                provider_name="paystack", raw_body=body, headers=headers
            )
        charge.refresh_from_db()
        assert charge.status != ChargeStatus.PAID

    def test_a_currency_that_disagrees_is_refused(self, live, landlord, user, obligation):
        _, charge = obligation
        intent = self._intent(live, user, charge)
        row = live.charge(intent.provider_reference, amount=charge.amount_minor, currency="NGN")
        body, headers = signed(charge_event(row))
        with pytest.raises((Conflict, ValidationFailed)):
            payment_services.process_webhook(
                provider_name="paystack", raw_body=body, headers=headers
            )

    def test_a_reference_matching_no_intent_is_recorded_and_refused(self, live):
        """Checklist: an unknown reference must leave evidence, not vanish."""
        row = {
            "id": 500123,
            "reference": "rmp_not_ours",
            "amount": 150000,
            "currency": "GHS",
            "status": "success",
            "channel": "mobile_money",
            "paid_at": "2026-08-28T10:00:00.000Z",
        }
        live.transactions[row["reference"]] = row
        body, headers = signed(charge_event(row))
        # `NotFound`: signed, verified at the provider, and matching no intent
        # Rooomly ever created — which is the shape an orphaned charge takes.
        with pytest.raises(NotFound):
            payment_services.process_webhook(
                provider_name="paystack", raw_body=body, headers=headers
            )
        webhook = ProviderWebhook.objects.get(provider="paystack")
        assert webhook.status == WebhookStatus.FAILED
        assert webhook.signature_valid is True

        # And the sweep raises it, so unmatched provider money is not invisible.
        ProviderWebhook.objects.update(created_at=timezone.now() - timedelta(hours=2))
        assert reconciliation.sweep_unmatched_provider_events() == 1
        assert (
            reconciliation.ReconciliationException.objects.get().kind
            == ReconciliationKind.UNMATCHED_PROVIDER_EVENT
        )

    def test_a_method_that_disagrees_with_the_intent_is_refused(
        self, live, landlord, user, obligation
    ):
        _, charge = obligation
        intent = self._intent(live, user, charge)
        row = live.charge(intent.provider_reference, amount=charge.amount_minor, channel="card")
        body, headers = signed(charge_event(row))
        with pytest.raises(ValidationFailed):
            payment_services.process_webhook(
                provider_name="paystack", raw_body=body, headers=headers
            )


class TestRedeliveryAndOrdering:
    def test_a_redelivered_webhook_changes_nothing(self, live, landlord, user, obligation):
        """Checklist: redeliver from the dashboard; the second changes nothing."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        row = live.charge(intent.provider_reference, amount=charge.amount_minor)
        body, headers = signed(charge_event(row))

        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)
        verifies = sum(1 for c in live.calls if c["path"].startswith("/transaction/verify/"))

        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)

        assert PaymentTransaction.objects.filter(status=TransactionStatus.SUCCEEDED).count() == 1
        assert PaymentAllocation.objects.count() == 1
        assert LedgerEntry.objects.count() == 2
        assert RentPayment.objects.count() == 1
        # A replay storm must not become a query storm at the provider.
        assert (
            sum(1 for c in live.calls if c["path"].startswith("/transaction/verify/")) == verifies
        )

    def test_a_late_callback_after_the_tenant_already_refreshed_is_a_no_op(
        self, live, landlord, user, obligation
    ):
        """Out of order: the tenant's return beat the webhook to it."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        live.charge(intent.provider_reference, amount=charge.amount_minor)

        # The tenant comes back to the app first.
        payment_services.refresh_intent_from_provider(intent=intent, user=user)
        intent.refresh_from_db()
        assert intent.status == IntentStatus.SUCCEEDED

        # Paystack's callback arrives afterwards.
        body, headers = signed(charge_event(live.transactions[intent.provider_reference]))
        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)

        assert PaymentTransaction.objects.filter(status=TransactionStatus.SUCCEEDED).count() == 1
        assert PaymentAllocation.objects.count() == 1

    def test_a_stale_pending_callback_cannot_demote_a_settled_payment(
        self, live, landlord, user, obligation
    ):
        """Out of order the other way: an older event delivered after a newer."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        row = live.charge(intent.provider_reference, amount=charge.amount_minor)
        body, headers = signed(charge_event(row))
        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)

        stale = dict(row)
        stale["status"] = "pending"
        stale_body, stale_headers = signed(charge_event(stale, event="charge.pending"))
        # `charge.pending` is not an event this flow acts on; it is acknowledged
        # and recorded rather than allowed to rewrite a settled payment.
        result = payment_services.process_webhook(
            provider_name="paystack", raw_body=stale_body, headers=stale_headers
        )
        assert result is None
        intent.refresh_from_db()
        assert intent.status == IntentStatus.SUCCEEDED


class TestFailureRetryAndAbandonment:
    def test_a_failed_payment_then_a_successful_retry_settles_once(
        self, live, landlord, user, obligation
    ):
        """Checklist: one allocation and one RentPayment after a retry."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        failed = live.charge(
            intent.provider_reference, amount=charge.amount_minor, status="failed", id=700001
        )
        body, headers = signed(charge_event(failed, event="charge.failed"))
        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)
        intent.refresh_from_db()
        assert intent.status == IntentStatus.FAILED
        assert PaymentTransaction.objects.filter(status=TransactionStatus.FAILED).count() == 1

        payment_services.retry_intent(intent=intent, user=user)
        intent.refresh_from_db()
        succeeded = live.charge(
            intent.provider_reference, amount=charge.amount_minor, status="success", id=700002
        )
        body, headers = signed(charge_event(succeeded))
        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)

        charge.refresh_from_db()
        assert charge.status == ChargeStatus.PAID
        assert PaymentAllocation.objects.count() == 1
        assert RentPayment.objects.count() == 1
        # The failure is kept: it is what somebody disputing a charge needs.
        assert PaymentTransaction.objects.count() == 2
        assert PaymentAttempt.objects.filter(intent=intent).count() == 2

    def test_a_timeout_during_initiation_leaves_a_resumable_reservation(
        self, live, landlord, user, obligation
    ):
        """Checklist-adjacent: Paystack may have accepted a request we lost."""
        _, charge = obligation
        live.fail_next_initialize = requests_module.Timeout()

        with pytest.raises(ProviderUnavailable):
            payment_services.create_intent(
                obligation=charge, user=user, payment_method="mobile_money"
            )

        reservation = PaymentIntent.objects.get(obligation=charge)
        assert reservation.status == IntentStatus.CREATED
        assert reservation.provider_reference == ""

        resumed = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        assert resumed.id == reservation.id
        assert PaymentIntent.objects.count() == 1
        # The same outbound reference both times, so Paystack returns the same
        # transaction rather than opening a second one.
        references = [
            c["json"]["reference"] for c in live.calls if c["path"] == "/transaction/initialize"
        ]
        assert len(references) == 2
        assert references[0] == references[1]

    def test_an_abandoned_checkout_expires_and_frees_the_obligation(
        self, live, landlord, user, obligation
    ):
        """Checklist-adjacent: the payer closed the page and never came back."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        PaymentIntent.objects.filter(id=intent.id).update(
            expires_at=timezone.now() - timedelta(minutes=1)
        )

        assert payment_services.expire_due_intents() == 1
        intent.refresh_from_db()
        assert intent.status == IntentStatus.EXPIRED

        # And the tenant can start again.
        fresh = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        assert fresh.id != intent.id
        assert fresh.status == IntentStatus.PENDING


class TestPartialPayment:
    def test_two_part_payments_settle_the_charge_exactly(self, live, landlord, user, obligation):
        """ADR 0031, over the Paystack rail rather than the sandbox adapter."""
        _, charge = obligation
        full = charge.outstanding_minor
        first_part = full // 4

        first = payment_services.create_intent(
            obligation=charge,
            user=user,
            payment_method="mobile_money",
            amount_minor=first_part,
        )
        assert (
            next(c for c in live.calls if c["path"] == "/transaction/initialize")["json"]["amount"]
            == first_part
        )
        row = live.charge(first.provider_reference, amount=first_part, id=800001)
        body, headers = signed(charge_event(row))
        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)

        charge.refresh_from_db()
        assert charge.status == ChargeStatus.PART_PAID
        assert charge.outstanding_minor == full - first_part

        second = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        assert second.amount_minor == full - first_part
        row = live.charge(second.provider_reference, amount=second.amount_minor, id=800002)
        body, headers = signed(charge_event(row))
        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)

        charge.refresh_from_db()
        assert charge.status == ChargeStatus.PAID
        assert charge.outstanding_minor == 0
        assert sum(a.amount_minor for a in PaymentAllocation.objects.all()) == full
        assert LedgerEntry.objects.count() == 4


class TestSettlementImport:
    def test_only_the_exact_transaction_in_a_successful_batch_settles(
        self, live, landlord, user, obligation
    ):
        """Checklist: gross/fee/net must match the dashboard exactly."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        row = live.charge(intent.provider_reference, amount=charge.amount_minor)
        body, headers = signed(charge_event(row))
        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)

        settlement = Settlement.objects.get()
        assert settlement.status == SettlementStatus.PENDING

        provider_fee = 2250
        live.settle(reference=intent.provider_reference, fees=provider_fee)
        assert settlements.import_provider_settlements() == 1

        settlement.refresh_from_db()
        assert settlement.status == SettlementStatus.SETTLED
        assert settlement.gross_amount_minor == charge.amount_minor
        # The Portfolio bears Paystack's fee *and* the Rooomly platform charge.
        assert settlement.fee_amount_minor == 4500 + provider_fee
        assert settlement.net_amount_minor == charge.amount_minor - 4500 - provider_fee
        assert settlement.settled_at is not None

        # Checklist: re-importing the same batch is idempotent.
        assert settlements.import_provider_settlements() == 0

    def test_a_batch_that_pays_a_different_amount_is_raised_not_accepted(
        self, live, landlord, user, obligation
    ):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        row = live.charge(intent.provider_reference, amount=charge.amount_minor)
        body, headers = signed(charge_event(row))
        payment_services.process_webhook(provider_name="paystack", raw_body=body, headers=headers)

        # Paystack reports having settled a different figure than it charged.
        live.settle(reference=intent.provider_reference)
        live.settlement_transactions["stl_1"][0]["amount"] = charge.amount_minor - 5000

        assert settlements.import_provider_settlements() == 0
        Settlement.objects.get().refresh_from_db()
        assert Settlement.objects.get().status == SettlementStatus.PENDING
        assert (
            reconciliation.ReconciliationException.objects.get().kind
            == ReconciliationKind.SETTLEMENT_AMOUNT_MISMATCH
        )


class TestReconciliationRecovery:
    def test_a_payment_whose_callback_never_arrived_is_recovered(
        self, live, landlord, user, obligation
    ):
        """Checklist: kill the worker mid-payment; reconciliation finds it."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        # Paystack took the money. No webhook ever reached Rooomly.
        live.charge(intent.provider_reference, amount=charge.amount_minor)

        result = reconciliation.sweep_open_intents(min_age_seconds=0)
        assert result == {"exceptions": 0, "recovered": 1}

        intent.refresh_from_db()
        charge.refresh_from_db()
        assert intent.status == IntentStatus.SUCCEEDED
        assert charge.status == ChargeStatus.PAID
        assert PaymentAllocation.objects.count() == 1
        assert PaymentTransaction.objects.get().receipt.final_pdf

    def test_a_disagreement_is_recorded_and_never_repaired(self, live, landlord, user, obligation):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        live.charge(intent.provider_reference, amount=charge.amount_minor - 7000)

        result = reconciliation.sweep_open_intents(min_age_seconds=0)
        assert result == {"exceptions": 1, "recovered": 0}
        assert (
            reconciliation.ReconciliationException.objects.get().kind
            == ReconciliationKind.AMOUNT_MISMATCH
        )
        charge.refresh_from_db()
        assert charge.status != ChargeStatus.PAID
        assert not PaymentTransaction.objects.exists()


class TestAccountLevelEvents:
    def test_a_transfer_event_is_acknowledged_and_ignored(self, live):
        """A Paystack account emits more than charges.

        Refusing them makes the provider retry and eventually disable the
        endpoint the real payments arrive on.
        """
        body, headers = signed({"event": "transfer.success", "data": {"id": 9}})
        assert (
            payment_services.process_webhook(
                provider_name="paystack", raw_body=body, headers=headers
            )
            is None
        )
        assert ProviderWebhook.objects.get().status == WebhookStatus.IGNORED
