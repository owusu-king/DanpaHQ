"""Consumer and operations authentication must never be interchangeable."""

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import authenticate
from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.identity import services
from apps.identity.admin_auth import (
    ADMIN_EMAIL_MAX_LENGTH,
    ADMIN_LOGIN_MAX_PER_ADDRESS,
    ADMIN_LOGIN_MAX_PER_EMAIL,
    AdminEmailAuthenticationForm,
    AdminEmailBackend,
)
from apps.identity.models import Session, User
from tests.conftest import TEST_PASSWORD

pytestmark = pytest.mark.django_db

ADMIN_PASSWORD = "a-long-operations-password"


def make_staff(
    *,
    email="reviewer@example.com",
    email_verified=True,
    active=True,
    staff=True,
    superuser=False,
):
    return User.objects.create_user(
        phone="0500000099",
        email=email,
        password=ADMIN_PASSWORD,
        is_active=active,
        is_staff=staff,
        is_superuser=superuser,
        is_email_verified=email_verified,
    )


def test_verified_superuser_can_authenticate_with_admin_email_and_password():
    staff = make_staff(superuser=True)

    authenticated = authenticate(username="REVIEWER@example.com", password=ADMIN_PASSWORD)

    assert authenticated == staff


def test_admin_login_page_accepts_and_submits_a_254_character_email(client):
    email = f"{'a' * 64}@{'b' * 63}.{'c' * 63}.{'d' * 61}"
    assert len(email) == ADMIN_EMAIL_MAX_LENGTH
    staff = make_staff(email=email, superuser=True)

    page = client.get(reverse("admin:login"))

    assert page.status_code == 200
    assert b'type="email"' in page.content
    assert b'maxlength="254"' in page.content
    assert b'maxlength="16"' not in page.content

    response = client.post(
        reverse("admin:login"),
        {
            "username": email,
            "password": ADMIN_PASSWORD,
            "next": reverse("admin:index"),
        },
    )

    assert response.status_code == 302
    assert response.url == reverse("admin:index")
    assert client.session["_auth_user_id"] == str(staff.pk)


def test_admin_email_form_enforces_the_same_254_character_limit_server_side():
    form = AdminEmailAuthenticationForm()
    too_long = AdminEmailAuthenticationForm(
        data={
            "username": f"{'a' * 64}@{'b' * 63}.{'c' * 63}.{'d' * 62}",
            "password": ADMIN_PASSWORD,
        }
    )

    assert form.fields["username"].max_length == ADMIN_EMAIL_MAX_LENGTH
    assert form.fields["username"].widget.attrs["maxlength"] == ADMIN_EMAIL_MAX_LENGTH
    assert not too_long.is_valid()
    assert too_long.errors.as_data()["username"][0].code == "max_length"


def test_incorrect_admin_password_is_rejected(client):
    make_staff(superuser=True)

    response = client.post(
        reverse("admin:login"),
        {"username": "reviewer@example.com", "password": "not-the-password"},
    )

    assert response.status_code == 200
    assert "_auth_user_id" not in client.session


def test_unknown_admin_email_is_rejected_with_the_generic_failure_and_a_dummy_hash(client):
    make_staff(superuser=True)
    wrong_password = client.post(
        reverse("admin:login"),
        {"username": "reviewer@example.com", "password": "not-the-password"},
    )
    unknown_email = client.post(
        reverse("admin:login"),
        {"username": "unknown@example.com", "password": "not-the-password"},
    )

    assert wrong_password.status_code == unknown_email.status_code == 200
    assert wrong_password.context["form"].non_field_errors() == unknown_email.context[
        "form"
    ].non_field_errors()
    with patch.object(User, "set_password", autospec=True) as dummy_hash:
        assert authenticate(username="nobody@example.com", password="not-the-password") is None
    dummy_hash.assert_called_once()


