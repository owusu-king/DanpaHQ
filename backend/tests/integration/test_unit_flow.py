"""The rentable space: what it is, what it shows, and what it may do.

A `Unit` belongs to a `Property` and inherits everything about *where* it is
through that relationship. What it carries itself is what is being let: its own
type, description, amenities, photographs, and three lifecycles that move
independently — whether it has been checked, whether it is being offered
publicly, and whether it can still be taken.

These pin the rules that would otherwise only exist in a form:

* a space is never a second copy of the address
* the type must be one the property's category permits
* the details are editable while the space is with the provider, and not while
  a reviewer is holding it
* one required overview plus one photograph for every selected amenity, and
  they are the same photographs the listing shows
* nothing reaches a tenant — privately or publicly — before the check passes
* verification and publication are separate, in both directions
"""

import pytest
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.trust import condition

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture(autouse=True)
def memory_storage(settings):
    from apps.files.storage import get_storage, reset_storage

    settings.STORAGE_BACKEND = "memory"
    reset_storage()
    yield get_storage()
    reset_storage()


@pytest.fixture
def amenities(db):
    from django.core.management import call_command

    call_command("seed_amenities", verbosity=0)


@pytest.fixture
def held(landlord, approve_provider, db):
    """A residential property this landlord has been reviewed as holding."""
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import Property, PropertyType, Unit

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Ayawaso West"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="East Legon"
    )
    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title="Boundary Road block",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(
            locality=locality,
            street="14 Boundary Road",
            house_number="14",
            landmark="Behind the filling station",
        ),
    )
    approve_provider(landlord, prop)
    unit = Unit.objects.create(
        property=prop,
        label="Flat A",
        space_type="apartment",
        bedrooms=2,
        bathrooms=1,
    )
    return prop, unit


def _photo(user, purpose="property_photo", sensitive=False):
    from apps.files.models import ScanStatus, StoredFile, UploadStatus

    return StoredFile.objects.create(
        uploaded_by=user,
        owner_id_snapshot=str(user.id),
        purpose=purpose,
        is_sensitive=sensitive,
        original_filename="room.jpg",
        declared_content_type="image/jpeg",
        content_type="image/jpeg",
        size_bytes=90_000,
        storage_key=f"photos/{user.id}/{StoredFile.objects.count()}.jpg",
        upload_status=UploadStatus.READY,
        scan_status=ScanStatus.CLEAN,
    )


def _fill_required(unit, landlord):
    """Every photograph this draft must show, through the real service."""
    from apps.property import spaces
    from apps.trust import evidence_policy

    attached = [
        spaces.attach_photo(
            unit=unit,
            user=landlord,
            file=_photo(landlord),
            slot_key=slot.key,
        )
        for slot in evidence_policy.space_requirements(unit)
        if slot.required
    ]
    return attached[0]


def _fill(subject, landlord, keys):
    """Attach one photograph against each named evidence slot.

    Used for the *property's* slots, which have no media endpoint of their own —
    a space's photographs go through `spaces.attach_photo`, a property's through
    the condition flow directly.
    """
    for key in keys:
        condition.attach(subject=subject, actor=landlord, slot_key=key, file=_photo(landlord))


def _approve_open_review(unit, landlord, reviewer=None):
    """Send the space's own review, and approve it.

    Not the `approve_space` fixture: that writes a fresh approved row, and a
    space that already has an open review cannot have two — `trust_one_live_verification`
    refuses it. Where a test has attached photographs, this is the path the
    product actually takes.
    """
    from apps.trust import condition
    from apps.trust import services as trust_services

    review = condition.submit_for_review(subject=unit, actor=landlord)
    return trust_services.decide(review, approved=True, decided_by=reviewer, note="")


@pytest.fixture
def unclaimed(landlord, provider_standing, db):
    """A property held privately through an organization, and not yet verified.

    Two things about it matter, and both were involved in the faults this file
    pins:

    * **No `PropertyRelationship`.** The private and claim flows deliberately
      create none — being first to type an address is a claim, not proof — and
      the relationship is materialised later by a reviewed authority workflow.
    * **No `PROPERTY_AUTHORITY` verification.** Nobody has confirmed the
      provider holds it.

    This is where every provider starts, so it is where the space flow has to
    work.
    """
    from django.utils import timezone

    from apps.geo.models import Address, District, Locality, Region
    from apps.organization.models import (
        MembershipRole,
        Organization,
        OrganizationMembership,
        OrganizationPropertyRelationship,
        OrganizationPropertyRole,
    )
    from apps.property.models import Property, PropertyType, Unit

    provider_standing(landlord)
    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Ayawaso West"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="East Legon"
    )
    organization = Organization.objects.create(name="Draft Lettings", created_by=landlord)
    OrganizationMembership.objects.create(
        organization=organization,
        user=landlord,
        role=MembershipRole.OWNER,
        joined_at=timezone.now(),
    )
    prop = Property.objects.create(
        created_by=landlord,
        title="Unclaimed block",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street="3 Draft Road"),
    )
    # No `authority_verification_id`: the organization holds the property, and
    # nobody has yet confirmed that it may let it.
    OrganizationPropertyRelationship.objects.create(
        organization=organization,
        property=prop,
        relationship_type=OrganizationPropertyRole.OWNER,
        granted_by=landlord,
    )
    unit = Unit.objects.create(
        property=prop, label="Flat A", space_type="apartment", bedrooms=1, bathrooms=1
    )
    return prop, unit


def _verify_property_authority(prop):
    """Approve the property's authority, without writing a relationship.

    Deliberately not the `approve_provider` fixture: that also creates the
    `PropertyRelationship`, which would hide whether the space flow depends on
    one. An organization-held property is verified and has no direct
    relationship, and it must work.
    """
    from django.utils import timezone

    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    return Verification.objects.get_or_create(
        subject_type=SubjectType.PROPERTY,
        subject_id=str(prop.id),
        kind=VerificationKind.PROPERTY_AUTHORITY,
        status=VerificationStatus.APPROVED,
        defaults={"method": VerificationMethod.DOCUMENT_REVIEW, "decided_at": timezone.now()},
    )[0]


def _verify_property_condition(prop):
    """Approve the photograph half of the unified property submission."""
    from django.utils import timezone

    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    return Verification.objects.get_or_create(
        subject_type=SubjectType.PROPERTY,
        subject_id=str(prop.id),
        kind=VerificationKind.PROPERTY_CONDITION,
        status=VerificationStatus.APPROVED,
        defaults={"method": VerificationMethod.SITE_VISIT, "decided_at": timezone.now()},
    )[0]


def _verify_property(prop):
    _verify_property_authority(prop)
    _verify_property_condition(prop)


