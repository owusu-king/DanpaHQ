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
    from apps.identity.provider_terms import policy

    terms = policy()
    return api.post(
        "/api/v1/me/registration/",
        {
            "google_registration_ticket": ticket,
            "terms_accepted": True,
            "accepted_terms_version": terms["version"],
            "accepted_terms_digest": terms["digest"],
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


def test_google_password_setup_requires_the_linked_subject_and_keeps_the_identity(monkeypatch, sms):
    api = APIClient()
    created = register_google(api, monkeypatch)
    assert created.status_code == 201
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {created.data['access_token']}")
    body = {"credential": "verified-by-test-double", "new_password": TEST_PASSWORD}
    stub_google(monkeypatch, claims(subject="someone-else"))
    refused = api.post("/api/v1/me/password/google/", body, format="json")
    assert refused.status_code == 403
    assert not api.get("/api/v1/me/").data["has_password"]

    stub_google(monkeypatch, claims())
    changed = api.post("/api/v1/me/password/google/", body, format="json")
    assert changed.status_code == 200, changed.data
    me = api.get("/api/v1/me/")
    assert me.data["has_password"] and me.data["google_linked"]
    assert api.post("/api/v1/me/password/google/", body, format="json").status_code == 409

    phone = api.post("/api/v1/me/phone/", {"phone": "0204567890"}, format="json")
    assert phone.status_code == 201, phone.data
    confirmed = api.post("/api/v1/me/phone/verify/", {
        "challenge_id": phone.data["challenge_id"], "code": code_from(sms),
    }, format="json")
    assert confirmed.status_code == 200, confirmed.data
    assert api.post("/api/v1/auth/sign-out/", {}, format="json").status_code == 204
    api.credentials()

    for identifier in ("ama@example.com", "0204567890"):
        signed_in = api.post("/api/v1/auth/sign-in/", {
            "identifier": identifier, "password": TEST_PASSWORD, "platform": "android",
        }, format="json")
        assert signed_in.status_code == 200, signed_in.data
        assert signed_in.data["user"]["id"] == created.data["user"]["id"]
    assert start_google(api, monkeypatch).data["user"]["id"] == created.data["user"]["id"]
    assert User.objects.count() == 1


def test_artisan_google_ticket_preserves_type_without_granting_tenant(monkeypatch):
    from apps.identity.models import Role

    api = APIClient()
    started = start_google(api, monkeypatch, account_type="artisan")
    assert started.status_code == 200
    # A mutable completion body cannot turn a signed artisan ticket into a tenant.
    completed = complete_google(
        api, started.data["google_registration_ticket"], account_type="tenant"
    )
    assert completed.status_code == 201
    user = User.objects.get(id=completed.data["user"]["id"])
    assert user.account_type == "artisan"
    assert not user.has_role(Role.TENANT)
    assert completed.data["user"]["entry_routes"]["web"] == "/artisan"
    assert completed.data["user"]["capabilities"]["artisan"]["can_quote"] is False


def test_google_verifier_uses_configured_audience_and_stable_subject(monkeypatch, settings):
    seen = {}
    settings.GOOGLE_OAUTH_CLIENT_ID = "web-client.apps.googleusercontent.com"

    def verify(token, request, audience, clock_skew_in_seconds=0):
        seen.update(token=token, request=request, audience=audience)
        assert clock_skew_in_seconds == 10
        return {
            "sub": "stable-google-subject",
            "exp": __import__("time").time() + 3600,
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
    response = api.get("/api/v1/me/provider-verification/")
    assert response.status_code == 200
    assert response.data["verification_status"] == "not_started"
    assert response.data["application_state"] == "incomplete"
    assert response.data["requires_phone_verification"] is True
    assert response.data["terms_accepted"] is True


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


@pytest.mark.parametrize("platform", ["android", "ios"])
def test_native_google_registration_and_refresh_reuse_app_sessions(monkeypatch, platform):
    from apps.identity.models import Device, Session

    stub_google(monkeypatch, claims())
    api = APIClient()
    api.defaults["HTTP_X_CLIENT"] = "mobile"
    device = {
        "platform": platform,
        "device_fingerprint": "native-install",
        "device_label": "My phone",
    }
    started = api.post(
        "/api/v1/auth/google/",
        {
            "credential": "verified-by-test-double",
            "account_type": "tenant",
            **device,
        },
        format="json",
    )
    assert started.status_code == 200
    assert not User.objects.exists()
    created = api.post(
        "/api/v1/me/registration/",
        {
            "google_registration_ticket": started.data["google_registration_ticket"],
            "first_name": "Ama",
            "last_name": "Mensah",
            "date_of_birth": "1992-05-11",
            "email": "ama@example.com",
            **device,
        },
        format="json",
    )
    assert created.status_code == 201
    assert created.data["refresh_token"]
    assert "danpahq_refresh" not in created.cookies
    assert Device.objects.get().platform == platform
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {created.data['access_token']}")
    me = api.get("/api/v1/me/")
    assert me.status_code == 200
    assert me.data["google_linked"] is True
    assert me.data["registration_state"] == "complete"
    assert me.data["is_phone_verified"] is False
    api.credentials()
    refreshed = api.post(
        "/api/v1/auth/refresh/",
        {
            "refresh_token": created.data["refresh_token"],
        },
        format="json",
    )
    assert refreshed.status_code == 200
    assert refreshed.data["refresh_token"] != created.data["refresh_token"]
    assert Session.objects.filter(revoked_at__isnull=True).count() == 1
    assert Device.objects.count() == 1


def test_invalid_google_credential_cannot_create_a_mobile_account(monkeypatch, settings):
    settings.GOOGLE_OAUTH_CLIENT_ID = "expected-server-client.apps.googleusercontent.com"

    def refuse(token, request, audience, clock_skew_in_seconds=0):
        assert audience == settings.GOOGLE_OAUTH_CLIENT_ID
        raise ValueError("Invalid token signature or audience")

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", refuse)
    response = APIClient().post(
        "/api/v1/auth/google/",
        {
            "credential": "untrusted-token",
            "account_type": "tenant",
            "platform": "android",
        },
        format="json",
        HTTP_X_CLIENT="mobile",
    )
    assert response.status_code == 403
    assert not User.objects.exists()


@pytest.mark.parametrize(("failure", "reason"), [
    ("Token expired", "expired"), ("Token used too early", "not_yet_valid"),
    ("Wrong audience", "audience"), ("Could not verify signature", "signature"),
])
def test_google_rejections_are_actionable_without_logging_credentials(
    monkeypatch, settings, caplog, failure, reason,
):
    from apps.core.exceptions import PermissionDenied

    caplog.set_level("WARNING", logger="apps.identity.google_identity")
    settings.GOOGLE_OAUTH_CLIENT_ID = "expected.apps.googleusercontent.com"
    def reject(*args, **kwargs):
        raise ValueError(failure)
    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", reject)
    with pytest.raises(PermissionDenied) as caught:
        verify_google_credential("private-test-credential")
    assert caught.value.details["reason"] == reason
    assert f"reason={reason}" in caplog.text
    assert "private-test-credential" not in caplog.text


def test_google_wrong_issuer_is_refused_not_reported_as_a_service_outage(monkeypatch, settings):
    from google.auth.exceptions import GoogleAuthError

    from apps.core.exceptions import PermissionDenied

    settings.GOOGLE_OAUTH_CLIENT_ID = "expected.apps.googleusercontent.com"
    def reject(*args, **kwargs):
        raise GoogleAuthError("Wrong issuer")
    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", reject)
    with pytest.raises(PermissionDenied):
        verify_google_credential("invalid-issuer-proof")


@pytest.mark.parametrize("age", [-1, -5, -9])
def test_google_expiry_is_strict_even_with_issued_at_tolerance(monkeypatch, settings, age):
    import time

    from apps.core.exceptions import PermissionDenied

    settings.GOOGLE_OAUTH_CLIENT_ID = "expected.apps.googleusercontent.com"
    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", lambda *a, **kw: {
        "sub": "subject", "email": "ama@example.com", "email_verified": True,
        "exp": time.time() + age,
    })
    with pytest.raises(PermissionDenied) as caught:
        verify_google_credential("expired-proof")
    assert caught.value.details["reason"] == "expired"


@pytest.mark.parametrize("defect", [
    "none", "future", "expired", "audience", "issuer", "signature",
])
def test_google_signed_proof_keeps_signature_and_timestamp_checks(
    monkeypatch, settings, defect,
):
    import json
    import time

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from google.auth import crypt, jwt

    from apps.core.exceptions import PermissionDenied

    settings.GOOGLE_OAUTH_CLIENT_ID = "expected.apps.googleusercontent.com"
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    now = int(time.time())
    token = jwt.encode(crypt.RSASigner.from_string(pem, key_id="test-key"), {
        "sub": "signed-subject", "email": "ama@example.com", "email_verified": True,
        "aud": "wrong-client" if defect == "audience" else settings.GOOGLE_OAUTH_CLIENT_ID,
        "iss": "https://example.invalid" if defect == "issuer" else "https://accounts.google.com",
        "iat": now + (60 if defect == "future" else 3),
        "exp": now + (-1 if defect == "expired" else 3600),
    }).decode()
    if defect == "signature":
        head, body, signature = token.split(".")
        replacement = "A" if signature[0] != "A" else "B"
        token = f"{head}.{body}.{replacement}{signature[1:]}"
    class Certificates:
        status = 200
        data = json.dumps({"test-key": public}).encode()
    monkeypatch.setattr("google.auth.transport.requests.Request", lambda: (
        lambda *args, **kwargs: Certificates()
    ))
    if defect == "none":
        assert verify_google_credential(token).subject == "signed-subject"
    else:
        with pytest.raises(PermissionDenied):
            verify_google_credential(token)


def test_unconfigured_google_signin_is_unavailable_not_an_invalid_credential(settings):
    from apps.core.exceptions import ProviderUnavailable

    settings.GOOGLE_OAUTH_CLIENT_ID = ""
    with pytest.raises(ProviderUnavailable):
        verify_google_credential("opaque-proof")


def test_google_certificate_network_failure_is_retryable(monkeypatch, settings):
    from google.auth.exceptions import TransportError

    from apps.core.exceptions import ProviderUnavailable

    settings.GOOGLE_OAUTH_CLIENT_ID = "expected.apps.googleusercontent.com"
    def unavailable(*args, **kwargs):
        raise TransportError("network unavailable")
    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", unavailable)
    with pytest.raises(ProviderUnavailable):
        verify_google_credential("opaque-proof")
