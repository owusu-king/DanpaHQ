"""Listing lifecycle, at the service layer.

The sibling file, test_listing_flow.py, drives the same domain through the HTTP
API. This one calls the services directly, so a rule can be tested where it is
enforced rather than through a serializer that might be masking it.
"""

import pytest

from apps.core.exceptions import Conflict, PermissionDenied, ValidationFailed
from apps.listing.models import ListingStatus

pytestmark = pytest.mark.django_db

JPEG_HEADER = b"\xff\xd8\xff\xe0" + b"\x00" * 60


@pytest.fixture(autouse=True)
def run_on_commit_inline(monkeypatch):
    """The scan that releases an uploaded photo is scheduled with on_commit,
    which pytest-django's uncommitted transaction would otherwise swallow."""
    from django.db import transaction

    monkeypatch.setattr(transaction, "on_commit", lambda func, using=None: func())


@pytest.fixture(autouse=True)
def memory_storage(settings):
    from apps.files.storage import get_storage, reset_storage

    settings.STORAGE_BACKEND = "memory"
    settings.FILE_SCAN_MODE = "permissive"
    reset_storage()
    yield get_storage()
    reset_storage()


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="East Legon")
    return Address.objects.create(locality=locality, landmark="Second gate after the Total")


@pytest.fixture
def landlord_with_property(landlord, address, approve_provider, approve_space):
    from apps.property.models import (
        CompoundType,
        PowerMeterType,
        Property,
        PropertyType,
        Unit,
        WaterSource,
    )

    prop = Property.objects.create(
        owner=landlord,
        address=address,
        title="East Legon block",
        property_type=PropertyType.RESIDENTIAL,
        water_source=WaterSource.ESTATE,
        power_meter_type=PowerMeterType.PREPAID,
        compound_type=CompoundType.SELF,
    )
    unit = Unit.objects.create(
        property=prop,
        label="Flat A",
        bedrooms=1,
        bathrooms=1,
        has_private_bathroom=True,
        has_private_kitchen=True,
    )
    approve_provider(landlord, prop)
    # Checked, because a space that cannot be advertised is not the subject of
    # most of these tests. The refusal has its own test below.
    approve_space(unit)
    return landlord, prop, unit


@pytest.fixture
def ready_photo(landlord, memory_storage):
    """A ready, scan-clean property photo in memory storage."""
    from apps.files import services as file_services

    stored, _ = file_services.reserve_upload(
        user=landlord,
        purpose="property_photo",
        filename="living-room.jpg",
        content_type="image/jpeg",
        size_bytes=100_000,
    )
    memory_storage.write(key=stored.storage_key, data=JPEG_HEADER + b"\x00" * 10000)
    completed = file_services.complete_upload(user=landlord, file_id=stored.id)
    completed.refresh_from_db()
    return completed


def _draft(user, unit, **overrides):
    from apps.listing import services

    data = {
        "rent_minor": 150000,
        "rent_currency": "GHS",
        "advance_months": 2,
        "headline": "Chamber and hall in East Legon",
        "description": "Self-contained, prepaid meter, borehole water.",
    }
    data.update(overrides)
    return services.create_listing(user=user, unit=unit, data=data)


class TestCreateListing:
    def test_landlord_can_create_a_draft(self, landlord_with_property):
        landlord, _, unit = landlord_with_property
        listing = _draft(landlord, unit)

        assert listing.status == ListingStatus.DRAFT
        assert listing.rent_minor == 150000
        assert listing.rent_currency == "GHS"

    def test_the_locality_is_cached_for_search(self, landlord_with_property):
        """Search filters on the cached id rather than joining through three
        tables, so it has to be populated at creation."""
        landlord, prop, unit = landlord_with_property
        listing = _draft(landlord, unit)

        assert listing.locality_id_cache == prop.address.locality_id
        assert listing.bedrooms_cache == unit.bedrooms

    def test_tenant_cannot_create_a_listing(self, user, landlord_with_property):
        _, _, unit = landlord_with_property
        with pytest.raises(PermissionDenied):
            _draft(user, unit)

    def test_rent_is_required(self, landlord_with_property):
        landlord, _, unit = landlord_with_property
        with pytest.raises(ValidationFailed):
            _draft(landlord, unit, rent_minor=None)


