"""Synthetic isolated fixtures test the importer; shipped data is the obtained full snapshot."""

import copy
import hashlib
import json

import pytest
from rest_framework.test import APIClient

from apps.geo.importing import import_snapshot, write_snapshot
from apps.geo.models import Address, District, GeoDataset, Locality, LocationSourceRecord, Region

pytestmark = pytest.mark.django_db


@pytest.fixture
def document():
    source = {
        "url": "https://www.geonames.org/",
        "license": "CC BY 4.0",
        "attribution": "GeoNames",
        "version": "test fixture",
        "sha256": "a" * 64,
    }
    return {
        "schema": 1,
        "sources": {"gss-hdx": source, "geonames": source, "osm": source},
        "regions": [{"source_id": "QA-R", "name": "QA Region"}],
        "districts": [
            {
                "source_id": "QA-D",
                "name": "QA District",
                "region_code": "QA-R",
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": [[[[-2, 5], [-1, 5], [-1, 7], [-2, 7], [-2, 5]]]],
                },
            }
        ],
        "localities": [
            {
                "source": "geonames",
                "source_id": "QA-1",
                "name": "Kumasi",
                "aliases": ["Kumase"],
                "latitude": 6.7,
                "longitude": -1.62,
                "region_code": "QA-R",
                "district_code": "QA-D",
                "parent_status": "boundary_2021",
                "kind": "PPL",
            }
        ],
    }


def test_import_is_repeatable_and_external_ids_are_stable(document):
    first = import_snapshot(document)
    row = Locality.objects.get()
    original_id = row.pk
    second = import_snapshot(document)
    assert first["localities_created"] == 1
    assert second["localities_created"] == second["source_records_created"] == 0
    assert second["localities_enriched"] == second["source_records_updated"] == 0
    assert Locality.objects.get().pk == original_id
    assert LocationSourceRecord.objects.filter(locality=row).get().source_id == "QA-1"


def test_staged_snapshot_has_a_matching_manifest_without_changing_packaged_manifest(
    document, tmp_path
):
    original = tmp_path / "manifest.json"
    original.write_text("preserved")
    staged = tmp_path / "candidate.json.gz"
    write_snapshot(document, staged)
    manifest = json.loads((tmp_path / "candidate.json.manifest.json").read_text())
    assert manifest["snapshot_sha256"] == hashlib.sha256(staged.read_bytes()).hexdigest()
    assert manifest["source_localities"] == 1
    assert original.read_text() == "preserved"
    before = staged.read_bytes()
    write_snapshot(document, staged)
    assert staged.read_bytes() == before


def test_distinct_homonyms_are_not_deduplicated_by_name(document):
    other = {**document["localities"][0], "source_id": "QA-2", "latitude": 6.9}
    document["localities"].append(other)
    import_snapshot(document)
    assert Locality.objects.filter(name="Kumasi").count() == 2


def test_unique_nearby_cross_source_identity_merges_without_losing_provenance(document):
    document["localities"].append(
        {
            **document["localities"][0],
            "source": "osm",
            "source_id": "node/1",
            "aliases": ["Additional alias"],
        }
    )
    import_snapshot(document)
    assert Locality.objects.count() == 1
    assert Locality.objects.get().source_records.count() == 2
    assert "Additional alias" in Locality.objects.get().aliases


def test_existing_location_and_address_ids_coordinates_and_written_fields_survive(document):
    region = Region.objects.create(name="QA Region", code="QR")
    district = District.objects.create(region=region, name="QA District")
    locality = Locality.objects.create(district=district, name="Kumasi", aliases=["Curated alias"])
    address = Address.objects.create(
        locality=locality,
        street="Private street must not export",
        latitude=6.712345,
        longitude=-1.612345,
    )
    import_snapshot(document)
    locality.refresh_from_db()
    address.refresh_from_db()
    assert locality.pk == address.locality_id
    assert locality.latitude is None and not locality.imported
    assert locality.district_id == district.id and district.region_id == region.id
    assert "Curated alias" in locality.aliases
    assert str(address.latitude) == "6.712345"
    assert address.street == "Private street must not export"
    response = APIClient().get("/api/v1/geo/dataset/")
    content = b"".join(response.streaming_content).decode()
    assert '"database_license": "ODbL 1.0"' in content
    assert "Private street must not export" not in content and "6.712345" not in content


def test_source_updates_change_importer_owned_reference_but_not_address_pins(document):
    import_snapshot(document)
    locality = Locality.objects.get()
    address = Address.objects.create(locality=locality, latitude=6.75, longitude=-1.65)
    document["localities"][0]["longitude"] = -1.621
    import_snapshot(document)
    locality.refresh_from_db()
    address.refresh_from_db()
    assert float(locality.longitude) == -1.621
    assert float(address.longitude) == -1.65


