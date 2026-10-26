import base64
from concurrent.futures import ThreadPoolExecutor
from io import StringIO
from threading import Barrier
from unittest.mock import patch

import pytest
from django.contrib.auth import authenticate
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import close_old_connections, connections
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.exceptions import ValidationFailed
from apps.identity.models import User
from apps.operations import mfa
from apps.operations.models import AdminAuthenticator, ManagementRole, ManagementUser

pytestmark = pytest.mark.django_db
NOW = 1_800_000_000
PASSWORD = "test-only-administrator-password"  # nosec B105


@pytest.fixture(autouse=True)
def require_mfa(settings, monkeypatch):
    settings.ADMIN_MFA_REQUIRED = True
    monkeypatch.setattr(mfa.time, "time", lambda: NOW)


def principal(surface):
    if surface == "django":
        return User.objects.create_user(
            phone="0500000099",
            email="admin@example.com",
            password=PASSWORD,
            is_active=True,
            is_staff=True,
            is_superuser=True,
            is_email_verified=True,
        )
    user = ManagementUser(
        email="operations@example.com",
        first_name="Test",
        last_name="Admin",
        role=ManagementRole.OPERATIONS_ADMIN,
    )
    user.set_password(PASSWORD)
    user.save()
    return user


def enrolled(user, *, reset=False):
    secret = mfa.new_secret()
    recovery = mfa.enroll(
        user=user, secret=secret, code=mfa.totp(secret, now=NOW - 30), reset=reset
    )
    return secret, recovery


def sign_in(client, surface, user, code="", password=PASSWORD):
    if surface == "django":
        return client.post(
            reverse("admin:login"),
            {
                "username": user.email,
                "password": password,
                "otp_code": code,
                "next": reverse("admin:index"),
            },
        )
    return client.post(
        "/api/v1/management/auth/login/",
        {
            "email": user.email,
            "password": password,
            "otp_code": code,
        },
        format="json",
        HTTP_ORIGIN="http://localhost:3000",
    )


@pytest.mark.parametrize("surface", ["django", "management"])
def test_unenrolled_privileged_accounts_fail_closed(surface):
    user = principal(surface)
    client = APIClient()
    response = sign_in(client, surface, user)
    assert response.status_code == (200 if surface == "django" else 403)
    assert "_auth_user_id" not in client.session
    assert "danpahq_management_session" not in response.cookies


@pytest.mark.parametrize("surface", ["django", "management"])
def test_password_and_fresh_authenticator_are_both_required(surface):
    user = principal(surface)
    secret, _ = enrolled(user)
    client = APIClient()
    bad = sign_in(client, surface, user, mfa.totp(secret), password="wrong-password")
    assert bad.status_code == (200 if surface == "django" else 403)
    # A bad password must not consume the valid second factor.
    good = sign_in(client, surface, user, mfa.totp(secret))
    assert good.status_code == (302 if surface == "django" else 200)
    other = sign_in(APIClient(), surface, user, mfa.totp(secret))
    assert other.status_code == (200 if surface == "django" else 403)


def test_totp_matches_rfc_6238_sha1_test_vector():
    secret = base64.b32encode(b"12345678901234567890").decode()
    assert mfa.totp(secret, now=59) == "287082"


def test_enrollment_encrypts_secret_hashes_recovery_and_requires_confirmation():
    user = principal("management")
    secret = mfa.new_secret()
    with pytest.raises(ValidationFailed):
        mfa.enroll(user=user, secret=secret, code="invalid")
    assert not AdminAuthenticator.objects.exists()
    secret, recovery = enrolled(user)
    credential = AdminAuthenticator.objects.get()
    assert secret not in credential.secret_ciphertext
    assert len(recovery) == 10
    assert not any(code.replace("-", "") in str(credential.recovery_hashes) for code in recovery)
    with pytest.raises(ValidationFailed):
        mfa.enroll(user=user, secret=mfa.new_secret(), code="123456")


@pytest.mark.parametrize("surface", ["django", "management"])
def test_recovery_code_is_one_use_and_never_returned_by_login(surface):
    user = principal(surface)
    secret, recovery = enrolled(user)
    result = sign_in(APIClient(), surface, user, recovery[0])
    assert result.status_code == (302 if surface == "django" else 200)
    assert not mfa.verify(user, recovery[0]).accepted
    assert mfa.verify(user, recovery[1]).accepted
    assert secret.encode() not in result.content
    assert recovery[0].encode() not in result.content


def test_expired_code_and_brute_force_budget_are_rejected():
    user = principal("management")
    secret, _ = enrolled(user)
    assert not mfa.verify(user, mfa.totp(secret, now=NOW - 120)).accepted
    for _ in range(9):
        assert not mfa.verify(user, "invalid").accepted
    assert not mfa.verify(user, mfa.totp(secret)).accepted


def test_accepted_clock_drift_is_consumed_and_other_accounts_cannot_use_recovery():
    user = principal("management")
    secret, recovery = enrolled(user)
    assert mfa.verify(user, mfa.totp(secret, now=NOW + 30)).accepted
    assert not mfa.verify(user, mfa.totp(secret, now=NOW)).accepted
    other = principal("django")
    enrolled(other)
    assert not mfa.verify(other, recovery[0]).accepted


