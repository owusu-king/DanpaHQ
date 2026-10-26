"""Every state a property can be in, and what it may do there.

The reported fault: the property page offered "Continue with property details"
whatever state the property was in — to a provider whose property was sitting
with a reviewer, to one whose claim had been rejected, and to one approved weeks
earlier.

It was not the page ignoring the state. `authority_state` runs through
`Verification.display_state`, which has four values, so `REJECTED` and `REVOKED`
both arrive as `unverified` — indistinguishable from never having started. The
page could not have been state-aware on the field it was given.

So these pin two things:

1. **Every real state maps to one combined state** with the right actions, and
2. **the actions are enforced, not merely hidden** — the same refusal reaches a
   direct API call, because a control that is only missing from a page is not a
   rule.
"""

import pytest
from rest_framework.test import APIClient

from apps.core.policy import permitted_actions
from apps.property.verification import PropertyVerificationState, lifecycle
from apps.trust import condition

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def factory(landlord, db):
    """Builds a property in whatever state a test needs.

    Every state is reached the way the product reaches it — a claim row, a
    verification, a queue entry — rather than by writing a status field, so a
    test cannot describe a state the system cannot produce.
    """
    import uuid

    from django.utils import timezone

    from apps.files.models import ScanStatus, StoredFile, UploadStatus
    from apps.geo.models import Address, District, Locality, Region
    from apps.organization.models import (
        MembershipRole,
        Organization,
        OrganizationMembership,
        OrganizationPropertyRelationship,
        OrganizationPropertyRole,
    )
    from apps.property.models import (
        Property,
        PropertyProviderApplication,
        PropertyType,
        ProviderApplicationStatus,
    )
    from apps.trust.models import (
        ReviewQueueEntry,
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

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Ayawaso West"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="East Legon"
    )
    organization = Organization.objects.create(name="Lifecycle Lettings", created_by=landlord)
    OrganizationMembership.objects.create(
        organization=organization,
        user=landlord,
        role=MembershipRole.OWNER,
        joined_at=timezone.now(),
    )

    def photo():
        return StoredFile.objects.create(
            uploaded_by=landlord,
            owner_id_snapshot=str(landlord.id),
            purpose="property_photo",
            original_filename="p.jpg",
            declared_content_type="image/jpeg",
            content_type="image/jpeg",
            size_bytes=90_000,
            storage_key=f"photos/{landlord.id}/{uuid.uuid4().hex}.jpg",
            upload_status=UploadStatus.READY,
            scan_status=ScanStatus.CLEAN,
        )

    def document():
        return StoredFile.objects.create(
            uploaded_by=landlord,
            owner_id_snapshot=str(landlord.id),
            purpose="property_document",
            original_filename="indenture.pdf",
            declared_content_type="application/pdf",
            content_type="application/pdf",
            size_bytes=120_000,
            storage_key=f"documents/{landlord.id}/{uuid.uuid4().hex}.pdf",
            upload_status=UploadStatus.READY,
            scan_status=ScanStatus.CLEAN,
        )

    def approve_authority(prop):
        return Verification.objects.create(
            subject_type=SubjectType.PROPERTY,
            subject_id=str(prop.id),
            kind=VerificationKind.PROPERTY_AUTHORITY,
            status=VerificationStatus.APPROVED,
            method=VerificationMethod.DOCUMENT_REVIEW,
            decided_at=timezone.now(),
        )

    def build(state):
        prop = Property.objects.create(
            created_by=landlord,
            title=f"Lifecycle {state}",
            property_type=PropertyType.RESIDENTIAL,
            address=Address.objects.create(locality=locality, street="1 Lifecycle Road"),
        )
        OrganizationPropertyRelationship.objects.create(
            organization=organization,
            property=prop,
            relationship_type=OrganizationPropertyRole.OWNER,
            granted_by=landlord,
        )
        if state == PropertyVerificationState.DRAFT:
            return prop

        for slot in condition.slots_for(prop):
            if slot.required:
                condition.attach(subject=prop, actor=landlord, slot_key=slot.key, file=photo())

        # The document, recorded and unsent — the state creation leaves behind.
        # Without it the property is still being created, so every state past
        # draft has to have one or it could not be reached.
        from apps.property.services import record_property_claim

        record_property_claim(
            user=landlord,
            prop=prop,
            data={"relationship_type": "owner"},
            files=[document()],
        )

        if state in {
            PropertyVerificationState.CHANGES_REQUESTED,
            PropertyVerificationState.REJECTED,
        }:
            # The property's one claim, decided. `property` is a OneToOneField,
            # so this is the row `record_property_claim` made, moved on by a
            # reviewer — not a second one.
            claim = PropertyProviderApplication.objects.get(property=prop)
            claim.status = (
                ProviderApplicationStatus.NEEDS_MORE
                if state == PropertyVerificationState.CHANGES_REQUESTED
                else ProviderApplicationStatus.REJECTED
            )
            claim.submitted_at = timezone.now()
            claim.reviewed_at = timezone.now()
            claim.decision_note = "The document does not name you."
            claim.save()
            return prop

        verification = approve_authority(prop)

        if state == PropertyVerificationState.SUSPENDED:
            verification.status = VerificationStatus.REVOKED
            verification.decision_note = "Ownership disputed by a third party."
            verification.save(update_fields=["status", "decision_note"])
            return prop

        if state == PropertyVerificationState.READY:
            return prop

        review = condition.submit_for_review(subject=prop, actor=landlord)

        if state == PropertyVerificationState.UNDER_REVIEW:
            entry = ReviewQueueEntry.objects.get(verification=review)
            entry.claimed_by = landlord
            entry.claimed_at = timezone.now()
            entry.save(update_fields=["claimed_by", "claimed_at"])
        elif state == PropertyVerificationState.VERIFIED:
            from apps.trust import services as trust_services

            trust_services.decide(review, approved=True, note="")

        return prop

    build.photo = photo
    build.document = document
    return build


