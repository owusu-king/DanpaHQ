"""Map search: places, approximate public points, and one query for cards and markers.

Three promises are pinned here.

* **A place is somewhere, not a string.** Suggestions rank the way a tenant
  expects and carry a centre and a box the map can fit.
* **A marker is never a door.** A property's coordinates are published only
  snapped to a fixed grid cell, and a neighbourhood centre stands in when the
  property has none (ADR 0022, ADR 0033).
* **Cards and markers are one search.** The same filters, eligibility and area
  produce the same set of listings whichever endpoint answers.
"""

from __future__ import annotations

import json

import pytest
from django.contrib.gis.geos import Point, Polygon
from django.core.management import call_command
from django.utils.text import slugify
from rest_framework.test import APIClient

from apps.geo.models import Address, District, Locality, Place, PlaceBoundsSource, PlaceKind, Region
from apps.geo.places import search_text_for
from apps.listing.location import refresh_public_locations, snap_to_cell
from apps.listing.models import Listing, ListingStatus, LocationPrecision
from apps.property.models import Property, PropertyType, Unit

pytestmark = pytest.mark.django_db

EAST_LEGON = (-0.161, 5.636)
OSU = (-0.182, 5.556)


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def accra(db):
    region = Region.objects.create(name="Map Greater Accra", code="MGA")
    district = District.objects.create(region=region, name="Map Ayawaso West")
    return {
        "region": region,
        "district": district,
        "east_legon": Locality.objects.create(
            district=district,
            name="Map East Legon",
            longitude=EAST_LEGON[0],
            latitude=EAST_LEGON[1],
        ),
        "osu": Locality.objects.create(
            district=district, name="Map Osu", longitude=OSU[0], latitude=OSU[1]
        ),
        "unplaced": Locality.objects.create(district=district, name="Map Unplaced"),
    }


def _place(
    name,
    *,
    kind=PlaceKind.NEIGHBOURHOOD,
    center=EAST_LEGON,
    half=0.01,
    locality=None,
    aliases=(),
    importance=50.0,
    active=True,
):
    lng, lat = center
    bounds = Polygon.from_bbox((lng - half, lat - half, lng + half, lat + half))
    bounds.srid = 4326
    slug = slugify(name)
    return Place.objects.create(
        slug=slug,
        name=name,
        kind=kind,
        context="Accra, Greater Accra",
        aliases=list(aliases),
        search_text=search_text_for(name, list(aliases)),
        center=Point(lng, lat, srid=4326),
        bounds=bounds,
        bounds_source=PlaceBoundsSource.ESTIMATED,
        locality=locality,
        importance=importance,
        source="test",
        source_ref=f"test/{slug}",
        is_active=active,
    )


def _listing(
    owner,
    locality,
    *,
    rent=150_000,
    status=ListingStatus.ACTIVE,
    property_point=None,
    headline="A place to rent",
):
    address = Address.objects.create(
        locality=locality,
        street="Test Road",
        longitude=property_point[0] if property_point else None,
        latitude=property_point[1] if property_point else None,
    )
    prop = Property.objects.create(
        owner=owner,
        managed_by=owner,
        created_by=owner,
        title=headline,
        property_type=PropertyType.RESIDENTIAL,
        address=address,
    )
    unit = Unit.objects.create(
        property=prop, label=headline, space_type="apartment", bedrooms=2, bathrooms=1
    )
    listing = Listing.objects.create(
        unit=unit,
        created_by=owner,
        headline=headline,
        description="Somewhere to live.",
        rent_minor=rent,
        rent_currency="GHS",
        status=status,
        locality_id_cache=locality.id,
        bedrooms_cache=2,
    )
    refresh_public_locations(Listing.objects.filter(pk=listing.pk))
    listing.refresh_from_db()
    return listing


def _ids(response):
    return {row["id"] for row in response.data["results"]}


def _marker_ids(response):
    found = set()
    for feature in response.data["features"]:
        if feature["type"] == "listing":
            found.add(feature["id"])
        else:
            assert feature["stacked"], "expected every group to be a stack at this zoom"
            found.update(feature["ids"])
    return found


def _bbox(center, half=0.02):
    lng, lat = center
    return f"west={lng - half}&south={lat - half}&east={lng + half}&north={lat + half}"


