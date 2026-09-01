"""Creating a property, and submitting one, are two different things.

The reported fault, in the provider's words: the creation wizard's second step
said **"Send this claim for review"** and sent it, and the wizard's final button
said **"Send photographs"**. Neither is what somebody creating a property is
doing.

Underneath, `submit_provider_application` created the claim already at
`PENDING_REVIEW` and queued it. So recording the document *was* submitting it.
Photographs already worked the other way — `condition.attach` collects, and
`submit_for_review` queues — and the asymmetry was the whole defect: by the time
the provider reached the last step, the claim had been gone for four steps and
only the photographs were left to send.

These pin the split:

1. **Nothing in creation reaches a reviewer.** Not the document, not the
   photographs, not the amenities, and not finishing.
2. **Submission is one act over both halves**, made afterwards.
3. **The rules are enforced, not merely hidden** — the same refusal reaches a
   direct API call, because a control missing from a page is not a rule.
"""

import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.policy import permitted_actions
from apps.property.models import ProviderApplicationStatus
from apps.property.verification import PropertyVerificationState, lifecycle
from apps.trust.models import ReviewQueueEntry

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def provider(landlord, db):
    """A provider who may actually create and send a property.

    Identity-verified because sending has always been gated on it: the
    submission carries an ownership claim, and a reviewer cannot decide whose
    building it is without knowing who is asking. That check used to sit on the
    claim endpoint and now sits on the one property-level submission.
    """
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
    return landlord


@pytest.fixture
def workspace(provider, db):
    from apps.organization.models import MembershipRole, Organization, OrganizationMembership

    organization = Organization.objects.create(name="Creation Lettings", created_by=provider)
    OrganizationMembership.objects.create(
        organization=organization,
        user=provider,
        role=MembershipRole.OWNER,
        joined_at=timezone.now(),
    )
    return organization


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Ayawaso West"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="East Legon"
    )
    return Address.objects.create(locality=locality, street="7 Creation Close")


@pytest.fixture
def upload(provider, db):
    from apps.files.models import ScanStatus, StoredFile, UploadStatus

    def make(purpose="property_photo"):
        return StoredFile.objects.create(
            uploaded_by=provider,
            owner_id_snapshot=str(provider.id),
            purpose=purpose,
            original_filename="f.jpg",
            declared_content_type="image/jpeg",
            content_type="image/jpeg",
            size_bytes=90_000,
            storage_key=f"{purpose}/{provider.id}/{uuid.uuid4().hex}.jpg",
            upload_status=UploadStatus.READY,
            scan_status=ScanStatus.CLEAN,
        )

    return make


@pytest.fixture
def shared_amenity(db):
    """One property-scoped amenity.

    Created rather than looked up: the vocabulary is seeded by a management
    command, not a migration, so a test database has none and every assertion
    that depended on one was quietly skipping.
    """
    from apps.property.models import Amenity, AmenityCategory, AmenityScope

    return Amenity.objects.create(
        name="Borehole",
        category=AmenityCategory.WATER,
        scope=AmenityScope.PROPERTY,
        is_active=True,
    )


@pytest.fixture
def created(api, provider, workspace, address, upload, sign_in_as):
    """Walk the whole creation journey over HTTP and hand back the property.

    Every step here is a request the wizard makes. If any of them reached a
    reviewer, `test_nothing_in_creation_reaches_a_reviewer` would say so.
    """
    sign_in_as(api, user=provider)

    made = api.post(
        f"/api/v1/organizations/{workspace.id}/properties/",
        {"title": "Creation Court", "property_type": "residential", "address_id": str(address.id)},
        format="json",
    )
    assert made.status_code == 201, made.data
    property_id = made.data["id"]

    # 1. Details. Not description — `trust.evidence_policy` reads these to
    #    decide what the property has to photograph, which is why they precede
    #    the photographs step.
    described = api.patch(
        f"/api/v1/properties/{property_id}/",
        {"water_source": "borehole", "power_meter_type": "prepaid", "compound_type": "family"},
        format="json",
    )
    assert described.status_code == 200, described.data

    # 2. Documents.
    recorded = api.post(
        f"/api/v1/properties/{property_id}/claim/",
        {"relationship_type": "owner", "file_ids": [str(upload("property_document").id)]},
        format="json",
    )
    assert recorded.status_code == 201, recorded.data

    # 3. Photos.
    state = api.get(f"/api/v1/properties/{property_id}/verification/").data
    for slot in state["slots"]:
        if slot["required"]:
            added = api.post(
                f"/api/v1/properties/{property_id}/verification/evidence/",
                {"slot_key": slot["key"], "file_id": str(upload().id)},
                format="json",
            )
            assert added.status_code == 201, added.data

    # 4. Amenities — optional, and a compound may genuinely share nothing.
    return property_id


