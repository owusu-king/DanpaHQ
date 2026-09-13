"""Where a listing may be shown on a public map.

Never where it is. ADR 0022 releases the street, the house number and the
coordinates only through a confirmed viewing, and a map marker *is* a
coordinate — so the point published here is derived, stable and coarse
(ADR 0033):

* **area** — the property's own coordinates snapped to the centre of a fixed
  grid cell about 300 m across. Stable, so repeated reads cannot be averaged
  towards the door; coarse, so the marker says "around here" and no more.
* **locality** — the neighbourhood's centre, while the property has no
  coordinates of its own. Every such listing in a neighbourhood shares the one
  point, which the map draws as a stack.

A listing with neither has no public point. It still appears in results; the
map reports how many it could not place rather than inventing a position.
"""

from __future__ import annotations

import math

from django.conf import settings
from django.contrib.gis.geos import Point

from .models import Listing, LocationPrecision

#: What each precision means as a radius, for a client drawing "somewhere in here".
PRECISION_RADIUS_M: dict[str, int] = {
    LocationPrecision.AREA: 300,
    LocationPrecision.LOCALITY: 1500,
}


def snap_to_cell(latitude: float, longitude: float) -> tuple[float, float]:
    """The centre of the fixed grid cell a coordinate falls in."""
    cell = settings.LISTING_PUBLIC_CELL_DEGREES
    return (
        round((math.floor(latitude / cell) + 0.5) * cell, 6),
        round((math.floor(longitude / cell) + 0.5) * cell, 6),
    )


def public_location_for(unit) -> tuple[Point | None, str]:
    """The public point for a unit's listing, and how precise that point is."""
    address = unit.property.address
    if address.latitude is not None and address.longitude is not None:
        latitude, longitude = snap_to_cell(float(address.latitude), float(address.longitude))
        return Point(longitude, latitude, srid=4326), LocationPrecision.AREA

    locality = address.locality
    if locality.latitude is not None and locality.longitude is not None:
        point = Point(float(locality.longitude), float(locality.latitude), srid=4326)
        return point, LocationPrecision.LOCALITY

    return None, ""


def _same_point(current: Point | None, proposed: Point | None) -> bool:
    if current is None or proposed is None:
        return current is proposed
    return abs(current.x - proposed.x) < 1e-7 and abs(current.y - proposed.y) < 1e-7


def apply_public_location(listing: Listing) -> list[str]:
    """Set a listing's public point from its unit; return the fields that changed."""
    point, precision = public_location_for(listing.unit)
    changed = []
    if not _same_point(listing.public_point, point):
        listing.public_point = point
        changed.append("public_point")
    if listing.public_point_precision != precision:
        listing.public_point_precision = precision
        changed.append("public_point_precision")
    return changed


def refresh_public_locations(listings=None) -> int:
    """Recompute public points, e.g. after a places import set locality centres.

    A queryset update rather than `save()`: the point is derived data, so it
    must not move `updated_at` or run the status derivation a save performs.
    """
    rows = (listings if listings is not None else Listing.objects.all()).select_related(
        "unit__property__address__locality"
    )
    updated = 0
    for listing in rows.iterator(chunk_size=500):
        if apply_public_location(listing):
            Listing.objects.filter(pk=listing.pk).update(
                public_point=listing.public_point,
                public_point_precision=listing.public_point_precision,
            )
            updated += 1
    return updated


def public_location_payload(listing: Listing) -> dict | None:
    point = listing.public_point
    if point is None:
        return None
    return {
        "latitude": round(point.y, 6),
        "longitude": round(point.x, 6),
        "precision": listing.public_point_precision,
        "radius_m": PRECISION_RADIUS_M.get(listing.public_point_precision, 1500),
    }
