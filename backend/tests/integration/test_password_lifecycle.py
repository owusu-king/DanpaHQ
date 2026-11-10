import pytest
from rest_framework.test import APIClient

from apps.identity.models import AuthChallenge, Session
from apps.identity.services import _establish_session
from tests.conftest import TEST_PASSWORD, make_account, sign_in

pytestmark = pytest.mark.django_db
CREATE = "/api/v1/me/password/create/"
RESET = "/api/v1/auth/password-reset/"
SIGN_IN = "/api/v1/auth/sign-in/"
NEW_PASSWORD = "new-correct-horse-battery-staple"


def post(api, path, **body):
    return api.post(path, body, format="json")


def legacy_session(user, fingerprint):
    result = _establish_session(user=user, created=False, device_fingerprint=fingerprint)
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {result['access_token']}")
    return api, result


def test_sms_creation_is_bound_to_account_and_session_and_keeps_current_device(user, sms):
    user.set_unusable_password()
    user.email = "ama@example.com"
    user.is_email_verified = True
    user.save()
    api = APIClient()
    phone_proof = post(api, "/api/v1/auth/challenge/", phone=user.phone)
    assert phone_proof.status_code == 201, phone_proof.data
    signed_in = post(
        api, "/api/v1/auth/verify/", challenge_id=phone_proof.data["challenge_id"],
        code=sms.outbox[-1].body.split()[0], device_fingerprint="setup",
    )
    assert signed_in.status_code == 200, signed_in.data
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {signed_in.data['access_token']}")
    same_user, _ = legacy_session(user, "other-device")
    other = make_account("0241234567")
    other.set_unusable_password()
    other.save(update_fields=["password"])
    other_api, _ = legacy_session(other, "other-account")

    me = api.get("/api/v1/me/").data
    assert me["has_password"] is False
    assert me["entry_routes"]["web"] == "/settings/security"
    assert api.get("/api/v1/me/devices/").status_code == 401
    assert post(api, "/api/v1/me/registration/", password=TEST_PASSWORD).status_code == 403
    assert post(APIClient(), CREATE + "code/", channel="sms").status_code in (401, 403)
    started = post(api, CREATE + "code/", channel="sms")
    assert started.status_code == 201, started.data
    code = sms.outbox[-1].body.split()[0]
    body = {"challenge_id": started.data["challenge_id"], "code": code}

    assert post(APIClient(), RESET + "verify/", **body).status_code >= 400
    assert post(APIClient(), "/api/v1/auth/verify/", **body).status_code >= 400
    for client in (same_user, other_api):
        assert post(client, CREATE, new_password=TEST_PASSWORD, **body).status_code >= 400
    assert AuthChallenge.objects.get(id=body["challenge_id"]).attempts == 0
    bad_code = "000000" if code != "000000" else "111111"
    invalid = post(api, CREATE, new_password=TEST_PASSWORD, **(body | {"code": bad_code}))
    assert invalid.status_code >= 400
    assert AuthChallenge.objects.get(id=body["challenge_id"]).attempts == 1

    refreshed = post(
        APIClient(), "/api/v1/auth/refresh/", refresh_token=signed_in.data["refresh_token"],
        device_fingerprint="setup",
    )
    assert refreshed.status_code == 200, refreshed.data
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {refreshed.data['access_token']}")
    result = post(api, CREATE, new_password=TEST_PASSWORD, **body)
    assert result.status_code == 200, result.data
    assert api.get("/api/v1/me/").data["has_password"] is True
    assert api.get("/api/v1/me/devices/").status_code == 200
    assert same_user.get("/api/v1/me/").status_code >= 400
    assert post(api, CREATE, new_password=NEW_PASSWORD, **body).status_code == 409
    for identifier in (user.phone, "AMA@example.com"):
        result = post(APIClient(), SIGN_IN, identifier=identifier, password=TEST_PASSWORD)
        assert result.status_code == 200, result.data
        assert str(result.data["user"]["id"]) == str(user.pk)