class TestTheCreationJourney:
    def test_a_created_property_exists_and_has_not_been_submitted(self, created, provider):
        from apps.property.models import Property

        prop = Property.objects.get(id=created)
        result = lifecycle(prop)

        # The state the whole split exists to make expressible: finished, and
        # nobody has been asked to look at it.
        assert result["state"] == PropertyVerificationState.READY
        assert result["review_state"] == "not_submitted"
        assert result["editable"] is True
        assert result["with_reviewer"] is False
        assert result["submitted_at"] is None

    def test_nothing_in_creation_reaches_a_reviewer(self, created):
        """The load-bearing assertion. Four steps, and the queue is empty.

        Recording the document used to queue it on the spot, which is why the
        wizard's last step had only photographs left to send.
        """
        assert not ReviewQueueEntry.objects.exists()

    def test_the_document_is_held_as_a_draft(self, created):
        from apps.property.models import PropertyProviderApplication

        claim = PropertyProviderApplication.objects.get(property_id=created)

        assert claim.status == ProviderApplicationStatus.DRAFT
        assert claim.submitted_at is None
        # Held, with its evidence, so submitting is a button rather than the
        # whole step over again.
        assert claim.authority_verification_id is not None

    def test_a_created_property_may_be_edited_deleted_or_submitted(self, created, provider):
        """What section 7 of the brief asks the properties page to offer."""
        from apps.property.models import Property

        prop = Property.objects.get(id=created)
        actions = permitted_actions("property", actor=provider, target=prop)

        assert actions["edit"]["allowed"] is True
        assert actions["submit_for_verification"]["allowed"] is True
        assert actions["archive"]["allowed"] is True
        # Deletable because nobody outside the workspace has seen it. This was
        # refused before: `can_delete_property` needed a live
        # `PropertyRelationship`, which only exists once an authority claim has
        # been *approved* — so a provider could not delete the property they had
        # just created, and could delete the one that had just been verified.
        assert actions["delete"]["allowed"] is True


class TestRemovingOne:
    """A property nobody has been asked to look at is the provider's to remove.

    The backend has answered this correctly all along. The clients did not: the
    properties list rendered "Delete" as a link to the property page, so it
    navigated and removed nothing, and the property page had no delete control
    at all. These pin the HTTP path the working control now uses.
    """

    def test_a_property_still_being_created_can_be_deleted(
        self, api, provider, workspace, address, sign_in_as
    ):
        from apps.property.models import Property

        sign_in_as(api, user=provider)
        made = api.post(
            f"/api/v1/organizations/{workspace.id}/properties/",
            {"title": "Half done", "property_type": "residential", "address_id": str(address.id)},
            format="json",
        )
        property_id = made.data["id"]

        gone = api.delete(
            f"/api/v1/properties/{property_id}/archive/" "?reason=Created+by+mistake&confirmed=true"
        )

        assert gone.status_code == 204, getattr(gone, "data", None)
        assert not Property.all_objects.filter(id=property_id).exists()

    def test_a_created_but_unsent_property_can_be_deleted(self, created, api):
        from apps.property.models import Property

        gone = api.delete(
            f"/api/v1/properties/{created}/archive/?reason=Wrong+building&confirmed=true"
        )

        assert gone.status_code == 204, getattr(gone, "data", None)
        assert not Property.all_objects.filter(id=created).exists()

    def test_the_reason_is_required_and_recorded(self, created, api):
        from apps.audit.models import AuditLog

        without = api.delete(f"/api/v1/properties/{created}/archive/?confirmed=true")
        assert without.status_code == 422, "a destructive act with no reason is refused"

        api.delete(f"/api/v1/properties/{created}/archive/?reason=Duplicate&confirmed=true")

        entry = AuditLog.objects.filter(aggregate_id=str(created)).order_by("-created_at").first()
        assert entry is not None, "the record outlives the row it describes"
        assert entry.metadata.get("reason") == "Duplicate"

    def test_confirmation_is_not_assumed(self, created, api):
        from apps.property.models import Property

        refused = api.delete(f"/api/v1/properties/{created}/archive/?reason=Oops")

        assert refused.status_code in (409, 422)
        assert Property.all_objects.filter(id=created).exists()

    def test_a_submitted_property_cannot_be_deleted(self, created, api):
        from apps.property.models import Property

        api.post(f"/api/v1/properties/{created}/verification/", {}, format="json")

        refused = api.delete(
            f"/api/v1/properties/{created}/archive/?reason=Changed+my+mind&confirmed=true"
        )

        assert refused.status_code == 409
        assert Property.all_objects.filter(id=created).exists()


