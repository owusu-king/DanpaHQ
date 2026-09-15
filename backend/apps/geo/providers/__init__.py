"""Location providers: where a typed place name becomes somewhere (ADR 0034).

Views ask `location_provider()` for suggestions and `provider_named()` to
resolve a choice with the provider that suggested it. This package is the only
place that knows a mapping company exists; everything it returns is Rooomly's
own shape, naming the provider and its reference as plain text.
"""

from __future__ import annotations

from django.conf import settings

from .base import (
    GeoBounds,
    GeoPoint,
    LocationProvider,
    LocationProviderError,
    PlaceKind,
    PlaceSuggestion,
    ResolvedPlace,
)
from .google import GooglePlacesProvider
from .localities import LocalityProvider

__all__ = [
    "GeoBounds",
    "GeoPoint",
    "GooglePlacesProvider",
    "LocalityProvider",
    "LocationProvider",
    "LocationProviderError",
    "PlaceKind",
    "PlaceSuggestion",
    "ResolvedPlace",
    "google_configured",
    "location_provider",
    "provider_named",
]

PROVIDER_NAMES = (GooglePlacesProvider.name, LocalityProvider.name)


def google_configured() -> bool:
    return settings.LOCATION_PROVIDER == "google" and bool(settings.GOOGLE_MAPS_SERVER_API_KEY)


def location_provider() -> LocationProvider:
    """Where suggestions come from: the configured provider, or the localities without one."""
    if google_configured():
        return GooglePlacesProvider.from_settings()
    return LocalityProvider()


def provider_named(name: str) -> LocationProvider | None:
    """The provider a suggestion came from, when it can still answer."""
    if name == LocalityProvider.name:
        return LocalityProvider()
    if name == GooglePlacesProvider.name and google_configured():
        return GooglePlacesProvider.from_settings()
    return None
