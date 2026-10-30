"""Repeatable, source-linked Ghana reference imports. Never edits an Address."""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import math
import re
import shutil
import subprocess
import uuid
import zipfile
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

import requests
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon, Point
from django.db import connection, transaction

from .models import District, GeoDataset, Locality, LocationSourceRecord, Region
from .search import normalize_name

HDX = "https://data.humdata.org/api/3/action/package_show?id=cod-ab-gha"
GEONAMES = "https://download.geonames.org/export/dump/GH.zip"
OSM = "https://download.geofabrik.de/africa/ghana-latest.osm.pbf"
KINDS = (
    "city",
    "town",
    "village",
    "hamlet",
    "suburb",
    "neighbourhood",
    "quarter",
    "isolated_dwelling",
    "locality",
)


@lru_cache(maxsize=1)
def administrative_crosswalk():
    path = Path(__file__).resolve().parents[2] / "data/geography/admin-crosswalk.json"
    return json.loads(path.read_text())


def stable_id(source, key):
    return uuid.uuid5(uuid.NAMESPACE_URL, f"https://danpahq.com/geography/{source}/{key}")


def download(url, path):
    """HTTPS, bounded download, atomic replacement; no archive extraction to arbitrary paths."""
    part = path.with_suffix(path.suffix + ".part")
    try:
        with requests.get(url, stream=True, timeout=(15, 180)) as response:
            response.raise_for_status()
            size = 0
            with part.open("wb") as target:
                for block in response.iter_content(1024 * 1024):
                    size += len(block)
                    if size > 512 * 1024 * 1024:
                        raise ValueError("Dataset exceeds the 512 MB download limit")
                    target.write(block)
        part.replace(path)
    finally:
        part.unlink(missing_ok=True)


def obtain(folder):
    folder.mkdir(parents=True, exist_ok=True)
    download(HDX, folder / "hdx.json")
    metadata = json.loads((folder / "hdx.json").read_text())["result"]
    if metadata["license_id"] != "cc-by-igo":
        raise ValueError("HDX licence changed; review before importing")
    resource = next(r for r in metadata["resources"] if r["format"] == "GeoJSON")
    if not resource["url"].startswith("https://data.humdata.org/"):
        raise ValueError("Unexpected HDX download host; review before importing")
    download(resource["url"], folder / "gss-hdx.geojson.zip")
    download(GEONAMES, folder / "GH.zip")
    download(OSM, folder / "ghana-latest.osm.pbf")


def osm_places(folder):
    output = folder / "osm-places.geojsonl"
    # GeoJSONSeq is append-capable; ogr2ogr's layer overwrite alone does not truncate it.
    output.unlink(missing_ok=True)
    executable = shutil.which("ogr2ogr")
    if not executable:
        raise ValueError("ogr2ogr is required for OSM PBF extraction; use the existing API image")
    subprocess.run(  # noqa: S603 - fixed executable/arguments; paths are separate argv entries
        [
            executable,
            "-f",
            "GeoJSONSeq",
            str(output),
            str(folder / "ghana-latest.osm.pbf"),
            "points",
            "-where",
            "place IN (" + ",".join(f"'{k}'" for k in KINDS) + ")",
            "-select",
            "osm_id,name,place,other_tags",
            "-overwrite",
        ],
        check=True,
        timeout=300,
        capture_output=True,
    )
    return output


def aliases(values, name):
    return sorted(
        {
            " ".join(value.split())[:200]
            for value in values
            if value and value.strip() and value.strip() != name
        }
    )


def valid_coordinate(lat, lon):
    return math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180


