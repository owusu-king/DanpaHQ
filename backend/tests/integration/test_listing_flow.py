"""Listing lifecycle and access control."""

from uuid import uuid4

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def listing_memory_storage(settings):
    from apps.files.storage import get_storage, reset_storage

    settings.STORAGE_BACKEND = "memory"
    reset_storage()
    backend = get_storage()
    yield backend
    reset_storage()


@pytest.fixture
def landlord_api(landlord, sms, sign_in_as):
    client = APIClient()
    sign_in_as(client, user=landlord, device_fingerprint="ll-device")
    return client


@pytest.fixture
def tenant_api(user, sms, sign_in_as):
    client = APIClient()
    sign_in_as(client, user=user, device_fingerprint="tenant-device")
    return client


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


def _stored_photo(owner, name: str, *, sensitive: bool = False, purpose="property_photo"):
    from apps.files.models import ScanStatus, StoredFile, UploadStatus

    return StoredFile.objects.create(
        storage_key=f"public-gallery/{uuid4()}-{name}",
        bucket="test",
        original_filename=name,
        declared_content_type="image/jpeg",
        content_type="image/jpeg",
        size_bytes=100_000,
        purpose=purpose,
        is_sensitive=sensitive,
        upload_status=UploadStatus.READY,
        scan_status=ScanStatus.CLEAN,
        uploaded_by=owner,
        owner_id_snapshot=str(owner.id),
    )


@pytest.fixture
def property_obj(landlord, address, approve_provider):
    from apps.property.models import Property

    prop = Property.objects.create(
        owner=landlord,
        title="Test property",
        property_type="apartment",
        address=address,
    )
    approve_provider(landlord, prop)
    return prop


@pytest.fixture
def unit_obj(property_obj, approve_space):
    """A space that has been checked, which is what makes it publishable.

    The refusal for an unchecked one is its own test; everything else here is
    about listing behaviour and starts after that gate.
    """
    from apps.property.models import Unit

    unit = Unit.objects.create(
        property=property_obj,
        label="Flat 1",
        space_type="apartment",
        bedrooms=2,
        bathrooms=1,
    )
    approve_space(unit)
    return unit


@pytest.fixture
def unchecked_unit(property_obj):
    from apps.property.models import Unit

    return Unit.objects.create(
        property=property_obj,
        label="Flat 2",
        space_type="apartment",
        bedrooms=1,
        bathrooms=1,
    )


class TestPropertyCreation:
    def test_self_selected_landlord_cannot_create_unreviewed_property(self, landlord_api, address):
        response = landlord_api.post(
            "/api/v1/properties/",
            {
                "title": "Osu flat",
                "property_type": "residential",
                "address_id": address.id,
            },
            format="json",
        )
        assert response.status_code == 403

    def test_tenant_cannot_create_property(self, tenant_api, address):
        response = tenant_api.post(
            "/api/v1/properties/",
            {
                "title": "Bad actor",
                "property_type": "residential",
                "address_id": address.id,
            },
            format="json",
        )
        assert response.status_code in (403, 401, 422)

    def test_agent_cannot_silently_claim_ownership(self, agent, address):
        from apps.core.exceptions import PermissionDenied
        from apps.property import services

        with pytest.raises(PermissionDenied):
            services.create_property(
                user=agent,
                data={
                    "title": "Client property",
                    "property_type": "residential",
                    "address_id": address.id,
                },
            )

    def test_landlord_cannot_see_other_landlords_property(self, landlord_api, address, agent, sms):
        from apps.property.models import Property

        other_prop = Property.objects.create(
            owner=agent, title="Other's flat", property_type="apartment", address=address
        )
        response = landlord_api.get(f"/api/v1/properties/{other_prop.id}/")
        assert response.status_code in (403, 404)


