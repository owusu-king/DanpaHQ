"""Danpa HQ's own neighbourhoods as places: the provider that needs no key.

Used when no external provider is configured — development without a key, a
test run — and for a request whose configured provider has just failed. It knows
far less than a mapping service, only the localities operations maintain and
only those with a centre, but a location field that still finds "Osu" is better
than one that has gone dark.
"""

from __future__ import annotations

import uuid

from apps.geo.models import Locality

from .base import GeoBounds, GeoPoint, PlaceKind, PlaceSuggestion, ResolvedPlace

#: Half the side, in degrees, of the box drawn around a neighbourhood centre: about 1.5 km.
HALF_SIDE = 0.0135


def _context(locality: Locality) -> str:
    district, region = locality.district_label, locality.region_label
    return ", ".join(dict.fromkeys(value for value in (district, region) if value))


class LocalityProvider:
    name = "danpahq"
    attribution: str | None = None

    def suggest(
        self,
        text: str,
        *,
        session: str | None,
        limit: int,
        areas_only: bool = False,
    ) -> list[PlaceSuggestion]:
        query = text.strip()
        if len(query) < 2:
            return []
        from apps.geo.search import search_localities

        candidates = search_localities(query)
        if not areas_only:
            # Explore must be able to resolve every suggestion onto its map.
            candidates = candidates.filter(latitude__isnull=False, longitude__isnull=False)
        rows = candidates[:limit]
        return [
            PlaceSuggestion(
                provider=self.name,
                reference=str(row.id),
                name=row.name,
                context=_context(row),
                kind=PlaceKind.AREA,
            )
            for row in rows
        ]

    def resolve(
        self, reference: str, *, session: str | None, name_hint: str = ""
    ) -> ResolvedPlace | None:
        try:
            locality_id = uuid.UUID(reference)
        except ValueError:
            return None
        row = (
            Locality.objects.filter(id=locality_id, is_active=True)
            .select_related("district__region", "region")
            .first()
        )
        if row is None or row.latitude is None or row.longitude is None:
            return None
        center = GeoPoint(float(row.latitude), float(row.longitude))
        display_name = name_hint.strip() or ", ".join(filter(None, [row.name, _context(row)]))
        return ResolvedPlace(
            provider=self.name,
            reference=str(row.id),
            display_name=display_name[:160],
            kind=PlaceKind.AREA,
            center=center,
            bounds=GeoBounds.around(center, HALF_SIDE),
        )
