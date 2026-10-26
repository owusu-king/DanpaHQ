"""Geography endpoints.

These exist because a landlord cannot create a property without an address id,
and before Phase 2 there was no way for any client to obtain one. That made the
whole publish journey impossible from the outside, which no backend test caught
because every one of them built its address in Python.
"""

from uuid import uuid4

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def accra(db):
    from apps.geo.models import District, Locality, Region

    region = Region.objects.create(name="Greater Accra", code="GA", capital="Accra")
    district = District.objects.create(region=region, name="Accra Metropolitan")
    osu = Locality.objects.create(district=district, name="Osu", aliases=["Oxford Street"])
    Locality.objects.create(district=district, name="Nima", aliases=["Kanda"])
    return region, district, osu


@pytest.fixture
def api(user, sms, sign_in_as):
    client = APIClient()
    sign_in_as(client, user=user, device_fingerprint="web")
    return client


class TestReferenceData:
    def test_regions_are_readable_without_signing_in(self, accra):
        """A tenant filtering a search has not necessarily got an account yet."""
        response = APIClient().get("/api/v1/geo/regions/")
        assert response.status_code == 200
        assert [r["name"] for r in response.data] == ["Greater Accra"]

    def test_districts_can_be_filtered_by_region(self, accra):
        region, _, _ = accra
        response = APIClient().get("/api/v1/geo/districts/", {"region": str(region.id)})
        assert response.status_code == 200
        assert response.data[0]["region_name"] == "Greater Accra"

    def test_localities_match_on_name(self, accra):
        response = APIClient().get("/api/v1/geo/localities/", {"q": "os"})
        assert [item["name"] for item in response.data] == ["Osu"]

    def test_localities_match_on_the_name_people_actually_use(self, accra):
        """Someone searching Kanda must find the place filed as Nima."""
        response = APIClient().get("/api/v1/geo/localities/", {"q": "Kanda"})
        assert [item["name"] for item in response.data] == ["Nima"]

    def test_a_locality_carries_its_district_and_region(self, accra):
        response = APIClient().get("/api/v1/geo/localities/", {"q": "Osu"})
        assert response.data[0]["district_name"] == "Accra Metropolitan"
        assert response.data[0]["region_name"] == "Greater Accra"


class TestCreatingAnAddress:
    def test_signing_in_is_required(self, accra):
        _, _, osu = accra
        response = APIClient().post(
            "/api/v1/geo/addresses/", {"locality_id": str(osu.id)}, format="json"
        )
        assert response.status_code in (401, 403)

    def test_a_locality_alone_is_enough(self, api, accra):
        """ "Osu" and nothing else is a real answer here, and a form that
        refuses it is a form people abandon."""
        _, _, osu = accra
        response = api.post("/api/v1/geo/addresses/", {"locality_id": str(osu.id)}, format="json")
        assert response.status_code == 201
        assert response.data["locality_name"] == "Osu"
        assert response.data["region_name"] == "Greater Accra"

    def test_a_landmark_is_kept_verbatim(self, api, accra):
        _, _, osu = accra
        landmark = "Second gate after the Total filling station"
        response = api.post(
            "/api/v1/geo/addresses/",
            {"locality_id": str(osu.id), "landmark": landmark},
            format="json",
        )
        assert response.data["landmark"] == landmark

    def test_a_digital_address_is_normalised(self, api, accra):
        _, _, osu = accra
        response = api.post(
            "/api/v1/geo/addresses/",
            {"locality_id": str(osu.id), "digital_address": "ga5430125"},
            format="json",
        )
        assert response.status_code == 201
        assert response.data["digital_address"] == "GA-543-0125"

    def test_a_malformed_digital_address_is_a_clear_error_not_a_crash(self, api, accra):
        _, _, osu = accra
        response = api.post(
            "/api/v1/geo/addresses/",
            {"locality_id": str(osu.id), "digital_address": "not-a-code"},
            format="json",
        )
        assert response.status_code == 422

    def test_an_unknown_locality_is_refused(self, api, accra):
        response = api.post("/api/v1/geo/addresses/", {"locality_id": str(uuid4())}, format="json")
        assert response.status_code == 422
