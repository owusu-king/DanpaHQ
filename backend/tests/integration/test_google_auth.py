"""Google is an additional credential, never a replacement for phone auth."""

from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from apps.identity.google_identity import GoogleClaims, verify_google_credential
from apps.identity.models import ExternalIdentity, ExternalIdentityProvider, User
from tests.conftest import TEST_PASSWORD

pytestmark = pytest.mark.django_db


def code_from(sms):
    return "".join(ch for ch in sms.outbox[-1].body.split()[0] if ch.isdigit())


def claims(subject="google-123", email="ama@example.com", first="Ama", last="Mensah"):
    return GoogleClaims(subject=subject, email=email, first_name=first, last_name=last)


def stub_google(monkeypatch, value):
    monkeypatch.setattr(
        "apps.identity.google_identity.verify_google_credential",
        lambda credential: value,
    )


def start_google(api, monkeypatch, value=None, account_type="tenant", **headers):
    stub_google(monkeypatch, value or claims())
    return api.post(
        "/api/v1/auth/google/",
        {
            "credential": "verified-by-test-double",
            "account_type": account_type,
            "platform": "web",
            "device_fingerprint": "google-browser",
        },
        format="json",
        **headers,
    )


def complete_google(api, ticket, account_type="tenant", **headers):
    return api.post(
        "/api/v1/me/registration/",
        {
            "google_registration_ticket": ticket,
            # The signed ticket, not this mutable field, preserves the role
            # selection made before Google opened.
            "account_type": account_type,
            "first_name": "Ama",
            "last_name": "Mensah",
            "email": "ama@example.com",
            "date_of_birth": "1992-05-11",
            "platform": "web",
            "device_fingerprint": "google-browser",
        },
        format="json",
        **headers,
    )


def register_google(api, monkeypatch, value=None, account_type="tenant", **headers):
    started = start_google(api, monkeypatch, value, account_type, **headers)
    assert started.status_code == 200
    assert started.data["registration_required"] is True
    return complete_google(
        api,
        started.data["google_registration_ticket"],
        account_type=account_type,
        **headers,
    )


def test_google_verifier_uses_configured_audience_and_stable_subject(monkeypatch, settings):
    seen = {}
    settings.GOOGLE_OAUTH_CLIENT_ID = "web-client.apps.googleusercontent.com"

    def verify(token, request, audience):
        seen.update(token=token, request=request, audience=audience)
        return {
            "sub": "stable-google-subject",
            "email": "Ama@Example.com",
            "email_verified": True,
            "given_name": "Ama",
            "family_name": "Mensah",
        }

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", verify)
    verified = verify_google_credential("opaque-id-token")

    assert seen["token"] == "opaque-id-token"
    assert seen["audience"] == settings.GOOGLE_OAUTH_CLIENT_ID
    assert seen["request"] is not None
    assert verified.subject == "stable-google-subject"
    assert verified.email == "ama@example.com"


