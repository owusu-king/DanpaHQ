from unittest.mock import Mock

import pytest
import requests
from rest_framework.test import APIClient

from apps.notifications.email import send_email_alert
from apps.notifications.models import Notification
from apps.notifications.services import notify, preferences_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def recipient(user):
    user.email = "recipient@example.com"
    user.is_email_verified = True
    user.save(update_fields=["email", "is_email_verified"])
    preference = preferences_for(user)
    preference.email_enabled = True
    preference.save(update_fields=["email_enabled"])
    return user


@pytest.fixture
def brevo(settings, monkeypatch):
    settings.NOTIFICATION_EMAIL_BACKEND = "brevo"
    settings.BREVO_API_KEY = "private-brevo-test-key"
    settings.BREVO_SENDER_EMAIL = "alerts@example.com"
    settings.BREVO_SENDER_NAME = "Danpa HQ"
    post = Mock(return_value=Mock(json=lambda: {"messageId": "brevo-accepted"}))
    monkeypatch.setattr("apps.notifications.email.requests.post", post)
    return post


def notification(user, *, kind="rent.payment_due_now"):
    return notify(
        user=user, kind=kind, title="A payment is due today",
        body="Rent for <Your home> is due.", dedupe_key="email-event:recipient",
        target_type="lease", target_id="lease-id",
    )


@pytest.mark.parametrize("kind", ["rent.payment_due_now", "viewing.approaching", "lease.expiring"])
def test_existing_reminder_kinds_send_private_email_after_commit(
    recipient, brevo, django_capture_on_commit_callbacks, kind,
):
    with django_capture_on_commit_callbacks(execute=True):
        note = notification(recipient, kind=kind)
        brevo.assert_not_called()
    brevo.assert_called_once()
    request = brevo.call_args.kwargs
    assert request["headers"]["api-key"] == "private-brevo-test-key"
    assert request["json"]["to"] == [{"email": recipient.email}]
    assert request["json"]["sender"] == {"email": "alerts@example.com", "name": "Danpa HQ"}
    assert request["json"]["subject"] == note.title
    assert "&lt;Your home&gt;" in request["json"]["htmlContent"]
    assert "Settings > Preferences" in request["json"]["textContent"]
    note.refresh_from_db()
    assert note.email_sent_at is not None
    assert note.email_failed_reason == ""


@pytest.mark.parametrize("reason", ["opt_out", "topic_off", "unverified", "no_email", "inactive"])
def test_email_eligibility_is_rechecked_when_delivery_runs(recipient, brevo, reason):
    note = notification(recipient)
    preference = preferences_for(recipient)
    if reason == "opt_out":
        preference.email_enabled = False
    elif reason == "topic_off":
        preference.alerts = {"payments": False}
    elif reason == "unverified":
        recipient.is_email_verified = False
    elif reason == "no_email":
        recipient.email = None
    else:
        recipient.is_active = False
    preference.save()
    recipient.save()
    send_email_alert(note.id)
    brevo.assert_not_called()
    assert Notification.objects.filter(id=note.id).exists()


def test_email_starts_off_and_other_accounts_are_not_emailed(user, landlord, brevo):
    landlord.email = "different@example.com"
    landlord.is_email_verified = True
    landlord.save()
    preference = preferences_for(landlord)
    preference.email_enabled = True
    preference.save()
    assert preferences_for(user).email_enabled is False
    send_email_alert(notification(user).id)
    brevo.assert_not_called()


def test_provider_disabled_or_incomplete_does_not_send(recipient, brevo, settings):
    note = notification(recipient)
    settings.NOTIFICATION_EMAIL_BACKEND = ""
    send_email_alert(note.id)
    brevo.assert_not_called()
    settings.NOTIFICATION_EMAIL_BACKEND = "brevo"
    settings.BREVO_API_KEY = ""
    send_email_alert(note.id)
    brevo.assert_not_called()
    note.refresh_from_db()
    assert "not configured" in note.email_failed_reason


@pytest.mark.parametrize("failure", ["timeout", "rejected", "malformed"])
def test_provider_failures_never_lose_the_inbox_or_log_sensitive_details(
    recipient, brevo, django_capture_on_commit_callbacks, caplog, failure,
):
    secret = "private-brevo-test-key"
    if failure == "timeout":
        brevo.side_effect = requests.Timeout(f"{secret}: {recipient.email}")
    elif failure == "rejected":
        brevo.return_value.raise_for_status.side_effect = requests.HTTPError(secret)
    else:
        brevo.return_value.json = lambda: {"error": secret}
    with django_capture_on_commit_callbacks(execute=True):
        note = notification(recipient)
    note.refresh_from_db()
    assert note.email_sent_at is None
    assert note.email_failed_reason
    assert secret not in caplog.text
    assert recipient.email not in caplog.text
    assert note.body not in caplog.text


def test_outbox_redelivery_does_not_send_email_twice(
    recipient, brevo, django_capture_on_commit_callbacks,
):
    with django_capture_on_commit_callbacks(execute=True):
        note = notification(recipient)
    with django_capture_on_commit_callbacks(execute=True):
        assert notification(recipient) is None
    send_email_alert(note.id)
    brevo.assert_called_once()


def test_preferences_require_verified_email_and_cannot_change_its_destination(user, sign_in_as):
    client = APIClient()
    sign_in_as(client, user=user)
    path = "/api/v1/me/notification-preferences/"
    assert client.get(path).data["email_enabled"] is False
    assert client.patch(path, {"email_enabled": True}, format="json").status_code == 422
    user.email = "verified@example.com"
    user.is_email_verified = True
    user.save(update_fields=["email", "is_email_verified"])
    response = client.patch(
        path, {"email_enabled": True, "account_email": "attacker@example.com"}, format="json"
    )
    assert response.status_code == 200
    assert response.data["email_enabled"] is True
    assert response.data["account_email"] == "verified@example.com"
    assert response.data["account_email_verified"] is True
    response = client.patch(path, {"email_enabled": False}, format="json")
    assert response.data["email_enabled"] is False
