"""Regression coverage for the retired direct-invitation acquisition path."""

from __future__ import annotations

import hashlib
from datetime import date, timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import Gone

pytestmark = pytest.mark.django_db


@pytest.fixture
def historical_invitation(landlord, user, approve_provider, approve_space):
    from apps.geo.models import Address, District, Locality, Region
    from apps.occupancy.models import PropertyInvitation
    from apps.property.models import (
        Property,
        PropertyRelationship,
        PropertyRelationshipType,
        PropertyType,
        Unit,
    )

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Adentan Municipal"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="Adenta"
    )
    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title="Legacy Invite House",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street="1 Legacy Road"),
    )
    PropertyRelationship.objects.create(
        property=prop,
        user=landlord,
        relationship_type=PropertyRelationshipType.OWNER,
        granted_by=landlord,
    )
    approve_provider(landlord, prop)
    unit = Unit.objects.create(
        property=prop,
        label="Main",
        bedrooms=2,
        bathrooms=1,
        space_type="apartment",
    )
    approve_space(unit)
    token = "legacy-token-that-can-no-longer-be-spent"
    invitation = PropertyInvitation.objects.create(
        property=prop,
        unit=unit,
        invitee_phone=user.phone,
        invitee_user=user,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=timezone.now() + timedelta(days=7),
        created_by=landlord,
        status="pending",
    )
    return prop, unit, invitation, token


def test_legacy_invitation_services_are_retired_without_mutating_history(
    historical_invitation, landlord, user
):
    from apps.occupancy import services
    from apps.occupancy.models import PropertyInvitation

    prop, unit, invitation, token = historical_invitation

    with pytest.raises(Gone, match="retired"):
        services.create_invitation(
            actor=landlord,
            prop=prop,
            unit=unit,
            invitee_phone=user.phone,
        )
    with pytest.raises(Gone):
        services.resolve_invitation(user=user, token=token)
    with pytest.raises(Gone):
        services.accept_invitation(user=user, token=token, confirmed=True)
    with pytest.raises(Gone):
        services.decline_invitation(user=user, token=token, confirmed=True)

    invitation.refresh_from_db()
    assert invitation.status == "pending"
    assert PropertyInvitation.objects.count() == 1
    assert not user.tenancies.exists()
    assert not user.occupancies.exists()


def test_legacy_http_mutations_return_gone_but_provider_history_remains_readable(
    historical_invitation, landlord, user, sign_in_as
):
    prop, unit, invitation, token = historical_invitation

    provider_api = APIClient()
    sign_in_as(provider_api, user=landlord)
    history = provider_api.get(f"/api/v1/properties/{prop.id}/invitations/")
    assert history.status_code == 200
    assert [row["id"] for row in history.data] == [str(invitation.id)]

    creation = provider_api.post(
        f"/api/v1/properties/{prop.id}/invitations/",
        {"unit_id": str(unit.id), "phone": user.phone},
        format="json",
    )
    assert creation.status_code == 410
    assert creation.data["error"]["code"] == "gone"

    tenant_api = APIClient()
    sign_in_as(tenant_api, user=user)
    for action in ("resolve", "accept", "decline"):
        response = tenant_api.post(
            f"/api/v1/property-invitations/{action}/",
            {"token": token, "confirmed": True},
            format="json",
        )
        assert response.status_code == 410
        assert response.data["error"]["code"] == "gone"


def test_an_accepted_historical_invitation_cannot_authorize_a_new_lease(
    historical_invitation, landlord, user, sign_in_as
):
    from apps.lease import services as lease_services

    _, unit, invitation, _ = historical_invitation
    invitation.status = "accepted"
    invitation.accepted_at = timezone.now()
    invitation.save(update_fields=["status", "accepted_at", "updated_at"])
    terms = {"rent_minor": 150000, "starts_on": date.today(), "term_months": 12}

    with pytest.raises(Gone, match="tenancy request"):
        lease_services.draft_lease(
            user=landlord,
            unit=unit,
            tenant=user,
            data=terms,
            invitation=invitation,
        )

    api = APIClient()
    sign_in_as(api, user=landlord)
    response = api.post(
        "/api/v1/me/leases/",
        {
            "unit_id": str(unit.id),
            "tenant_id": str(user.id),
            "invitation_id": str(invitation.id),
            "rent_minor": 150000,
            "starts_on": date.today().isoformat(),
            "term_months": 12,
        },
        format="json",
    )
    assert response.status_code == 410
    assert not user.leases_as_tenant.exists()


