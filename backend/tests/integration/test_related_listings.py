"""Related rentals remain relevant and obey the public listing boundary."""

import pytest
from rest_framework.test import APIClient

from apps.listing.models import Listing, ListingStatus
from apps.property.models import Property, PropertyType, Unit

pytestmark = pytest.mark.django_db


def _property(owner, locality, title):
    from apps.geo.models import Address

    return Property.objects.create(
        owner=owner,
        managed_by=owner,
        created_by=owner,
        title=title,
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street=f"{title} Road"),
    )


def _listing(owner, prop, *, headline, rent, status=ListingStatus.ACTIVE):
    unit = Unit.objects.create(
        property=prop,
        label=headline,
        space_type="apartment",
        bedrooms=2,
        bathrooms=1,
        is_furnished=False,
    )
    return Listing.objects.create(
        unit=unit,
        created_by=owner,
        headline=headline,
        description="A well-kept place to live.",
        rent_minor=rent,
        rent_currency="GHS",
        status=status,
        locality_id_cache=prop.address.locality_id,
        bedrooms_cache=2,
    )


def test_related_rentals_prioritize_location_then_affordability_and_hide_inactive(landlord):
    from apps.geo.models import District, Locality, Region

    region = Region.objects.create(name="Related Greater Accra", code="RGA")
    district = District.objects.create(region=region, name="Related Accra Metro")
    osu = Locality.objects.create(district=district, name="Related Osu")
    labone = Locality.objects.create(district=district, name="Related Labone")

    current = _listing(
        landlord,
        _property(landlord, osu, "Current home"),
        headline="Current rental",
        rent=200_000,
    )
    same_close = _listing(
        landlord,
        _property(landlord, osu, "Close home"),
        headline="Same area and close rent",
        rent=210_000,
    )
    same_expensive = _listing(
        landlord,
        _property(landlord, osu, "Expensive home"),
        headline="Same area but expensive",
        rent=500_000,
    )
    nearby_close = _listing(
        landlord,
        _property(landlord, labone, "Nearby home"),
        headline="Nearby and close rent",
        rent=200_000,
    )
    hidden = _listing(
        landlord,
        _property(landlord, osu, "Hidden home"),
        headline="Withdrawn exact match",
        rent=200_000,
        status=ListingStatus.WITHDRAWN,
    )

    response = APIClient().get(f"/api/v1/listings/{current.id}/related/")

    assert response.status_code == 200
    ids = [row["id"] for row in response.data]
    assert ids[:3] == [str(same_close.id), str(same_expensive.id), str(nearby_close.id)]
    assert str(current.id) not in ids
    assert str(hidden.id) not in ids
    assert len(ids) <= 4


def test_related_rentals_are_not_available_for_a_non_public_listing(landlord):
    from apps.geo.models import District, Locality, Region

    region = Region.objects.create(name="Draft region", code="DRF")
    district = District.objects.create(region=region, name="Draft district")
    locality = Locality.objects.create(district=district, name="Draft locality")
    draft = _listing(
        landlord,
        _property(landlord, locality, "Draft home"),
        headline="Draft rental",
        rent=150_000,
        status=ListingStatus.DRAFT,
    )

    response = APIClient().get(f"/api/v1/listings/{draft.id}/related/")

    assert response.status_code == 404
