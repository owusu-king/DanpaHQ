from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def portfolio_address():
    from apps.geo.models import Address, District, Locality, Region

    region = Region.objects.create(name="Greater Accra", code="TEAM-GA")
    district = District.objects.create(region=region, name="La Dade Kotopon")
    locality = Locality.objects.create(district=district, name="Labadi")
    return Address.objects.create(locality=locality, digital_address="GL-100-2000")


def make_portfolio(owner, *, activities=None):
    from apps.organization import services
    from tests.conftest import approve_provider_standing, upgrade_portfolio

    # A Portfolio's owner is an approved provider: approval is what provisions
    # the Portfolio in the first place, and it is the review where somebody
    # reads their ID. Team administration and the Portfolio's own standing both
    # read that back, so a fixture that skipped it would describe a Portfolio
    # the product cannot actually reach.
    #
    # The Portfolio is written here rather than provisioned-then-renamed only so
    # this file's Portfolios carry names its tests can read; the end state is
    # the one provisioning leaves — one owned Portfolio, its owner, its plan.
    approve_provider_standing(owner)
    organization = services.create_organization(
        user=owner,
        data={
            "name": "Kente Property Business",
            "organization_type": "property_company",
            "activities": activities or ["residential", "commercial"],
        },
    )
    # Team management and the seats it needs are a paid capability, and this
    # whole file is about team management. Free includes one seat, which is the
    # owner, so every Portfolio here is on a plan that has a team to manage.
    upgrade_portfolio(organization, "BUSINESS")
    return organization


def make_property(owner, organization, address, *, title="Portfolio House"):
    from apps.property import services
    from tests.conftest import approve_provider_standing

    approve_provider_standing(owner)
    return services.create_private_property(
        user=owner,
        organization=organization,
        data={"title": title, "property_type": "residential", "address_id": address.id},
    )


def verify_identity(user):
    """The account-level identity check, as a reviewer's decision leaves it."""
    from django.utils import timezone

    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    verification, _ = Verification.objects.get_or_create(
        subject_type=SubjectType.USER,
        subject_id=str(user.id),
        kind=VerificationKind.IDENTITY,
        status=VerificationStatus.APPROVED,
        defaults={
            "method": VerificationMethod.DOCUMENT_REVIEW,
            "submitted_by": user,
            "decided_at": timezone.now(),
        },
    )
    return verification


def grant_portfolio_authority(organization, prop):
    """Stamp the Portfolio's own authority over a Property.

    `property.services.approve_property_authority` writes exactly these two
    fields on the organization's relationship when a property review is
    approved. A Team member's tenant-facing work rests on that relationship
    rather than on one of their own, so a Team test has to establish it — this
    is that state, without running a review inside a test that is not about one.
    """
    from django.utils import timezone

    from apps.organization.models import OrganizationPropertyRelationship
    from apps.trust.models import SubjectType, Verification, VerificationKind, VerificationStatus

    authority = Verification.objects.get(
        subject_type=SubjectType.PROPERTY,
        subject_id=str(prop.id),
        kind=VerificationKind.PROPERTY_AUTHORITY,
        status=VerificationStatus.APPROVED,
    )
    OrganizationPropertyRelationship.objects.filter(
        organization=organization, property=prop, ended_at__isnull=True
    ).update(
        authority_verification_id=authority.id,
        authority_verified_at=timezone.now(),
        updated_at=timezone.now(),
    )
    return authority


class TestPersonalPortfolio:
    def test_a_first_property_finds_one_portfolio_even_if_approval_did_not_make_it(
        self, registered, sign_in_as, portfolio_address
    ):
        """The repair path, for accounts approved before Rooomly provisioned.

        A Portfolio comes from provider approval now. The Property flows must
        not depend on that having already happened — so they ask for the same
        one Portfolio and get it, and never a second one beside it.
        """
        from apps.organization.models import Organization, OrganizationMembership
        from tests.conftest import approve_provider_standing

        owner = registered("0202100001", first_name="Adwoa", account_type="provider")
        approve_provider_standing(owner)
        api = APIClient()
        sign_in_as(api, user=owner)

        response = api.post(
            "/api/v1/portfolio/properties/",
            {
                "title": "Adwoa Arcade",
                "property_type": "commercial",
                "address_id": str(portfolio_address.id),
            },
            format="json",
        )

        assert response.status_code == 201
        portfolio = Organization.objects.get(created_by=owner)
        assert portfolio.name == "Adwoa's Portfolio"
        assert portfolio.organization_type == "individual_owner"
        # Residential is what a provisioned Portfolio starts as; the Property
        # adds what it actually turned out to be.
        assert set(portfolio.activities.values_list("activity", flat=True)) == {
            "residential",
            "commercial",
        }
        membership = OrganizationMembership.objects.get(organization=portfolio, user=owner)
        assert membership.role == "owner"
        assert membership.ended_at is None
        assert portfolio.property_relationships.filter(property_id=response.data["id"]).exists()


