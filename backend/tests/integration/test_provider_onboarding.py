"""Provider onboarding: joining is easy; listing is earned."""

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import PermissionDenied, ValidationFailed

pytestmark = pytest.mark.django_db

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 4096


@pytest.fixture(autouse=True)
def provider_storage(settings, monkeypatch):
    from django.db import transaction

    from apps.files.storage import get_storage, reset_storage

    settings.STORAGE_BACKEND = "memory"
    settings.FILE_SCAN_MODE = "permissive"
    reset_storage()
    monkeypatch.setattr(transaction, "on_commit", lambda func, using=None: func())
    yield get_storage()
    reset_storage()


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region = Region.objects.create(name="Greater Accra", code="GA")
    district = District.objects.create(region=region, name="La Dade-Kotopon")
    locality = Locality.objects.create(district=district, name="East Legon")
    return Address.objects.create(
        locality=locality,
        digital_address="GA-543-0125",
        street="Lagos Avenue",
        landmark="Near the hospital",
    )


def approve_person_identity(user):
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    return Verification.objects.create(
        subject_type=SubjectType.USER,
        subject_id=str(user.id),
        kind=VerificationKind.IDENTITY,
        method=VerificationMethod.DOCUMENT_REVIEW,
        status=VerificationStatus.APPROVED,
        submitted_by=user,
        decided_at=timezone.now(),
    )


def approve_phone(user):
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    user.mark_phone_verified()
    # get_or_create: registered accounts already carry a live phone check, and
    # only one may be live at a time.
    verification, _ = Verification.objects.get_or_create(
        subject_type=SubjectType.USER,
        subject_id=str(user.id),
        kind=VerificationKind.PHONE,
        status=VerificationStatus.APPROVED,
        defaults={
            "method": VerificationMethod.AUTOMATED_OTP,
            "submitted_by": user,
            "decided_at": timezone.now(),
        },
    )
    return verification


def ready_document(user, storage, name="authority.jpg"):
    from apps.files import services

    stored, _ = services.reserve_upload(
        user=user,
        purpose="property_document",
        filename=name,
        content_type="image/jpeg",
        size_bytes=len(JPEG),
    )
    storage.write(key=stored.storage_key, data=JPEG)
    completed = services.complete_upload(user=user, file_id=stored.id)
    completed.refresh_from_db()
    return completed


class TestBasicIntent:
    def test_a_name_is_required_before_an_intent_can_be_chosen(self, registered):
        from apps.identity import services

        nameless = registered("0559990001", first_name="", last_name="")

        with pytest.raises(ValidationFailed):
            services.select_onboarding_role(user=nameless, intent="both")

    def test_choosing_both_intents_grants_only_the_tenant_capability(self, landlord):
        """ "Both" is two stated journeys, not two grants.

        The tenant half is self-grantable and arrives immediately. The provider
        half is a decision about evidence, so choosing it here changes nothing
        about what the account can reach.
        """
        from apps.identity import services

        landlord.role_assignments.all().delete()
        services.select_onboarding_role(user=landlord, intent="both")
        landlord.refresh_from_db()

        assert landlord.roles == {"tenant"}
        assert set(landlord.intent_selections.values_list("intent", flat=True)) == {
            "find_property",
            "manage_property",
        }
        assert landlord.onboarding_completed_at is not None

    def test_provider_api_requires_an_explicit_provider_context(self, user):
        approve_phone(user)
        client = APIClient()
        client.force_authenticate(user)

        assert client.get("/api/v1/provider/readiness/").status_code == 403

    def test_provider_context_can_open_provider_readiness(self, landlord):
        approve_phone(landlord)
        client = APIClient()
        client.force_authenticate(landlord)

        assert client.get("/api/v1/provider/readiness/").status_code == 200


