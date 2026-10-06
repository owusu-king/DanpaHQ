"""Verification cannot be submitted until the evidence is there.

The gap: `evidence_policy` could say what a property must show, and
`missing_required` could say what was outstanding, but nothing called either.
There was no way to attach a photograph of a bedroom to anything, and no
submission to gate — the policy was a statement of intent with no mechanism.
"""

import pytest
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict, PermissionDenied, ValidationFailed

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def owned(landlord, db):
    """A residential property with one flat, held by `landlord`.

    The holder is identity-verified because sending a property for review always
    has been gated on it — the submission carries an ownership claim, and a
    reviewer cannot decide whose building it is without knowing who is asking.
    That check used to sit on the claim endpoint; it now sits on the one
    property-level submission, which is where the claim goes.
    """
    from django.utils import timezone

    from apps.geo.models import Address, District, Locality, Region
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    for kind in (VerificationKind.IDENTITY, VerificationKind.PHONE):
        Verification.objects.get_or_create(
            subject_type=SubjectType.USER,
            subject_id=str(landlord.id),
            kind=kind,
            status=VerificationStatus.APPROVED,
            defaults={
                "method": VerificationMethod.DOCUMENT_REVIEW,
                "submitted_by": landlord,
                "decided_at": timezone.now(),
            },
        )

    from apps.property.models import (
        Property,
        PropertyRelationship,
        PropertyRelationshipType,
        PropertyType,
        Unit,
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
        title="Condition Court",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street="1 Condition Road"),
    )
    PropertyRelationship.objects.create(
        property=prop,
        user=landlord,
        relationship_type=PropertyRelationshipType.OWNER,
        granted_by=landlord,
    )
    unit = Unit.objects.create(
        property=prop,
        label="Flat 1",
        space_type="apartment",
        bedrooms=1,
        bathrooms=1,
        has_private_kitchen=False,
        has_private_toilet=False,
    )
    return prop, unit


def _photo(user, purpose="property_photo"):
    from apps.files.models import ScanStatus, StoredFile, UploadStatus

    return StoredFile.objects.create(
        uploaded_by=user,
        owner_id_snapshot=str(user.id),
        purpose=purpose,
        original_filename="shot.jpg",
        declared_content_type="image/jpeg",
        content_type="image/jpeg",
        size_bytes=100_000,
        storage_key=f"photos/{user.id}/{StoredFile.objects.count()}.jpg",
        upload_status=UploadStatus.READY,
        scan_status=ScanStatus.CLEAN,
    )


def _fill(subject, landlord, keys):
    from apps.trust import condition

    for key in keys:
        condition.attach(subject=subject, actor=landlord, slot_key=key, file=_photo(landlord))


def _verify_person(user):
    """Identity and phone only.

    Not `approve_provider`, which also writes the `PropertyRelationship` — the
    very thing these tests are about establishing, so a fixture that granted it
    up front would test nothing.
    """
    from django.utils import timezone

    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )
    from tests.conftest import approve_provider_standing

    user.is_phone_verified = True
    user.phone_verified_at = timezone.now()
    user.save(update_fields=["is_phone_verified", "phone_verified_at", "updated_at"])
    approve_provider_standing(user)

    for kind, method in (
        (VerificationKind.PHONE, VerificationMethod.AUTOMATED_OTP),
        (VerificationKind.IDENTITY, VerificationMethod.DOCUMENT_REVIEW),
    ):
        Verification.objects.get_or_create(
            subject_type=SubjectType.USER,
            subject_id=str(user.id),
            kind=kind,
            status=VerificationStatus.APPROVED,
            defaults={
                "method": method,
                "submitted_by": user,
                "decided_at": timezone.now(),
            },
        )
    return user


class TestTheGate:
    def test_nothing_can_be_submitted_before_anything_is_added(self, owned, landlord):
        from apps.trust import condition

        prop, _ = owned

        with pytest.raises(Conflict):
            condition.submit_for_review(subject=prop, actor=landlord)

    def test_a_partial_submission_is_refused_and_names_what_is_missing(self, owned, landlord):
        from apps.trust import condition

        prop, _ = owned
        _fill(prop, landlord, ["property.front"])

        with pytest.raises(ValidationFailed) as raised:
            condition.submit_for_review(subject=prop, actor=landlord)

        # "Incomplete" tells somebody nothing they can act on.
        message = str(raised.value)
        assert "side" in message.lower()
        assert "area" in message.lower() or "surrounding" in message.lower()

    def test_a_complete_submission_reaches_a_reviewer(self, owned, landlord):
        from apps.trust import condition
        from apps.trust.models import ReviewQueueEntry

        prop, _ = owned
        _fill(prop, landlord, ["property.front", "property.side", "property.surroundings"])

        review = condition.submit_for_review(subject=prop, actor=landlord)

        assert ReviewQueueEntry.objects.filter(verification=review).exists()

    def test_collecting_does_not_put_it_in_front_of_anyone(self, owned, landlord):
        """The reason opening and submitting are separate steps."""
        from apps.trust import condition
        from apps.trust.models import ReviewQueueEntry

        prop, _ = owned
        _fill(prop, landlord, ["property.front"])

        review = condition.current_review(prop)
        assert review is not None
        assert not ReviewQueueEntry.objects.filter(verification=review).exists()

    def test_it_cannot_be_submitted_twice(self, owned, landlord):
        from apps.trust import condition

        prop, _ = owned
        _fill(prop, landlord, ["property.front", "property.side", "property.surroundings"])
        condition.submit_for_review(subject=prop, actor=landlord)

        with pytest.raises(Conflict):
            condition.submit_for_review(subject=prop, actor=landlord)

    def test_reloading_mid_upload_does_not_start_a_second_review(self, owned, landlord):
        from apps.trust import condition
        from apps.trust.models import Verification

        prop, _ = owned
        condition.open_review(subject=prop, actor=landlord)
        condition.open_review(subject=prop, actor=landlord)

        assert (
            Verification.objects.filter(
                subject_type="property", subject_id=str(prop.id), kind="property_condition"
            ).count()
            == 1
        )


