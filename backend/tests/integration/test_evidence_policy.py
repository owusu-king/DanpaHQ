"""Evidence requirements come from the property, not from a hardcoded list.

Before P2 a literal dict mapped a relationship type to exactly one document, so
a two-bedroom flat, a shop and a hostel bed all asked for the same single file.
These pin that requirements now vary with what the record actually says.
"""

import pytest
from rest_framework.test import APIClient

from apps.trust import evidence_policy

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


def _property(landlord, **kwargs):
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import (
        Property,
        PropertyRelationship,
        PropertyRelationshipType,
        PropertyType,
    )

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Adentan Municipal"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="Adenta"
    )
    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title="Policy Test",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street="1 Road"),
        **kwargs,
    )
    PropertyRelationship.objects.create(
        property=prop,
        user=landlord,
        relationship_type=PropertyRelationshipType.OWNER,
        granted_by=landlord,
    )
    return prop


def _unit(prop, **kwargs):
    from apps.property.models import Unit

    defaults = {
        "label": "Main",
        "bedrooms": 1,
        "bathrooms": 1,
        "space_type": "whole_property",
    }
    defaults.update(kwargs)
    return Unit.objects.create(property=prop, **defaults)


def _keys(slots):
    return [slot.key for slot in slots]


class TestSpaceRequirementsVaryWithTheSpace:
    """One required view per space, named for what the space actually is.

    The space review used to enumerate every bedroom and bathroom. That proved
    a second time what the property review had already established, and cost a
    provider with eight hostel rooms forty photographs before anything could be
    let. The property above the space has been reviewed — its front, its side,
    its surroundings and its authority document — so the space review only has
    to add the one thing that cannot show: what this room looks like inside.

    What was given up is real and is recorded in `docs/known-limitations.md`:
    a two-bedroom flat is no longer required to photograph both bedrooms.
    """

    def test_a_flat_is_asked_for_one_interior_view_and_two_invited_ones(self, landlord):
        unit = _unit(
            _property(landlord),
            bedrooms=2,
            bathrooms=2,
            space_type="apartment",
            has_private_kitchen=True,
        )

        slots = evidence_policy.space_requirements(unit)
        required = [slot for slot in slots if slot.required]

        assert len(slots) == 3
        assert [slot.key for slot in required] == ["space.overview"]

    def test_room_counts_no_longer_multiply_the_request(self, landlord):
        """A two-bed and a one-bed ask for exactly the same thing."""
        two_bed = _unit(_property(landlord), bedrooms=2, bathrooms=2, space_type="apartment")
        one_bed = _unit(_property(landlord), bedrooms=1, bathrooms=1, space_type="apartment")

        assert _keys(evidence_policy.space_requirements(two_bed)) == _keys(
            evidence_policy.space_requirements(one_bed)
        )

    def test_declared_features_are_offered_rather_than_demanded(self, landlord):
        """The kitchen is still vocabulary; it is no longer a blocker.

        `FEATURE_EVIDENCE` remains the place a new `Unit` flag is registered, so
        a feature cannot be added to the model and quietly never be showable.
        """
        unit = _unit(_property(landlord), space_type="room", has_private_kitchen=True)

        offered = _keys(evidence_policy.declared_feature_slots(unit))
        required = _keys(evidence_policy.space_requirements(unit))

        assert "space.kitchen" in offered
        assert "space.kitchen" not in required

    def test_a_shop_is_asked_for_its_inside_not_a_main_room(self, landlord):
        unit = _unit(_property(landlord), space_type="shop", bedrooms=0, bathrooms=1)

        slots = evidence_policy.space_requirements(unit)
        required = [slot for slot in slots if slot.required]

        assert required[0].key == "space.interior"
        assert "space.storefront" in _keys(slots)
        assert not any(key.startswith("space.bedroom") for key in _keys(slots))

    def test_land_is_never_asked_for_an_interior(self, landlord):
        """A plot has none, and asking produces a photograph of grass."""
        unit = _unit(_property(landlord), space_type="land", bedrooms=0, bathrooms=0)

        slots = evidence_policy.space_requirements(unit)
        required = [slot for slot in slots if slot.required]

        assert required[0].key == "space.plot"
        assert "space.overview" not in _keys(slots)

    def test_a_bed_space_asks_about_the_bed_and_invites_the_sharing(self, landlord):
        """A hostel bed is narrower than the room around it."""
        unit = _unit(_property(landlord), space_type="bed_space", bedrooms=1, bathrooms=1)

        slots = evidence_policy.space_requirements(unit)
        required = [slot for slot in slots if slot.required]
        keys = _keys(slots)

        assert required[0].key == "space.bed"
        assert "space.sleeping_arrangement" in keys
        assert "space.bathroom.shared" in keys

    def test_the_cap_and_the_upload_limit_are_the_same_number(self, landlord):
        """`spaces.photo_capacity` reads the policy rather than repeating it."""
        from apps.property import spaces

        unit = _unit(_property(landlord), space_type="apartment", bedrooms=1, bathrooms=1)

        assert spaces.photo_capacity(unit) == len(evidence_policy.space_requirements(unit))


