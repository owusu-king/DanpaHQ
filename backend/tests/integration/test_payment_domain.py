"""Attempts, allocation, payout destinations and reconciliation.

The invariants here are the ones a dispute or an audit would turn on, so they
are stated as claims about money rather than as coverage of functions:

- trying three times to pay one charge pays it once;
- a charge is settled because an allocation says so, not because a payment
  exists somewhere near it;
- money cannot be allocated twice, nor beyond what arrived;
- redirecting a Portfolio's rent is a narrower power than collecting it;
- a disagreement with the provider is recorded, never quietly repaired.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import date
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import (
    Conflict,
    PermissionDenied,
    ProviderUnavailable,
    ValidationFailed,
)
from apps.lease import services as lease_services
from apps.payments import payouts, reconciliation, settlements
from apps.payments import services as payment_services
from apps.payments.models import (
    AttemptStatus,
    IntentStatus,
    PaymentAllocation,
    PaymentAttempt,
    PaymentTransaction,
    PayoutProfile,
    PayoutProfileStatus,
    PayoutProvisioningOperation,
    PayoutProvisioningStatus,
    ProviderFeeBearer,
    ReconciliationKind,
    ReconciliationStatus,
    Settlement,
    SettlementStatus,
    TransactionStatus,
)
from apps.payments.providers import (
    InitiationResult,
    ProviderPayoutDestination,
    ProviderPayoutInstitution,
    ProviderResolvedPayoutAccount,
    ProviderSettlementBatch,
    ProviderSettlementTransaction,
)
from apps.rent import services as rent_services
from apps.rent.models import ChargeStatus, RentCharge

pytestmark = pytest.mark.django_db

#: Matches `config.settings.test`, where the signed sandbox adapter is the
#: configured backend. Production has no adapter at all.
SECRET = "test-payment-webhook-secret"  # nosec B105


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


@pytest.fixture
def portfolio(landlord, address, approve_provider):
    """An organization with one Property and one Unit, made the product's way."""
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
        data={
            "title": "Osu block",
            "property_type": "residential",
            "address_id": address.id,
        },
    )
    approve_provider(landlord, prop)
    space = property_services.add_unit(
        prop=prop,
        user=landlord,
        data={"label": "Flat A", "space_type": "apartment", "bedrooms": 1},
    )
    return organization, space


@pytest.fixture
def obligation(landlord, user, portfolio):
    """A live tenancy with a real, authoritative charge to pay."""
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
    charges = rent_services.build_schedule(lease)
    return lease, charges[0]


def _signed(payload: dict) -> tuple[bytes, dict]:
    body = json.dumps(payload).encode()
    signature = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    return body, {"X-Payment-Signature": signature}


