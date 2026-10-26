"""The console's billing surface.

Reading is support work; changing what somebody pays for is not. That split is
the point of these tests — a support admin who could silently upgrade a customer
is a support admin who could silently give away the product.
"""

import pytest
from rest_framework.test import APIClient

from apps.operations.models import ManagementRole, ManagementUser

pytestmark = pytest.mark.django_db

PASSWORD = "correct-horse-battery-staple"


def management_user(role=ManagementRole.OPERATIONS_ADMIN, email="ops@example.com"):
    user = ManagementUser(
        email=email,
        first_name="Akua",
        last_name="Mensah",
        role=role,
        is_active=True,
        must_change_password=False,
    )
    user.set_password(PASSWORD)
    user.save()
    return user


def signed_in_client(user):
    client = APIClient()
    response = client.post(
        "/api/v1/management/auth/login/",
        {"email": user.email, "password": PASSWORD},
        format="json",
        HTTP_ORIGIN="http://localhost:3000",
    )
    assert response.status_code == 200
    client.credentials(HTTP_X_MANAGEMENT_CSRF=response.data["csrf_token"])
    return client


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


@pytest.fixture
def portfolio(landlord):
    from apps.organization import services as organization_services
    from tests.conftest import approve_provider_standing

    approve_provider_standing(landlord)
    return organization_services.create_organization(
        user=landlord,
        data={
            "name": "Osu Properties",
            "organization_type": "individual_owner",
            "activities": ["residential"],
        },
    )


class TestReading:
    def test_the_list_shows_the_plan_beside_what_is_actually_used(self, portfolio):
        client = signed_in_client(management_user())

        response = client.get("/api/v1/management/billing/")

        assert response.status_code == 200
        row = next(r for r in response.data["results"] if r["id"] == str(portfolio.id))
        assert row["plan_code"] == "FREE"
        assert row["usage"]["PROPERTY_COUNT"] == 0
        assert row["limits"]["PROPERTY_LIMIT"] == 1
        assert row["over_limit"] == []

    def test_a_portfolio_over_its_limit_says_so(self, portfolio, landlord, address):
        from apps.billing.services import subscription_service
        from apps.property import services as property_services

        subscription_service.change_plan(
            organization=portfolio, plan_code="BUSINESS", actor=landlord, reason="headroom"
        )
        for index in range(2):
            property_services.create_private_property(
                user=landlord,
                organization=portfolio,
                data={
                    "title": f"Block {index}",
                    "property_type": "residential",
                    "address_id": address.id,
                },
            )
        subscription_service.change_plan(
            organization=portfolio, plan_code="FREE", actor=landlord, reason="downgrade"
        )

        client = signed_in_client(management_user())
        response = client.get("/api/v1/management/billing/")

        row = next(r for r in response.data["results"] if r["id"] == str(portfolio.id))
        # Two properties on a one-property plan. Nothing was deleted; the
        # console describes the state rather than treating it as an error.
        assert row["over_limit"] == [{"entitlement": "PROPERTY_LIMIT", "current": 2, "limit": 1}]

    def test_the_detail_carries_the_snapshot_and_the_plan_history(self, portfolio, landlord):
        from apps.billing.services import subscription_service

        subscription_service.change_plan(
            organization=portfolio, plan_code="PRO", actor=landlord, reason="customer asked"
        )
        client = signed_in_client(management_user())

        response = client.get(f"/api/v1/management/billing/{portfolio.id}/")

        assert response.status_code == 200
        assert response.data["billing"]["plan"]["code"] == "PRO"
        history = response.data["events"]
        assert [event["to_plan_code"] for event in history] == ["PRO", "FREE"]
        assert history[0]["reason"] == "customer asked"

    def test_a_portfolio_that_does_not_exist_is_a_404(self):
        client = signed_in_client(management_user())

        response = client.get("/api/v1/management/billing/01a00000-0000-7000-8000-000000000000/")

        assert response.status_code == 404

    def test_filtering_by_plan_narrows_the_list(self, portfolio):
        client = signed_in_client(management_user())

        assert any(
            row["id"] == str(portfolio.id)
            for row in client.get("/api/v1/management/billing/?plan=FREE").data["results"]
        )
        assert not any(
            row["id"] == str(portfolio.id)
            for row in client.get("/api/v1/management/billing/?plan=BUSINESS").data["results"]
        )