class TestASpaceInheritsItsProperty:
    def test_it_carries_no_address_of_its_own(self, held):
        """Where a space is comes from the property, through the relationship.

        A flat with its own copy of the address is a flat that can disagree with
        the building it is in about where the building is.
        """
        from apps.property.models import Unit

        columns = {field.name for field in Unit._meta.get_fields()}

        assert "address" not in columns
        assert "locality" not in columns
        assert "latitude" not in columns

    def test_only_what_differs_inside_one_address(self, held, landlord, api, sign_in_as):
        """Floor, wing, door and label — the things that vary between two flats."""
        from apps.property import spaces

        _, unit = held
        spaces.update_space(
            unit=unit,
            user=landlord,
            data={
                "floor_level": 2,
                "wing": "West",
                "entrance_note": "Blue door at the top of the outside stairs",
            },
        )

        sign_in_as(api, user=landlord)
        detail = api.get(f"/api/v1/units/{unit.id}/")

        assert detail.status_code == 200
        assert detail.data["floor_level"] == 2
        assert detail.data["wing"] == "West"
        # And the address is read from the property rather than copied.
        assert detail.data["property"]["address"]["locality_name"] == "East Legon"

    def test_the_type_must_be_one_the_category_permits(self, held, landlord):
        from apps.property import services

        prop, _ = held

        with pytest.raises(ValidationFailed) as raised:
            services.add_unit(
                prop=prop, user=landlord, data={"space_type": "warehouse", "bedrooms": 0}
            )

        assert "residential" in str(raised.value).lower()


class TestThreeLifecycles:
    """Verification, publication and availability, never one field."""

    def test_a_new_space_is_draft_private_and_available(self, held, landlord, api, sign_in_as):
        _, unit = held
        sign_in_as(api, user=landlord)

        detail = api.get(f"/api/v1/units/{unit.id}/").data

        assert detail["verification"]["state"] == "draft"
        assert detail["publication"]["state"] == "private"
        assert detail["availability"]["state"] == "available"

    def test_verified_and_private_is_expressible(
        self, held, landlord, approve_space, api, sign_in_as
    ):
        """The combination a single status field could not say.

        A provider who gets a room checked has not agreed to advertise it, and a
        product that treats the check as publication has published something on
        their behalf.
        """
        _, unit = held
        approve_space(unit)
        sign_in_as(api, user=landlord)

        detail = api.get(f"/api/v1/units/{unit.id}/").data

        assert detail["verification"]["state"] == "verified"
        assert detail["publication"]["state"] == "private"

    def test_occupancy_decides_availability_not_the_listing(
        self, held, landlord, registered, approve_space
    ):
        """A room let privately is not available, advertisement or none."""
        from apps.occupancy.models import Occupancy, OccupancyStatus
        from apps.property.serializers import unit_availability

        prop, unit = held
        approve_space(unit)
        tenant = registered("0209693001")
        Occupancy.objects.create(
            property=prop, unit=unit, user=tenant, status=OccupancyStatus.PENDING_LEASE
        )

        assert unit_availability(unit)["state"] == "occupied"


class TestEditing:
    def test_a_draft_space_may_be_corrected(self, held, landlord):
        from apps.property import spaces

        _, unit = held
        spaces.update_space(unit=unit, user=landlord, data={"label": "Flat A1"})
        unit.refresh_from_db()

        assert unit.label == "Flat A1"

    def test_a_plot_still_cannot_acquire_bathrooms(self, held, landlord):
        """The same `space_rules` the creation path uses, on the edit path too.

        A rule enforced only where the form posts is a rule the API does not
        have.
        """
        from apps.property import services, spaces
        from apps.property.models import Property, PropertyType

        prop, _ = held
        Property.objects.filter(id=prop.id).update(property_type=PropertyType.COMMERCIAL)
        prop.refresh_from_db()
        plot = services.add_unit(
            prop=prop, user=landlord, data={"space_type": "land", "bedrooms": 0, "bathrooms": 0}
        )

        with pytest.raises(ValidationFailed):
            spaces.update_space(unit=plot, user=landlord, data={"bathrooms": 2})

    def test_editing_stops_once_a_reviewer_holds_it(self, held, landlord):
        from apps.property import spaces
        from apps.trust import condition

        _, unit = held
        _fill_required(unit, landlord)
        condition.submit_for_review(subject=unit, actor=landlord)

        with pytest.raises(Conflict) as raised:
            spaces.update_space(unit=unit, user=landlord, data={"label": "Changed"})

        assert "review" in str(raised.value).lower()

    def test_an_approved_space_is_fixed_as_it_was_approved(self, held, landlord, approve_space):
        from apps.property import spaces

        _, unit = held
        approve_space(unit)

        with pytest.raises(Conflict) as raised:
            spaces.update_space(unit=unit, user=landlord, data={"label": "Changed"})

        assert "re-check" in str(raised.value).lower()

    def test_a_stranger_cannot_read_or_change_it(self, held, landlord, registered):
        from apps.core.exceptions import NotFound
        from apps.property import spaces

        _, unit = held
        stranger = registered("0209693002")

        with pytest.raises(NotFound):
            spaces.get_space_or_404(unit.id, stranger)
        with pytest.raises(PermissionDenied):
            spaces.update_space(unit=unit, user=stranger, data={"label": "Mine now"})

    def test_reclassifying_is_refused_once_it_has_been_advertised(self, held, landlord):
        from apps.listing.models import Listing
        from apps.property import spaces

        _, unit = held
        Listing.objects.create(
            unit=unit,
            created_by=landlord,
            headline="Advertised",
            description="Already out there.",
            rent_minor=100000,
            rent_currency="GHS",
            # `status` on create, not the axes: `Listing.save` derives the axes
            # from it when a row is being added, and would otherwise reset them.
            status="active",
        )

        with pytest.raises(Conflict):
            spaces.change_space_type(unit=unit, user=landlord, space_type="room")


