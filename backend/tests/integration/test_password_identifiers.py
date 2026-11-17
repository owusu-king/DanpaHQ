"""Both password identifiers enter the same account and session pipeline."""

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.identity.models import Session, User
from tests.conftest import TEST_PASSWORD, make_account

pytestmark = pytest.mark.django_db
URL = "/api/v1/auth/sign-in/"


def login(identifier=None, **fields):
    body = {"password": TEST_PASSWORD, "platform": "android", **fields}
    if identifier is not None:
        body["identifier"] = identifier
    return APIClient().post(URL, body, format="json")


@pytest.mark.parametrize("account_type", ["tenant", "provider"])
@pytest.mark.parametrize("identifier", ["  AMA@EXAMPLE.COM  ", "0201234567", "+233201234567"])
def test_both_identifiers_open_the_existing_account_and_refresh_session(account_type, identifier):
    user = make_account("0201234567", email="ama@example.com", account_type=account_type)
    user.is_email_verified = True
    user.save(update_fields=["is_email_verified"])
    before = User.objects.count()
    response = login(identifier, device_fingerprint="same-installation")
    assert response.status_code == 200, response.data
    assert str(response.data["user"]["id"]) == str(user.pk)
    assert User.objects.count() == before
    assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 1
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access_token']}")
    assert client.get("/api/v1/me/").status_code == 200
    refreshed = client.post(
        "/api/v1/auth/refresh/", {"refresh_token": response.data["refresh_token"]}, format="json"
    )
    assert refreshed.status_code == 200, refreshed.data


def test_legacy_phone_payload_still_works(user):
    assert login(phone=user.phone).status_code == 200


def test_password_account_with_only_email_can_sign_in(user):
    user.email = "ama@example.com"
    user.is_email_verified = True
    user.phone = None
    user.is_phone_verified = False
    user.phone_verified_at = None
    user.save()
    response = login("AMA@example.com")
    assert response.status_code == 200, response.data
    assert str(response.data["user"]["id"]) == str(user.pk)


def test_legacy_and_new_phone_formats_share_the_attempt_budget(user):
    for _ in range(5):
        assert login(phone="0201234567", password="incorrect").status_code == 403
    assert login("+233201234567", password="incorrect").status_code == 429


@pytest.mark.parametrize("identifier", ["not-an-email", "broken@", "", "123"])
def test_invalid_identifier_has_a_field_error(identifier):
    response = login(identifier)
    assert response.status_code in (400, 422)
    assert "identifier" in str(response.data)
    assert not Session.objects.exists()


def test_conflicting_identifiers_are_rejected(user):
    response = login("someone@example.com", phone=user.phone)
    assert response.status_code in (400, 422)
    assert not Session.objects.exists()


def test_wrong_and_unknown_email_credentials_are_indistinguishable(user):
    user.email = "ama@example.com"
    user.is_email_verified = True
    user.save(update_fields=["email", "is_email_verified"])
    wrong = login("ama@example.com", password="incorrect")
    unknown = login("unknown@example.com", password="incorrect")
    assert wrong.status_code == unknown.status_code == 403
    assert wrong.data["error"]["message"] == unknown.data["error"]["message"]
    assert not Session.objects.exists()


def test_ambiguous_legacy_email_never_selects_or_merges_an_account(user):
    user.email = "ama@example.com"
    user.is_email_verified = True
    user.save(update_fields=["email", "is_email_verified"])
    make_account("0241234567", email="AMA@example.com")
    before = User.objects.count()
    assert login("Ama@example.com").status_code == 403
    assert User.objects.count() == before
    assert not Session.objects.exists()


@pytest.mark.parametrize("state", ["staff", "inactive", "unfinished", "passwordless", "unverified"])
def test_email_cannot_bypass_account_restrictions(user, state):
    user.email = "ama@example.com"
    user.is_email_verified = state != "unverified"
    if state == "staff":
        user.is_staff = True
    elif state == "inactive":
        user.is_active = False
    elif state == "unfinished":
        user.first_name = ""
        user.last_name = ""
    elif state == "passwordless":
        user.set_unusable_password()
    user.save()
    assert login("ama@example.com").status_code == 403
    assert not Session.objects.exists()


def test_email_case_and_whitespace_share_one_attempt_budget():
    for _ in range(5):
        assert login("  AMA@example.com ", password="incorrect").status_code == 403
    assert login("ama@EXAMPLE.COM", password="incorrect").status_code == 429


def test_ip_budget_limits_attempts_across_different_emails():
    for index in range(30):
        assert login(f"unknown{index}@example.com").status_code == 403
    assert login("another@example.com").status_code == 429
    cache.clear()