class TestPropertyRequirements:
    def test_a_property_is_asked_for_two_named_views(self, landlord):
        """The front and the wider area — the only two ever required.

        Owner, 2026-10-20: everything else a property shows comes from what the
        provider said the compound has, so nothing is asked of a compound with
        nothing to show.
        """
        slots = evidence_policy.property_requirements(_property(landlord))

        assert _keys(slots) == ["property.front", "property.surroundings"]
        assert all(slot.required for slot in slots)

    def test_evidence_gathered_before_the_slots_were_named_still_counts(self, landlord):
        """An `exterior` photo already on file satisfies the front view.

        Renaming what we ask for must not invalidate what providers already
        sent, or a policy change would silently un-verify people.
        """
        slots = evidence_policy.property_requirements(_property(landlord))
        front = next(slot for slot in slots if slot.key == "property.front")

        assert "exterior" in front.accepts
        assert evidence_policy.missing_required(["exterior"], [front]) == []

    def test_each_shared_amenity_offers_one_optional_view(self, landlord):
        from apps.property.models import Amenity, PropertyAmenity

        prop = _property(landlord, water_source="borehole_pump", compound_type="walled_gated")
        pool = Amenity.objects.create(name="Pool (test)", category="recreation", scope="property")
        gone = Amenity.objects.create(
            name="Retired (test)", category="other", scope="property", is_active=False
        )
        PropertyAmenity.objects.create(property=prop, amenity=pool)
        PropertyAmenity.objects.create(property=prop, amenity=gone)

        slots = {slot.key: slot for slot in evidence_policy.property_requirements(prop)}

        assert set(slots) == {"property.front", "property.surroundings", f"amenity.{pool.id}"}
        assert slots[f"amenity.{pool.id}"].required is False
        assert slots[f"amenity.{pool.id}"].label == "Pool (test)"

    def test_the_details_no_longer_add_photographs(self, landlord):
        """Water, power and the compound are answered in words, not views."""
        prop = _property(
            landlord, water_source="well", power_meter_type="prepaid", compound_type="open"
        )

        assert _keys(evidence_policy.property_requirements(prop)) == [
            "property.front",
            "property.surroundings",
        ]


class TestAuthority:
    def test_each_relationship_asks_for_its_own_document(self):
        assert evidence_policy.authority_requirements("owner")[0].key == "authority.ownership"
        assert evidence_policy.authority_requirements("agent")[0].key == "authority.authorization"
        assert evidence_policy.authority_requirements("manager")[0].key == "authority.management"

    def test_alternatives_are_expressible(self):
        """The old dict could not say "a licence is also acceptable"."""
        slot = evidence_policy.authority_requirements("agent")[0]

        assert len(slot.accepts) > 1
        assert "agency_licence" in slot.accepts

    def test_an_unknown_relationship_still_asks_for_something(self):
        """Safer than letting a claim through unevidenced."""
        slots = evidence_policy.authority_requirements("something_new")

        assert slots and slots[0].required


class TestMissingRequired:
    def test_a_space_is_outstanding_until_its_one_view_arrives(self, landlord):
        unit = _unit(_property(landlord), bedrooms=2, bathrooms=1, space_type="apartment")
        slots = evidence_policy.space_requirements(unit)

        assert [slot.key for slot in evidence_policy.missing_required([], slots)] == [
            "space.overview"
        ]
        assert evidence_policy.missing_required(["interior_overview"], slots) == []

    def test_a_property_counts_its_two_views_separately(self, landlord):
        slots = evidence_policy.property_requirements(_property(landlord))

        outstanding = evidence_policy.missing_required(["property_front"], slots)

        assert {slot.key for slot in outstanding} == {"property.surroundings"}

    def test_optional_slots_are_never_missing(self, landlord):
        unit = _unit(_property(landlord), space_type="shop")
        slots = evidence_policy.space_requirements(unit)

        missing = evidence_policy.missing_required([], slots)

        assert not any(slot.key == "space.storefront" for slot in missing)


class TestEndpoint:
    def test_requirements_are_readable_by_the_screen(self, api, sign_in_as, landlord):
        prop = _property(landlord)
        unit = _unit(prop, bedrooms=2, bathrooms=1, space_type="apartment")
        sign_in_as(api, user=landlord)

        response = api.get(
            f"/api/v1/trust/evidence-requirements/?property_id={prop.id}&unit_id={unit.id}"
        )

        assert response.status_code == 200
        assert response.data["policy_version"]
        groups = {group["key"]: group for group in response.data["groups"]}
        assert set(groups) == {"property", "space"}
        # Grouped, because a screen asking for a title deed and a bathroom
        # photograph in one list is a screen nobody finishes.
        space_keys = [slot["key"] for slot in groups["space"]["slots"]]
        assert space_keys == ["space.overview", "space.entrance", "space.additional"]
        assert groups["space"]["required_count"] == 1

    def test_slots_say_why_they_are_asked_for(self, api, sign_in_as, landlord):
        prop = _property(landlord)
        sign_in_as(api, user=landlord)

        response = api.get(f"/api/v1/trust/evidence-requirements/?property_id={prop.id}")

        for slot in response.data["groups"][0]["slots"]:
            assert slot["why"], slot["key"]

    def test_someone_elses_property_is_refused(self, api, sign_in_as, landlord, agent):
        """Room counts are not public, so this cannot enumerate them."""
        prop = _property(landlord)
        sign_in_as(api, user=agent)

        response = api.get(f"/api/v1/trust/evidence-requirements/?property_id={prop.id}")

        assert response.status_code == 403

    def test_asking_for_nothing_is_refused(self, api, sign_in_as, landlord):
        sign_in_as(api, user=landlord)

        assert api.get("/api/v1/trust/evidence-requirements/").status_code == 404

    def test_it_needs_a_session(self, api):
        assert api.get(
            "/api/v1/trust/evidence-requirements/?relationship_type=owner"
        ).status_code in (401, 403)