class TestAmenities:
    def test_the_picker_is_scoped_and_filtered_by_space_type(self, amenities, api):
        """A hostel bed is not offered a porch, and a room is not offered a pool."""
        for_room = api.get("/api/v1/amenity-options/?scope=unit&space_type=room")
        for_bed = api.get("/api/v1/amenity-options/?scope=unit&space_type=bed_space")
        for_property = api.get("/api/v1/amenity-options/?scope=property")

        room_names = {row["name"] for row in for_room.data["amenities"]}
        bed_names = {row["name"] for row in for_bed.data["amenities"]}
        property_names = {row["name"] for row in for_property.data["amenities"]}

        assert {"Self meter", "Private bathroom", "Porch", "Kitchen"} <= room_names
        assert "Porch" not in bed_names
        assert "Swimming pool" not in room_names
        assert "Swimming pool" in property_names
        assert "Self meter" not in property_names

    def test_the_five_the_product_starts_with_are_unit_scoped(self, amenities):
        from apps.property.models import Amenity, AmenityScope

        for name in ("Self meter", "Private bathroom", "Water in the unit", "Porch", "Kitchen"):
            amenity = Amenity.objects.get(name=name)
            assert amenity.scope == AmenityScope.UNIT, name
            assert amenity.is_active, name

    def test_choosing_an_amenity_keeps_the_declared_flag_in_step(self, amenities, held, landlord):
        """One question, one answer.

        `has_private_kitchen` is read by the evidence vocabulary and
        `is_furnished` by public search. An amenity checklist that did not write
        them would be a second, disagreeing record of the same fact.
        """
        from apps.property import spaces
        from apps.property.models import Amenity

        _, unit = held
        kitchen = Amenity.objects.get(name="Kitchen")
        unit.has_private_kitchen = False
        unit.save(update_fields=["has_private_kitchen"])

        spaces.set_space_amenities(unit=unit, user=landlord, amenity_ids=[kitchen.id])
        unit.refresh_from_db()

        assert unit.has_private_kitchen is True

        spaces.set_space_amenities(unit=unit, user=landlord, amenity_ids=[])
        unit.refresh_from_db()

        assert unit.has_private_kitchen is False

    def test_removing_an_amenity_keeps_it_answerable(self, amenities, held, landlord):
        """ "The generator was working when I signed" survives the generator."""
        from apps.property import spaces
        from apps.property.models import Amenity, UnitAmenity

        _, unit = held
        porch = Amenity.objects.get(name="Porch")
        spaces.set_space_amenities(unit=unit, user=landlord, amenity_ids=[porch.id])
        spaces.set_space_amenities(unit=unit, user=landlord, amenity_ids=[])

        row = UnitAmenity.objects.get(unit=unit, amenity=porch)
        assert row.removed_at is not None

    def test_an_amenity_the_space_cannot_have_is_refused(self, amenities, held, landlord):
        from apps.property import spaces
        from apps.property.models import Amenity

        _, unit = held
        pool = Amenity.objects.get(name="Swimming pool")

        with pytest.raises(ValidationFailed):
            spaces.set_space_amenities(unit=unit, user=landlord, amenity_ids=[pool.id])

    def test_property_amenities_are_a_separate_set(self, amenities, held, landlord):
        from apps.property import spaces
        from apps.property.models import Amenity

        prop, _ = held
        guard = Amenity.objects.get(name="Security guard")

        rows = spaces.set_property_amenities(prop=prop, user=landlord, amenity_ids=[guard.id])

        assert [row.amenity.name for row in rows] == ["Security guard"]
        prop.refresh_from_db()
        assert prop.amenities_confirmed_at is not None
        assert not prop.units.first().unit_amenities.filter(removed_at__isnull=True).exists()

    def test_confirming_no_shared_amenities_is_persisted(self, amenities, held, landlord):
        """An empty compound checklist is an answer, not an untouched draft."""
        from apps.property import spaces

        prop, _ = held
        assert prop.amenities_confirmed_at is None

        rows = spaces.set_property_amenities(prop=prop, user=landlord, amenity_ids=[])

        prop.refresh_from_db()
        assert rows == []
        assert prop.amenities_confirmed_at is not None

    def test_each_selected_unit_amenity_requires_its_own_photo(self, amenities, held, landlord):
        """An amenity claim and its evidence cannot drift apart.

        Stable slot keys matter here: Kitchen and Private bathroom are two
        promises even when a future pair of amenities shares an evidence type.
        """
        from apps.property import spaces
        from apps.property.models import Amenity

        _, unit = held
        selected = Amenity.objects.filter(name__in=["Kitchen", "Private bathroom"])
        spaces.set_space_amenities(
            unit=unit,
            user=landlord,
            amenity_ids=list(selected.values_list("id", flat=True)),
        )

        state = condition.progress(subject=unit, user=landlord)
        amenity_slots = [row for row in state["slots"] if row["key"].startswith("amenity.")]

        assert state["required_total"] == 3  # overview + both amenities
        assert {row["label"] for row in amenity_slots} == {
            "Photo of kitchen",
            "Photo of private bathroom",
        }
        assert all(row["required"] for row in amenity_slots)
        assert spaces.photo_capacity(unit) == 5  # plus two optional context views

        spaces.attach_photo(
            unit=unit,
            user=landlord,
            file=_photo(landlord),
            slot_key="space.overview",
        )
        assert condition.progress(subject=unit, user=landlord)["required_outstanding"] == 2

        for slot in amenity_slots:
            spaces.attach_photo(
                unit=unit,
                user=landlord,
                file=_photo(landlord),
                slot_key=slot["key"],
            )

        complete = condition.progress(subject=unit, user=landlord)
        assert complete["required_outstanding"] == 0
        assert complete["can_submit"] is True


class TestPhotographs:
    def test_the_first_photograph_becomes_the_primary_one(self, held, landlord):
        from apps.property import spaces

        _, unit = held
        first = _fill_required(unit, landlord)
        second = spaces.attach_photo(unit=unit, user=landlord, file=_photo(landlord))

        assert first.is_primary is True
        assert second.is_primary is False

    def test_a_photograph_is_also_the_evidence(self, held, landlord):
        """One upload, two consequences.

        Photographing a room once for a reviewer and again for a tenant is how
        the reviewed room and the advertised room become different rooms.
        """
        from apps.trust import condition

        _, unit = held
        media = _fill_required(unit, landlord)

        review = condition.current_review(unit)
        assert review is not None
        assert review.evidence.filter(file_id=media.file_id).exists()
        assert condition.progress(subject=unit, user=landlord)["can_submit"] is True

    def test_a_space_carries_one_required_photograph_and_two_more(self, held, landlord):
        from apps.property import spaces

        _, unit = held
        assert spaces.photo_capacity(unit) == 3

        for _ in range(3):
            spaces.attach_photo(unit=unit, user=landlord, file=_photo(landlord))

        with pytest.raises(Conflict):
            spaces.attach_photo(unit=unit, user=landlord, file=_photo(landlord))

    def test_an_identity_document_cannot_become_a_space_photograph(self, held, landlord):
        """These are shown publicly. A Ghana Card must never cross that line."""
        from apps.property import spaces

        _, unit = held
        card = _photo(landlord, purpose="identity_document", sensitive=True)

        with pytest.raises(ValidationFailed):
            spaces.attach_photo(unit=unit, user=landlord, file=card)

    def test_removing_a_photograph_withdraws_its_evidence(self, held, landlord):
        """Otherwise a space could be submitted on a photograph nobody can see."""
        from apps.property import spaces
        from apps.trust import condition

        _, unit = held
        media = _fill_required(unit, landlord)
        assert condition.progress(subject=unit, user=landlord)["can_submit"] is True

        spaces.remove_photo(unit=unit, user=landlord, media_id=media.id)

        state = condition.progress(subject=unit, user=landlord)
        assert state["can_submit"] is False
        assert state["required_outstanding"] == 1

    def test_removing_the_primary_promotes_another(self, held, landlord):
        from apps.property import spaces
        from apps.property.models import UnitMedia

        _, unit = held
        first = _fill_required(unit, landlord)
        spaces.attach_photo(unit=unit, user=landlord, file=_photo(landlord))

        spaces.remove_photo(unit=unit, user=landlord, media_id=first.id)

        assert UnitMedia.objects.filter(unit=unit, is_primary=True).count() == 1

    def test_photographs_cannot_be_swapped_while_a_reviewer_holds_them(self, held, landlord):
        from apps.property import spaces
        from apps.trust import condition

        _, unit = held
        media = _fill_required(unit, landlord)
        condition.submit_for_review(subject=unit, actor=landlord)

        with pytest.raises(Conflict):
            spaces.remove_photo(unit=unit, user=landlord, media_id=media.id)