class TestWhatIsAskedFor:
    def test_a_property_is_asked_for_three_named_views(self, owned, landlord):
        from apps.trust import condition

        prop, _ = owned
        state = condition.progress(subject=prop, user=landlord)

        keys = {slot["key"] for slot in state["slots"]}
        assert {"property.front", "property.side", "property.surroundings"} <= keys
        assert state["required_outstanding"] == 3
        assert state["can_submit"] is False

    def test_progress_says_which_are_provided(self, owned, landlord):
        from apps.trust import condition

        prop, _ = owned
        _fill(prop, landlord, ["property.side"])

        state = condition.progress(subject=prop, user=landlord)
        provided = {slot["key"] for slot in state["slots"] if slot["provided"]}

        assert provided == {"property.side"}
        assert state["required_outstanding"] == 2

    def test_a_space_is_asked_about_what_it_declares(self, owned, landlord):
        """Feature evidence follows the record, not a hardcoded list."""
        from apps.property.models import Unit
        from apps.trust import condition

        _, unit = owned
        state = condition.progress(subject=unit, user=landlord)
        keys = [slot["key"] for slot in state["slots"]]

        # One required interior view, and two invited. The property above has
        # already been reviewed, so this only adds what that could not show.
        assert keys == ["space.overview", "space.entrance", "space.additional"]
        assert state["required_total"] == 1

        # Declaring a feature no longer multiplies what must be sent. The
        # vocabulary for it is still there — see `declared_feature_slots` — it
        # is offered rather than demanded.
        Unit.objects.filter(id=unit.id).update(has_private_kitchen=True)
        unit.refresh_from_db()

        after = [slot["key"] for slot in condition.progress(subject=unit, user=landlord)["slots"]]
        assert after == keys

    def test_a_slot_nobody_asked_for_is_refused(self, owned, landlord):
        """A client must not be able to invent a requirement and have it stored."""
        from apps.trust import condition

        prop, _ = owned

        with pytest.raises(ValidationFailed):
            condition.attach(
                subject=prop,
                actor=landlord,
                slot_key="property.penthouse",
                file=_photo(landlord),
            )


class TestWhoMayDoIt:
    def test_a_stranger_cannot_see_what_a_property_needs(self, owned, landlord, registered):
        from apps.trust import condition

        prop, _ = owned
        stranger = registered("0209690001")

        with pytest.raises(PermissionDenied):
            condition.progress(subject=prop, user=stranger)

    def test_a_stranger_cannot_attach_evidence(self, owned, landlord, registered):
        from apps.trust import condition

        prop, _ = owned
        stranger = registered("0209690002")

        with pytest.raises(PermissionDenied):
            condition.attach(
                subject=prop,
                actor=stranger,
                slot_key="property.front",
                file=_photo(stranger),
            )

    def test_another_persons_upload_cannot_be_attached(self, owned, landlord, registered):
        stranger = registered("0209690003")
        from apps.trust import condition

        prop, _ = owned

        with pytest.raises(ValidationFailed):
            condition.attach(
                subject=prop,
                actor=landlord,
                slot_key="property.front",
                file=_photo(stranger),
            )


def _record_claim(api, prop, landlord):
    """Put the document on the property without sending it — creation's step 2."""
    document = _photo(landlord)
    return api.post(
        f"/api/v1/properties/{prop.id}/claim/",
        {"relationship_type": "owner", "file_ids": [str(document.id)]},
        format="json",
    )


class TestOverHttp:
    def test_the_whole_flow(self, api, sign_in_as, owned, landlord):
        prop, _ = owned
        sign_in_as(api, user=landlord)

        state = api.get(f"/api/v1/properties/{prop.id}/verification/")
        assert state.status_code == 200
        assert state.data["required_outstanding"] == 3
        assert state.data["can_submit"] is False

        for key in ("property.front", "property.side", "property.surroundings"):
            added = api.post(
                f"/api/v1/properties/{prop.id}/verification/evidence/",
                {"slot_key": key, "file_id": str(_photo(landlord).id)},
                format="json",
            )
            assert added.status_code == 201, added.data

        assert added.data["can_submit"] is True

        # Photographs alone are not a property submission. Sending is one act
        # over both halves, so a property with no claim on it is refused and
        # told which half is missing rather than quietly queueing pictures of a
        # building nobody has said is theirs.
        without_claim = api.post(f"/api/v1/properties/{prop.id}/verification/", {}, format="json")
        assert without_claim.status_code == 409
        assert "document" in without_claim.data["error"]["message"].lower()

        _record_claim(api, prop, landlord)

        submitted = api.post(f"/api/v1/properties/{prop.id}/verification/", {}, format="json")
        assert submitted.status_code == 200
        assert submitted.data["submitted"] is True

    def test_an_incomplete_submission_is_refused_over_http(self, api, sign_in_as, owned, landlord):
        prop, _ = owned
        sign_in_as(api, user=landlord)
        _record_claim(api, prop, landlord)
        api.post(
            f"/api/v1/properties/{prop.id}/verification/evidence/",
            {"slot_key": "property.front", "file_id": str(_photo(landlord).id)},
            format="json",
        )

        response = api.post(f"/api/v1/properties/{prop.id}/verification/", {}, format="json")

        # 409 rather than 422: this is the policy layer refusing on state, and
        # the refusal carries the count so the page can say which two are left.
        assert response.status_code == 409
        assert "2 of 3 photographs" in response.data["error"]["message"]

    def test_recording_the_document_asks_nobody_to_read_it(self, api, sign_in_as, owned, landlord):
        """The Documents step of creation files nothing.

        This is the defect the split exists for: recording the claim used to
        queue it, so the second step of the creation wizard submitted for review
        and the last step had only photographs left to send.
        """
        from apps.property.models import ProviderApplicationStatus
        from apps.property.verification import lifecycle
        from apps.trust.models import ReviewQueueEntry

        prop, _ = owned
        sign_in_as(api, user=landlord)

        recorded = _record_claim(api, prop, landlord)

        assert recorded.status_code == 201, recorded.data
        assert recorded.data["status"] == ProviderApplicationStatus.DRAFT
        assert not ReviewQueueEntry.objects.exists(), "nobody should have been asked to look"
        # Held, not sent — and the property says so.
        assert lifecycle(prop)["authority"]["state"] == "ready_for_submission"

    def test_a_space_has_its_own_review(self, api, sign_in_as, owned, landlord):
        _, unit = owned
        sign_in_as(api, user=landlord)

        state = api.get(f"/api/v1/units/{unit.id}/verification/")

        assert state.status_code == 200
        keys = [slot["key"] for slot in state.data["slots"]]
        assert keys == ["space.overview", "space.entrance", "space.additional"]
        # The lifecycle vocabulary the workspace renders, served rather than
        # derived by each client from a status and a count.
        assert state.data["state"] == "draft"
        assert state.data["state_label"] == "Draft"
        assert state.data["editable"] is True

    def test_a_stranger_is_refused_over_http(self, api, sign_in_as, owned, registered):
        prop, _ = owned
        sign_in_as(api, user=registered("0209690004"))

        assert api.get(f"/api/v1/properties/{prop.id}/verification/").status_code == 403