def test_curator_edits_are_locked_instead_of_overwritten(document):
    import_snapshot(document)
    row = Locality.objects.get()
    row.name = "Curated place name"
    row.save()
    import_snapshot(document)
    row.refresh_from_db()
    assert row.name == "Curated place name" and row.import_locked


@pytest.mark.parametrize("latitude,longitude", [(91, 0), (0, 181), (float("nan"), 0)])
def test_invalid_snapshot_rolls_back_without_partial_writes(document, latitude, longitude):
    document["localities"][0].update(latitude=latitude, longitude=longitude)
    with pytest.raises(ValueError, match="coordinate"):
        import_snapshot(document)
    assert not Region.objects.exists() and not GeoDataset.objects.exists()


def test_unknown_district_is_not_invented_and_serializes_cleanly(document):
    document["localities"][0].update(district_code=None, parent_status="unverified")
    import_snapshot(document)
    row = Locality.objects.get()
    assert row.district is None and row.region is not None
    response = APIClient().get("/api/v1/geo/locations/?q=Kumasi")
    assert response.status_code == 200
    result = response.data["results"][0]
    assert result["district"] is None and result["district_name"] == ""
    assert result["region_name"] == "QA Region" and "District unverified" in result["label"]
    assert result["sources"][0]["dataset"] == "geonames"


def test_unknown_snapshot_parent_and_duplicate_identity_are_rejected(document):
    bad = copy.deepcopy(document)
    bad["localities"][0]["district_code"] = "DOES-NOT-EXIST"
    with pytest.raises(ValueError, match="inconsistent"):
        import_snapshot(bad)
    document["localities"].append(document["localities"][0])
    with pytest.raises(ValueError, match="Duplicate"):
        import_snapshot(document)


def test_autocomplete_supports_partial_alias_typo_and_pagination(document):
    import_snapshot(document)
    api = APIClient()
    for query in ["kum", "kumase", "kumsi"]:
        response = api.get("/api/v1/geo/locations/", {"q": query})
        assert response.status_code == 200
        assert response.data["results"][0]["name"] == "Kumasi"
    for number in range(20):
        Locality.objects.create(name=f"QA community {number}")
    response = api.get("/api/v1/geo/locations/?q=QA%20community")
    assert len(response.data["results"]) == 12 and response.data["next"]
    assert api.get("/api/v1/geo/locations/?q=QA%20community&page=2").status_code == 200
    assert api.get("/api/v1/geo/locations/?q=QA&limit=100").status_code == 422
    assert api.get("/api/v1/geo/locations/?q=QA&district=not-a-uuid").status_code == 422
    assert api.get("/api/v1/geo/locations/?q=Q").data["results"] == []


def test_manual_address_is_explicitly_unverified(user, sms, sign_in_as):
    api = APIClient()
    sign_in_as(api, user=user, device_fingerprint="web")
    response = api.post(
        "/api/v1/geo/addresses/", {"place_name": "User-entered community"}, format="json"
    )
    assert response.status_code == 201
    assert response.data["location_status"] == "unverified"
    assert not Locality.objects.exists()


def test_city_alias_is_ranked_alongside_exact_names_not_hidden_by_homonyms():
    Locality.objects.create(name="Nkran", kind="hamlet")
    city = Locality.objects.create(name="Accra", kind="PPLC", aliases=["Nkran"])
    result = APIClient().get("/api/v1/geo/locations/?q=Nkran")
    assert result.status_code == 200
    assert result.data["results"][0]["id"] == str(city.id)


def test_administrative_endpoints_include_source_identity_and_available_coordinates(document):
    document["regions"][0].update(latitude=6.0, longitude=-1.5)
    document["districts"][0].update(latitude=6.1, longitude=-1.6)
    import_snapshot(document)
    api = APIClient()
    region = api.get("/api/v1/geo/regions/").data[0]
    district = api.get("/api/v1/geo/districts/").data[0]
    assert region["latitude"] == 6.0 and district["longitude"] == -1.6
    assert region["sources"][0]["source_id"] == "QA-R"
    assert district["sources"][0]["source_id"] == "QA-D"


def test_a_corroborated_supplemental_district_does_not_receive_an_invented_boundary(document):
    document["districts"][0].update(source="geonames", geometry=None)
    import_snapshot(document)
    district = District.objects.get()
    assert district.boundary is None
    assert district.source_records.get().dataset_id == "geonames"
