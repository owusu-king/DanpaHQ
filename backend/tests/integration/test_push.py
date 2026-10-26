"""Push registration and delivery boundaries; no external provider calls."""

from unittest.mock import Mock

import pytest
import requests
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.identity.models import Device, Session
from apps.identity.services import sign_out
from apps.notifications.models import Notification
from apps.notifications.push import send_message_alert
from apps.notifications.services import notify, preferences_for

pytestmark = pytest.mark.django_db
TOKEN = "ExponentPushToken[test-recipient]"


@pytest.fixture
def phone(user, sign_in_as):
    client = APIClient()
    result = sign_in_as(client, user=user)
    device = result["device"]
    device.push_token = TOKEN
    device.save(update_fields=["push_token"])
    return client, device


@pytest.fixture
def provider(settings, monkeypatch):
    settings.EXPO_PUSH_ENABLED = True
    settings.EXPO_ACCESS_TOKEN = "test-provider-credential"
    post = Mock(return_value=Mock(json=lambda: {"data": {"status": "ok", "id": "ticket"}}))
    monkeypatch.setattr("apps.notifications.push.requests.post", post)
    return post


def note(user):
    return notify(
        user=user, kind="sale.enquiry_replied", title="Inbox title", body="Private inbox text",
        dedupe_key="message:recipient", target_type="sale_enquiry", target_id="conversation",
    )


def test_registration_is_bound_to_live_session_and_moves_token_between_accounts(
    phone, landlord, sign_in_as,
):
    _, old_device = phone
    other = APIClient()
    result = sign_in_as(other, user=landlord)
    response = other.put(
        "/api/v1/me/push-token/",
        {"token": TOKEN, "user_id": str(old_device.user_id), "device_id": str(old_device.id)},
        format="json",
    )
    assert response.status_code == 200
    old_device.refresh_from_db()
    result["device"].refresh_from_db()
    assert old_device.push_token == ""
    assert result["device"].push_token == TOKEN
    assert "token" not in response.data
    # DELETE affects this installation, not another account's devices.
    assert other.delete("/api/v1/me/push-token/").status_code == 204
    result["device"].refresh_from_db()
    assert result["device"].push_token == ""


def test_registration_rejects_bad_tokens_anonymous_and_revoked_sessions(phone):
    client, device = phone
    assert APIClient().put("/api/v1/me/push-token/", {}, format="json").status_code == 401
    response = client.put("/api/v1/me/push-token/", {"token": "not-a-token"}, format="json")
    assert response.status_code == 422
    Session.objects.filter(device=device).update(revoked_at=timezone.now())
    response = client.put("/api/v1/me/push-token/", {"token": TOKEN}, format="json")
    assert response.status_code == 401


def test_browser_sessions_cannot_register_native_tokens(user):
    from apps.identity.services import sign_in_with_password
    from tests.conftest import TEST_PASSWORD

    result = sign_in_with_password(
        raw_phone=user.phone, password=TEST_PASSWORD, device_fingerprint="browser", platform="web"
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {result['access_token']}")
    assert client.put(
        "/api/v1/me/push-token/", {"token": TOKEN}, format="json"
    ).status_code == 422


def test_database_prevents_one_token_belonging_to_two_devices(phone, landlord):
    with pytest.raises(IntegrityError), transaction.atomic():
        Device.objects.create(
            user=landlord, fingerprint="other", platform="android", push_token=TOKEN
        )


def test_push_payload_is_private_and_only_addresses_recipient(phone, user, landlord, provider):
    Device.objects.create(
        user=landlord, fingerprint="other", platform="android", push_token="ExpoPushToken[other]"
    )
    notification = note(user)
    send_message_alert(notification.id, "Ama Mensah")
    provider.assert_called_once()
    payload = provider.call_args.kwargs["json"]
    assert payload["to"] == TOKEN
    assert payload["title"] == "New message from Ama Mensah"
    assert "Private inbox text" not in str(payload)
    assert payload["data"]["recipient_id"] == str(user.id)
    assert payload["data"]["target_id"] == "conversation"
    headers = provider.call_args.kwargs["headers"]
    assert headers["Authorization"] == "Bearer test-provider-credential"
    notification.refresh_from_db()
    assert notification.push_sent_at is not None


@pytest.mark.parametrize("muted", ["push", "topic", "session", "blocked", "removed", "inactive"])
def test_muted_or_ineligible_recipients_never_reach_provider(phone, user, provider, muted):
    _, device = phone
    notification = note(user)
    preference = preferences_for(user)
    if muted == "push":
        preference.push_enabled = False
    elif muted == "topic":
        preference.alerts = {"enquiries": False}
    elif muted == "session":
        Session.objects.filter(device=device).update(revoked_at=timezone.now())
    elif muted == "blocked":
        Device.objects.filter(id=device.id).update(blocked_at=timezone.now())
    elif muted == "removed":
        Device.objects.filter(id=device.id).update(removed_at=timezone.now())
    else:
        user.is_active = False
        user.save(update_fields=["is_active"])
    preference.save()
    send_message_alert(notification.id, "Ama")
    provider.assert_not_called()
    assert Notification.objects.filter(id=notification.id).exists()


def test_provider_disabled_sends_nothing(phone, user, provider, settings):
    settings.EXPO_PUSH_ENABLED = False
    send_message_alert(note(user).id, "Ama")
    provider.assert_not_called()


def test_provider_failure_preserves_inbox_and_invalid_token_is_cleared(phone, user, provider):
    _, device = phone
    notification = note(user)
    provider.side_effect = requests.Timeout()
    send_message_alert(notification.id, "Ama")
    assert Notification.objects.filter(id=notification.id, push_sent_at__isnull=True).exists()
    provider.side_effect = None
    provider.return_value.json = lambda: {
        "data": {"status": "error", "details": {"error": "DeviceNotRegistered"}}
    }
    send_message_alert(notification.id, "Ama")
    device.refresh_from_db()
    assert device.push_token == ""


def test_sign_out_clears_token_and_stops_delivery(phone, user, provider):
    _, device = phone
    sign_out(session=Session.objects.get(device=device, revoked_at__isnull=True))
    device.refresh_from_db()
    assert device.push_token == ""
    send_message_alert(note(user).id, "Ama")
    provider.assert_not_called()


def test_message_push_waits_for_commit_and_duplicate_does_not_resend(
    phone, user, provider, django_capture_on_commit_callbacks,
):
    arguments = {
        "user": user, "kind": "sale.enquiry_replied", "title": "Message", "body": "Private",
        "dedupe_key": "one-message", "message_sender": "Ama",
    }
    with django_capture_on_commit_callbacks(execute=True):
        notify(**arguments)
        provider.assert_not_called()
    provider.assert_called_once()
    with django_capture_on_commit_callbacks(execute=True):
        assert notify(**arguments) is None
    provider.assert_called_once()
