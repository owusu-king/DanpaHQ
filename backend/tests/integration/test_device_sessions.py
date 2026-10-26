"""Device listings describe current access; refresh expiry is a sliding 30 days."""

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import PermissionDenied
from apps.identity import services
from apps.identity.models import Device, Session
from apps.identity.tasks import purge_expired_sessions

pytestmark = pytest.mark.django_db


def test_mobile_devices_exclude_history_and_keep_distinct_matching_names(user, sign_in_as):
    api = APIClient()
    current = sign_in_as(api, user=user, device_fingerprint="current")
    other = sign_in_as(user=user, device_fingerprint="second")
    ended = sign_in_as(user=user, device_fingerprint="old-installation")
    services.sign_out(session=ended["session"])
    expired = sign_in_as(user=user, device_fingerprint="expired")
    Session.objects.filter(id=expired["session"].id).update(expires_at=timezone.now())
    Device.objects.filter(user=user).update(label="Pixel")
    Device.objects.create(user=user, fingerprint="abandoned", platform="android", label="Pixel")
    # Rotation leaves history, never another listed installation.
    services.rotate_session(refresh_token=other["refresh_token"])

    response = api.get("/api/v1/me/devices/")
    assert response.status_code == 200
    assert {row["id"] for row in response.data} == {
        str(current["device"].id),
        str(other["device"].id),
    }
    assert sum(row["is_current"] for row in response.data) == 1
    status = api.get("/api/v1/me/security/")
    assert status.status_code == 200
    assert status.data["active_sessions"] == status.data["devices"] == 2


@pytest.mark.parametrize("days", [30, 31])
def test_inactive_refresh_is_refused_at_thirty_days(user, sign_in_as, days):
    result = sign_in_as(user=user)
    expires = result["session"].expires_at
    with (
        patch("django.utils.timezone.now", return_value=expires + timedelta(days=days - 30)),
        pytest.raises(PermissionDenied, match="expired"),
    ):
        services.rotate_session(refresh_token=result["refresh_token"])
    assert Session.objects.filter(user=user).count() == 1


def test_active_session_gets_another_thirty_days(user, sign_in_as):
    result = sign_in_as(user=user)
    later = result["session"].expires_at - timedelta(days=1)
    with patch("django.utils.timezone.now", return_value=later):
        renewed = services.rotate_session(refresh_token=result["refresh_token"])
    assert renewed["session"].expires_at == later + timedelta(days=30)
    result["device"].refresh_from_db()
    assert result["device"].last_seen_at == later
    with patch("django.utils.timezone.now", return_value=later + timedelta(days=2)):
        assert services.rotate_session(refresh_token=renewed["refresh_token"])["session"].is_active


def test_expired_session_cannot_read_security_and_is_retired(user, sign_in_as):
    api = APIClient()
    result = sign_in_as(api, user=user)
    Session.objects.filter(id=result["session"].id).update(expires_at=timezone.now())
    assert api.get("/api/v1/me/devices/").status_code == 401
    assert purge_expired_sessions()["marked_expired"] == 1
    result["session"].refresh_from_db()
    assert result["session"].revoked_reason == "session_expired"
    assert not result["session"].is_active
