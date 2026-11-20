"""`/me/` is read on every app start and session refresh; keep it a prepared read."""

from __future__ import annotations

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import serializers
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def provider_with_portfolio(landlord):
    from apps.organization.services import provision_provider_portfolio

    provision_provider_portfolio(user=landlord)
    return landlord


def _me(api):
    with CaptureQueriesContext(connection) as captured:
        response = api.get("/api/v1/me/")
    assert response.status_code == 200, response.data
    return response.data, len(captured)


def test_provider_account_projection_reads_roles_and_checks_once(
    provider_with_portfolio, sign_in_as
):
    api = APIClient()
    sign_in_as(api, user=provider_with_portfolio)

    _, queries = _me(api)

    # It was 34 before roles and verification checks were read once. A small
    # margin leaves room for one more genuinely new fact, not for repeats.
    assert queries <= 16, queries


def test_prepared_projection_matches_the_field_by_field_reads(provider_with_portfolio, user):
    """The prepared read changes how often the database is asked, not the answer."""
    from apps.identity.models import Role, UserRole
    from apps.identity.serializers import MeSerializer

    UserRole.objects.get_or_create(user=user, role=Role.TENANT, revoked_at=None)
    for person in (provider_with_portfolio, user):
        prepared = MeSerializer(person).data
        field_by_field = serializers.ModelSerializer.to_representation(MeSerializer(), person)
        assert prepared == field_by_field


def test_projection_leaves_no_role_snapshot_behind(user):
    """A caller that grants a role after serializing must see the new role."""
    from apps.identity.models import Role, UserRole
    from apps.identity.serializers import MeSerializer

    assert MeSerializer(user).data["roles"]
    UserRole.objects.create(user=user, role=Role.LANDLORD)

    assert Role.LANDLORD in user.roles
    assert user.has_role(Role.LANDLORD)