class TestNoPrematureSubmission:
    """Each step in turn, checked for a reviewer it should not have reached."""

    def test_the_details_step_submits_nothing(self, api, provider, workspace, address, sign_in_as):
        sign_in_as(api, user=provider)
        made = api.post(
            f"/api/v1/organizations/{workspace.id}/properties/",
            {"title": "Step one", "property_type": "residential", "address_id": str(address.id)},
            format="json",
        )
        api.patch(
            f"/api/v1/properties/{made.data['id']}/",
            {"water_source": "tap", "power_meter_type": "prepaid"},
            format="json",
        )

        assert not ReviewQueueEntry.objects.exists()

    def test_the_documents_step_submits_nothing(
        self, api, provider, workspace, address, upload, sign_in_as
    ):
        from apps.property.models import Property

        sign_in_as(api, user=provider)
        made = api.post(
            f"/api/v1/organizations/{workspace.id}/properties/",
            {"title": "Step two", "property_type": "residential", "address_id": str(address.id)},
            format="json",
        )

        recorded = api.post(
            f"/api/v1/properties/{made.data['id']}/claim/",
            {"relationship_type": "owner", "file_ids": [str(upload("property_document").id)]},
            format="json",
        )

        assert recorded.status_code == 201, recorded.data
        assert not ReviewQueueEntry.objects.exists()
        prop = Property.objects.get(id=made.data["id"])
        assert lifecycle(prop)["with_reviewer"] is False

    def test_the_photos_step_submits_nothing(
        self, api, provider, workspace, address, upload, sign_in_as
    ):
        sign_in_as(api, user=provider)
        made = api.post(
            f"/api/v1/organizations/{workspace.id}/properties/",
            {"title": "Step three", "property_type": "residential", "address_id": str(address.id)},
            format="json",
        )
        property_id = made.data["id"]
        state = api.get(f"/api/v1/properties/{property_id}/verification/").data
        for slot in state["slots"]:
            if slot["required"]:
                api.post(
                    f"/api/v1/properties/{property_id}/verification/evidence/",
                    {"slot_key": slot["key"], "file_id": str(upload().id)},
                    format="json",
                )

        assert not ReviewQueueEntry.objects.exists()

    def test_the_amenities_step_submits_nothing(self, created, api, shared_amenity):
        amenity = shared_amenity

        saved = api.put(
            f"/api/v1/properties/{created}/amenities/",
            {"amenity_ids": [str(amenity.id)]},
            format="json",
        )

        assert saved.status_code == 200, saved.data
        assert not ReviewQueueEntry.objects.exists()

    def test_finishing_creation_submits_nothing(self, created):
        """There is no "finish" request at all, and that is the point.

        Creation completes when its inputs are in. The wizard's last button
        navigates; it does not call anything. So a property can sit created and
        unsent indefinitely, which is exactly the state a provider running
        private inventory wants.
        """
        assert not ReviewQueueEntry.objects.exists()