def _success_payload(intent, *, transaction_id="psp_txn_1", event_id="evt_1"):
    return {
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


def _failure_payload(intent, *, event_id, transaction_id):
    return {
        **_success_payload(intent, transaction_id=transaction_id, event_id=event_id),
        "event_type": "payment.failed",
        "status": "failed",
    }


class TestPostTenancyCollection:
    def test_ended_agreement_remains_payable_and_produces_a_receipt(
        self, landlord, user, obligation
    ):
        from apps.outbox.tasks import dispatch_pending
        from apps.payments.models import Receipt

        lease, charge = obligation
        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        dispatch_pending()
        lease.refresh_from_db()
        charge.refresh_from_db()
        assert lease.status == "ended"
        assert charge.outstanding_minor > 0

        intent = payment_services.create_intent(
            obligation=charge,
            user=user,
            payment_method="mobile_money",
        )
        body, headers = _signed(
            _success_payload(
                intent,
                transaction_id="post_end_payment",
                event_id="post_end_payment_event",
            )
        )
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

        intent.refresh_from_db()
        charge.refresh_from_db()
        assert intent.status == IntentStatus.SUCCEEDED
        assert charge.status == ChargeStatus.PAID
        assert Receipt.objects.filter(transaction__intent=intent).exists()


class TestAttempts:
    """One intent, several tries, at most one payment."""

    def test_three_tries_at_one_charge_pay_it_once(self, landlord, user, obligation):
        lease, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        assert intent.attempts.count() == 1

        # Attempt one fails.
        body, headers = _signed(
            _failure_payload(intent, event_id="evt_f1", transaction_id="psp_fail_1")
        )
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        intent.refresh_from_db()
        assert intent.status == IntentStatus.FAILED
        assert intent.attempts.get(sequence=1).status == AttemptStatus.FAILED

        # The person tries again against the same obligation.
        attempt = payment_services.retry_intent(intent=intent, user=user)
        assert attempt.sequence == 2
        intent.refresh_from_db()

        # And this one works.
        body, headers = _signed(_success_payload(intent, event_id="evt_s1"))
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

        intent.refresh_from_db()
        charge.refresh_from_db()
        assert intent.status == IntentStatus.SUCCEEDED
        assert intent.attempts.count() == 2
        assert intent.attempts.filter(status=AttemptStatus.SUCCEEDED).count() == 1
        # One charge, one payment, whatever the person went through.
        assert charge.status == ChargeStatus.PAID
        assert (
            PaymentTransaction.objects.filter(
                intent=intent, status=TransactionStatus.SUCCEEDED
            ).count()
            == 1
        )
        assert PaymentAllocation.objects.filter(obligation=charge).count() == 1

    def test_a_second_success_on_one_intent_is_refused_by_the_database(
        self, landlord, user, obligation
    ):
        from django.db import IntegrityError
        from django.db import transaction as db_transaction

        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        first = intent.attempts.get(sequence=1)
        first.status = AttemptStatus.SUCCEEDED
        first.save(update_fields=["status", "updated_at"])

        # Not a service check — the constraint itself. A duplicate rent payment
        # must be impossible even to code that forgets to ask.
        with pytest.raises(IntegrityError), db_transaction.atomic():
            PaymentAttempt.objects.create(
                intent=intent,
                sequence=2,
                provider=intent.provider,
                payment_method=intent.payment_method,
                status=AttemptStatus.SUCCEEDED,
                started_at=timezone.now(),
            )

    def test_a_second_successful_transaction_is_refused_by_the_database(
        self, landlord, user, obligation
    ):
        """The constraint that stops one obligation being paid twice.

        Asserted against the database rather than through a service, because
        the guarantee has to hold for a replayed webhook and a racing worker —
        neither of which goes through the checks a service performs.
        """
        from django.db import IntegrityError
        from django.db import transaction as db_transaction

        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        body, headers = _signed(_success_payload(intent))
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        intent.refresh_from_db()
        assert intent.transactions.filter(status=TransactionStatus.SUCCEEDED).count() == 1

        second = PaymentTransaction(
            intent=intent,
            provider="memory",
            provider_transaction_id="psp_txn_duplicate",
            payment_method="mobile_money",
            status=TransactionStatus.SUCCEEDED,
            paid_at=timezone.now(),
        )
        second.amount_minor = intent.amount_minor
        second.amount_currency = intent.amount_currency
        with pytest.raises(IntegrityError), db_transaction.atomic():
            second.save()

    def test_a_failed_transaction_does_not_block_a_successful_retry(
        self, landlord, user, obligation
    ):
        """The reason the relationship stopped being one-to-one.

        A declined attempt is a provider record somebody may need in a dispute,
        so it stays — and it must not stand in the way of the try that works.
        """
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        body, headers = _signed(
            _failure_payload(intent, event_id="evt_f9", transaction_id="psp_fail_9")
        )
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        intent.refresh_from_db()
        assert intent.transactions.filter(status=TransactionStatus.FAILED).count() == 1

        payment_services.retry_intent(intent=intent, user=user)
        intent.refresh_from_db()
        body, headers = _signed(_success_payload(intent, event_id="evt_s9"))
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

        intent.refresh_from_db()
        assert intent.status == IntentStatus.SUCCEEDED
        # Both results survive: the decline and the success.
        assert intent.transactions.count() == 2
        assert intent.transactions.filter(status=TransactionStatus.SUCCEEDED).count() == 1

    def test_a_succeeded_intent_cannot_be_retried(self, landlord, user, obligation):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        body, headers = _signed(_success_payload(intent))
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        intent.refresh_from_db()
        with pytest.raises(Conflict, match="cannot be retried"):
            payment_services.retry_intent(intent=intent, user=user)

    def test_a_stale_intent_over_a_successful_attempt_still_cannot_be_retried(
        self, landlord, user, obligation
    ):
        """Defence in depth, and the case the status alone does not cover.

        An intent whose status has not caught up — a crash between recording the
        attempt and updating the intent — would pass the status check. The money
        has already moved, so the attempt is the authority.
        """
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        attempt = intent.attempts.get(sequence=1)
        attempt.status = AttemptStatus.SUCCEEDED
        attempt.save(update_fields=["status", "updated_at"])
        # The intent still reads as open.
        assert intent.status in ("pending", "processing")

        with pytest.raises(Conflict, match="already succeeded"):
            payment_services.retry_intent(intent=intent, user=user)

    def test_another_tenant_cannot_retry_somebody_elses_payment(
        self, landlord, user, agent, obligation
    ):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        with pytest.raises(PermissionDenied):
            payment_services.retry_intent(intent=intent, user=agent)


class TestTheCallbackIsNotTakenOnTrust:
    """A signed callback proves who sent it, not that the payment is real.

    Paystack's own guidance is to verify the signature, answer 200, and then ask
    the provider directly before granting value. These are the cases where the
    second opinion is the only thing standing between a callback and somebody's
    rent being marked paid.

    The sandbox is driven through `PAYMENT_TEST_STATE`, so the provider's answer
    can be made to disagree with the callback — which no amount of signing can
    produce, and which is exactly the class of incident this prevents.
    """

    def _intent(self, user, charge):
        return payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )

    def test_a_payment_the_provider_has_no_record_of_is_refused(self, landlord, user, obligation):
        _, charge = obligation
        intent = self._intent(user, charge)
        body, headers = _signed(_success_payload(intent))

        # The provider is answering, and says it has never heard of this.
        with (
            override_settings(PAYMENT_TEST_STATE={"payments": {}}),
            pytest.raises(Conflict, match="no record of that payment"),
        ):
            payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

        charge.refresh_from_db()
        intent.refresh_from_db()
        assert charge.status != ChargeStatus.PAID
        assert intent.status != IntentStatus.SUCCEEDED
        assert PaymentTransaction.objects.count() == 0
        assert PaymentAllocation.objects.count() == 0

    def test_a_payment_the_provider_calls_failed_is_refused(self, landlord, user, obligation):
        """The case a replayed or altered callback would produce."""
        _, charge = obligation
        intent = self._intent(user, charge)
        body, headers = _signed(_success_payload(intent))

        state = {
            "payments": {
                intent.provider_reference: {
                    "provider_transaction_id": "psp_txn_1",
                    "status": "failed",
                    "amount_minor": intent.amount_minor,
                    "currency": intent.amount_currency,
                    "payment_method": intent.payment_method,
                }
            }
        }
        with (
            override_settings(PAYMENT_TEST_STATE=state),
            pytest.raises(Conflict, match="does not show that payment as successful"),
        ):
            payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

        charge.refresh_from_db()
        assert charge.status != ChargeStatus.PAID

    def test_a_callback_amount_the_provider_disagrees_with_is_refused(
        self, landlord, user, obligation
    ):
        _, charge = obligation
        intent = self._intent(user, charge)
        body, headers = _signed(_success_payload(intent))

        state = {
            "payments": {
                intent.provider_reference: {
                    "provider_transaction_id": "psp_txn_1",
                    "status": "succeeded",
                    # The provider took a tenth of what the callback claims.
                    "amount_minor": intent.amount_minor // 10,
                    "currency": intent.amount_currency,
                    "payment_method": intent.payment_method,
                }
            }
        }
        with (
            override_settings(PAYMENT_TEST_STATE=state),
            pytest.raises(Conflict, match="amount does not match"),
        ):
            payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

        charge.refresh_from_db()
        assert charge.status != ChargeStatus.PAID

    def test_a_callback_currency_the_provider_disagrees_with_is_refused(
        self, landlord, user, obligation
    ):
        _, charge = obligation
        intent = self._intent(user, charge)
        body, headers = _signed(_success_payload(intent))

        state = {
            "payments": {
                intent.provider_reference: {
                    "provider_transaction_id": "psp_txn_1",
                    "status": "succeeded",
                    "amount_minor": intent.amount_minor,
                    "currency": "NGN",
                    "payment_method": intent.payment_method,
                }
            }
        }
        with (
            override_settings(PAYMENT_TEST_STATE=state),
            pytest.raises(Conflict, match="currency does not match"),
        ):
            payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

    def test_a_payment_the_provider_confirms_goes_through(self, landlord, user, obligation):
        """The check must not be so strict that nothing legitimate survives it."""
        _, charge = obligation
        intent = self._intent(user, charge)
        body, headers = _signed(_success_payload(intent))

        state = {
            "payments": {
                intent.provider_reference: {
                    "provider_transaction_id": "psp_txn_1",
                    "status": "succeeded",
                    "amount_minor": intent.amount_minor,
                    "currency": intent.amount_currency,
                    "payment_method": intent.payment_method,
                }
            }
        }
        with override_settings(PAYMENT_TEST_STATE=state):
            payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)

        charge.refresh_from_db()
        intent.refresh_from_db()
        assert intent.status == IntentStatus.SUCCEEDED
        assert charge.status == ChargeStatus.PAID
        assert PaymentAllocation.objects.filter(obligation=charge).count() == 1

    def test_a_provider_that_cannot_answer_does_not_block_a_payment(
        self, landlord, user, obligation
    ):
        """Skipped, not failed.

        An adapter without a query operation is a real and supported case, and
        reconciliation covers the same ground on a slower clock. Refusing here
        would make the whole payment path depend on an optional capability.
        """
        _, charge = obligation
        intent = self._intent(user, charge)
        body, headers = _signed(_success_payload(intent))

        # No `payments` key at all: the sandbox has no opinion.
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        charge.refresh_from_db()
        assert charge.status == ChargeStatus.PAID

    def test_a_failed_callback_is_not_cross_checked(self, landlord, user, obligation):
        """Only success grants value, so only success needs a second opinion.

        Cross-checking a failure would make every declined card cost an extra
        provider call for no decision it could change.
        """
        _, charge = obligation
        intent = self._intent(user, charge)
        body, headers = _signed(
            _failure_payload(intent, event_id="evt_fx", transaction_id="psp_fail_x")
        )
        # An empty payments map would refuse a *success*. A failure never asks.
        with override_settings(PAYMENT_TEST_STATE={"payments": {}}):
            payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        intent.refresh_from_db()
        assert intent.status == IntentStatus.FAILED