@pytest.mark.parametrize("surface", ["django", "management"])
def test_reset_invalidates_authenticated_sessions(surface):
    user = principal(surface)
    secret, _ = enrolled(user)
    client = APIClient()
    assert sign_in(client, surface, user, mfa.totp(secret)).status_code in (200, 302)
    old_id = mfa.device_id(user)
    enrolled(user, reset=True)
    assert mfa.device_id(user) != old_id
    path = reverse("admin:index") if surface == "django" else "/api/v1/management/auth/session/"
    response = client.get(path)
    assert response.status_code in (302, 401, 403)


def test_password_only_management_session_cannot_bypass_mfa(settings):
    from apps.operations.services import authenticate_management

    user = principal("management")
    settings.ADMIN_MFA_REQUIRED = False
    _, token, _ = authenticate_management(email=user.email, password=PASSWORD)
    settings.ADMIN_MFA_REQUIRED = True
    client = APIClient()
    client.cookies["danpahq_management_session"] = token
    assert client.get("/api/v1/management/auth/session/").status_code == 401


def test_enrollment_invalidates_earlier_django_password_only_sessions(settings):
    user = principal("django")
    settings.ADMIN_MFA_REQUIRED = False
    client = APIClient()
    assert sign_in(client, "django", user).status_code == 302
    enrolled(user)
    settings.ADMIN_MFA_REQUIRED = True
    assert client.get(reverse("admin:index")).status_code == 302


def test_authentication_backend_cannot_bypass_second_factor():
    user = principal("django")
    secret, _ = enrolled(user)
    assert authenticate(username=user.email, password=PASSWORD) is None
    assert authenticate(username=user.email, password=PASSWORD, otp_code=mfa.totp(secret)) == user


def test_inflight_django_login_is_bound_to_the_device_that_verified_it():
    user = principal("django")
    secret, _ = enrolled(user)
    verified = authenticate(username=user.email, password=PASSWORD, otp_code=mfa.totp(secret))
    enrolled(user, reset=True)
    fresh = User.objects.get(pk=user.pk)
    assert verified.get_session_auth_hash() != fresh.get_session_auth_hash()


def test_mfa_values_are_redacted_from_audit_changes():
    from apps.audit.services import _scrub

    changes = {
        key: ["old", "private"]
        for key in [
            "otp_code",
            "recovery_code",
            "recovery_hashes",
            "secret_ciphertext",
        ]
    }
    assert all(value == ("[redacted]", "[redacted]") for value in _scrub(changes).values())


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("method", ["authenticator", "recovery"])
def test_concurrent_requests_cannot_reuse_a_second_factor(method):
    user = principal("management")
    secret, recovery = enrolled(user)
    code = mfa.totp(secret) if method == "authenticator" else recovery[0]
    barrier = Barrier(2)

    def attempt():
        close_old_connections()
        try:
            separate_user = ManagementUser.objects.get(pk=user.pk)
            barrier.wait(timeout=10)
            return mfa.verify(separate_user, code).accepted
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(), range(2)))
    assert sorted(results) == [False, True]


def test_consumer_account_cannot_be_enrolled_as_an_administrator():
    user = User.objects.create_user(
        phone="0500000099",
        email="consumer@example.com",
        password=PASSWORD,
        is_email_verified=True,
    )
    secret = mfa.new_secret()
    with pytest.raises(ValidationFailed, match="eligible administrator"):
        mfa.enroll(user=user, secret=secret, code=mfa.totp(secret))
    assert not AdminAuthenticator.objects.exists()


def test_admin_login_starts_with_primary_credentials(client):
    response = client.get(reverse("admin:login"))
    assert b'name="username"' in response.content
    assert b'name="password"' in response.content
    assert b'name="otp_code"' not in response.content
    assert b'autocomplete="current-password"' in response.content


def test_provisioning_command_refuses_unconfirmed_or_implicit_reset():
    user = principal("management")
    with (
        patch(
            "apps.operations.management.commands.enroll_admin_mfa.getpass.getpass",
            return_value="invalid",
        ),
        pytest.raises(CommandError),
    ):
        call_command("enroll_admin_mfa", surface="management", email=user.email, stdout=StringIO())
    assert not AdminAuthenticator.objects.exists()
    enrolled(user)
    with pytest.raises(CommandError, match="Already enrolled"):
        call_command("enroll_admin_mfa", surface="management", email=user.email, stdout=StringIO())


def test_mfa_fails_closed_when_attempt_counter_is_unavailable(monkeypatch):
    from apps.core.exceptions import ProviderUnavailable

    user = principal("management")
    secret, _ = enrolled(user)
    monkeypatch.setattr(
        cache, "add", lambda *args, **kwargs: (_ for _ in ()).throw(OSError("offline"))
    )
    with pytest.raises(ProviderUnavailable):
        mfa.verify(user, mfa.totp(secret))
