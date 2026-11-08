"""Opt-in notification email, configured through Management's encrypted settings."""

from __future__ import annotations

import logging

import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import EmailMessage, get_connection
from django.utils import timezone
from django.utils.html import format_html

from .models import Notification
from .services import alert_wanted, preferences_for

logger = logging.getLogger("notifications")


def send_email_alert(notification_id) -> None:
    from apps.operations.configuration import value

    notification = Notification.objects.select_related("user").filter(id=notification_id).first()
    if notification is None or notification.email_sent_at is not None:
        return
    user = notification.user
    if not user.is_active or not user.email or not user.is_email_verified:
        return
    preference = preferences_for(user)
    if not preference.email_enabled or not alert_wanted(preference, notification.kind):
        return

    def failed(reason):
        Notification.objects.filter(id=notification.id).update(email_failed_reason=reason[:200])
        logger.warning(
            "notification email failed", extra={"event": "notify_email_failed", "error": reason}
        )

    try:
        provider = value("NOTIFICATION_EMAIL_BACKEND", "")
        if provider not in {"brevo", "resend"}:
            return
        footer = "Open Danpa HQ for details. Change email alerts in Settings > Preferences."
        if provider == "resend":
            connection = get_connection("apps.identity.email_backend.ResendEmailBackend")
            sent = EmailMessage(
                notification.title, f"{notification.body}\n\n{footer}",
                settings.DEFAULT_FROM_EMAIL, [user.email], connection=connection,
            ).send()
            if sent != 1:
                failed("Resend did not confirm acceptance")
                return
            Notification.objects.filter(id=notification.id).update(
                email_sent_at=timezone.now(), email_failed_reason=""
            )
            return
        api_key = str(value("BREVO_API_KEY", "")).strip()
        sender = str(value("BREVO_SENDER_EMAIL", "")).strip()
        if not api_key or not sender:
            failed("Brevo API key or sender is not configured")
            return
        response = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": api_key, "Accept": "application/json"},
            json={
                "sender": {
                    "email": sender,
                    "name": str(value("BREVO_SENDER_NAME", "Danpa HQ")) or "Danpa HQ",
                },
                "to": [{"email": user.email}],
                "subject": notification.title,
                "textContent": f"{notification.body}\n\n{footer}",
                "htmlContent": str(format_html(
                    "<h1>{}</h1><p>{}</p><p>{}</p>",
                    notification.title, notification.body, footer,
                )),
            },
            timeout=(5, 10),
        )
        response.raise_for_status()
        receipt = response.json()
        if not isinstance(receipt, dict) or not receipt.get("messageId"):
            failed("Brevo did not confirm acceptance")
            return
    except (
        requests.RequestException, ValueError, TypeError, RuntimeError, ImproperlyConfigured
    ) as exc:
        # Provider response bodies and exception messages can contain keys or addresses.
        failed(type(exc).__name__)
        return
    Notification.objects.filter(id=notification.id).update(
        email_sent_at=timezone.now(), email_failed_reason=""
    )