def test_setup_rejects_unverified_contact_and_recovery_proof(user, sms, mailoutbox):
    user.set_unusable_password()
    user.email = "unverified@example.com"
    user.save()
    api, _ = legacy_session(user, "setup")
    assert post(api, CREATE + "code/", channel="email").status_code == 403
    assert not mailoutbox

    started = post(APIClient(), RESET, identifier=user.phone)
    assert started.status_code == 201
    result = post(
        api, CREATE, challenge_id=started.data["challenge_id"],
        code=sms.outbox[-1].body.split()[0], new_password=TEST_PASSWORD,
    )
    assert result.status_code >= 400
    user.refresh_from_db()
    assert not user.has_usable_password()


def test_email_reset_is_single_use_and_revokes_old_sessions(user, mailoutbox):
    user.email = "ama@example.com"
    user.is_email_verified = True
    user.save()
    old = APIClient()
    sign_in(old, user=user)
    api = APIClient()

    started = post(api, RESET, identifier=" AMA@EXAMPLE.COM ")
    assert started.status_code == 201, started.data
    assert len(mailoutbox) == 1
    assert mailoutbox[-1].to == ["ama@example.com"]
    body = {"challenge_id": started.data["challenge_id"], "code": mailoutbox[-1].body.split()[0]}
    verified = post(api, RESET + "verify/", **body)
    assert verified.status_code == 200, verified.data
    assert set(verified.data) == {"reset_token", "expires_in"}
    assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 1
    assert post(api, RESET + "verify/", **body).status_code >= 400
    change = {"reset_token": verified.data["reset_token"], "new_password": NEW_PASSWORD}
    completed = post(api, RESET + "complete/", **change)
    assert completed.status_code == 200, completed.data
    assert old.get("/api/v1/me/").status_code >= 400
    assert post(api, RESET + "complete/", **change).status_code >= 400
    assert post(api, SIGN_IN, identifier=user.phone, password=TEST_PASSWORD).status_code == 403
    assert post(api, SIGN_IN, identifier=user.phone, password=NEW_PASSWORD).status_code == 200


def test_email_reset_rechecks_contact_after_issuing_the_reset_token(user, mailoutbox):
    user.email = "old@example.com"
    user.is_email_verified = True
    user.save()
    api = APIClient()
    started = post(api, RESET, identifier=user.email)
    assert started.status_code == 201
    verified = post(
        api, RESET + "verify/", challenge_id=started.data["challenge_id"],
        code=mailoutbox[-1].body.split()[0],
    )
    assert verified.status_code == 200, verified.data
    user.email = "new@example.com"
    user.save(update_fields=["email"])
    assert post(
        api, RESET + "complete/", reset_token=verified.data["reset_token"],
        new_password=NEW_PASSWORD,
    ).status_code == 403
    user.refresh_from_db()
    assert user.check_password(TEST_PASSWORD)


@pytest.mark.parametrize("eligible", ["unknown", "unverified", "ambiguous", "inactive"])
def test_ineligible_email_recovery_does_not_deliver_code(user, mailoutbox, eligible):
    address = "ama@example.com"
    if eligible != "unknown":
        user.email = address
        user.is_email_verified = eligible != "unverified"
        user.is_active = eligible != "inactive"
        user.save()
    if eligible == "ambiguous":
        make_account("0241234567", email=address.upper(), is_email_verified=True)
    response = post(APIClient(), RESET, identifier=address)
    assert response.status_code == 201, response.data
    assert "challenge_id" in response.data
    assert not mailoutbox
    assert not AuthChallenge.objects.exists()


def test_reset_proof_is_invalid_after_password_changes(user, sms):
    api = APIClient()
    sign_in(api, user=user)
    started = post(APIClient(), RESET, identifier=user.phone)
    verified = post(
        APIClient(), RESET + "verify/", challenge_id=started.data["challenge_id"],
        code=sms.outbox[-1].body.split()[0],
    )
    assert verified.status_code == 200, verified.data
    changed = post(
        api, "/api/v1/me/password/", current_password=TEST_PASSWORD, new_password=NEW_PASSWORD,
    )
    assert changed.status_code == 200, changed.data
    refused = post(
        APIClient(), RESET + "complete/", reset_token=verified.data["reset_token"],
        new_password=TEST_PASSWORD,
    )
    assert refused.status_code >= 400
    user.refresh_from_db()
    assert user.check_password(NEW_PASSWORD)
