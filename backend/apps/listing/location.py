"""Public markers derive only from saved property coordinates.

Property pins use the existing approximately 300 m privacy grid. Legacy
properties may use their recorded locality centre, explicitly labelled as a
neighbourhood location. Unknown coordinates remain unmapped.
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
        max(-90, min(90, round((math.floor(latitude / cell) + 0.5) * cell, 6))),
        max(-180, min(180, round((math.floor(longitude / cell) + 0.5) * cell, 6))),
    )


def public_location_for(unit) -> tuple[Point | None, str]:
    """The public point for a unit's listing, and how precise that point is."""
    return public_location_for_property(unit.property)


def public_location_for_property(prop) -> tuple[Point | None, str]:
    """The public point for anything advertised at this property's address.

    A property for sale is advertised whole, so it takes the same snapped point a
    listing inside it would — one rule for how coarse a public marker is.
    """
    address = prop.address
    if (
        address.latitude is not None
        and address.longitude is not None
        and math.isfinite(float(address.latitude))
        and math.isfinite(float(address.longitude))
        and -90 <= address.latitude <= 90
        and -180 <= address.longitude <= 180
    ):
        latitude, longitude = snap_to_cell(float(address.latitude), float(address.longitude))
        return Point(longitude, latitude, srid=4326), LocationPrecision.AREA

    # Older verified properties cannot be edited to add a pin. Their actual
    # reference locality can still locate a neighbourhood-level marker without
    # claiming that this is the building's position or changing the property.
    locality = address.locality
    latitude = locality.latitude if locality else address.place_latitude
    longitude = locality.longitude if locality else address.place_longitude
    if (
        latitude is not None and longitude is not None
        and math.isfinite(float(latitude)) and math.isfinite(float(longitude))
        and -90 <= latitude <= 90 and -180 <= longitude <= 180
    ):
        return Point(float(longitude), float(latitude), srid=4326), LocationPrecision.LOCALITY
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
    """Recompute public points after property coordinate updates.

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


def refresh_public_sale_locations(sales=None) -> int:
    """Refresh the same derived privacy point on standalone sale records."""
    from apps.sale.models import SaleListing

    rows = (sales if sales is not None else SaleListing.objects.all()).select_related(
        "property__address"
    )
    updated = 0
    for sale in rows.iterator(chunk_size=500):
        point, precision = public_location_for_property(sale.property)
        if not _same_point(sale.public_point, point) or sale.public_point_precision != precision:
            SaleListing.objects.filter(pk=sale.pk).update(
                public_point=point,
                public_point_precision=precision,
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
