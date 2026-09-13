"""Import Ghana's named places from an OpenStreetMap Overpass export.

    python manage.py import_osm_places ghana-places.osm.json [--dry-run] [--prune]

The data is OpenStreetMap's (ADR 0033): © OpenStreetMap contributors, under the
ODbL. The places table is a derived database under the same licence, and every
map that draws it carries the attribution.

In order, it:

1. Classifies each element as a Place kind — region and district from
   administrative boundaries; city, town, suburb, neighbourhood and village from
   `place=*`; and a short list of landmarks people navigate by.
2. Merges duplicates. A neighbourhood mapped both as a point and as an outline
   is one suggestion, not two.
3. Gives each place a box: its outline's bounding box when it has one, or a box
   estimated around the point from the kind of place when it does not.
4. Reads each place against its surroundings — the smallest region and district
   containing it, and the nearest city or town — for the context a suggestion
   is shown with: "East Legon" · "Accra, Greater Accra".
5. Links Rooomly's own regions, districts and localities by name, and gives a
   locality without coordinates the centre of the place it matched. That centre
   is what puts a listing filed under the locality on the map until its property
   has coordinates of its own.

Idempotent: a place keeps its slug across imports, keyed by its OSM identity.
Run `refresh_listing_locations` afterwards so listings pick up new centres.
"""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from django.contrib.gis.geos import Point, Polygon
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from apps.geo.models import District, Locality, Place, PlaceBoundsSource, PlaceKind, Region
from apps.geo.places import normalise, search_text_for

SOURCE = "osm"

PLACE_TAG_KIND = {
    "city": PlaceKind.CITY,
    "town": PlaceKind.TOWN,
    "suburb": PlaceKind.SUBURB,
    "neighbourhood": PlaceKind.NEIGHBOURHOOD,
    "quarter": PlaceKind.NEIGHBOURHOOD,
    "village": PlaceKind.VILLAGE,
}
LANDMARK_TAGS = (
    ("aeroway", "aerodrome"),
    ("amenity", "university"),
    ("shop", "mall"),
    ("leisure", "stadium"),
    ("amenity", "hospital"),
)
SETTLEMENTS = frozenset(PLACE_TAG_KIND.values())

#: Half the width, in kilometres, of the box around a place mapped only as a
#: point: roughly the area somebody means when they name one. A landmark's is
#: the distance a tenant would call "near" it, not the size of the building.
ESTIMATED_HALF_KM: dict[str, float] = {
    PlaceKind.REGION: 60.0,
    PlaceKind.DISTRICT: 12.0,
    PlaceKind.CITY: 9.0,
    PlaceKind.TOWN: 3.5,
    PlaceKind.SUBURB: 1.5,
    PlaceKind.NEIGHBOURHOOD: 0.9,
    PlaceKind.VILLAGE: 1.0,
    PlaceKind.LANDMARK: 1.5,
}
#: How a suggestion ranks against an equally good name match of another kind.
KIND_WEIGHT: dict[str, int] = {
    PlaceKind.CITY: 90,
    PlaceKind.TOWN: 72,
    PlaceKind.REGION: 70,
    PlaceKind.SUBURB: 62,
    PlaceKind.NEIGHBOURHOOD: 58,
    PlaceKind.DISTRICT: 55,
    PlaceKind.LANDMARK: 48,
    PlaceKind.VILLAGE: 20,
}
#: A Rooomly locality is where listings are filed, so it outranks the same name elsewhere.
LINKED_LOCALITY_BONUS = 15
#: Two same-named places of one family closer than this are one place mapped twice.
DUPLICATE_KM = 3.0
#: How far a place's context looks for the city or town it belongs to.
CITY_REACH_KM, TOWN_REACH_KM = 25.0, 10.0

_ADMIN_WORDS = re.compile(r"\b(region|district|municipal|metropolitan|assembly|municipality)\b")