class TestProviderPropertyEntryJourneys:
    def test_provider_capable_tenant_switches_then_files_into_the_provisioned_portfolio(
        self, registered, sign_in_as, portfolio_address
    ):
        """The tenant side crosses into provider work; nobody sets a workspace up."""
        from apps.organization import services as organization_services
        from apps.organization.models import Organization
        from tests.conftest import approve_provider_standing

        provider = registered("0202100002", first_name="Akua", account_type="provider")
        approve_provider_standing(provider)
        # The fixture writes the approved row; a reviewer's decision also
        # provisions the Portfolio, and that is the state this journey starts in.
        organization_services.provision_provider_portfolio(user=provider)
        api = APIClient()
        sign_in_as(api, user=provider)

        tenant_side = api.post("/api/v1/me/workspace/", {"workspace": "tenant"}, format="json")
        assert tenant_side.status_code == 200
        assert tenant_side.data["capabilities"]["active_workspace"] == "tenant"
        assert "provider" in tenant_side.data["capabilities"]["available_workspaces"]
        # Crossing to the tenant side changes nothing about the Portfolio they
        # own — and there is exactly one, made when they were approved.
        assert [row["name"] for row in api.get("/api/v1/organizations/").data] == [
            "Akua's Portfolio"
        ]

        provider_side = api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")
        assert provider_side.status_code == 200
        assert provider_side.data["entry_routes"] == {
            "mobile": "/(app)/(provider-tabs)",
            "web": "/home",
        }
        assert provider_side.data["capabilities"]["provider"]["can_create_property"] is True

        vocabulary = api.get("/api/v1/property-types/").data["property_types"]
        assert {row["value"] for row in vocabulary} == {
            "residential",
            "commercial",
            "hostel",
        }

        created = api.post(
            "/api/v1/portfolio/properties/",
            {
                "title": "Akua Trade Centre",
                "property_type": "commercial",
                "address_id": str(portfolio_address.id),
            },
            format="json",
        )
        assert created.status_code == 201, created.data
        # The first Property files into the Portfolio that already exists rather
        # than making one, and teaches it what it now does.
        portfolio = Organization.objects.get(created_by=provider)
        assert portfolio.name == "Akua's Portfolio"
        assert portfolio.organization_type == "individual_owner"
        assert set(portfolio.activities.values_list("activity", flat=True)) == {
            "residential",
            "commercial",
        }

        continued = api.patch(
            f"/api/v1/properties/{created.data['id']}/",
            {
                "water_source": "borehole",
                "power_meter_type": "prepaid",
                "compound_type": "mixed_use",
            },
            format="json",
        )
        assert continued.status_code == 200, continued.data
        assert continued.data["water_source"] == "borehole"

    def test_existing_residential_portfolio_can_add_any_canonical_property_type(
        self, registered, sign_in_as, portfolio_address
    ):
        from tests.conftest import approve_provider_standing

        owner = registered("0202100003", first_name="Kofi", account_type="provider")
        approve_provider_standing(owner)
        organization = make_portfolio(owner, activities=["residential"])
        api = APIClient()
        sign_in_as(api, user=owner)

        options = api.get("/api/v1/property-types/").data["property_types"]
        assert [row["value"] for row in options] == [
            "residential",
            "commercial",
            "hostel",
        ]

        created = api.post(
            f"/api/v1/organizations/{organization.id}/properties/",
            {
                "title": "Kofi Market",
                "property_type": "commercial",
                "address_id": str(portfolio_address.id),
            },
            format="json",
        )
        assert created.status_code == 201, created.data
        assert created.data["property_type"] == "commercial"
        assert set(organization.activities.values_list("activity", flat=True)) == {
            "residential",
            "commercial",
        }

    def test_hostel_business_setup_keeps_hostel_room_and_bed_rules(
        self, registered, sign_in_as, portfolio_address
    ):
        from apps.organization import services as organization_services
        from tests.conftest import approve_provider_standing

        operator = registered("0202100004", first_name="Esi", account_type="provider")
        approve_provider_standing(operator)
        portfolio = organization_services.provision_provider_portfolio(user=operator)
        api = APIClient()
        sign_in_as(api, user=operator)

        # A hostel operator does not set up a second workspace; they say what
        # the Portfolio they were given is for.
        setup = api.patch(
            f"/api/v1/organizations/{portfolio.id}/",
            {
                "name": "Legon Student Living",
                "organization_type": "hostel_operator",
                "activities": ["hostel"],
            },
            format="json",
        )
        assert setup.status_code == 200, setup.data

        hostel_option = next(
            row
            for row in api.get("/api/v1/property-types/").data["property_types"]
            if row["value"] == "hostel"
        )
        assert {row["value"] for row in hostel_option["space_types"]} == {
            "room",
            "bed_space",
        }

        prop = api.post(
            f"/api/v1/organizations/{setup.data['id']}/properties/",
            {
                "title": "Legon Hall",
                "property_type": "hostel",
                "address_id": str(portfolio_address.id),
            },
            format="json",
        )
        assert prop.status_code == 201, prop.data
        room = api.post(
            f"/api/v1/properties/{prop.data['id']}/units/",
            {
                "label": "Room A1",
                "space_type": "room",
                "bedrooms": 1,
                "bathrooms": 1,
            },
            format="json",
        )
        assert room.status_code == 201, room.data
        bed = api.post(
            f"/api/v1/units/{room.data['id']}/beds/",
            {"label": "Bed 1"},
            format="json",
        )
        assert bed.status_code == 201, bed.data

    def test_no_account_can_create_a_portfolio_shortcut(self, registered, sign_in_as):
        """There is no creation handler left to reach, for anybody."""
        tenant = registered("0202100005", first_name="Nana")
        api = APIClient()
        sign_in_as(api, user=tenant)

        response = api.post(
            "/api/v1/organizations/",
            {
                "name": "Hidden Workspace",
                "organization_type": "property_company",
                "activities": ["residential"],
            },
            format="json",
        )

        assert response.status_code == 405
        assert api.get("/api/v1/organizations/").data == []


