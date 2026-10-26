"""Provider standing: may this account operate as a provider at all.

The question this domain answers is about the person, not any building. It used
to be answered implicitly — by holding a role name, or by having been approved
for one property — and both answers were wrong in ways that let an account reach
tenants it had never been checked against.
"""

import pytest
from rest_framework.test import APIClient

from apps.core.exceptions import PermissionDenied

pytestmark = pytest.mark.django_db

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 4096


@pytest.fixture(autouse=True)
def storage(settings, monkeypatch):
    from django.db import transaction

    from apps.files.storage import get_storage, reset_storage

    settings.STORAGE_BACKEND = "memory"
    settings.FILE_SCAN_MODE = "permissive"
    reset_storage()
    monkeypatch.setattr(transaction, "on_commit", lambda func, using=None: func())
    yield get_storage()
    reset_storage()


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region = Region.objects.create(name="Greater Accra", code="STND-GA")
    district = District.objects.create(region=region, name="Ayawaso East")
    locality = Locality.objects.create(district=district, name="Nima")
    return Address.objects.create(
        locality=locality, digital_address="GA-222-4444", street="Kanda Highway"
    )


def approve_identity(user):
    from django.utils import timezone

    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    return Verification.objects.create(
        subject_type=SubjectType.USER,
        subject_id=str(user.id),
        kind=VerificationKind.IDENTITY,
        method=VerificationMethod.DOCUMENT_REVIEW,
        status=VerificationStatus.APPROVED,
        submitted_by=user,
        decided_at=timezone.now(),
    )


def ready_document(user, storage, name="id-card.jpg"):
    from apps.files import services

    stored, _ = services.reserve_upload(
        user=user,
        purpose="identity_document",
        filename=name,
        content_type="image/jpeg",
        size_bytes=len(JPEG),
    )
    storage.write(key=stored.storage_key, data=JPEG)
    completed = services.complete_upload(user=user, file_id=stored.id)
    completed.refresh_from_db()
    return completed


def submit_provider_documents(user, storage):
    """Take a provider through onboarding: identity on file, evidence sent."""
    from apps.identity import services

    return services.start_provider_verification(
        user=user,
        documents=[{"file": ready_document(user, storage), "evidence_type": "ghana_card_front"}],
    )


class TestAskingForProviderStanding:
    def test_one_document_is_enough_to_start(self, registered, storage):
        """No identity check is demanded first.

        Requiring one produced a dead end: the provider screen asked for a Ghana
        Card, the service refused until identity was verified, and the screen
        offered no way to verify identity. Identity is an input to this decision,
        answered by the same document, not a gate in front of it.
        """
        from apps.identity import services

        applicant = registered("0206660001", account_type="provider")
        document = ready_document(applicant, storage)

        verification = services.start_provider_verification(
            user=applicant,
            documents=[{"file": document, "evidence_type": "ghana_card_front"}],
        )

        assert verification.status == "pending"
        assert verification.evidence.count() == 1

    def test_submitting_queues_a_review_and_reports_pending(self, registered, storage):
        from apps.identity import services
        from apps.trust.models import ReviewQueueEntry

        applicant = registered("0206660002", account_type="provider")
        document = ready_document(applicant, storage)

        verification = services.start_provider_verification(
            user=applicant,
            documents=[{"file": document, "evidence_type": "ghana_card_front"}],
        )

        capabilities = services.account_capabilities(applicant)
        assert capabilities["provider"]["verification_status"] == "pending"
        # Onboarding is done — nothing further is asked of them — but the
        # workspace itself waits for the decision.
        assert capabilities["provider"]["onboarding_complete"] is True
        assert capabilities["provider"]["workspace_access"] is False
        assert capabilities["provider"]["can_create_property"] is False
        assert verification.evidence.count() == 1
        assert ReviewQueueEntry.objects.filter(verification=verification).exists()

    def test_a_document_someone_else_uploaded_is_refused(self, registered, storage):
        from apps.identity import services

        applicant = registered("0206660003", account_type="provider")
        stranger = registered("0206660004")
        document = ready_document(stranger, storage)

        with pytest.raises(PermissionDenied, match="uploaded by you"):
            services.start_provider_verification(
                user=applicant,
                documents=[{"file": document, "evidence_type": "ghana_card_front"}],
            )


