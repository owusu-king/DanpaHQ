"""What every location provider answers with (ADR 0034).

Danpa HQ never keeps a mapping company's shape. A suggestion and a resolved place
carry the provider's name and the provider's own reference as plain strings,
beside what Danpa HQ means by a place: a name to show, a kind, a centre and a box
a map can fit. Nothing outside this package knows which company answered, so
replacing one is a change here and nowhere that stores or searches.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class PlaceKind:
    """What sort of somewhere a result is, in the terms the location field shows."""

    AREA = "area"
    LANDMARK = "landmark"
    ADDRESS = "address"


class LocationProviderError(Exception):
    """The provider could not answer: unreachable, refusing, or making no sense.

    Never the tenant's mistake, and never shown as one.
    """


@dataclass(frozen=True)
class GeoPoint:
    lat: float
    lng: float

    def as_dict(self) -> dict[str, float]:
        return {"lat": round(self.lat, 6), "lng": round(self.lng, 6)}


@dataclass(frozen=True)
class GeoBounds:
    west: float
    south: float
    east: float
    north: float

    @classmethod
    def around(cls, center: GeoPoint, half_side: float) -> GeoBounds:
        return cls(
            center.lng - half_side,
            center.lat - half_side,
            center.lng + half_side,
            center.lat + half_side,
        )

    def as_dict(self) -> dict[str, float]:
        return {
            "west": round(self.west, 6),
            "south": round(self.south, 6),
            "east": round(self.east, 6),
            "north": round(self.north, 6),
        }


@dataclass(frozen=True)
class PlaceSuggestion:
    """One line of the location field's list: enough to show and to resolve."""

    provider: str
    reference: str
    #: "East Legon"
    name: str
    #: The larger place it is read against: "Accra".
    context: str
    kind: str


@dataclass(frozen=True)
class ResolvedPlace:
    """A chosen suggestion, located: what a map fits and a search searches."""

    provider: str
    reference: str
    display_name: str
    kind: str
    center: GeoPoint
    bounds: GeoBounds


class LocationProvider(Protocol):
    #: Sent to clients as `provider`: "google", "danpahq".
    name: str
    #: Whose attribution a client must show beside these results, if anyone's.
    attribution: str | None

    def suggest(
        self,
        text: str,
        *,
        session: str | None,
        limit: int,
        areas_only: bool = False,
    ) -> list[PlaceSuggestion]: ...

    def resolve(
        self, reference: str, *, session: str | None, name_hint: str = ""
    ) -> ResolvedPlace | None: ...