class TestAPhotographCanBeCorrected:
    """The control that was never there.

    A filled slot rendered as the word "Added" and nothing else — no picture, no
    replace, no remove, in any state. `condition.detach` had existed since P3 and
    no endpoint exposed it, and attaching again would have left two files in a
    slot the policy describes as one. So a provider who photographed the wrong
    side of a building was stuck with it permanently.
    """

    def test_a_second_photo_replaces_the_first(self, api, sign_in_as, owned, landlord):
        prop, _ = owned
        sign_in_as(api, user=landlord)
        first = _photo(landlord)

        api.post(
            f"/api/v1/properties/{prop.id}/verification/evidence/",
            {"slot_key": "property.front", "file_id": str(first.id)},
            format="json",
        )
        second = _photo(landlord)
        after = api.post(
            f"/api/v1/properties/{prop.id}/verification/evidence/",
            {"slot_key": "property.front", "file_id": str(second.id)},
            format="json",
        )

        assert after.status_code == 201, after.data
        front = next(s for s in after.data["slots"] if s["key"] == "property.front")
        assert front["provided"] is True
        # One slot, one photograph — the new one, not both.
        assert front["file_id"] == str(second.id)
        assert after.data["required_outstanding"] == 2

    def test_a_slot_says_what_is_in_it(self, api, sign_in_as, owned, landlord):
        """Enough to show it back and enough to take it down.

        A boolean cannot do either, which is why the screen could only print a
        word.
        """
        prop, _ = owned
        sign_in_as(api, user=landlord)
        photo = _photo(landlord)

        state = api.post(
            f"/api/v1/properties/{prop.id}/verification/evidence/",
            {"slot_key": "property.front", "file_id": str(photo.id)},
            format="json",
        ).data

        front = next(s for s in state["slots"] if s["key"] == "property.front")
        assert front["file_id"] == str(photo.id)
        assert front["filename"] == photo.original_filename
        # Rendered in an `<img>`, so `inline` — the default `attachment` makes a
        # browser download instead of paint, which is how every listing photo on
        # this product once failed to appear.
        assert front["preview_url"] and "inline" in front["preview_url"].lower()

    def test_a_photograph_can_be_taken_back_down(self, api, sign_in_as, owned, landlord):
        prop, _ = owned
        sign_in_as(api, user=landlord)
        api.post(
            f"/api/v1/properties/{prop.id}/verification/evidence/",
            {"slot_key": "property.front", "file_id": str(_photo(landlord).id)},
            format="json",
        )

        removed = api.delete(
            f"/api/v1/properties/{prop.id}/verification/evidence/",
            {"slot_key": "property.front"},
            format="json",
        )

        assert removed.status_code == 200, removed.data
        front = next(s for s in removed.data["slots"] if s["key"] == "property.front")
        assert front["provided"] is False
        assert front["file_id"] is None
        # And it counts as outstanding again, so it cannot be submitted without.
        assert removed.data["required_outstanding"] == 3
        assert removed.data["can_submit"] is False

    def test_neither_is_possible_once_a_reviewer_holds_it(self, api, sign_in_as, owned, landlord):
        """What a reviewer was sent must not change under them."""
        prop, _ = owned
        sign_in_as(api, user=landlord)
        _record_claim(api, prop, landlord)
        for key in ("property.front", "property.side", "property.surroundings"):
            api.post(
                f"/api/v1/properties/{prop.id}/verification/evidence/",
                {"slot_key": key, "file_id": str(_photo(landlord).id)},
                format="json",
            )
        assert (
            api.post(f"/api/v1/properties/{prop.id}/verification/", {}, format="json").status_code
            == 200
        )

        replaced = api.post(
            f"/api/v1/properties/{prop.id}/verification/evidence/",
            {"slot_key": "property.front", "file_id": str(_photo(landlord).id)},
            format="json",
        )
        removed = api.delete(
            f"/api/v1/properties/{prop.id}/verification/evidence/",
            {"slot_key": "property.front"},
            format="json",
        )

        assert replaced.status_code == 409, replaced.data
        assert removed.status_code == 409, removed.data

    def test_removing_says_which_photograph(self, api, sign_in_as, owned, landlord):
        prop, _ = owned
        sign_in_as(api, user=landlord)

        response = api.delete(
            f"/api/v1/properties/{prop.id}/verification/evidence/", {}, format="json"
        )

        assert response.status_code == 422

    def test_a_stranger_cannot_remove_anything(self, api, sign_in_as, owned, landlord, registered):
        prop, _ = owned
        sign_in_as(api, user=landlord)
        api.post(
            f"/api/v1/properties/{prop.id}/verification/evidence/",
            {"slot_key": "property.front", "file_id": str(_photo(landlord).id)},
            format="json",
        )
        sign_in_as(api, user=registered("0209690099"))

        refused = api.delete(
            f"/api/v1/properties/{prop.id}/verification/evidence/",
            {"slot_key": "property.front"},
            format="json",
        )

        assert refused.status_code in (403, 404)


