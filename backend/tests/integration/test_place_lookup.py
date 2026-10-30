"""Legacy locality lookup stays local even if old Google settings remain deployed."""

from io import StringIO

import pytest
import requests
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.geo.models import Address, District, Locality, Region

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def no_external_geocoding(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Property location workflows must not make HTTP requests")

    monkeypatch.setattr(requests.sessions.Session, "request", forbidden)


@pytest.fixture
def osu():
    region = Region.objects.create(name="Lookup Greater Accra", code="LGA")
    district = District.objects.create(region=region, name="Lookup Korle Klottey")
    return Locality.objects.create(
        district=district,
        name="Lookup Osu",
        aliases=["Oxford Street"],
        latitude="5.556",
        longitude="-0.182",
    )


def test_suggestions_remain_local_with_legacy_google_configuration(settings, osu):
    settings.LOCATION_PROVIDER = "google"
    settings.GOOGLE_MAPS_SERVER_API_KEY = "obsolete-key-must-not-be-used"
    response = APIClient().get("/api/v1/geo/places/suggest/?q=oxford street")
    assert response.status_code == 200
    assert response.data["provider"] == "danpahq"
    assert response.data["attribution"] is None
    assert response.data["suggestions"][0]["reference"] == str(osu.id)


def test_a_locality_resolves_from_the_database(osu):
    response = APIClient().get(f"/api/v1/geo/places/resolve/?provider=danpahq&reference={osu.id}")
    assert response.status_code == 200
    assert response.data["center"] == {"lat": 5.556, "lng": -0.182}
    assert response.data["bounds"]["west"] < -0.182 < response.data["bounds"]["east"]


def test_google_choices_are_rejected_without_external_calls():
    response = APIClient().get("/api/v1/geo/places/resolve/?provider=google&reference=legacy")
    assert response.status_code == 422


def test_refresh_never_geocodes_or_fills_missing_coordinates():
    address = Address.objects.create(
        place_name="East Legon", place_provider="google", place_reference="legacy"
    )
    call_command("refresh_listing_locations", stdout=StringIO())
    address.refresh_from_db()
    assert address.latitude is None and address.longitude is None
    assert address.place_latitude is None and address.place_longitude is None