class TestDecidingProviderStanding:
    def _pending(self, applicant, storage):
        from apps.identity import services

        return services.start_provider_verification(
            user=applicant,
            documents=[
                {"file": ready_document(applicant, storage), "evidence_type": "ghana_card_front"}
            ],
        )

    def test_approval_opens_the_workspace_and_grants_the_role(self, registered, storage, staff):
        from apps.identity import services
        from apps.trust import services as trust_services

        applicant = registered("0206660005", account_type="provider")
        verification = self._pending(applicant, storage)

        trust_services.decide(verification, approved=True, decided_by=staff)
        applicant.refresh_from_db()

        capabilities = services.account_capabilities(applicant)
        assert capabilities["provider"]["verification_status"] == "approved"
        assert capabilities["provider"]["workspace_access"] is True
        # The role follows the decision. It is a navigation hint kept in step
        # with the verification, never the thing that granted access.
        assert applicant.has_role("landlord")

        # Approving a provider means a reviewer looked at their government ID,
        # so identity is answered too — and written down, with its own copy of
        # the evidence, because the rest of the product reads records.
        from apps.trust.models import SubjectType, VerificationKind
        from apps.trust.services import current_for

        identity = current_for(SubjectType.USER, applicant.id, VerificationKind.IDENTITY)
        assert identity is not None
        assert identity.evidence.count() == 1
        assert identity.decided_by == staff

    def test_rejection_leaves_the_account_intact_but_shut_out(self, registered, storage, staff):
        from apps.identity import services
        from apps.trust import services as trust_services

        applicant = registered("0206660006", account_type="provider")
        verification = self._pending(applicant, storage)

        trust_services.decide(
            verification,
            approved=False,
            decided_by=staff,
            note="The document did not match the name on the account.",
        )
        applicant.refresh_from_db()

        capabilities = services.account_capabilities(applicant)
        assert capabilities["provider"]["verification_status"] == "rejected"
        assert capabilities["provider"]["workspace_access"] is False
        assert not applicant.has_role("landlord")
        # The account itself survives a rejected provider check.
        assert applicant.is_active
        assert applicant.is_registration_complete

    def test_revocation_removes_the_role_the_approval_granted(self, registered, storage, staff):
        from apps.identity import services
        from apps.trust import services as trust_services

        applicant = registered("0206660007", account_type="provider")
        verification = self._pending(applicant, storage)
        trust_services.decide(verification, approved=True, decided_by=staff)
        verification.refresh_from_db()

        trust_services.revoke(
            verification=verification, reason="The licence behind this was withdrawn."
        )
        applicant.refresh_from_db()

        capabilities = services.account_capabilities(applicant)
        assert capabilities["provider"]["workspace_access"] is False
        assert not applicant.has_role("landlord")


class TestStandingGatesPropertyActions:
    """The point of doing this in the backend rather than the navigation."""

    def test_losing_standing_closes_tenant_actions_on_an_existing_property(
        self, registered, storage, staff, address
    ):
        from apps.organization import services as organization_services
        from apps.property import services as property_services
        from apps.property.capabilities import property_capabilities
        from apps.trust import services as trust_services

        manager = registered("0206660008", account_type="provider")
        approve_identity(manager)
        verification = trust_services.start_verification(
            subject_type="user",
            subject_id=manager.id,
            kind="provider",
            method="document_review",
            submitted_by=manager,
        )
        from apps.trust.services import attach_evidence

        attach_evidence(
            verification,
            evidence_type="ghana_card_front",
            file=ready_document(manager, storage),
            collected_by=manager,
        )
        trust_services.decide(verification, approved=True, decided_by=staff)

        # The decision above provisioned it; this is the same Portfolio.
        organization = organization_services.provision_provider_portfolio(user=manager)
        prop = property_services.create_private_property(
            user=manager,
            organization=organization,
            data={
                "title": "Standing Court",
                "property_type": "residential",
                "address_id": address.id,
            },
        )
        # Tenant access now needs the property confirmed as theirs as well as
        # the account, so the relationship is established before the assertion
        # this test is actually about: that losing standing closes it again.
        from django.utils import timezone

        from apps.property.models import PropertyRelationship, PropertyRelationshipType
        from apps.trust.models import (
            SubjectType,
            Verification,
            VerificationKind,
            VerificationMethod,
            VerificationStatus,
        )

        # The relationship carries which verification granted it and when — a
        # bare relationship is not authority, and `property_capabilities` says
        # so by matching on both.
        authority = Verification.objects.create(
            subject_type=SubjectType.PROPERTY,
            subject_id=str(prop.id),
            kind=VerificationKind.PROPERTY_AUTHORITY,
            method=VerificationMethod.DOCUMENT_REVIEW,
            status=VerificationStatus.APPROVED,
            submitted_by=manager,
            decided_at=timezone.now(),
        )
        PropertyRelationship.objects.create(
            property=prop,
            user=manager,
            relationship_type=PropertyRelationshipType.OWNER,
            granted_by=manager,
            authority_verification_id=authority.id,
            authority_verified_at=timezone.now(),
        )
        assert property_capabilities(prop=prop, user=manager)["tenant_access"]["allowed"] is True

        verification.refresh_from_db()
        trust_services.revoke(verification=verification, reason="Standing withdrawn.")

        after = property_capabilities(prop=prop, user=manager)
        assert after["tenant_access"]["allowed"] is False
        assert "provider_standing" in after["tenant_access"]["missing"]
        # The inventory they already built stays theirs to see and edit.
        assert after["private_inventory"]["allowed"] is True