def validate_document(document):
    if document.get("schema") != 1:
        raise ValueError("Unsupported geography snapshot schema")
    regions = {row["source_id"] for row in document["regions"]}
    districts = {row["source_id"]: row["region_code"] for row in document["districts"]}
    if len(regions) != len(document["regions"]) or len(districts) != len(document["districts"]):
        raise ValueError("Duplicate administrative source identity")
    if any(region not in regions for region in districts.values()):
        raise ValueError("District has an unknown region")
    seen = set()
    for row in document["localities"]:
        identity = row["source"], row["source_id"]
        if identity in seen or row["source"] not in document["sources"]:
            raise ValueError("Duplicate or unknown locality source identity")
        seen.add(identity)
        if not row["name"].strip() or len(row["name"]) > 200:
            raise ValueError("Invalid locality name")
        if not valid_coordinate(float(row["latitude"]), float(row["longitude"])):
            raise ValueError("Invalid coordinate in snapshot")
        if row.get("region_code") and row["region_code"] not in regions:
            raise ValueError("Locality has an unknown region")
        if row.get("district_code") and districts.get(row["district_code"]) != row.get(
            "region_code"
        ):
            raise ValueError("Locality has an inconsistent district/region")


class BoundaryLookup:
    """Small in-memory spatial grid: no per-settlement database queries."""

    def __init__(self, features):
        self.grid = defaultdict(list)
        for feature in features:
            geom = GEOSGeometry(json.dumps(feature["geometry"]), srid=4326)
            if not geom.valid:
                geom = geom.buffer(0)
            if geom.empty or not geom.valid:
                raise ValueError("Invalid administrative boundary")
            west, south, east, north = geom.extent
            for x in range(math.floor(west * 4), math.floor(east * 4) + 1):
                for y in range(math.floor(south * 4), math.floor(north * 4) + 1):
                    self.grid[x, y].append((feature["properties"], geom.prepared))

    def at(self, lat, lon):
        point = Point(lon, lat, srid=4326)
        matches = [
            props
            for props, geom in self.grid[math.floor(lon * 4), math.floor(lat * 4)]
            if geom.covers(point)
        ]
        return matches[0] if len(matches) == 1 else None