class TestAllocation:
    """A charge is paid because a row says which money paid it."""

    def _confirmed(self, user, charge):
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        body, headers = _signed(_success_payload(intent))
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        return PaymentTransaction.objects.get(intent=intent)

    def test_confirmed_money_is_allocated_to_the_obligation_it_settles(
        self, landlord, user, obligation
    ):
        _, charge = obligation
        transaction_row = self._confirmed(user, charge)
        allocation = PaymentAllocation.objects.get(transaction=transaction_row)
        assert allocation.obligation_id == charge.id
        assert allocation.amount_minor == transaction_row.amount_minor
        assert allocation.amount_currency == transaction_row.amount_currency

    def test_money_cannot_be_allocated_beyond_what_arrived(self, landlord, user, obligation):
        _, charge = obligation
        transaction_row = self._confirmed(user, charge)
        # The whole transaction is already applied; a second penny is not there.
        with pytest.raises(Conflict, match="exceed the money"):
            payment_services.allocate(
                transaction_row=transaction_row, obligation=charge, amount_minor=1
            )

    def test_an_obligation_cannot_be_overpaid(self, landlord, user, agent, obligation):
        lease, charge = obligation
        self._confirmed(user, charge)

        # A second transaction that tries to land on the same, already-covered
        # charge. Written directly: the point is the allocation guard, not the
        # intent rules that would stop this earlier.
        other = PaymentTransaction(
            intent=payment_services.create_intent(
                obligation=RentCharge.objects.filter(lease=lease).exclude(id=charge.id).first(),
                user=user,
                payment_method="mobile_money",
            ),
            provider="memory",
            provider_transaction_id="psp_txn_other",
            payment_method="mobile_money",
            status=TransactionStatus.SUCCEEDED,
            paid_at=timezone.now(),
        )
        other.amount_minor = charge.amount_minor
        other.amount_currency = charge.amount_currency
        other.save()

        with pytest.raises(Conflict, match="overpay"):
            payment_services.allocate(
                transaction_row=other, obligation=charge, amount_minor=charge.amount_minor
            )

    def test_an_allocation_cannot_be_rewritten_or_deleted(self, landlord, user, obligation):
        _, charge = obligation
        transaction_row = self._confirmed(user, charge)
        allocation = PaymentAllocation.objects.get(transaction=transaction_row)

        allocation.note = "changed"
        with pytest.raises(RuntimeError, match="immutable"):
            allocation.save(update_fields=["note", "updated_at"])
        with pytest.raises(RuntimeError, match="cannot be deleted"):
            allocation.delete()

    def test_allocation_cannot_cross_currencies(self, landlord, user, obligation):
        _, charge = obligation
        transaction_row = self._confirmed(user, charge)
        charge.amount_currency = "USD"
        charge.save(update_fields=["amount_currency", "updated_at"])
        with pytest.raises(ValidationFailed, match="currencies"):
            payment_services.allocate(
                transaction_row=transaction_row, obligation=charge, amount_minor=1
            )