class TestPortfolioInvitationLifecycle:
    def test_unregistered_invitee_receives_one_sms_handoff(self, registered, sign_in_as, settings):
        from apps.identity.providers import get_sms_provider, reset_sms_provider
        from apps.notifications.handlers import on_organization_invitation_created
        from apps.organization.models import OrganizationInvitation
        from apps.outbox.models import OutboxEvent

        settings.SMS_BACKEND = "memory"
        reset_sms_provider()
        owner = registered("0202100008", first_name="Owner", account_type="provider")
        organization = make_portfolio(owner)
        owner_api = APIClient()
        sign_in_as(owner_api, user=owner)

        response = owner_api.post(
            f"/api/v1/organizations/{organization.id}/invitations/",
            {"phone": "0202100009", "role": "staff"},
            format="json",
        )

        assert response.status_code == 201
        event = OutboxEvent.objects.get(
            name="organization.invitation_created.v1", aggregate_id=response.data["id"]
        )
        on_organization_invitation_created(event)
        on_organization_invitation_created(event)
        provider = get_sms_provider()
        messages = [
            message
            for message in provider.outbox
            if message.reference == f"portfolio-invitation:{response.data['id']}"
        ]
        assert len(messages) == 1
        assert messages[0].to == "+233202100009"
        assert "Sign in or register" in messages[0].body
        invitation = OrganizationInvitation.objects.get(id=response.data["id"])
        assert invitation.sms_sent_at is not None
        reset_sms_provider()

    def test_pending_invitation_has_no_authority_until_matching_invitee_accepts(
        self, registered, sign_in_as, portfolio_address
    ):
        from apps.audit.models import AuditLog
        from apps.organization.models import OrganizationMembership
        from apps.outbox.models import OutboxEvent

        owner = registered("0202100010", first_name="Owner", account_type="provider")
        manager = registered("0202100011", first_name="Manager", account_type="provider")
        stranger = registered("0202100012", first_name="Stranger")
        organization = make_portfolio(owner)
        prop = make_property(owner, organization, portfolio_address)
        owner_api = APIClient()
        sign_in_as(owner_api, user=owner)

        invited = owner_api.post(
            f"/api/v1/organizations/{organization.id}/invitations/",
            {
                "phone": manager.phone,
                "role": "property_manager",
                "property_ids": [str(prop.id)],
            },
            format="json",
        )

        assert invited.status_code == 201
        assert invited.data["status"] == "pending"
        assert invited.data["token"]
        assert not OrganizationMembership.objects.filter(
            organization=organization, user=manager, ended_at__isnull=True
        ).exists()

        manager_api = APIClient()
        sign_in_as(manager_api, user=manager)
        pending_me = manager_api.get("/api/v1/me/").data
        assert f"organization:{organization.id}" not in {
            row["id"] for row in pending_me["contexts"]
        }
        assert manager_api.get(f"/api/v1/organizations/{organization.id}/").status_code == 404

        stranger_api = APIClient()
        sign_in_as(stranger_api, user=stranger)
        wrong = stranger_api.post(
            f"/api/v1/portfolio-invitations/{invited.data['id']}/accept/",
            {"token": invited.data["token"]},
            format="json",
        )
        assert wrong.status_code == 403

        accepted = manager_api.post(
            f"/api/v1/portfolio-invitations/{invited.data['id']}/accept/",
            {"token": invited.data["token"]},
            format="json",
        )
        assert accepted.status_code == 200
        assert accepted.data["role"] == "property_manager"
        assert accepted.data["assigned_properties"] == [{"id": str(prop.id), "title": prop.title}]
        contexts = manager_api.get("/api/v1/me/").data["contexts"]
        assert any(row["id"] == f"organization:{organization.id}" for row in contexts)
        assert AuditLog.objects.filter(
            aggregate_id=str(organization.id), metadata__action="membership_activated"
        ).exists()
        assert AuditLog.objects.filter(
            aggregate_id=str(prop.id), metadata__action="property_assigned"
        ).exists()
        assert OutboxEvent.objects.filter(name="organization.membership_activated.v1").exists()
        assert OutboxEvent.objects.filter(name="organization.property_assigned.v1").exists()

    def test_decline_revoke_and_expiry_never_activate_membership(self, registered, sign_in_as):
        from apps.organization import services
        from apps.organization.models import OrganizationInvitation, OrganizationMembership

        owner = registered("0202100020", first_name="Owner", account_type="provider")
        first = registered("0202100021", first_name="First")
        second = registered("0202100022", first_name="Second")
        third = registered("0202100023", first_name="Third")
        organization = make_portfolio(owner)
        owner_api = APIClient()
        sign_in_as(owner_api, user=owner)

        declined = owner_api.post(
            f"/api/v1/organizations/{organization.id}/invitations/",
            {"phone": first.phone, "role": "staff"},
            format="json",
        ).data
        first_api = APIClient()
        sign_in_as(first_api, user=first)
        response = first_api.post(
            f"/api/v1/portfolio-invitations/{declined['id']}/decline/",
            {"token": declined["token"]},
            format="json",
        )
        assert response.status_code == 200
        assert response.data["status"] == "declined"

        revoked = owner_api.post(
            f"/api/v1/organizations/{organization.id}/invitations/",
            {"phone": second.phone, "role": "accountant"},
            format="json",
        ).data
        response = owner_api.post(
            f"/api/v1/organizations/{organization.id}/invitations/{revoked['id']}/revoke/",
            {},
            format="json",
        )
        assert response.status_code == 200
        assert response.data["status"] == "revoked"

        invitation = services.create_invitation(
            organization=organization,
            actor=owner,
            invitee_phone=third.phone,
            role="staff",
        )
        token = services.invitation_token(invitation)
        OrganizationInvitation.objects.filter(id=invitation.id).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        third_api = APIClient()
        sign_in_as(third_api, user=third)
        response = third_api.post(
            f"/api/v1/portfolio-invitations/{invitation.id}/accept/",
            {"token": token},
            format="json",
        )
        assert response.status_code == 409
        assert not OrganizationMembership.objects.filter(
            organization=organization, user__in=[first, second, third], ended_at__isnull=True
        ).exists()