class TestProviderVerificationApi:
    def test_the_endpoint_reports_standing_and_accepts_a_submission(
        self, registered, storage, sign_in_as
    ):
        applicant = registered("0206660009", account_type="provider")
        approve_identity(applicant)
        document = ready_document(applicant, storage)
        api = APIClient()
        sign_in_as(api, user=applicant)

        before = api.get("/api/v1/me/provider-verification/")
        assert before.status_code == 200
        assert before.data["verification_status"] == "not_started"

        submitted = api.post(
            "/api/v1/me/provider-verification/",
            {"documents": [{"file_id": str(document.id), "evidence_type": "ghana_card_front"}]},
            format="json",
        )

        assert submitted.status_code == 201
        assert submitted.data["verification_status"] == "pending"
        assert submitted.data["onboarding_complete"] is True
        assert submitted.data["workspace_access"] is False
        assert submitted.data["can_create_property"] is False

    def test_a_tenant_account_can_ask_to_become_a_provider(self, registered, storage, sign_in_as):
        """Multiple relationships with the platform, established one at a time."""
        person = registered("0206660010", account_type="tenant")
        approve_identity(person)
        document = ready_document(person, storage)
        api = APIClient()
        sign_in_as(api, user=person)

        submitted = api.post(
            "/api/v1/me/provider-verification/",
            {"documents": [{"file_id": str(document.id), "evidence_type": "ghana_card_front"}]},
            format="json",
        )

        assert submitted.status_code == 201
        me = api.get("/api/v1/me/").data
        assert me["capabilities"]["tenant"]["workspace_access"] is True
        assert me["capabilities"]["provider"]["exists"] is True
        # Both sides at once: renting as a tenant today, and waiting on a
        # provider review that has not yet opened anything.
        assert me["capabilities"]["provider"]["onboarding_complete"] is True
        assert me["capabilities"]["provider"]["workspace_access"] is False


