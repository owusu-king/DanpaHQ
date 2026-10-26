"""Google Places API (New): suggestions, and the place a tenant chooses.

Called only by Danpa HQ's API, with a server key that never reaches a client
(ADR 0034). Three rules keep the bill to what the product uses:

* **Ghana only.** Every autocomplete request names Ghana in `includedRegionCodes`.
* **One session per search.** A client sends a fresh UUID for each typing
  session and the same one when it resolves the choice, so Google prices the
  keystrokes and the details request as one session. A new search, a new token.
* **Essentials fields only.** Place Details asks for `id,location,viewport,
  formattedAddress,types`. `displayName` and `primaryType` would move every
  request to the Pro rate, and the name shown is already the suggestion the
  tenant chose.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import requests
from django.conf import settings

from .base import (
    GeoBounds,
    GeoPoint,
    LocationProviderError,
    PlaceKind,
    PlaceSuggestion,
    ResolvedPlace,
)

logger = logging.getLogger(__name__)

AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
DETAILS_URL = "https://places.googleapis.com/v1/places/{reference}"
#: What a suggestion list shows, and nothing else.
SUGGESTION_FIELDS = (
    "suggestions.placePrediction.placeId,"
    "suggestions.placePrediction.structuredFormat,"
    "suggestions.placePrediction.types"
)
#: Place Details Essentials. Adding a field billed above it is a pricing decision.
DETAILS_FIELDS = "id,location,viewport,formattedAddress,types"

_PLACE_ID = re.compile(r"[A-Za-z0-9_-]{8,300}")
_ADDRESS_TYPES = frozenset(
    {"street_address", "premise", "subpremise", "route", "street_number", "plus_code"}
)
_AREA_TYPES = frozenset(
    {
        "country",
        "administrative_area_level_1",
        "administrative_area_level_2",
        "administrative_area_level_3",
        "locality",
        "sublocality",
        "sublocality_level_1",
        "sublocality_level_2",
        "neighborhood",
        "colloquial_area",
        "postal_town",
    }
)
#: Half the side, in degrees, of the box around a place with no viewport: about 1 km.
_FALLBACK_HALF_SIDE = 0.009


def kind_of(types: list[str]) -> str:
    present = set(types)
    if present & _ADDRESS_TYPES:
        return PlaceKind.ADDRESS
    if present & _AREA_TYPES and "establishment" not in present:
        return PlaceKind.AREA
    return PlaceKind.LANDMARK


def without_country(text: str) -> str:
    """ "Accra, Ghana" reads as "Accra": every result is in Ghana."""
    parts = [part.strip() for part in text.split(",") if part.strip()]
    if parts and parts[-1].lower() == "ghana":
        parts = parts[:-1]
    return ", ".join(parts)


def _error_status(response: requests.Response) -> str:
    try:
        return str(response.json().get("error", {}).get("status", ""))
    except (ValueError, AttributeError):
        return ""


class GooglePlacesProvider:
    name = "google"
    attribution: str | None = "google"

    def __init__(
        self, *, api_key: str, region_codes: list[str], language: str, timeout: float
    ) -> None:
        self._api_key = api_key
        self._region_codes = region_codes
        self._language = language
        self._timeout = timeout

    @classmethod
    def from_settings(cls) -> GooglePlacesProvider:
        return cls(
            api_key=settings.GOOGLE_MAPS_SERVER_API_KEY,
            region_codes=list(settings.GOOGLE_PLACES_REGION_CODES),
            language=settings.GOOGLE_PLACES_LANGUAGE,
            timeout=settings.GOOGLE_PLACES_TIMEOUT_SECONDS,
        )

    def suggest(
        self,
        text: str,
        *,
        session: str | None,
        limit: int,
        areas_only: bool = False,
    ) -> list[PlaceSuggestion]:
        body: dict[str, Any] = {
            "input": text,
            "includedRegionCodes": self._region_codes,
            "languageCode": self._language,
        }
        if len(self._region_codes) == 1:
            body["regionCode"] = self._region_codes[0]
        if session:
            body["sessionToken"] = session
        if areas_only:
            # A property is filed under a town/neighbourhood, not a shop or a
            # street address. Google applies this before ranking the results.
            body["includedPrimaryTypes"] = ["(regions)"]
        payload = self._call("POST", AUTOCOMPLETE_URL, fields=SUGGESTION_FIELDS, json=body) or {}

        found: list[PlaceSuggestion] = []
        for item in payload.get("suggestions") or []:
            # Query predictions ("east legon hotels") are not places, and are not asked for.
            prediction = item.get("placePrediction") or {}
            structured = prediction.get("structuredFormat") or {}
            reference = prediction.get("placeId")
            name = ((structured.get("mainText") or {}).get("text") or "").strip()
            if not reference or not name:
                continue
            found.append(
                PlaceSuggestion(
                    provider=self.name,
                    reference=reference,
                    name=name,
                    context=without_country(
                        (structured.get("secondaryText") or {}).get("text") or ""
                    ),
                    kind=kind_of(prediction.get("types") or []),
                )
            )
        if areas_only:
            found = [place for place in found if place.kind == PlaceKind.AREA]
        return found[:limit]

    def resolve(
        self, reference: str, *, session: str | None, name_hint: str = ""
    ) -> ResolvedPlace | None:
        if not _PLACE_ID.fullmatch(reference):
            return None
        params = {"languageCode": self._language}
        if len(self._region_codes) == 1:
            params["regionCode"] = self._region_codes[0]
        if session:
            params["sessionToken"] = session
        payload = self._call(
            "GET",
            DETAILS_URL.format(reference=reference),
            fields=DETAILS_FIELDS,
            params=params,
            missing_is_none=True,
        )
        if not payload:
            return None
        location = payload.get("location") or {}
        if "latitude" not in location or "longitude" not in location:
            return None

        center = GeoPoint(float(location["latitude"]), float(location["longitude"]))
        viewport = payload.get("viewport") or {}
        low, high = viewport.get("low") or {}, viewport.get("high") or {}
        corners = {"latitude", "longitude"}
        if corners <= low.keys() and corners <= high.keys():
            bounds = GeoBounds(
                float(low["longitude"]),
                float(low["latitude"]),
                float(high["longitude"]),
                float(high["latitude"]),
            )
        else:
            bounds = GeoBounds.around(center, _FALLBACK_HALF_SIDE)

        display_name = (
            name_hint.strip()
            or without_country(payload.get("formattedAddress") or "")
            or "Chosen place"
        )
        return ResolvedPlace(
            provider=self.name,
            reference=str(payload.get("id") or reference),
            display_name=display_name[:160],
            kind=kind_of(payload.get("types") or []),
            center=center,
            bounds=bounds,
        )

    def _call(
        self,
        method: str,
        url: str,
        *,
        fields: str,
        json: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
        missing_is_none: bool = False,
    ) -> dict[str, Any] | None:
        try:
            response = requests.request(
                method,
                url,
                headers={"X-Goog-Api-Key": self._api_key, "X-Goog-FieldMask": fields},
                json=json,
                params=params,
                timeout=self._timeout,
            )
        except requests.RequestException as exc:
            logger.warning(
                "location_provider_unreachable",
                extra={"provider": self.name, "error": type(exc).__name__},
            )
            raise LocationProviderError("Google Places could not be reached.") from exc

        # An ID Google no longer knows, or one that was never an ID, is a missing place.
        if missing_is_none and response.status_code in (400, 404):
            logger.info(
                "location_provider_place_missing",
                extra={"provider": self.name, "status_code": response.status_code},
            )
            return None
        if response.status_code != 200:
            status = _error_status(response)
            logger.warning(
                "location_provider_refused",
                extra={
                    "provider": self.name,
                    "status_code": response.status_code,
                    "status": status,
                },
            )
            raise LocationProviderError(f"Google Places answered {response.status_code} {status}.")
        try:
            data = response.json()
        except ValueError as exc:
            raise LocationProviderError("Google Places did not answer with JSON.") from exc
        return data if isinstance(data, dict) else {}