ALL_STATES = [
    PropertyVerificationState.DRAFT,
    PropertyVerificationState.READY,
    PropertyVerificationState.SUBMITTED,
    PropertyVerificationState.UNDER_REVIEW,
    PropertyVerificationState.VERIFIED,
    PropertyVerificationState.CHANGES_REQUESTED,
    PropertyVerificationState.REJECTED,
    PropertyVerificationState.SUSPENDED,
]


class TestEveryStateIsReachableAndNamed:
    @pytest.mark.parametrize("state", ALL_STATES)
    def test_the_property_reports_the_state_it_is_in(self, factory, state):
        prop = factory(state)

        assert lifecycle(prop)["state"] == state

    @pytest.mark.parametrize("state", ALL_STATES)
    def test_every_state_has_words_for_a_person(self, factory, state):
        result = lifecycle(factory(state))

        assert result["state_label"]
        # And which half is which, because "changes requested" without saying
        # whether it is the document or the photographs says almost nothing.
        assert result["authority"]["state_label"]
        assert result["photos"]["state_label"]


class TestTheActionsEachStateOffers:
    """The table the page renders from."""

    @pytest.mark.parametrize(
        "state,edit,submit,withdraw",
        [
            # Setting up: everything open, nothing to send or take back yet.
            (PropertyVerificationState.DRAFT, True, False, False),
            (PropertyVerificationState.READY, True, True, False),
            # With a reviewer: no continue, no submit — only take it back.
            (PropertyVerificationState.SUBMITTED, False, False, True),
            (PropertyVerificationState.UNDER_REVIEW, False, False, True),
            # Verified: past the creation flow entirely, and fixed. A check is a
            # statement about a described thing, so the description is part of
            # what was checked — including the name.
            (PropertyVerificationState.VERIFIED, False, False, False),
            # Back with the provider, with something to fix. `changes_requested`
            # keeps its claim open, so it can go straight back; `rejected` is a
            # verdict on the document, and sending the same one again would only
            # be refused again — so it waits for a replacement.
            (PropertyVerificationState.CHANGES_REQUESTED, True, True, False),
            (PropertyVerificationState.REJECTED, True, False, False),
            # Restricted: remediation only, and sending again is not it.
            (PropertyVerificationState.SUSPENDED, True, False, False),
        ],
    )
    def test_the_state_decides_what_is_offered(
        self, factory, landlord, state, edit, submit, withdraw
    ):
        prop = factory(state)

        actions = permitted_actions("property", actor=landlord, target=prop)

        assert actions["edit"]["allowed"] is edit, f"edit in {state}"
        assert actions["submit_for_verification"]["allowed"] is submit, f"submit in {state}"
        assert actions["withdraw_submission"]["allowed"] is withdraw, f"withdraw in {state}"

    def test_a_refused_action_always_says_why(self, factory, landlord):
        """A control that vanishes with no reason is the fault this replaces."""
        for state in ALL_STATES:
            prop = factory(state)
            actions = permitted_actions("property", actor=landlord, target=prop)
            for name, decision in actions.items():
                if decision["allowed"]:
                    continue
                assert (
                    decision["message"] or decision["blockers"]
                ), f"{name} in {state} refused with nothing to act on"

    def test_a_draft_names_everything_that_is_missing(self, factory, landlord):
        """Both halves, counted. "Not ready" names none of them."""
        prop = factory(PropertyVerificationState.DRAFT)

        submit = permitted_actions("property", actor=landlord, target=prop)[
            "submit_for_verification"
        ]

        assert submit["allowed"] is False
        kinds = {blocker["kind"] for blocker in submit["blockers"]}
        assert kinds == {"document_missing", "evidence_missing"}
        photographs = next(
            blocker for blocker in submit["blockers"] if blocker["kind"] == "evidence_missing"
        )
        assert "of 2 photographs" in photographs["message"]

    def test_a_rejected_claim_waits_for_a_replacement_document(self, factory, landlord):
        from apps.property.services import record_property_claim

        prop = factory(PropertyVerificationState.REJECTED)

        blocked = permitted_actions("property", actor=landlord, target=prop)[
            "submit_for_verification"
        ]
        assert blocked["allowed"] is False
        assert "document" in " ".join(b["message"] for b in blocked["blockers"]).lower()

        # Replace it, and the way back opens.
        record_property_claim(
            user=landlord,
            prop=prop,
            data={"relationship_type": "owner"},
            files=[factory.document()],
        )

        assert (
            permitted_actions("property", actor=landlord, target=prop)["submit_for_verification"][
                "allowed"
            ]
            is True
        )


