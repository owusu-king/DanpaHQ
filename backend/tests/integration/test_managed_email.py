"""Management switches real delivery paths without restarts or exposing secrets."""

from unittest.mock import Mock

import pytest
import requests
from django.core.mail import send_mail

from apps.notifications.email import send_email_alert
from apps.notifications.services import notify, preferences_for
from apps.operations.models import ConfigurationValue
from tests.integration.test_runtime_configuration_and_support import management_client

pytestmark = pytest.mark.django_db


def configure(client, provider):
    return client.patch(
        "/api/v1/management/configuration/",
        {"updates": [
            {"key": "NOTIFICATION_EMAIL_BACKEND", "value": provider},
            {"key": f"{provider.upper()}_API_KEY", "value": f"private-{provider}-key"},
            {"key": f"{provider.upper()}_SENDER_EMAIL", "value": f"{provider}@example.com"},
            {"key": f"{provider.upper()}_SENDER_NAME", "value": "Danpa HQ"},
        ]},
        format="json",
    )


def test_management_switches_both_account_mail_and_alerts(settings, monkeypatch, user):
    settings.RUNTIME_CONFIGURATION_ENABLED = True
    settings.EMAIL_BACKEND = "apps.identity.email_backend.ManagementEmailBackend"
    settings.RESEND_API_KEY = ""
    settings.BREVO_API_KEY = ""
    _, client = management_client(email="managed-email@example.com")
    post = Mock()
    monkeypatch.setattr("apps.identity.email_backend.requests.post", post)
    user.email = "recipient@example.com"
    user.is_email_verified = True
    user.save()
    preference = preferences_for(user)
    preference.email_enabled = True
    preference.save()

    for provider, receipt in (("brevo", {"messageId": "accepted"}), ("resend", {"id": "accepted"})):
        response = configure(client, provider)
        assert response.status_code == 200, response.data
        assert f"private-{provider}-key" not in str(response.data)
        assert ConfigurationValue.objects.get(key=f"{provider.upper()}_API_KEY").value.startswith(
            "fernet:"
        )
        post.return_value = Mock(json=lambda result=receipt: result)
        post.reset_mock()
        assert send_mail("Verify", "123456", "default@example.com", [user.email]) == 1
        assert provider in post.call_args.args[0]
        note = notify(
            user=user, kind="rent.payment_due_now", title="Rent due", body="Open the app",
            dedupe_key=f"managed-email-{provider}",
        )
        send_email_alert(note.id)
        note.refresh_from_db()
        assert note.email_sent_at is not None
        assert provider in post.call_args.args[0]
        payload = post.call_args.kwargs["json"]
        if provider == "resend":
            assert payload["from"] == "Danpa HQ <resend@example.com>"
            assert payload["to"] == [user.email]
        else:
            assert payload["sender"]["email"] == "brevo@example.com"

    preference.email_enabled = False
    preference.save()
    note = notify(
        user=user, kind="rent.payment_due_now", title="Rent due", body="Open the app",
        dedupe_key="managed-email-opt-out",
    )
    post.reset_mock()
    send_email_alert(note.id)
    post.assert_not_called()
    assert send_mail("Verify", "123456", "default@example.com", [user.email]) == 1


def test_managed_failure_does_not_fallback_or_expose_secrets(settings, monkeypatch, caplog, user):
    settings.RUNTIME_CONFIGURATION_ENABLED = True
    _, client = management_client(email="managed-email-failure@example.com")
    assert configure(client, "resend").status_code == 200
    user.email = "recipient@example.com"
    user.is_email_verified = True
    user.save()
    preference = preferences_for(user)
    preference.email_enabled = True
    preference.save()
    post = Mock(side_effect=requests.Timeout("private-resend-key recipient@example.com"))
    monkeypatch.setattr("apps.identity.email_backend.requests.post", post)
    note = notify(
        user=user, kind="rent.payment_due_now", title="Rent due", body="Private body",
        dedupe_key="managed-email-failure",
    )
    send_email_alert(note.id)
    assert post.call_count == 1
    assert "resend" in post.call_args.args[0]
    note.refresh_from_db()
    assert note.email_sent_at is None
    assert note.email_failed_reason
    assert "private-resend-key" not in caplog.text
    assert user.email not in caplog.text