class TestPlaceSearch:
    def test_the_exact_name_leads_then_prefix_then_a_later_word(self, api):
        _place("East Legon Hills", kind=PlaceKind.SUBURB, importance=62)
        _place("East Legon", importance=58)
        _place("Legon Campus", kind=PlaceKind.LANDMARK, importance=48)

        exact = api.get("/api/v1/geo/places/?q=East Legon")
        assert [row["name"] for row in exact.data][:2] == ["East Legon", "East Legon Hills"]

        typing = api.get("/api/v1/geo/places/?q=east leg")
        assert typing.data[0]["name"] == "East Legon"

        later_word = api.get("/api/v1/geo/places/?q=legon")
        assert later_word.data[0]["name"] == "Legon Campus"
        assert {row["name"] for row in later_word.data} >= {"East Legon", "East Legon Hills"}

    def test_the_name_people_use_finds_the_place_filed_under_another(self, api):
        _place("Sakumono", aliases=["Spintex"], center=(-0.08, 5.63))
        response = api.get("/api/v1/geo/places/?q=spintex")
        assert [row["name"] for row in response.data] == ["Sakumono"]

    def test_a_misspelling_still_finds_the_place(self, api):
        _place("Dzorwulu", center=(-0.2, 5.61))
        assert api.get("/api/v1/geo/places/?q=dzorwolu").data[0]["name"] == "Dzorwulu"

    def test_inactive_places_and_one_letter_queries_return_nothing(self, api):
        _place("Retired Place", active=False)
        _place("Adenta", center=(-0.16, 5.7))
        assert api.get("/api/v1/geo/places/?q=retired").data == []
        assert api.get("/api/v1/geo/places/?q=a").data == []

    def test_a_suggestion_is_somewhere_a_map_can_fit(self, api, accra):
        _place("Map East Legon", locality=accra["east_legon"])
        row = api.get("/api/v1/geo/places/?q=map east").data[0]

        assert row["slug"] == "map-east-legon"
        assert row["kind"] == "neighbourhood"
        assert row["display_name"] == "Map East Legon, Accra"
        assert row["center"] == {"lat": EAST_LEGON[1], "lng": EAST_LEGON[0]}
        assert row["bounds"]["west"] < row["center"]["lng"] < row["bounds"]["east"]
        assert row["bounds"]["south"] < row["center"]["lat"] < row["bounds"]["north"]
        assert row["locality_id"] == str(accra["east_legon"].id)

    def test_a_shared_search_restores_its_place_by_slug(self, api):
        _place("Airport Residential Area", center=(-0.18, 5.6))
        assert api.get("/api/v1/geo/places/airport-residential-area/").data["name"] == (
            "Airport Residential Area"
        )
        missing = api.get("/api/v1/geo/places/nowhere-at-all/")
        assert missing.status_code == 404


class TestPublicPoint:
    def test_property_coordinates_are_published_snapped_never_exact(self, api, landlord, accra):
        exact = (-0.162345, 5.637891)
        listing = _listing(landlord, accra["east_legon"], property_point=exact)

        snapped_lat, snapped_lng = snap_to_cell(exact[1], exact[0])
        assert listing.public_point_precision == LocationPrecision.AREA
        assert (round(listing.public_point.x, 6), round(listing.public_point.y, 6)) == (
            snapped_lng,
            snapped_lat,
        )
        assert (snapped_lng, snapped_lat) != exact

        for url in ("/api/v1/listings/", f"/api/v1/listings/{listing.id}/"):
            response = api.get(url)
            assert "5.637891" not in response.content.decode()
            assert "-0.162345" not in response.content.decode()
        card = api.get("/api/v1/listings/").data["results"][0]
        assert card["public_location"] == {
            "latitude": snapped_lat,
            "longitude": snapped_lng,
            "precision": "area",
            "radius_m": 300,
        }

    def test_a_snapped_point_is_stable_within_its_cell(self, settings):
        settings.LISTING_PUBLIC_CELL_DEGREES = 0.0027
        # Both inside the cell spanning 5.6376 to 5.6403 N and 0.1647 to 0.1620 W.
        assert snap_to_cell(5.6380, -0.1640) == snap_to_cell(5.6395, -0.1625)
        assert snap_to_cell(5.6380, -0.1640) == (5.63895, -0.16335)
        assert snap_to_cell(5.6380, -0.1640) != snap_to_cell(5.6380, -0.1570)

    def test_the_neighbourhood_centre_stands_in_without_property_coordinates(self, landlord, accra):
        listing = _listing(landlord, accra["east_legon"])
        assert listing.public_point_precision == LocationPrecision.LOCALITY
        assert (listing.public_point.x, listing.public_point.y) == EAST_LEGON

    def test_no_point_is_invented_when_neither_is_known(self, api, landlord, accra):
        listing = _listing(landlord, accra["unplaced"])
        assert listing.public_point is None
        assert api.get(f"/api/v1/listings/{listing.id}/").data["public_location"] is None