def test_inactive_superuser_cannot_authenticate():
    make_staff(active=False, superuser=True)

    assert authenticate(username="reviewer@example.com", password=ADMIN_PASSWORD) is None


@pytest.mark.parametrize("stored_email", [None, "not-an-email"])
def test_superuser_without_a_valid_email_cannot_authenticate_by_email_or_phone(stored_email):
    make_staff(email=stored_email, superuser=True)

    assert authenticate(username="reviewer@example.com", password=ADMIN_PASSWORD) is None
    assert authenticate(username=stored_email, password=ADMIN_PASSWORD) is None
    assert authenticate(username="0500000099", password=ADMIN_PASSWORD) is None


def test_consumer_phone_and_password_authentication_remains_functional(user):
    result = services.sign_in_with_password(
        raw_phone=user.phone,
        password=TEST_PASSWORD,
        device_fingerprint="admin-auth-regression-test",
    )

    assert result["user"] == user
    assert result["created"] is False


def test_admin_authentication_requires_both_staff_and_superuser_flags():
    make_staff(staff=False, superuser=True)

    assert authenticate(username="reviewer@example.com", password=ADMIN_PASSWORD) is None


def test_existing_superuser_logs_in_without_recreation(client):
    existing = User.objects.create_superuser(
        phone="0500000088",
        email="existing@example.com",
        password=ADMIN_PASSWORD,
    )

    assert client.login(username="existing@example.com", password=ADMIN_PASSWORD)
    assert User.objects.filter(pk=existing.pk).count() == 1
    assert User.objects.filter(email="existing@example.com").count() == 1


def test_admin_email_matching_strips_whitespace_and_ignores_case():
    staff = make_staff(email="reviewer@example.com", superuser=True)

    authenticated = authenticate(
        username="  REVIEWER@EXAMPLE.COM  ",
        password=ADMIN_PASSWORD,
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
        authenticate(username="reviewer@example.com", password=ADMIN_PASSWORD) is None
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


def test_admin_login_stops_checking_passwords_after_ten_attempts_on_one_email(client):
    make_staff(superuser=True)
    for _ in range(ADMIN_LOGIN_MAX_PER_EMAIL):
        client.post(
            reverse("admin:login"),
            {"username": "reviewer@example.com", "password": "not-the-password"},
        )

    with patch.object(AdminEmailBackend, "authenticate") as checked:
        response = client.post(
            reverse("admin:login"),
            {"username": "reviewer@example.com", "password": ADMIN_PASSWORD},
        )

    checked.assert_not_called()
    assert response.status_code == 200
    assert "_auth_user_id" not in client.session
    assert b"Too many sign-in attempts" in response.content


def test_admin_login_caps_one_address_across_many_emails(client):
    make_staff(superuser=True)
    for index in range(ADMIN_LOGIN_MAX_PER_ADDRESS):
        client.post(
            reverse("admin:login"),
            {"username": f"guess{index}@example.com", "password": "not-the-password"},
        )

    response = client.post(
        reverse("admin:login"),
        {"username": "reviewer@example.com", "password": ADMIN_PASSWORD},
    )

    assert "_auth_user_id" not in client.session
    assert b"Too many sign-in attempts" in response.content


def test_admin_login_refuses_when_the_attempt_counter_cannot_count(client, monkeypatch):
    make_staff(superuser=True)

    def unreachable(*args, **kwargs):
        raise OSError("cache unreachable")

    monkeypatch.setattr(cache, "add", unreachable)
    response = client.post(
        reverse("admin:login"),
        {"username": "reviewer@example.com", "password": ADMIN_PASSWORD},
    )

    assert response.status_code == 200
    assert "_auth_user_id" not in client.session
    assert b"Sign-in is unavailable right now" in response.content


def test_non_super_staff_cannot_create_a_django_admin_session():
    make_staff()
    client = APIClient()
    assert not client.login(username="reviewer@example.com", password=ADMIN_PASSWORD)