class TestHidingIsNotEnforcing:
    """The same refusal has to reach a direct API call.

    Every one of these is the request a page would have made if its button had
    been shown in the wrong state — which is exactly what was happening.
    """

    def test_a_property_with_a_reviewer_cannot_be_edited(self, factory, landlord, api, sign_in_as):
        prop = factory(PropertyVerificationState.SUBMITTED)
        sign_in_as(api, user=landlord)

        response = api.patch(
            f"/api/v1/properties/{prop.id}/",
            {"water_source": "borehole_pump"},
            format="json",
        )

        assert response.status_code == 409
        assert "review" in response.data["error"]["message"].lower()

    def test_a_property_with_a_reviewer_cannot_be_submitted_again(
        self, factory, landlord, api, sign_in_as
    ):
        prop = factory(PropertyVerificationState.SUBMITTED)
        sign_in_as(api, user=landlord)

        response = api.post(f"/api/v1/properties/{prop.id}/verification/", {}, format="json")

        assert response.status_code == 409
        assert response.data["error"]["message"]

    def test_a_verified_property_cannot_be_edited_at_all(self, factory, landlord, api, sign_in_as):
        """Not the water source, and not the name either.

        The water source is obvious — `trust.evidence_policy` reads it to decide
        which photographs were required, so changing it after approval moves the
        checklist under a decision already made.

        The name is the one worth stating. It was briefly editable, on the
        reasoning that a reviewer does not check what a property is called. But a
        verification is a statement about a described thing, and the description
        a tenant is shown includes the name — so letting it change under a live
        approval means the mark vouches for a property nobody looked at.
        """
        prop = factory(PropertyVerificationState.VERIFIED)
        sign_in_as(api, user=landlord)
        was = prop.title

        for field, value in (
            ("water_source", "borehole_pump"),
            ("power_meter_type", "postpaid"),
            ("compound_type", "walled_gated"),
            ("title", "Renamed after approval"),
            ("notes", "Gate code changed."),
        ):
            refused = api.patch(f"/api/v1/properties/{prop.id}/", {field: value}, format="json")
            assert refused.status_code == 409, f"{field} should be fixed once verified"
            assert "verified" in refused.data["error"]["message"].lower()

        prop.refresh_from_db()
        assert prop.title == was

    def test_a_verified_property_cannot_be_submitted_again(
        self, factory, landlord, api, sign_in_as
    ):
        prop = factory(PropertyVerificationState.VERIFIED)
        sign_in_as(api, user=landlord)

        response = api.post(f"/api/v1/properties/{prop.id}/verification/", {}, format="json")

        assert response.status_code == 409

    def test_a_suspended_property_cannot_be_sent_again(self, factory, landlord):
        """Remediation only — resubmitting is not the next step."""
        from apps.core.exceptions import Conflict
        from apps.core.policy import enforce
        from apps.property.policies import can_submit_property

        prop = factory(PropertyVerificationState.SUSPENDED)

        with pytest.raises(Conflict) as raised:
            enforce(can_submit_property(actor=landlord, target=prop), confirmed=True)

        assert "support" in str(raised.value).lower()

    def test_nothing_can_be_withdrawn_that_is_not_with_the_team(
        self, factory, landlord, api, sign_in_as
    ):
        sign_in_as(api, user=landlord)

        for state in (
            PropertyVerificationState.DRAFT,
            PropertyVerificationState.READY,
            PropertyVerificationState.VERIFIED,
        ):
            prop = factory(state)
            response = api.post(
                f"/api/v1/properties/{prop.id}/verification/withdraw/", {}, format="json"
            )
            assert response.status_code == 409, state

    def test_a_stranger_cannot_act_on_any_of_it(
        self, factory, landlord, registered, api, sign_in_as
    ):
        prop = factory(PropertyVerificationState.SUBMITTED)
        stranger = registered("0209696001")
        sign_in_as(api, user=stranger)

        for path in (
            f"/api/v1/properties/{prop.id}/verification/withdraw/",
            f"/api/v1/properties/{prop.id}/verification/",
        ):
            assert api.post(path, {}, format="json").status_code in (403, 404), path

        actions = permitted_actions("property", actor=stranger, target=prop)
        assert actions["edit"]["code"] == "not_authorized"


