"""Map search: approximate public points, and one query for cards and markers.

Two promises are pinned here. Where a typed place name comes from is
`test_place_lookup`.

* **A marker is never a door.** A property's coordinates are published only
  snapped to a fixed grid cell, and a neighbourhood centre stands in when the
  property has none (ADR 0022, ADR 0033).
* **Cards and markers are one search.** The same filters, eligibility and area
  produce the same set of listings whichever endpoint answers, and the area is
  a box the client sends — the API never looks a place up to search it.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.geo.models import Address, District, Locality, Region
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

    def test_a_chosen_place_is_searched_as_the_box_the_client_sends(self, api, landlord, accra):
        inside = _listing(landlord, accra["east_legon"], headline="Inside")

        # A link from before providers still carries a place slug. It is ignored,
        # not an error, and nothing looks it up.
        response = api.get(f"/api/v1/listings/?{_bbox(EAST_LEGON)}&place=map-east-legon")
        assert response.status_code == 200
        assert _ids(response) == {str(inside.id)}
        assert "place" not in api.get(f"/api/v1/listings/map/?{_bbox(EAST_LEGON)}&zoom=14").data

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
    def test_the_shared_map_config_names_no_provider_and_carries_no_key(self, api, settings):
        settings.GOOGLE_MAPS_SERVER_API_KEY = "server-key-must-not-leak"
        response = api.get("/api/v1/map/config/")
        config = response.data

        assert set(config) == {"bounds", "default_view", "min_zoom", "max_zoom"}
        assert len(config["bounds"]) == 4
        assert config["default_view"]["zoom"] >= config["min_zoom"]
        assert "server-key-must-not-leak" not in response.content.decode()
