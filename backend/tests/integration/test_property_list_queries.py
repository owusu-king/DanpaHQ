"""The Property collection is a prepared read, not N detail reads."""

from __future__ import annotations

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def portfolio(landlord):
    from apps.organization.models import (
        MembershipRole,
        Organization,
        OrganizationMembership,
    )

    organization = Organization.objects.create(
        name="Query Count Portfolio",
        created_by=landlord,
    )
    OrganizationMembership.objects.create(
        organization=organization,
        user=landlord,
        role=MembershipRole.OWNER,
        joined_at=timezone.now(),
    )
    return organization


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region = Region.objects.create(code="QC", name="Query Count Region")
    district = District.objects.create(region=region, name="Query Count District")
    locality = Locality.objects.create(district=district, name="Query Count Locality")
    return Address.objects.create(locality=locality, street="1 Constant Lane")


@pytest.fixture
def amenity(db):
    from apps.property.models import Amenity, AmenityCategory, AmenityScope

    return Amenity.objects.create(
        name="Query Count Borehole",
        category=AmenityCategory.WATER,
        scope=AmenityScope.PROPERTY,
    )


def _add_property(*, index, landlord, portfolio, address, amenity):
    from apps.listing.models import Listing
    from apps.organization.models import (
        OrganizationPropertyRelationship,
        OrganizationPropertyRole,
    )
    from apps.property.models import (
        Bed,
        Property,
        PropertyAmenity,
        PropertyRelationship,
        PropertyRelationshipType,
        PropertyType,
        Unit,
    )
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title=f"Constant Court {index}",
        property_type=PropertyType.HOSTEL,
        address=address,
    )
    authority = Verification.objects.create(
        subject_type=SubjectType.PROPERTY,
        subject_id=str(prop.id),
        kind=VerificationKind.PROPERTY_AUTHORITY,
        status=VerificationStatus.APPROVED,
        method=VerificationMethod.DOCUMENT_REVIEW,
        submitted_by=landlord,
        decided_at=timezone.now(),
    )
    PropertyRelationship.objects.create(
        property=prop,
        user=landlord,
        relationship_type=PropertyRelationshipType.OWNER,
        authority_verification_id=authority.id,
        authority_verified_at=timezone.now(),
    )
    OrganizationPropertyRelationship.objects.create(
        organization=portfolio,
        property=prop,
        relationship_type=OrganizationPropertyRole.OWNER,
        authority_verification_id=authority.id,
        authority_verified_at=timezone.now(),
    )
    PropertyAmenity.objects.create(property=prop, amenity=amenity)
    unit = Unit.objects.create(
        property=prop,
        label=f"Room {index}",
        space_type="room",
        bedrooms=1,
        bathrooms=1,
    )
    Bed.objects.create(unit=unit, label=f"Bed {index}")
    Listing.objects.create(
        unit=unit,
        created_by=landlord,
        headline=f"Room {index} listing",
        description="A draft used to exercise policy blockers.",
        rent_minor=100_000,
        advance_months=6,
    )
    return prop


def _captured_get(api, path):
    with CaptureQueriesContext(connection) as captured:
        response = api.get(path)
    assert response.status_code == 200, response.data
    return response, len(captured)


def test_property_lists_are_constant_cost_as_the_portfolio_grows(
    landlord,
    portfolio,
    address,
    amenity,
    sign_in_as,
):
    """Protect both clients: web uses /properties and mobile uses the org path."""
    api = APIClient()
    sign_in_as(api, user=landlord)

    _add_property(
        index=1,
        landlord=landlord,
        portfolio=portfolio,
        address=address,
        amenity=amenity,
    )
    web_one, web_one_queries = _captured_get(api, "/api/v1/properties/")
    mobile_path = f"/api/v1/organizations/{portfolio.id}/properties/"
    mobile_one, mobile_one_queries = _captured_get(api, mobile_path)

    for index in range(2, 6):
        _add_property(
            index=index,
            landlord=landlord,
            portfolio=portfolio,
            address=address,
            amenity=amenity,
        )

    web_many, web_many_queries = _captured_get(api, "/api/v1/properties/")
    mobile_many, mobile_many_queries = _captured_get(api, mobile_path)

    assert len(web_one.data) == len(mobile_one.data) == 1
    assert len(web_many.data) == len(mobile_many.data) == 5
    assert web_many_queries <= web_one_queries + 1
    assert mobile_many_queries <= mobile_one_queries + 1
    # A generous ceiling catches accidental loss of the prepared read while
    # leaving authentication/middleware free to add a fixed query later.
    assert web_many_queries <= 20
    assert mobile_many_queries <= 22


def test_prepared_collection_preserves_the_detail_serializer_payload(
    landlord,
    portfolio,
    address,
    amenity,
):
    from apps.core.memo import memoized
    from apps.property.models import Property
    from apps.property.serializers import PropertySerializer

    for index in range(1, 4):
        _add_property(
            index=index,
            landlord=landlord,
            portfolio=portfolio,
            address=address,
            amenity=amenity,
        )

    queryset = Property.objects.order_by("id")
    # A concrete list takes the old detail path; a QuerySet takes the prepared
    # collection path. Their public contract must be byte-for-byte equivalent.
    with memoized():
        detail_payload = PropertySerializer(
            list(queryset), many=True, context={"user": landlord}
        ).data
    prepared_payload = PropertySerializer(queryset, many=True, context={"user": landlord}).data

    assert prepared_payload == detail_payload
