"""One Portfolio per provider, and Danpa HQ is the one who makes it.

A Portfolio used to be something a provider set up for themselves, which meant
an account could accumulate them — and two Portfolios one person owns is two of
everything: two subscriptions, two Teams, two places a Property could have been
filed with one of them wrong, and a switcher offering a choice nobody meant to
make.

Provider approval now provisions exactly one, named after the person or their
business. The owner renames it. Nothing a client can send creates a second, and
the only way into another Portfolio is somebody else's invitation.
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict

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
def provisioning_address(db):
    from apps.geo.models import Address, District, Locality, Region

    region = Region.objects.create(name="Greater Accra", code="PROV-GA")
    district = District.objects.create(region=region, name="Ayawaso West")
    locality = Locality.objects.create(district=district, name="Dzorwulu")
    return Address.objects.create(locality=locality, digital_address="GA-333-5555")


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


def approve_as_provider(applicant, storage, staff):
    """Take one account through the review a real provider goes through.

    Deliberately the whole path — evidence submitted, a reviewer deciding —
    rather than writing an approved verification row, because provisioning
    hangs off the decision and a fabricated row would skip the thing under
    test.
    """
    from apps.identity import services as identity_services
    from apps.trust import services as trust_services

    verification = identity_services.start_provider_verification(
        user=applicant,
        documents=[
            {"file": ready_document(applicant, storage), "evidence_type": "ghana_card_front"}
        ],
    )
    return trust_services.decide(verification, approved=True, decided_by=staff)


def lapse_provider_standing(user):
    """Let the approved check run out, the way a real provider's does.

    A second decision on one account is not a hypothetical: provider standing
    expires, and the person is reviewed again. Danpa HQ must not hand them a
    second Portfolio for having been approved twice.
    """
    from apps.trust.models import SubjectType, Verification, VerificationKind
    from apps.trust.tasks import expire_verifications

    Verification.objects.filter(
        subject_type=SubjectType.USER,
        subject_id=str(user.id),
        kind=VerificationKind.PROVIDER,
    ).update(expires_at=timezone.now() - timedelta(seconds=1))
    # The sweep that settles a lapsed check, so the account can be reviewed
    # again exactly as it would be in production.
    expire_verifications()


def owned_portfolios(user):
    from apps.organization.models import Organization

    return list(
        Organization.objects.filter(
            memberships__user=user,
            memberships__role="owner",
            memberships__ended_at__isnull=True,
            is_active=True,
        ).distinct()
    )


class TestApprovalProvisionsOnePortfolio:
    def test_an_approved_provider_arrives_to_a_portfolio_already_made(
        self, registered, storage, staff
    ):
        from apps.billing.services import entitlement_service
        from apps.organization import services as organization_services

        applicant = registered("0207770001", first_name="Kwame", account_type="provider")
        assert owned_portfolios(applicant) == []

        approve_as_provider(applicant, storage, staff)

        portfolios = owned_portfolios(applicant)
        assert len(portfolios) == 1
        # Named the way a person refers to it out loud, and typed as what the
        # account has declared itself to be so far.
        assert portfolios[0].name == "Kwame's Portfolio"
        assert portfolios[0].organization_type == "individual_owner"
        assert organization_services.owned_portfolio(applicant) == portfolios[0]

        # A working Portfolio rather than a placeholder: the owner's membership
        # and the Free subscription every Portfolio starts on are both there.
        membership = portfolios[0].memberships.get(user=applicant)
        assert membership.role == "owner"
        assert membership.ended_at is None
        assert entitlement_service.current_plan(organization=portfolios[0]).code == "FREE"

    def test_a_business_portfolio_carries_the_business_name(self, registered, storage, staff):
        from apps.identity.models import LandlordProfile

        applicant = registered("0207770002", first_name="Adwoa", account_type="provider")
        LandlordProfile.objects.create(
            user=applicant, is_company=True, company_name="Prime Homes Ltd"
        )

        approve_as_provider(applicant, storage, staff)

        portfolio = owned_portfolios(applicant)[0]
        # A business provider's Portfolio is the business. Its tenants,
        # agreements and receipts carry this name, so it is not "Adwoa's".
        assert portfolio.name == "Prime Homes Ltd"
        assert portfolio.organization_type == "property_company"

    def test_an_agency_portfolio_carries_the_agency_name(self, registered, storage, staff):
        from apps.identity.models import AgentProfile

        applicant = registered("0207770003", first_name="Yaw", account_type="provider")
        AgentProfile.objects.create(user=applicant, agency_name="Accra Lettings")

        approve_as_provider(applicant, storage, staff)

        portfolio = owned_portfolios(applicant)[0]
        assert portfolio.name == "Accra Lettings"
        assert portfolio.organization_type == "property_manager"

    def test_the_workspace_opens_on_the_portfolio_that_was_just_made(
        self, registered, sign_in_as, storage, staff
    ):
        applicant = registered("0207770004", first_name="Esi", account_type="provider")
        approve_as_provider(applicant, storage, staff)

        api = APIClient()
        sign_in_as(api, user=applicant)
        me = api.get("/api/v1/me/").data

        assert me["capabilities"]["provider"]["workspace_access"] is True
        contexts = [row for row in me["contexts"] if row["type"] == "organization"]
        assert len(contexts) == 1
        assert contexts[0]["label"] == "Esi's Portfolio"
        assert contexts[0]["role"] == "owner"


class TestProvisioningRunsOnce:
    def test_a_second_decision_returns_the_same_portfolio(self, registered, storage, staff):
        """Approval is decided more than once over an account's life."""
        from apps.organization import services as organization_services

        applicant = registered("0207770010", first_name="Kojo", account_type="provider")
        approve_as_provider(applicant, storage, staff)
        first = organization_services.owned_portfolio(applicant)

        # A lapse and a re-check: a second approved decision on the same
        # account. It must not leave the person with two of everything.
        lapse_provider_standing(applicant)
        approve_as_provider(applicant, storage, staff)

        assert len(owned_portfolios(applicant)) == 1
        assert organization_services.owned_portfolio(applicant) == first

    def test_provisioning_is_safe_to_call_again_directly(self, registered, storage, staff):
        from apps.organization import services as organization_services

        applicant = registered("0207770011", first_name="Afia", account_type="provider")
        approve_as_provider(applicant, storage, staff)
        first = organization_services.owned_portfolio(applicant)

        again = organization_services.provision_provider_portfolio(user=applicant)
        once_more = organization_services.provision_provider_portfolio(user=applicant)

        assert again == first
        assert once_more == first
        assert len(owned_portfolios(applicant)) == 1

    def test_a_renamed_portfolio_is_not_provisioned_over(self, registered, storage, staff):
        """The owner's name for it survives the next decision on their account."""
        from apps.organization import services as organization_services

        applicant = registered("0207770012", first_name="Abena", account_type="provider")
        approve_as_provider(applicant, storage, staff)
        portfolio = organization_services.owned_portfolio(applicant)
        organization_services.update_organization(
            organization=portfolio, actor=applicant, data={"name": "Abena Estates"}
        )

        lapse_provider_standing(applicant)
        approve_as_provider(applicant, storage, staff)

        assert len(owned_portfolios(applicant)) == 1
        portfolio.refresh_from_db()
        assert portfolio.name == "Abena Estates"

    def test_a_first_property_files_into_the_portfolio_that_exists(
        self, registered, storage, staff, provisioning_address
    ):
        """The Property flows no longer conjure a second, personal Portfolio."""
        from apps.organization import services as organization_services
        from apps.property import services as property_services

        applicant = registered("0207770013", first_name="Nana", account_type="provider")
        approve_as_provider(applicant, storage, staff)
        provisioned = organization_services.owned_portfolio(applicant)
        # A business Portfolio, which is where the old rule broke: it looked for
        # a personal one, found none, and made one beside the company.
        organization_services.update_organization(
            organization=provisioned,
            actor=applicant,
            data={"name": "Nana Homes Ltd", "organization_type": "property_company"},
        )

        prop = property_services.create_personal_property(
            user=applicant,
            data={
                "title": "Dzorwulu Flat",
                "property_type": "residential",
                "address_id": provisioning_address.id,
            },
        )

        assert len(owned_portfolios(applicant)) == 1
        assert provisioned.property_relationships.filter(property=prop).exists()


