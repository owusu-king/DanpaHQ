"""The Provider Properties list, and the one Portfolio it is about.

Switching Portfolio changes the provider's operational context. A list that
answers "what do I manage" has to answer it for one Portfolio at a time: mixing
a personal Portfolio's houses into a company's roster is not a display problem,
it is a wrong answer about who controls what — and it came from the list
endpoint itself, which returned everything the account could reach and left the
scoping to a page that never applied any.
"""

import pytest
from rest_framework.test import APIClient

from tests.integration.test_portfolio_team import make_portfolio, make_property

pytestmark = pytest.mark.django_db


@pytest.fixture
def scope_address():
    from apps.geo.models import Address, District, Locality, Region

    region = Region.objects.create(name="Greater Accra", code="SCOPE-GA")
    district = District.objects.create(region=region, name="Ayawaso West")
    locality = Locality.objects.create(district=district, name="Osu")
    return Address.objects.create(locality=locality, digital_address="GA-200-3000")


def personal_portfolio(owner, address, *, title="Family House"):
    """The Portfolio an individual gets with their first Property."""
    from apps.organization.models import OrganizationPropertyRelationship
    from apps.property import services
    from tests.conftest import approve_provider_standing

    approve_provider_standing(owner)
    prop = services.create_personal_property(
        user=owner,
        data={"title": title, "property_type": "residential", "address_id": address.id},
    )
    relationship = OrganizationPropertyRelationship.objects.get(property=prop, ended_at=None)
    return relationship.organization, prop


def joined_portfolio(host, member, address, *, title, role="property_manager"):
    """A Portfolio somebody else owns, with this person invited into it.

    The only way to be in two Portfolios. Nobody owns two: an account is
    provisioned exactly one when its provider access is approved, so every
    other Portfolio on somebody's list arrived as an invitation.
    """
    from apps.organization import services as organization_services

    company = make_portfolio(host)
    prop = make_property(host, company, address, title=title)
    membership = organization_services.add_membership(
        organization=company, actor=host, user=member, role=role
    )
    if role in {"property_manager", "staff"}:
        organization_services.assign_property(
            organization=company, property=prop, membership=membership, actor=host
        )
    return company, prop


def ids(response):
    assert response.status_code == 200, response.data
    return {row["id"] for row in response.data}


