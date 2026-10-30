"""Pins are separate from written addresses and obey existing property ownership."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.geo.models import Address
from apps.property.models import Property, PropertyType

pytestmark = pytest.mark.django_db


@pytest.fixture
def draft(landlord, provider_standing):
    provider_standing(landlord)
    return Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title="Pin test",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(
            place_name="Bantama",
            place_context="Kumasi",
            street="12 Original Road",
            landmark="Original landmark",
        ),
    )


@pytest.fixture
def api(landlord, sms, sign_in_as):
    client = APIClient()
    sign_in_as(client, user=landlord, device_fingerprint="web")
    return client


def test_manual_address_creation_keeps_written_fields_and_coordinates(api):
    response = api.post(
        "/api/v1/geo/addresses/",
        {
            "place_name": "Bantama",
            "place_context": "Kumasi",
            "street": "12 Original Road",
            "latitude": "6.700123",
            "longitude": "-1.620456",
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    address = Address.objects.get(pk=response.data["id"])
    assert address.place_name == "Bantama" and address.place_context == "Kumasi"
    assert address.street == "12 Original Road"
    assert address.latitude == Decimal("6.700123") and address.longitude == Decimal("-1.620456")
    assert address.place_provider == ""


@pytest.mark.parametrize(
    "point",
    [
        {"latitude": 91, "longitude": 0},
        {"latitude": 0, "longitude": -181},
        {"latitude": 6},
        {"latitude": None, "longitude": -1},
    ],
)
def test_create_rejects_invalid_or_partial_coordinates(api, point):
    response = api.post("/api/v1/geo/addresses/", {"place_name": "Bantama", **point}, format="json")
    assert response.status_code == 422, response.data


def test_owner_can_move_and_clear_pin_without_changing_address(api, draft):
    response = api.patch(
        f"/api/v1/properties/{draft.id}/",
        {"location": {"latitude": 6.700123, "longitude": -1.620456}},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["address"]["latitude"] == "6.700123"
    draft.address.refresh_from_db()
    assert draft.address.street == "12 Original Road" and draft.address.place_context == "Kumasi"
    response = api.patch(
        f"/api/v1/properties/{draft.id}/",
        {"location": {"latitude": None, "longitude": None}},
        format="json",
    )
    assert response.status_code == 200
    draft.address.refresh_from_db()
    assert draft.address.latitude is None and draft.address.longitude is None


@pytest.mark.parametrize(
    "point",
    [{"latitude": 91, "longitude": 0}, {"latitude": 6}, {"latitude": None, "longitude": -1}],
)
def test_edit_rejects_invalid_coordinates_without_mutation(api, draft, point):
    response = api.patch(f"/api/v1/properties/{draft.id}/", {"location": point}, format="json")
    assert response.status_code == 422, response.data
    draft.address.refresh_from_db()
    assert draft.address.latitude is None


def test_another_provider_cannot_move_pin(draft, user, sms, sign_in_as):
    other = APIClient()
    sign_in_as(other, user=user, device_fingerprint="web")
    response = other.patch(
        f"/api/v1/properties/{draft.id}/",
        {"location": {"latitude": 6, "longitude": -1}},
        format="json",
    )
    assert response.status_code in {403, 404}
    draft.address.refresh_from_db()
    assert draft.address.latitude is None


def test_anonymous_user_cannot_move_pin(draft):
    response = APIClient().patch(
        f"/api/v1/properties/{draft.id}/",
        {"location": {"latitude": 6, "longitude": -1}},
        format="json",
    )
    assert response.status_code in {401, 403}


def test_shared_address_is_copied_before_moving_one_property(api, draft, landlord):
    original_address = draft.address
    other = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title="Other property",
        property_type=PropertyType.RESIDENTIAL,
        address=original_address,
    )
    response = api.patch(
        f"/api/v1/properties/{draft.id}/",
        {"location": {"latitude": 6.7, "longitude": -1.62}},
        format="json",
    )
    assert response.status_code == 200, response.data
    draft.refresh_from_db()
    other.refresh_from_db()
    original_address.refresh_from_db()
    assert draft.address_id != other.address_id
    assert original_address.latitude is None
    assert draft.address.street == original_address.street


def test_pin_edit_refreshes_rental_and_sale_markers_and_preserves_prices(api, draft, landlord):
    from apps.listing.location import snap_to_cell
    from apps.listing.models import Listing
    from apps.property.models import Unit
    from apps.sale.models import SaleListing

    unit = Unit.objects.create(
        property=draft, label="Ground floor", space_type="apartment", bedrooms=2, bathrooms=1
    )
    rental = Listing.objects.create(unit=unit, created_by=landlord, rent_minor=150_000)
    sale = SaleListing.objects.create(property=draft, created_by=landlord, price_minor=45_000_000)
    response = api.patch(
        f"/api/v1/properties/{draft.id}/",
        {"location": {"latitude": 6.700123, "longitude": -1.620456}},
        format="json",
    )
    assert response.status_code == 200, response.data
    rental.refresh_from_db()
    sale.refresh_from_db()
    expected_lat, expected_lng = snap_to_cell(6.700123, -1.620456)
    for record in (rental, sale):
        assert record.public_point.y == expected_lat
        assert record.public_point.x == expected_lng
    assert rental.rent_minor == 150_000 and sale.price_minor == 45_000_000

    response = api.patch(
        f"/api/v1/properties/{draft.id}/",
        {"location": {"latitude": None, "longitude": None}},
        format="json",
    )
    assert response.status_code == 200
    rental.refresh_from_db()
    sale.refresh_from_db()
    assert rental.public_point is None and sale.public_point is None


def test_a_pin_edit_does_not_move_a_shared_personal_address(api, draft, landlord):
    from apps.identity.models import Profile

    profile, _ = Profile.objects.update_or_create(
        user=landlord, defaults={"address": draft.address}
    )
    original_id = profile.address_id
    response = api.patch(
        f"/api/v1/properties/{draft.id}/",
        {"location": {"latitude": 6.7, "longitude": -1.62}},
        format="json",
    )
    assert response.status_code == 200, response.data
    draft.refresh_from_db()
    profile.refresh_from_db()
    assert profile.address_id == original_id and draft.address_id != original_id
    assert profile.address.latitude is None


@pytest.mark.parametrize("latitude,longitude", [(90, 180), (-90, -180)])
def test_privacy_grid_never_rounds_valid_boundary_coordinates_out_of_range(latitude, longitude):
    from apps.listing.location import snap_to_cell

    lat, lng = snap_to_cell(latitude, longitude)
    assert -90 <= lat <= 90 and -180 <= lng <= 180


def test_verified_property_cannot_add_move_or_clear_pin(api, draft, landlord, approve_provider):
    approve_provider(landlord, draft)
    before = draft.address_id
    for point in ({"latitude": 6.7, "longitude": -1.62}, {"latitude": None, "longitude": None}):
        response = api.patch(f"/api/v1/properties/{draft.id}/", {"location": point}, format="json")
        assert response.status_code in {403, 409}, response.data
        draft.refresh_from_db()
        assert draft.address_id == before
        assert draft.address.latitude is None
