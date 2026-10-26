"""Email transport uses HTTPS, preserves recipient privacy and fails closed."""

from types import SimpleNamespace

import pytest
import requests
from django.core.mail import EmailMessage

from apps.identity import email_backend


def test_sends_text_email_over_https(monkeypatch, settings):
    settings.RESEND_API_KEY = "test-key"
    seen = {}

    def post(url, *, headers, json, timeout):
        seen.update(url=url, headers=headers, payload=json, timeout=timeout)
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"id": "mail-1"})

    monkeypatch.setattr(email_backend.requests, "post", post)
    message = EmailMessage("Verify", "123456", "Danpa HQ <no-reply@oskec.com>", ["a@example.com"])
    assert email_backend.ResendEmailBackend().send_messages([message]) == 1
    assert seen["url"] == "https://api.resend.com/emails"
    assert seen["headers"] == {"Authorization": "Bearer test-key"}
    assert seen["payload"]["text"] == "123456"
    assert seen["payload"]["to"] == ["a@example.com"]


def test_delivery_error_is_not_counted_as_sent(monkeypatch, settings):
    settings.RESEND_API_KEY = "test-key"

    def fail(*args, **kwargs):
        raise requests.Timeout()

    monkeypatch.setattr(email_backend.requests, "post", fail)
    message = EmailMessage("Verify", "123456", "a@example.com", ["b@example.com"])
    with pytest.raises(requests.Timeout):
        email_backend.ResendEmailBackend().send_messages([message])
    assert email_backend.ResendEmailBackend(fail_silently=True).send_messages([message]) == 0