class TestTheVerificationLifecycle:
    """DRAFT → READY → SUBMITTED → UNDER REVIEW → VERIFIED."""

    def test_it_walks_the_whole_way(self, held, landlord, staff):
        from django.utils import timezone

        from apps.trust import condition
        from apps.trust import services as trust_services
        from apps.trust.models import ReviewQueueEntry

        _, unit = held
        assert condition.lifecycle_state(unit) == "draft"

        _fill_required(unit, landlord)
        assert condition.lifecycle_state(unit) == "ready_for_submission"

        review = condition.submit_for_review(subject=unit, actor=landlord)
        assert condition.lifecycle_state(unit) == "submitted"

        entry = ReviewQueueEntry.objects.get(verification=review)
        entry.claimed_by = staff
        entry.claimed_at = timezone.now()
        entry.save(update_fields=["claimed_by", "claimed_at"])
        assert condition.lifecycle_state(unit) == "under_review"

        trust_services.decide(review, approved=True, decided_by=staff, note="")
        assert condition.lifecycle_state(unit) == "verified"

    def test_changes_requested_reopens_editing(self, held, landlord, staff):
        from apps.property import spaces
        from apps.trust import condition
        from apps.trust.models import VerificationStatus

        _, unit = held
        _fill_required(unit, landlord)
        review = condition.submit_for_review(subject=unit, actor=landlord)

        review.status = VerificationStatus.NEEDS_MORE
        review.decision_note = "The photograph is too dark to see the room."
        review.save(update_fields=["status", "decision_note"])

        assert condition.lifecycle_state(unit) == "changes_requested"
        # And the provider can act on it, which is the whole point of the state.
        spaces.update_space(unit=unit, user=landlord, data={"label": "Flat A (rear)"})

    def test_the_state_is_served_rather_than_derived_by_each_client(
        self, held, landlord, api, sign_in_as
    ):
        _, unit = held
        _fill_required(unit, landlord)
        sign_in_as(api, user=landlord)

        detail = api.get(f"/api/v1/units/{unit.id}/").data

        assert detail["verification"]["state"] == "ready_for_submission"
        assert detail["verification"]["state_label"] == "Ready to send"
        assert detail["verification"]["can_submit"] is True
        assert detail["permitted_actions"]["submit_for_verification"]["allowed"] is True


class TestNothingReachesATenantBeforeTheCheck:
    def test_a_private_access_code_is_refused(self, held, landlord, registered):
        from apps.property import access_codes

        _, unit = held

        with pytest.raises(Conflict) as raised:
            access_codes.rotate(unit=unit, actor=landlord)

        assert "verified" in str(raised.value).lower()

    def test_publishing_is_refused(self, held, landlord):
        from apps.listing import services as listing_services

        _, unit = held
        listing = listing_services.create_listing(
            user=landlord,
            unit=unit,
            data={
                "rent_minor": 180000,
                "headline": "Two bedroom off Boundary Road",
                "description": "Prepaid meter, borehole water.",
            },
        )

        with pytest.raises(Conflict):
            listing_services.publish_listing(listing=listing, user=landlord)

    def test_the_client_is_told_why_rather_than_left_to_guess(
        self, held, landlord, api, sign_in_as
    ):
        _, unit = held
        sign_in_as(api, user=landlord)

        actions = api.get(f"/api/v1/units/{unit.id}/").data["permitted_actions"]

        assert actions["publish"]["allowed"] is False
        assert actions["invite_tenant"]["allowed"] is False
        assert actions["publish"]["blockers"], "a refusal with nothing to act on"