class TestSubmittingIsItsOwnAct:
    def test_it_sends_both_halves_together(self, created, api):
        from apps.property.models import Property, PropertyProviderApplication

        sent = api.post(f"/api/v1/properties/{created}/verification/", {}, format="json")

        assert sent.status_code == 200, sent.data
        claim = PropertyProviderApplication.objects.get(property_id=created)
        assert claim.status == ProviderApplicationStatus.PENDING_REVIEW
        assert claim.submitted_at is not None
        # Two reviews, both queued, in one request. A reviewer holding
        # photographs of a building nobody has claimed cannot decide anything.
        assert ReviewQueueEntry.objects.count() == 2
        assert lifecycle(Property.objects.get(id=created))["state"] == (
            PropertyVerificationState.SUBMITTED
        )
        assert lifecycle(Property.objects.get(id=created))["review_state"] == (
            "pending_verification"
        )

    def test_photographs_alone_are_not_a_submission(
        self, api, provider, workspace, address, upload, sign_in_as
    ):
        sign_in_as(api, user=provider)
        made = api.post(
            f"/api/v1/organizations/{workspace.id}/properties/",
            {"title": "No claim", "property_type": "residential", "address_id": str(address.id)},
            format="json",
        )
        property_id = made.data["id"]
        state = api.get(f"/api/v1/properties/{property_id}/verification/").data
        for slot in state["slots"]:
            if slot["required"]:
                api.post(
                    f"/api/v1/properties/{property_id}/verification/evidence/",
                    {"slot_key": slot["key"], "file_id": str(upload().id)},
                    format="json",
                )

        refused = api.post(f"/api/v1/properties/{property_id}/verification/", {}, format="json")

        assert refused.status_code == 409
        assert "document" in refused.data["error"]["message"].lower()
        assert not ReviewQueueEntry.objects.exists()


class TestPendingIsLocked:
    """Section 10: sent means sent. Enforced, not hidden."""

    @pytest.fixture
    def pending(self, created, api):
        api.post(f"/api/v1/properties/{created}/verification/", {}, format="json")
        return created

    def test_the_property_cannot_be_edited(self, pending, api):
        refused = api.patch(
            f"/api/v1/properties/{pending}/", {"water_source": "tap"}, format="json"
        )

        assert refused.status_code == 409
        assert "review" in refused.data["error"]["message"].lower()

    def test_it_cannot_be_submitted_again(self, pending, api):
        refused = api.post(f"/api/v1/properties/{pending}/verification/", {}, format="json")

        assert refused.status_code == 409
        # And nothing was double-queued by the attempt.
        assert ReviewQueueEntry.objects.count() == 2

    def test_it_cannot_be_deleted_or_archived(self, pending, provider):
        from apps.property.models import Property

        prop = Property.objects.get(id=pending)
        actions = permitted_actions("property", actor=provider, target=prop)

        assert actions["delete"]["allowed"] is False
        assert actions["archive"]["allowed"] is False
        assert "review" in actions["archive"]["message"].lower()

    def test_the_document_cannot_be_replaced(self, pending, api, upload):
        refused = api.post(
            f"/api/v1/properties/{pending}/claim/",
            {"relationship_type": "owner", "file_ids": [str(upload("property_document").id)]},
            format="json",
        )

        assert refused.status_code == 409
        assert "already" in refused.data["error"]["message"].lower()

    def test_only_viewing_and_withdrawing_are_offered(self, pending, provider):
        from apps.property.models import Property

        prop = Property.objects.get(id=pending)
        actions = permitted_actions("property", actor=provider, target=prop)

        allowed = {name for name, decision in actions.items() if decision["allowed"]}
        assert allowed == {"withdraw_submission"}


class TestWithdrawnIsEditableAgain:
    @pytest.fixture
    def withdrawn(self, created, api):
        api.post(f"/api/v1/properties/{created}/verification/", {}, format="json")
        taken = api.post(
            f"/api/v1/properties/{created}/verification/withdraw/",
            {"reason": "Wrong document"},
            format="json",
        )
        assert taken.status_code == 200, taken.data
        return created

    def test_the_property_still_exists(self, withdrawn):
        """Withdrawal withdraws the request, not the property."""
        from apps.property.models import Property

        prop = Property.objects.filter(id=withdrawn).first()

        assert prop is not None
        assert prop.deleted_at is None
        # And it is back where creation left it, not back at the beginning.
        assert lifecycle(prop)["state"] == PropertyVerificationState.READY
        assert lifecycle(prop)["review_state"] == "withdrawn"

    def test_everything_sent_is_kept(self, withdrawn):
        from apps.property.models import PropertyProviderApplication

        claim = PropertyProviderApplication.objects.get(property_id=withdrawn)

        assert claim.status == ProviderApplicationStatus.WITHDRAWN
        assert claim.authority_verification_id is not None
        assert not ReviewQueueEntry.objects.exists()

    def test_edit_and_resubmit_come_back(self, withdrawn, api, provider):
        from apps.property.models import Property

        edited = api.patch(f"/api/v1/properties/{withdrawn}/", {"title": "Renamed"}, format="json")
        assert edited.status_code == 200

        actions = permitted_actions(
            "property", actor=provider, target=Property.objects.get(id=withdrawn)
        )
        assert actions["edit"]["allowed"] is True
        assert actions["submit_for_verification"]["allowed"] is True

        again = api.post(f"/api/v1/properties/{withdrawn}/verification/", {}, format="json")
        assert again.status_code == 200, again.data

    def test_the_withdrawal_is_in_the_audit_record(self, withdrawn):
        from apps.audit.models import AuditLog

        entries = AuditLog.objects.filter(aggregate_id=str(withdrawn)).order_by("created_at")

        assert any(entry.metadata.get("action") == "withdraw" for entry in entries)
        assert any(entry.metadata.get("action") == "submit_for_verification" for entry in entries)