class TestNobodyCreatesAPortfolio:
    def test_the_portfolio_endpoint_does_not_accept_a_post(
        self, registered, sign_in_as, storage, staff
    ):
        applicant = registered("0207770020", first_name="Mensah", account_type="provider")
        approve_as_provider(applicant, storage, staff)
        api = APIClient()
        sign_in_as(api, user=applicant)

        response = api.post(
            "/api/v1/organizations/",
            {
                "name": "Second Workspace",
                "organization_type": "property_company",
                "activities": ["residential"],
            },
            format="json",
        )

        # The route reads Portfolios and nothing else; there is no creation
        # handler behind it to reach.
        assert response.status_code == 405
        assert len(owned_portfolios(applicant)) == 1

    def test_a_tenant_cannot_reach_portfolio_creation_either(self, registered, sign_in_as):
        tenant = registered("0207770021", first_name="Yaa")
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
        assert owned_portfolios(tenant) == []
        assert api.get("/api/v1/organizations/").data == []

    def test_the_service_itself_refuses_a_second_portfolio(self, registered, storage, staff):
        """The rule lives under the endpoint, not in it."""
        from apps.organization import services as organization_services

        applicant = registered("0207770022", first_name="Kofi", account_type="provider")
        approve_as_provider(applicant, storage, staff)

        with pytest.raises(Conflict, match="already has its Danpa HQ Portfolio"):
            organization_services.create_organization(
                user=applicant,
                data={
                    "name": "Another Portfolio",
                    "organization_type": "individual_owner",
                    "activities": ["residential"],
                },
            )

        assert len(owned_portfolios(applicant)) == 1