class TestAccessCodeVerificationBoundary:
    def test_draft_pending_and_rejected_spaces_have_no_code(self, held, landlord, api, sign_in_as):
        from apps.trust import services as trust_services

        _, unit = held
        sign_in_as(api, user=landlord)

        assert unit.access_code_hash is None
        detail = api.get(f"/api/v1/units/{unit.id}/").data
        assert detail["join_code"] is None
        assert detail["access_code"]["state"] == "unavailable"

        _fill_required(unit, landlord)
        review = condition.submit_for_review(subject=unit, actor=landlord)
        unit.refresh_from_db()
        assert unit.access_code_hash is None
        assert api.get(f"/api/v1/units/{unit.id}/").data["access_code"]["state"] == "unavailable"

        trust_services.decide(
            review,
            approved=False,
            note="The room details do not match the submitted photograph.",
        )
        unit.refresh_from_db()
        assert unit.access_code_hash is None
        assert api.get(f"/api/v1/units/{unit.id}/").data["access_code"]["state"] == "unavailable"

    def test_unverified_legacy_code_cannot_be_created_read_or_used(
        self, held, landlord, registered, sign_in_as
    ):
        from datetime import timedelta

        from django.conf import settings
        from django.utils import timezone
        from rest_framework.test import APIClient

        from apps.core.crypto import hash_secret
        from apps.occupancy import services as occupancy_services
        from apps.property import access_codes
        from apps.property.models import Unit

        prop, unit = held
        raw_code = "ABCDEF1234"
        Unit.objects.filter(id=unit.id).update(
            access_code_hash=hash_secret(raw_code, pepper=settings.UNIT_ACCESS_CODE_PEPPER),
            access_code_issued_at=timezone.now(),
            access_code_expires_at=timezone.now() + timedelta(days=1),
            access_code_version=1,
        )
        unit.refresh_from_db()

        with pytest.raises(Conflict):
            access_codes.rotate(unit=unit, actor=landlord)

        provider_api = APIClient()
        sign_in_as(provider_api, user=landlord)
        detail = provider_api.get(f"/api/v1/units/{unit.id}/").data
        assert detail["join_code"] is None
        assert detail["access_code"]["state"] == "unavailable"
        assert "access_code_hash" not in detail
        rotate_response = provider_api.post(
            f"/api/v1/units/{unit.id}/access-code/rotate/", {}, format="json"
        )
        assert rotate_response.status_code == 409

        tenant = registered("0209694010")
        tenant_api = APIClient()
        sign_in_as(tenant_api, user=tenant)
        lookup = tenant_api.get(f"/api/v1/property-join-lookup/?code={raw_code}")
        assert lookup.status_code == 404
        request = tenant_api.post(
            f"/api/v1/properties/{prop.id}/join-requests/",
            {"unit_id": str(unit.id), "access_code": raw_code},
            format="json",
        )
        assert request.status_code == 404
        with pytest.raises(NotFound):
            occupancy_services.create_join_request(
                user=tenant,
                prop=prop,
                unit=unit,
                access_code=raw_code,
            )

    def test_verified_provider_explicitly_issues_a_code_that_is_shown_once(
        self, held, landlord, registered, api, sign_in_as
    ):
        from rest_framework.test import APIClient

        from apps.idempotency.models import IdempotencyKey
        from apps.trust import services as trust_services

        prop, unit = held
        _fill_required(unit, landlord)
        review = condition.submit_for_review(subject=unit, actor=landlord)
        trust_services.decide(review, approved=True, note="The space matches its evidence.")
        unit.refresh_from_db()

        assert unit.access_code_hash is None
        sign_in_as(api, user=landlord)
        before = api.get(f"/api/v1/units/{unit.id}/").data
        assert before["access_code"]["state"] == "not_created"
        issued = api.post(
            f"/api/v1/units/{unit.id}/access-code/rotate/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="do-not-cache-raw-code-01",
        )
        assert issued.status_code == 201
        raw_code = issued.data["code"]
        assert raw_code.startswith("U-")
        assert issued.data["single_use"] is False
        assert not IdempotencyKey.objects.filter(key="do-not-cache-raw-code-01").exists()

        unit.refresh_from_db()
        assert unit.access_code_hash
        assert raw_code not in unit.access_code_hash
        detail = api.get(f"/api/v1/units/{unit.id}/").data
        assert detail["join_code"] is None
        assert detail["access_code"]["state"] == "active"
        assert "code" not in detail["access_code"]
        assert "access_code_hash" not in detail

        tenant = registered("0209694011")
        tenant_api = APIClient()
        sign_in_as(tenant_api, user=tenant)
        lookup = tenant_api.get(f"/api/v1/property-join-lookup/?code={raw_code}")
        assert lookup.status_code == 200
        request = tenant_api.post(
            f"/api/v1/properties/{prop.id}/join-requests/",
            {"unit_id": str(unit.id), "access_code": raw_code},
            format="json",
        )
        assert request.status_code == 201

    def test_rotation_revoke_and_expiry_invalidate_the_old_secret(
        self, held, landlord, approve_space, registered, sign_in_as
    ):
        from datetime import timedelta

        from django.utils import timezone
        from rest_framework.test import APIClient

        from apps.property import access_codes
        from apps.property.models import Unit

        _, unit = held
        approve_space(unit)
        _, old_code = access_codes.rotate(unit=unit, actor=landlord)
        unit, new_code = access_codes.rotate(unit=unit, actor=landlord)

        assert access_codes.resolve(new_code).id == unit.id
        with pytest.raises(NotFound):
            access_codes.resolve(old_code)

        access_codes.revoke(unit=unit, actor=landlord, reason="test")
        with pytest.raises(NotFound):
            access_codes.resolve(new_code)

        from apps.audit.models import AuditLog
        from apps.audit.services import verify_chain

        access_events = [
            row
            for row in AuditLog.objects.filter(aggregate_type="unit", aggregate_id=str(unit.id))
            if "access_code" in row.changes
        ]
        assert len(access_events) == 3
        assert verify_chain("unit", str(unit.id)) == (True, [])

        unit, expiring_code = access_codes.rotate(unit=unit, actor=landlord)
        Unit.objects.filter(id=unit.id).update(
            access_code_expires_at=timezone.now() - timedelta(seconds=1)
        )
        with pytest.raises(NotFound):
            access_codes.resolve(expiring_code)

        tenant = registered("0209694012")
        tenant_api = APIClient()
        sign_in_as(tenant_api, user=tenant)
        lookup = tenant_api.get(f"/api/v1/property-join-lookup/?code={expiring_code}")
        assert lookup.status_code == 404

    def test_recheck_revokes_the_code_again(self, held, landlord, approve_space):
        from apps.property import access_codes, spaces

        _, unit = held
        approve_space(unit)
        unit, raw_code = access_codes.rotate(unit=unit, actor=landlord)
        assert access_codes.resolve(raw_code).id == unit.id

        spaces.request_recheck(unit=unit, user=landlord, reason="The room was renovated.")

        unit.refresh_from_db()
        assert unit.access_code_revoked_at is not None
        assert access_codes.state(unit) == "unavailable"
        with pytest.raises(NotFound):
            access_codes.resolve(raw_code)

    def test_parent_verification_loss_revokes_codes(self, held, landlord, approve_space):
        from apps.property import access_codes
        from apps.trust import services as trust_services
        from apps.trust.models import (
            SubjectType,
            Verification,
            VerificationKind,
            VerificationStatus,
        )

        prop, unit = held
        approve_space(unit)
        unit, raw_code = access_codes.rotate(unit=unit, actor=landlord)
        property_check = Verification.objects.get(
            subject_type=SubjectType.PROPERTY,
            subject_id=str(prop.id),
            kind=VerificationKind.PROPERTY_CONDITION,
            status=VerificationStatus.APPROVED,
        )

        trust_services.revoke(property_check, reason="The property check was withdrawn.")

        unit.refresh_from_db()
        assert unit.access_code_revoked_at is not None
        with pytest.raises(NotFound):
            access_codes.resolve(raw_code)

    def test_archiving_a_space_revokes_its_code(self, held, landlord, approve_space):
        from apps.property import access_codes, lifecycle

        _, unit = held
        approve_space(unit)
        unit, raw_code = access_codes.rotate(unit=unit, actor=landlord)

        lifecycle.archive_space(unit=unit, actor=landlord, reason="No longer rented")

        unit.refresh_from_db()
        assert unit.is_active is False
        assert unit.access_code_revoked_at is not None
        with pytest.raises(NotFound):
            access_codes.resolve(raw_code)

    def test_non_manager_cannot_rotate_or_revoke_by_direct_api(self, held, registered, sign_in_as):
        _, unit = held
        stranger = registered("0209694013")
        stranger_api = APIClient()
        sign_in_as(stranger_api, user=stranger)

        rotate = stranger_api.post(
            f"/api/v1/units/{unit.id}/access-code/rotate/", {}, format="json"
        )
        revoke = stranger_api.post(
            f"/api/v1/units/{unit.id}/access-code/revoke/", {}, format="json"
        )

        assert rotate.status_code == 404
        assert revoke.status_code == 404

    def test_lookup_is_rate_limited_to_resist_enumeration(self, registered, sign_in_as):
        from django.core.cache import cache

        cache.clear()
        tenant = registered("0209694014")
        tenant_api = APIClient()
        sign_in_as(tenant_api, user=tenant)

        attempts = [
            tenant_api.get(f"/api/v1/property-join-lookup/?code=ABCDEF00{index:02d}")
            for index in range(1, 12)
        ]

        assert all(response.status_code == 404 for response in attempts[:10])
        assert attempts[10].status_code == 429