class TestPublishListing:
    # Note: publishing does NOT currently require a photo, though
    # docs/phase-2-report.md says it does. Left as it is rather than changed
    # under the cover of a bug fix - see the note in that report.

    def test_publishing_with_a_photo_succeeds(self, landlord_with_property, ready_photo):
        from apps.listing import services

        landlord, _, unit = landlord_with_property
        listing = _draft(landlord, unit)
        services.attach_listing_media(
            listing=listing, user=landlord, file=ready_photo, is_cover=True
        )

        published = services.publish_listing(listing=listing, user=landlord)
        assert published.status == ListingStatus.ACTIVE

    def test_publishing_without_a_headline_is_refused(self, landlord_with_property, ready_photo):
        from apps.listing import services

        landlord, _, unit = landlord_with_property
        listing = _draft(landlord, unit, headline="")
        services.attach_listing_media(listing=listing, user=landlord, file=ready_photo)

        with pytest.raises(ValidationFailed, match="headline"):
            services.publish_listing(listing=listing, user=landlord)

    def test_publishing_an_unchecked_space_is_refused(
        self, landlord, address, approve_provider, ready_photo
    ):
        """The gate the architecture states, enforced where it is claimed.

        `trust.gates.can_publish` has always refused this. `publish_listing`
        never asked it, so the rule existed only as a paragraph — an unchecked
        room could be advertised and merely queued behind a moderator.
        """
        from apps.listing import services
        from apps.property.models import Property, PropertyType, Unit

        prop = Property.objects.create(
            owner=landlord,
            address=address,
            title="Unchecked block",
            property_type=PropertyType.RESIDENTIAL,
        )
        approve_provider(landlord, prop)
        unit = Unit.objects.create(
            property=prop, label="Flat B", space_type="apartment", bedrooms=1, bathrooms=1
        )
        listing = _draft(landlord, unit)

        with pytest.raises(Conflict) as raised:
            services.publish_listing(listing=listing, user=landlord)

        assert "space" in str(raised.value).lower()
        listing.refresh_from_db()
        assert listing.status == ListingStatus.DRAFT

    def test_one_unit_can_only_have_one_live_listing(self, landlord_with_property):
        landlord, _, unit = landlord_with_property
        _draft(landlord, unit)

        with pytest.raises(Conflict):
            _draft(landlord, unit)


class TestWithdraw:
    def test_withdrawing_frees_the_unit_for_a_new_listing(
        self, landlord_with_property, ready_photo
    ):
        """The constraint is on *live* listings. A withdrawn one must not keep
        the unit hostage - that is how a landlord ends up unable to re-let."""
        from apps.listing import services

        landlord, _, unit = landlord_with_property
        first = _draft(landlord, unit)
        services.attach_listing_media(listing=first, user=landlord, file=ready_photo)
        services.publish_listing(listing=first, user=landlord)
        services.withdraw_listing(listing=first, user=landlord, reason="Rented directly")

        first.refresh_from_db()
        assert first.status == ListingStatus.WITHDRAWN

        second = _draft(landlord, unit)
        assert second.status == ListingStatus.DRAFT

    def test_a_stranger_cannot_withdraw_someone_elses_listing(self, user, landlord_with_property):
        from apps.listing import services

        landlord, _, unit = landlord_with_property
        listing = _draft(landlord, unit)

        with pytest.raises(PermissionDenied):
            services.withdraw_listing(listing=listing, user=user, reason="")


class TestMoveInCost:
    def test_total_move_in_adds_advance_deposit_and_agency_fee(self, landlord_with_property):
        """The number a tenant actually has to raise on day one. Getting this
        wrong wastes a viewing and a trotro fare."""
        landlord, _, unit = landlord_with_property
        listing = _draft(
            landlord,
            unit,
            rent_minor=120000,
            advance_months=12,
            caution_months=1,
            agency_fee_months=1,
        )

        assert listing.total_move_in_minor == 120000 * 14