class TestPropertyCreationNeedsApproval:
    """The authorization rule, at the service and over HTTP.

    A pending provider has done everything asked of them and may walk around
    their workspace. What they may not do is create the thing every building,
    unit, tenancy and listing hangs from.
    """

    def _organization(self, user):
        """The account's one Portfolio, whatever their standing is.

        Approval provisions it. These tests are about what a *pending* provider
        may do inside one, so the Portfolio is asked for directly rather than
        waiting for a decision that is the thing under test.
        """
        from apps.organization import services as organization_services

        return organization_services.provision_provider_portfolio(user=user)

    def test_a_pending_provider_cannot_create_a_property(self, registered, storage, address):
        from apps.identity import services
        from apps.property import services as property_services

        applicant = registered("0206661001", account_type="provider")
        approve_identity(applicant)
        submit_provider_documents(applicant, storage)

        capabilities = services.account_capabilities(applicant)
        assert capabilities["provider"]["onboarding_complete"] is True
        assert capabilities["provider"]["can_create_property"] is False

        with pytest.raises(PermissionDenied, match="still being reviewed"):
            property_services.create_private_property(
                user=applicant,
                organization=self._organization(applicant),
                data={
                    "title": "Too Early Court",
                    "property_type": "residential",
                    "address_id": address.id,
                },
            )

    def test_an_approved_provider_may_create_a_property(self, registered, storage, staff, address):
        from apps.property import services as property_services
        from apps.trust import services as trust_services

        applicant = registered("0206661002", account_type="provider")
        approve_identity(applicant)
        verification = submit_provider_documents(applicant, storage)
        trust_services.decide(verification, approved=True, decided_by=staff)

        prop = property_services.create_private_property(
            user=applicant,
            organization=self._organization(applicant),
            data={
                "title": "Approved Court",
                "property_type": "residential",
                "address_id": address.id,
            },
        )

        assert prop.created_by == applicant

    def test_a_direct_api_request_cannot_go_round_the_restriction(
        self, registered, storage, address, sign_in_as
    ):
        """Hiding the button is not the boundary. This is."""
        from rest_framework.test import APIClient

        applicant = registered("0206661003", account_type="provider")
        approve_identity(applicant)
        submit_provider_documents(applicant, storage)
        organization = self._organization(applicant)

        api = APIClient()
        sign_in_as(api, user=applicant)
        response = api.post(
            f"/api/v1/organizations/{organization.id}/properties/",
            {
                "title": "Bypass Court",
                "property_type": "residential",
                "address_id": str(address.id),
            },
            format="json",
        )

        assert response.status_code == 403
        assert "reviewed" in response.data["error"]["message"]


class TestUnitsArePropertyScoped:
    """Units exist only inside a property someone owns, with nothing in between."""

    def _approved_property(self, registered, storage, staff, address, phone):
        from apps.organization import services as organization_services
        from apps.property import services as property_services
        from apps.trust import services as trust_services

        owner = registered(phone, account_type="provider")
        approve_identity(owner)
        verification = submit_provider_documents(owner, storage)
        trust_services.decide(verification, approved=True, decided_by=staff)
        organization = organization_services.provision_provider_portfolio(user=owner)
        prop = property_services.create_private_property(
            user=owner,
            organization=organization,
            data={
                "title": "Scoped Court",
                "property_type": "residential",
                "address_id": address.id,
            },
        )
        return owner, prop

    def test_the_owner_may_add_a_unit(self, registered, storage, staff, address):
        from apps.property import services as property_services

        owner, prop = self._approved_property(registered, storage, staff, address, "0206661004")

        unit = property_services.add_unit(
            prop=prop,
            user=owner,
            data={
                "label": "A1",
                "space_type": "apartment",
                "bedrooms": 1,
                "description": "  Bright corner flat.  ",
                "wing": "Block A",
                "entrance_note": "Blue door, top of the stairs",
            },
        )

        assert unit.property_id == prop.id
        # What the form said is what the Unit keeps — creation used to drop it.
        unit.refresh_from_db()
        assert unit.description == "Bright corner flat."
        assert unit.wing == "Block A"
        assert unit.entrance_note == "Blue door, top of the stairs"

    def test_a_stranger_cannot_build_on_someone_else_s_property(
        self, registered, storage, staff, address
    ):
        from apps.property import services as property_services

        _, prop = self._approved_property(registered, storage, staff, address, "0206661005")
        stranger = registered("0206661006", account_type="provider")

        with pytest.raises(PermissionDenied):
            property_services.add_unit(
                prop=prop,
                user=stranger,
                data={"label": "Nope", "space_type": "apartment", "bedrooms": 1},
            )

    def test_there_is_no_building_level_left(self, registered, storage, staff, address):
        """Blocks were removed (owner, 2026-10-20): no endpoint, no column."""
        from rest_framework.test import APIClient

        from apps.property.models import Unit

        owner, prop = self._approved_property(registered, storage, staff, address, "0206661007")
        client = APIClient()
        client.force_authenticate(user=owner)

        assert client.get(f"/api/v1/properties/{prop.id}/buildings/").status_code == 404
        assert "building" not in {field.name for field in Unit._meta.get_fields()}