class TestAfterVerification:
    def test_private_is_the_default_and_publishing_is_a_separate_act(
        self, held, landlord, approve_space, api, sign_in_as
    ):
        from apps.listing import services as listing_services

        _, unit = held
        approve_space(unit)
        sign_in_as(api, user=landlord)

        assert api.get(f"/api/v1/units/{unit.id}/").data["publication"]["state"] == "private"

        listing = listing_services.create_listing(
            user=landlord,
            unit=unit,
            data={
                "rent_minor": 180000,
                "headline": "Two bedroom off Boundary Road",
                "description": "Prepaid meter, borehole water.",
            },
        )
        listing_services.publish_listing(listing=listing, user=landlord)

        assert api.get(f"/api/v1/units/{unit.id}/").data["publication"]["state"] == "published"

    def test_withdrawing_keeps_the_check(self, held, landlord, approve_space, api, sign_in_as):
        """Taking an advertisement down is not un-verifying the room."""
        from apps.listing import services as listing_services

        _, unit = held
        approve_space(unit)
        listing = listing_services.create_listing(
            user=landlord,
            unit=unit,
            data={
                "rent_minor": 180000,
                "headline": "Two bedroom off Boundary Road",
                "description": "Prepaid meter, borehole water.",
            },
        )
        listing_services.publish_listing(listing=listing, user=landlord)
        listing_services.withdraw_listing(listing=listing, user=landlord, reason="Family visiting.")

        sign_in_as(api, user=landlord)
        detail = api.get(f"/api/v1/units/{unit.id}/").data

        assert detail["publication"]["state"] == "withdrawn"
        assert detail["verification"]["state"] == "verified"

    def test_a_recheck_supersedes_the_approval_and_takes_the_listing_down(
        self, held, landlord, approve_space
    ):
        """A listing left up on a superseded check advertises an unchecked room."""
        from apps.listing import services as listing_services
        from apps.listing.models import ListingStatus
        from apps.property import spaces
        from apps.trust import condition

        _, unit = held
        approve_space(unit)
        listing = listing_services.create_listing(
            user=landlord,
            unit=unit,
            data={
                "rent_minor": 180000,
                "headline": "Two bedroom off Boundary Road",
                "description": "Prepaid meter, borehole water.",
            },
        )
        listing_services.publish_listing(listing=listing, user=landlord)

        spaces.request_recheck(unit=unit, user=landlord, reason="Repainted and re-tiled.")

        listing.refresh_from_db()
        assert listing.status == ListingStatus.SUSPENDED
        assert condition.lifecycle_state(unit) == "draft"
        # And the space is editable again, which is what the re-check was for.
        spaces.update_space(unit=unit, user=landlord, data={"label": "Flat A (renovated)"})


class TestThePublicView:
    """The space first, then the property it sits in."""

    @pytest.fixture
    def published(self, held, landlord, staff, amenities):
        from apps.listing import services as listing_services
        from apps.property import spaces
        from apps.property.models import Amenity

        prop, unit = held
        spaces.update_space(
            unit=unit,
            user=landlord,
            data={
                "description": "Two bedrooms, both facing the yard.",
                "entrance_note": "Blue door at the top of the outside stairs",
            },
        )
        spaces.set_space_amenities(
            unit=unit, user=landlord, amenity_ids=[Amenity.objects.get(name="Self meter").id]
        )
        spaces.set_property_amenities(
            prop=prop,
            user=landlord,
            amenity_ids=[Amenity.objects.get(name="Security guard").id],
        )
        # Approved through its own review rather than beside it: attaching a
        # photograph opens one, and a second live verification of the same kind
        # is refused by the database — which is the constraint doing its job.
        _fill_required(unit, landlord)
        _approve_open_review(unit, landlord)

        listing = listing_services.create_listing(
            user=landlord,
            unit=unit,
            data={
                "rent_minor": 180000,
                "headline": "Two bedroom off Boundary Road",
                "description": "Prepaid meter, borehole water.",
            },
        )
        listing_services.publish_listing(listing=listing, user=landlord)
        return prop, unit, listing

    def test_it_answers_what_am_i_renting_before_where_is_it(self, published, api):
        _, unit, listing = published

        detail = api.get(f"/api/v1/listings/{listing.id}/")

        assert detail.status_code == 200
        space = detail.data["space"]
        assert space["id"] == str(unit.id)
        assert space["space_type_label"] == "Apartment / flat"
        assert space["description"] == "Two bedrooms, both facing the yard."
        assert [row["name"] for row in space["amenities"]] == ["Self meter"]
        assert space["photos"], "the space's own photograph is what a tenant sees first"
        assert space["verification"]["checked"] is True

    def test_the_property_is_the_context_not_the_subject(self, published, api):
        _, _, listing = published

        context = api.get(f"/api/v1/listings/{listing.id}/").data["property_context"]

        assert context["title"] == "Boundary Road block"
        assert context["locality_name"] == "East Legon"
        assert [row["name"] for row in context["amenities"]] == ["Security guard"]
        assert context["features"]["water_source"]
        assert context["authority"]["state"] == "verified"

    def test_finding_the_door_is_not_public(self, published, api):
        """The street, the number and the entrance note are released when a
        viewing is confirmed, not to anyone who opens the page."""
        _, _, listing = published

        body = api.get(f"/api/v1/listings/{listing.id}/").data

        rendered = str(body)
        assert "Blue door" not in rendered
        assert "14 Boundary Road" not in rendered
        # The landmark stays: it is how somebody judges a location.
        assert body["property_context"]["landmark"] == "Behind the filling station"