class TestPortfolioRolesAndAssignments:
    def _accept(self, *, owner_api, member_api, organization, member, role, property_ids=None):
        invited = owner_api.post(
            f"/api/v1/organizations/{organization.id}/invitations/",
            {"phone": member.phone, "role": role, "property_ids": property_ids or []},
            format="json",
        ).data
        return member_api.post(
            f"/api/v1/portfolio-invitations/{invited['id']}/accept/",
            {"token": invited["token"]},
            format="json",
        )

    def test_scoped_roles_assign_unassign_change_and_revoke(
        self, registered, sign_in_as, portfolio_address
    ):
        from apps.organization import services
        from apps.organization.models import PropertyAssignment

        owner = registered("0202100030", first_name="Owner", account_type="provider")
        manager = registered("0202100031", first_name="Manager", account_type="provider")
        organization = make_portfolio(owner)
        first = make_property(owner, organization, portfolio_address, title="First House")
        second = make_property(owner, organization, portfolio_address, title="Second House")
        owner_api = APIClient()
        member_api = APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(member_api, user=manager)
        accepted = self._accept(
            owner_api=owner_api,
            member_api=member_api,
            organization=organization,
            member=manager,
            role="property_manager",
            property_ids=[str(first.id)],
        )
        membership_id = accepted.data["id"]

        member_properties = member_api.get(f"/api/v1/organizations/{organization.id}/properties/")
        assert {row["id"] for row in member_properties.data} == {str(first.id)}
        owner_properties = owner_api.get(f"/api/v1/organizations/{organization.id}/properties/")
        assert {row["id"] for row in owner_properties.data} == {str(first.id), str(second.id)}

        assigned = owner_api.post(
            f"/api/v1/organizations/{organization.id}/property-assignments/",
            {"membership_id": membership_id, "property_id": str(second.id)},
            format="json",
        )
        assert assigned.status_code == 201
        assert services.can_manage_property(prop=second, user=manager)
        assert (
            owner_api.delete(
                f"/api/v1/organizations/{organization.id}/property-assignments/{assigned.data['id']}/"
            ).status_code
            == 204
        )
        assert not services.can_manage_property(prop=second, user=manager)

        changed = owner_api.patch(
            f"/api/v1/organizations/{organization.id}/memberships/{membership_id}/",
            {"role": "accountant"},
            format="json",
        )
        assert changed.status_code == 200
        assert changed.data["effective_access"] == "assigned_financial"
        assert not services.can_manage_property(prop=first, user=manager)
        assert (
            owner_api.delete(
                f"/api/v1/organizations/{organization.id}/memberships/{membership_id}/",
                {"reason": "Contract ended"},
                format="json",
            ).status_code
            == 204
        )
        assert not PropertyAssignment.objects.filter(
            membership_id=membership_id, ended_at__isnull=True
        ).exists()
        assert member_api.get(f"/api/v1/organizations/{organization.id}/").status_code == 404

    def test_accountant_and_unverified_member_cannot_manage_or_bypass_trust(
        self, registered, sign_in_as, portfolio_address, approve_provider
    ):
        from apps.organization import services
        from apps.property.capabilities import property_capabilities

        owner = registered("0202100040", first_name="Owner", account_type="provider")
        accountant = registered("0202100041", first_name="Accounts", account_type="provider")
        manager = registered("0202100042", first_name="Manager", account_type="provider")
        organization = make_portfolio(owner)
        prop = make_property(owner, organization, portfolio_address)
        approve_provider(owner, prop)
        owner_api = APIClient()
        accountant_api = APIClient()
        manager_api = APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(accountant_api, user=accountant)
        sign_in_as(manager_api, user=manager)

        accountant_membership = self._accept(
            owner_api=owner_api,
            member_api=accountant_api,
            organization=organization,
            member=accountant,
            role="accountant",
            property_ids=[str(prop.id)],
        ).data
        assert accountant_api.get(f"/api/v1/properties/{prop.id}/").status_code == 403
        assert (
            accountant_api.post(
                f"/api/v1/properties/{prop.id}/units/",
                {"label": "Not allowed", "space_type": "apartment"},
                format="json",
            ).status_code
            == 403
        )
        assert accountant_membership["effective_access"] == "assigned_financial"

        self._accept(
            owner_api=owner_api,
            member_api=manager_api,
            organization=organization,
            member=manager,
            role="property_manager",
            property_ids=[str(prop.id)],
        )
        assert services.can_manage_property(prop=prop, user=manager)
        capabilities = property_capabilities(prop=prop, user=manager)
        assert capabilities["private_inventory"]["allowed"] is True
        for action in ("tenant_access", "leases", "payment_collection", "publication"):
            assert capabilities[action]["allowed"] is False

    def test_direct_membership_post_cannot_bypass_invitation(self, registered, sign_in_as):
        owner = registered("0202100050", first_name="Owner", account_type="provider")
        target = registered("0202100051", first_name="Target")
        organization = make_portfolio(owner)
        api = APIClient()
        sign_in_as(api, user=owner)

        response = api.post(
            f"/api/v1/organizations/{organization.id}/memberships/",
            {"user_id": str(target.id), "role": "admin"},
            format="json",
        )

        assert response.status_code == 405