class TestAnsweringAQueriedDocument:
    """A reviewer asked for a different document. The provider can give one.

    This is the one case where the Documents step is not recording a draft: the
    reviewer is holding the case open and waiting, so a new document has to reach
    *that* case rather than start a fresh one beside it. `condition.attach` makes
    the same exception for photographs under `changes_requested`.

    It dead-ended before. The step offered the form and sending it came back
    "There is already a review in progress for this property. We will let you
    know the outcome" — to the very provider being waited on. The only code that
    could answer a queried claim lived on a standalone screen nothing linked to.
    """

    @pytest.fixture
    def queried(self, created, api, provider, staff):
        """A submitted property whose document a reviewer has asked more about."""
        from apps.property.models import PropertyProviderApplication
        from apps.trust import services as trust_services
        from apps.trust.models import Verification

        api.post(f"/api/v1/properties/{created}/verification/", {}, format="json")
        claim = PropertyProviderApplication.objects.get(property_id=created)
        # The reviewer's own entry point, not the property-side hook it fires:
        # `request_more_information` is what moves the verification, and the
        # application follows. Reaching past it produced a state the product
        # cannot actually be in — the claim queried, the review still pending.
        trust_services.request_more_information(
            Verification.objects.get(id=claim.authority_verification_id),
            note="That document does not name you.",
            decided_by=staff,
        )
        return created

    def test_the_property_says_changes_were_requested(self, queried):
        from apps.property.models import Property

        result = lifecycle(Property.objects.get(id=queried))

        assert result["state"] == PropertyVerificationState.CHANGES_REQUESTED
        assert result["decision_note"] == "That document does not name you."

    def test_a_new_document_reaches_the_open_case(self, queried, api, upload):
        from apps.property.models import PropertyProviderApplication

        answered = api.post(
            f"/api/v1/properties/{queried}/claim/",
            {"relationship_type": "owner", "file_ids": [str(upload("property_document").id)]},
            format="json",
        )

        assert answered.status_code == 201, answered.data
        claim = PropertyProviderApplication.objects.get(property_id=queried)
        # Back with the team, on the same claim — not a second one beside it, and
        # not a draft the reviewer would never see.
        assert claim.status == ProviderApplicationStatus.PENDING_REVIEW
        assert PropertyProviderApplication.objects.filter(property_id=queried).count() == 1

    def test_the_evidence_is_added_and_not_replaced(self, queried, api, upload):
        """The reviewer keeps what they queried, beside the answer to it."""
        from apps.property.models import PropertyProviderApplication
        from apps.trust.models import Verification

        claim = PropertyProviderApplication.objects.get(property_id=queried)
        before = Verification.objects.get(id=claim.authority_verification_id).evidence.count()

        api.post(
            f"/api/v1/properties/{queried}/claim/",
            {"relationship_type": "owner", "file_ids": [str(upload("property_document").id)]},
            format="json",
        )

        after = Verification.objects.get(id=claim.authority_verification_id).evidence.count()
        assert after == before + 1


