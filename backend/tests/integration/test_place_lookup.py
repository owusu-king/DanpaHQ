"""Place lookup: suggestions, and the chosen place, through the location provider.

Three promises are pinned here (ADR 0034).

* **Rooomly calls the provider; clients never do.** The server key stays on the
  server, and every suggestion request is restricted to Ghana.
* **One session per search, Essentials fields only.** The session token a client
  sends reaches Google with each suggestion request and with the details request
  that closes the session, and details ask for nothing billed above Essentials.
* **No key, or a failing provider, is not a dead field.** Suggestions fall back to
  Rooomly's localities and say which provider answered; resolving a choice the
  provider made cannot be faked from the fallback.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
import requests
from rest_framework.test import APIClient

from apps.geo.models import District, Locality, Region
from apps.geo.providers import google as google_places

pytestmark = pytest.mark.django_db

SERVER_KEY = "test-server-key-not-real"

AUTOCOMPLETE = {
    "suggestions": [
        {
            "placePrediction": {
                "placeId": "ChIJeastlegon0001",
                "structuredFormat": {
                    "mainText": {"text": "East Legon"},
                    "secondaryText": {"text": "Accra, Ghana"},
                },
                "types": ["sublocality_level_1", "sublocality", "political"],
            }
        },
        {
            "placePrediction": {
                "placeId": "ChIJuniversity0002",
                "structuredFormat": {
                    "mainText": {"text": "University of Ghana"},
                    "secondaryText": {"text": "Legon, Accra, Ghana"},
                },
                "types": ["university", "point_of_interest", "establishment"],
            }
        },
        {"queryPrediction": {"text": {"text": "east legon hotels"}}},
    ]
}

DETAILS = {
    "id": "ChIJeastlegon0001",
    "location": {"latitude": 5.6356, "longitude": -0.1613},
    "viewport": {
        "low": {"latitude": 5.62, "longitude": -0.18},
        "high": {"latitude": 5.65, "longitude": -0.14},
    },
    "formattedAddress": "East Legon, Accra, Ghana",
    "types": ["sublocality", "political"],
}


class FakeResponse:
    def __init__(self, status_code: int, payload: Any):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def authed_api(user, sms, sign_in_as):
    client = APIClient()
    sign_in_as(client, user=user, device_fingerprint="web")
    return client


@pytest.fixture
def osu(db):
    region = Region.objects.create(name="Lookup Greater Accra", code="LGA")
    district = District.objects.create(region=region, name="Lookup Korle Klottey")
    return Locality.objects.create(
        district=district,
        name="Lookup Osu",
        aliases=["Oxford Street"],
        latitude="5.556",
        longitude="-0.182",
    )


@pytest.fixture
def google(settings, monkeypatch):
    """Google configured, with every HTTP call recorded and answered from a queue."""
    settings.LOCATION_PROVIDER = "google"
    settings.GOOGLE_MAPS_SERVER_API_KEY = SERVER_KEY
    settings.GOOGLE_PLACES_REGION_CODES = ["gh"]
    calls: list[dict[str, Any]] = []
    answers: list[Any] = []

    def request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(google_places.requests, "request", request)
    return {"calls": calls, "answers": answers}


@pytest.fixture
def no_key(settings, monkeypatch):
    settings.LOCATION_PROVIDER = "google"
    settings.GOOGLE_MAPS_SERVER_API_KEY = ""

    def request(*args, **kwargs):
        raise AssertionError("no provider may be called without a key")

    monkeypatch.setattr(google_places.requests, "request", request)


class TestGoogleSuggestions:
    def test_suggestions_are_ghana_only_and_carry_the_session(self, api, google):
        session = uuid.uuid4()
        google["answers"].append(FakeResponse(200, AUTOCOMPLETE))

        response = api.get(f"/api/v1/geo/places/suggest/?q=east leg&session={session}")

        assert response.status_code == 200
        (call,) = google["calls"]
        assert call["method"] == "POST"
        assert call["url"] == "https://places.googleapis.com/v1/places:autocomplete"
        assert call["json"]["input"] == "east leg"
        assert call["json"]["includedRegionCodes"] == ["gh"]
        assert call["json"]["sessionToken"] == str(session)
        assert call["headers"]["X-Goog-Api-Key"] == SERVER_KEY
        assert call["headers"]["X-Goog-FieldMask"] == google_places.SUGGESTION_FIELDS

        assert response.data["provider"] == "google"
        assert response.data["attribution"] == "google"
        assert response.data["suggestions"] == [
            {
                "provider": "google",
                "reference": "ChIJeastlegon0001",
                "name": "East Legon",
                "context": "Accra",
                "kind": "area",
            },
            {
                "provider": "google",
                "reference": "ChIJuniversity0002",
                "name": "University of Ghana",
                "context": "Legon, Accra",
                "kind": "landmark",
            },
        ]
        assert SERVER_KEY not in response.content.decode()
        assert response["Cache-Control"] == "no-store"

    def test_one_letter_asks_nobody(self, api, google):
        response = api.get("/api/v1/geo/places/suggest/?q=e")
        assert response.status_code == 200
        assert response.data["suggestions"] == []
        assert google["calls"] == []

    def test_a_session_must_be_a_uuid(self, api, google):
        response = api.get("/api/v1/geo/places/suggest/?q=osu&session=not-a-token")
        assert response.status_code == 422
        assert google["calls"] == []

    def test_an_unreachable_provider_falls_back_to_localities_and_says_so(self, api, google, osu):
        google["answers"].append(requests.ConnectionError("down"))

        response = api.get("/api/v1/geo/places/suggest/?q=lookup osu")

        assert response.status_code == 200
        assert response.data["provider"] == "rooomly"
        assert response.data["attribution"] is None
        assert [row["name"] for row in response.data["suggestions"]] == ["Lookup Osu"]

    def test_a_refused_key_falls_back_too(self, api, google, osu):
        google["answers"].append(
            FakeResponse(403, {"error": {"code": 403, "status": "PERMISSION_DENIED"}})
        )
        response = api.get("/api/v1/geo/places/suggest/?q=lookup osu")
        assert response.data["provider"] == "rooomly"


class TestGoogleResolve:
    def test_resolving_asks_for_essentials_fields_with_the_same_session(self, api, google):
        session = uuid.uuid4()
        google["answers"].append(FakeResponse(200, DETAILS))

        response = api.get(
            "/api/v1/geo/places/resolve/?provider=google&reference=ChIJeastlegon0001"
            f"&session={session}&name=East Legon, Accra"
        )

        assert response.status_code == 200
        (call,) = google["calls"]
        assert call["method"] == "GET"
        assert call["url"] == "https://places.googleapis.com/v1/places/ChIJeastlegon0001"
        assert call["headers"]["X-Goog-FieldMask"] == "id,location,viewport,formattedAddress,types"
        assert call["params"]["sessionToken"] == str(session)
        assert response.data == {
            "provider": "google",
            "reference": "ChIJeastlegon0001",
            "display_name": "East Legon, Accra",
            "kind": "area",
            "center": {"lat": 5.6356, "lng": -0.1613},
            "bounds": {"west": -0.18, "south": 5.62, "east": -0.14, "north": 5.65},
        }

    def test_an_unknown_place_is_not_found(self, api, google):
        google["answers"].append(FakeResponse(404, {"error": {"code": 404, "status": "NOT_FOUND"}}))
        response = api.get("/api/v1/geo/places/resolve/?provider=google&reference=ChIJmissing0000")
        assert response.status_code == 404
        assert response.data["error"]["code"] == "not_found"

    def test_an_unreachable_provider_is_unavailable_rather_than_missing(self, api, google):
        google["answers"].append(requests.Timeout("slow"))
        response = api.get(
            "/api/v1/geo/places/resolve/?provider=google&reference=ChIJeastlegon0001"
        )
        assert response.status_code == 503
        assert response.data["error"]["code"] != "not_found"


class TestWithoutAKey:
    def test_suggestions_come_from_localities_and_nobody_is_called(self, api, no_key, osu):
        response = api.get("/api/v1/geo/places/suggest/?q=oxford street")
        assert response.status_code == 200
        assert response.data["provider"] == "rooomly"
        assert response.data["attribution"] is None
        assert response.data["suggestions"][0]["reference"] == str(osu.id)

    def test_a_locality_resolves_to_a_box_around_its_centre(self, api, no_key, osu):
        place = api.get(f"/api/v1/geo/places/resolve/?provider=rooomly&reference={osu.id}").data
        assert place["center"] == {"lat": 5.556, "lng": -0.182}
        assert place["bounds"]["west"] < -0.182 < place["bounds"]["east"]
        assert place["bounds"]["south"] < 5.556 < place["bounds"]["north"]
        assert place["display_name"] == "Lookup Osu, Lookup Korle Klottey"

    def test_a_google_choice_cannot_be_resolved_without_google(self, api, no_key):
        response = api.get(
            "/api/v1/geo/places/resolve/?provider=google&reference=ChIJeastlegon0001"
        )
        assert response.status_code == 503

class TestPropertyLocationLookup:
    def test_area_scope_asks_google_for_regions_and_excludes_landmarks(self, api, google):
        session = uuid.uuid4()
        google["answers"].append(FakeResponse(200, AUTOCOMPLETE))

        response = api.get(
            f"/api/v1/geo/places/suggest/?q=east leg&session={session}&scope=areas"
        )

        assert response.status_code == 200
        assert google["calls"][0]["json"]["includedPrimaryTypes"] == ["(regions)"]
        assert [row["name"] for row in response.data["suggestions"]] == ["East Legon"]

    def test_a_provider_town_can_create_an_address_without_fabricating_a_locality(
        self, authed_api, google
    ):
        session = uuid.uuid4()
        google["answers"].append(FakeResponse(200, DETAILS))

        response = authed_api.post(
            "/api/v1/geo/addresses/",
            {
                "place": {
                    "provider": "google",
                    "reference": "ChIJeastlegon0001",
                    "session": str(session),
                    "name": "East Legon",
                    "context": "Accra",
                },
                "landmark": "Near the school",
            },
            format="json",
        )

        assert response.status_code == 201
        assert response.data["locality"] is None
        assert response.data["locality_name"] == "East Legon"
        assert response.data["district_name"] == "Accra"
        assert response.data["place_provider"] == "google"
        assert response.data["place_reference"] == "ChIJeastlegon0001"
        assert response.data["latitude"] is None
        assert response.data["longitude"] is None
        assert google["calls"][0]["params"]["sessionToken"] == str(session)

    def test_a_provider_place_outside_ghana_is_refused(self, authed_api, google):
        outside = {
            **DETAILS,
            "location": {"latitude": 51.5072, "longitude": -0.1276},
        }
        google["answers"].append(FakeResponse(200, outside))

        response = authed_api.post(
            "/api/v1/geo/addresses/",
            {
                "place": {
                    "provider": "google",
                    "reference": "ChIJeastlegon0001",
                    "name": "Not in Ghana",
                }
            },
            format="json",
        )

        assert response.status_code == 404
        assert (
            response.data["error"]["message"]
            == "That location is outside Rooomly's coverage area."
        )
