"""What a Portfolio may do, and who decides.

The rules this holds are the ones that make monetization safe to change later:

- the **Portfolio** subscribes, never the user;
- a new Portfolio is on Free without anybody being asked for a card;
- the backend decides, and a client cannot talk its way past it;
- two concurrent creations cannot both take the last slot;
- a downgrade **never deletes anything** — it stops growth and nothing else;
- a Portfolio in arrears keeps its leases, its tenants and its money records.

Nothing here compares a plan code inside application logic, because nothing in
the application does.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.billing.models import (
    BillingAccount,
    BillingEvent,
    Entitlement,
    Plan,
    PortfolioPlanOverride,
    Subscription,
    SubscriptionStatus,
)
from apps.billing.services import entitlement_service, subscription_service, usage_service
from apps.core.exceptions import PermissionDenied
from apps.organization import services as organization_services
from apps.property import services as property_services
from tests.conftest import approve_provider_standing, upgrade_portfolio

pytestmark = pytest.mark.django_db


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


def _address(locality_name="Osu", street="1 Test Road"):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name=locality_name)
    return Address.objects.create(locality=locality, street=street)


@pytest.fixture
def portfolio(landlord):
    approve_provider_standing(landlord)
    return organization_services.create_organization(
        user=landlord,
        data={
            "name": "Osu Properties",
            "organization_type": "individual_owner",
            "activities": ["residential"],
        },
    )


def _make_property(landlord, organization, title="Osu block", street="1 Test Road"):
    return property_services.create_private_property(
        user=landlord,
        organization=organization,
        data={
            "title": title,
            "property_type": "residential",
            "address_id": _address(street=street).id,
        },
    )


class TestEveryPortfolioStartsOnFree:
    def test_creating_a_portfolio_creates_its_billing_account_and_free_plan(
        self, landlord, portfolio
    ):
        account = BillingAccount.objects.get(organization=portfolio)
        subscription = Subscription.objects.get(billing_account=account)
        assert subscription.plan.code == "FREE"
        assert subscription.status == SubscriptionStatus.ACTIVE

        # Nobody was asked for a card, and no fake provider subscription exists
        # for a plan nobody pays for.
        assert account.billing_email == ""
        assert subscription.provider == ""
        assert subscription.provider_subscription_reference == ""
        assert subscription.current_period_end is None

    def test_the_portfolio_subscribes_and_not_the_user(self, landlord, registered):
        """One person in two Portfolios; the plan follows the Portfolio.

        One owned and one joined is the only way to be in two — nobody owns a
        second — and the subscription belongs to each Portfolio rather than to
        the person standing in both of them.
        """
        approve_provider_standing(landlord)
        mine = organization_services.provision_provider_portfolio(user=landlord)

        host = registered("0559990077", first_name="Yaa", account_type="provider")
        approve_provider_standing(host)
        theirs = organization_services.provision_provider_portfolio(user=host)
        # Seats to invite with: Free includes the owner and nobody else.
        upgrade_portfolio(theirs, "BUSINESS")
        invitation = organization_services.create_invitation(
            organization=theirs,
            actor=host,
            invitee_phone=landlord.phone,
            role="property_manager",
        )
        organization_services.accept_invitation(
            invitation=invitation,
            actor=landlord,
            token=organization_services.invitation_token(invitation),
        )

        upgrade_portfolio(mine, "PRO")

        assert entitlement_service.current_plan(organization=mine).code == "PRO"
        assert entitlement_service.current_plan(organization=theirs).code == "BUSINESS"

    def test_assignment_is_idempotent(self, landlord, portfolio):
        """A backfill or a repair must not produce a second subscription."""
        subscription_service.ensure_free_subscription(organization=portfolio)
        subscription_service.ensure_free_subscription(organization=portfolio)
        assert Subscription.objects.filter(billing_account__organization=portfolio).count() == 1


class TestLimitsAreEnforcedByTheBackend:
    def test_free_cannot_exceed_its_property_limit(self, landlord, portfolio):
        _make_property(landlord, portfolio, "First", "1 First Road")

        with pytest.raises(entitlement_service.PlanLimitReached) as raised:
            _make_property(landlord, portfolio, "Second", "2 Second Road")

        details = raised.value.details
        assert details["entitlement"] == "PROPERTY_LIMIT"
        assert details["current"] == 1
        assert details["limit"] == 1
        assert details["current_plan"] == "FREE"
        # The cheapest plan that actually clears it, not the dearest.
        assert details["recommended_plan"] == "PRO"

    def test_pro_can_create_within_its_limits(self, landlord, portfolio):
        upgrade_portfolio(portfolio, "PRO")
        for index in range(3):
            _make_property(landlord, portfolio, f"Block {index}", f"{index} Pro Road")
        assert usage_service.property_count(organization=portfolio) == 3

    def test_business_receives_business_capabilities(self, landlord, portfolio):
        upgrade_portfolio(portfolio, "BUSINESS")
        for key in ("BULK_OPERATIONS", "ACCOUNTANT_ACCESS", "PROPERTY_ASSIGNMENTS", "API_ACCESS"):
            assert entitlement_service.can(organization=portfolio, key=key) is True

    def test_free_does_not_receive_paid_capabilities(self, landlord, portfolio):
        for key in ("ADVANCED_REPORTING", "AUTOMATED_RENT_REMINDERS", "TEAM_MANAGEMENT"):
            assert entitlement_service.can(organization=portfolio, key=key) is False

    def test_the_unit_limit_is_enforced_too(self, landlord, portfolio):
        prop = _make_property(landlord, portfolio)
        for index in range(5):
            property_services.add_unit(
                prop=prop,
                user=landlord,
                data={"label": f"Flat {index}", "space_type": "apartment", "bedrooms": 1},
            )
        with pytest.raises(entitlement_service.PlanLimitReached) as raised:
            property_services.add_unit(
                prop=prop,
                user=landlord,
                data={"label": "Flat 6", "space_type": "apartment", "bedrooms": 1},
            )
        assert raised.value.details["entitlement"] == "UNIT_LIMIT"

    def test_a_client_cannot_talk_past_the_backend(self, landlord, portfolio, sign_in_as):
        """The API refuses even when the request looks perfectly ordinary.

        The entitlement snapshot exists so a client can *render* the right
        thing. It is never the boundary, and this is the test that says so.
        """
        from rest_framework.test import APIClient

        _make_property(landlord, portfolio, "First", "1 First Road")
        api = APIClient()
        sign_in_as(api, user=landlord, device_fingerprint="billing-limit")

        response = api.post(
            f"/api/v1/organizations/{portfolio.id}/properties/",
            {
                "title": "Second",
                "property_type": "residential",
                "address_id": str(_address(street="2 Second Road").id),
            },
            format="json",
        )
        assert response.status_code == 409, response.data
        assert response.data["error"]["code"] == "plan_limit_reached"
        assert response.data["error"]["details"]["entitlement"] == "PROPERTY_LIMIT"
        assert response.data["error"]["details"]["recommended_plan"] == "PRO"


class TestDowngradeNeverDeletesAnything:
    def test_going_to_free_keeps_every_property_and_only_stops_growth(self, landlord, portfolio):
        upgrade_portfolio(portfolio, "BUSINESS")
        for index in range(4):
            _make_property(landlord, portfolio, f"Block {index}", f"{index} Keep Road")
        assert usage_service.property_count(organization=portfolio) == 4

        subscription_service.change_plan(
            organization=portfolio, plan_code="FREE", actor=landlord, reason="test downgrade"
        )

        # Nothing was removed.
        assert usage_service.property_count(organization=portfolio) == 4
        # The Portfolio is simply above what its plan includes, and says so.
        exceeded = entitlement_service.over_limit(organization=portfolio)
        assert {row["entitlement"] for row in exceeded} >= {"PROPERTY_LIMIT"}
        # And a fifth is refused rather than a fourth being deleted.
        with pytest.raises(entitlement_service.PlanLimitReached):
            _make_property(landlord, portfolio, "Fifth", "5 Keep Road")

    def test_historical_records_survive_a_downgrade(
        self, landlord, user, portfolio, approve_provider
    ):
        """Leases, rent and receipts are not premium features.

        A provider whose subscription lapsed still has tenants with a legal
        right to their records, and a billing dispute is not a reason to take
        them away.
        """
        from apps.lease import services as lease_services
        from apps.rent import services as rent_services
        from apps.rent.models import RentCharge

        upgrade_portfolio(portfolio, "BUSINESS")
        prop = _make_property(landlord, portfolio)
        space = property_services.add_unit(
            prop=prop,
            user=landlord,
            data={"label": "Flat A", "space_type": "apartment", "bedrooms": 1},
        )
        approve_provider(landlord, prop)
        lease = lease_services.draft_lease(
            user=landlord,
            unit=space,
            tenant=user,
            data={
                "rent_minor": 150000,
                "advance_months": 1,
                "starts_on": date.today(),
                "term_months": 12,
            },
        )
        lease_services.offer_lease(lease=lease, user=landlord)
        lease = lease_services.accept_lease(lease=lease, user=user)
        charges = rent_services.build_schedule(lease)
        assert charges

        subscription_service.change_plan(
            organization=portfolio, plan_code="FREE", actor=landlord, reason="lapsed"
        )

        lease.refresh_from_db()
        assert lease.status == "active"
        assert RentCharge.objects.filter(lease=lease).count() == len(charges)
        ledger = rent_services.closing_financial_summary(lease=lease)
        assert ledger["currency"] == "GHS"


class TestGracePeriodKeepsWhatWasBought:
    def test_a_failed_renewal_does_not_take_the_plan_away(self, landlord, portfolio):
        upgrade_portfolio(portfolio, "PRO")
        subscription = Subscription.objects.get(billing_account__organization=portfolio)
        subscription.status = SubscriptionStatus.GRACE_PERIOD
        subscription.grace_expires_at = timezone.now() + timedelta(days=7)
        subscription.save(update_fields=["status", "grace_expires_at"])

        assert entitlement_service.current_plan(organization=portfolio).code == "PRO"
        assert entitlement_service.can(organization=portfolio, key="ADVANCED_REPORTING") is True

    def test_past_due_falls_back_to_free_without_losing_records(self, landlord, portfolio):
        upgrade_portfolio(portfolio, "PRO")
        prop = _make_property(landlord, portfolio)
        subscription = Subscription.objects.get(billing_account__organization=portfolio)
        subscription.status = SubscriptionStatus.PAST_DUE
        subscription.save(update_fields=["status"])

        # Premium capability closes...
        assert entitlement_service.can(organization=portfolio, key="ADVANCED_REPORTING") is False
        # ...and the property is still there, still theirs.
        prop.refresh_from_db()
        assert usage_service.property_count(organization=portfolio) == 1


class TestOverrides:
    def test_an_override_beats_the_plan_and_is_attributable(self, landlord, portfolio):
        entitlement = Entitlement.objects.get(key="PROPERTY_LIMIT")
        PortfolioPlanOverride.objects.create(
            organization=portfolio,
            entitlement=entitlement,
            value=3,
            reason="Launch cohort",
            created_by=landlord,
        )
        assert entitlement_service.limit(organization=portfolio, key="PROPERTY_LIMIT") == 3
        resolved = entitlement_service.grant(organization=portfolio, key="PROPERTY_LIMIT")
        assert resolved.source == "override"

        for index in range(3):
            _make_property(landlord, portfolio, f"Block {index}", f"{index} Override Road")
        with pytest.raises(entitlement_service.PlanLimitReached):
            _make_property(landlord, portfolio, "Fourth", "4 Override Road")

    def test_an_expired_override_stops_applying(self, landlord, portfolio):
        entitlement = Entitlement.objects.get(key="PROPERTY_LIMIT")
        PortfolioPlanOverride.objects.create(
            organization=portfolio,
            entitlement=entitlement,
            value=5,
            reason="Expired promotion",
            expires_at=timezone.now() - timedelta(days=1),
            created_by=landlord,
        )
        assert entitlement_service.limit(organization=portfolio, key="PROPERTY_LIMIT") == 1

    def test_unlimited_is_a_flag_and_never_a_large_number(self, landlord, portfolio):
        entitlement = Entitlement.objects.get(key="PROPERTY_LIMIT")
        PortfolioPlanOverride.objects.create(
            organization=portfolio,
            entitlement=entitlement,
            is_unlimited=True,
            reason="Negotiated Business terms",
            created_by=landlord,
        )
        assert entitlement_service.limit(organization=portfolio, key="PROPERTY_LIMIT") is None
        for index in range(3):
            _make_property(landlord, portfolio, f"Block {index}", f"{index} Unlimited Road")


class TestBillingPermissions:
    def _api(self, sign_in_as, user, fingerprint):
        from rest_framework.test import APIClient

        api = APIClient()
        sign_in_as(api, user=user, device_fingerprint=fingerprint)
        return api

    def test_an_owner_sees_the_plan_usage_and_limits(self, landlord, portfolio, sign_in_as):
        api = self._api(sign_in_as, landlord, "billing-owner")
        response = api.get(f"/api/v1/organizations/{portfolio.id}/billing/")
        assert response.status_code == 200, response.data
        assert response.data["plan"]["code"] == "FREE"
        assert response.data["limits"]["PROPERTY_LIMIT"] == 1
        assert response.data["usage"]["PROPERTY_COUNT"] == 0
        assert response.data["entitlements"]["ADVANCED_REPORTING"]["value"] is False
        assert response.data["subscription"]["plan"]["code"] == "FREE"
        assert response.data["billing_account"]["status"] == "active"
        assert response.data["history"][0]["event_type"] == "subscription_created"

    def test_a_past_due_paid_subscription_remains_visible_in_billing(
        self, landlord, portfolio, sign_in_as
    ):
        upgrade_portfolio(portfolio, "PRO")
        subscription = Subscription.objects.get(
            billing_account__organization=portfolio,
            status=SubscriptionStatus.ACTIVE,
        )
        subscription.status = SubscriptionStatus.PAST_DUE
        subscription.save(update_fields=["status", "updated_at"])

        api = self._api(sign_in_as, landlord, "billing-past-due")
        response = api.get(f"/api/v1/organizations/{portfolio.id}/billing/")

        assert response.status_code == 200, response.data
        assert response.data["subscription"]["status"] == "past_due"
        assert response.data["subscription"]["plan"]["code"] == "PRO"
        # Past due stops granting premium creation while the historical paid
        # subscription remains visible for recovery and explanation.
        assert response.data["plan"]["code"] == "FREE"

    def test_a_stranger_cannot_read_another_portfolios_billing(
        self, landlord, agent, portfolio, sign_in_as
    ):
        api = self._api(sign_in_as, agent, "billing-stranger")
        response = api.get(f"/api/v1/organizations/{portfolio.id}/billing/")
        assert response.status_code in (403, 404), response.data

    def test_staff_cannot_change_the_plan(self, landlord, agent, portfolio):
        from apps.billing.policies import entitlement_policy
        from apps.organization.models import MembershipRole

        upgrade_portfolio(portfolio, "BUSINESS")
        organization_services.add_membership(
            organization=portfolio, actor=landlord, user=agent, role=MembershipRole.STAFF
        )
        with pytest.raises(PermissionDenied):
            entitlement_policy.assert_can(
                organization=portfolio,
                user=agent,
                permission=entitlement_policy.CHANGE_PLAN,
            )
        assert (
            entitlement_policy.can(
                organization=portfolio, user=agent, permission=entitlement_policy.VIEW
            )
            is False
        )

    def test_an_accountant_reads_billing_but_changes_nothing(self, landlord, agent, portfolio):
        from apps.billing.policies import entitlement_policy
        from apps.organization.models import MembershipRole

        upgrade_portfolio(portfolio, "BUSINESS")
        organization_services.add_membership(
            organization=portfolio, actor=landlord, user=agent, role=MembershipRole.ACCOUNTANT
        )
        assert entitlement_policy.can(
            organization=portfolio, user=agent, permission=entitlement_policy.VIEW
        )
        with pytest.raises(PermissionDenied):
            entitlement_policy.assert_can(
                organization=portfolio,
                user=agent,
                permission=entitlement_policy.CHANGE_PLAN,
            )


class TestTeamSeats:
    def test_free_cannot_invite_because_team_management_is_not_included(self, landlord, portfolio):
        with pytest.raises(entitlement_service.PlanFeatureUnavailable) as raised:
            organization_services.create_invitation(
                organization=portfolio,
                actor=landlord,
                invitee_phone="0247000921",
                role="staff",
            )
        assert raised.value.details["entitlement"] == "TEAM_MANAGEMENT"

    def test_pro_seats_are_counted_including_the_owner(self, landlord, portfolio):
        upgrade_portfolio(portfolio, "PRO")
        assert usage_service.team_member_count(organization=portfolio) == 1
        assert entitlement_service.limit(organization=portfolio, key="TEAM_MEMBER_LIMIT") == 3


class TestAuditAndHistory:
    def test_a_plan_change_writes_both_histories(self, landlord, portfolio):
        from apps.audit.models import AuditLog

        subscription_service.change_plan(
            organization=portfolio, plan_code="PRO", actor=landlord, reason="upgrade"
        )
        event = BillingEvent.objects.filter(event_type="plan_changed").get()
        assert event.from_plan_code == "FREE"
        assert event.to_plan_code == "PRO"
        assert event.actor_id == landlord.id
        assert event.reason == "upgrade"

        assert AuditLog.objects.filter(aggregate_type="billing_subscription").exists()

    def test_billing_events_are_history_and_refuse_editing(self, landlord, portfolio):
        event = BillingEvent.objects.filter(billing_account__organization=portfolio).first()
        assert event is not None
        event.reason = "rewritten"
        with pytest.raises(RuntimeError):
            event.save()
        with pytest.raises(RuntimeError):
            event.delete()


class TestPlanConfiguration:
    def test_exactly_three_plans(self):
        assert sorted(Plan.objects.values_list("code", flat=True)) == [
            "BUSINESS",
            "FREE",
            "PRO",
        ]

    def test_a_plan_code_is_immutable(self):
        plan = Plan.objects.get(code="PRO")
        plan.code = "PREMIUM"
        with pytest.raises(RuntimeError):
            plan.save()

    def test_prices_are_exact_minor_units_and_never_floats(self):
        for plan in Plan.objects.all():
            assert isinstance(plan.monthly_price_minor, int)
            assert not isinstance(plan.monthly_price_minor, bool)
            assert plan.monthly_price_currency == "GHS"
        assert Plan.objects.get(code="FREE").monthly_price_minor == 0

    def test_the_catalogue_is_public_and_priced_from_the_database(self):
        from rest_framework.test import APIClient

        response = APIClient().get("/api/v1/plans/")
        assert response.status_code == 200
        codes = [row["code"] for row in response.data["plans"]]
        assert codes == ["FREE", "PRO", "BUSINESS"]
        free = response.data["plans"][0]
        assert free["monthly_price_minor"] == 0
        assert free["entitlements"]["PROPERTY_LIMIT"]["value"] == 1
        assert free["entitlements"]["PROPERTY_LIMIT"]["unlimited"] is False


def test_no_domain_module_branches_on_a_plan_code():
    """The invariant the whole architecture exists for.

    A plan code appearing in a property, rent, lease or organization service is
    packaging welded into domain logic, and it is how a product ends up unable
    to change its own pricing. Billing may name its plans; nothing else may.
    """
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[2] / "apps"
    pattern = re.compile(r'["\'](FREE|PRO|BUSINESS)["\']')
    offenders = []
    for path in root.rglob("*.py"):
        if "migrations" in path.parts or path.parts[-2:][0] == "billing":
            continue
        if "billing" in path.parts:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if pattern.search(line) and "#" not in line.split('"')[0]:
                offenders.append(f"{path.relative_to(root)}:{number}: {line.strip()}")
    assert not offenders, "plan codes outside billing:\n" + "\n".join(offenders)


class TestSetPlanCommand:
    """The only way to move a Portfolio's plan until the admin screens exist.

    Worth testing precisely because it is the operational back door: a grant
    that skipped the audit trail would be invisible, and "it was only for
    testing" is what every untraceable change was for.
    """

    def _run(self, **kwargs):
        from io import StringIO

        from django.core.management import call_command

        out = StringIO()
        call_command("set_plan", stdout=out, **kwargs)
        return out.getvalue()

    def test_it_moves_the_plan_and_leaves_a_billing_event(self, portfolio):
        from apps.billing.models import BillingEvent
        from apps.billing.services import entitlement_service

        self._run(portfolio=portfolio.name, plan="business", reason="Development testing")

        assert entitlement_service.current_plan(organization=portfolio).code == "BUSINESS"
        event = BillingEvent.objects.filter(
            billing_account__organization=portfolio, to_plan_code="BUSINESS"
        ).first()
        assert event is not None
        assert event.reason == "Development testing"
        assert event.from_plan_code == "FREE"

    def test_it_writes_an_audit_record_even_with_no_signed_in_actor(self, portfolio):
        from apps.audit.models import AuditLog

        self._run(portfolio=portfolio.name, plan="PRO")

        assert AuditLog.objects.filter(aggregate_type="billing_subscription").exists()

    def test_an_unknown_plan_is_refused_by_name(self, portfolio):
        from django.core.management.base import CommandError

        with pytest.raises(CommandError, match="ENTERPRISE"):
            self._run(portfolio=portfolio.name, plan="enterprise")

    def test_a_portfolio_that_does_not_exist_is_refused(self):
        from django.core.management.base import CommandError

        with pytest.raises(CommandError, match="No Portfolio matched"):
            self._run(portfolio="nothing by this name", plan="PRO")

    def test_listing_reports_the_plan_and_the_live_usage(self, portfolio):
        output = self._run(list=True)

        assert portfolio.name in output
        assert "FREE" in output
        assert "PROPERTY_COUNT" in output
