"""Exercise FCM through the API, inbox and outbox with a stubbed network send."""

import json
from unittest.mock import Mock

import firebase_admin
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.db import transaction
from firebase_admin import messaging
from google.auth.exceptions import DefaultCredentialsError
from rest_framework.test import APIClient

from apps.notifications.firebase_push import firebase_app
from apps.notifications.models import Notification, PushDelivery
from apps.notifications.services import notify, preferences_for
from apps.outbox.models import OutboxEvent
from apps.outbox.tasks import dispatch_pending

pytestmark = pytest.mark.django_db
EVENT = "notification.push_requested.v1"


def test_application_default_credentials_load_the_mounted_file(settings, monkeypatch, tmp_path):
    settings.FIREBASE_SERVICE_ACCOUNT_JSON = ""
    secret_file = tmp_path / "firebase.json"
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(secret_file))
    firebase_app.cache_clear()
    try:
        with pytest.raises(DefaultCredentialsError):
            firebase_app()

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        secret_file.write_text(
            json.dumps(
                {
                    "type": "service_account",
                    "project_id": "danpa-test",
                    "client_email": "push@danpa-test.iam.gserviceaccount.com",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "private_key": key.private_bytes(
                        serialization.Encoding.PEM,
                        serialization.PrivateFormat.PKCS8,
                        serialization.NoEncryption(),
                    ).decode(),
                }
            ),
            encoding="utf-8",
        )
        app = firebase_app()
        assert app.project_id == "danpa-test"
        assert firebase_app() is app
    finally:
        firebase_admin.delete_app(firebase_admin.get_app("danpa-push"))
        firebase_app.cache_clear()


@pytest.fixture
def send(settings, monkeypatch):
    settings.FCM_PUSH_ENABLED = True
    settings.EXPO_PUSH_ENABLED = False
    provider = Mock(return_value="accepted")
    monkeypatch.setattr("apps.notifications.firebase_push.firebase_app", lambda: object())
    monkeypatch.setattr(messaging, "send", provider)
    return provider


def register(client, user, token):
    return client.put(
        "/api/v1/me/push-token/",
        {"recipient_id": str(user.id), "token": f"fcm:{token}"},
        format="json",
    )


def message(user, key="fcm-message"):
    return notify(
        user=user, kind="sale.enquiry_replied", title="Private title", body="Private body",
        dedupe_key=key, target_type="sale_enquiry", target_id="conversation",
        message_sender="Private sender",
    )


def test_outbox_fans_out_to_live_devices_and_replay_skips_previous_sends(
    user, landlord, sign_in_as, send,
):
    for account, token in [(user, "first"), (user, "second"), (landlord, "other")]:
        client = APIClient()
        sign_in_as(client, user=account, device_fingerprint=token)
        assert register(client, account, token).status_code == 200

    note = message(user)
    assert message(user) is None
    event = OutboxEvent.objects.get(name=EVENT)
    send.assert_not_called()
    assert dispatch_pending()["failed"] == 0
    assert {call.args[0].token for call in send.call_args_list} == {"first", "second"}
    payload = send.call_args.args[0]
    encoded = json.loads(str(payload))
    assert encoded["data"]["recipient_id"] == str(user.id)
    assert encoded["data"]["target_id"] == "conversation"
    assert json.loads(encoded["android"]["data"]["body"]) == encoded["data"]
    assert encoded["apns"]["payload"]["body"] == encoded["data"]
    assert "Private" not in str(payload)
    note.refresh_from_db()
    assert note.push_sent_at is not None
    OutboxEvent.objects.filter(pk=event.pk).update(status="pending")
    dispatch_pending()
    assert send.call_count == 2


def test_quota_retry_and_unregistered_token_cleanup(user, sign_in_as, send):
    client = APIClient()
    device = sign_in_as(client, user=user)["device"]
    assert register(client, user, "expired").status_code == 200
    notification = message(user)
    send.side_effect = messaging.QuotaExceededError("secret response")
    assert dispatch_pending()["failed"] == 1
    event = OutboxEvent.objects.get(name=EVENT)
    assert "secret response" not in event.last_error
    assert not PushDelivery.objects.filter(notification=notification).exists()
    OutboxEvent.objects.filter(pk=event.pk).update(available_at=event.created_at)
    send.side_effect = messaging.UnregisteredError("secret response")
    assert dispatch_pending()["failed"] == 0
    device.refresh_from_db()
    assert device.push_token == ""
    assert Notification.objects.filter(pk=notification.pk, push_sent_at__isnull=True).exists()


def test_rotation_account_switch_and_logout(user, landlord, sign_in_as, send):
    old, new = APIClient(), APIClient()
    old_device = sign_in_as(old, user=user)["device"]
    new_device = sign_in_as(new, user=landlord)["device"]
    assert register(old, user, "original").status_code == 200
    assert register(old, user, "rotated").status_code == 200
    assert register(new, user, "rotated").status_code == 422
    assert register(new, landlord, "rotated").status_code == 200
    old_device.refresh_from_db()
    assert old_device.push_token == ""
    assert new.post("/api/v1/auth/sign-out/", {}, format="json").status_code == 204
    new_device.refresh_from_db()
    assert new_device.push_token == ""
    message(user)
    message(landlord, "other-account")
    dispatch_pending()
    send.assert_not_called()


def test_unknown_provider_outcome_does_not_duplicate_on_replay(user, sign_in_as, send):
    client = APIClient()
    sign_in_as(client, user=user)
    assert register(client, user, "phone").status_code == 200
    note = message(user)
    send.side_effect = TimeoutError("Provider outcome unknown")
    dispatch_pending()
    OutboxEvent.objects.filter(name=EVENT).update(status="pending")
    dispatch_pending()
    send.assert_called_once()
    assert PushDelivery.objects.filter(notification=note).exists()
    assert Notification.objects.filter(id=note.id, push_sent_at__isnull=True).exists()


def test_rollback_and_topic_opt_out(user, sign_in_as, send):
    client = APIClient()
    sign_in_as(client, user=user)
    assert register(client, user, "phone").status_code == 200
    with transaction.atomic():
        rolled_back_id = message(user, "rolled-back").id
        transaction.set_rollback(True)
    assert not OutboxEvent.objects.filter(name=EVENT, aggregate_id=rolled_back_id).exists()
    assert not Notification.objects.filter(id=rolled_back_id).exists()
    preference = preferences_for(user)
    preference.alerts = {"enquiries": False}
    preference.save(update_fields=["alerts"])
    message(user)
    dispatch_pending()
    send.assert_not_called()
