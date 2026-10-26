from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

import pytest
from django.db import connections
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.crypto import sign_payload
from apps.core.exceptions import PermissionDenied
from apps.identity.models import ExternalIdentity, Session
from apps.operations import login_mfa, mfa
from apps.operations.models import AdminAuthenticator, ManagementSession, MFAChallenge
from tests.conftest import TEST_PASSWORD, make_account
from tests.integration.test_admin_mfa import PASSWORD, principal
from tests.integration.test_google_auth import claims, start_google

pytestmark = pytest.mark.django_db


def member(policy="required", account_type="tenant"):
    return make_account(
        "0500000088", email="member@example.com", mfa_policy=policy, account_type=account_type
    )


def start(client, user):
    return client.post(
        "/api/v1/auth/sign-in/",
        {
            "identifier": user.email,
            "password": TEST_PASSWORD,
            "platform": "ios",
            "device_fingerprint": "mfa-phone",
        },
        format="json",
        HTTP_X_CLIENT="mobile",
    )


def confirm(client, pending, *, action="verify", code="", surface="consumer"):
    route = "/api/v1/auth/mfa/" if surface == "consumer" else "/api/v1/management/auth/mfa/"
    return client.post(
        route,
        {
            "challenge_token": pending["challenge_token"],
            "code": code,
            "action": action,
        },
        format="json",
        HTTP_X_CLIENT="mobile" if surface == "consumer" else "management",
    )


@pytest.mark.parametrize("account_type", ["tenant", "provider"])
def test_required_enrollment_issues_no_session_until_code_and_recovery_ack(account_type):
    user = member(account_type=account_type)
    client = APIClient()
    response = start(client, user)
    pending = response.data
    assert response.status_code == 200
    assert response["Cache-Control"] == "no-store"
    assert pending["stage"] == "enroll" and not pending["can_skip"]
    assert pending["qr_svg"].startswith("<svg")
    assert "otpauth://totp/" in pending["provisioning_uri"]
    assert not Session.objects.exists() and not AdminAuthenticator.objects.exists()
    assert "danpahq_refresh" not in response.cookies
    assert confirm(client, pending, action="skip").status_code == 422
    with patch.object(mfa.time, "time", return_value=1_800_000_000):
        confirmed = confirm(client, pending, code=mfa.totp(pending["secret"]))
    assert confirmed.data["stage"] == "recovery"
    assert len(confirmed.data["recovery_codes"]) == 10
    assert "secret" not in confirmed.data and not Session.objects.exists()
    completed = confirm(client, confirmed.data, action="complete")
    assert completed.status_code == 200 and completed.data["user"]["id"] == str(user.pk)
    assert completed.data["refresh_token"]
    assert Session.objects.get().mfa_device_id == mfa.device_id(user)
    assert confirm(client, confirmed.data, action="complete").status_code == 403


def test_optional_enrollment_can_be_skipped_without_creating_device():
    user = member("optional")
    client = APIClient()
    pending = start(client, user).data
    assert pending["can_skip"]
    response = confirm(client, pending, action="skip")
    assert response.status_code == 200 and response.data["access_token"]
    assert not AdminAuthenticator.objects.exists()


def test_disabled_policy_preserves_password_login_without_enrollment():
    response = start(APIClient(), member("disabled"))
    assert "access_token" in response.data and "mfa_required" not in response.data


def test_wrong_password_discloses_no_setup_material():
    user = member()
    response = APIClient().post(
        "/api/v1/auth/sign-in/",
        {
            "identifier": user.email,
            "password": "wrong",
            "platform": "web",
        },
        format="json",
    )
    assert response.status_code == 403
    assert not MFAChallenge.objects.exists()


def test_bad_confirmation_has_persistent_budget_and_expires():
    client = APIClient()
    pending = start(client, member()).data
    for _ in range(10):
        assert confirm(client, pending, code="invalid").status_code == 422
    assert MFAChallenge.objects.get().attempts == 10
    assert confirm(client, pending, code="invalid").status_code == 403
    assert not AdminAuthenticator.objects.exists() and not Session.objects.exists()


