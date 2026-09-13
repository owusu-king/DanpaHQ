"""One rental search, for the results list and the map alike.

The cards and the price markers are two views of one query. If each built its
own filters, the first filter added to one and not the other would put the two
out of step — cards describing one set of rentals, markers another — so both
call `filtered_listings`, and the only difference between them is what they do
with the rows.

Public eligibility is not decided here either: everything starts from
`read_models.public_listings()`, the one definition of "a tenant may act on
this".

The geographic part of a search is an *area*: an explicit box the map sent
("Search this area"), or a place somebody chose. A place's area also includes
listings *filed* under its Rooomly locality, because filing is authoritative
and a public point is only an approximation of it.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from django.conf import settings
from django.contrib.gis.db.models.aggregates import Extent
from django.contrib.gis.geos import Polygon
from django.db import connection
from django.db.models import Count, Q, QuerySet

from apps.core.exceptions import NotFound
from apps.geo.models import Place

from . import read_models
from .models import Listing

#: The most markers one map response carries. Past this the grid gets coarser
#: in effect, because the densest cells are returned first.
MAX_FEATURES = 400
#: How many listing ids a stack of identical points carries for its preview.
STACK_IDS = 20
#: Roughly the width of one price marker, in screen pixels at the requested zoom.
CELL_PIXELS = 88


@dataclass(frozen=True)
class Bounds:
    west: float
    south: float
    east: float
    north: float

    def polygon(self) -> Polygon:
        box = Polygon.from_bbox((self.west, self.south, self.east, self.north))
        box.srid = 4326
        return box

    def intersection(self, other: Bounds) -> Bounds | None:
        west, east = max(self.west, other.west), min(self.east, other.east)
        south, north = max(self.south, other.south), min(self.north, other.north)
        if west >= east or south >= north:
            return None
        return Bounds(west, south, east, north)

    def as_dict(self) -> dict:
        return {
            "west": round(self.west, 6),
            "south": round(self.south, 6),
            "east": round(self.east, 6),
            "north": round(self.north, 6),
        }


@dataclass(frozen=True)
class SearchArea:
    bounds: Bounds
    locality_id: UUID | None = None
    place: Place | None = None


def _bounds_from(data: dict, prefix: str = "") -> Bounds | None:
    keys = [f"{prefix}{edge}" for edge in ("west", "south", "east", "north")]
    if not all(key in data for key in keys):
        return None
    return Bounds(*(float(data[key]) for key in keys))


def resolve_area(data: dict) -> SearchArea | None:
    """The geographic constraint of a search: an explicit box, else a place, else none."""
    bounds = _bounds_from(data)
    if bounds is not None:
        return SearchArea(bounds=bounds)

    slug = data.get("place")
    if not slug:
        return None
    place = Place.objects.filter(slug=slug, is_active=True).first()
    if place is None:
        # Said plainly and kept distinct from a failed request: the client keeps
        # every other filter and tells the tenant the area is no longer offered.
        raise NotFound("We could not find that area.", details={"place": slug})
    west, south, east, north = place.bounds.extent
    return SearchArea(
        bounds=Bounds(west, south, east, north),
        locality_id=place.locality_id,
        place=place,
    )


def filtered_listings(data: dict, area: SearchArea | None) -> QuerySet[Listing]:
    """Public listings matching every filter in `data`, inside `area` when given."""
    qs = read_models.public_listings()

    if data.get("q"):
        query = data["q"].strip()
        qs = qs.filter(
            Q(headline__icontains=query)
            | Q(description__icontains=query)
            | Q(unit__property__address__locality__name__icontains=query)
            | Q(unit__property__address__locality__aliases__icontains=query)
            | Q(unit__property__address__locality__district__name__icontains=query)
        )
    if "locality_id" in data:
        qs = qs.filter(locality_id_cache=data["locality_id"])
    if "property_type" in data:
        qs = qs.filter(unit__property__property_type=data["property_type"])
    if "space_type" in data:
        qs = qs.filter(unit__space_type=data["space_type"])
    if "bedrooms_min" in data:
        qs = qs.filter(bedrooms_cache__gte=data["bedrooms_min"])
    if "bedrooms_max" in data:
        qs = qs.filter(bedrooms_cache__lte=data["bedrooms_max"])
    if "rent_min" in data:
        qs = qs.filter(rent_minor__gte=data["rent_min"])
    if "rent_max" in data:
        qs = qs.filter(rent_minor__lte=data["rent_max"])
    if "advance_max" in data:
        qs = qs.filter(advance_months__lte=data["advance_max"])
    if data.get("furnished") is not None:
        qs = qs.filter(unit__is_furnished=data["furnished"])
    if data.get("amenity_ids"):
        qs = qs.filter(
            unit__unit_amenities__amenity_id__in=data["amenity_ids"],
            unit__unit_amenities__removed_at__isnull=True,
        ).distinct()
    if data.get("ids"):
        qs = qs.filter(id__in=data["ids"])

    if area is not None:
        # `&&` against the point's GiST index. For a point, overlapping the box
        # and lying inside it are the same test.
        inside = Q(public_point__bboverlaps=area.bounds.polygon())
        if area.locality_id is not None:
            inside |= Q(locality_id_cache=area.locality_id)
        qs = qs.filter(inside)

    return qs


def map_window(data: dict, area: SearchArea | None) -> Bounds | None:
    """The part of the search the markers are drawn for.

    The results belong to the area. The markers are fetched for what is on
    screen inside it, so zooming into a region does not ship every marker in
    the region, and panning outside the area shows nothing until the tenant
    asks to search there.
    """
    view = _bounds_from(data, prefix="view_")
    if area is not None and view is not None:
        return area.bounds.intersection(view)
    if view is not None:
        return view
    if area is not None:
        return area.bounds
    west, south, east, north = settings.MAP_BOUNDS
    return Bounds(west, south, east, north)


def map_summary(qs: QuerySet[Listing]) -> dict:
    """How many rentals the search found, how many can be drawn, and where they are."""
    counts = qs.aggregate(
        total=Count("id", distinct=True),
        mapped=Count("id", filter=Q(public_point__isnull=False), distinct=True),
    )
    extent = qs.filter(public_point__isnull=False).aggregate(extent=Extent("public_point"))[
        "extent"
    ]
    return {
        "total": counts["total"],
        "unmapped": counts["total"] - counts["mapped"],
        "extent": Bounds(*extent).as_dict() if extent else None,
    }


def map_features(
    qs: QuerySet[Listing], *, window: Bounds | None, zoom: int
) -> tuple[list[dict], bool]:
    """Price markers and clusters for `window` at `zoom`, grouped on a stable grid.

    The grid is aligned to fixed multiples of a zoom-dependent cell, not to the
    window, so a cluster does not change its members as the map pans. A cell
    holding one listing is a price marker; several listings sharing one public
    point are a stack, which carries their ids so a tap can preview them rather
    than zoom into a point that will never separate.
    """
    if window is None:
        return [], False

    cell = 360.0 * CELL_PIXELS / (256 * (2**zoom))
    matched_sql, matched_params = qs.order_by().values("id").query.sql_with_params()
    sql = f"""
        WITH matched AS ({matched_sql})
        SELECT
            floor(ST_X(l.public_point) / %s)::bigint AS gx,
            floor(ST_Y(l.public_point) / %s)::bigint AS gy,
            count(*) AS listings,
            count(DISTINCT l.public_point) AS points,
            ST_X(ST_Centroid(ST_Collect(l.public_point))) AS lng,
            ST_Y(ST_Centroid(ST_Collect(l.public_point))) AS lat,
            min(ST_X(l.public_point)) AS west,
            min(ST_Y(l.public_point)) AS south,
            max(ST_X(l.public_point)) AS east,
            max(ST_Y(l.public_point)) AS north,
            min(l.rent_minor) AS min_rent_minor,
            (array_agg(l.id::text ORDER BY l.created_at DESC))[1:%s] AS ids,
            (array_agg(l.rent_minor ORDER BY l.created_at DESC))[1] AS rent_minor,
            (array_agg(l.rent_currency ORDER BY l.created_at DESC))[1] AS rent_currency,
            (array_agg(l.rent_period ORDER BY l.created_at DESC))[1] AS rent_period,
            (array_agg(l.public_point_precision ORDER BY l.created_at DESC))[1] AS precision
        FROM listing_listing l
        JOIN matched ON matched.id = l.id
        WHERE l.public_point && ST_MakeEnvelope(%s, %s, %s, %s, 4326)
        GROUP BY gx, gy
        ORDER BY listings DESC, gx, gy
        LIMIT %s
    """
    params = [
        *matched_params,
        cell,
        cell,
        STACK_IDS,
        window.west,
        window.south,
        window.east,
        window.north,
        MAX_FEATURES,
    ]
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]

    features = []
    for row in rows:
        lat, lng = round(row["lat"], 6), round(row["lng"], 6)
        if row["listings"] == 1:
            features.append(
                {
                    "type": "listing",
                    "id": row["ids"][0],
                    "lat": lat,
                    "lng": lng,
                    "rent_minor": row["rent_minor"],
                    "rent_currency": row["rent_currency"],
                    "rent_period": row["rent_period"],
                    "precision": row["precision"],
                }
            )
            continue
        stacked = row["points"] == 1
        features.append(
            {
                "type": "cluster",
                "key": f"{zoom}:{row['gx']}:{row['gy']}",
                "lat": lat,
                "lng": lng,
                "count": row["listings"],
                "min_rent_minor": row["min_rent_minor"],
                "rent_currency": row["rent_currency"],
                "stacked": stacked,
                "ids": row["ids"] if stacked else None,
                "bounds": Bounds(row["west"], row["south"], row["east"], row["north"]).as_dict(),
            }
        )
    return features, len(rows) == MAX_FEATURES
