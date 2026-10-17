"""No database transaction may be held while a payment provider is answering.

This was the last structural risk on the payment checkpoint, and it was ADR
0027's own stated constraint being broken by the endpoints that mattered most.
`create_intent` took `SELECT ... FOR UPDATE` on the tenant's `RentCharge`, and
`idempotent_mutation` wrapped the whole view in one transaction holding a
`pg_advisory_xact_lock` — and then Paystack was called inside both, with a
twenty-second client timeout. Every checkout, retry and status refresh pinned a
database connection and a rent row for as long as the provider felt like taking.

The fix is three phases: reserve and commit, call holding nothing, record and
commit. What makes that safe is that the reservation is durable *before* the
network call, so an ambiguous response leaves a real intent to resume rather
than nothing to find — and `client_reference` is the provider's own idempotency
key, so resuming reaches the same provider transaction rather than a second one.

These tests hold that. They run with a real transaction per test rather than
pytest-django's wrapping one, because the invariant is literally about whether a
transaction is open, and a test that wrapped everything could not tell.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest
from django.db import connection, transaction
from django.utils import timezone

from apps.core.exceptions import Conflict, ProviderUnavailable
from apps.lease import services as lease_services
from apps.payments import services as payment_services
from apps.payments.models import IntentStatus, PaymentAttempt, PaymentIntent
from apps.payments.providers import InitiationResult, MemoryPaymentProvider
from apps.rent import services as rent_services

pytestmark = pytest.mark.django_db(transaction=True)


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


class Recorder:
    """A provider that reports the transaction state it was called in."""

    def __init__(self, *, fail: bool = False):
        self.calls: list[dict] = []
        self.fail = fail

    def __call__(self, *, intent):
        self.calls.append(
            {
                "reference": intent.client_reference,
                "in_atomic_block": connection.in_atomic_block,
                "amount_minor": intent.amount_minor,
            }
        )
        if self.fail:
            raise ProviderUnavailable(
                "The payment provider did not respond in time. "
                "If money was taken it will be confirmed shortly."
            )
        return InitiationResult(
            provider_reference=intent.client_reference,
            status="pending",
            next_action={"type": "test_only", "reference": intent.client_reference},
        )


class TestNothingIsHeldWhileTheProviderAnswers:
    def test_initiation_runs_with_no_open_transaction(self, landlord, user, obligation):
        """The invariant, stated directly.

        Asserted from inside the adapter rather than inferred from timings,
        because the thing that matters is not how long the call took but whether
        a connection and a rent row were held while it did.
        """
        _, charge = obligation
        recorder = Recorder()
        with patch.object(MemoryPaymentProvider, "initiate", recorder):
            payment_services.create_intent(
                obligation=charge, user=user, payment_method="mobile_money"
            )

        assert len(recorder.calls) == 1
        assert recorder.calls[0]["in_atomic_block"] is False, (
            "the provider was called inside a transaction; a slow provider now "
            "holds a database connection and the tenant's rent row"
        )

    def test_retry_also_holds_nothing(self, landlord, user, obligation):
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        PaymentIntent.objects.filter(id=intent.id).update(status=IntentStatus.FAILED)
        intent.refresh_from_db()

        recorder = Recorder()
        with patch.object(MemoryPaymentProvider, "initiate", recorder):
            payment_services.retry_intent(intent=intent, user=user)

        assert recorder.calls[0]["in_atomic_block"] is False

    def test_the_obligation_row_is_free_while_the_provider_answers(
        self, landlord, user, obligation
    ):
        """A landlord recording a cash payment must not wait on Paystack.

        The old shape held `FOR UPDATE` on the charge for the whole provider
        call, so an unrelated write to the same row blocked behind a third
        party. This proves the row is writable at the moment the provider is
        being asked.
        """
        from apps.rent.models import RentCharge

        _, charge = obligation
        observed: dict = {}

        # A plain function patched onto a class is a descriptor and would be
        # handed `self`; `Recorder` above is an instance and is not. Absorb it.
        def probe(_provider=None, *, intent):
            # A second connection would deadlock against a held FOR UPDATE. This
            # one is the test's own, so `select_for_update` here simply proves
            # nothing in *this* connection is holding the row either.
            with transaction.atomic():
                locked = RentCharge.objects.select_for_update(nowait=True).get(id=charge.id)
                observed["reachable"] = locked.id == charge.id
            return InitiationResult(provider_reference=intent.client_reference, status="pending")

        with patch.object(MemoryPaymentProvider, "initiate", probe):
            payment_services.create_intent(
                obligation=charge, user=user, payment_method="mobile_money"
            )
        assert observed.get("reachable") is True


class TestAnAmbiguousProviderResponseIsRecoverable:
    def test_a_lost_response_leaves_a_reservation_to_resume(self, landlord, user, obligation):
        """A timeout is the case the old shape handled worst.

        It rolled the whole thing back, so the provider might hold a transaction
        Danpa HQ had no record of at all. Now the reservation survives, and it is
        the thing that makes the retry reach the same provider transaction.
        """
        _, charge = obligation
        failing = Recorder(fail=True)
        with (
            patch.object(MemoryPaymentProvider, "initiate", failing),
            pytest.raises(ProviderUnavailable),
        ):
            payment_services.create_intent(
                obligation=charge, user=user, payment_method="mobile_money"
            )

        reservation = PaymentIntent.objects.get(obligation=charge)
        assert reservation.status == IntentStatus.CREATED
        assert reservation.provider_reference == ""
        assert reservation.client_reference

        # Asking again resumes it rather than opening a second one.
        succeeding = Recorder()
        with patch.object(MemoryPaymentProvider, "initiate", succeeding):
            resumed = payment_services.create_intent(
                obligation=charge, user=user, payment_method="mobile_money"
            )

        assert PaymentIntent.objects.filter(obligation=charge).count() == 1
        assert resumed.id == reservation.id
        assert resumed.status == IntentStatus.PENDING
        # The same outbound reference, which is what stops the provider opening
        # a second transaction for one payment.
        assert succeeding.calls[0]["reference"] == failing.calls[0]["reference"]

    def test_resuming_does_not_stack_a_second_attempt(self, landlord, user, obligation):
        _, charge = obligation
        with (
            patch.object(MemoryPaymentProvider, "initiate", Recorder(fail=True)),
            pytest.raises(ProviderUnavailable),
        ):
            payment_services.create_intent(
                obligation=charge, user=user, payment_method="mobile_money"
            )
        with patch.object(MemoryPaymentProvider, "initiate", Recorder()):
            intent = payment_services.create_intent(
                obligation=charge, user=user, payment_method="mobile_money"
            )
        assert PaymentAttempt.objects.filter(intent=intent).count() == 1

    def test_a_live_checkout_is_returned_rather_than_duplicated(self, landlord, user, obligation):
        """A replay that got further than it realised gets what exists."""
        _, charge = obligation
        first = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        recorder = Recorder()
        with patch.object(MemoryPaymentProvider, "initiate", recorder):
            again = payment_services.create_intent(
                obligation=charge, user=user, payment_method="mobile_money"
            )
        assert again.id == first.id
        assert recorder.calls == [], "a live checkout must not be re-initiated"
        assert PaymentIntent.objects.filter(obligation=charge).count() == 1

    def test_a_different_amount_supersedes_a_reservation_that_never_left(
        self, landlord, user, obligation
    ):
        """Nothing is at risk on a reservation the provider never saw.

        Refusing it would leave the one-open-intent gate held by an intent
        nothing will ever initiate, against the payment the tenant is actually
        trying to make.
        """
        _, charge = obligation
        with (
            patch.object(MemoryPaymentProvider, "initiate", Recorder(fail=True)),
            pytest.raises(ProviderUnavailable),
        ):
            payment_services.create_intent(
                obligation=charge, user=user, payment_method="mobile_money"
            )

        part = charge.outstanding_minor // 2
        with patch.object(MemoryPaymentProvider, "initiate", Recorder()):
            replacement = payment_services.create_intent(
                obligation=charge,
                user=user,
                payment_method="mobile_money",
                amount_minor=part,
            )

        assert replacement.amount_minor == part
        superseded = PaymentIntent.objects.exclude(id=replacement.id).get(obligation=charge)
        assert superseded.status == IntentStatus.CANCELLED
        assert superseded.failure_code == "superseded_before_initiation"

    def test_a_different_amount_against_a_live_checkout_is_refused(
        self, landlord, user, obligation
    ):
        """Two open checkouts for one charge is the thing the gate prevents."""
        _, charge = obligation
        payment_services.create_intent(obligation=charge, user=user, payment_method="mobile_money")
        with pytest.raises(Conflict, match="already open"):
            payment_services.create_intent(
                obligation=charge,
                user=user,
                payment_method="mobile_money",
                amount_minor=charge.outstanding_minor // 2,
            )

    def test_a_callback_that_overtakes_initiation_is_not_written_over(
        self, landlord, user, obligation
    ):
        """The provider can confirm before its own initiation response lands.

        Phase three must never demote a succeeded intent back to pending, which
        is exactly what an unguarded `save()` after a slow call would do.
        """
        _, charge = obligation
        intent = payment_services.create_intent(
            obligation=charge, user=user, payment_method="mobile_money"
        )
        PaymentIntent.objects.filter(id=intent.id).update(status=IntentStatus.SUCCEEDED)

        settled = payment_services._record_initiation(
            intent_id=intent.id,
            status=IntentStatus.PENDING,
            provider_reference="overtaken",
            next_action={},
            user=user,
            resumed=True,
        )
        assert settled.status == IntentStatus.SUCCEEDED
        assert settled.provider_reference != "overtaken"


class TestTheClaimSurvivesTheRequestThatMadeIt:
    """The trade the external-call mode makes, held to."""

    def _key_row(self, key):
        from apps.idempotency.models import IdempotencyKey

        return IdempotencyKey.objects.filter(key=key).first()

    def test_a_concurrent_duplicate_is_told_the_first_is_still_running(
        self, landlord, user, obligation, sign_in_as
    ):
        from rest_framework.test import APIClient

        from apps.idempotency.models import IdempotencyKey, IdempotencyStatus

        _, charge = obligation
        api = APIClient()
        sign_in_as(api, user=user, device_fingerprint="boundary-tenant")
        key = "boundary-concurrent-000001"

        # Stand in for a request that has claimed the key and is still talking
        # to the provider: committed, in flight, lease unexpired.
        first = api.post(
            "/api/v1/payments/intents/",
            {"obligation_id": str(charge.id), "payment_method": "mobile_money"},
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        assert first.status_code == 201, first.data
        IdempotencyKey.objects.filter(key=key).update(
            status=IdempotencyStatus.IN_FLIGHT,
            in_flight_until=timezone.now() + timezone.timedelta(seconds=60),
            response_status=None,
            response_body=None,
        )

        second = api.post(
            "/api/v1/payments/intents/",
            {"obligation_id": str(charge.id), "payment_method": "mobile_money"},
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        assert second.status_code == 409, second.data
        assert second.data["error"]["code"] == "idempotency_in_progress"
        assert PaymentIntent.objects.filter(obligation=charge).count() == 1

    def test_an_abandoned_claim_is_taken_over_without_duplicating(
        self, landlord, user, obligation, sign_in_as
    ):
        """A request that died mid-flight must not make its key unusable.

        Taking the lease over re-runs the request, which is only safe because
        the service resumes — so this asserts both halves: the retry succeeds,
        and there is still exactly one intent behind it.
        """
        from rest_framework.test import APIClient

        from apps.idempotency.models import IdempotencyKey, IdempotencyStatus

        _, charge = obligation
        api = APIClient()
        sign_in_as(api, user=user, device_fingerprint="boundary-tenant-2")
        key = "boundary-abandoned-000001"

        first = api.post(
            "/api/v1/payments/intents/",
            {"obligation_id": str(charge.id), "payment_method": "mobile_money"},
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        assert first.status_code == 201, first.data

        # The process died before it recorded the outcome, and the lease ran out.
        IdempotencyKey.objects.filter(key=key).update(
            status=IdempotencyStatus.IN_FLIGHT,
            in_flight_until=timezone.now() - timezone.timedelta(seconds=1),
            response_status=None,
            response_body=None,
        )

        again = api.post(
            "/api/v1/payments/intents/",
            {"obligation_id": str(charge.id), "payment_method": "mobile_money"},
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        assert again.status_code == 201, again.data
        assert again.data["id"] == first.data["id"]
        assert PaymentIntent.objects.filter(obligation=charge).count() == 1

    def test_a_completed_claim_still_replays_without_touching_the_provider(
        self, landlord, user, obligation, sign_in_as
    ):
        from rest_framework.test import APIClient

        _, charge = obligation
        api = APIClient()
        sign_in_as(api, user=user, device_fingerprint="boundary-tenant-3")
        key = "boundary-replay-0000001"
        payload = {"obligation_id": str(charge.id), "payment_method": "mobile_money"}

        first = api.post(
            "/api/v1/payments/intents/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key
        )
        assert first.status_code == 201, first.data

        recorder = Recorder()
        with patch.object(MemoryPaymentProvider, "initiate", recorder):
            replay = api.post(
                "/api/v1/payments/intents/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key
            )
        assert replay.status_code == 201
        assert replay.headers.get("X-Idempotent-Replay") == "true"
        assert replay.data["id"] == first.data["id"]
        assert recorder.calls == [], "a stored response must not reach the provider again"
