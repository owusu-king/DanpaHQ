"""Best-effort message alerts through Expo; the existing inbox remains authoritative."""

from __future__ import annotations

import logging

import requests
from django.conf import settings
from django.utils import timezone

from .models import Notification
from .services import alert_wanted, preferences_for

logger = logging.getLogger("notifications")


def send_message_alert(notification_id, sender_name: str) -> None:
    # Called after commit: provider failures must never roll back the message/inbox.
    from apps.identity.services import signed_in_devices

    if not settings.EXPO_PUSH_ENABLED:
        return
    notification = Notification.objects.select_related("user").filter(id=notification_id).first()
    if notification is None or not notification.user.is_active:
        return
    preference = preferences_for(notification.user)
    if not preference.push_enabled or not alert_wanted(preference, notification.kind):
        return

    headers = {"Accept": "application/json"}
    if settings.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
    for device in signed_in_devices(notification.user).exclude(push_token=""):
        token = device.push_token
        if not token.startswith(("ExpoPushToken[", "ExponentPushToken[")):
            continue
        try:
            response = requests.post(
                "https://exp.host/--/api/v2/push/send",
                headers=headers,
                json={
                    "to": token,
                    "title": (
                        notification.title if notification.kind == "sale.enquiry_received"
                        else f"New message from {sender_name[:80]}"
                    ),
                    "body": (
                        notification.body if notification.kind == "sale.enquiry_received"
                        else ""
                    ),
                    "sound": "default",
                    "channelId": "messages",
                    "priority": "high",
                    "ttl": 3600,
                    "data": {
                        "recipient_id": str(notification.user_id),
                        "target_type": notification.target_type,
                        "target_id": notification.target_id,
                    },
                },
                timeout=10,
            )
            response.raise_for_status()
            ticket = response.json().get("data", {})
            if ticket.get("status") == "ok":
                # Expo accepted this request; this is not a device delivery receipt.
                Notification.objects.filter(id=notification.id).update(push_sent_at=timezone.now())
            else:
                error = ticket.get("details", {}).get("error", "PushRejected")
                if error == "DeviceNotRegistered":
                    type(device).objects.filter(id=device.id, push_token=token).update(
                        push_token=""
                    )
                logger.warning(
                    "message push rejected", extra={"event": "push_rejected", "error": error}
                )
        except (requests.RequestException, ValueError, TypeError, AttributeError) as exc:
            # Never log a token, provider response body, or message content.
            logger.warning(
                "message push failed",
                extra={"event": "push_failed", "error": type(exc).__name__},
            )