class TestAreaSearch:
    def test_a_box_keeps_what_is_inside_and_drops_what_is_not(self, api, landlord, accra):
        inside = _listing(landlord, accra["east_legon"], headline="Inside")
        _listing(landlord, accra["osu"], headline="Outside")

        response = api.get(f"/api/v1/listings/?{_bbox(EAST_LEGON)}")
        assert _ids(response) == {str(inside.id)}

    def test_a_place_includes_what_is_filed_under_it_even_without_a_point(
        self, api, landlord, accra
    ):
        place = _place("Map Unplaced", locality=accra["unplaced"], center=(-0.3, 5.9))
        filed = _listing(landlord, accra["unplaced"], headline="Filed here")

        assert _ids(api.get(f"/api/v1/listings/?place={place.slug}")) == {str(filed.id)}
        summary = api.get(f"/api/v1/listings/map/?place={place.slug}&zoom=14").data
        assert summary["total"] == 1
        assert summary["unmapped"] == 1
        assert summary["features"] == []
        assert summary["place"]["slug"] == place.slug

    def test_what_a_tenant_cannot_act_on_is_on_neither_the_list_nor_the_map(
        self, api, landlord, accra
    ):
        live = _listing(landlord, accra["east_legon"], headline="Live")
        _listing(landlord, accra["east_legon"], headline="Draft", status=ListingStatus.DRAFT)

        area = _bbox(EAST_LEGON)
        assert _ids(api.get(f"/api/v1/listings/?{area}")) == {str(live.id)}
        markers = api.get(f"/api/v1/listings/map/?{area}&zoom=18")
        assert markers.data["total"] == 1
        assert _marker_ids(markers) == {str(live.id)}

    def test_cards_and_markers_answer_the_same_filters_with_the_same_listings(
        self, api, landlord, accra
    ):
        cheap = _listing(landlord, accra["east_legon"], rent=100_000, headline="Cheap")
        middle = _listing(landlord, accra["east_legon"], rent=200_000, headline="Middle")
        _listing(landlord, accra["east_legon"], rent=300_000, headline="Dear")

        query = f"{_bbox(EAST_LEGON)}&rent_max=200000"
        cards = _ids(api.get(f"/api/v1/listings/?{query}"))
        markers = api.get(f"/api/v1/listings/map/?{query}&zoom=18")

        assert cards == {str(cheap.id), str(middle.id)}
        assert _marker_ids(markers) == cards
        assert markers.data["total"] == len(cards)

    def test_bounds_must_arrive_whole_and_the_right_way_round(self, api):
        partial = api.get("/api/v1/listings/?north=5.7&south=5.5")
        assert partial.status_code == 422
        inverted = api.get("/api/v1/listings/?west=0.1&south=5.5&east=-0.1&north=5.7")
        assert inverted.status_code == 422

    def test_an_area_that_no_longer_exists_says_so(self, api):
        response = api.get("/api/v1/listings/?place=a-place-that-was-removed")
        assert response.status_code == 404
        assert response.data["error"]["code"] == "not_found"
        assert response.data["error"]["details"] == {"place": "a-place-that-was-removed"}


class TestMarkers:
    def test_listings_sharing_one_point_are_a_stack_that_carries_their_ids(
        self, api, landlord, accra
    ):
        homes = {_listing(landlord, accra["east_legon"], headline=f"Home {n}").id for n in range(3)}

        features = api.get(f"/api/v1/listings/map/?{_bbox(EAST_LEGON)}&zoom=18").data["features"]
        assert len(features) == 1
        assert features[0]["type"] == "cluster"
        assert features[0]["stacked"] is True
        assert features[0]["count"] == 3
        assert set(features[0]["ids"]) == {str(pk) for pk in homes}

    def test_near_listings_cluster_far_out_and_separate_close_in(self, api, landlord, accra):
        _listing(landlord, accra["east_legon"], property_point=(-0.1600, 5.6310), headline="A")
        _listing(landlord, accra["east_legon"], property_point=(-0.1550, 5.6350), headline="B")

        area = _bbox(EAST_LEGON)
        far = api.get(f"/api/v1/listings/map/?{area}&zoom=10").data["features"]
        assert [(f["type"], f["count"], f["stacked"]) for f in far] == [("cluster", 2, False)]
        assert far[0]["ids"] is None

        close = api.get(f"/api/v1/listings/map/?{area}&zoom=17").data["features"]
        assert sorted(f["type"] for f in close) == ["listing", "listing"]
        assert all(f["rent_currency"] == "GHS" and f["rent_period"] == "monthly" for f in close)

    def test_the_window_limits_the_markers_but_never_the_total(self, api, landlord, accra):
        _listing(landlord, accra["east_legon"], headline="North")
        _listing(landlord, accra["osu"], headline="South")

        both = "west=-0.25&south=5.5&east=-0.1&north=5.7"
        view = "view_west=-0.2&view_south=5.53&view_east=-0.16&view_north=5.58"
        response = api.get(f"/api/v1/listings/map/?{both}&{view}&zoom=15").data
        assert response["total"] == 2
        assert len(response["features"]) == 1

        refetch = api.get(f"/api/v1/listings/map/?{both}&{view}&zoom=16&summary=false").data
        assert "total" not in refetch
        assert len(refetch["features"]) == 1

    def test_the_extent_covers_every_mapped_result(self, api, landlord, accra):
        _listing(landlord, accra["east_legon"], headline="North")
        _listing(landlord, accra["osu"], headline="South")
        extent = api.get("/api/v1/listings/map/?zoom=8").data["extent"]
        assert extent["west"] <= OSU[0] <= extent["east"]
        assert extent["south"] <= OSU[1] < EAST_LEGON[1] <= extent["north"]


