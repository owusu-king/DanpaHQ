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