class TestASpaceWaitsForItsProperty:
    """Draft freely under an unverified property; ask for a decision only after.

    The reason is about the reviewer, not the tenant. "Is this room as
    described" only means something once "is this building this person's to
    let" has been answered — otherwise an approved space carries a trust mark
    resting on nothing.
    """

    def test_a_draft_can_be_built_under_an_unverified_property(
        self, unclaimed, landlord, amenities
    ):
        """Everything except asking for a decision stays open."""
        from apps.property import spaces
        from apps.property.models import Amenity

        prop, unit = unclaimed
        assert not prop.relationships.exists()

        spaces.update_space(
            unit=unit, user=landlord, data={"label": "Flat A1", "description": "Two rooms."}
        )
        spaces.set_space_amenities(
            unit=unit, user=landlord, amenity_ids=[Amenity.objects.get(name="Self meter").id]
        )
        _fill_required(unit, landlord)

        unit.refresh_from_db()
        assert unit.label == "Flat A1"
        assert condition.lifecycle_state(unit) == "ready_for_submission"

    def test_it_cannot_be_submitted_while_the_property_is_unverified(self, unclaimed, landlord):
        _prop, unit = unclaimed
        _fill_required(unit, landlord)

        with pytest.raises(Conflict) as raised:
            condition.submit_for_review(subject=unit, actor=landlord)

        message = str(raised.value).lower()
        assert "property" in message, "the refusal has to name what is outstanding"

    def test_the_refusal_reaches_the_client_as_a_refusal(
        self, unclaimed, landlord, api, sign_in_as
    ):
        """A 409 with a message, not a silent no-op."""
        _, unit = unclaimed
        _fill_required(unit, landlord)
        sign_in_as(api, user=landlord)

        response = api.post(f"/api/v1/units/{unit.id}/verification/", {}, format="json")

        assert response.status_code == 409
        assert "property" in response.data["error"]["message"].lower()

    def test_the_screen_is_told_why_before_the_click(self, unclaimed, landlord, api, sign_in_as):
        """`permitted_actions` carries the same answer the endpoint enforces.

        This is the pairing that broke: the endpoint refused and the policy said
        `not_authorized` for an unrelated reason, so the client hid the control
        and explained nothing.
        """
        _, unit = unclaimed
        _fill_required(unit, landlord)
        sign_in_as(api, user=landlord)

        detail = api.get(f"/api/v1/units/{unit.id}/").data
        submit = detail["permitted_actions"]["submit_for_verification"]

        assert submit["allowed"] is False
        assert submit["blockers"], "a refusal a screen cannot explain is a silent one"
        assert "property" in submit["message"].lower()
        # And the space itself is not what is outstanding.
        assert detail["verification"]["can_submit"] is True
        assert detail["verification"]["required_outstanding"] == 0

    def test_it_becomes_eligible_once_the_property_is_verified(
        self, unclaimed, landlord, api, sign_in_as
    ):
        prop, unit = unclaimed
        _fill_required(unit, landlord)
        sign_in_as(api, user=landlord)

        assert (
            api.get(f"/api/v1/units/{unit.id}/").data["permitted_actions"][
                "submit_for_verification"
            ]["allowed"]
            is False
        )

        _verify_property_authority(prop)

        submit = api.get(f"/api/v1/units/{unit.id}/").data["permitted_actions"][
            "submit_for_verification"
        ]
        assert submit["allowed"] is False, "authority alone is not a verified property"

        _verify_property_condition(prop)
        submit = api.get(f"/api/v1/units/{unit.id}/").data["permitted_actions"][
            "submit_for_verification"
        ]
        assert submit["allowed"] is True

    def test_the_property_may_still_submit_its_own_review(self, unclaimed, landlord):
        """The gate is for spaces only, or it would block its own precondition.

        A property whose own condition review required the property to be
        verified could never become verified. `assert_may_review` was already
        once written into that deadlock; this is the test that keeps the space
        gate from repeating it.
        """
        prop, _ = unclaimed
        _fill(prop, landlord, ["property.front", "property.side", "property.surroundings"])

        review = condition.submit_for_review(subject=prop, actor=landlord)

        assert review is not None


class TestASavedDraftCanBeSubmittedLater:
    """The fault: "Save for later", come back, press send, nothing happens.

    `can_submit_space` asked for a live `PropertyRelationship` while the service
    that enforces — `condition.assert_may_review` — asks
    `Property.is_managed_by`. A property created privately has no relationship,
    so the policy answered "you do not manage this property" about the provider's
    own property, the web workspace rendered no submit button, and what appeared
    in its place scrolled the page.
    """

    def test_a_provider_manages_their_own_property_without_a_relationship(
        self, unclaimed, landlord
    ):
        from apps.core.policy import permitted_actions

        prop, unit = unclaimed
        _verify_property(prop)
        assert not prop.relationships.exists(), "the private flow creates none"

        actions = permitted_actions("space", actor=landlord, target=unit)

        assert actions["edit"]["allowed"] is True
        assert actions["submit_for_verification"]["code"] != "not_authorized"

    def test_the_saved_draft_submits_when_they_return(self, unclaimed, landlord, api, sign_in_as):
        """The whole reported journey, over HTTP."""
        prop, unit = unclaimed
        sign_in_as(api, user=landlord)

        # Day one: build it and save for later.
        added = api.post(
            f"/api/v1/units/{unit.id}/photos/",
            {"file_id": str(_photo(landlord).id)},
            format="json",
        )
        assert added.status_code == 201

        # Meanwhile the property is confirmed.
        _verify_property(prop)

        # Day two: come back to the draft and send it.
        detail = api.get(f"/api/v1/units/{unit.id}/").data
        assert detail["verification"]["state"] == "ready_for_submission"
        assert detail["permitted_actions"]["submit_for_verification"]["allowed"] is True

        submitted = api.post(f"/api/v1/units/{unit.id}/verification/", {}, format="json")

        assert submitted.status_code == 200
        assert submitted.data["state"] == "submitted"

    def test_the_policy_and_the_service_agree(self, unclaimed, landlord):
        """The invariant the fault broke.

        Whatever `permitted_actions` says about submitting, the endpoint must do.
        They disagreed, and the client renders the first while the server runs
        the second — so the control vanished with nothing said.
        """
        from apps.core.exceptions import Conflict as DomainConflict
        from apps.core.policy import permitted_actions

        prop, unit = unclaimed
        _fill_required(unit, landlord)

        for verified in (False, True):
            if verified:
                _verify_property(prop)

            allowed = permitted_actions("space", actor=landlord, target=unit)[
                "submit_for_verification"
            ]["allowed"]
            try:
                condition.submit_for_review(subject=unit, actor=landlord)
                accepted = True
            except DomainConflict:
                accepted = False

            assert allowed == accepted, (
                f"policy said {allowed} and the service did {accepted} "
                f"(property verified: {verified})"
            )

    def test_a_stranger_is_still_refused(self, unclaimed, landlord, registered):
        """Widening the predicate must not have opened it to everybody."""
        from apps.core.policy import permitted_actions

        prop, unit = unclaimed
        _verify_property(prop)
        stranger = registered("0209694001")

        actions = permitted_actions("space", actor=stranger, target=unit)

        assert actions["submit_for_verification"]["code"] == "not_authorized"
        with pytest.raises(PermissionDenied):
            condition.submit_for_review(subject=unit, actor=stranger)


class TestSubmissionErrorsAreMeaningful:
    def test_submitting_with_no_photographs_names_what_is_missing(
        self, unclaimed, landlord, api, sign_in_as
    ):
        prop, unit = unclaimed
        _verify_property(prop)
        sign_in_as(api, user=landlord)

        response = api.post(f"/api/v1/units/{unit.id}/verification/", {}, format="json")

        assert response.status_code == 409
        assert "photo" in response.data["error"]["message"].lower()

    def test_submitting_twice_says_it_is_already_with_the_team(
        self, unclaimed, landlord, api, sign_in_as
    ):
        prop, unit = unclaimed
        _verify_property(prop)
        _fill_required(unit, landlord)
        sign_in_as(api, user=landlord)

        assert (
            api.post(f"/api/v1/units/{unit.id}/verification/", {}, format="json").status_code == 200
        )
        again = api.post(f"/api/v1/units/{unit.id}/verification/", {}, format="json")

        assert again.status_code == 409
        assert again.data["error"]["message"]

    def test_every_refusal_carries_a_message(self, unclaimed, landlord, api, sign_in_as):
        """No refusal on this path may be empty — that is what "silently" meant."""
        _, unit = unclaimed
        sign_in_as(api, user=landlord)

        for _ in range(2):
            response = api.post(f"/api/v1/units/{unit.id}/verification/", {}, format="json")
            assert response.status_code >= 400
            assert response.data["error"]["message"].strip()