@dataclass(eq=False)
class Candidate:
    ref: str
    name: str
    kind: str
    lat: float
    lng: float
    #: The mapped outline's bounding box (west, south, east, north), if any.
    mapped: tuple[float, float, float, float] | None
    aliases: list[str] = field(default_factory=list)
    population: int = 0
    box: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    bounds_source: str = PlaceBoundsSource.ESTIMATED
    context: str = ""
    slug_hint: str = ""
    region: Region | None = None
    district: District | None = None
    locality: Locality | None = None

    @property
    def key(self) -> str:
        return normalise(self.name)


def _admin_key(name: str) -> str:
    return " ".join(_ADMIN_WORDS.sub(" ", normalise(name)).split())


def _kind(tags: dict) -> str | None:
    if tags.get("place") in PLACE_TAG_KIND:
        return PLACE_TAG_KIND[tags["place"]]
    if tags.get("boundary") == "administrative":
        return {"4": PlaceKind.REGION, "6": PlaceKind.DISTRICT}.get(tags.get("admin_level", ""))
    for tag, value in LANDMARK_TAGS:
        if tags.get(tag) == value:
            return PlaceKind.LANDMARK
    return None


def _clean_name(name: str, kind: str) -> str:
    name = " ".join(name.split())
    if kind == PlaceKind.REGION:
        name = re.sub(r"\s+region$", "", name, flags=re.IGNORECASE)
    elif kind == PlaceKind.DISTRICT:
        name = re.sub(r"\s+district$", "", name, flags=re.IGNORECASE)
    return name


def _aliases(tags: dict, name: str) -> list[str]:
    found = []
    for key in ("alt_name", "old_name", "short_name", "official_name", "loc_name", "name"):
        for value in (tags.get(key) or "").split(";"):
            value = value.strip()
            if value and normalise(value) != normalise(name):
                found.append(value)
    return list(dict.fromkeys(found))[:8]


def _population(tags: dict) -> int:
    digits = re.sub(r"\D", "", tags.get("population") or "")
    return int(digits) if digits else 0