class TestTheOwnerEditsWhatDanpaHQProvisioned:
    def test_the_owner_renames_and_retypes_their_portfolio(
        self, registered, sign_in_as, storage, staff
    ):
        from apps.organization import services as organization_services

        applicant = registered("0207770030", first_name="Ama", account_type="provider")
        approve_as_provider(applicant, storage, staff)
        portfolio = organization_services.owned_portfolio(applicant)
        assert portfolio.name == "Ama's Portfolio"

        api = APIClient()
        sign_in_as(api, user=applicant)
        response = api.patch(
            f"/api/v1/organizations/{portfolio.id}/",
            {
                "name": "Ama Property Group",
                "organization_type": "property_company",
                "activities": ["residential", "commercial"],
            },
            format="json",
        )

        assert response.status_code == 200, response.data
        assert response.data["name"] == "Ama Property Group"
        assert response.data["organization_type"] == "property_company"
        assert sorted(response.data["activities"]) == ["commercial", "residential"]
        # Renaming is an edit of the Portfolio they already have, never a new one.
        assert len(owned_portfolios(applicant)) == 1

    def test_a_member_cannot_rename_the_portfolio_they_were_invited_into(
        self, registered, sign_in_as, storage, staff
    ):
        from apps.organization import services as organization_services
        from tests.conftest import upgrade_portfolio

        owner = registered("0207770031", first_name="Serwaa", account_type="provider")
        approve_as_provider(owner, storage, staff)
        portfolio = organization_services.owned_portfolio(owner)
        upgrade_portfolio(portfolio, "BUSINESS")
        member = registered("0207770032", first_name="Kwesi")
        invitation = organization_services.create_invitation(
            organization=portfolio, actor=owner, invitee_phone=member.phone, role="accountant"
        )
        organization_services.accept_invitation(
            invitation=invitation,
            actor=member,
            token=organization_services.invitation_token(invitation),
        )

        api = APIClient()
        sign_in_as(api, user=member)
        response = api.patch(
            f"/api/v1/organizations/{portfolio.id}/", {"name": "Kwesi's"}, format="json"
        )

        assert response.status_code == 403
        portfolio.refresh_from_db()
        assert portfolio.name == "Serwaa's Portfolio"


class TestMembershipIsTheOtherWayIn:
    def test_one_account_owns_one_portfolio_and_joins_the_rest(
        self, registered, sign_in_as, storage, staff
    ):
        """Kwame owns one Portfolio and works in two more, by invitation."""
        from apps.organization import services as organization_services
        from tests.conftest import upgrade_portfolio

        kwame = registered("0207770040", first_name="Kwame", account_type="provider")
        approve_as_provider(kwame, storage, staff)

        for index, (phone, name, role) in enumerate(
            [
                ("0207770041", "Prime Homes Ltd", "property_manager"),
                ("0207770042", "Campus Lodge", "accountant"),
            ]
        ):
            host = registered(phone, first_name=f"Host{index}", account_type="provider")
            approve_as_provider(host, storage, staff)
            portfolio = organization_services.owned_portfolio(host)
            organization_services.update_organization(
                organization=portfolio, actor=host, data={"name": name}
            )
            upgrade_portfolio(portfolio, "BUSINESS")
            invitation = organization_services.create_invitation(
                organization=portfolio, actor=host, invitee_phone=kwame.phone, role=role
            )
            organization_services.accept_invitation(
                invitation=invitation,
                actor=kwame,
                token=organization_services.invitation_token(invitation),
            )

        api = APIClient()
        sign_in_as(api, user=kwame)
        rows = api.get("/api/v1/organizations/").data

        # Three Portfolios to work in, one of them his.
        assert {row["name"] for row in rows} == {
            "Kwame's Portfolio",
            "Prime Homes Ltd",
            "Campus Lodge",
        }
        by_name = {row["name"]: row["current_user_role"] for row in rows}
        assert by_name == {
            "Kwame's Portfolio": "owner",
            "Prime Homes Ltd": "property_manager",
            "Campus Lodge": "accountant",
        }
        owned = owned_portfolios(kwame)
        assert len(owned) == 1
        assert owned[0].name == "Kwame's Portfolio"

    def test_a_member_who_is_never_a_provider_still_owns_nothing(
        self, registered, sign_in_as, storage, staff
    ):
        """Being invited does not provision, and does not need to."""
        from apps.organization import services as organization_services
        from tests.conftest import upgrade_portfolio

        owner = registered("0207770050", first_name="Akosua", account_type="provider")
        approve_as_provider(owner, storage, staff)
        portfolio = organization_services.owned_portfolio(owner)
        upgrade_portfolio(portfolio, "BUSINESS")

        member = registered("0207770051", first_name="Ofori")
        invitation = organization_services.create_invitation(
            organization=portfolio, actor=owner, invitee_phone=member.phone, role="staff"
        )
        organization_services.accept_invitation(
            invitation=invitation,
            actor=member,
            token=organization_services.invitation_token(invitation),
        )

        assert owned_portfolios(member) == []
        api = APIClient()
        sign_in_as(api, user=member)
        rows = api.get("/api/v1/organizations/").data
        assert [row["name"] for row in rows] == ["Akosua's Portfolio"]
        assert rows[0]["current_user_role"] == "staff"