class TestOccupiedSpaceRestrictions:
    """An allocation protects the Unit even when an indirect cleanup missed it."""

    @staticmethod
    def occupy(*, unit, tenant, provider):
        from apps.occupancy.models import Occupancy

        # Physical occupancy context is intentionally valid before Rooomly has
        # a lease (FIX 2). It is not an active platform tenancy, but it still
        # makes the real space occupied and must close contradictory actions.
        return Occupancy.objects.create(
            user=tenant,
            property=unit.property,
            unit=unit,
            created_by=provider,
        )

    def test_checked_facts_are_locked_but_operational_details_remain_editable(
        self, held, landlord, user, approve_space
    ):
        from apps.core.policy import permitted_actions
        from apps.property import spaces

        _, unit = held
        approve_space(unit)
        self.occupy(unit=unit, tenant=user, provider=landlord)

        actions = permitted_actions("space", actor=landlord, target=unit)
        assert actions["edit"]["allowed"] is False
        assert actions["edit_operational"]["allowed"] is True

        with pytest.raises(Conflict, match="currently occupied"):
            spaces.update_space(unit=unit, user=landlord, data={"description": "Now tiled."})

        spaces.update_space(
            unit=unit,
            user=landlord,
            data={"entrance_note": "Use the blue side door."},
        )
        unit.refresh_from_db()
        assert unit.label == "Flat A"
        assert unit.entrance_note == "Use the blue side door."

    def test_amenities_photos_and_recheck_cannot_change_under_occupancy(
        self, held, landlord, user, approve_space, amenities
    ):
        from apps.property import spaces
        from apps.property.models import Amenity
        from apps.trust import condition

        _, unit = held
        approve_space(unit)
        self.occupy(unit=unit, tenant=user, provider=landlord)

        with pytest.raises(Conflict, match="currently occupied"):
            spaces.set_space_amenities(
                unit=unit,
                user=landlord,
                amenity_ids=[Amenity.objects.get(name="Self meter").id],
            )
        with pytest.raises(Conflict, match="currently occupied"):
            spaces.attach_photo(unit=unit, user=landlord, file=_photo(landlord))
        with pytest.raises(Conflict, match="currently occupied"):
            spaces.request_recheck(unit=unit, user=landlord, reason="Changing the room.")

        assert condition.lifecycle_state(unit) == "verified"

    def test_bed_structure_cannot_change_under_occupancy(self, held, landlord, user, approve_space):
        from apps.property import services

        prop, unit = held
        from apps.property.models import PropertyType

        prop.property_type = PropertyType.HOSTEL
        prop.save(update_fields=["property_type", "updated_at"])
        unit.space_type = "room"
        unit.save(update_fields=["space_type", "updated_at"])
        approve_space(unit)
        self.occupy(unit=unit, tenant=user, provider=landlord)

        with pytest.raises(Conflict, match="occupied"):
            services.add_bed(unit=unit, user=landlord, data={"label": "Bed A"})

    def test_occupied_space_cannot_be_archived_or_deleted(self, held, landlord, user):
        from apps.property import lifecycle

        _, unit = held
        self.occupy(unit=unit, tenant=user, provider=landlord)

        with pytest.raises(Conflict, match="still in use"):
            lifecycle.archive_space(unit=unit, actor=landlord, reason="Remove from inventory.")
        with pytest.raises(Conflict):
            lifecycle.delete_space(unit=unit, actor=landlord, confirmed=True)

        unit.refresh_from_db()
        assert unit.is_active is True

    def test_an_occupied_space_cannot_be_republished(self, held, landlord, user, approve_space):
        from apps.listing import services as listing_services

        _, unit = held
        approve_space(unit)
        listing = listing_services.create_listing(
            user=landlord,
            unit=unit,
            data={
                "rent_minor": 180000,
                "headline": "Two bedroom off Boundary Road",
                "description": "Prepaid meter, borehole water.",
            },
        )
        listing_services.publish_listing(listing=listing, user=landlord)
        listing_services.withdraw_listing(listing=listing, user=landlord, reason="Paused.")
        self.occupy(unit=unit, tenant=user, provider=landlord)

        with pytest.raises(Conflict, match="occupied"):
            listing_services.publish_listing(listing=listing, user=landlord)

    def test_stale_public_and_private_routes_still_refuse_requests(
        self, held, landlord, user, registered, approve_space, monkeypatch
    ):
        from apps.application import services as application_services
        from apps.listing import services as listing_services
        from apps.occupancy import services as occupancy_services
        from apps.viewing import services as viewing_services

        prop, unit = held
        approve_space(unit)
        listing = listing_services.create_listing(
            user=landlord,
            unit=unit,
            data={
                "rent_minor": 180000,
                "headline": "Two bedroom off Boundary Road",
                "description": "Prepaid meter, borehole water.",
            },
        )
        listing_services.publish_listing(listing=listing, user=landlord)
        self.occupy(unit=unit, tenant=user, provider=landlord)
        applicant = registered("0209694098")

        # Simulate a stale active Listing row: submission has its own occupancy
        # check and does not trust cleanup as the sole boundary.
        with pytest.raises(Conflict, match="occupied"):
            application_services.submit_application(
                listing=listing, tenant=applicant, data={"advance_months_offered": 6}
            )
        with pytest.raises(Conflict, match="occupied"):
            viewing_services.request_viewing(listing=listing, tenant=applicant)

        # Verification normally fails closed for an occupied Unit. Returning
        # true here models occupancy beginning immediately after that check.
        monkeypatch.setattr("apps.property.access_codes.verify", lambda *_: True)
        with pytest.raises(Conflict, match="occupied"):
            occupancy_services.create_join_request(
                user=applicant,
                prop=prop,
                unit=unit,
                access_code="RACE-WINDOW",
            )

    def test_the_unit_api_exposes_the_same_occupied_decisions(
        self, held, landlord, user, approve_space, api, sign_in_as
    ):
        _, unit = held
        approve_space(unit)
        self.occupy(unit=unit, tenant=user, provider=landlord)
        sign_in_as(api, user=landlord)

        detail = api.get(f"/api/v1/units/{unit.id}/")

        assert detail.status_code == 200
        assert detail.data["availability"]["state"] == "occupied"
        actions = detail.data["permitted_actions"]
        assert actions["publish"]["allowed"] is False
        assert actions["invite_tenant"]["allowed"] is False
        assert actions["edit"]["allowed"] is False
        assert actions["recheck"]["allowed"] is False
        assert actions["add_bed"]["allowed"] is False
        assert actions["archive"]["allowed"] is False
        assert actions["delete"]["allowed"] is False
        assert actions["edit_operational"]["allowed"] is True