class TestTeamMemberWorkspace:
    """What accepting an invitation is supposed to produce.

    The reported failure was never that acceptance broke — the membership was
    written every time — but that nothing downstream read it. The workspace
    opened on the member's *own* provider verification, which an invited person
    does not have and should never be asked for: the Portfolio that invited them
    holds the standing. These tests hold the whole path, from the number being
    invited to the Portfolio being operated.
    """

    def _invite(self, owner_api, organization, *, phone, role="staff", property_ids=None):
        response = owner_api.post(
            f"/api/v1/organizations/{organization.id}/invitations/",
            {"phone": phone, "role": role, "property_ids": property_ids or []},
            format="json",
        )
        assert response.status_code == 201, response.data
        return response.data

    def _accept(self, api, invitation):
        return api.post(
            f"/api/v1/portfolio-invitations/{invitation['id']}/accept/",
            {"token": invitation["token"]},
            format="json",
        )

    def test_an_existing_tenant_joins_and_the_portfolio_workspace_opens(
        self, registered, sign_in_as, portfolio_address
    ):
        owner = registered("0202100070", first_name="Owner", account_type="provider")
        tenant = registered("0202100071", first_name="Ama")
        organization = make_portfolio(owner)
        prop = make_property(owner, organization, portfolio_address)
        owner_api = APIClient()
        tenant_api = APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(tenant_api, user=tenant)

        before = tenant_api.get("/api/v1/me/").data
        assert before["capabilities"]["provider"]["workspace_access"] is False
        assert "provider" not in before["capabilities"]["available_workspaces"]

        invited = self._invite(
            owner_api,
            organization,
            phone=tenant.phone,
            role="property_manager",
            property_ids=[str(prop.id)],
        )
        waiting = tenant_api.get("/api/v1/me/portfolio-invitations/").data
        assert [row["id"] for row in waiting] == [invited["id"]]
        assert waiting[0]["addressed_to_you"] is True
        assert waiting[0]["requirements"] == []

        accepted = self._accept(tenant_api, invited)

        assert accepted.status_code == 200, accepted.data
        assert accepted.data["role"] == "property_manager"
        assert accepted.data["context_id"] == f"organization:{organization.id}"
        assert accepted.data["portfolio"]["name"] == organization.name
        assert accepted.data["assigned_properties"] == [{"id": str(prop.id), "title": prop.title}]
        # In, and honest about what is not live yet: they have not verified
        # their identity, so tenant-facing work names that and nothing else.
        assert accepted.data["access"]["state"] == "limited"
        assert accepted.data["access"]["requirements"] == ["identity"]
        assert accepted.data["access"]["can"]["operate_properties"] is True
        assert accepted.data["access"]["can"]["manage_team"] is False

        me = tenant_api.get("/api/v1/me/").data
        assert me["capabilities"]["provider"]["workspace_access"] is True
        # …without becoming a provider. Nobody asked them to declare anything.
        assert me["capabilities"]["provider"]["exists"] is False
        assert me["capabilities"]["provider"]["verification_status"] is None
        assert "provider" in me["capabilities"]["available_workspaces"]
        context = next(row for row in me["contexts"] if row["id"] == accepted.data["context_id"])
        assert context["role"] == "property_manager"
        assert context["access"]["scope"] == "assigned_properties"

        switched = tenant_api.post(
            "/api/v1/me/workspace/", {"workspace": "provider"}, format="json"
        )
        assert switched.status_code == 200
        assert switched.data["entry_routes"] == {
            "mobile": "/(app)/(provider-tabs)",
            "web": "/home",
        }
        assert switched.data["default_context_id"] == accepted.data["context_id"]
        assert switched.data["capabilities"]["provider"]["exists"] is False

        assert {
            row["id"]
            for row in tenant_api.get(f"/api/v1/organizations/{organization.id}/properties/").data
        } == {str(prop.id)}

    def test_a_new_account_accepts_after_registering_with_the_invited_number(
        self, registered, sign_in_as
    ):
        """The SMS handoff, end to end: invited first, account second."""
        owner = registered("0202100072", first_name="Owner", account_type="provider")
        organization = make_portfolio(owner)
        owner_api = APIClient()
        sign_in_as(owner_api, user=owner)
        self._invite(owner_api, organization, phone="0202100073", role="staff")

        # They register the ordinary way — a tenant account, no provider journey.
        newcomer = registered("0202100073", first_name="Kojo")
        api = APIClient()
        sign_in_as(api, user=newcomer)

        waiting = api.get("/api/v1/me/portfolio-invitations/").data
        assert len(waiting) == 1
        accepted = self._accept(api, waiting[0])

        assert accepted.status_code == 200, accepted.data
        assert accepted.data["access"]["can"]["operate_properties"] is True
        me = api.get("/api/v1/me/").data
        assert me["capabilities"]["provider"]["workspace_access"] is True
        assert me["capabilities"]["account_type"] == "tenant"
        assert any(row["id"] == accepted.data["context_id"] for row in me["contexts"])

    def test_accepting_twice_returns_the_same_membership(self, registered, sign_in_as):
        from apps.organization.models import OrganizationMembership

        owner = registered("0202100074", first_name="Owner", account_type="provider")
        member = registered("0202100075", first_name="Twice")
        organization = make_portfolio(owner)
        owner_api = APIClient()
        member_api = APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(member_api, user=member)
        invited = self._invite(owner_api, organization, phone=member.phone, role="staff")

        first = self._accept(member_api, invited)
        second = self._accept(member_api, invited)

        assert first.status_code == 200
        assert second.status_code == 200, second.data
        assert second.data["id"] == first.data["id"]
        assert (
            OrganizationMembership.objects.filter(
                organization=organization, user=member, ended_at__isnull=True
            ).count()
            == 1
        )

    def test_an_administrator_invitation_waits_for_identity_verification(
        self, registered, sign_in_as
    ):
        """The asymmetry the brief asks for, at the one moment it matters."""
        from apps.organization.models import OrganizationMembership

        owner = registered("0202100076", first_name="Owner", account_type="provider")
        person = registered("0202100077", first_name="Nana")
        organization = make_portfolio(owner)
        owner_api = APIClient()
        person_api = APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(person_api, user=person)

        invited = self._invite(owner_api, organization, phone=person.phone, role="admin")
        waiting = person_api.get("/api/v1/me/portfolio-invitations/").data
        assert waiting[0]["requirements"] == ["identity"]

        refused = self._accept(person_api, invited)

        assert refused.status_code == 403
        assert "identity" in refused.data["error"]["message"].lower()
        assert not OrganizationMembership.objects.filter(
            organization=organization, user=person, ended_at__isnull=True
        ).exists()

        verify_identity(person)
        accepted = self._accept(person_api, invited)

        assert accepted.status_code == 200, accepted.data
        assert accepted.data["access"]["state"] == "active"
        assert accepted.data["access"]["can"]["manage_team"] is True
        assert accepted.data["access"]["can"]["create_properties"] is True

    def test_ownership_never_travels_through_the_team(self, registered, sign_in_as):
        from apps.core.exceptions import ValidationFailed
        from apps.organization import services

        owner = registered("0202100078", first_name="Owner", account_type="provider")
        target = registered("0202100079", first_name="Target")
        organization = make_portfolio(owner)
        owner_api = APIClient()
        target_api = APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(target_api, user=target)

        refused = owner_api.post(
            f"/api/v1/organizations/{organization.id}/invitations/",
            {"phone": target.phone, "role": "owner"},
            format="json",
        )
        # 422: the request is well-formed and refused on its content.
        assert refused.status_code == 422
        assert "Ownership" in str(refused.data)

        # And for any caller that skips the form.
        with pytest.raises(ValidationFailed):
            services.create_invitation(
                organization=organization,
                actor=owner,
                invitee_phone=target.phone,
                role="owner",
            )

        invited = self._invite(owner_api, organization, phone=target.phone, role="staff")
        membership = self._accept(target_api, invited).data
        promoted = owner_api.patch(
            f"/api/v1/organizations/{organization.id}/memberships/{membership['id']}/",
            {"role": "owner"},
            format="json",
        )

        assert promoted.status_code == 422
        assert "Ownership" in str(promoted.data)

    def test_an_unverified_administrator_cannot_grant_access_but_can_end_it(
        self, registered, sign_in_as
    ):
        """A lapsed check stops what it should stop, and nothing more.

        Granting access waits for the person to be identified again. Ending it
        does not: cutting somebody off must never queue behind paperwork.
        """
        from apps.trust import services as trust_services

        owner = registered("0202100080", first_name="Owner", account_type="provider")
        admin = registered("0202100081", first_name="Admin")
        staff_member = registered("0202100082", first_name="Staffer")
        organization = make_portfolio(owner)
        owner_api = APIClient()
        admin_api = APIClient()
        staff_api = APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(admin_api, user=admin)
        sign_in_as(staff_api, user=staff_member)

        identity = verify_identity(admin)
        admin_invite = self._invite(owner_api, organization, phone=admin.phone, role="admin")
        assert self._accept(admin_api, admin_invite).status_code == 200
        staff_invite = self._invite(owner_api, organization, phone=staff_member.phone, role="staff")
        staff_membership = self._accept(staff_api, staff_invite).data

        trust_services.revoke(verification=identity, reason="Document withdrawn.")

        context = next(
            row
            for row in admin_api.get("/api/v1/me/").data["contexts"]
            if row["id"] == f"organization:{organization.id}"
        )
        assert context["access"]["state"] == "pending_verification"
        assert context["access"]["can"]["manage_team"] is False
        assert context["access"]["can"]["operate_properties"] is True

        blocked = admin_api.post(
            f"/api/v1/organizations/{organization.id}/invitations/",
            {"phone": "0202100083", "role": "staff"},
            format="json",
        )
        assert blocked.status_code == 403
        assert "identity" in blocked.data["error"]["message"].lower()

        ended = admin_api.delete(
            f"/api/v1/organizations/{organization.id}/memberships/{staff_membership['id']}/",
            {"reason": "Contract ended"},
            format="json",
        )
        assert ended.status_code == 204

    def test_a_member_reaches_tenant_work_on_the_portfolios_standing(
        self, registered, sign_in_as, portfolio_address, approve_provider
    ):
        """The rule the whole change rests on.

        A property manager is not an independent provider and is never asked to
        become one. What they answer for is who *they* are; the Portfolio
        answers for whether this business may operate at all.
        """
        from apps.identity.services import account_capabilities
        from apps.property.capabilities import property_capabilities

        owner = registered("0202100085", first_name="Owner", account_type="provider")
        manager = registered("0202100086", first_name="Manager")
        organization = make_portfolio(owner)
        prop = make_property(owner, organization, portfolio_address)
        approve_provider(owner, prop)
        grant_portfolio_authority(organization, prop)
        owner_api = APIClient()
        manager_api = APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(manager_api, user=manager)

        invited = self._invite(
            owner_api,
            organization,
            phone=manager.phone,
            role="property_manager",
            property_ids=[str(prop.id)],
        )
        assert self._accept(manager_api, invited).status_code == 200

        before = property_capabilities(prop=prop, user=manager)
        assert before["private_inventory"]["allowed"] is True
        assert before["tenant_access"]["allowed"] is False
        # Their own identity, and not a provider application of their own.
        assert before["tenant_access"]["missing"] == ["identity"]

        verify_identity(manager)

        after = property_capabilities(prop=prop, user=manager)
        assert after["tenant_access"]["allowed"] is True
        assert after["leases"]["allowed"] is True
        assert account_capabilities(manager)["provider"]["exists"] is False

    def test_a_member_cannot_reach_another_portfolio(
        self, registered, sign_in_as, portfolio_address
    ):
        owner = registered("0202100087", first_name="Owner", account_type="provider")
        stranger_owner = registered("0202100088", first_name="Other", account_type="provider")
        manager = registered("0202100089", first_name="Manager")
        organization = make_portfolio(owner)
        prop = make_property(owner, organization, portfolio_address)
        other = make_portfolio(stranger_owner)
        other_prop = make_property(
            stranger_owner, other, portfolio_address, title="Somebody Else's House"
        )
        owner_api = APIClient()
        manager_api = APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(manager_api, user=manager)
        invited = self._invite(
            owner_api,
            organization,
            phone=manager.phone,
            role="property_manager",
            property_ids=[str(prop.id)],
        )
        membership = self._accept(manager_api, invited).data

        assert manager_api.get(f"/api/v1/organizations/{other.id}/").status_code == 404
        assert manager_api.get(f"/api/v1/organizations/{other.id}/properties/").status_code == 404
        assert manager_api.get(f"/api/v1/properties/{other_prop.id}/").status_code == 403
        # Nor by pointing their own Portfolio's assignment endpoint at it.
        reached = manager_api.post(
            f"/api/v1/organizations/{organization.id}/property-assignments/",
            {"membership_id": membership["id"], "property_id": str(other_prop.id)},
            format="json",
        )
        assert reached.status_code == 403

    def test_revoking_a_membership_closes_the_workspace(
        self, registered, sign_in_as, portfolio_address
    ):
        from apps.organization import services

        owner = registered("0202100093", first_name="Owner", account_type="provider")
        manager = registered("0202100094", first_name="Manager")
        organization = make_portfolio(owner)
        prop = make_property(owner, organization, portfolio_address)
        owner_api = APIClient()
        manager_api = APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(manager_api, user=manager)
        invited = self._invite(
            owner_api,
            organization,
            phone=manager.phone,
            role="property_manager",
            property_ids=[str(prop.id)],
        )
        membership = self._accept(manager_api, invited).data
        manager_api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")
        assert services.can_manage_property(prop=prop, user=manager)

        removed = owner_api.delete(
            f"/api/v1/organizations/{organization.id}/memberships/{membership['id']}/",
            {"reason": "Contract ended"},
            format="json",
        )

        assert removed.status_code == 204
        me = manager_api.get("/api/v1/me/").data
        assert me["capabilities"]["provider"]["workspace_access"] is False
        assert all(row["type"] != "organization" for row in me["contexts"])
        # And they are not left standing in a workspace that is no longer theirs.
        assert me["entry_routes"] == {"mobile": "/(app)/(tabs)", "web": "/home"}
        assert manager_api.get(f"/api/v1/organizations/{organization.id}/").status_code == 404
        assert not services.can_manage_property(prop=prop, user=manager)

    def test_a_used_up_link_explains_itself_instead_of_vanishing(self, registered, sign_in_as):
        from apps.organization import services
        from apps.organization.models import OrganizationInvitation

        owner = registered("0202100095", first_name="Owner", account_type="provider")
        invitee = registered("0202100096", first_name="Abena")
        stranger = registered("0202100097", first_name="Stranger")
        organization = make_portfolio(owner)
        invitation = services.create_invitation(
            organization=organization,
            actor=owner,
            invitee_phone=invitee.phone,
            role="staff",
        )
        token = services.invitation_token(invitation)
        OrganizationInvitation.objects.filter(id=invitation.id).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        invitee_api = APIClient()
        stranger_api = APIClient()
        sign_in_as(invitee_api, user=invitee)
        sign_in_as(stranger_api, user=stranger)

        resolved = invitee_api.get(f"/api/v1/portfolio-invitations/{invitation.id}/?token={token}")

        assert resolved.status_code == 200
        assert resolved.data["status"] == "expired"
        assert resolved.data["addressed_to_you"] is True
        assert resolved.data["token"] is None

        # The waiting list stays about what is waiting; history says what became
        # of the rest, so "nothing here" is never the only thing on offer.
        assert invitee_api.get("/api/v1/me/portfolio-invitations/").data == []
        history = invitee_api.get("/api/v1/me/portfolio-invitations/?include=history").data
        assert [row["status"] for row in history] == ["expired"]

        wrong = stranger_api.get(f"/api/v1/portfolio-invitations/{invitation.id}/?token={token}")
        assert wrong.status_code == 200
        assert wrong.data["addressed_to_you"] is False
        assert "•••" in wrong.data["invitee_phone"]
        assert wrong.data["token"] is None

        assert (
            invitee_api.get(
                f"/api/v1/portfolio-invitations/{invitation.id}/?token=not-a-real-token"
            ).status_code
            == 404
        )