class TestPayoutDestination:
    """Redirecting rent is a narrower power than collecting it."""

    def test_an_owner_can_set_a_tokenized_destination(self, landlord, portfolio):
        organization, _ = portfolio
        profile = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "mobile_money",
                "provider": "memory",
                "token_reference": "tok_abc123",
                "masked_account": "024*** 4567",
                "account_name": "Osu Properties",
                "institution": "MTN",
            },
        )
        assert profile.organization_id == organization.id
        # Never usable until the provider has said the account is real.
        assert profile.status == PayoutProfileStatus.UNVERIFIED
        assert profile.can_receive_settlement is False
        assert profile.updated_by_id == landlord.id

    def test_credentials_are_refused_outright(self, landlord, portfolio):
        organization, _ = portfolio
        for secret in ("pin", "otp", "cvv", "account_number"):
            with pytest.raises(ValidationFailed, match="never sent to Rooomly"):
                payouts.set_payout_destination(
                    organization=organization,
                    user=landlord,
                    data={
                        "method": "mobile_money",
                        "provider": "memory",
                        "token_reference": "tok_abc123",
                        "masked_account": "024*** 4567",
                        "account_name": "Osu Properties",
                        secret: "1234",
                    },
                )

    def test_a_tokenized_destination_is_required(self, landlord, portfolio):
        organization, _ = portfolio
        with pytest.raises(ValidationFailed, match="tokenized destination"):
            payouts.set_payout_destination(
                organization=organization,
                user=landlord,
                data={
                    "method": "mobile_money",
                    "provider": "memory",
                    "masked_account": "024*** 4567",
                    "account_name": "Osu Properties",
                },
            )

    def test_an_outsider_cannot_read_or_change_the_destination(self, landlord, agent, portfolio):
        organization, _ = portfolio
        with pytest.raises(PermissionDenied):
            payouts.payout_profile_for(organization=organization, user=agent)
        with pytest.raises(PermissionDenied):
            payouts.set_payout_destination(
                organization=organization,
                user=agent,
                data={
                    "method": "mobile_money",
                    "provider": "memory",
                    "token_reference": "tok_attacker",
                    "masked_account": "020*** 0000",
                    "account_name": "Somebody Else",
                },
            )

    def test_a_manager_who_may_collect_rent_may_not_redirect_it(self, landlord, agent, portfolio):
        """The distinction the whole module exists for."""
        from apps.organization.models import MembershipRole, OrganizationMembership

        organization, _ = portfolio
        OrganizationMembership.objects.create(
            organization=organization,
            user=agent,
            role=MembershipRole.PROPERTY_MANAGER,
            joined_at=timezone.now(),
        )
        with pytest.raises(PermissionDenied, match="owner or admin"):
            payouts.set_payout_destination(
                organization=organization,
                user=agent,
                data={
                    "method": "mobile_money",
                    "provider": "memory",
                    "token_reference": "tok_manager",
                    "masked_account": "020*** 1111",
                    "account_name": "Manager",
                },
            )

    def test_adding_a_destination_preserves_the_selected_account_and_is_audited(
        self, landlord, portfolio
    ):
        from apps.audit.models import AuditLog

        organization, _ = portfolio
        first = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "mobile_money",
                "provider": "memory",
                "token_reference": "tok_first",
                "masked_account": "024*** 4567",
                "account_name": "Osu Properties",
            },
        )
        payouts.mark_payout_verified(organization=organization)
        first.refresh_from_db()
        assert first.status == PayoutProfileStatus.VERIFIED

        second = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "bank",
                "provider": "memory",
                "token_reference": "tok_second",
                "masked_account": "**** 8901",
                "account_name": "Osu Properties",
                "institution": "GCB",
            },
        )
        # Adding another account cannot rewrite or silently redirect the
        # already selected destination.
        first.refresh_from_db()
        assert second.id != first.id
        assert first.status == PayoutProfileStatus.VERIFIED
        assert first.is_active is True
        assert second.status == PayoutProfileStatus.UNVERIFIED
        assert second.is_active is False
        assert second.verified_at is None

        events = AuditLog.objects.filter(aggregate_type="payout_profile", aggregate_id=second.id)
        assert events.exists()
        change = events.first()
        assert change is not None
        assert change.actor_id == landlord.id
        # The token is a bearer reference to a bank account and must not be logged.
        assert "tok_second" not in json.dumps(change.metadata)

    def test_verified_accounts_can_be_selected_and_removed_without_deleting_history(
        self, landlord, portfolio
    ):
        organization, _ = portfolio
        first = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "mobile_money",
                "provider": "memory",
                "token_reference": "tok_first",
                "masked_account": "024*** 4567",
                "account_name": "Osu Properties",
            },
        )
        payouts.mark_payout_verified(profile=first)
        second = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "bank",
                "provider": "memory",
                "token_reference": "tok_second",
                "masked_account": "**** 8901",
                "account_name": "Osu Properties",
                "institution": "GCB",
            },
        )
        with pytest.raises(Conflict, match="Verify"):
            payouts.activate_payout_destination(
                organization=organization,
                user=landlord,
                profile_id=second.id,
            )

        payouts.mark_payout_verified(profile=second)
        selected = payouts.activate_payout_destination(
            organization=organization,
            user=landlord,
            profile_id=second.id,
        )
        first.refresh_from_db()
        assert selected.is_active is True
        assert first.is_active is False

        removed = payouts.remove_payout_destination(
            organization=organization,
            user=landlord,
            profile_id=second.id,
        )
        assert removed.status == PayoutProfileStatus.DISABLED
        assert removed.is_active is False
        assert PayoutProfile.objects.filter(id=second.id).exists()
        with pytest.raises(Conflict, match="not set a payout destination"):
            payouts.assert_can_receive_settlement(organization=organization)

    def test_settlement_is_gated_on_a_verified_destination(self, landlord, portfolio):
        organization, _ = portfolio
        with pytest.raises(Conflict, match="not set a payout destination"):
            payouts.assert_can_receive_settlement(organization=organization)

        payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "mobile_money",
                "provider": "memory",
                "token_reference": "tok_x",
                "masked_account": "024*** 4567",
                "account_name": "Osu Properties",
            },
        )
        organization.refresh_from_db()
        with pytest.raises(Conflict, match="not been verified"):
            payouts.assert_can_receive_settlement(organization=organization)

    def test_paystack_provisioning_never_persists_the_raw_account_number(self, landlord, portfolio):
        organization, _ = portfolio
        provider = type(
            "Provider",
            (),
            {
                "name": "paystack",
                "provision_payout_destination": lambda self, **kwargs: ProviderPayoutDestination(
                    token_reference="ACCT_provider",
                    provider_account_id="1151727",
                    masked_account="****** 6047",
                    account_name="OSU PROPERTIES",
                    institution="GCB Bank",
                    verified=True,
                ),
            },
        )()
        with patch("apps.payments.payouts.get_payment_provider", return_value=provider):
            profile = payouts.provision_paystack_subaccount(
                organization=organization,
                user=landlord,
                method="bank",
                bank_code="040",
                account_number="0123456047",
            )

        assert profile.token_reference == "ACCT_provider"
        assert profile.provider_account_id == "1151727"
        assert profile.status == PayoutProfileStatus.VERIFIED
        persisted = json.dumps(
            {
                "token": profile.token_reference,
                "masked": profile.masked_account,
                "name": profile.account_name,
                "institution": profile.institution,
            }
        )
        assert "0123456047" not in persisted

    def test_idempotent_provisioning_creates_one_provider_subaccount(self, landlord, portfolio):
        organization, _ = portfolio
        calls = []

        class Provider:
            name = "paystack"

            def initiate(self, *, intent):
                assert intent is None
                return InitiationResult(provider_reference="")

            def provision_payout_destination(self, **kwargs):
                calls.append(kwargs)
                return ProviderPayoutDestination(
                    token_reference="ACCT_provider",
                    provider_account_id="1151727",
                    masked_account="****** 6047",
                    account_name="OSU PROPERTIES",
                    institution="GCB Bank",
                    verified=True,
                )

        with patch("apps.payments.payouts.get_payment_provider", return_value=Provider()):
            first, first_profile, first_replayed = (
                payouts.provision_paystack_subaccount_idempotently(
                    organization=organization,
                    user=landlord,
                    method="bank",
                    bank_code="040",
                    account_number="0123456047",
                    idempotency_key="payout-setup-0000001",
                )
            )
            second, second_profile, second_replayed = (
                payouts.provision_paystack_subaccount_idempotently(
                    organization=organization,
                    user=landlord,
                    method="bank",
                    bank_code="040",
                    account_number="0123456047",
                    idempotency_key="payout-setup-0000001",
                )
            )

        assert first.id == second.id
        assert first.status == PayoutProvisioningStatus.SUCCEEDED
        assert first_profile.id == second_profile.id
        assert first_replayed is False
        assert second_replayed is True
        assert len(calls) == 1
        assert calls[0]["provisioning_reference"] == str(first.id)
        stored = json.dumps(
            list(PayoutProvisioningOperation.objects.values()),
            default=str,
        )
        assert "0123456047" not in stored

    def test_ambiguous_provisioning_is_reconciled_and_never_created_twice(
        self, landlord, portfolio
    ):
        organization, _ = portfolio
        calls = {"create": 0, "find": 0}

        class Provider:
            name = "paystack"

            def initiate(self, *, intent):
                assert intent is None
                return InitiationResult(provider_reference="")

            def provision_payout_destination(self, **kwargs):
                calls["create"] += 1
                raise ProviderUnavailable("The response was lost.")

            def find_payout_destination(self, *, provisioning_reference):
                calls["find"] += 1
                assert provisioning_reference
                return ProviderPayoutDestination(
                    token_reference="ACCT_recovered",
                    provider_account_id="1151728",
                    masked_account="****** 7788",
                    account_name="OSU PROPERTIES",
                    institution="GCB Bank",
                    verified=True,
                )

        provider = Provider()
        with patch("apps.payments.payouts.get_payment_provider", return_value=provider):
            first, profile, replayed = payouts.provision_paystack_subaccount_idempotently(
                organization=organization,
                user=landlord,
                method="bank",
                bank_code="040",
                account_number="0123457788",
                idempotency_key="payout-setup-ambiguous",
            )
            second, _, second_replayed = payouts.provision_paystack_subaccount_idempotently(
                organization=organization,
                user=landlord,
                method="bank",
                bank_code="040",
                account_number="0123457788",
                idempotency_key="payout-setup-ambiguous",
            )
            recovered = payouts.reconcile_payout_provisioning(minimum_age_seconds=0)

        assert profile is None
        assert replayed is False
        assert second.id == first.id
        assert second_replayed is True
        assert calls == {"create": 1, "find": 1}
        assert recovered == 1
        first.refresh_from_db()
        assert first.status == PayoutProvisioningStatus.SUCCEEDED
        assert first.payout_profile.token_reference == "ACCT_recovered"

    def test_reusing_a_provisioning_key_for_another_account_is_refused(self, landlord, portfolio):
        organization, _ = portfolio

        class Provider:
            name = "paystack"

            def initiate(self, *, intent):
                return InitiationResult(provider_reference="")

            def provision_payout_destination(self, **kwargs):
                return ProviderPayoutDestination(
                    token_reference="ACCT_provider",
                    provider_account_id="1151727",
                    masked_account="****** 6047",
                    account_name="OSU PROPERTIES",
                    institution="GCB Bank",
                    verified=True,
                )

        with patch("apps.payments.payouts.get_payment_provider", return_value=Provider()):
            payouts.provision_paystack_subaccount_idempotently(
                organization=organization,
                user=landlord,
                method="bank",
                bank_code="040",
                account_number="0123456047",
                idempotency_key="payout-setup-reused-key",
            )
            with pytest.raises(Conflict, match="different payout details"):
                payouts.provision_paystack_subaccount_idempotently(
                    organization=organization,
                    user=landlord,
                    method="bank",
                    bank_code="040",
                    account_number="9999999999",
                    idempotency_key="payout-setup-reused-key",
                )

    def test_payout_destination_api_is_private_idempotent_and_redacted(self, landlord, portfolio):
        organization, _ = portfolio

        class Provider:
            name = "paystack"

            def initiate(self, *, intent):
                return InitiationResult(provider_reference="")

            def provision_payout_destination(self, **kwargs):
                return ProviderPayoutDestination(
                    token_reference="ACCT_private",
                    provider_account_id="1151729",
                    masked_account="****** 6047",
                    account_name="OSU PROPERTIES",
                    institution="GCB Bank",
                    verified=True,
                )

        api = APIClient()
        api.force_authenticate(user=landlord)
        url = f"/api/v1/organizations/{organization.id}/payout-destination/"
        body = {
            "method": "bank",
            "bank_code": "040",
            "account_number": "0123456047",
        }
        with patch("apps.payments.payouts.get_payment_provider", return_value=Provider()):
            first = api.post(
                url,
                body,
                format="json",
                HTTP_IDEMPOTENCY_KEY="payout-api-00000001",
            )
            second = api.post(
                url,
                body,
                format="json",
                HTTP_IDEMPOTENCY_KEY="payout-api-00000001",
            )

        assert first.status_code == 201
        assert second.status_code == 200
        assert second["X-Idempotent-Replay"] == "true"
        assert first.data["provisioning"]["id"] == second.data["provisioning"]["id"]
        rendered = json.dumps(first.data)
        assert "0123456047" not in rendered
        assert "ACCT_private" not in rendered
        assert first.data["profile"]["masked_account"] == "****** 6047"
        assert first["Cache-Control"] == "private, no-store"

        private_get = api.get(url)
        assert private_get.status_code == 200
        assert "0123456047" not in json.dumps(private_get.data)

    def test_payout_destination_api_requires_key_and_owner_or_admin(
        self, landlord, agent, portfolio
    ):
        from apps.organization.models import MembershipRole, OrganizationMembership

        organization, _ = portfolio
        url = f"/api/v1/organizations/{organization.id}/payout-destination/"
        body = {"method": "bank", "bank_code": "040", "account_number": "0123456047"}

        owner_api = APIClient()
        owner_api.force_authenticate(user=landlord)
        missing_key = owner_api.post(url, body, format="json")
        assert missing_key.status_code == 422

        OrganizationMembership.objects.create(
            organization=organization,
            user=agent,
            role=MembershipRole.PROPERTY_MANAGER,
            joined_at=timezone.now(),
        )
        manager_api = APIClient()
        manager_api.force_authenticate(user=agent)
        refused = manager_api.post(
            url,
            body,
            format="json",
            HTTP_IDEMPOTENCY_KEY="payout-manager-00001",
        )
        assert refused.status_code == 403

    def test_payout_destination_api_lists_selects_and_soft_removes_accounts(
        self, landlord, portfolio
    ):
        organization, _ = portfolio
        first = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "mobile_money",
                "provider": "paystack",
                "token_reference": "ACCT_first",
                "masked_account": "****** 1111",
                "account_name": "OSU PROPERTIES",
                "institution": "MTN",
            },
        )
        second = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "bank",
                "provider": "paystack",
                "token_reference": "ACCT_second",
                "masked_account": "****** 2222",
                "account_name": "OSU PROPERTIES",
                "institution": "GCB Bank",
            },
        )
        payouts.mark_payout_verified(profile=first)
        payouts.mark_payout_verified(profile=second)
        api = APIClient()
        api.force_authenticate(user=landlord)
        collection_url = f"/api/v1/organizations/{organization.id}/payout-destination/"

        listed = api.get(collection_url)
        assert listed.status_code == 200
        assert listed.data["profile"]["id"] == str(first.id)
        assert listed.data["active_profile"]["id"] == str(first.id)
        assert len(listed.data["profiles"]) == 2

        activate_url = (
            f"/api/v1/organizations/{organization.id}/" f"payout-destinations/{second.id}/activate/"
        )
        activated = api.post(activate_url, {}, format="json")
        assert activated.status_code == 200
        assert activated.data["active_profile"]["id"] == str(second.id)

        detail_url = f"/api/v1/organizations/{organization.id}/payout-destinations/{second.id}/"
        removed = api.delete(detail_url)
        assert removed.status_code == 200
        assert removed.data["active_profile"] is None
        assert len(removed.data["profiles"]) == 1
        second.refresh_from_db()
        assert second.status == PayoutProfileStatus.DISABLED

    def test_payout_verification_refresh_uses_paystacks_decision(self, landlord, portfolio):
        organization, _ = portfolio
        profile = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "mobile_money",
                "provider": "paystack",
                "token_reference": "ACCT_verifiedlater",
                "provider_account_id": "1151727",
                "masked_account": "****** 0000",
                "account_name": "OSU PROPERTIES",
                "institution": "MTN",
            },
        )
        assert profile.status == PayoutProfileStatus.UNVERIFIED
        calls = []

        class Provider:
            name = "paystack"

            def ensure_available(self):
                return None

            def get_payout_destination(self, *, provider_reference):
                calls.append(provider_reference)
                return ProviderPayoutDestination(
                    token_reference="ACCT_verifiedlater",
                    provider_account_id="1151727",
                    masked_account="****** 0000",
                    account_name="OSU PROPERTIES",
                    institution="MTN",
                    verified=True,
                )

        api = APIClient()
        api.force_authenticate(user=landlord)
        url = f"/api/v1/organizations/{organization.id}/payout-destination/refresh/"
        with patch("apps.payments.payouts.get_payment_provider", return_value=Provider()):
            response = api.post(url, {}, format="json")

        assert response.status_code == 200
        assert response.data["profile"]["status"] == PayoutProfileStatus.VERIFIED
        assert response.data["profile"]["verified_at"] is not None
        assert calls == ["ACCT_verifiedlater"]
        profile.refresh_from_db()
        assert profile.status == PayoutProfileStatus.VERIFIED

    def test_payout_verification_refresh_does_not_trust_a_different_subaccount(
        self, landlord, portfolio
    ):
        organization, _ = portfolio
        profile = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "mobile_money",
                "provider": "paystack",
                "token_reference": "ACCT_expected",
                "provider_account_id": "1151727",
                "masked_account": "****** 0000",
                "account_name": "OSU PROPERTIES",
                "institution": "MTN",
            },
        )

        class Provider:
            name = "paystack"

            def ensure_available(self):
                return None

            def get_payout_destination(self, **kwargs):
                return ProviderPayoutDestination(
                    token_reference="ACCT_different",
                    provider_account_id="9999999",
                    masked_account="****** 9999",
                    account_name="ANOTHER ACCOUNT",
                    institution="MTN",
                    verified=True,
                )

        with (
            patch("apps.payments.payouts.get_payment_provider", return_value=Provider()),
            pytest.raises(ProviderUnavailable, match="different settlement account"),
        ):
            payouts.refresh_payout_verification(
                organization=organization,
                user=landlord,
            )
        profile.refresh_from_db()
        assert profile.status == PayoutProfileStatus.UNVERIFIED

    def test_payout_setup_api_lists_ghana_institutions_and_resolves_safely(
        self, landlord, portfolio
    ):
        organization, _ = portfolio
        calls = {"list": 0, "resolve": 0}

        class Provider:
            name = "paystack"

            def initiate(self, *, intent):
                return InitiationResult(provider_reference="")

            def list_payout_institutions(self, *, method):
                calls["list"] += 1
                return (ProviderPayoutInstitution(code="040", name="GCB Bank", method=method),)

            def resolve_payout_account(self, **kwargs):
                calls["resolve"] += 1
                return ProviderResolvedPayoutAccount(
                    account_name="OSU PROPERTIES",
                    masked_account="****** 6047",
                )

        cache.clear()
        api = APIClient()
        api.force_authenticate(user=landlord)
        institutions_url = f"/api/v1/organizations/{organization.id}/payout-institutions/"
        resolve_url = f"/api/v1/organizations/{organization.id}/payout-destination/resolve/"
        with patch("apps.payments.payouts.get_payment_provider", return_value=Provider()):
            institutions = api.get(institutions_url, {"method": "bank"})
            cached_institutions = api.get(institutions_url, {"method": "bank"})
            resolved = api.post(
                resolve_url,
                {
                    "method": "bank",
                    "bank_code": "040",
                    "account_number": "0123456047",
                },
                format="json",
            )
            cached_resolution = api.post(
                resolve_url,
                {
                    "method": "bank",
                    "bank_code": "040",
                    "account_number": "0123456047",
                },
                format="json",
            )

        assert institutions.status_code == 200
        assert cached_institutions.data == institutions.data
        assert institutions.data["results"] == [
            {"code": "040", "name": "GCB Bank", "method": "bank"}
        ]
        assert resolved.status_code == 200
        assert cached_resolution.data == resolved.data
        assert resolved.data == {
            "account_name": "OSU PROPERTIES",
            "masked_account": "****** 6047",
        }
        assert "0123456047" not in json.dumps(resolved.data)
        assert resolved["Cache-Control"] == "private, no-store"
        assert calls == {"list": 1, "resolve": 1}


