"""Local database lookups retained for existing clients; no external geocoder."""

from __future__ import annotations

from .base import (
    GeoBounds,
    GeoPoint,
    LocationProvider,
    LocationProviderError,
    PlaceKind,
    PlaceSuggestion,
    ResolvedPlace,
)
from .localities import LocalityProvider

__all__ = [
    "GeoBounds",
    "GeoPoint",
    "LocalityProvider",
    "LocationProvider",
    "LocationProviderError",
    "PlaceKind",
    "PlaceSuggestion",
    "ResolvedPlace",
    "location_provider",
    "provider_named",
]

PROVIDER_NAMES = (LocalityProvider.name,)


def location_provider() -> LocationProvider:
    """Suggestions come only from our localities database."""
    return LocalityProvider()


def provider_named(name: str) -> LocationProvider | None:
    """The provider a suggestion came from, when it can still answer."""
    if name == LocalityProvider.name:
        return LocalityProvider()
    return None