class TestListingLifecycle:
    def test_create_draft_listing(self, landlord_api, unit_obj):
        response = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "rent_period": "monthly",
                "advance_months": 6,
                "headline": "Lovely 2-bed in Osu",
                "description": "Walking distance to the beach.",
            },
            format="json",
        )
        assert response.status_code == 201
        assert response.data["status"] == "draft"
        assert response.data["advance_months"] == 6

    def test_draft_is_not_visible_in_public_search(self, landlord_api, tenant_api, unit_obj):
        r = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "headline": "Hidden draft",
                "description": "Not yet.",
            },
            format="json",
        )
        listing_id = r.data["id"]
        search = tenant_api.get("/api/v1/listings/")
        assert not any(row["id"] == listing_id for row in search.data.get("results", []))

    def test_publishing_a_checked_space_goes_live_without_a_queue(self, landlord_api, unit_obj):
        r = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "headline": "2-bed in Osu",
                "description": "Nice flat.",
            },
            format="json",
        )
        listing_id = r.data["id"]

        pub = landlord_api.post(f"/api/v1/listings/{listing_id}/publish/", format="json")
        assert pub.status_code == 200
        assert pub.data["status"] == "active"

        # Now visible without auth
        anon = APIClient()
        detail = anon.get(f"/api/v1/listings/{listing_id}/")
        assert detail.status_code == 200

    def test_publishing_an_unchecked_space_is_refused_over_http(self, landlord_api, unchecked_unit):
        r = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unchecked_unit.id),
                "rent_minor": 150000,
                "headline": "Not checked yet",
                "description": "Should not reach anyone.",
            },
            format="json",
        )

        pub = landlord_api.post(f"/api/v1/listings/{r.data['id']}/publish/", format="json")

        assert pub.status_code == 409
        assert "space" in pub.data["error"]["message"].lower()
        assert APIClient().get(f"/api/v1/listings/{r.data['id']}/").status_code == 404

    def test_unit_listing_combines_ordered_verified_photos_without_copying_files(
        self,
        landlord_api,
        landlord,
        property_obj,
        unit_obj,
        listing_memory_storage,
    ):
        from apps.files.models import StoredFile
        from apps.listing.models import Listing, ListingMedia
        from apps.property.models import PropertyMedia, UnitMedia
        from apps.trust.models import (
            EvidenceType,
            SubjectType,
            Verification,
            VerificationEvidence,
            VerificationKind,
            VerificationStatus,
        )

        unit_primary = _stored_photo(landlord, "unit-primary.jpg")
        unit_second = _stored_photo(landlord, "unit-second.jpg")
        listing_only = _stored_photo(landlord, "listing-only.jpg")
        property_front = _stored_photo(landlord, "property-front.jpg")
        property_side = _stored_photo(landlord, "property-side.jpg")
        meter_close_up = _stored_photo(landlord, "meter-number.jpg")
        arbitrary_property = _stored_photo(landlord, "not-reviewed.jpg")
        sensitive_unit = _stored_photo(landlord, "private-unit.jpg", sensitive=True)
        wrong_purpose = _stored_photo(
            landlord,
            "authority-document.jpg",
            sensitive=True,
            purpose="property_document",
        )

        UnitMedia.objects.create(
            unit=unit_obj,
            file=unit_primary,
            caption="Main room",
            is_primary=True,
            sort_order=10,
        )
        UnitMedia.objects.create(
            unit=unit_obj,
            file=unit_second,
            caption="Kitchen",
            sort_order=0,
        )
        # A malformed legacy row must not turn a sensitive file into a public
        # URL merely because it sits on UnitMedia.
        UnitMedia.objects.create(unit=unit_obj, file=sensitive_unit, caption="Private")
        PropertyMedia.objects.create(
            property=property_obj,
            file=arbitrary_property,
            kind="exterior",
            caption="Uploaded after review",
        )

        condition_review = Verification.objects.get(
            subject_type=SubjectType.PROPERTY,
            subject_id=str(property_obj.id),
            kind=VerificationKind.PROPERTY_CONDITION,
            status=VerificationStatus.APPROVED,
        )
        # Attach side before front to prove the public order is semantic rather
        # than whichever upload finished first.
        VerificationEvidence.objects.create(
            verification=condition_review,
            evidence_type=EvidenceType.PROPERTY_SIDE,
            file=property_side,
            collected_by=landlord,
        )
        VerificationEvidence.objects.create(
            verification=condition_review,
            evidence_type=EvidenceType.PROPERTY_FRONT,
            file=property_front,
            collected_by=landlord,
        )
        VerificationEvidence.objects.create(
            verification=condition_review,
            evidence_type=EvidenceType.PROPERTY_SURROUNDINGS,
            file=wrong_purpose,
            collected_by=landlord,
        )
        VerificationEvidence.objects.create(
            verification=condition_review,
            evidence_type=EvidenceType.POWER_METER_VIEW,
            file=meter_close_up,
            collected_by=landlord,
        )

        created = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "headline": "Gallery-ready flat",
                "description": "The unit and compound in one view.",
            },
            format="json",
        )
        listing = Listing.objects.get(id=created.data["id"])
        ListingMedia.objects.create(
            listing=listing,
            file=unit_primary,
            caption="The same main room",
            is_cover=True,
        )
        ListingMedia.objects.create(
            listing=listing,
            file=listing_only,
            caption="Evening view",
            sort_order=1,
        )
        landlord_api.post(f"/api/v1/listings/{listing.id}/publish/", format="json")
        file_count = StoredFile.objects.count()

        detail = APIClient().get(f"/api/v1/listings/{listing.id}/")

        assert detail.status_code == 200
        gallery = detail.data["gallery"]
        assert [row["source"] for row in gallery] == [
            "unit",
            "unit",
            "listing",
            "property",
            "property",
        ]
        assert [row["file_id"] for row in gallery] == [
            str(unit_primary.id),
            str(unit_second.id),
            str(listing_only.id),
            str(property_front.id),
            str(property_side.id),
        ]
        assert gallery[0]["is_primary"] is True
        assert gallery[3]["source_label"] == "The wider property"
        assert all(row["download_url"].startswith("memory://") for row in gallery)
        assert len({row["file_id"] for row in gallery}) == len(gallery)
        assert [row["file_id"] for row in detail.data["property_context"]["photos"]] == [
            str(property_front.id),
            str(property_side.id),
        ]
        assert StoredFile.objects.count() == file_count

        # A later revocation means those photographs are historical evidence,
        # not currently verified Property context for a public gallery.
        condition_review.status = VerificationStatus.REVOKED
        condition_review.save(update_fields=["status", "updated_at"])
        after_revocation = APIClient().get(f"/api/v1/listings/{listing.id}/")
        assert not any(row["source"] == "property" for row in after_revocation.data["gallery"])
        assert after_revocation.data["property_context"]["photos"] == []

    def test_public_search_accepts_keywords_and_property_type(self, landlord_api, unit_obj):
        created = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "headline": "Quiet two-bed in Osu",
                "description": "Near Oxford Street.",
            },
            format="json",
        )
        landlord_api.post(f"/api/v1/listings/{created.data['id']}/publish/", format="json")

        response = APIClient().get("/api/v1/listings/?q=Osu&property_type=apartment")

        assert response.status_code == 200
        assert any(row["id"] == created.data["id"] for row in response.data["results"])

    def test_only_marketing_photos_can_cross_the_public_listing_boundary(
        self, landlord_api, landlord, unit_obj, listing_memory_storage
    ):
        from apps.files.models import FilePurpose, ScanStatus, StoredFile, UploadStatus

        created = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "headline": "Photo-ready flat",
                "description": "Reviewed and ready.",
            },
            format="json",
        )
        identity_document = StoredFile.objects.create(
            storage_key="identity/private-card.jpg",
            bucket="test",
            storage_backend="memory",
            original_filename="card.jpg",
            purpose=FilePurpose.IDENTITY_DOCUMENT,
            is_sensitive=True,
            upload_status=UploadStatus.READY,
            scan_status=ScanStatus.CLEAN,
            uploaded_by=landlord,
            owner_id_snapshot=str(landlord.id),
        )

        refused = landlord_api.post(
            f"/api/v1/listings/{created.data['id']}/media/",
            {"file_id": str(identity_document.id), "is_cover": True},
            format="json",
        )

        assert refused.status_code == 422

    def test_active_marketing_photo_gets_a_short_lived_anonymous_url(
        self, landlord_api, landlord, unit_obj, listing_memory_storage
    ):
        from apps.files.models import FilePurpose, ScanStatus, StoredFile, UploadStatus

        created = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "headline": "Sunny flat",
                "description": "Reviewed and ready.",
            },
            format="json",
        )
        photo = StoredFile.objects.create(
            storage_key="property-photo/public-home.jpg",
            bucket="test",
            storage_backend="memory",
            original_filename="home.jpg",
            purpose=FilePurpose.PROPERTY_PHOTO,
            is_sensitive=False,
            upload_status=UploadStatus.READY,
            scan_status=ScanStatus.CLEAN,
            uploaded_by=landlord,
            owner_id_snapshot=str(landlord.id),
        )
        attached = landlord_api.post(
            f"/api/v1/listings/{created.data['id']}/media/",
            {"file_id": str(photo.id), "is_cover": True},
            format="json",
        )
        assert attached.status_code == 201
        landlord_api.post(f"/api/v1/listings/{created.data['id']}/publish/", format="json")

        detail = APIClient().get(f"/api/v1/listings/{created.data['id']}/")

        assert detail.status_code == 200
        assert detail.data["media"][0]["download_url"].startswith("memory://")

    def test_cannot_publish_without_required_fields(self, landlord_api, unit_obj):
        r = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                # No headline or description
            },
            format="json",
        )
        pub = landlord_api.post(f"/api/v1/listings/{r.data['id']}/publish/", format="json")
        assert pub.status_code == 422

    def test_two_live_listings_per_unit_are_rejected(self, landlord_api, unit_obj):
        def make():
            return landlord_api.post(
                "/api/v1/me/listings/",
                {
                    "unit_id": str(unit_obj.id),
                    "rent_minor": 150000,
                    "headline": "Flat",
                    "description": "Nice.",
                },
                format="json",
            )

        r1 = make()
        assert r1.status_code == 201
        r2 = make()
        assert r2.status_code == 409

    def test_total_move_in_is_calculated(self, landlord_api, unit_obj):
        r = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 100000,
                "advance_months": 6,
                "caution_months": 2,
                "agency_fee_months": 1,
                "headline": "Flat",
                "description": "Nice.",
            },
            format="json",
        )
        # 6 + 2 + 1 months = 9 x 100,000 = 900,000 pesewas
        assert r.data["total_move_in_minor"] == 900000

    def test_withdraw_removes_from_search(self, landlord_api, unit_obj):
        r = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "headline": "Active flat",
                "description": "Nice.",
            },
            format="json",
        )
        listing_id = r.data["id"]
        landlord_api.post(f"/api/v1/listings/{listing_id}/publish/", format="json")

        landlord_api.post(
            f"/api/v1/listings/{listing_id}/withdraw/", {"reason": "Rented offline"}, format="json"
        )

        anon = APIClient()
        detail = anon.get(f"/api/v1/listings/{listing_id}/")
        assert detail.status_code == 404

    def test_tenant_cannot_withdraw_landlords_listing(self, landlord_api, tenant_api, unit_obj):
        r = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "headline": "Flat",
                "description": "Nice.",
            },
            format="json",
        )
        listing_id = r.data["id"]
        landlord_api.post(f"/api/v1/listings/{listing_id}/publish/", format="json")
        response = tenant_api.post(
            f"/api/v1/listings/{listing_id}/withdraw/", {"reason": "not my flat"}, format="json"
        )
        assert response.status_code in (403, 404)