def build_snapshot(folder, output):
    metadata = json.loads((folder / "hdx.json").read_text())["result"]
    if metadata.get("license_id") != "cc-by-igo":
        raise ValueError("An explicitly licensed GSS/HDX extract is required")
    with zipfile.ZipFile(folder / "gss-hdx.geojson.zip") as archive:
        region_features = json.loads(archive.read("gha_admin1.geojson"))["features"]
        district_features = json.loads(archive.read("gha_admin2.geojson"))["features"]
    # Load just its geometry, without silently choosing another country's polygon.
    with zipfile.ZipFile(folder / "gss-hdx.geojson.zip") as archive:
        country_data = json.loads(archive.read("gha_admin0.geojson"))["features"]
    country = GEOSGeometry(json.dumps(country_data[0]["geometry"]), srid=4326).prepared
    region_lookup, district_lookup = (
        BoundaryLookup(region_features),
        BoundaryLookup(district_features),
    )
    sources = {
        "gss-hdx": {
            "url": "https://data.humdata.org/dataset/cod-ab-gha",
            "license": "CC BY-IGO",
            "attribution": "Ghana Statistical Service; OCHA/HDX",
            "version": "COD-AB v01; boundaries valid 2021-03-08; reviewed 2025-10-30",
        },
        "geonames": {
            "url": GEONAMES,
            "license": "CC BY 4.0",
            "attribution": "Contains data from GeoNames (https://www.geonames.org)",
            "version": "Ghana country extract; record modification dates retained",
        },
        "osm": {
            "url": OSM,
            "license": "ODbL 1.0",
            "attribution": "© OpenStreetMap contributors (https://www.openstreetmap.org/copyright)",
            "version": "Geofabrik Ghana extract; source archive SHA-256 retained",
        },
    }
    for source, filename in (
        ("gss-hdx", "gss-hdx.geojson.zip"),
        ("geonames", "GH.zip"),
        ("osm", "ghana-latest.osm.pbf"),
    ):
        digest = hashlib.sha256()
        with (folder / filename).open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        sources[source]["sha256"] = digest.hexdigest()
    # HDX's GH09 is labelled "Northern East"; the GeoNames ADM1 North East
    # point falls inside that exact polygon. Keep the source spelling too.
    regions = [
        {
            "source_id": f["properties"]["adm1_pcode"],
            "name": administrative_crosswalk()["region_aliases"].get(
                f["properties"]["adm1_name"], f["properties"]["adm1_name"]
            ),
            "source_name": f["properties"]["adm1_name"],
            "latitude": round(float(f["properties"]["center_lat"]), 6),
            "longitude": round(float(f["properties"]["center_lon"]), 6),
        }
        for f in region_features
    ]
    districts = [
        {
            "source_id": f["properties"]["adm2_pcode"],
            "name": f["properties"]["adm2_name"],
            "region_code": f["properties"]["adm1_pcode"],
            "geometry": f["geometry"],
            "latitude": round(float(f["properties"]["center_lat"]), 6),
            "longitude": round(float(f["properties"]["center_lon"]), 6),
            "aliases": [
                f["properties"][key]
                for key in ("adm2_name1", "adm2_name2", "adm2_name3")
                if f["properties"].get(key)
            ],
        }
        for f in district_features
    ]
    places, rejected = [], defaultdict(int)

    def add(source, source_id, name, lat, lon, alternate, kind, raw):
        if not name or not name.strip() or len(name) > 200:
            rejected["unnamed_or_overlong_osm_place"] += 1
            return
        if not valid_coordinate(lat, lon):
            rejected["invalid_coordinates"] += 1
            return
        if not (-3.35 <= lon <= 1.3 and 4.6 <= lat <= 11.25):
            rejected["outside_ghana_envelope"] += 1
            return
        if source == "osm" and not country.covers(Point(lon, lat, srid=4326)):
            rejected["osm_outside_country_boundary"] += 1
            return
        district = district_lookup.at(lat, lon)
        region = region_lookup.at(lat, lon)
        places.append(
            {
                "source": source,
                "source_id": str(source_id),
                "name": name,
                "latitude": round(lat, 6),
                "longitude": round(lon, 6),
                "aliases": aliases(alternate, name),
                "kind": kind,
                "district_code": district["adm2_pcode"] if district else None,
                "region_code": (
                    district["adm1_pcode"] if district else region["adm1_pcode"] if region else None
                ),
                "parent_status": "boundary_2021" if district else "unverified",
                "original": raw,
            }
        )

    with zipfile.ZipFile(folder / "GH.zip") as archive:
        rows = list(csv.reader(io.StringIO(archive.read("GH.txt").decode("utf-8")), delimiter="\t"))
        admin1_names = {r[10]: re.sub(r"\s+Region$", "", r[1]) for r in rows if r[7] == "ADM1"}
        supplements = set(administrative_crosswalk()["geonames_supplemental_district_ids"])
        supplemental_codes = {}
        for row in rows:
            if row[0] not in supplements:
                continue
            if row[7] != "ADM2" or row[8] != "GH":
                raise ValueError("Supplemental district identity changed; review the crosswalk")
            parent_name = admin1_names.get(row[10], "")
            matches = [
                r for r in regions if normalize_name(r["name"]) == normalize_name(parent_name)
            ]
            if len(matches) != 1:
                raise ValueError("Supplemental district region is uncertain; review the crosswalk")
            parent_code = matches[0]["source_id"]
            name_key = re.sub(r"\s+district$", "", normalize_name(row[1]))
            if any(
                district_key(d["name"]) == name_key and d["region_code"] == parent_code
                for d in districts
            ):
                continue  # A later GSS release may already include this district.
            districts.append(
                {
                    "source": "geonames",
                    "source_id": row[0],
                    "name": row[1],
                    "region_code": parent_code,
                    "geometry": None,
                    "latitude": float(row[4]),
                    "longitude": float(row[5]),
                    "modified": row[18],
                    "parent_status": "source_reported",
                    "original_admin1": row[10],
                    "original_admin2": row[11],
                }
            )
            supplemental_codes[row[11]] = row[0]
        for row in rows:
            if len(row) != 19 or row[6] != "P" or row[8] != "GH":
                continue
            if row[7] in {"PPLH", "PPLQ", "PPLW"}:
                rejected["historic_abandoned_destroyed"] += 1
                continue
            add(
                "geonames",
                row[0],
                row[1],
                float(row[4]),
                float(row[5]),
                [row[2], *row[3].split(",")],
                row[7],
                {"admin1": row[10], "admin2": row[11], "modified": row[18]},
            )
            if places and places[-1]["source_id"] == row[0] and row[11] in supplemental_codes:
                code = supplemental_codes[row[11]]
                parent = next(d["region_code"] for d in districts if d["source_id"] == code)
                if normalize_name(admin1_names.get(row[10], "")) == normalize_name(
                    next(r["name"] for r in regions if r["source_id"] == parent)
                ):
                    places[-1].update(
                        region_code=parent, district_code=code, parent_status="source_admin2"
                    )
    for line in osm_places(folder).read_text().splitlines():
        if not line.strip("\x1e "):
            continue
        feature = json.loads(line.lstrip("\x1e"))
        props = feature["properties"]
        tags = {
            json.loads('"' + key + '"'): json.loads('"' + value + '"')
            for key, value in re.findall(
                r'"((?:\\.|[^"\\])*)"=>"((?:\\.|[^"\\])*)"', props.get("other_tags") or ""
            )
        }
        if tags.get("abandoned") == "yes":
            rejected["abandoned_osm"] += 1
            continue
        alternate = [
            value
            for key, value in tags.items()
            if key.startswith("name:")
            or key in {"alt_name", "loc_name", "old_name", "official_name"}
        ]
        lon, lat = feature["geometry"]["coordinates"]
        add(
            "osm",
            f"node/{props['osm_id']}",
            props.get("name"),
            lat,
            lon,
            [name for value in alternate for name in value.split(";")],
            props["place"],
            {
                key: value
                for key, value in tags.items()
                if key in {"geonames", "wikidata", "addr:country"}
            },
        )
    document = {
        "schema": 1,
        "sources": sources,
        "regions": regions,
        "districts": districts,
        "localities": places,
        "rejected": dict(rejected),
    }
    write_snapshot(document, output)
    return document


