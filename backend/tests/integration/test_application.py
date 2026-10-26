"""Rental applications.

The rule this domain exists to make visible is the advance shortfall: a listing
asking twelve months and an applicant who can raise six is a mismatch both sides
should see immediately, not after two viewings.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from django.db import close_old_connections, connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.application import services
from apps.application.models import ApplicationStatus, RentalApplication
from apps.core.exceptions import Conflict, PermissionDenied, ProviderUnavailable, ValidationFailed
from apps.idempotency.models import IdempotencyKey, IdempotencyStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


@pytest.fixture
def live_listing(landlord, address):
    from apps.listing.models import Listing, ListingStatus
    from apps.property.models import Property, Unit

    prop = Property.objects.create(
        owner=landlord, address=address, title="Osu block", property_type="apartment"
    )
    unit = Unit.objects.create(property=prop, label="Flat A", bedrooms=1, bathrooms=1)
    return Listing.objects.create(
        unit=unit,
        created_by=landlord,
        status=ListingStatus.ACTIVE,
        rent_minor=150000,
        headline="Chamber and hall in Osu",
        description="Prepaid meter.",
        advance_months=12,
        locality_id_cache=address.locality_id,
        bedrooms_cache=1,
    )


class TestWhatTheApplicantSees:
    """An application list without a photograph is a column of headlines.

    A tenant recognizes the place they applied for by looking at it, so the
    row carries the campaign photograph and the Unit's own identity rather
    than a headline and a status word.
    """

    def _photo(self, owner, name, *, sensitive=False, purpose="property_photo"):
        from uuid import uuid4

        from apps.files.models import ScanStatus, StoredFile, UploadStatus

        return StoredFile.objects.create(
            storage_key=f"application-thumb/{uuid4()}-{name}",
            bucket="test",
            original_filename=name,
            declared_content_type="image/jpeg",
            content_type="image/jpeg",
            size_bytes=90_000,
            purpose=purpose,
            is_sensitive=sensitive,
            upload_status=UploadStatus.READY,
            scan_status=ScanStatus.CLEAN,
            uploaded_by=owner,
            owner_id_snapshot=str(owner.id),
        )

    def test_the_row_names_the_unit_and_shows_the_cover_photograph(
        self, user, landlord, live_listing, sign_in_as
    ):
        from apps.listing.models import ListingMedia

        # The cover leads even when another photograph was attached first: it
        # is the image the applicant clicked in Explore.
        ListingMedia.objects.create(
            listing=live_listing, file=self._photo(landlord, "side.jpg"), sort_order=0
        )
        ListingMedia.objects.create(
            listing=live_listing,
            file=self._photo(landlord, "cover.jpg"),
            is_cover=True,
            sort_order=1,
        )
        services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_in_as(user=user)['access_token']}")
        row = client.get("/api/v1/me/applications/").data[0]

        assert row["property_title"] == "Osu block"
        assert row["unit_label"] == "Flat A"
        assert row["rent_formatted"] == "GH₵1,500.00"
        assert row["listing_status"] == "active"
        assert "cover.jpg" in row["photo_url"]

    def test_evidence_never_becomes_a_thumbnail(self, user, landlord, live_listing, sign_in_as):
        from apps.listing.models import ListingMedia

        ListingMedia.objects.create(
            listing=live_listing,
            file=self._photo(landlord, "id-card.jpg", sensitive=True),
            is_cover=True,
        )
        services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_in_as(user=user)['access_token']}")
        assert client.get("/api/v1/me/applications/").data[0]["photo_url"] is None

    def test_withdrawing_the_listing_does_not_unshow_the_applicant_the_place(
        self, user, landlord, live_listing, sign_in_as
    ):
        """They saw it while they were deciding. Taking it out of discovery is
        not a revocation of that, and a row with no picture is unrecognizable."""
        from apps.listing.models import ListingMedia, ListingStatus

        ListingMedia.objects.create(
            listing=live_listing, file=self._photo(landlord, "cover.jpg"), is_cover=True
        )
        services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )
        live_listing.status = ListingStatus.WITHDRAWN
        live_listing.save(update_fields=["status"])

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_in_as(user=user)['access_token']}")
        row = client.get("/api/v1/me/applications/").data[0]
        assert row["listing_status"] == "withdrawn"
        assert "cover.jpg" in row["photo_url"]


class TestApplying:
    def test_a_tenant_can_apply(self, user, live_listing):
        application = services.submit_application(
            listing=live_listing,
            tenant=user,
            data={"advance_months_offered": 12, "message": "I can move in next month."},
        )
        assert application.status == ApplicationStatus.SUBMITTED
        assert application.unit_id == live_listing.unit_id
        assert application.meets_advance

    def test_the_advance_shortfall_is_the_headline_number(self, user, live_listing):
        """Asks 12, offers 6 — both sides should see "6 months short" rather
        than doing the arithmetic themselves."""
        application = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )
        assert application.advance_shortfall_months == 6
        assert not application.meets_advance

    def test_offering_more_than_asked_is_not_a_negative_shortfall(self, user, live_listing):
        application = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 24}
        )
        assert application.advance_shortfall_months == 0
        assert application.meets_advance

    def test_applying_twice_is_refused(self, user, live_listing):
        services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        with pytest.raises(Conflict):
            services.submit_application(
                listing=live_listing, tenant=user, data={"advance_months_offered": 12}
            )

    def test_an_accepted_application_still_blocks_another_for_the_unit(
        self, user, landlord, live_listing
    ):
        application = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        services.decide(application=application, user=landlord, accept=True)

        with pytest.raises(Conflict):
            services.submit_application(
                listing=live_listing, tenant=user, data={"advance_months_offered": 12}
            )

    def test_a_replacement_listing_does_not_reopen_the_same_unit(self, user, live_listing):
        from apps.listing.models import Listing, ListingStatus

        services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        live_listing.status = ListingStatus.WITHDRAWN
        live_listing.save(update_fields=["status", "updated_at"])
        replacement = Listing.objects.create(
            unit=live_listing.unit,
            created_by=live_listing.created_by,
            status=ListingStatus.ACTIVE,
            rent_minor=live_listing.rent_minor,
            headline="The same Flat A, relisted",
            description=live_listing.description,
            advance_months=live_listing.advance_months,
            locality_id_cache=live_listing.locality_id_cache,
            bedrooms_cache=live_listing.bedrooms_cache,
        )

        with pytest.raises(Conflict):
            services.submit_application(
                listing=replacement, tenant=user, data={"advance_months_offered": 12}
            )

    def test_a_landlord_cannot_apply_for_their_own_listing(self, landlord, live_listing):
        with pytest.raises(ValidationFailed):
            services.submit_application(
                listing=live_listing, tenant=landlord, data={"advance_months_offered": 12}
            )

    def test_a_withdrawn_listing_cannot_be_applied_for(self, user, live_listing):
        from apps.listing.models import ListingStatus

        live_listing.status = ListingStatus.WITHDRAWN
        live_listing.save(update_fields=["status"])
        with pytest.raises(Conflict):
            services.submit_application(
                listing=live_listing, tenant=user, data={"advance_months_offered": 12}
            )

    def test_the_profile_fills_in_what_the_form_leaves_out(self, user, live_listing):
        """A tenant who has already told us their situation should not retype it."""
        from apps.identity.models import TenantProfile

        TenantProfile.objects.create(
            user=user,
            occupation="Teacher",
            employer="Accra Academy",
            household_size=3,
            advance_months_affordable=6,
        )
        application = services.submit_application(listing=live_listing, tenant=user, data={})
        assert application.occupation == "Teacher"
        assert application.household_size == 3
        assert application.advance_months_offered == 6

    def test_an_explicit_zero_month_offer_is_not_replaced_by_the_profile(self, user, live_listing):
        from apps.identity.models import TenantProfile

        TenantProfile.objects.create(user=user, advance_months_affordable=6)
        application = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 0}
        )

        assert application.advance_months_offered == 0
        assert application.advance_shortfall_months == 12

    def test_the_claim_is_snapshotted_not_referenced(self, user, live_listing):
        """A landlord defending a decision later needs what was in front of
        them, not what the profile says today."""
        from apps.identity.models import TenantProfile

        profile = TenantProfile.objects.create(user=user, occupation="Teacher")
        application = services.submit_application(listing=live_listing, tenant=user, data={})

        profile.occupation = "Something else entirely"
        profile.save(update_fields=["occupation"])
        application.refresh_from_db()
        assert application.occupation == "Teacher"


class TestDeciding:
    def test_a_superseded_historical_application_cannot_be_decided(
        self, user, landlord, live_listing
    ):
        historical = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        replacement = RentalApplication.objects.create(
            listing=live_listing,
            unit=live_listing.unit,
            tenant=user,
            status=ApplicationStatus.REJECTED,
        )
        historical.superseded_by = replacement
        historical.save(update_fields=["superseded_by", "updated_at"])

        with pytest.raises(Conflict):
            services.decide(application=historical, user=landlord, accept=True)

    def test_the_landlord_picks_it_up_then_accepts(self, user, landlord, live_listing):
        application = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        application = services.start_review(application=application, user=landlord)
        assert application.status == ApplicationStatus.UNDER_REVIEW

        application = services.decide(
            application=application, user=landlord, accept=True, note="Come and sign."
        )
        assert application.status == ApplicationStatus.ACCEPTED
        assert application.decided_by_id == landlord.id
        assert application.decision_note == "Come and sign."

    def test_a_rejection_carries_a_reason_to_the_applicant(self, user, landlord, live_listing):
        application = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 3}
        )
        application = services.decide(
            application=application,
            user=landlord,
            accept=False,
            note="I need at least six months' advance.",
        )
        assert application.status == ApplicationStatus.REJECTED
        assert "six months" in application.decision_note

    def test_a_stranger_cannot_decide(self, user, agent, live_listing):
        application = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        with pytest.raises(PermissionDenied):
            services.decide(application=application, user=agent, accept=True)

    def test_accepting_one_does_not_reject_the_others(self, user, agent, landlord, live_listing):
        """A landlord may hold two while deciding. Auto-rejecting would send a
        rejection they never wrote."""
        first = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        second = services.submit_application(
            listing=live_listing, tenant=agent, data={"advance_months_offered": 12}
        )
        services.decide(application=first, user=landlord, accept=True)
        second.refresh_from_db()
        assert second.status == ApplicationStatus.SUBMITTED

    def test_a_settled_application_cannot_be_decided_again(self, user, landlord, live_listing):
        application = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        services.decide(application=application, user=landlord, accept=True)
        with pytest.raises(Conflict):
            services.decide(application=application, user=landlord, accept=False)


class TestWithdrawing:
    def test_the_applicant_can_withdraw(self, user, live_listing):
        application = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        application = services.withdraw(
            application=application, user=user, note="Found somewhere else"
        )
        assert application.status == ApplicationStatus.WITHDRAWN

    def test_the_landlord_cannot_withdraw_on_the_applicants_behalf(
        self, user, landlord, live_listing
    ):
        application = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        with pytest.raises(PermissionDenied):
            services.withdraw(application=application, user=landlord)

    def test_withdrawing_frees_the_tenant_to_apply_again(self, user, live_listing):
        first = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )
        services.withdraw(application=first, user=user)
        again = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        assert again.id != first.id


class TestApi:
    @pytest.fixture
    def signed_in(self, sms, sign_in_as):
        def _sign_in(person, label):
            client = APIClient()
            sign_in_as(client, user=person, device_fingerprint=label)
            return client

        return _sign_in

    def test_apply_review_and_accept_over_http(self, signed_in, user, landlord, live_listing):
        tenant_api = signed_in(user, "t")
        host_api = signed_in(landlord, "h")

        applied = tenant_api.post(
            "/api/v1/me/applications/",
            {
                "listing_id": str(live_listing.id),
                "advance_months_offered": 6,
                "household_size": 2,
                "guarantor_name": "Kwame Mensah",
                "guarantor_phone": "0244000111",
                "guarantor_relationship": "Uncle",
                "message": "I can pay six months now and the rest in three.",
            },
            format="json",
        )
        assert applied.status_code == 201, applied.data
        assert applied.data["advance_shortfall_months"] == 6
        assert applied.data["meets_advance"] is False

        inbox = host_api.get("/api/v1/me/received-applications/?open=true")
        assert [item["id"] for item in inbox.data] == [applied.data["id"]]
        assert inbox.data[0]["guarantor_name"] == "Kwame Mensah"

        reviewing = host_api.post(
            f"/api/v1/applications/{applied.data['id']}/review/", {}, format="json"
        )
        assert reviewing.data["status"] == "under_review"

        decided = host_api.post(
            f"/api/v1/applications/{applied.data['id']}/accept/",
            {"note": "Six months is fine. Come and sign."},
            format="json",
        )
        assert decided.data["status"] == "accepted"

        mine = tenant_api.get("/api/v1/me/applications/")
        assert mine.data[0]["status"] == "accepted"
        assert "Come and sign" in mine.data[0]["decision_note"]

    def test_submission_validates_and_normalises_tenant_claims(self, signed_in, user, live_listing):
        tenant_api = signed_in(user, "tenant-claims")

        invalid_income = tenant_api.post(
            "/api/v1/me/applications/",
            {
                "listing_id": str(live_listing.id),
                "advance_months_offered": 0,
                "income_band": "made_up_band",
            },
            format="json",
        )
        assert invalid_income.status_code == 422
        assert "income_band" in invalid_income.data["error"]["details"]["fields"]

        # And a real one is accepted. Without this the check above is satisfied
        # by a field that rejects everything, which is exactly what an empty
        # choice list does — and the vocabulary is bound at runtime now, so
        # "rejects the wrong value" is only half the claim.
        from apps.application.serializers import SubmitApplicationSerializer
        from apps.identity.models import IncomeBand

        accepted = SubmitApplicationSerializer(
            data={
                "listing_id": str(live_listing.id),
                "advance_months_offered": 0,
                "income_band": IncomeBand.values[0],
            }
        )
        assert accepted.is_valid(), accepted.errors

        invalid_phone = tenant_api.post(
            "/api/v1/me/applications/",
            {
                "listing_id": str(live_listing.id),
                "advance_months_offered": 0,
                "guarantor_phone": "not a phone number",
            },
            format="json",
        )
        assert invalid_phone.status_code == 422
        assert "guarantor_phone" in invalid_phone.data["error"]["details"]["fields"]

        applied = tenant_api.post(
            "/api/v1/me/applications/",
            {
                "listing_id": str(live_listing.id),
                "advance_months_offered": 0,
                "guarantor_phone": "0244000111",
            },
            format="json",
        )
        assert applied.status_code == 201, applied.data
        assert applied.data["advance_months_offered"] == 0
        assert applied.data["guarantor_phone"] == "+233244000111"

    def test_direct_api_rejects_unavailable_and_duplicate_applications(
        self, signed_in, user, agent, live_listing
    ):
        from apps.listing.models import ListingStatus

        tenant_api = signed_in(user, "tenant-constraints")
        body = {
            "listing_id": str(live_listing.id),
            "advance_months_offered": 6,
        }

        first = tenant_api.post("/api/v1/me/applications/", body, format="json")
        assert first.status_code == 201
        duplicate = tenant_api.post("/api/v1/me/applications/", body, format="json")
        assert duplicate.status_code == 409

        live_listing.status = ListingStatus.WITHDRAWN
        live_listing.save(update_fields=["status"])
        other_tenant_api = signed_in(agent, "tenant-unavailable")
        unavailable = other_tenant_api.post("/api/v1/me/applications/", body, format="json")
        assert unavailable.status_code == 409

    def test_direct_api_rejects_a_second_application_after_acceptance(
        self, signed_in, user, landlord, live_listing
    ):
        tenant_api = signed_in(user, "tenant-accepted-duplicate")
        host_api = signed_in(landlord, "host-accepted-duplicate")
        body = {
            "listing_id": str(live_listing.id),
            "advance_months_offered": 12,
        }
        first = tenant_api.post("/api/v1/me/applications/", body, format="json")
        accepted = host_api.post(
            f"/api/v1/applications/{first.data['id']}/accept/", {}, format="json"
        )
        assert accepted.status_code == 200

        duplicate = tenant_api.post("/api/v1/me/applications/", body, format="json")
        assert duplicate.status_code == 409

    def test_a_manager_receives_applications_for_their_managed_property(
        self, signed_in, user, agent, live_listing
    ):
        live_listing.unit.property.managed_by = agent
        live_listing.unit.property.save(update_fields=["managed_by"])

        tenant_api = signed_in(user, "managed-tenant")
        manager_api = signed_in(agent, "managed-provider")
        applied = tenant_api.post(
            "/api/v1/me/applications/",
            {
                "listing_id": str(live_listing.id),
                "advance_months_offered": 12,
            },
            format="json",
        )

        inbox = manager_api.get("/api/v1/me/received-applications/")
        assert inbox.status_code == 200
        assert [row["id"] for row in inbox.data] == [applied.data["id"]]

    def test_a_stranger_cannot_read_an_application(self, signed_in, user, agent, live_listing):
        tenant_api = signed_in(user, "t")
        applied = tenant_api.post(
            "/api/v1/me/applications/",
            {
                "listing_id": str(live_listing.id),
                "advance_months_offered": 12,
            },
            format="json",
        )

        stranger = signed_in(agent, "s")
        response = stranger.get(f"/api/v1/applications/{applied.data['id']}/")
        assert response.status_code in (403, 404)

    def test_applying_requires_signing_in(self, live_listing):
        response = APIClient().post(
            "/api/v1/me/applications/",
            {
                "listing_id": str(live_listing.id),
                "advance_months_offered": 12,
            },
            format="json",
        )
        assert response.status_code in (401, 403)


class TestRequestIdempotency:
    @pytest.fixture
    def tenant_api(self, user, sign_in_as):
        client = APIClient()
        sign_in_as(client, user=user, device_fingerprint="idempotency-tenant")
        return client

    def test_same_key_replays_the_created_application(self, tenant_api, user, live_listing):
        body = {"listing_id": str(live_listing.id), "advance_months_offered": 6}
        headers = {"HTTP_IDEMPOTENCY_KEY": "application-replay-0001"}

        first = tenant_api.post("/api/v1/me/applications/", body, format="json", **headers)
        replay = tenant_api.post("/api/v1/me/applications/", body, format="json", **headers)

        assert first.status_code == replay.status_code == 201
        assert first.data == replay.data
        assert replay["X-Idempotent-Replay"] == "true"
        assert RentalApplication.objects.filter(tenant=user, unit=live_listing.unit).count() == 1
        claim = IdempotencyKey.objects.get(key="application-replay-0001")
        assert claim.status == IdempotencyStatus.COMPLETED
        assert claim.resource_type == "rental_application"
        assert claim.resource_id == first.data["id"]

    def test_reusing_a_key_with_another_body_is_a_conflict(self, tenant_api, user, live_listing):
        headers = {"HTTP_IDEMPOTENCY_KEY": "application-conflict-01"}
        first = tenant_api.post(
            "/api/v1/me/applications/",
            {"listing_id": str(live_listing.id), "advance_months_offered": 6},
            format="json",
            **headers,
        )
        conflict = tenant_api.post(
            "/api/v1/me/applications/",
            {"listing_id": str(live_listing.id), "advance_months_offered": 12},
            format="json",
            **headers,
        )

        assert first.status_code == 201
        assert conflict.status_code == 409
        assert conflict.data["error"]["code"] == "idempotency_conflict"
        assert RentalApplication.objects.filter(tenant=user, unit=live_listing.unit).count() == 1

    def test_invalid_key_is_rejected_before_the_mutation(self, tenant_api, user, live_listing):
        response = tenant_api.post(
            "/api/v1/me/applications/",
            {"listing_id": str(live_listing.id), "advance_months_offered": 6},
            format="json",
            HTTP_IDEMPOTENCY_KEY="short",
        )

        assert response.status_code == 422
        assert not RentalApplication.objects.filter(tenant=user).exists()
        assert not IdempotencyKey.objects.exists()

    def test_expired_response_cache_is_purged(self, tenant_api, live_listing):
        from apps.idempotency.tasks import purge_expired

        response = tenant_api.post(
            "/api/v1/me/applications/",
            {"listing_id": str(live_listing.id), "advance_months_offered": 6},
            format="json",
            HTTP_IDEMPOTENCY_KEY="application-expired-001",
        )
        assert response.status_code == 201
        claim = IdempotencyKey.objects.get(key="application-expired-001")
        claim.expires_at = timezone.now() - timedelta(seconds=1)
        claim.save(update_fields=["expires_at", "updated_at"])

        assert purge_expired() == 1
        assert not IdempotencyKey.objects.filter(id=claim.id).exists()

    def test_retryable_failure_does_not_permanently_spend_the_key(
        self, tenant_api, user, live_listing, monkeypatch
    ):
        original = services.submit_application
        calls = 0

        def flaky_submit(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise ProviderUnavailable()
            return original(*args, **kwargs)

        monkeypatch.setattr(services, "submit_application", flaky_submit)
        body = {"listing_id": str(live_listing.id), "advance_months_offered": 6}
        headers = {"HTTP_IDEMPOTENCY_KEY": "application-retry-00001"}

        unavailable = tenant_api.post("/api/v1/me/applications/", body, format="json", **headers)
        claim = IdempotencyKey.objects.get(key="application-retry-00001")
        assert unavailable.status_code == 503
        assert claim.status == IdempotencyStatus.FAILED
        assert not RentalApplication.objects.filter(tenant=user).exists()

        retried = tenant_api.post("/api/v1/me/applications/", body, format="json", **headers)
        claim.refresh_from_db()
        assert retried.status_code == 201
        assert calls == 2
        assert claim.status == IdempotencyStatus.COMPLETED
        assert RentalApplication.objects.filter(tenant=user).count() == 1

    @pytest.mark.django_db(transaction=True)
    def test_concurrent_duplicates_execute_once(self, user, live_listing, sign_in_as):
        if connection.vendor != "postgresql":
            pytest.skip("The production claim lock is PostgreSQL-specific.")

        access_token = sign_in_as(user=user, device_fingerprint="idempotency-concurrent")[
            "access_token"
        ]
        body = {"listing_id": str(live_listing.id), "advance_months_offered": 6}
        barrier = Barrier(2)

        def submit():
            close_old_connections()
            try:
                client = APIClient()
                client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
                barrier.wait(timeout=5)
                response = client.post(
                    "/api/v1/me/applications/",
                    body,
                    format="json",
                    HTTP_IDEMPOTENCY_KEY="application-concurrent1",
                )
                return response.status_code, response.data, response.headers
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(submit), pool.submit(submit)]
            results = [future.result(timeout=10) for future in futures]

        assert [result[0] for result in results] == [201, 201]
        assert results[0][1] == results[1][1]
        assert any(result[2].get("X-Idempotent-Replay") == "true" for result in results)
        assert RentalApplication.objects.filter(tenant=user, unit=live_listing.unit).count() == 1


class TestRentingTheSamePlaceTwice:
    """A finished tenancy must not block the tenant who finished it.

    An accepted application is never deleted or relabelled when the tenancy it
    produced ends — the decision stands. But `accepted` sits in the set that
    blocks a second application, and nothing asked whether the acquisition was
    still *live*, so the record of somebody's own completed tenancy told them
    they had already applied for the place.

    There was no way round it from the outside: an accepted application cannot
    be withdrawn, and the duplicate rule is enforced by a database constraint as
    well as by the friendly check.
    """

    def _lease(self, listing, tenant, landlord, status):
        from apps.lease.models import Lease

        return Lease.objects.create(
            unit=listing.unit,
            listing=listing,
            tenant=tenant,
            landlord=landlord,
            status=status,
            rent_minor=listing.rent_minor,
            rent_currency="GHS",
            starts_on=timezone.now().date(),
        )

    def test_a_tenant_can_apply_again_once_the_tenancy_has_ended(
        self, user, landlord, live_listing
    ):
        from apps.application.services import conclude_for_lease
        from apps.lease.models import LeaseStatus

        first = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )
        first.status = ApplicationStatus.ACCEPTED
        first.save(update_fields=["status"])

        lease = self._lease(live_listing, user, landlord, LeaseStatus.ACTIVE)
        lease.application = first
        lease.save(update_fields=["application"])

        # While the tenancy is live, a second application is still refused.
        with pytest.raises(Conflict):
            services.submit_application(
                listing=live_listing, tenant=user, data={"advance_months_offered": 6}
            )

        lease.status = LeaseStatus.ENDED
        lease.save(update_fields=["status"])
        conclude_for_lease(lease)

        again = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )

        assert again.id != first.id
        first.refresh_from_db()
        # The decision is untouched. Only its standing as a live claim changed.
        assert first.status == ApplicationStatus.ACCEPTED
        assert first.concluded_at is not None
        assert RentalApplication.objects.filter(unit=live_listing.unit, tenant=user).count() == 2

    def test_the_constraint_agrees_with_the_friendly_check(self, user, landlord, live_listing):
        """Otherwise the fix only moves the refusal from a sentence somebody can
        read to an IntegrityError they cannot."""
        from apps.application.services import conclude_for_lease
        from apps.lease.models import LeaseStatus

        first = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )
        first.status = ApplicationStatus.ACCEPTED
        first.save(update_fields=["status"])
        lease = self._lease(live_listing, user, landlord, LeaseStatus.ENDED)
        lease.application = first
        lease.save(update_fields=["application"])
        conclude_for_lease(lease)

        # Straight at the constraint, past the service check entirely.
        RentalApplication.objects.create(
            listing=live_listing,
            unit=live_listing.unit,
            tenant=user,
            status=ApplicationStatus.SUBMITTED,
            advance_months_offered=6,
        )

        assert (
            RentalApplication.objects.filter(
                unit=live_listing.unit, tenant=user, concluded_at__isnull=True
            ).count()
            == 1
        )

    def test_a_declined_agreement_also_frees_the_unit(self, user, landlord, live_listing):
        """Declining an offer is not the same as never applying, but it is not a
        live claim either."""
        from apps.application.services import conclude_for_lease
        from apps.lease.models import LeaseStatus

        first = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )
        first.status = ApplicationStatus.ACCEPTED
        first.save(update_fields=["status"])
        lease = self._lease(live_listing, user, landlord, LeaseStatus.DECLINED)
        lease.application = first
        lease.save(update_fields=["application"])
        conclude_for_lease(lease)

        assert services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )

    def test_an_open_application_still_blocks(self, user, live_listing):
        """The rule that was right stays right."""
        services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )
        with pytest.raises(Conflict):
            services.submit_application(
                listing=live_listing, tenant=user, data={"advance_months_offered": 6}
            )

    def test_concluding_is_idempotent_and_ignores_a_lease_with_no_application(
        self, user, landlord, live_listing
    ):
        """A lease can be prepared straight from a private access code, with no
        application behind it at all."""
        from apps.application.services import conclude_for_lease
        from apps.lease.models import LeaseStatus

        bare = self._lease(live_listing, user, landlord, LeaseStatus.ENDED)
        conclude_for_lease(bare)  # must not raise

        first = services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )
        lease = self._lease(live_listing, user, landlord, LeaseStatus.ENDED)
        lease.application = first
        lease.save(update_fields=["application"])

        conclude_for_lease(lease)
        first.refresh_from_db()
        stamped = first.concluded_at

        conclude_for_lease(lease)
        first.refresh_from_db()
        assert first.concluded_at == stamped
