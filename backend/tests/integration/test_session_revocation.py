from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import PermissionDenied
from apps.identity import services
from apps.identity.models import Session

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    "claims",
    [
        {"sub": "not-a-uuid"},
        {"sub": None},
        {"sid": []},
        {"sid": None},
        {"roles": "landlord"},
        {"roles": [{}]},
    ],
)
def test_malformed_signed_access_claims_are_unauthorized(user, sign_in_as, settings, claims):
    from apps.core.crypto import sign_payload, verify_payload

    signed_in = sign_in_as(user=user)
    key = settings.ACCESS_TOKEN_KEY or settings.SECRET_KEY
    payload = verify_payload(signed_in["access_token"], key=key)
    payload.update(claims)
    token = sign_payload(payload, key=key, ttl_seconds=60)
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    assert api.get("/api/v1/me/").status_code == 401


@pytest.mark.parametrize("reason", ["user_signed_out", "password_reset", "device_revoked"])
def test_revoked_access_token_cannot_read_or_mutate(user, sign_in_as, reason):
    api = APIClient()
    result = sign_in_as(api, user=user)
    assert api.get("/api/v1/me/").status_code == 200
    services.sign_out(session=result["session"], reason=reason)
    assert api.get("/api/v1/me/").status_code == 401
    assert api.patch("/api/v1/me/", {"preferred_name": "Changed"}).status_code == 401
    user.refresh_from_db()
    assert user.preferred_name != "Changed"


def test_expired_session_invalidates_unexpired_access_token(user, sign_in_as):
    api = APIClient()
    result = sign_in_as(api, user=user)
    Session.objects.filter(pk=result["session"].pk).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    assert api.get("/api/v1/me/").status_code == 401


def test_refresh_reuse_invalidates_the_successors_access_token(user, sign_in_as):
    first = sign_in_as(user=user)
    second = services.rotate_session(refresh_token=first["refresh_token"])
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {second['access_token']}")
    assert api.get("/api/v1/me/").status_code == 200
    with pytest.raises(PermissionDenied):
        services.rotate_session(refresh_token=first["refresh_token"])
    assert api.get("/api/v1/me/").status_code == 401


def test_sign_out_everywhere_preserves_only_the_selected_session(user, sign_in_as):
    current = sign_in_as(user=user, device_fingerprint="current-device")
    other = sign_in_as(user=user, device_fingerprint="other-device")
    services.sign_out_everywhere(user=user, except_session=current["session"])
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {other['access_token']}")
    assert api.get("/api/v1/me/").status_code == 401
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {current['access_token']}")
    assert api.get("/api/v1/me/").status_code == 200