class TestPropertyListPortfolioScope:
    def test_switching_portfolio_changes_the_whole_list(
        self, registered, sign_in_as, scope_address
    ):
        """One person, two Portfolios, and never both at once.

        One Portfolio is theirs and the other they were invited into, which is
        the only shape this can take — an account is provisioned one Portfolio
        and can never create a second.
        """
        owner = registered("0203100001", first_name="Owner", account_type="provider")
        host = registered("0203100021", first_name="Host", account_type="provider")
        personal, house = personal_portfolio(owner, scope_address)
        company, block = joined_portfolio(
            host, owner, scope_address, title="Kente Block", role="admin"
        )
        api = APIClient()
        sign_in_as(api, user=owner)

        personal_view = api.get(f"/api/v1/properties/?organization={personal.id}")
        company_view = api.get(f"/api/v1/properties/?organization={company.id}")

        assert ids(personal_view) == {str(house.id)}
        assert ids(company_view) == {str(block.id)}
        # Nothing from the Portfolio they left survives the switch.
        assert ids(personal_view).isdisjoint(ids(company_view))
        # The account-wide list still exists, and is deliberately not a
        # Portfolio view: "what do I have" is a different question from "what am
        # I operating right now", and only the second one has a Portfolio in it.
        assert ids(api.get("/api/v1/properties/")) == {str(house.id), str(block.id)}

    def test_a_company_portfolio_never_shows_the_owners_personal_property(
        self, registered, sign_in_as, scope_address
    ):
        # A provider with a house of their own who also manages for a company.
        # The company's roster is the company's: their own house is not in it,
        # and the company's block is not in their Portfolio either.
        manager = registered("0203100002", first_name="Manager", account_type="provider")
        host = registered("0203100003", first_name="Host", account_type="provider")
        personal, house = personal_portfolio(manager, scope_address, title="Manager's Own House")
        company, block = joined_portfolio(
            host, manager, scope_address, title="Company Block", role="property_manager"
        )
        manager_api = APIClient()
        sign_in_as(manager_api, user=manager)

        scoped = manager_api.get(f"/api/v1/properties/?organization={company.id}")

        assert ids(scoped) == {str(block.id)}
        assert str(house.id) not in ids(scoped)
        assert ids(manager_api.get(f"/api/v1/properties/?organization={personal.id}")) == {
            str(house.id)
        }
        # The account-wide list is the only place both appear, and it is
        # deliberately not a Portfolio view.
        assert ids(manager_api.get("/api/v1/properties/")) == {str(block.id), str(house.id)}

    def test_owner_and_admin_see_the_portfolio_and_a_manager_sees_assignments(
        self, registered, sign_in_as, scope_address
    ):
        from apps.organization import services as organization_services

        owner = registered("0203100004", first_name="Owner", account_type="provider")
        admin = registered("0203100005", first_name="Admin")
        manager = registered("0203100006", first_name="Manager")
        company = make_portfolio(owner)
        first = make_property(owner, company, scope_address, title="First Block")
        second = make_property(owner, company, scope_address, title="Second Block")
        organization_services.add_membership(
            organization=company, actor=owner, user=admin, role="admin"
        )
        membership = organization_services.add_membership(
            organization=company, actor=owner, user=manager, role="property_manager"
        )
        organization_services.assign_property(
            organization=company, property=first, membership=membership, actor=owner
        )
        scoped = f"/api/v1/properties/?organization={company.id}"
        owner_api, admin_api, manager_api = APIClient(), APIClient(), APIClient()
        sign_in_as(owner_api, user=owner)
        sign_in_as(admin_api, user=admin)
        sign_in_as(manager_api, user=manager)

        assert ids(owner_api.get(scoped)) == {str(first.id), str(second.id)}
        assert ids(admin_api.get(scoped)) == {str(first.id), str(second.id)}
        # Assignment is the manager's whole scope, in the Portfolio's own list
        # and in the account-wide one.
        assert ids(manager_api.get(scoped)) == {str(first.id)}
        assert ids(manager_api.get("/api/v1/properties/")) == {str(first.id)}

        organization_services.assign_property(
            organization=company, property=second, membership=membership, actor=owner
        )

        assert ids(manager_api.get(scoped)) == {str(first.id), str(second.id)}

    def test_asking_for_someone_elses_portfolio_is_refused(
        self, registered, sign_in_as, scope_address
    ):
        """The scope is decided here, so naming another Portfolio buys nothing."""
        owner = registered("0203100007", first_name="Owner", account_type="provider")
        stranger = registered("0203100008", first_name="Stranger", account_type="provider")
        company = make_portfolio(owner)
        make_property(owner, company, scope_address, title="Private Block")
        other = make_portfolio(stranger)
        other_block = make_property(stranger, other, scope_address, title="Other Block")
        api = APIClient()
        sign_in_as(api, user=owner)

        assert api.get(f"/api/v1/properties/?organization={other.id}").status_code == 404
        assert api.get(f"/api/v1/organizations/{other.id}/properties/").status_code == 404
        # A malformed id is the same answer, not a different error.
        assert api.get("/api/v1/properties/?organization=not-a-portfolio").status_code == 404
        # And the account-wide list never reached into it either.
        assert str(other_block.id) not in ids(api.get("/api/v1/properties/"))

    def test_a_revoked_member_loses_the_portfolio_list(self, registered, sign_in_as, scope_address):
        from apps.organization import services as organization_services

        owner = registered("0203100009", first_name="Owner", account_type="provider")
        manager = registered("0203100010", first_name="Manager")
        company = make_portfolio(owner)
        block = make_property(owner, company, scope_address, title="Managed Block")
        membership = organization_services.add_membership(
            organization=company, actor=owner, user=manager, role="property_manager"
        )
        organization_services.assign_property(
            organization=company, property=block, membership=membership, actor=owner
        )
        manager_api = APIClient()
        sign_in_as(manager_api, user=manager)
        scoped = f"/api/v1/properties/?organization={company.id}"
        assert ids(manager_api.get(scoped)) == {str(block.id)}

        organization_services.remove_membership(
            organization=company, membership=membership, actor=owner, reason="Contract ended"
        )

        # Not an empty Portfolio: no Portfolio. A stale id in a client's storage
        # cannot keep the list alive once the membership has ended.
        assert manager_api.get(scoped).status_code == 404
        assert manager_api.get("/api/v1/properties/").data == []


def stock_portfolio(owner, address, *, title):
    """A Portfolio with one Property, one Unit and one live listing on it."""
    from apps.listing.models import Listing, ListingStatus
    from apps.property.models import Unit

    organization = make_portfolio(owner)
    prop = make_property(owner, organization, address, title=title)
    unit = Unit.objects.create(property=prop, label=f"{title} Flat", bedrooms=1, bathrooms=1)
    listing = Listing.objects.create(
        unit=unit,
        created_by=owner,
        status=ListingStatus.ACTIVE,
        rent_minor=120000,
        headline=f"{title} listing",
        description="Prepaid meter, tiled floor.",
        locality_id_cache=address.locality_id,
        bedrooms_cache=1,
    )
    return organization, prop, unit, listing