class TestTheVocabularyIsServed:
    def test_the_categories_and_what_each_may_contain(self, api, sign_in_as, user):
        sign_in_as(api, user=user)

        response = api.get("/api/v1/property-types/")

        assert response.status_code == 200
        by_value = {row["value"]: row for row in response.data["property_types"]}
        assert set(by_value) == {"residential", "commercial", "hostel"}

        hostel = {s["value"] for s in by_value["hostel"]["space_types"]}
        assert hostel == {"room", "bed_space"}

        commercial = {s["value"] for s in by_value["commercial"]["space_types"]}
        # Land is its own Property, sold whole (owner, 2026-10-05).
        assert commercial == {"shop", "office", "warehouse"}

    def test_the_client_is_told_which_spaces_take_beds(self, api, sign_in_as, user):
        """So a form can offer bed setup without hardcoding the rule."""
        sign_in_as(api, user=user)

        rows = api.get("/api/v1/property-types/").data["property_types"]
        hostel = next(row for row in rows if row["value"] == "hostel")
        hostel_by_value = {s["value"]: s for s in hostel["space_types"]}
        residential = next(row for row in rows if row["value"] == "residential")
        residential_by_value = {s["value"]: s for s in residential["space_types"]}

        assert hostel_by_value["room"]["accepts_bed_spaces"] is True
        assert hostel_by_value["bed_space"]["accepts_bed_spaces"] is False
        assert residential_by_value["room"]["accepts_bed_spaces"] is False

    def test_each_kind_of_space_is_asked_only_what_fits_it(self, api, sign_in_as, user):
        """A shop is not asked for bedrooms; a bed is not asked for rooms at all."""
        sign_in_as(api, user=user)

        rows = api.get("/api/v1/property-types/").data["property_types"]
        asks = {
            (row["value"], s["value"]): s["asks"] for row in rows for s in row["space_types"]
        }

        assert asks[("residential", "apartment")] == {
            "bedrooms": True, "bathrooms": "count", "floor": True,
        }
        assert asks[("residential", "house")]["floor"] is False
        assert asks[("residential", "studio")]["bedrooms"] is False
        assert asks[("commercial", "shop")] == {
            "bedrooms": False, "bathrooms": "yes_no", "floor": True,
        }
        assert asks[("commercial", "warehouse")]["floor"] is False
        assert asks[("hostel", "room")]["bedrooms"] is False
        assert asks[("hostel", "bed_space")] == {
            "bedrooms": False, "bathrooms": "none", "floor": False,
        }


class TestATenantJoinsACheckedSpace:
    """A private access code exists only after the Unit has been checked."""

    def test_sharing_an_unverified_space_is_refused(
        self, owned, landlord, registered, approve_provider
    ):
        from apps.property import access_codes

        prop, unit = owned
        approve_provider(landlord, prop)
        with pytest.raises(Conflict, match="verified"):
            access_codes.rotate(unit=unit, actor=landlord)

    def test_once_the_space_passes_the_access_code_can_be_shared(
        self, owned, landlord, registered, approve_provider, approve_space
    ):
        from apps.property import access_codes

        prop, unit = owned
        approve_provider(landlord, prop)
        approve_space(unit)
        updated, code = access_codes.rotate(unit=unit, actor=landlord)

        assert updated.id == unit.id
        assert code

    def test_the_gate_reports_the_space_too(self, owned, landlord, approve_provider):
        """Installed clients receive a closed invitation gate with migration copy."""
        from apps.trust.gates import can_invite_tenant

        prop, unit = owned
        approve_provider(landlord, prop)

        decision = can_invite_tenant(prop=prop, unit=unit)

        assert decision.allowed is False
        assert decision.code == "workflow_retired"
        assert "access code" in decision.message.lower()


