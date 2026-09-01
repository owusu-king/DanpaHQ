"""Getting a property ready: describe it, claim it, photograph it, send it.

The web flow walks these in order and the property page routes back into them,
but neither holds any state of its own — every step is a write to something the
domain already keeps. These pin the server side of that, which is what makes
"save for later" work at all: leaving is just not making the next request.

The load-bearing coupling is the first one. `water_source` and `compound_type`
are not description — `trust.evidence_policy` reads them to decide what the
property is asked to photograph — which is why the details step comes before the
photographs step, and why a property nobody has described gets a checklist that
is guessing.
"""

import pytest
from rest_framework.test import APIClient

from apps.core.exceptions import PermissionDenied
from apps.trust import condition, evidence_policy

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def draft(landlord, provider_standing, db):
    """A property the moment it is created: described by nobody, claimed by nobody.

    Built through the organization path, which is how the product actually
    creates one — so there is no `PropertyRelationship` and no authority
    verification, and `water_source` / `power_meter_type` are both `unknown`.
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
    from apps.property.models import Property, PropertyType

    provider_standing(landlord)
    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Ayawaso West"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="East Legon"
    )
    organization = Organization.objects.create(name="Setup Lettings", created_by=landlord)
    OrganizationMembership.objects.create(
        organization=organization,
        user=landlord,
        role=MembershipRole.OWNER,
        joined_at=timezone.now(),
    )
    prop = Property.objects.create(
        created_by=landlord,
        title="Setup Court",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street="5 Setup Road"),
    )
    OrganizationPropertyRelationship.objects.create(
        organization=organization,
        property=prop,
        relationship_type=OrganizationPropertyRole.OWNER,
        granted_by=landlord,
    )
    return prop


def _photo(user):
    import uuid

    from apps.files.models import ScanStatus, StoredFile, UploadStatus

    return StoredFile.objects.create(
        uploaded_by=user,
        owner_id_snapshot=str(user.id),
        purpose="property_photo",
        original_filename="front.jpg",
        declared_content_type="image/jpeg",
        content_type="image/jpeg",
        size_bytes=90_000,
        storage_key=f"photos/{user.id}/{uuid.uuid4().hex}.jpg",
        upload_status=UploadStatus.READY,
        scan_status=ScanStatus.CLEAN,
    )


class TestTheVocabularyTheFormNeeds:
    """Served, not hardcoded — the same reason the space-type matrix is.

    A form offering a water source the backend does not have would build a
    checklist nobody could finish, because the evidence policy keys on the
    stored value.
    """

    def test_the_property_vocabulary_is_public(self, api):
        response = api.get("/api/v1/property-types/")

        assert response.status_code == 200
        assert {"water_sources", "power_meter_types", "compound_types"} <= set(response.data)

    def test_every_value_the_policy_reads_is_offered(self, api):
        """The two that decide extra photographs must both be reachable."""
        data = api.get("/api/v1/property-types/").data
        water = {row["value"] for row in data["water_sources"]}
        compound = {row["value"] for row in data["compound_types"]}

        # `evidence_policy.property_requirements` adds a slot for each of these.
        assert {"borehole", "sachet", "none"} <= water
        assert {"family_compound", "estate", "mixed_use"} <= compound

    def test_each_option_carries_a_label(self, api):
        data = api.get("/api/v1/property-types/").data

        for key in ("water_sources", "power_meter_types", "compound_types"):
            assert data[key], key
            assert all(row["label"] for row in data[key]), key


class TestDescribingTheProperty:
    def test_a_new_property_has_answered_neither(self, draft):
        """`unknown` is the state the whole details step exists to leave."""
        assert draft.water_source == "unknown"
        assert draft.power_meter_type == "unknown"

    def test_the_details_save_and_survive(self, draft, landlord, api, sign_in_as):
        sign_in_as(api, user=landlord)

        saved = api.patch(
            f"/api/v1/properties/{draft.id}/",
            {
                "water_source": "borehole",
                "power_meter_type": "prepaid",
                "compound_type": "family_compound",
                "has_security": True,
                "is_gated": True,
            },
            format="json",
        )
        assert saved.status_code == 200

        # Read back on a fresh request — which is all "come back later" is.
        again = api.get(f"/api/v1/properties/{draft.id}/").data
        assert again["water_source"] == "borehole"
        assert again["power_meter_type"] == "prepaid"
        assert again["compound_type"] == "family_compound"
        assert again["has_security"] is True

    def test_describing_it_changes_what_it_must_photograph(self, draft, landlord):
        """Why details comes before photos, and not the other way round."""
        from apps.property.models import Property

        before = {slot.key for slot in evidence_policy.property_requirements(draft)}
        assert before == {"property.front", "property.side", "property.surroundings"}

        Property.objects.filter(id=draft.id).update(
            water_source="borehole", power_meter_type="prepaid", compound_type="family_compound"
        )
        draft.refresh_from_db()

        after = {slot.key for slot in evidence_policy.property_requirements(draft)}

        assert "property.water" in after, "a borehole is a thing a tenant should see"
        assert "property.compound" in after, "shared grounds are part of the deal"
        assert "property.power" in after
        # And the answer the checklist screen reads moves with it.
        state = condition.progress(subject=draft, user=landlord)
        assert state["required_total"] == 5

    def test_a_stranger_cannot_describe_somebody_elses_property(
        self, draft, registered, api, sign_in_as
    ):
        """The details step changed no permission."""
        from apps.property import services

        stranger = registered("0209695001")

        with pytest.raises(PermissionDenied):
            services.update_property(prop=draft, user=stranger, data={"water_source": "borehole"})

        sign_in_as(api, user=stranger)
        assert api.patch(
            f"/api/v1/properties/{draft.id}/",
            {"water_source": "borehole"},
            format="json",
        ).status_code in (403, 404)

    def test_the_change_is_recorded(self, draft, landlord):
        """Audit was already there and stays there."""
        from apps.audit.models import AuditLog
        from apps.property import services

        services.update_property(prop=draft, user=landlord, data={"water_source": "borehole"})

        entry = (
            AuditLog.objects.filter(aggregate_type="property", aggregate_id=str(draft.id))
            .order_by("-created_at")
            .first()
        )

        assert entry is not None
        assert "water_source" in entry.changes


class TestLeavingAndComingBack:
    """Nothing is held in the browser, so nothing is lost by closing it."""

    def test_a_half_finished_property_reads_back_the_same(self, draft, landlord, api, sign_in_as):
        sign_in_as(api, user=landlord)
        api.patch(
            f"/api/v1/properties/{draft.id}/",
            {"water_source": "borehole", "power_meter_type": "prepaid"},
            format="json",
        )
        condition.attach(
            subject=draft, actor=landlord, slot_key="property.front", file=_photo(landlord)
        )

        # A completely fresh client — a different day, a different device.
        returning = APIClient()
        sign_in_as(returning, user=landlord)

        prop = returning.get(f"/api/v1/properties/{draft.id}/").data
        photos = returning.get(f"/api/v1/properties/{draft.id}/verification/").data

        assert prop["water_source"] == "borehole"
        assert photos["required_outstanding"] == 3
        assert [slot["key"] for slot in photos["slots"] if slot["provided"]] == ["property.front"]

    def test_photographs_accumulate_across_visits(self, draft, landlord):
        """The reason the checklist is a checklist: it takes several sittings."""
        for key in ("property.front", "property.side"):
            condition.attach(subject=draft, actor=landlord, slot_key=key, file=_photo(landlord))
            state = condition.progress(subject=draft, user=landlord)
            assert state["submitted"] is False, "nothing goes to a reviewer early"

        assert condition.progress(subject=draft, user=landlord)["required_outstanding"] == 1

    def test_amenities_persist_without_being_part_of_the_review(self, draft, landlord):
        from django.core.management import call_command

        from apps.property import spaces
        from apps.property.models import Amenity

        call_command("seed_amenities", verbosity=0)
        guard = Amenity.objects.get(name="Security guard")

        spaces.set_property_amenities(prop=draft, user=landlord, amenity_ids=[guard.id])

        rows = draft.property_amenities.filter(removed_at__isnull=True)
        assert [row.amenity.name for row in rows] == ["Security guard"]
        # And they are not evidence: the checklist is unchanged by them.
        assert condition.progress(subject=draft, user=landlord)["required_total"] == 3


def _verify_identity(user):
    """What an account needs before a reviewer is asked to spend time on it."""
    from django.utils import timezone

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
            subject_id=str(user.id),
            kind=kind,
            status=VerificationStatus.APPROVED,
            defaults={
                "method": VerificationMethod.DOCUMENT_REVIEW,
                "submitted_by": user,
                "decided_at": timezone.now(),
            },
        )


class TestSendingItForReview:
    def test_it_cannot_be_sent_until_every_required_view_is_there(self, draft, landlord):
        from apps.core.exceptions import ValidationFailed

        condition.attach(
            subject=draft, actor=landlord, slot_key="property.front", file=_photo(landlord)
        )

        with pytest.raises(ValidationFailed) as raised:
            condition.submit_for_review(subject=draft, actor=landlord)

        # Names what is missing rather than reporting incompleteness.
        assert "side" in str(raised.value).lower()

    def test_the_whole_journey(self, draft, landlord, api, sign_in_as):
        """Describe → document → photograph → **create**, then send. Over HTTP.

        The two halves of the journey are deliberately separate requests. Every
        step up to and including the photographs is creating the property, and
        none of them asks anybody to look at anything; the send is one further
        decision the provider makes afterwards.
        """
        from apps.property.verification import PropertyVerificationState, lifecycle

        _verify_identity(landlord)
        sign_in_as(api, user=landlord)

        described = api.patch(
            f"/api/v1/properties/{draft.id}/",
            {"water_source": "estate", "power_meter_type": "postpaid"},
            format="json",
        )
        assert described.status_code == 200

        # The document. Recorded against the property, and read by nobody yet.
        recorded = api.post(
            f"/api/v1/properties/{draft.id}/claim/",
            {"relationship_type": "owner", "file_ids": [str(_photo(landlord).id)]},
            format="json",
        )
        assert recorded.status_code == 201, recorded.data
        assert lifecycle(draft)["state"] == PropertyVerificationState.DRAFT

        state = api.get(f"/api/v1/properties/{draft.id}/verification/").data
        for slot in state["slots"]:
            if not slot["required"]:
                continue
            added = api.post(
                f"/api/v1/properties/{draft.id}/verification/evidence/",
                {"slot_key": slot["key"], "file_id": str(_photo(landlord).id)},
                format="json",
            )
            assert added.status_code == 201, added.data

        assert added.data["can_submit"] is True

        # Everything the property needs is here and nothing has been sent. This
        # is the state the wizard's last step leaves behind — created, waiting
        # on a decision the provider has not made yet.
        assert lifecycle(draft)["state"] == PropertyVerificationState.READY

        sent = api.post(f"/api/v1/properties/{draft.id}/verification/", {}, format="json")

        assert sent.status_code == 200
        assert sent.data["submitted"] is True
        assert lifecycle(draft)["state"] == PropertyVerificationState.SUBMITTED

    def test_sending_does_not_wait_on_the_spaces_inside_it(self, draft, landlord):
        """Draft work is never blocked by a review in progress, in both directions."""
        from apps.property import services

        for key in ("property.front", "property.side", "property.surroundings"):
            condition.attach(subject=draft, actor=landlord, slot_key=key, file=_photo(landlord))
        condition.submit_for_review(subject=draft, actor=landlord)

        # A space can still be added while the property is with the team.
        unit = services.add_unit(
            prop=draft,
            user=landlord,
            data={"space_type": "apartment", "bedrooms": 1, "bathrooms": 1},
        )

        assert unit.property_id == draft.id

    def test_a_stranger_cannot_send_somebody_elses_property(self, draft, registered):
        stranger = registered("0209695002")

        with pytest.raises(PermissionDenied):
            condition.submit_for_review(subject=draft, actor=stranger)