class TestMapConfig:
    def test_clients_learn_where_the_basemap_lives(self, api):
        config = api.get("/api/v1/map/config/").data
        assert config["tiles_url"].startswith("pmtiles://")
        assert config["tiles_url"].endswith(".pmtiles")
        assert "{fontstack}" in config["glyphs_url"]
        assert "{range}" in config["glyphs_url"]
        assert "OpenStreetMap" in config["attribution"]
        assert len(config["bounds"]) == 4


class TestOsmImport:
    def _export(self, tmp_path, elements):
        path = tmp_path / "places.json"
        path.write_text(json.dumps({"elements": elements}), encoding="utf-8")
        return str(path)

    def test_places_are_merged_linked_and_given_centres(self, tmp_path):
        region = Region.objects.create(name="Import Greater Accra", code="IGA")
        district = District.objects.create(region=region, name="Import Ayawaso West")
        locality = Locality.objects.create(
            district=district, name="Import Legon", aliases=["Legon"]
        )
        elements = [
            {
                "type": "relation",
                "id": 1,
                "tags": {
                    "boundary": "administrative",
                    "admin_level": "4",
                    "name": "Import Greater Accra Region",
                },
                "center": {"lat": 5.8, "lon": -0.2},
                "bounds": {"minlat": 5.4, "minlon": -0.6, "maxlat": 6.2, "maxlon": 0.2},
            },
            {
                "type": "node",
                "id": 2,
                "lat": 5.56,
                "lon": -0.2,
                "tags": {"place": "city", "name": "Accra"},
            },
            {
                "type": "node",
                "id": 3,
                "lat": 5.636,
                "lon": -0.161,
                "tags": {"place": "suburb", "name": "Import Legon", "alt_name": "Legon Village"},
            },
            {
                "type": "way",
                "id": 4,
                "tags": {"place": "suburb", "name": "Import Legon"},
                "center": {"lat": 5.637, "lon": -0.160},
                "bounds": {"minlat": 5.62, "minlon": -0.18, "maxlat": 5.65, "maxlon": -0.14},
            },
            # The same name in another region is somewhere else entirely.
            {
                "type": "node",
                "id": 5,
                "lat": 9.4,
                "lon": -0.85,
                "tags": {"place": "village", "name": "Import Legon"},
            },
            {
                "type": "way",
                "id": 6,
                "tags": {"aeroway": "aerodrome", "name": "Import Airport"},
                "center": {"lat": 5.6, "lon": -0.17},
            },
        ]
        export = self._export(tmp_path, elements)

        call_command("import_osm_places", export)

        legon = Place.objects.get(locality=locality)
        assert legon.source_ref == "way/4", "the mapped outline wins the merge"
        assert legon.bounds_source == PlaceBoundsSource.MAPPED
        assert "Legon Village" in legon.aliases
        assert legon.context == "Accra, Import Greater Accra"
        assert legon.region == region
        assert (
            Place.objects.filter(name="Import Legon").count() == 2
        ), "the far village stays separate"
        assert Place.objects.get(name="Import Airport").kind == PlaceKind.LANDMARK
        assert Place.objects.get(name="Import Greater Accra").kind == PlaceKind.REGION

        locality.refresh_from_db()
        assert (float(locality.latitude), float(locality.longitude)) == (5.637, -0.16)

        slug = legon.slug
        call_command("import_osm_places", export)
        assert Place.objects.get(source_ref="way/4").slug == slug
        assert Place.objects.filter(source="osm").count() == 5

    def test_an_incomplete_download_is_refused_rather_than_half_imported(self, tmp_path):
        path = tmp_path / "broken.json"
        path.write_text(
            '{"elements": [{"type": "node", "id": 1, "tags": {"name": "E', encoding="utf-8"
        )
        from django.core.management.base import CommandError

        with pytest.raises(CommandError, match="not complete JSON"):
            call_command("import_osm_places", str(path))
        assert Place.objects.count() == 0