class TestBedsAreHostelOnly:
    def test_service_and_direct_api_refuse_a_bed_in_a_residential_room(
        self, owned, landlord, api, sign_in_as
    ):
        from apps.property import services
        from apps.property.models import Bed, Unit

        prop, _ = owned
        room = Unit.objects.create(
            property=prop,
            label="Residential Room",
            space_type="room",
            bedrooms=1,
            bathrooms=1,
        )

        with pytest.raises(Conflict, match="hostel"):
            services.add_bed(unit=room, user=landlord, data={"label": "Bed A"})

        sign_in_as(api, user=landlord)
        response = api.post(f"/api/v1/units/{room.id}/beds/", {"label": "Bed A"}, format="json")

        assert response.status_code == 409
        assert "hostel" in response.data["error"]["message"].lower()
        assert not Bed.objects.filter(unit=room).exists()

    def test_a_hostel_room_can_create_and_expose_beds(self, owned, landlord, api, sign_in_as):
        from apps.property.models import PropertyType, Unit

        prop, _ = owned
        prop.property_type = PropertyType.HOSTEL
        prop.save(update_fields=["property_type", "updated_at"])
        room = Unit.objects.create(
            property=prop,
            label="Hostel Room 1",
            space_type="room",
            bedrooms=1,
            bathrooms=1,
        )
        sign_in_as(api, user=landlord)

        created = api.post(f"/api/v1/units/{room.id}/beds/", {"label": "Bed A"}, format="json")
        detail = api.get(f"/api/v1/units/{room.id}/")

        assert created.status_code == 201
        assert detail.data["beds"][0]["label"] == "Bed A"
        assert detail.data["permitted_actions"]["add_bed"]["allowed"] is True

    def test_a_hostel_bed_space_cannot_itself_be_subdivided(self, owned, landlord):
        from apps.property import services
        from apps.property.models import PropertyType, Unit

        prop, _ = owned
        prop.property_type = PropertyType.HOSTEL
        prop.save(update_fields=["property_type", "updated_at"])
        bed_space = Unit.objects.create(
            property=prop,
            label="Bed Space 1",
            space_type="bed_space",
            bedrooms=0,
            bathrooms=1,
        )

        with pytest.raises(Conflict, match="hostel"):
            services.add_bed(unit=bed_space, user=landlord, data={"label": "Bed A"})

    def test_legacy_non_hostel_beds_are_not_exposed_on_active_surfaces(
        self, owned, landlord, api, sign_in_as
    ):
        from apps.property.models import Bed, Unit

        prop, _ = owned
        room = Unit.objects.create(
            property=prop,
            label="Residential Room",
            space_type="room",
            bedrooms=1,
            bathrooms=1,
        )
        Bed.objects.create(unit=room, label="Legacy Bed")
        sign_in_as(api, user=landlord)

        detail = api.get(f"/api/v1/units/{room.id}/")
        beds = api.get(f"/api/v1/units/{room.id}/beds/")
        property_detail = api.get(f"/api/v1/properties/{prop.id}/")

        assert detail.data["beds"] == []
        assert detail.data["permitted_actions"]["add_bed"]["allowed"] is False
        assert beds.data == []
        assert property_detail.data["bed_count"] == 0

    def test_a_property_with_bed_records_cannot_stop_being_a_hostel(self, owned, landlord):
        from apps.property import services
        from apps.property.models import Bed, PropertyType

        prop, existing = owned
        prop.property_type = PropertyType.HOSTEL
        prop.save(update_fields=["property_type", "updated_at"])
        existing.space_type = "room"
        existing.save(update_fields=["space_type", "updated_at"])
        Bed.objects.create(unit=existing, label="Bed A")

        with pytest.raises(ValidationFailed, match="must remain a hostel"):
            services.update_property(
                prop=prop,
                user=landlord,
                data={"property_type": PropertyType.RESIDENTIAL},
            )

        prop.refresh_from_db()
        assert prop.property_type == PropertyType.HOSTEL

    def test_a_legacy_non_hostel_bed_cannot_enter_a_tenancy_request(
        self, owned, landlord, registered, approve_provider, approve_space
    ):
        from apps.occupancy import services as occupancy_services
        from apps.property.models import Bed, Unit

        prop, _ = owned
        room = Unit.objects.create(
            property=prop,
            label="Residential Room",
            space_type="room",
            bedrooms=1,
            bathrooms=1,
        )
        bed = Bed.objects.create(unit=room, label="Legacy Bed")
        tenant = registered("0209691010")
        approve_provider(landlord, prop)
        approve_space(room)

        with pytest.raises(ValidationFailed, match="hostel"):
            occupancy_services.create_join_request(
                user=tenant,
                prop=prop,
                unit=room,
                bed=bed,
                access_code="test-code",
            )

    def test_a_legacy_non_hostel_bed_cannot_enter_a_lease(
        self, owned, landlord, registered, approve_provider
    ):
        from datetime import date, timedelta

        from apps.lease import services as lease_services
        from apps.property.models import Bed, Unit

        prop, _ = owned
        room = Unit.objects.create(
            property=prop,
            label="Residential Room",
            space_type="room",
            bedrooms=1,
            bathrooms=1,
        )
        bed = Bed.objects.create(unit=room, label="Legacy Bed")
        tenant = registered("0209691011")
        approve_provider(landlord, prop)

        with pytest.raises(ValidationFailed, match="hostel"):
            lease_services.draft_lease(
                user=landlord,
                unit=room,
                bed=bed,
                tenant=tenant,
                data={
                    "rent_minor": 100000,
                    "starts_on": date.today() + timedelta(days=14),
                    "term_months": 12,
                },
            )


class TestWaterIsShownWhenItIsAQuestion:
    def test_a_borehole_must_be_photographed(self, landlord, db):
        from apps.trust import evidence_policy

        class _Prop:
            id = "x"
            compound_type = "self_compound"
            water_source = "borehole"
            power_meter_type = "estate"

        slots = {slot.key: slot for slot in evidence_policy.property_requirements(_Prop())}

        assert "property.water" in slots
        assert slots["property.water"].required is True

    def test_estate_mains_is_never_asked_about(self, db):
        from apps.trust import evidence_policy

        class _Prop:
            id = "x"
            compound_type = "self_compound"
            water_source = "estate"
            power_meter_type = "estate"

        keys = {slot.key for slot in evidence_policy.property_requirements(_Prop())}

        assert "property.water" not in keys


class TestARefusalSaysWhatHappened:
    def test_a_duplicate_bed_label_is_not_reported_as_a_concurrent_edit(
        self, api, sign_in_as, owned, landlord
    ):
        """The message people kept seeing.

        Every IntegrityError became a bare `Conflict()`, whose default read
        "Someone else changed this while you were working. Reload and try
        again." A duplicate bed label is not a concurrent edit, and reloading
        could never fix it.
        """
        from apps.property.models import Bed, PropertyType, Unit

        prop, _ = owned
        prop.property_type = PropertyType.HOSTEL
        prop.save(update_fields=["property_type", "updated_at"])
        room = Unit.objects.create(
            property=prop,
            label="Shared Room",
            space_type="room",
            bedrooms=1,
            bathrooms=1,
        )
        Bed.objects.create(unit=room, label="Bed 1")
        sign_in_as(api, user=landlord)

        response = api.post(f"/api/v1/units/{room.id}/beds/", {"label": "Bed 1"}, format="json")

        assert response.status_code == 409
        message = response.data["error"]["message"]
        assert "Someone else changed this" not in message
        assert "label" in message.lower()