def test_private_access_converges_on_request_approval_and_lease(
    historical_invitation, landlord, user
):
    from apps.lease import services as lease_services
    from apps.occupancy import services as occupancy_services
    from apps.property import access_codes

    prop, unit, _, _ = historical_invitation
    unit, code = access_codes.rotate(unit=unit, actor=landlord)
    request = occupancy_services.create_join_request(
        user=user,
        prop=prop,
        unit=unit,
        access_code=code,
    )
    request, occupancy = occupancy_services.decide_join_request(
        join_request=request,
        actor=landlord,
        approved=True,
    )
    assert occupancy is None
    assert not user.tenancies.exists()

    lease = lease_services.draft_lease(
        user=landlord,
        unit=unit,
        tenant=user,
        join_request=request,
        data={"rent_minor": 150000, "starts_on": date.today(), "term_months": 12},
    )
    request.refresh_from_db()
    assert request.lease_id == lease.id
    assert lease.status == "draft"
    assert not user.tenancies.exists()


def test_the_unit_read_answers_about_its_own_access_code(
    historical_invitation, landlord, user, sign_in_as
):
    """The provider reads the code from the Unit, not only from a Portfolio.

    `tenant_access` on the Portfolio summary is scoped to organization
    membership, so a provider holding authority over a Property directly saw
    nothing there while their verified Units carried live codes. `GET
    /units/<id>/` is scoped by `is_managed_by` instead, which is the authority
    that actually decides this.
    """
    from apps.organization.models import OrganizationMembership
    from apps.property import access_codes

    _, unit, _, _ = historical_invitation
    assert not OrganizationMembership.objects.filter(user=landlord).exists()

    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {sign_in_as(user=landlord)['access_token']}")

    before = api.get(f"/api/v1/units/{unit.id}/")
    assert before.status_code == 200
    assert before.data["access_code"]["state"] == "not_created"
    assert before.data["access_code"]["can_rotate"] is True
    assert before.data["access_code"]["can_manage"] is True

    access_codes.rotate(unit=unit, actor=landlord)

    after = api.get(f"/api/v1/units/{unit.id}/").data["access_code"]
    assert after["state"] == "active"
    assert after["can_revoke"] is True
    # The readable value is never returned by a read.
    assert "code" not in after


def test_a_control_the_service_would_refuse_is_not_offered(
    historical_invitation, landlord, user, sign_in_as
):
    """`snapshot` answers from the Unit alone and cannot know who is asking.

    The Portfolio read already narrowed `can_rotate` by the `tenant_access`
    capability; the Unit read did not, so the same Unit answered two different
    ways depending on which screen asked.
    """
    from apps.property.capabilities import PropertyCapability, property_capabilities
    from apps.property.serializers import UnitDetailSerializer

    _, unit, _, _ = historical_invitation

    allowed = property_capabilities(prop=unit.property, user=landlord)[
        PropertyCapability.TENANT_ACCESS.value
    ]["allowed"]
    assert allowed is True
    assert (
        UnitDetailSerializer(unit, context={"user": landlord}).data["access_code"]["can_rotate"]
        is True
    )

    # Somebody who does not manage this Property is not offered the control,
    # whatever state the code itself is in.
    stranger = UnitDetailSerializer(unit, context={"user": user}).data["access_code"]
    assert stranger["can_manage"] is False
    assert stranger["can_rotate"] is False
    assert stranger["can_revoke"] is False