class TestTrustSurface:
    def test_user_cannot_start_property_authority_as_a_person_check(self, landlord):
        approve_phone(landlord)
        client = APIClient()
        # API authentication is orthogonal here; force_authenticate keeps the
        # assertion focused on subject/kind validation.
        client.force_authenticate(landlord)
        response = client.post(
            "/api/v1/trust/verifications/",
            {"kind": "property_authority", "method": "document_review"},
            format="json",
        )
        assert response.status_code == 422


class TestOwnerApplication:
    def test_identity_is_required_before_property_submission(
        self, landlord, address, provider_storage
    ):
        from apps.property import services

        document = ready_document(landlord, provider_storage)
        with pytest.raises(PermissionDenied, match="identity"):
            services.submit_provider_application(
                user=landlord,
                data={
                    "relationship_type": "owner",
                    "title": "East Legon block",
                    "property_type": "residential",
                    "address_id": address.id,
                },
                files=[document],
            )

    def test_human_approval_materialises_property_relationship_and_public_stamps(
        self, landlord, staff, address, provider_storage, approve_space
    ):
        from apps.listing import services as listing_services
        from apps.listing.serializers import ListingSerializer
        from apps.operations.models import ManagementRole, ManagementUser
        from apps.property import services as property_services
        from apps.property.models import PropertyRelationshipType, Unit
        from apps.trust import services as trust_services
        from apps.trust.models import Verification

        approve_person_identity(landlord)
        approve_phone(landlord)
        application = property_services.submit_provider_application(
            user=landlord,
            data={
                "relationship_type": "owner",
                "title": "East Legon block",
                "property_type": "residential",
                "address_id": address.id,
            },
            files=[ready_document(landlord, provider_storage)],
        )
        verification = Verification.objects.get(id=application.authority_verification_id)
        operator = ManagementUser(
            email="provider-reviewer@example.com",
            first_name="Provider",
            last_name="Reviewer",
            role=ManagementRole.OPERATIONS_ADMIN,
            must_change_password=False,
        )
        operator.set_password("correct-horse-battery-staple")
        operator.save()
        management = APIClient()
        login = management.post(
            "/api/v1/management/auth/login/",
            {"email": operator.email, "password": "correct-horse-battery-staple"},
            format="json",
            HTTP_ORIGIN="http://localhost:3000",
        )
        assert login.status_code == 200
        management.credentials(HTTP_X_MANAGEMENT_CSRF=login.data["csrf_token"])
        decision = management.post(
            f"/api/v1/management/verifications/{verification.id}/decision/",
            {"approved": True, "note": "Authority evidence confirmed."},
            format="json",
        )
        application.refresh_from_db()

        assert decision.status_code == 200
        assert application.status == "approved"
        consumer = APIClient()
        consumer.force_authenticate(landlord)
        readiness_response = consumer.get("/api/v1/provider/readiness/")
        readiness = readiness_response.data
        assert readiness_response.status_code == 200
        assert readiness_response["Cache-Control"] == "private, no-store"
        assert readiness["next_step"] == "approved"
        assert readiness["status"] == "approved"
        assert readiness["property_id"] == str(application.property_id)
        assert readiness["onboarding_stage"] == "approved"
        from apps.property.models import PropertyProviderApplication

        newer_pending = PropertyProviderApplication.objects.create(
            applicant=landlord,
            relationship_type="owner",
            title="Second property still under review",
            property_type="house",
            address=address,
            status="pending_review",
            submitted_at=timezone.now(),
        )
        prioritised = property_services.provider_readiness(landlord)
        assert prioritised["application_id"] == str(newer_pending.id)
        assert prioritised["onboarding_stage"] == "review"
        property_readiness = property_services.provider_readiness(
            landlord, property_id=application.property_id
        )
        assert property_readiness["application_id"] == str(application.id)
        assert property_readiness["onboarding_stage"] == "approved"
        newer_pending.delete()
        assert application.property.owner == landlord
        assert application.property.relationships.filter(
            user=landlord,
            relationship_type=PropertyRelationshipType.OWNER,
            authority_verified_at__isnull=False,
        ).exists()

        unit = Unit.objects.create(
            property=application.property,
            label="Flat A",
            space_type="apartment",
            bedrooms=2,
            bathrooms=2,
        )
        # Authority over the address and the condition of the space are two
        # reviews, and publishing needs both. This test is about the first; the
        # second is established rather than exercised here.
        approve_space(unit)
        assert property_services.provider_readiness(landlord)["onboarding_stage"] == "approved"
        listing = listing_services.create_listing(
            user=landlord,
            unit=unit,
            data={
                "rent_minor": 250000,
                "headline": "Two bedroom in East Legon",
                "description": "Reviewed provider and clear rental terms.",
            },
        )
        assert property_services.provider_readiness(landlord)["onboarding_stage"] == "approved"
        listing_services.publish_listing(listing=listing, user=landlord)
        review_readiness = property_services.provider_readiness(landlord)
        assert review_readiness["onboarding_stage"] == "approved"
        assert review_readiness["listing_status"] == ""
        # Publishing a checked space goes live directly. Moderation keeps its
        # teeth in the other direction: an advertisement already in front of
        # people can be flagged, and the provider corrects it and puts it back.
        listing.refresh_from_db()
        assert listing.status == "active"
        listing_services.moderate_listing(
            listing=listing,
            management_actor=operator,
            action="flag",
            note="Replace the unclear headline and confirm the rental terms.",
        )
        changes_readiness = property_services.provider_readiness(landlord)
        assert changes_readiness["onboarding_stage"] == "approved"
        assert changes_readiness["listing_review_note"] == ""
        correction = consumer.patch(
            f"/api/v1/me/listings/{listing.id}/",
            {"headline": "Clear two bedroom in East Legon"},
            format="json",
        )
        assert correction.status_code == 200
        listing.refresh_from_db()
        assert listing.status == "draft"
        assert correction.data["review_note"] == (
            "Replace the unclear headline and confirm the rental terms."
        )
        resubmission = consumer.post(f"/api/v1/listings/{listing.id}/publish/", {}, format="json")
        assert resubmission.status_code == 200
        listing.refresh_from_db()
        assert listing.status == "active"
        assert property_services.provider_readiness(landlord)["onboarding_stage"] == "approved"
        public = ListingSerializer(listing).data

        assert public["trust_stamps"]["identity"]["state"] == "verified"
        assert public["trust_stamps"]["property"]["state"] == "verified"
        assert public["provider_label"] == "Verified owner"
        assert public["review_note"] == ""

        verification.refresh_from_db()
        trust_services.revoke(
            verification,
            reason="Authority evidence was withdrawn.",
            decided_by=staff,
        )
        listing.refresh_from_db()
        application.refresh_from_db()
        assert listing.status == "suspended"
        assert application.status == "suspended"
        assert not application.property.relationships.filter(
            user=landlord, ended_at__isnull=True
        ).exists()


class TestRepresentativeApplication:
    def test_agent_is_never_silently_stored_as_owner(
        self, agent, user, staff, address, provider_storage
    ):
        from apps.property import services
        from apps.trust import services as trust_services
        from apps.trust.models import Verification

        approve_person_identity(agent)
        approve_phone(agent)
        approve_phone(user)
        application = services.submit_provider_application(
            user=agent,
            data={
                "relationship_type": "agent",
                "title": "Owner's Airport flat",
                "property_type": "residential",
                "address_id": address.id,
                "owner_name": user.display_name,
                "owner_phone": user.phone,
            },
            files=[ready_document(agent, provider_storage, "authorization.jpg")],
        )
        verification = Verification.objects.get(id=application.authority_verification_id)
        trust_services.decide(verification, approved=True, decided_by=staff)
        application.refresh_from_db()

        assert application.property.owner == user
        assert application.property.owner != agent
        relationship = application.property.relationships.get(user=agent)
        assert relationship.relationship_type == "agent"
        assert relationship.authority_verified_at is not None
