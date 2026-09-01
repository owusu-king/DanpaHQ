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
    from tests.conftest import upgrade_portfolio

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


class TestPersonalPortfolio:
    def test_first_property_auto_creates_personal_portfolio_and_owner(
        self, registered, sign_in_as, portfolio_address
    ):
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
        assert portfolio.organization_type == "individual_owner"
        assert set(portfolio.activities.values_list("activity", flat=True)) == {"commercial"}
        membership = OrganizationMembership.objects.get(organization=portfolio, user=owner)
        assert membership.role == "owner"
        assert membership.ended_at is None
        assert portfolio.property_relationships.filter(property_id=response.data["id"]).exists()


class TestProviderPropertyEntryJourneys:
    def test_provider_capable_tenant_switches_then_creates_first_property_and_portfolio(
        self, registered, sign_in_as, portfolio_address
    ):
        """The tenant side crosses into provider onboarding; it never creates a workspace."""
        from apps.organization.models import Organization
        from tests.conftest import approve_provider_standing

        provider = registered("0202100002", first_name="Akua", account_type="provider")
        approve_provider_standing(provider)
        api = APIClient()
        sign_in_as(api, user=provider)

        tenant_side = api.post("/api/v1/me/workspace/", {"workspace": "tenant"}, format="json")
        assert tenant_side.status_code == 200
        assert tenant_side.data["capabilities"]["active_workspace"] == "tenant"
        assert "provider" in tenant_side.data["capabilities"]["available_workspaces"]
        assert api.get("/api/v1/organizations/").data == []

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
        portfolio = Organization.objects.get(created_by=provider)
        assert portfolio.organization_type == "individual_owner"
        assert set(portfolio.activities.values_list("activity", flat=True)) == {"commercial"}

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
        from tests.conftest import approve_provider_standing

        operator = registered("0202100004", first_name="Esi", account_type="provider")
        approve_provider_standing(operator)
        api = APIClient()
        sign_in_as(api, user=operator)

        setup = api.post(
            "/api/v1/organizations/",
            {
                "name": "Legon Student Living",
                "organization_type": "hostel_operator",
                "activities": ["hostel"],
            },
            format="json",
        )
        assert setup.status_code == 201, setup.data

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

    def test_tenant_only_account_cannot_create_a_portfolio_shortcut(self, registered, sign_in_as):
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

        assert response.status_code == 403


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