def write_snapshot(document, output):
    """Deterministic snapshot and matching manifest, including for staged candidates."""
    validate_document(document)
    output.parent.mkdir(parents=True, exist_ok=True)
    content = gzip.compress(json.dumps(document, ensure_ascii=False).encode(), mtime=0)
    staged = output.with_suffix(output.suffix + ".part")
    staged.write_bytes(content)
    staged.replace(output)
    manifest = {
        "database_license": "ODbL 1.0",
        "database_license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "snapshot_sha256": hashlib.sha256(content).hexdigest(),
        "sources": document["sources"],
        "source_regions": len(document["regions"]),
        "source_districts": len(document["districts"]),
        "source_localities": len(document["localities"]),
        "source_aliases": sum(len(row["aliases"]) for row in document["localities"]),
        "rejected": document.get("rejected", {}),
    }
    target = (
        output.with_name("manifest.json")
        if output.name == "ghana-reference.json.gz"
        else output.with_suffix(".manifest.json")
    )
    target.write_bytes((json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode())


def district_key(name):
    key = re.sub(
        r"\s+(municipal|metropolitan|metropolis|district)( assembly)?$", "", normalize_name(name)
    )
    # Same Greater Accra municipality: HDX "Adenta", existing official-style "Adentan".
    return administrative_crosswalk()["district_aliases"].get(key, key)


def remove_unreferenced_import_row(row):
    """Remove only a duplicate created by this importer, never any referenced work."""
    for relation in row._meta.related_objects:
        if relation.related_model._base_manager.filter(**{relation.field.name: row}).exists():
            return False
    row.delete()
    return True


def distance(a, lat, lon):
    if a.latitude is None or a.longitude is None:
        return float("inf")
    return math.hypot(
        (float(a.latitude) - lat) * 111_200,
        (float(a.longitude) - lon) * 111_200 * math.cos(math.radians(lat)),
    )


@transaction.atomic
def import_snapshot(document):
    validate_document(document)
    # Serialize writers. A reader sees either the old reference set or the committed update.
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [2026102801])
    counts = defaultdict(int)
    datasets = {}
    for key, source in document["sources"].items():
        datasets[key], _ = GeoDataset.objects.update_or_create(id=key, defaults=source)
    regions = {}
    for item in document["regions"]:
        source = LocationSourceRecord.objects.filter(
            dataset_id="gss-hdx", source_id=item["source_id"]
        ).first()
        existing_region = Region.objects.filter(name__iexact=item["name"]).first()
        region = source.region if source else existing_region
        if (
            source
            and existing_region
            and region.pk != existing_region.pk
            and region.pk == stable_id("gss-hdx", item["source_id"])
        ):
            old = region
            # Reconcile only importer-owned geography, keeping all locality IDs.
            District.objects.filter(region=old, source_records__dataset_id="gss-hdx").update(
                region=existing_region
            )
            Locality.objects.filter(region=old, imported=True).update(region=existing_region)
            source.region = existing_region
            source.save(update_fields=["region"])
            region = existing_region
            counts["import_created_admin_duplicates_removed"] += int(
                remove_unreferenced_import_row(old)
            )
        if region is None:
            region = Region.objects.create(
                id=stable_id("gss-hdx", item["source_id"]),
                name=item["name"],
                code=item["source_id"],
            )
            counts["regions_created"] += 1
        regions[item["source_id"]] = region
        LocationSourceRecord.objects.update_or_create(
            dataset=datasets["gss-hdx"],
            source_id=item["source_id"],
            defaults={"region": region, "data": item},
        )
    districts = {}
    for item in document["districts"]:
        region = regions[item["region_code"]]
        source_key = item.get("source", "gss-hdx")
        source = LocationSourceRecord.objects.filter(
            dataset_id=source_key, source_id=item["source_id"]
        ).first()
        district = source.district if source else None
        candidates = [
            d
            for d in District.objects.filter(region=region)
            if district_key(d.name) == district_key(item["name"])
        ]
        legacy = [d for d in candidates if d.id != stable_id(source_key, item["source_id"])]
        if (
            source
            and len(legacy) == 1
            and district.id != legacy[0].id
            and district.id == stable_id(source_key, item["source_id"])
        ):
            old = district
            district = legacy[0]
            Locality.objects.filter(district=old, imported=True).update(
                district=district, region=region
            )
            source.district = district
            source.save(update_fields=["district"])
            counts["import_created_admin_duplicates_removed"] += int(
                remove_unreferenced_import_row(old)
            )
        if district is None and len(candidates) == 1:
            district = candidates[0]
        if district is None:
            district = District.objects.create(
                id=stable_id(source_key, item["source_id"]),
                region=region,
                name=item["name"],
                code=item["source_id"] if source_key == "gss-hdx" else "GN" + item["source_id"],
            )
            counts["districts_created"] += 1
        geometry = (
            GEOSGeometry(json.dumps(item["geometry"]), srid=4326) if item.get("geometry") else None
        )
        if geometry and not geometry.valid:
            geometry = geometry.buffer(0)
        if geometry and geometry.geom_type == "Polygon":
            geometry = MultiPolygon(geometry, srid=4326)
        # Only the importer-owned boundary changes; existing names, IDs and parents remain.
        if geometry and (district.boundary is None or not district.boundary.equals(geometry)):
            district.boundary = geometry
            district.save(update_fields=["boundary", "updated_at"])
        districts[item["source_id"]] = district
        LocationSourceRecord.objects.update_or_create(
            dataset=datasets[source_key],
            source_id=item["source_id"],
            defaults={
                "district": district,
                "data": {k: v for k, v in item.items() if k != "geometry"},
            },
        )
    existing = list(Locality.objects.select_related("district__region", "region"))
    identities = {
        (r.dataset_id, r.source_id): r
        for r in LocationSourceRecord.objects.filter(locality__isnull=False)
    }
    by_id = {row.id: row for row in existing}
    by_name = defaultdict(list)
    new, changed, source_rows, source_changes = [], {}, [], []
    for row in existing:
        previous_search, previous_region = row.search_text, row.region_id
        row.prepare_search()
        if row.search_text != previous_search or row.region_id != previous_region:
            changed[row.id] = row
        by_name[normalize_name(row.name)].append(row)
    for item in document["localities"]:
        lat, lon = float(item["latitude"]), float(item["longitude"])
        if not valid_coordinate(lat, lon):
            raise ValueError("Invalid coordinate in snapshot; import rolled back")
        identity = item["source"], item["source_id"]
        reference = identities.get(identity)
        row = by_id.get(reference.locality_id) if reference else None
        district = districts.get(item.get("district_code"))
        region = regions.get(item.get("region_code"))
        if row is None:
            # Names alone never merge homonyms across Ghana. Require a unique close
            # coordinate match, or an existing coordinate-less exact district/name.
            matches = [
                candidate
                for candidate in by_name[normalize_name(item["name"])]
                if (
                    distance(candidate, lat, lon) <= 200
                    or (
                        candidate.latitude is None
                        and district is not None
                        and candidate.district_id == district.id
                    )
                )
            ]
            if len(matches) == 1:
                row = matches[0]
                counts["source_records_merged"] += 1
            elif len(matches) > 1:
                counts["ambiguous_duplicates_kept_separate"] += 1
        if row is None:
            row = Locality(
                id=stable_id(*identity),
                name=item["name"],
                district=district,
                region=region,
                latitude=lat,
                longitude=lon,
                aliases=item["aliases"],
                kind=item["kind"],
                parent_status=item["parent_status"],
                imported=True,
                primary_source=":".join(identity),
            )
            row.prepare_search()
            new.append(row)
            by_id[row.id] = row
            by_name[normalize_name(row.name)].append(row)
        else:
            # Never rewrite user/operations-created locations. Their IDs, names,
            # parents and coordinates survive both initial import and updates.
            if (
                reference
                and row.imported
                and not row.import_locked
                and row.primary_source == ":".join(identity)
            ):
                previous = reference.data
                if (
                    row.name != previous.get("name")
                    or distance(row, float(previous["latitude"]), float(previous["longitude"])) > 1
                ):
                    row.import_locked = True
                    changed[row.id] = row
                elif distance(row, lat, lon) > 0.01 or any(
                    (getattr(row, field) != value)
                    for field, value in (
                        ("name", item["name"]),
                        ("district_id", district.id if district else None),
                        ("region_id", region.id if region else None),
                    )
                ):
                    row.name, row.latitude, row.longitude = item["name"], lat, lon
                    row.district, row.region = district, region
                    row.parent_status, row.kind = item["parent_status"], item["kind"]
                    row.prepare_search()
                    changed[row.id] = row
            combined = aliases([*row.aliases, *item["aliases"], item["name"]], row.name)
            if not row.import_locked and combined != row.aliases:
                row.aliases = combined
                row.prepare_search()
                changed[row.id] = row
            counts["existing_localities_preserved"] += 1
        data = {**item, "snapshot_sha256": datasets[item["source"]].sha256}
        if reference:
            if reference.data != data:
                reference.data = data
                source_changes.append(reference)
        else:
            reference = LocationSourceRecord(
                dataset=datasets[item["source"]],
                source_id=item["source_id"],
                locality_id=row.id,
                data=data,
            )
            identities[identity] = reference
            source_rows.append(reference)
    Locality.objects.bulk_create(new, batch_size=500)
    # Some newly created rows may receive aliases from a second source in this run.
    Locality.objects.bulk_update(
        list(changed.values()),
        [
            "name",
            "latitude",
            "longitude",
            "district",
            "region",
            "parent_status",
            "kind",
            "aliases",
            "normalized_name",
            "search_text",
            "import_locked",
        ],
        batch_size=500,
    )
    LocationSourceRecord.objects.bulk_create(source_rows, batch_size=500)
    LocationSourceRecord.objects.bulk_update(source_changes, ["data"], batch_size=500)
    counts.update(
        {
            "localities_created": len(new),
            "localities_enriched": len(changed),
            "source_records_created": len(source_rows),
            "source_records_updated": len(source_changes),
        }
    )
    return dict(counts)