def _km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    to_rad = math.radians
    d_lat, d_lng = to_rad(b_lat - a_lat), to_rad(b_lng - a_lng)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(to_rad(a_lat)) * math.cos(to_rad(b_lat)) * math.sin(d_lng / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def _estimated_box(lat: float, lng: float, half_km: float) -> tuple[float, float, float, float]:
    d_lat = half_km / 110.574
    d_lng = half_km / (111.320 * max(math.cos(math.radians(lat)), 0.2))
    return (lng - d_lng, lat - d_lat, lng + d_lng, lat + d_lat)


def _contains(box: tuple[float, float, float, float], lat: float, lng: float) -> bool:
    return box[0] <= lng <= box[2] and box[1] <= lat <= box[3]


def _area(box: tuple[float, float, float, float]) -> float:
    return (box[2] - box[0]) * (box[3] - box[1])


def _family(kind: str) -> str:
    if kind in (PlaceKind.REGION, PlaceKind.DISTRICT):
        return "admin"
    return "landmark" if kind == PlaceKind.LANDMARK else "settlement"


def _parse(elements: list[dict]) -> list[Candidate]:
    found = []
    for element in elements:
        tags = element.get("tags") or {}
        raw_name = tags.get("name:en") or tags.get("name")
        kind = _kind(tags)
        if not raw_name or kind is None:
            continue
        if element.get("type") == "node":
            lat, lng, mapped = element.get("lat"), element.get("lon"), None
        else:
            center = element.get("center") or {}
            lat, lng = center.get("lat"), center.get("lon")
            bounds = element.get("bounds")
            mapped = (
                (bounds["minlon"], bounds["minlat"], bounds["maxlon"], bounds["maxlat"])
                if bounds
                else None
            )
            # `out tags center bb` returns no centre for ways and relations on
            # some Overpass servers — every region, district and most landmarks
            # arrived with a box and nothing else. The box's middle stands in.
            if (lat is None or lng is None) and mapped is not None:
                lng, lat = (mapped[0] + mapped[2]) / 2, (mapped[1] + mapped[3]) / 2
        if lat is None or lng is None:
            continue
        name = _clean_name(raw_name, kind)
        found.append(
            Candidate(
                ref=f"{element['type']}/{element['id']}",
                name=name,
                kind=kind,
                lat=float(lat),
                lng=float(lng),
                mapped=mapped,
                aliases=_aliases(tags, name),
                population=_population(tags),
            )
        )
    return found


def _merge_duplicates(candidates: list[Candidate]) -> list[Candidate]:
    groups: dict[tuple[str, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        groups[(candidate.key, _family(candidate.kind))].append(candidate)

    kept = []
    for group in groups.values():
        # Best first: an outline beats a bare point, a bigger kind a smaller one.
        group.sort(key=lambda c: (c.mapped is None, -KIND_WEIGHT[c.kind], c.ref))
        survivors: list[Candidate] = []
        for candidate in group:
            twin = next(
                (
                    s
                    for s in survivors
                    if _km(s.lat, s.lng, candidate.lat, candidate.lng) <= DUPLICATE_KM
                    or (s.mapped is not None and _contains(s.mapped, candidate.lat, candidate.lng))
                ),
                None,
            )
            if twin is None:
                survivors.append(candidate)
                continue
            twin.aliases = list(dict.fromkeys([*twin.aliases, *candidate.aliases]))[:8]
            twin.population = max(twin.population, candidate.population)
        kept.extend(survivors)
    return kept


def _assign_boxes(candidates: list[Candidate]) -> None:
    for candidate in candidates:
        half_km = ESTIMATED_HALF_KM[candidate.kind]
        estimated = _estimated_box(candidate.lat, candidate.lng, half_km)
        mapped = candidate.mapped
        # An outline far smaller than the kind of place it is — a suburb mapped
        # as one block — would zoom the map to a street, so it gives way. An
        # administrative boundary is the area by definition, whatever its size.
        administrative = candidate.kind in (PlaceKind.REGION, PlaceKind.DISTRICT)
        if mapped is not None and (administrative or _area(mapped) >= _area(estimated) * 0.25):
            candidate.box, candidate.bounds_source = mapped, PlaceBoundsSource.MAPPED
        else:
            candidate.box, candidate.bounds_source = estimated, PlaceBoundsSource.ESTIMATED


class _TownIndex:
    """Cities and towns bucketed on a quarter-degree grid, for nearest lookups."""

    STEP = 0.25

    def __init__(self, candidates: list[Candidate]):
        self.cells: dict[tuple[int, int], list[Candidate]] = defaultdict(list)
        for candidate in candidates:
            if candidate.kind in (PlaceKind.CITY, PlaceKind.TOWN):
                self.cells[self._cell(candidate.lat, candidate.lng)].append(candidate)

    def _cell(self, lat: float, lng: float) -> tuple[int, int]:
        return int(math.floor(lat / self.STEP)), int(math.floor(lng / self.STEP))

    def nearest(self, candidate: Candidate) -> Candidate | None:
        row, column = self._cell(candidate.lat, candidate.lng)
        best: tuple[float, Candidate] | None = None
        for d_row in (-1, 0, 1):
            for d_column in (-1, 0, 1):
                for town in self.cells.get((row + d_row, column + d_column), ()):
                    if town is candidate:
                        continue
                    distance = _km(candidate.lat, candidate.lng, town.lat, town.lng)
                    reach = CITY_REACH_KM if town.kind == PlaceKind.CITY else TOWN_REACH_KM
                    if distance > reach:
                        continue
                    # A city a little further away names a place better than a
                    # small town next door: "East Legon, Accra", not "…, Madina".
                    score = distance - (8.0 if town.kind == PlaceKind.CITY else 0.0)
                    if best is None or score < best[0]:
                        best = (score, town)
        return best[1] if best else None


def _smallest_containing(candidates: list[Candidate], lat: float, lng: float) -> Candidate | None:
    containing = [c for c in candidates if _contains(c.box, lat, lng)]
    return min(containing, key=lambda c: _area(c.box)) if containing else None


class Command(BaseCommand):
    help = "Import named places (regions to landmarks) from an OpenStreetMap Overpass JSON export."

    def add_arguments(self, parser):
        parser.add_argument("export", help="Overpass JSON with `out tags center bb`.")
        parser.add_argument("--dry-run", action="store_true", help="Report what would change.")
        parser.add_argument(
            "--prune", action="store_true", help="Deactivate OSM places missing from this export."
        )
        parser.add_argument(
            "--refresh-locality-coordinates",
            action="store_true",
            help="Overwrite locality coordinates that are already set.",
        )

    def handle(self, *args, export: str, dry_run: bool, prune: bool, **options):
        path = Path(export)
        if not path.is_file():
            raise CommandError(f"No export at {path}.")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise CommandError(f"{path} is not complete JSON ({exc}). Download it again.") from exc
        if payload.get("remark"):
            raise CommandError(f"Overpass reported a problem: {payload['remark']}")

        candidates = _merge_duplicates(_parse(payload.get("elements") or []))
        if not candidates:
            raise CommandError("The export contains no named places.")
        _assign_boxes(candidates)

        regions = [c for c in candidates if c.kind == PlaceKind.REGION]
        districts = [c for c in candidates if c.kind == PlaceKind.DISTRICT]
        towns = _TownIndex(candidates)
        rooomly_regions = {_admin_key(r.name): r for r in Region.objects.all()}
        rooomly_districts = {
            _admin_key(d.name): d for d in District.objects.select_related("region")
        }

        for candidate in candidates:
            region = (
                candidate
                if candidate.kind == PlaceKind.REGION
                else _smallest_containing(regions, candidate.lat, candidate.lng)
            )
            district = (
                candidate
                if candidate.kind == PlaceKind.DISTRICT
                else _smallest_containing(districts, candidate.lat, candidate.lng)
            )
            candidate.region = rooomly_regions.get(_admin_key(region.name)) if region else None
            candidate.district = (
                rooomly_districts.get(_admin_key(district.name)) if district else None
            )
            region_name = region.name if region else ""

            if candidate.kind == PlaceKind.REGION:
                candidate.context, anchor = "Ghana", ""
            elif candidate.kind in (PlaceKind.DISTRICT, PlaceKind.CITY, PlaceKind.TOWN):
                candidate.context, anchor = region_name or "Ghana", region_name
            else:
                town = towns.nearest(candidate)
                town_name = town.name if town is not None and town.key != candidate.key else ""
                parts = list(dict.fromkeys(part for part in (town_name, region_name) if part))
                candidate.context, anchor = ", ".join(parts) or "Ghana", town_name or region_name
            candidate.slug_hint = anchor

        linked, unmatched = self._link_localities(candidates, regions, districts)

        by_kind: dict[str, int] = defaultdict(int)
        for candidate in candidates:
            by_kind[candidate.kind] += 1
        summary = ", ".join(f"{kind} {count}" for kind, count in sorted(by_kind.items()))
        self.stdout.write(f"{len(candidates)} places after merging duplicates: {summary}.")
        self.stdout.write(
            f"Matched {len(linked)} of {len(linked) + len(unmatched)} Rooomly localities."
        )
        for locality in unmatched:
            self.stdout.write(f"  No match for {locality.name} ({locality.district.name}).")

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run: nothing was written."))
            return

        created, updated, located = self._write(
            candidates, linked, prune=prune, refresh=options["refresh_locality_coordinates"]
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Places imported: {created} new, {updated} updated. "
                f"Coordinates set on {located} localities. "
                "Next: python manage.py refresh_listing_locations"
            )
        )

    def _link_localities(self, candidates, regions, districts):
        by_key: dict[str, list[Candidate]] = defaultdict(list)
        for candidate in candidates:
            if candidate.kind in SETTLEMENTS:
                by_key[candidate.key].append(candidate)
                for alias in candidate.aliases:
                    by_key[normalise(alias)].append(candidate)

        district_boxes = {_admin_key(d.name): d.box for d in districts}
        region_boxes = {_admin_key(r.name): r.box for r in regions}

        linked: list[tuple[Locality, Candidate]] = []
        unmatched: list[Locality] = []
        for locality in Locality.objects.select_related("district__region").order_by("name"):
            keys = {normalise(locality.name), *(normalise(alias) for alias in locality.aliases)}
            options = list(
                dict.fromkeys(c for key in keys for c in by_key.get(key, ()) if c.locality is None)
            )
            if not options:
                unmatched.append(locality)
                continue
            district_box = district_boxes.get(_admin_key(locality.district.name))
            region_box = region_boxes.get(_admin_key(locality.district.region.name))
            best = min(
                options,
                key=lambda c: (
                    # The exact name before an alias, inside the locality's own
                    # district before its region, then the more prominent place.
                    c.key != normalise(locality.name),
                    not (district_box and _contains(district_box, c.lat, c.lng)),
                    not (region_box and _contains(region_box, c.lat, c.lng)),
                    -KIND_WEIGHT[c.kind],
                ),
            )
            if region_box and not _contains(region_box, best.lat, best.lng):
                # The same name in the wrong region is a different place, and a
                # centre from it would put Kumasi's listings in Accra.
                unmatched.append(locality)
                continue
            best.locality = locality
            best.district = best.district or locality.district
            best.region = best.region or locality.district.region
            linked.append((locality, best))
        return linked, unmatched

    @transaction.atomic
    def _write(self, candidates, linked, *, prune: bool, refresh: bool):
        existing = {place.source_ref: place for place in Place.objects.filter(source=SOURCE)}
        taken = set(Place.objects.values_list("slug", flat=True))
        # Links are recomputed on every import; clearing first keeps the
        # one-place-per-locality constraint satisfied while rows are rewritten.
        Place.objects.filter(source=SOURCE, locality__isnull=False).update(locality=None)

        creating, updating = [], []
        for candidate in sorted(candidates, key=lambda c: -KIND_WEIGHT[c.kind]):
            west, south, east, north = candidate.box
            bounds = Polygon.from_bbox((west, south, east, north))
            bounds.srid = 4326
            importance = (
                KIND_WEIGHT[candidate.kind]
                + min(10.0, math.log10(candidate.population + 1) * 2)
                + (LINKED_LOCALITY_BONUS if candidate.locality else 0)
            )
            values = {
                "name": candidate.name[:160],
                "kind": candidate.kind,
                "context": candidate.context[:200],
                "aliases": candidate.aliases,
                "search_text": search_text_for(candidate.name, candidate.aliases),
                "center": Point(candidate.lng, candidate.lat, srid=4326),
                "bounds": bounds,
                "bounds_source": candidate.bounds_source,
                "region": candidate.region,
                "district": candidate.district,
                "locality": candidate.locality,
                "importance": round(importance, 3),
                "is_active": True,
            }
            place = existing.get(candidate.ref)
            if place is not None:
                for name, value in values.items():
                    setattr(place, name, value)
                updating.append(place)
                continue
            base = slugify(f"{candidate.name} {candidate.slug_hint}")[:150] or slugify(
                candidate.ref
            )
            slug, suffix = base, 2
            while slug in taken:
                slug, suffix = f"{base}-{suffix}", suffix + 1
            taken.add(slug)
            creating.append(Place(source=SOURCE, source_ref=candidate.ref, slug=slug, **values))

        Place.objects.bulk_create(creating, batch_size=1000)
        Place.objects.bulk_update(
            updating,
            fields=[
                "name",
                "kind",
                "context",
                "aliases",
                "search_text",
                "center",
                "bounds",
                "bounds_source",
                "region",
                "district",
                "locality",
                "importance",
                "is_active",
            ],
            batch_size=1000,
        )
        if prune:
            refs = {candidate.ref for candidate in candidates}
            Place.objects.filter(source=SOURCE, is_active=True).exclude(source_ref__in=refs).update(
                is_active=False
            )

        located = 0
        for locality, candidate in linked:
            if locality.latitude is None or locality.longitude is None or refresh:
                Locality.objects.filter(pk=locality.pk).update(
                    latitude=round(candidate.lat, 6), longitude=round(candidate.lng, 6)
                )
                located += 1
        return len(creating), len(updating), located