class TestVerifiedIsProtected:
    @pytest.fixture
    def verified(self, created, api, provider):
        from apps.property.models import Property
        from apps.trust import condition
        from apps.trust import services as trust_services

        api.post(f"/api/v1/properties/{created}/verification/", {}, format="json")
        prop = Property.objects.get(id=created)

        # Both halves approved, the way a reviewer approves them.
        trust_services.decide(condition.current_review(prop), approved=True, note="")
        from apps.property.models import PropertyProviderApplication
        from apps.trust.models import Verification, VerificationStatus

        claim = PropertyProviderApplication.objects.get(property=prop)
        claim.status = ProviderApplicationStatus.APPROVED
        claim.reviewed_at = timezone.now()
        claim.save()
        Verification.objects.filter(id=claim.authority_verification_id).update(
            status=VerificationStatus.APPROVED, decided_at=timezone.now()
        )
        return created

    def test_what_our_team_checked_cannot_change(self, verified, api):
        for field, value in (
            ("water_source", "tap"),
            ("power_meter_type", "postpaid"),
            ("compound_type", "self"),
            ("property_type", "commercial"),
        ):
            refused = api.patch(f"/api/v1/properties/{verified}/", {field: value}, format="json")
            assert refused.status_code == 409, f"{field} should be fixed once verified"

    def test_the_name_and_the_notes_cannot_either(self, verified, api):
        """The half-door that used to be here.

        Labels were let through on the reasoning that a reviewer does not check
        what a property is called. They check the property, and what a tenant is
        shown includes its name — so a rename under a live approval makes the
        mark vouch for something nobody looked at. There is no property re-check
        workflow yet, so this refuses rather than offering a partial write.
        """
        for field, value in (("title", "Renamed"), ("notes", "Gate code changed.")):
            refused = api.patch(f"/api/v1/properties/{verified}/", {field: value}, format="json")
            assert refused.status_code == 409, field
            assert "support" in refused.data["error"]["message"].lower()

    def test_it_cannot_be_deleted(self, verified, provider):
        """Our team has seen it, so it is archived rather than destroyed.

        This was allowed before — `can_delete_property` never consulted the
        verification state, and the relationship it *did* consult only comes
        into existence when the claim is approved. So verification was the
        moment deletion became possible, which is precisely backwards.
        """
        from apps.property.models import Property

        actions = permitted_actions(
            "property", actor=provider, target=Property.objects.get(id=verified)
        )

        assert actions["delete"]["allowed"] is False
        assert actions["submit_for_verification"]["allowed"] is False

    def test_it_cannot_be_submitted_again(self, verified, api):
        refused = api.post(f"/api/v1/properties/{verified}/verification/", {}, format="json")

        assert refused.status_code == 409


class TestARegressionGuard:
    """The things around this that must keep working."""

    def test_spaces_can_be_added_before_the_property_is_verified(self, created, api):
        """Private inventory does not wait on a review.

        Creating a property leaves it unverified by design, and a provider must
        still be able to set up what is inside it — only advertising and
        inviting wait.
        """
        added = api.post(
            f"/api/v1/properties/{created}/units/",
            {"space_type": "apartment", "bedrooms": 2, "bathrooms": 1},
            format="json",
        )

        assert added.status_code == 201, added.data

    def test_a_stranger_can_do_none_of_it(self, created, api, registered, sign_in_as, upload):
        stranger = registered("0209696777")
        sign_in_as(api, user=stranger)

        for method, path, payload in (
            ("post", f"/api/v1/properties/{created}/claim/", {"relationship_type": "owner"}),
            ("post", f"/api/v1/properties/{created}/verification/", {}),
            ("post", f"/api/v1/properties/{created}/verification/withdraw/", {}),
            ("patch", f"/api/v1/properties/{created}/", {"title": "Mine now"}),
        ):
            response = getattr(api, method)(path, payload, format="json")
            assert response.status_code in (403, 404), f"{path} let a stranger through"

    def test_the_amenities_a_property_carries_survive_submission(
        self, created, api, shared_amenity
    ):
        amenity = shared_amenity
        api.put(
            f"/api/v1/properties/{created}/amenities/",
            {"amenity_ids": [str(amenity.id)]},
            format="json",
        )

        api.post(f"/api/v1/properties/{created}/verification/", {}, format="json")

        still = api.get(f"/api/v1/properties/{created}/amenities/")
        assert still.status_code == 200
        assert [row["id"] for row in still.data["chosen"]] == [str(amenity.id)]