class TestTheWithdrawalLoop:
    """PENDING → WITHDRAW → READY → EDIT → RESUBMIT."""

    def test_the_whole_loop(self, factory, landlord, api, sign_in_as):
        prop = factory(PropertyVerificationState.SUBMITTED)
        sign_in_as(api, user=landlord)
        assert lifecycle(prop)["state"] == PropertyVerificationState.SUBMITTED

        taken_back = api.post(
            f"/api/v1/properties/{prop.id}/verification/withdraw/",
            {"reason": "Wrong photographs"},
            format="json",
        )
        assert taken_back.status_code == 200
        assert taken_back.data["verification"]["state"] == PropertyVerificationState.READY

        # Editable again, which is the point of taking it back.
        edited = api.patch(
            f"/api/v1/properties/{prop.id}/",
            {"water_source": "borehole_pump"},
            format="json",
        )
        assert edited.status_code == 200

        # Changing the water source added a required view, so it is no longer
        # complete — the checklist moved with the answer, as it should.
        state = api.get(f"/api/v1/properties/{prop.id}/verification/").data
        for slot in state["slots"]:
            if slot["required"] and not slot["provided"]:
                api.post(
                    f"/api/v1/properties/{prop.id}/verification/evidence/",
                    {"slot_key": slot["key"], "file_id": str(factory.photo().id)},
                    format="json",
                )

        resent = api.post(f"/api/v1/properties/{prop.id}/verification/", {}, format="json")
        assert resent.status_code == 200
        assert resent.data["submitted"] is True

    def test_the_previous_submission_stays_in_the_audit_record(
        self, factory, landlord, api, sign_in_as
    ):
        """ADR 0021: anything a counterparty has seen is preserved."""
        from apps.audit.models import AuditLog

        prop = factory(PropertyVerificationState.SUBMITTED)
        sign_in_as(api, user=landlord)

        api.post(
            f"/api/v1/properties/{prop.id}/verification/withdraw/",
            {"reason": "Wrong photographs"},
            format="json",
        )

        entry = AuditLog.objects.filter(aggregate_id=str(prop.id)).order_by("-created_at").first()
        assert entry is not None
        assert entry.metadata.get("action") == "withdraw"
        assert entry.metadata.get("reason") == "Wrong photographs"
        assert entry.changes["status"]["from"] == "submitted"

    def test_a_withdrawn_claim_keeps_its_document_and_can_go_again(self, factory, landlord):
        """Withdrawal must be a way out, not a trap — and it was a trap.

        `PropertyProviderApplication.property` is a `OneToOneField`. Marking a
        withdrawn claim `WITHDRAWN` left it occupying the property's one slot,
        so the corrected claim it existed to enable could never be inserted:
        `IntegrityError`, at the database, every time. The test that covered
        this only queried the open-claims set and never tried.

        Withdrawal now has its own provider-facing state, while the same row and
        evidence are reused. Reuse, not pretending it was never submitted, is
        what avoids the old uniqueness trap.
        """
        from apps.property.models import (
            PropertyProviderApplication,
            ProviderApplicationStatus,
        )
        from apps.property.services import withdraw_provider_application

        prop = factory(PropertyVerificationState.CHANGES_REQUESTED)
        application = PropertyProviderApplication.objects.get(property=prop)
        withdraw_provider_application(
            application=application, user=landlord, reason="Wrong document"
        )
        application.refresh_from_db()

        assert application.status == ProviderApplicationStatus.WITHDRAWN
        assert application.submitted_at is None
        # Still one row, still the same one — and still holding its evidence, so
        # sending again is a button rather than the whole step over.
        assert PropertyProviderApplication.objects.filter(property=prop).count() == 1
        assert lifecycle(prop)["authority"]["state"] == PropertyVerificationState.READY

        assert (
            permitted_actions("property", actor=landlord, target=prop)["submit_for_verification"][
                "allowed"
            ]
            is True
        )