class TestAClaimantCanGetTheirOwnPropertyChecked:
    """The bug that made the whole feature unreachable.

    `create_private_property` deliberately creates no `PropertyRelationship` —
    the creator is a claimant, and private setup is not proof of ownership; the
    relationship is materialised later by a reviewed authority workflow.

    `assert_may_review` required one anyway, so it refused every provider on
    their own property — and getting it checked is the step that would earn them
    the relationship. The check made its own precondition unreachable.
    """

    @pytest.fixture
    def claimed(self, landlord, db):
        from apps.geo.models import Address, District, Locality, Region
        from apps.organization import services as org_services
        from apps.property import services as property_services
        from tests.conftest import approve_provider_standing

        region = Region.objects.first() or Region.objects.create(name="Greater Accra")
        district = District.objects.filter(region=region).first() or District.objects.create(
            region=region, name="Adentan Municipal"
        )
        locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
            district=district, name="Adenta"
        )
        address = Address.objects.create(locality=locality, street="7 Claim Road")

        approve_provider_standing(landlord)
        organization = org_services.create_organization(
            user=landlord,
            data={
                "name": "Claimant Properties",
                "organization_type": "individual_owner",
                "activities": ["residential"],
            },
        )
        prop = property_services.create_private_property(
            user=landlord,
            organization=organization,
            data={
                "title": "Claimed Court",
                "property_type": "residential",
                "address_id": address.id,
            },
        )
        unit = property_services.add_unit(
            prop=prop,
            user=landlord,
            data={"label": "Flat 1", "space_type": "apartment", "bedrooms": 1, "bathrooms": 1},
        )
        return prop, unit

    def test_the_property_has_no_relationship_yet(self, claimed):
        """The precondition the old check demanded, and which does not exist."""
        prop, _ = claimed

        assert not prop.relationships.filter(ended_at__isnull=True).exists()
        assert prop.owner_id is None

    def test_the_claimant_can_still_see_what_is_needed(self, claimed, landlord):
        from apps.trust import condition

        prop, _ = claimed

        state = condition.progress(subject=prop, user=landlord)

        assert state["required_outstanding"] == 3

    def test_the_claimant_can_submit_it(self, claimed, landlord):
        from apps.trust import condition
        from apps.trust.models import ReviewQueueEntry

        prop, _ = claimed
        _fill(prop, landlord, ["property.front", "property.side", "property.surroundings"])

        review = condition.submit_for_review(subject=prop, actor=landlord)

        assert ReviewQueueEntry.objects.filter(verification=review).exists()

    def test_a_stranger_still_cannot(self, claimed, registered):
        """Widening the check must not have opened it to everybody."""
        from apps.trust import condition

        prop, _ = claimed

        with pytest.raises(PermissionDenied):
            condition.progress(subject=prop, user=registered("0209692001"))

    def test_the_spaces_inside_it_too(self, claimed, landlord):
        from apps.trust import condition

        _, unit = claimed

        state = condition.progress(subject=unit, user=landlord)

        # One photograph, because the property it sits in is being checked in
        # the same visit and its three views are asked for there.
        assert state["required_outstanding"] == 1
        assert state["state"] == "draft"


class TestAnApprovedCheckStaysApproved:
    """The checklist came back from the beginning once a reviewer approved it.

    `progress` asked only for an *open* review. An approved one is not open, so
    it found nothing and reported `not_started`, rendering every slot again as
    though no photograph had ever been sent. Adding one then failed, because
    `open_review` could see the approval the screen could not.
    """

    def _approve(self, subject, landlord, keys):
        from django.utils import timezone

        from apps.trust import condition
        from apps.trust.models import VerificationStatus

        _fill(subject, landlord, keys)
        review = condition.submit_for_review(subject=subject, actor=landlord)
        review.status = VerificationStatus.APPROVED
        review.decided_at = timezone.now()
        review.save(update_fields=["status", "decided_at"])
        return review

    def test_progress_reports_it_as_approved(self, owned, landlord):
        from apps.trust import condition

        prop, _ = owned
        self._approve(prop, landlord, ["property.front", "property.side", "property.surroundings"])

        state = condition.progress(subject=prop, user=landlord)

        assert state["status"] == "approved"
        assert state["submitted"] is True
        assert state["can_submit"] is False

    def test_nothing_is_asked_for_again(self, owned, landlord):
        """Listing the slots again is what made a checked property look untouched."""
        from apps.trust import condition

        prop, _ = owned
        self._approve(prop, landlord, ["property.front", "property.side", "property.surroundings"])

        state = condition.progress(subject=prop, user=landlord)

        assert state["slots"] == []
        assert state["required_outstanding"] == 0

    def test_the_state_reads_approved(self, owned, landlord):
        from apps.trust import condition

        prop, _ = owned
        self._approve(prop, landlord, ["property.front", "property.side", "property.surroundings"])

        assert condition.state_of(prop) == "approved"

    def test_a_submitted_check_reads_as_pending(self, owned, landlord):
        from apps.trust import condition

        prop, _ = owned
        _fill(prop, landlord, ["property.front", "property.side", "property.surroundings"])
        condition.submit_for_review(subject=prop, actor=landlord)

        assert condition.state_of(prop) == "pending"

    def test_photos_started_is_not_the_same_as_submitted(self, owned, landlord):
        """A provider can still act on one; the other is a wait they cannot shorten."""
        from apps.trust import condition

        prop, _ = owned
        _fill(prop, landlord, ["property.front"])

        assert condition.state_of(prop) == "in_progress"

    def test_an_untouched_property_reads_as_not_started(self, owned, landlord):
        from apps.trust import condition

        prop, _ = owned

        assert condition.state_of(prop) == "not_started"