class TestChangingThePlan:
    def test_an_operations_admin_can_and_it_is_attributed_to_them(self, portfolio):
        from apps.billing.models import BillingEvent
        from apps.billing.services import entitlement_service

        actor = management_user()
        client = signed_in_client(actor)

        response = client.post(
            f"/api/v1/management/billing/{portfolio.id}/plan/",
            {"plan_code": "business", "reason": "Migrated from the old system"},
            format="json",
        )

        assert response.status_code == 200
        assert entitlement_service.current_plan(organization=portfolio).code == "BUSINESS"
        event = BillingEvent.objects.filter(to_plan_code="BUSINESS").first()
        # Nobody signed in as the customer did this, and the trail says so
        # rather than putting the owner's name against a staff action.
        assert event.actor_id is None
        assert event.actor_management_id == actor.id
        assert event.reason == "Migrated from the old system"

    def test_it_writes_a_management_attributed_audit_record(self, portfolio):
        from apps.audit.models import AuditLog

        actor = management_user()
        client = signed_in_client(actor)

        client.post(
            f"/api/v1/management/billing/{portfolio.id}/plan/",
            {"plan_code": "PRO", "reason": "Support grant"},
            format="json",
        )

        entry = AuditLog.objects.filter(aggregate_type="billing_subscription").first()
        assert entry.management_actor_id == actor.id

    def test_a_support_admin_may_read_but_never_change(self, portfolio):
        from apps.billing.services import entitlement_service

        client = signed_in_client(
            management_user(role=ManagementRole.SUPPORT_ADMIN, email="support@example.com")
        )

        assert client.get("/api/v1/management/billing/").status_code == 200

        response = client.post(
            f"/api/v1/management/billing/{portfolio.id}/plan/",
            {"plan_code": "BUSINESS", "reason": "trying it on"},
            format="json",
        )

        assert response.status_code == 403
        assert entitlement_service.current_plan(organization=portfolio).code == "FREE"

    def test_a_reason_is_required(self, portfolio):
        client = signed_in_client(management_user())

        response = client.post(
            f"/api/v1/management/billing/{portfolio.id}/plan/",
            {"plan_code": "BUSINESS", "reason": "   "},
            format="json",
        )

        assert response.status_code == 409

    def test_an_unknown_plan_is_refused(self, portfolio):
        client = signed_in_client(management_user())

        response = client.post(
            f"/api/v1/management/billing/{portfolio.id}/plan/",
            {"plan_code": "ENTERPRISE", "reason": "wishful thinking"},
            format="json",
        )

        assert response.status_code == 422

    def test_signed_out_reaches_nothing(self, portfolio):
        client = APIClient()

        assert client.get("/api/v1/management/billing/").status_code in (401, 403)
        assert client.post(
            f"/api/v1/management/billing/{portfolio.id}/plan/",
            {"plan_code": "BUSINESS", "reason": "no"},
            format="json",
        ).status_code in (401, 403)


def test_downgrading_from_the_console_deletes_nothing(portfolio, landlord, address):
    """The invariant, exercised through the surface a person actually uses.

    A console with a plan dropdown is exactly where somebody would discover
    that downgrading destroys data, so it is worth proving here and not only
    in the service tests.
    """
    from apps.billing.services import subscription_service
    from apps.property import services as property_services
    from apps.property.models import Property

    subscription_service.change_plan(
        organization=portfolio, plan_code="BUSINESS", actor=landlord, reason="setup"
    )
    for index in range(3):
        property_services.create_private_property(
            user=landlord,
            organization=portfolio,
            data={
                "title": f"Block {index}",
                "property_type": "residential",
                "address_id": address.id,
            },
        )
    before = set(Property.objects.values_list("id", flat=True))

    client = signed_in_client(management_user())
    response = client.post(
        f"/api/v1/management/billing/{portfolio.id}/plan/",
        {"plan_code": "FREE", "reason": "Customer cancelled"},
        format="json",
    )

    assert response.status_code == 200
    assert set(Property.objects.values_list("id", flat=True)) == before