class TestListingSearch:
    def test_search_is_public(self):
        client = APIClient()
        response = client.get("/api/v1/listings/")
        assert response.status_code == 200

    def test_search_filters_by_locality(self, landlord_api, unit_obj):
        r = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "headline": "Osu flat",
                "description": "Nice.",
            },
            format="json",
        )
        landlord_api.post(f"/api/v1/listings/{r.data['id']}/publish/", format="json")

        client = APIClient()
        results_matching = client.get(
            "/api/v1/listings/", {"locality_id": str(unit_obj.property.address.locality_id)}
        )
        # A real locality id that no listing uses. Localities are keyed by
        # UUID like everything else, so an integer here is not "no match", it
        # is a malformed request.
        results_not_matching = client.get("/api/v1/listings/", {"locality_id": str(uuid4())})

        # Cursor pagination returns no count, deliberately - see
        # apps/core/pagination.py.
        assert len(results_matching.data["results"]) >= 1
        assert len(results_not_matching.data["results"]) == 0


class TestSavedListings:
    """The tenant shortlist. The model and the route both existed as references
    before the model itself did, so these cover the whole path."""

    def _published_listing(self, landlord_api, unit_obj):
        r = landlord_api.post(
            "/api/v1/me/listings/",
            {
                "unit_id": str(unit_obj.id),
                "rent_minor": 150000,
                "headline": "Osu flat",
                "description": "Nice.",
            },
            format="json",
        )
        listing_id = r.data["id"]
        landlord_api.post(f"/api/v1/listings/{listing_id}/publish/", format="json")
        return listing_id

    def test_a_tenant_can_save_and_list_a_listing(self, landlord_api, tenant_api, unit_obj):
        listing_id = self._published_listing(landlord_api, unit_obj)

        saved = tenant_api.post(
            "/api/v1/me/saved-listings/",
            {"listing_id": listing_id, "note": "ask about the water"},
            format="json",
        )
        assert saved.status_code == 201

        mine = tenant_api.get("/api/v1/me/saved-listings/")
        assert mine.status_code == 200
        assert [item["listing"]["id"] for item in mine.data] == [listing_id]
        assert mine.data[0]["note"] == "ask about the water"

    def test_saving_twice_does_not_duplicate(self, landlord_api, tenant_api, unit_obj):
        listing_id = self._published_listing(landlord_api, unit_obj)

        first = tenant_api.post(
            "/api/v1/me/saved-listings/", {"listing_id": listing_id}, format="json"
        )
        second = tenant_api.post(
            "/api/v1/me/saved-listings/", {"listing_id": listing_id}, format="json"
        )
        assert first.status_code == 201
        assert second.status_code == 200

        mine = tenant_api.get("/api/v1/me/saved-listings/")
        assert len(mine.data) == 1

    def test_a_tenant_can_unsave(self, landlord_api, tenant_api, unit_obj):
        listing_id = self._published_listing(landlord_api, unit_obj)
        tenant_api.post("/api/v1/me/saved-listings/", {"listing_id": listing_id}, format="json")

        removed = tenant_api.delete(
            "/api/v1/me/saved-listings/", {"listing_id": listing_id}, format="json"
        )
        assert removed.status_code == 204
        assert tenant_api.get("/api/v1/me/saved-listings/").data == []

    def test_one_tenant_cannot_see_anothers_shortlist(self, landlord_api, tenant_api, unit_obj):
        listing_id = self._published_listing(landlord_api, unit_obj)
        tenant_api.post("/api/v1/me/saved-listings/", {"listing_id": listing_id}, format="json")

        # The landlord has saved nothing, and must not see the tenant's note.
        assert landlord_api.get("/api/v1/me/saved-listings/").data == []

    def test_saving_requires_sign_in(self, landlord_api, unit_obj):
        listing_id = self._published_listing(landlord_api, unit_obj)
        anon = APIClient()
        response = anon.post(
            "/api/v1/me/saved-listings/", {"listing_id": listing_id}, format="json"
        )
        assert response.status_code in (401, 403)