class TestTheAccessCodeNamesASpace:
    def test_each_verified_space_may_receive_its_own(
        self, owned, approve_space, approve_provider, landlord
    ):
        """Drafts have no secret; providers explicitly create one after verification."""
        from apps.property import access_codes
        from apps.property.models import Unit

        prop, unit = owned
        approve_provider(landlord, prop)
        other = Unit.objects.create(
            property=prop,
            label="Flat 2",
            space_type="apartment",
            bedrooms=1,
            bathrooms=1,
        )

        assert unit.access_code_hash is None
        assert other.access_code_hash is None

        approve_space(unit)
        approve_space(other)
        unit, unit_code = access_codes.rotate(unit=unit, actor=landlord)
        other, other_code = access_codes.rotate(unit=other, actor=landlord)
        assert unit.access_code_hash
        assert other.access_code_hash
        assert unit.access_code_hash != other.access_code_hash
        assert unit_code != other_code

    def test_the_property_no_longer_carries_one(self, owned):
        prop, _ = owned

        assert not hasattr(prop, "join_code")

    def test_a_code_admits_a_request_for_its_own_space_only(
        self, owned, approve_space, approve_provider, registered, landlord
    ):
        from apps.core.exceptions import NotFound
        from apps.occupancy import services
        from apps.property import access_codes
        from apps.property.models import Unit

        prop, unit = owned
        approve_provider(landlord, prop)
        other = Unit.objects.create(
            property=prop,
            label="Flat 2",
            space_type="apartment",
            bedrooms=1,
            bathrooms=1,
        )
        hopeful = registered("0209693001")

        approve_space(unit)
        approve_space(other)
        unit, unit_code = access_codes.rotate(unit=unit, actor=landlord)
        other, _ = access_codes.rotate(unit=other, actor=landlord)

        # The right code for the right space.
        request = services.create_join_request(
            user=hopeful, prop=prop, unit=unit, access_code=unit_code
        )
        assert request.unit_id == unit.id

        # The neighbour's code does not open this door.
        with pytest.raises(NotFound):
            services.create_join_request(user=hopeful, prop=prop, unit=other, access_code=unit_code)


class TestClaimingAnExistingProperty:
    """Ownership comes from a reviewed claim, and there has to be a way to make one.

    A privately created property has no owner and no relationship — deliberately,
    because setting one up is not proof of holding it. Only an approved authority
    application writes a `PropertyRelationship`, so a property with no route to
    that review stays ownerless forever, and the operations list shows a blank
    owner column for it indefinitely.
    """

    @pytest.fixture
    def claimed(self, landlord, db):
        from apps.geo.models import Address, District, Locality, Region
        from apps.organization import services as org_services
        from apps.property import services as property_services
        from tests.conftest import approve_provider_standing

        region = Region.objects.first() or Region.objects.create(name="Greater Accra")
        district = District.objects.filter(region=region).first() or District.objects.create(
            region=region, name="Adentan Municipal"
        )
        locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
            district=district, name="Adenta"
        )
        address = Address.objects.create(locality=locality, street="11 Authority Road")

        approve_provider_standing(landlord)
        organization = org_services.create_organization(
            user=landlord,
            data={
                "name": "Authority Properties",
                "organization_type": "individual_owner",
                "activities": ["residential"],
            },
        )
        prop = property_services.create_private_property(
            user=landlord,
            organization=organization,
            data={
                "title": "Unclaimed Court",
                "property_type": "residential",
                "address_id": address.id,
            },
        )
        return prop

    def test_it_starts_with_nobody_recorded_against_it(self, claimed):
        assert claimed.owner_id is None
        assert not claimed.relationships.exists()

    def test_a_claim_can_be_made_for_a_property_that_already_exists(self, claimed, landlord):
        """The route that did not exist."""
        from apps.property import services
        from apps.property.models import PropertyProviderApplication

        _verify_person(landlord)

        application = services.submit_provider_application(
            user=landlord,
            data={"relationship_type": "owner", "property_id": str(claimed.id)},
            files=[_photo(landlord, purpose="property_document")],
        )

        assert application.property_id == claimed.id
        assert PropertyProviderApplication.objects.filter(property=claimed).count() == 1

    def test_approval_is_what_records_the_holder(self, claimed, landlord):
        """A photograph never does this. A reviewed document does."""
        from apps.operations.models import ManagementRole, ManagementUser
        from apps.property import services
        from apps.property.models import PropertyRelationshipType

        _verify_person(landlord)
        application = services.submit_provider_application(
            user=landlord,
            data={"relationship_type": "owner", "property_id": str(claimed.id)},
            files=[_photo(landlord, purpose="property_document")],
        )
        reviewer = ManagementUser.objects.create(
            email="authority@example.com",
            first_name="Ops",
            last_name="Reviewer",
            role=ManagementRole.OPERATIONS_ADMIN,
            password="unused",
        )

        # The decision is applied to the *verification*, which is what a
        # reviewer actually acts on; the application is found from it.
        from apps.trust.models import Verification

        verification = Verification.objects.get(id=application.authority_verification_id)
        services.apply_provider_application_decision(
            verification=verification,
            approved=True,
            reviewer=None,
            management_actor=reviewer,
            note="Indenture checked.",
        )

        claimed.refresh_from_db()
        holder = claimed.relationships.filter(ended_at__isnull=True).first()
        assert holder is not None
        assert holder.user_id == landlord.id
        assert holder.relationship_type == PropertyRelationshipType.OWNER