def test_existing_phone_password_login_still_works(user):
    response = APIClient().post(
        "/api/v1/auth/sign-in/",
        {"phone": user.phone, "password": TEST_PASSWORD, "platform": "web"},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["user"]["id"] == str(user.id)


def test_new_google_signup_has_optional_phone_and_existing_session_pipeline(monkeypatch):
    api = APIClient()
    started = start_google(api, monkeypatch)

    assert started.status_code == 200
    assert started.data["profile"] == {
        "first_name": "Ama",
        "last_name": "Mensah",
        "email": "ama@example.com",
    }
    assert not User.objects.exists()

    created = complete_google(api, started.data["google_registration_ticket"])
    assert created.status_code == 201
    assert created.data["access_token"]
    assert created.data["refresh_token"]
    assert created.data["user"]["phone_display"] == ""
    assert created.data["user"]["is_phone_verified"] is False
    assert created.data["user"]["registration_state"] == "complete"
    assert created.data["user"]["authentication_methods"] == ["google"]

    user = User.objects.get()
    assert user.phone is None
    assert user.is_email_verified is True
    assert user.has_role("tenant")
    assert ExternalIdentity.objects.get(user=user).subject == "google-123"


def test_google_profile_email_can_be_edited_without_false_verification(monkeypatch):
    api = APIClient()
    started = start_google(api, monkeypatch)
    created = api.post(
        "/api/v1/me/registration/",
        {
            "google_registration_ticket": started.data["google_registration_ticket"],
            "first_name": "Ama",
            "last_name": "Mensah",
            "email": "personal@example.com",
            "date_of_birth": "1992-05-11",
            "platform": "web",
        },
        format="json",
    )

    assert created.status_code == 201
    user = User.objects.get()
    assert user.email == "personal@example.com"
    assert user.is_email_verified is False
    assert ExternalIdentity.objects.get(user=user).email == "ama@example.com"


def test_google_role_selection_is_preserved_without_granting_provider(monkeypatch):
    api = APIClient()
    started = start_google(api, monkeypatch, account_type="provider")
    created = complete_google(
        api,
        started.data["google_registration_ticket"],
        account_type="tenant",
    )

    assert created.status_code == 201
    user = User.objects.get()
    assert user.account_type == "provider"
    assert user.roles == set()
    assert created.data["user"]["capabilities"]["provider"]["workspace_access"] is False

    api.credentials(HTTP_AUTHORIZATION=f"Bearer {created.data['access_token']}")
    response = api.post(
        "/api/v1/me/provider-verification/", {"documents": []}, format="json"
    )
    assert response.status_code == 403


def test_returning_google_subject_signs_into_same_account_even_if_email_changed(monkeypatch):
    api = APIClient()
    created = register_google(api, monkeypatch)
    user_id = created.data["user"]["id"]

    returned = start_google(
        APIClient(),
        monkeypatch,
        claims(email="new-address@example.com"),
    )
    assert returned.status_code == 200
    assert returned.data["user"]["id"] == user_id
    assert User.objects.count() == 1
    assert ExternalIdentity.objects.get().email == "new-address@example.com"


def test_matching_email_never_auto_merges_with_phone_account(monkeypatch, registered):
    existing = registered("0247000001", email="ama@example.com")
    response = start_google(APIClient(), monkeypatch)

    assert response.status_code == 409
    assert response.data["error"]["code"] == "GOOGLE_LINK_REQUIRED"
    assert not existing.external_identities.exists()
    assert User.objects.count() == 1


def test_authenticated_phone_account_can_link_google_once(monkeypatch, sign_in_as, registered):
    user = registered("0247000002", email="ama@example.com")
    api = APIClient()
    session = sign_in_as(api, user=user)
    stub_google(monkeypatch, claims())

    linked = api.post(
        "/api/v1/me/google/",
        {"credential": "verified-by-test-double"},
        format="json",
    )
    assert linked.status_code == 200
    assert linked.data["google_linked"] is True
    assert linked.data["authentication_methods"] == ["phone", "google"]

    other = registered("0247000003", email="other@example.com")
    other_api = APIClient()
    sign_in_as(other_api, user=other, device_fingerprint="other-device")
    refused = other_api.post(
        "/api/v1/me/google/",
        {"credential": "verified-by-test-double"},
        format="json",
    )
    assert refused.status_code == 409
    assert ExternalIdentity.objects.get().user_id == user.id
    assert session["session"].is_active


def test_google_identity_constraints_prevent_duplicate_subjects(registered):
    first = registered("0247000004")
    second = registered("0247000005")
    ExternalIdentity.objects.create(
        user=first,
        provider=ExternalIdentityProvider.GOOGLE,
        subject="one-google-subject",
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        ExternalIdentity.objects.create(
            user=second,
            provider=ExternalIdentityProvider.GOOGLE,
            subject="one-google-subject",
        )


def test_google_user_can_verify_phone_later_with_existing_otp(monkeypatch, sms):
    api = APIClient()
    created = register_google(api, monkeypatch)
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {created.data['access_token']}")

    started = api.post(
        "/api/v1/me/phone/",
        {"phone": "0247000006", "device_fingerprint": "google-browser"},
        format="json",
    )
    assert started.status_code == 201

    verified = api.post(
        "/api/v1/me/phone/verify/",
        {"challenge_id": started.data["challenge_id"], "code": code_from(sms)},
        format="json",
    )
    assert verified.status_code == 200
    assert verified.data["is_phone_verified"] is True
    assert verified.data["phone_display"] == "024 700 0006"


def test_google_browser_session_uses_existing_httponly_refresh_cookie(monkeypatch):
    api = APIClient()
    created = register_google(api, monkeypatch, HTTP_X_CLIENT="web")

    assert created.status_code == 201
    assert "refresh_token" not in created.data
    cookie = created.cookies.get("danpahq_refresh")
    assert cookie is not None
    assert cookie["httponly"]
    assert cookie["samesite"] == "Lax"