class TestProviderListsFollowThePortfolio:
    """Everything hanging off a Property belongs to that Property's Portfolio.

    Agreements are granted on a Unit, viewings are asked of a listing, tenancy
    requests are to move into a room. Each of those lists asked for everything
    the account could reach, so a provider operating one Portfolio decided
    things belonging to another — and the counts on Home were drawn from both.
    """

    def _lease(self, *, owner, tenant, unit, listing):
        from django.utils import timezone

        from apps.lease.models import Lease, LeaseStatus

        return Lease.objects.create(
            unit=unit,
            listing=listing,
            tenant=tenant,
            landlord=owner,
            status=LeaseStatus.DRAFT,
            rent_minor=listing.rent_minor,
            rent_currency="GHS",
            starts_on=timezone.now().date(),
        )

    def _application(self, *, tenant, unit, listing):
        from apps.application.models import ApplicationStatus, RentalApplication

        return RentalApplication.objects.create(
            listing=listing,
            unit=unit,
            tenant=tenant,
            status=ApplicationStatus.SUBMITTED,
        )

    def test_agreements_viewings_and_applications_are_scoped_to_one_portfolio(
        self, registered, sign_in_as, scope_address
    ):
        from apps.organization import services as organization_services
        from apps.viewing import services as viewing_services

        owner = registered("0203100011", first_name="Owner", account_type="provider")
        tenant = registered("0203100012", first_name="Tenant")
        host = registered("0203100022", first_name="Host", account_type="provider")
        first_org, _, first_unit, first_listing = stock_portfolio(
            owner, scope_address, title="First"
        )
        # The second Portfolio is the host's, and this provider works in it as
        # an administrator — one owned, one joined.
        second_org, _, second_unit, second_listing = stock_portfolio(
            host, scope_address, title="Second"
        )
        organization_services.add_membership(
            organization=second_org, actor=host, user=owner, role="admin"
        )
        first = {
            "viewing": viewing_services.request_viewing(listing=first_listing, tenant=tenant),
            "application": self._application(tenant=tenant, unit=first_unit, listing=first_listing),
            "lease": self._lease(
                owner=owner, tenant=tenant, unit=first_unit, listing=first_listing
            ),
        }
        second = {
            "viewing": viewing_services.request_viewing(listing=second_listing, tenant=tenant),
            "application": self._application(
                tenant=tenant, unit=second_unit, listing=second_listing
            ),
            "lease": self._lease(
                owner=host, tenant=tenant, unit=second_unit, listing=second_listing
            ),
        }
        api = APIClient()
        sign_in_as(api, user=owner)

        paths = {
            "viewing": "/api/v1/me/viewing-requests/",
            "application": "/api/v1/me/received-applications/",
            "lease": "/api/v1/me/granted-leases/",
        }
        for kind, path in paths.items():
            in_first = ids(api.get(f"{path}?organization={first_org.id}"))
            in_second = ids(api.get(f"{path}?organization={second_org.id}"))

            assert in_first == {str(first[kind].id)}, kind
            assert in_second == {str(second[kind].id)}, kind
            assert in_first.isdisjoint(in_second), kind
            # Unscoped stays the account-wide answer, which is not a Portfolio.
            assert ids(api.get(path)) == {str(first[kind].id), str(second[kind].id)}, kind

    def test_a_member_sees_only_their_own_portfolios_records(
        self, registered, sign_in_as, scope_address
    ):
        from apps.organization import services as organization_services
        from apps.viewing import services as viewing_services

        owner = registered("0203100013", first_name="Owner", account_type="provider")
        tenant = registered("0203100014", first_name="Tenant")
        manager = registered("0203100015", first_name="Manager")
        stranger = registered("0203100023", first_name="Stranger", account_type="provider")
        company, company_property, company_unit, company_listing = stock_portfolio(
            owner, scope_address, title="Company"
        )
        other_org, _, other_unit, other_listing = stock_portfolio(
            stranger, scope_address, title="Elsewhere"
        )
        company_viewing = viewing_services.request_viewing(listing=company_listing, tenant=tenant)
        viewing_services.request_viewing(listing=other_listing, tenant=tenant)
        company_lease = self._lease(
            owner=owner, tenant=tenant, unit=company_unit, listing=company_listing
        )
        self._lease(owner=stranger, tenant=tenant, unit=other_unit, listing=other_listing)
        membership = organization_services.add_membership(
            organization=company, actor=owner, user=manager, role="property_manager"
        )
        organization_services.assign_property(
            organization=company,
            property=company_property,
            membership=membership,
            actor=owner,
        )
        manager_api = APIClient()
        sign_in_as(manager_api, user=manager)

        assert ids(manager_api.get(f"/api/v1/me/viewing-requests/?organization={company.id}")) == {
            str(company_viewing.id)
        }
        assert ids(manager_api.get(f"/api/v1/me/granted-leases/?organization={company.id}")) == {
            str(company_lease.id)
        }
        # The other Portfolio is not an empty list to them; it is not theirs.
        assert (
            manager_api.get(f"/api/v1/me/granted-leases/?organization={other_org.id}").status_code
            == 404
        )
        assert (
            manager_api.get(f"/api/v1/me/viewing-requests/?organization={other_org.id}").status_code
            == 404
        )
        assert (
            manager_api.get(
                f"/api/v1/me/received-applications/?organization={other_org.id}"
            ).status_code
            == 404
        )