class TestAClaimInProgressIsVisible:
    """The form came back after submitting, and submitting again was refused.

    The verification for an authority application is filed against the
    *application*, not the property, so a property with a claim in review had no
    `PROPERTY_AUTHORITY` verification of its own and read as untouched. The
    screen offered the claim form again, and the second attempt hit "you already
    have a property authority review in progress" — a dead end reached by
    following the interface.
    """

    @pytest.fixture
    def claimed(self, landlord, db):
        from apps.geo.models import Address, District, Locality, Region
        from apps.organization import services as org_services
        from apps.property import services as property_services
        from tests.conftest import approve_provider_standing, upgrade_portfolio

        region = Region.objects.first() or Region.objects.create(name="Greater Accra")
        district = District.objects.filter(region=region).first() or District.objects.create(
            region=region, name="Adentan Municipal"
        )
        locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
            district=district, name="Adenta"
        )
        approve_provider_standing(landlord)
        organization = org_services.create_organization(
            user=landlord,
            data={
                "name": "Claim Progress Properties",
                "organization_type": "individual_owner",
                "activities": ["residential"],
            },
        )
        # This class is about a landlord with several buildings claiming them
        # independently, so the Portfolio needs room for several.
        upgrade_portfolio(organization, "BUSINESS")

        def _make(title, street):
            address = Address.objects.create(locality=locality, street=street)
            return property_services.create_private_property(
                user=landlord,
                organization=organization,
                data={
                    "title": title,
                    "property_type": "residential",
                    "address_id": address.id,
                },
            )

        return _make

    def _state(self, prop, user):
        from apps.property.serializers import PropertySerializer

        return PropertySerializer(prop, context={"user": user}).data["authority_state"]

    def test_a_property_with_a_claim_in_review_reads_as_pending(self, claimed, landlord):
        from apps.property import services

        prop = claimed("Waiting Court", "1 Waiting Road")
        _verify_person(landlord)
        assert self._state(prop, landlord) == "unverified"

        services.submit_provider_application(
            user=landlord,
            data={"relationship_type": "owner", "property_id": str(prop.id)},
            files=[_photo(landlord, purpose="property_document")],
        )

        # Pending, so the screen shows "with our team" rather than the form.
        assert self._state(prop, landlord) == "pending"

    def test_a_claim_on_one_property_does_not_block_another(self, claimed, landlord):
        """The rule was per person, so a landlord with four buildings had to
        claim them one at a time, waiting for a review between each."""
        from apps.property import services

        first = claimed("First Court", "2 First Road")
        second = claimed("Second Court", "3 Second Road")
        _verify_person(landlord)

        services.submit_provider_application(
            user=landlord,
            data={"relationship_type": "owner", "property_id": str(first.id)},
            files=[_photo(landlord, purpose="property_document")],
        )

        application = services.submit_provider_application(
            user=landlord,
            data={"relationship_type": "owner", "property_id": str(second.id)},
            files=[_photo(landlord, purpose="property_document")],
        )

        assert application.property_id == second.id

    def test_the_same_property_cannot_be_claimed_twice_over(self, claimed, landlord):
        from apps.core.exceptions import Conflict
        from apps.property import services

        prop = claimed("Twice Court", "4 Twice Road")
        _verify_person(landlord)
        services.submit_provider_application(
            user=landlord,
            data={"relationship_type": "owner", "property_id": str(prop.id)},
            files=[_photo(landlord, purpose="property_document")],
        )

        with pytest.raises(Conflict) as raised:
            services.submit_provider_application(
                user=landlord,
                data={"relationship_type": "owner", "property_id": str(prop.id)},
                files=[_photo(landlord, purpose="property_document")],
            )

        # Names the property, so somebody can tell which one is blocking.
        assert "this property" in str(raised.value).lower()


class TestTheVocabularyIsPublic:
    """The listing browser needs it signed out.

    That filter carried its own list — apartment, house, villa, studio — which
    stopped being property types when they became categories. Every choice then
    filtered on a value nothing is stored under and returned an empty page, and
    a signed-out browser could not read the real list to know better.
    """

    def test_a_signed_out_visitor_can_read_the_categories(self, db):
        from rest_framework.test import APIClient

        response = APIClient().get("/api/v1/property-types/")

        assert response.status_code == 200
        values = {row["value"] for row in response.data["property_types"]}
        assert values == {"residential", "commercial", "hostel"}

    def test_it_exposes_no_property_and_no_person(self, db, landlord):
        """Vocabulary, not data. Worth asserting before it is made public."""
        from rest_framework.test import APIClient

        body = str(APIClient().get("/api/v1/property-types/").data)

        assert str(landlord.id) not in body
        assert "phone" not in body.lower()


class TestTenantManagementNeedsTheProperty:
    """Placing somebody in a building needs that building confirmed as yours.

    Private tenant management used to ask only who the manager was. A tenant
    handed keys to a property nobody has confirmed the provider holds is the
    person least able to check it, and "it is private" is the framing under
    which that goes unexamined.
    """

    def test_an_unconfirmed_property_closes_both_paths(self, owned, landlord):
        """Invitations and leases together — one alone would be a gap."""
        from apps.property.capabilities import property_capabilities

        prop, _ = owned
        # `owned` gives the landlord a live relationship but no approved
        # authority verification, which is exactly the unconfirmed case.
        capabilities = property_capabilities(prop=prop, user=landlord)

        assert capabilities["tenant_access"]["allowed"] is False
        assert capabilities["leases"]["allowed"] is False
        assert "property_authority" in capabilities["tenant_access"]["missing"]

    def test_building_inventory_stays_open(self, owned, landlord):
        """Describing a property is how the claim gets made in the first place."""
        from apps.property.capabilities import property_capabilities

        prop, _ = owned

        assert (
            property_capabilities(prop=prop, user=landlord)["private_inventory"]["allowed"] is True
        )

    def test_a_confirmed_property_opens_them_again(
        self, owned, landlord, approve_provider, approve_space
    ):
        from apps.property.capabilities import property_capabilities

        prop, unit = owned
        approve_provider(landlord, prop)
        approve_space(unit)

        capabilities = property_capabilities(prop=prop, user=landlord)
        assert capabilities["tenant_access"]["allowed"] is True
        assert capabilities["leases"]["allowed"] is True

        from apps.property import access_codes

        updated, code = access_codes.rotate(unit=unit, actor=landlord)
        assert updated.id == unit.id
        assert code
