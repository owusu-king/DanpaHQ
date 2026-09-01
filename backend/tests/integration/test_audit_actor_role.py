"""An actor with no role is audited as having none, not as a crash.

`User.primary_role` returns None for somebody holding no role — deliberately,
because no grant means no role, and pretending it means "tenant" would make an
interrupted onboarding indistinguishable from a completed one.

`AuditLog.actor_role` is a `CharField(blank=True)`, so its column is NOT NULL
with `""` as the empty value. Nothing converted between the two, so the nullable
domain value travelled through the request context into the audit insert and
raised a NOT NULL violation — which the API turned into a 409, telling people
their sign-in had been changed by somebody else.
"""

import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.core.context import RequestContext

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


class TestTheContextNormalises:
    def test_a_none_role_becomes_an_empty_string(self):
        """The type says `str`. A `str` field that sometimes holds None is a bug
        waiting for its next call site, so it is fixed where every context is
        built rather than at each place one is read."""
        assert RequestContext(actor_role=None).actor_role == ""

    def test_a_real_role_is_left_alone(self):
        assert RequestContext(actor_role="landlord").actor_role == "landlord"

    def test_the_default_is_already_empty(self):
        assert RequestContext().actor_role == ""


class TestSigningIn:
    def test_a_user_with_no_role_can_sign_in(self, api, db):
        """The reported failure. Signing in before onboarding grants any role."""
        from apps.identity.models import User

        user = User.objects.create_user(
            phone="+233209800001", first_name="Roleless", last_name="Person"
        )
        user.mark_phone_verified()
        user.account_type = "tenant"
        user.set_password("Correct!Horse9")
        user.save(update_fields=["account_type", "password"])

        assert user.primary_role is None, "the precondition this test exists for"

        response = api.post(
            "/api/v1/auth/sign-in/",
            {"phone": "0209800001", "password": "Correct!Horse9"},
            format="json",
        )

        assert response.status_code == 200, response.data
        # Specifically not 409: the audit insert used to fail and surface as
        # "Someone else changed this while you were working."
        assert response.status_code != 409

    def test_the_entry_records_that_they_held_no_role(self, api, db):
        """An empty role is a true statement, not a missing one."""
        from apps.identity.models import User

        user = User.objects.create_user(
            phone="+233209800002", first_name="Also", last_name="Roleless"
        )
        user.mark_phone_verified()
        user.account_type = "tenant"
        user.set_password("Correct!Horse9")
        user.save(update_fields=["account_type", "password"])

        api.post(
            "/api/v1/auth/sign-in/",
            {"phone": "0209800002", "password": "Correct!Horse9"},
            format="json",
        )

        entries = AuditLog.objects.filter(actor=user)
        assert entries.exists(), "signing in should be audited"
        assert all(entry.actor_role == "" for entry in entries)

    def test_a_user_who_holds_a_role_has_it_recorded(self, api, db):
        from apps.identity.models import Role, User
        from apps.identity.services import grant_role

        user = User.objects.create_user(phone="+233209800003", first_name="Ama", last_name="Tenant")
        user.mark_phone_verified()
        user.account_type = "tenant"
        user.set_password("Correct!Horse9")
        user.save(update_fields=["account_type", "password"])
        grant_role(user=user, role=Role.TENANT, granted_by=user)

        api.post(
            "/api/v1/auth/sign-in/",
            {"phone": "0209800003", "password": "Correct!Horse9"},
            format="json",
        )

        entry = AuditLog.objects.filter(actor=user).order_by("-id").first()
        assert entry is not None
        assert entry.actor_role == Role.TENANT


class TestCreatingAProperty:
    def test_a_property_is_created_and_audited(self, api, sign_in_as, landlord, db):
        """The other reported failure. Property creation writes an audit entry,
        and did so with whatever role the context happened to hold."""
        from apps.geo.models import Address, District, Locality, Region
        from apps.organization import services as org_services
        from tests.conftest import approve_provider_standing

        region = Region.objects.first() or Region.objects.create(name="Greater Accra")
        district = District.objects.filter(region=region).first() or District.objects.create(
            region=region, name="Adentan Municipal"
        )
        locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
            district=district, name="Adenta"
        )
        address = Address.objects.create(locality=locality, street="4 Audit Road")

        approve_provider_standing(landlord)
        organization = org_services.create_organization(
            user=landlord,
            data={
                "name": "Audit Properties",
                "organization_type": "individual_owner",
                "activities": ["residential"],
            },
        )

        sign_in_as(api, user=landlord)
        response = api.post(
            f"/api/v1/organizations/{organization.id}/properties/",
            {
                "title": "Audited Court",
                "property_type": "residential",
                "address_id": str(address.id),
            },
            format="json",
        )

        assert response.status_code in (200, 201), response.data
        assert response.status_code != 409

        entry = AuditLog.objects.filter(aggregate_type="property").order_by("-id").first()
        assert entry is not None
        # Never None: the column is NOT NULL, and the insert used to violate it.
        assert entry.actor_role is not None


class TestEveryEntryEverWritten:
    def test_no_audit_row_holds_a_null_role(self, api, sign_in_as, user, db):
        """A sweep rather than one case.

        `record` is called from every domain service, so the guarantee worth
        asserting is about the table, not about one endpoint.
        """
        sign_in_as(api, user=user)
        api.get("/api/v1/me/")

        assert not AuditLog.objects.filter(actor_role__isnull=True).exists()