@pytest.mark.parametrize("change", ["password", "policy", "expired", "inactive"])
def test_challenge_is_invalidated_when_account_or_expiry_changes(change):
    client = APIClient()
    user = member()
    pending = start(client, user).data
    if change == "password":
        user.set_password("new-password")
        user.save()
    elif change == "policy":
        user.mfa_policy = "disabled"
        user.save()
    elif change == "inactive":
        user.is_active = False
        user.save()
    else:
        MFAChallenge.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert confirm(client, pending, code=mfa.totp(pending["secret"])).status_code == 403
    assert not AdminAuthenticator.objects.exists()


def test_challenges_are_bound_to_surface_client_and_cannot_authenticate_as_bearer():
    client = APIClient()
    pending = start(client, member()).data
    assert confirm(client, pending, surface="management", action="complete").status_code == 403
    assert (
        client.post(
            "/api/v1/auth/mfa/",
            {
                "challenge_token": pending["challenge_token"],
                "action": "skip",
            },
            format="json",
            HTTP_X_CLIENT="web",
        ).status_code
        == 403
    )
    assert (
        client.get(
            "/api/v1/me/", HTTP_AUTHORIZATION=f'Bearer {pending["challenge_token"]}'
        ).status_code
        == 401
    )


def test_google_cannot_bypass_required_mfa(monkeypatch):
    user = member()
    ExternalIdentity.objects.create(
        user=user, provider="google", subject="google-123", email=user.email, email_verified=True
    )
    response = start_google(APIClient(), monkeypatch, claims(email=user.email))
    assert response.status_code == 200 and response.data["stage"] == "enroll"
    assert not Session.objects.exists()


def test_existing_authenticator_requires_code_and_recovery_is_one_use():
    user = member("optional")
    secret = mfa.new_secret()
    recovery = mfa.enroll(user=user, secret=secret, code=mfa.totp(secret), allow_consumer=True)
    client = APIClient()
    pending = start(client, user).data
    assert pending["stage"] == "verify" and not pending["can_skip"]
    assert "secret" not in pending and "qr_svg" not in pending
    assert confirm(client, pending, action="skip").status_code == 422
    assert confirm(client, pending, code=recovery[0]).status_code == 200
    second = start(APIClient(), user).data
    assert confirm(APIClient(), second, code=recovery[0]).status_code == 422


def test_policy_enforcement_rejects_old_access_and_refresh_tokens():
    user = member("disabled")
    client = APIClient()
    session = start(client, user).data
    user.mfa_policy = "required"
    user.save()
    assert (
        client.get(
            "/api/v1/me/", HTTP_AUTHORIZATION=f'Bearer {session["access_token"]}'
        ).status_code
        == 401
    )
    response = client.post(
        "/api/v1/auth/refresh/",
        {
            "refresh_token": session["refresh_token"],
            "platform": "ios",
        },
        format="json",
    )
    assert response.status_code == 403


def test_management_password_first_enrollment_and_session_cookie(settings):
    settings.ADMIN_MFA_REQUIRED = True
    user = principal("management")
    client = APIClient()
    response = client.post(
        "/api/v1/management/auth/login/",
        {
            "email": user.email,
            "password": PASSWORD,
            "interactive_mfa": True,
        },
        format="json",
        HTTP_X_CLIENT="management",
    )
    pending = response.data
    assert pending["stage"] == "enroll" and not ManagementSession.objects.exists()
    confirmed = confirm(client, pending, code=mfa.totp(pending["secret"]), surface="management")
    assert not ManagementSession.objects.exists()
    result = confirm(client, confirmed.data, action="complete", surface="management")
    assert result.status_code == 200 and "danpahq_management_session" in result.cookies
    assert "access_token" not in result.data


