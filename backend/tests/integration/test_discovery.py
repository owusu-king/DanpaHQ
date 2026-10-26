"""Discovery, and the axes staying honest underneath it.

Two things here. The first is a regression test for a defect P4 introduced and
P5 found: a queryset `.update()` writing `status` bypassed `save()`, so the
axes never moved, and the next save would have derived the old status back —
putting a let property into public search.

The second is that discovery can find what P1 made expressible. A student
looking for a hostel bed could not search for one, because the only type filter
was on the *building*.
"""

import pytest
from rest_framework.test import APIClient

from apps.listing.models import ListingStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


def _listing(landlord, approve_provider, *, space_type, label="Main", active=True):
    from apps.geo.models import Address, District, Locality, Region
    from apps.listing.models import Listing
    from apps.property.models import (
        Property,
        PropertyRelationship,
        PropertyRelationshipType,
        PropertyType,
        Unit,
    )

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Adentan Municipal"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="Adenta"
    )
    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title=f"{space_type} property",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street=f"{label} Road"),
    )
    PropertyRelationship.objects.create(
        property=prop,
        user=landlord,
        relationship_type=PropertyRelationshipType.OWNER,
        granted_by=landlord,
    )
    approve_provider(landlord, prop)
    unit = Unit.objects.create(
        property=prop,
        label=label,
        bedrooms=1,
        bathrooms=1,
        space_type=space_type,
    )
    return Listing.objects.create(
        unit=unit,
        created_by=landlord,
        headline=f"A {space_type} to let",
        description="Somewhere to live.",
        rent_minor=100000,
        rent_currency="GHS",
        status=ListingStatus.ACTIVE if active else ListingStatus.DRAFT,
    )


class TestAxesSurviveBulkWrites:
    """The P4 defect, found by P5."""

    def test_marking_a_listing_rented_moves_the_availability_axis(self, landlord, approve_provider):
        from apps.listing.models import Listing

        listing = _listing(landlord, approve_provider, space_type="apartment")

        Listing.objects.filter(id=listing.id).update(status=ListingStatus.RENTED)
        listing.refresh_from_db()

        assert listing.status == ListingStatus.RENTED
        assert listing.availability_state == "taken"
        # The real danger: a stale axis would derive back to `active` on the
        # next save and quietly return a let property to public search.
        assert listing.derived_status() == ListingStatus.RENTED

    def test_a_rented_listing_stays_rented_after_an_unrelated_save(
        self, landlord, approve_provider
    ):
        from apps.listing.models import Listing

        listing = _listing(landlord, approve_provider, space_type="apartment")
        Listing.objects.filter(id=listing.id).update(status=ListingStatus.RENTED)

        listing.refresh_from_db()
        listing.headline = "Edited for some other reason"
        listing.save(update_fields=["headline", "updated_at"])
        listing.refresh_from_db()

        assert listing.status == ListingStatus.RENTED, "a let property came back to market"

    def test_an_explicit_axis_write_is_not_overridden(self, landlord, approve_provider):
        """A caller setting both is trusted; the translation is only a fallback."""
        from apps.listing.models import Listing

        listing = _listing(landlord, approve_provider, space_type="apartment")

        Listing.objects.filter(id=listing.id).update(
            status=ListingStatus.RENTED, availability_state="expired"
        )
        listing.refresh_from_db()

        assert listing.availability_state == "expired"


class TestSpaceTypeDiscovery:
    def test_a_bed_space_can_be_searched_for(self, api, landlord, approve_provider):
        _listing(landlord, approve_provider, space_type="bed_space", label="Bed 1")
        _listing(landlord, approve_provider, space_type="apartment", label="Flat 2")

        response = api.get("/api/v1/listings/?space_type=bed_space")

        assert response.status_code == 200
        results = response.data.get("results", response.data)
        assert len(results) == 1
        assert results[0]["space_type"] == "bed_space"

    def test_the_space_type_is_on_the_result(self, api, landlord, approve_provider):
        """A card has to be able to say what is being let."""
        _listing(landlord, approve_provider, space_type="room", label="Room 3")

        response = api.get("/api/v1/listings/")
        results = response.data.get("results", response.data)

        assert any(row.get("space_type") == "room" for row in results)

    def test_searching_without_the_filter_returns_everything(self, api, landlord, approve_provider):
        _listing(landlord, approve_provider, space_type="bed_space", label="Bed A")
        _listing(landlord, approve_provider, space_type="shop", label="Shop B")

        response = api.get("/api/v1/listings/")
        results = response.data.get("results", response.data)

        assert len(results) >= 2

    def test_only_active_listings_are_discoverable(self, api, landlord, approve_provider):
        _listing(landlord, approve_provider, space_type="room", label="Draft", active=False)

        response = api.get("/api/v1/listings/?space_type=room")
        results = response.data.get("results", response.data)

        assert results == []
