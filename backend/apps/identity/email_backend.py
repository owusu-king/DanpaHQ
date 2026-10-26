"""Transactional email over HTTPS for hosts that block outbound SMTP."""

from __future__ import annotations

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

RESEND_URL = "https://api.resend.com/emails"


class ResendEmailBackend(BaseEmailBackend):
    """Django email backend for Resend; never log addresses, codes or API keys."""

    def send_messages(self, email_messages):
        if not email_messages:
            return 0
        api_key = getattr(settings, "RESEND_API_KEY", "")
        if not api_key:
            if self.fail_silently:
                return 0
            raise RuntimeError("RESEND_API_KEY is not configured")

        sent = 0
        for message in email_messages:
            if message.attachments:
                if self.fail_silently:
                    continue
                raise ValueError("The Resend email backend does not support attachments")
            payload = {
                "from": message.from_email,
                "to": list(message.to),
                "subject": message.subject,
                "text": message.body,
            }
            if message.cc:
                payload["cc"] = list(message.cc)
            if message.bcc:
                payload["bcc"] = list(message.bcc)
            try:
                response = requests.post(
                    RESEND_URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=payload,
                    timeout=(5, 10),
                )
                response.raise_for_status()
                receipt = response.json()
                if not isinstance(receipt, dict) or not receipt.get("id"):
                    raise ValueError("Email provider did not confirm acceptance")
            except (requests.RequestException, ValueError):
                if self.fail_silently:
                    continue
                raise
            sent += 1
        return sent


class BrevoEmailBackend(BaseEmailBackend):
    """Account mail using the same encrypted Management settings as alerts."""

    def send_messages(self, email_messages):
        from apps.operations.configuration import value

        if not email_messages:
            return 0
        api_key = str(value("BREVO_API_KEY", "")).strip()
        sender = str(value("BREVO_SENDER_EMAIL", "")).strip()
        if not api_key or not sender:
            if self.fail_silently:
                return 0
            raise RuntimeError("Brevo API key or sender is not configured")
        sent = 0
        for message in email_messages:
            try:
                if message.attachments:
                    raise ValueError("The Brevo email backend does not support attachments")
                response = requests.post(
                    "https://api.brevo.com/v3/smtp/email",
                    headers={"api-key": api_key, "Accept": "application/json"},
                    json={
                        "sender": {
                            "email": sender,
                            "name": str(value("BREVO_SENDER_NAME", "Danpa HQ")) or "Danpa HQ",
                        },
                        "to": [{"email": address} for address in message.to],
                        **(
                            {"cc": [{"email": address} for address in message.cc]}
                            if message.cc else {}
                        ),
                        **(
                            {"bcc": [{"email": address} for address in message.bcc]}
                            if message.bcc else {}
                        ),
                        "subject": message.subject,
                        "textContent": message.body,
                    },
                    timeout=(5, 10),
                )
                response.raise_for_status()
                receipt = response.json()
                if not isinstance(receipt, dict) or not receipt.get("messageId"):
                    raise ValueError("Email provider did not confirm acceptance")
            except (requests.RequestException, ValueError):
                if self.fail_silently:
                    continue
                raise
            sent += 1
        return sent