def test_django_password_first_enrollment_qr_and_recovery_ack(settings):
    settings.ADMIN_MFA_REQUIRED = True
    user = principal("django")
    client = APIClient()
    url = reverse("admin:login")
    response = client.post(url, {"username": user.email, "password": PASSWORD})
    pending = response.context_data["form"].mfa_challenge
    assert pending["stage"] == "enroll" and b"<svg" in response.content
    assert b'<details class="mfa-manual">' in response.content
    assert b"This adds the same account as scanning." in response.content
    assert b'class="errorlist nonfield"' not in response.content
    assert "_auth_user_id" not in client.session
    invalid = client.post(url, {
        "challenge_token": pending["challenge_token"], "otp_code": "wrong",
        "mfa_action": "verify",
    })
    assert b"That code did not match." in invalid.content
    assert b"<svg" in invalid.content
    verified = client.post(
        url,
        {
            "challenge_token": pending["challenge_token"],
            "otp_code": mfa.totp(pending["secret"]),
            "mfa_action": "verify",
        },
    )
    assert b"Save your recovery codes" in verified.content
    assert b'class="errorlist nonfield"' not in verified.content
    assert b'<ul class="mfa-recovery"' in verified.content
    assert "_auth_user_id" not in client.session
    result = client.post(
        url, {"challenge_token": pending["challenge_token"], "mfa_action": "complete"}
    )
    assert result.status_code == 302
    assert client.get(reverse("admin:index")).status_code == 200


def test_no_external_qr_service_is_used():
    user = member()
    pending = login_mfa.begin(user=user, surface="consumer")
    assert "http" not in pending["qr_svg"].replace("http://www.w3.org/2000/svg", "")


def test_pending_token_rejected_after_enrollment_was_reset():
    user = member()
    pending = login_mfa.begin(user=user, surface="consumer")
    another = login_mfa.begin(user=user, surface="consumer")
    login_mfa.finish(
        token=pending["challenge_token"], surface="consumer", code=mfa.totp(pending["secret"])
    )
    with pytest.raises(PermissionDenied):
        login_mfa.finish(
            token=another["challenge_token"], surface="consumer", code=mfa.totp(another["secret"])
        )


def test_password_recovery_does_not_bypass_existing_second_factor(settings):
    user = member()
    secret = mfa.new_secret()
    mfa.enroll(user=user, secret=secret, code=mfa.totp(secret), allow_consumer=True)
    reset = sign_payload(
        {"sub": str(user.pk), "act": "password_reset"},
        key=settings.ACCESS_TOKEN_KEY or settings.SECRET_KEY,
        ttl_seconds=60,
    )
    response = APIClient().post(
        "/api/v1/auth/password-reset/complete/",
        {
            "reset_token": reset,
            "new_password": "another-secure-test-password",
            "platform": "web",
        },
        format="json",
    )
    assert response.status_code == 200 and response.data["stage"] == "verify"
    assert "access_token" not in response.data and not Session.objects.exists()


def test_passwordless_google_account_can_enroll(monkeypatch):
    user = member()
    ExternalIdentity.objects.create(
        user=user, provider="google", subject="google-123", email=user.email, email_verified=True
    )
    user.set_unusable_password()
    user.save()
    client = APIClient()
    response = start_google(client, monkeypatch, claims(email=user.email), HTTP_X_CLIENT="mobile")
    assert response.data["stage"] == "enroll"
    confirmed = confirm(client, response.data, code=mfa.totp(response.data["secret"]))
    assert confirmed.status_code == 200 and confirmed.data["stage"] == "recovery"
    assert AdminAuthenticator.objects.filter(django_user=user).exists()


@pytest.mark.django_db(transaction=True)
def test_simultaneous_challenge_completion_creates_one_session():
    user = member("optional")
    pending = login_mfa.begin(user=user, surface="consumer")
    barrier = Barrier(2)

    def attempt():
        try:
            barrier.wait(timeout=10)
            login_mfa.finish(token=pending["challenge_token"], surface="consumer", action="skip")
            return True
        except PermissionDenied:
            return False
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(), range(2)))
    assert sorted(results) == [False, True]
    assert Session.objects.filter(user=user).count() == 1