class TestTheSameRulesOneLevelDown:
    """A space is the same shape of thing, so it gets the same treatment."""

    def test_a_space_with_a_reviewer_offers_withdrawal_and_not_submission(self, factory, landlord):
        from apps.property import services

        prop = factory(PropertyVerificationState.VERIFIED)
        unit = services.add_unit(
            prop=prop,
            user=landlord,
            data={"space_type": "apartment", "bedrooms": 1, "bathrooms": 1},
        )
        condition.attach(
            subject=unit,
            actor=landlord,
            slot_key="space.overview",
            file=factory.photo(),
        )
        condition.submit_for_review(subject=unit, actor=landlord)

        actions = permitted_actions("space", actor=landlord, target=unit)

        assert actions["submit_for_verification"]["allowed"] is False
        assert actions["withdraw_submission"]["allowed"] is True
        assert actions["edit"]["allowed"] is False

    def test_withdrawing_a_space_puts_it_back_where_it_was(
        self, factory, landlord, api, sign_in_as
    ):
        from apps.property import services

        prop = factory(PropertyVerificationState.VERIFIED)
        unit = services.add_unit(
            prop=prop,
            user=landlord,
            data={"space_type": "apartment", "bedrooms": 1, "bathrooms": 1},
        )
        condition.attach(
            subject=unit,
            actor=landlord,
            slot_key="space.overview",
            file=factory.photo(),
        )
        condition.submit_for_review(subject=unit, actor=landlord)
        sign_in_as(api, user=landlord)

        response = api.post(f"/api/v1/units/{unit.id}/verification/withdraw/", {}, format="json")

        assert response.status_code == 200
        assert condition.lifecycle_state(unit) == "ready_for_submission"
        # And it can go straight back.
        assert (
            api.post(f"/api/v1/units/{unit.id}/verification/", {}, format="json").status_code == 200
        )

    def test_a_space_not_with_the_team_cannot_be_withdrawn(
        self, factory, landlord, api, sign_in_as
    ):
        from apps.property import services

        prop = factory(PropertyVerificationState.VERIFIED)
        unit = services.add_unit(
            prop=prop,
            user=landlord,
            data={"space_type": "apartment", "bedrooms": 1, "bathrooms": 1},
        )
        sign_in_as(api, user=landlord)

        response = api.post(f"/api/v1/units/{unit.id}/verification/withdraw/", {}, format="json")

        assert response.status_code == 409