class TestPaystackSplitRouting:
    @override_settings(
        PAYMENT_BACKEND="paystack",
        PAYSTACK_SECRET_KEY="sk_test_" + "0" * 32,
        PAYSTACK_PLATFORM_CHARGE_BPS="300",
        # Product policy wins over a stale deployment value.
        PAYSTACK_FEE_BEARER="account",
    )
    def test_intent_freezes_the_portfolio_subaccount_and_commercial_split(
        self, landlord, user, obligation, portfolio
    ):
        from apps.payments.providers import reset_payment_provider
        from apps.trust.models import Verification, VerificationKind

        organization, _ = portfolio
        profile = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "bank",
                "provider": "paystack",
                "token_reference": "ACCT_provider",
                "provider_account_id": "1151727",
                "masked_account": "****** 6047",
                "account_name": "Osu Properties",
            },
        )
        payouts.mark_payout_verified(organization=organization)
        # Paystack's verified Portfolio subaccount is the receiving-account
        # authority. Tenant checkout must not additionally require the legacy
        # person-level bank-account stamp used by older property capabilities.
        Verification.objects.filter(
            subject_id=str(landlord.id),
            kind=VerificationKind.BANK_ACCOUNT,
        ).delete()
        _, charge = obligation
        reset_payment_provider()
        try:
            with patch(
                "apps.payments.paystack.PaystackPaymentProvider._call",
                return_value={
                    "status": True,
                    "data": {
                        "reference": "rmp_paystack",
                        "authorization_url": "https://checkout.paystack.com/test",
                    },
                },
            ):
                intent = payment_services.create_intent(
                    obligation=charge, user=user, payment_method="mobile_money"
                )
        finally:
            reset_payment_provider()

        assert intent.beneficiary_organization_id == organization.id
        assert intent.payout_profile_id == profile.id
        assert intent.provider_subaccount_reference == "ACCT_provider"
        assert intent.provider_subaccount_id == "1151727"
        assert intent.platform_charge_minor == 4500
        assert intent.provider_fee_bearer == ProviderFeeBearer.SUBACCOUNT

    @override_settings(
        PAYMENT_BACKEND="paystack",
        PAYSTACK_SECRET_KEY="sk_test_" + "0" * 32,
        PAYSTACK_PLATFORM_CHARGE_BPS="300",
    )
    def test_missing_portfolio_destination_gives_tenant_safe_error(
        self, landlord, user, obligation
    ):
        from apps.payments.models import PaymentIntent
        from apps.payments.providers import reset_payment_provider

        _, charge = obligation
        reset_payment_provider()
        try:
            with pytest.raises(
                Conflict,
                match="property provider needs to finish payment setup",
            ):
                payment_services.create_intent(
                    obligation=charge,
                    user=user,
                    payment_method="mobile_money",
                )
        finally:
            reset_payment_provider()

        assert not PaymentIntent.objects.filter(obligation=charge).exists()


