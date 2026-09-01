"""Consumer and operations authentication must never be interchangeable."""

from datetime import timedelta

import pytest
from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework.test import APIClient

from apps.identity import services
from apps.identity.models import Session, User

pytestmark = pytest.mark.django_db


def make_staff(*, email_verified=True, superuser=False):
    return User.objects.create_user(
        phone="0500000099",
        email="reviewer@example.com",
        password="a-long-operations-password",
        is_staff=True,
        is_superuser=superuser,
        is_email_verified=email_verified,
    )


def test_verified_superuser_can_authenticate_with_admin_email_and_password():
    staff = make_staff(superuser=True)

    authenticated = authenticate(
        username="REVIEWER@example.com", password="a-long-operations-password"
    )

    assert authenticated == staff


def test_consumer_password_never_grants_operations_authentication():
    User.objects.create_user(
        phone="0200000099",
        email="consumer@example.com",
        password="a-long-consumer-password",
        is_email_verified=True,
    )

    assert (
        authenticate(username="consumer@example.com", password="a-long-consumer-password") is None
    )


def test_unverified_staff_email_is_rejected():
    make_staff(email_verified=False)

    assert (
        authenticate(username="reviewer@example.com", password="a-long-operations-password") is None
    )


def test_legacy_operations_review_api_is_removed():
    staff = make_staff()
    session = Session.objects.create(
        user=staff,
        refresh_token_hash="not-used-by-this-test",
        expires_at=timezone.now() + timedelta(days=1),
    )
    token = services.issue_access_token(staff, session)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    assert client.get("/api/v1/trust/review/queue/").status_code == 404


def test_non_super_staff_cannot_create_a_django_admin_session():
    make_staff()
    client = APIClient()
    assert not client.login(username="reviewer@example.com", password="a-long-operations-password")