class TestReconciliation:
    """Disagreements are recorded, never quietly repaired."""

    def test_a_lost_callback_is_recovered_through_the_confirmation_boundary(
        self, landlord, user, obligation
    ):
        """Money the provider took reaches the rent account without being asked.

        The sweep does not *choose between* two records here — Rooomly has none,
        and the provider is the only authority on whether a payment happened. So
        it applies the provider's answer through exactly the boundary a signed
        webhook uses. Before this, a lost callback left rent uncredited until the
        tenant personally returned and tapped refresh, and no operator could put
        it right either: the exception queue deliberately cannot move money.
        """
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        assert intent.status in ("pending", "processing")

        # The provider took the money; the callback never arrived.
        state = {
            "payments": {
                intent.provider_reference: {
                    "provider_transaction_id": "psp_lost_1",
                    "status": "succeeded",
                    "amount_minor": intent.amount_minor,
                    "currency": intent.amount_currency,
                    "payment_method": intent.payment_method,
                    "occurred_at": timezone.now().isoformat(),
                }
            }
        }
        with override_settings(PAYMENT_TEST_STATE=state):
            result = reconciliation.sweep_open_intents(min_age_seconds=0)

        assert result == {"exceptions": 0, "recovered": 1}
        assert not reconciliation.ReconciliationException.objects.exists()

        intent.refresh_from_db()
        charge.refresh_from_db()
        assert intent.status == IntentStatus.SUCCEEDED
        assert charge.status == ChargeStatus.PAID
        transaction_row = PaymentTransaction.objects.get()
        assert transaction_row.provider_transaction_id == "psp_lost_1"
        assert transaction_row.status == TransactionStatus.SUCCEEDED
        # The whole financial record, not a status flip.
        assert PaymentAllocation.objects.filter(transaction=transaction_row).count() == 1
        assert transaction_row.ledger_entries.count() == 2
        assert Settlement.objects.filter(transaction=transaction_row).exists()

    def test_a_payment_still_in_flight_is_left_alone(self, landlord, user, obligation):
        """A callback that is merely seconds late is not an incident."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        state = {
            "payments": {
                intent.provider_reference: {
                    "provider_transaction_id": "psp_inflight",
                    "status": "succeeded",
                    "amount_minor": intent.amount_minor,
                    "currency": intent.amount_currency,
                    "payment_method": intent.payment_method,
                    "occurred_at": timezone.now().isoformat(),
                }
            }
        }
        with override_settings(PAYMENT_TEST_STATE=state):
            assert reconciliation.sweep_open_intents() == {"exceptions": 0, "recovered": 0}
        assert PaymentTransaction.objects.count() == 0

    def test_a_real_disagreement_is_recorded_and_never_repaired(self, landlord, user, obligation):
        """The rule the sweep keeps: two records that contradict each other."""
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        state = {
            "payments": {
                intent.provider_reference: {
                    "provider_transaction_id": "psp_wrong_amount",
                    "status": "succeeded",
                    "amount_minor": intent.amount_minor - 5000,
                    "currency": intent.amount_currency,
                    "payment_method": intent.payment_method,
                    "occurred_at": timezone.now().isoformat(),
                }
            }
        }
        with override_settings(PAYMENT_TEST_STATE=state):
            result = reconciliation.sweep_open_intents(min_age_seconds=0)

        assert result == {"exceptions": 1, "recovered": 0}
        exception = reconciliation.ReconciliationException.objects.get()
        assert exception.kind == ReconciliationKind.AMOUNT_MISMATCH
        assert exception.status == ReconciliationStatus.OPEN
        assert exception.intent_id == intent.id

        intent.refresh_from_db()
        charge.refresh_from_db()
        assert intent.status != IntentStatus.SUCCEEDED
        assert charge.status != ChargeStatus.PAID
        assert PaymentTransaction.objects.count() == 0

    def test_the_same_disagreement_is_not_raised_twice(self, landlord, user, obligation):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        state = {
            "payments": {
                intent.provider_reference: {
                    "provider_transaction_id": "psp_lost_1",
                    "status": "succeeded",
                    "amount_minor": intent.amount_minor + 1,
                    "currency": intent.amount_currency,
                    "payment_method": intent.payment_method,
                    "occurred_at": timezone.now().isoformat(),
                }
            }
        }
        with override_settings(PAYMENT_TEST_STATE=state):
            reconciliation.sweep_open_intents(min_age_seconds=0)
            reconciliation.sweep_open_intents(min_age_seconds=0)
            reconciliation.sweep_open_intents(min_age_seconds=0)

        assert reconciliation.ReconciliationException.objects.count() == 1

    def test_a_settlement_paying_the_wrong_amount_is_raised(self, landlord, user, obligation):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        body, headers = _signed(_success_payload(intent))
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        settlement = Settlement.objects.get()
        assert settlement.status == SettlementStatus.PENDING

        state = {
            "settlements": {
                "psp_txn_1": {
                    "reference": "stl_1",
                    "status": "settled",
                    "gross_minor": settlement.gross_amount_minor,
                    "fee_minor": 500,
                    "net_minor": settlement.net_amount_minor - 500,
                    "currency": "GHS",
                    "settled_at": timezone.now().isoformat(),
                }
            }
        }
        with override_settings(PAYMENT_TEST_STATE=state):
            opened = reconciliation.sweep_settlements()

        assert opened == 1
        exception = reconciliation.ReconciliationException.objects.get()
        assert exception.kind == ReconciliationKind.SETTLEMENT_AMOUNT_MISMATCH
        # Still pending. A disagreement is not a settlement.
        settlement.refresh_from_db()
        assert settlement.status == SettlementStatus.PENDING

    def test_paystack_batch_import_confirms_only_the_exact_transaction(
        self, landlord, user, obligation, portfolio
    ):
        organization, _ = portfolio
        profile = payouts.set_payout_destination(
            organization=organization,
            user=landlord,
            data={
                "method": "bank",
                "provider": "paystack",
                "token_reference": "ACCT_provider",
                "provider_account_id": "1151727",
                "masked_account": "****** 6047",
                "account_name": "Osu Properties",
            },
        )
        payouts.mark_payout_verified(organization=organization)
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        body, headers = _signed(_success_payload(intent))
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        transaction_row = intent.transactions.get(status=TransactionStatus.SUCCEEDED)
        settlement = Settlement.objects.get(transaction=transaction_row)

        # Convert this fixture's deterministic memory-provider route into the
        # routing snapshot an earlier Paystack checkout would have produced.
        # The immutable transaction itself deliberately remains untouched.
        type(intent).objects.filter(id=intent.id).update(
            beneficiary_organization=organization,
            payout_profile=profile,
            provider_subaccount_reference="ACCT_provider",
            provider_subaccount_id="1151727",
            platform_charge_minor=4500,
            provider_fee_bearer=ProviderFeeBearer.SUBACCOUNT,
        )
        type(settlement).objects.filter(id=settlement.id).update(
            beneficiary_organization=organization,
            payout_profile=profile,
            provider_subaccount_reference="ACCT_provider",
            provider_subaccount_id="1151727",
        )

        from apps.organization import services as organization_services

        pending_summary = organization_services.portfolio_summary(
            organization=organization, user=landlord
        )
        assert pending_summary["money"]["online_paid_minor"] == 150000
        assert pending_summary["money"]["awaiting_settlement_minor"] == 150000
        assert pending_summary["money"]["settled_net_minor"] == 0
        assert pending_summary["recent_settlements"][0]["fee_minor"] is None
        assert pending_summary["recent_settlements"][0]["net_minor"] is None

        batch = ProviderSettlementBatch(
            provider_settlement_reference="3090024",
            status="settled",
            currency="GHS",
            settled_at=timezone.now(),
            transactions=(
                ProviderSettlementTransaction(
                    provider_transaction_id=transaction_row.provider_transaction_id,
                    provider_reference=intent.provider_reference,
                    amount_minor=transaction_row.amount_minor,
                    provider_fee_minor=2900,
                    currency="GHS",
                ),
                ProviderSettlementTransaction(
                    provider_transaction_id="somebody_elses_transaction",
                    provider_reference="other",
                    amount_minor=50000,
                    provider_fee_minor=1000,
                    currency="GHS",
                ),
            ),
        )
        provider = type(
            "Provider",
            (),
            {
                "settlement_mode": "batch",
                "list_settlement_batches": lambda self, **kwargs: (batch,),
            },
        )()
        with patch("apps.payments.settlements.get_payment_provider", return_value=provider):
            assert settlements.import_provider_settlements() == 1
            # Re-importing the same batch is a no-op, not a second movement.
            assert settlements.import_provider_settlements() == 0

        settlement.refresh_from_db()
        assert settlement.status == SettlementStatus.SETTLED
        assert settlement.provider_settlement_reference == "3090024"
        assert settlement.gross_amount_minor == 150000
        assert settlement.fee_amount_minor == 7400
        assert settlement.net_amount_minor == 142600
        settled_summary = organization_services.portfolio_summary(
            organization=organization, user=landlord
        )
        assert settled_summary["money"]["awaiting_settlement_minor"] == 0
        assert settled_summary["money"]["settled_fee_minor"] == 7400
        assert settled_summary["money"]["settled_net_minor"] == 142600
        assert settled_summary["recent_settlements"][0]["status"] == "settled"
        assert settled_summary["recent_settlements"][0]["net_minor"] == 142600

    def test_resolving_an_exception_names_a_management_operator(self):
        from apps.operations.models import ManagementRole, ManagementUser

        operator = ManagementUser.objects.create(
            email="payments-operator@example.com",
            first_name="Payment",
            last_name="Operator",
            role=ManagementRole.OPERATIONS_ADMIN,
        )
        exception = reconciliation.open_exception(
            kind=ReconciliationKind.AMOUNT_MISMATCH,
            provider="memory",
            provider_reference="ref_1",
            detail={"note": "test"},
        )
        resolved = reconciliation.resolve_exception(
            exception_id=exception.id,
            management_actor=operator,
            status=ReconciliationStatus.RESOLVED,
            note="Provider confirmed the lower amount was a display error.",
        )
        assert resolved.status == ReconciliationStatus.RESOLVED
        assert resolved.resolved_by_management_id == operator.id
        assert resolved.resolved_at is not None

        # Once closed it stops blocking a fresh detection of the same subject.
        again = reconciliation.open_exception(
            kind=ReconciliationKind.AMOUNT_MISMATCH, provider="memory", provider_reference="ref_1"
        )
        assert again.id != exception.id

    def test_payment_operations_are_visible_and_reconciled_only_by_operations_admins(
        self,
    ):
        from apps.audit.models import AuditLog
        from apps.operations.models import ManagementRole, ManagementUser

        exception = reconciliation.open_exception(
            kind=ReconciliationKind.AMOUNT_MISMATCH,
            provider="memory",
            provider_reference="ops-ref-1",
            detail={"rooomly_amount_minor": 150000, "provider_amount_minor": 149900},
        )

        def signed_in(role, email):
            operator = ManagementUser.objects.create(
                email=email,
                first_name="Payment",
                last_name="Reviewer",
                role=role,
            )
            operator.set_password("a-long-operations-password")
            operator.save(update_fields=["password", "updated_at"])
            client = APIClient()
            login = client.post(
                "/api/v1/management/auth/login/",
                {"email": email, "password": "a-long-operations-password"},
                format="json",
            )
            assert login.status_code == 200
            client.credentials(HTTP_X_MANAGEMENT_CSRF=login.data["csrf_token"])
            return operator, client

        _, support_client = signed_in(ManagementRole.SUPPORT_ADMIN, "payments-support@example.com")
        assert support_client.get("/api/v1/management/payments/").status_code == 403

        operator, client = signed_in(ManagementRole.OPERATIONS_ADMIN, "payments-ops@example.com")
        queue = client.get("/api/v1/management/payments/")
        assert queue.status_code == 200, queue.data
        assert queue.data["counts"]["open_exceptions"] == 1
        assert queue.data["exceptions"][0]["id"] == str(exception.id)
        assert AuditLog.objects.filter(
            action="view",
            aggregate_type="payment_operations",
            aggregate_id=str(operator.id),
            management_actor_id=operator.id,
        ).exists()

        url = f"/api/v1/management/payments/reconciliation/{exception.id}/"
        missing_key = client.post(
            url,
            {"status": "investigating", "note": "Checking the provider dashboard."},
            format="json",
        )
        assert missing_key.status_code == 422
        decided = client.post(
            url,
            {"status": "investigating", "note": "Checking the provider dashboard."},
            format="json",
            HTTP_IDEMPOTENCY_KEY="reconcile-payment-0001",
        )
        replay = client.post(
            url,
            {"status": "investigating", "note": "Checking the provider dashboard."},
            format="json",
            HTTP_IDEMPOTENCY_KEY="reconcile-payment-0001",
        )
        assert decided.status_code == 200, decided.data
        assert replay.headers["X-Idempotent-Replay"] == "true"
        exception.refresh_from_db()
        assert exception.status == ReconciliationStatus.INVESTIGATING
        assert exception.resolved_by_management_id is None
        assert AuditLog.objects.filter(
            aggregate_type="reconciliation_exception",
            aggregate_id=str(exception.id),
            management_actor_id=operator.id,
        ).exists()

    def test_confirmed_money_with_no_allocation_is_raised(self, landlord, user, obligation):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        body, headers = _signed(_success_payload(intent))
        payment_services.process_webhook(provider_name="memory", raw_body=body, headers=headers)
        # The healthy path allocates, so nothing is raised.
        assert reconciliation.sweep_unallocated_transactions() == 0

        # The condition the sweep exists for: money recorded, purpose
        # unrecorded. Written as a confirmed transaction on a second intent that
        # never reached `allocate` — the first intent's allocation can no longer
        # be removed to simulate it, because the append-only trigger added in
        # `payments/0013` refuses that, which is exactly what it is for.
        second = payment_services.create_intent(
            obligation=rent_services.build_schedule(charge.lease)[1],
            user=user,
            payment_method="mobile_money",
        )
        orphan = PaymentTransaction(
            intent=second,
            provider=second.provider,
            provider_transaction_id="psp_unallocated",
            payment_method=second.payment_method,
            status=TransactionStatus.SUCCEEDED,
            paid_at=timezone.now(),
        )
        orphan.amount_minor = second.amount_minor
        orphan.amount_currency = second.amount_currency
        orphan.save()

        assert reconciliation.sweep_unallocated_transactions() == 1
        exception = reconciliation.ReconciliationException.objects.get()
        assert exception.kind == ReconciliationKind.UNALLOCATED_TRANSACTION
        assert exception.transaction_id == orphan.id
