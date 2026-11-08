"""FCM delivery via the transactional outbox."""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from functools import lru_cache

from django.conf import settings
from django.utils import timezone

from apps.outbox.tasks import subscribe

from .models import FCM_TOKEN_PREFIX, Notification, PushDelivery
from .services import alert_wanted, preferences_for

logger = logging.getLogger("notifications")


@lru_cache(maxsize=1)
def firebase_app():
    import firebase_admin
    from firebase_admin import credentials

    credential = None
    if settings.FIREBASE_SERVICE_ACCOUNT_JSON:
        credential = credentials.Certificate(json.loads(settings.FIREBASE_SERVICE_ACCOUNT_JSON))
    try:
        app = firebase_admin.get_app("danpa-push")
    except ValueError:
        app = firebase_admin.initialize_app(credential, {"httpTimeout": 10}, name="danpa-push")
    # Application Default Credentials loads the mounted secret lazily. Resolve
    # it before recording delivery claims so a configuration failure can retry.
    app.credential.get_credential()
    return app


class PushUnavailable(RuntimeError):
    """Safe error text for the outbox's persisted failure log."""


@subscribe("notification.push_requested.v1")
def deliver_push(event) -> None:
    from apps.identity.models import Device
    from apps.identity.services import signed_in_devices

    if not settings.FCM_PUSH_ENABLED:
        return
    now = timezone.now()
    cutoff = now - timedelta(hours=1)
    notification = (
        Notification.objects.select_related("user")
        .filter(id=event.aggregate_id, user__is_active=True, created_at__gt=cutoff)
        .first()
    )
    if notification is None:
        return
    preference = preferences_for(notification.user)
    if not preference.push_enabled or not alert_wanted(preference, notification.kind):
        return

    devices = signed_in_devices(notification.user).filter(push_token__startswith=FCM_TOKEN_PREFIX)
    candidates = devices.values_list("id", "push_token").exclude(
        id__in=PushDelivery.objects.filter(notification=notification).values("device_id")
    )
    if not candidates:
        return

    try:
        from firebase_admin import messaging

        app = firebase_app()
    except Exception as exc:
        logger.warning("FCM initialization failed", extra={"error": type(exc).__name__})
        raise PushUnavailable("FCM initialization failed") from None

    retry = False
    for device_id, token in candidates:
        if not devices.filter(id=device_id, push_token=token).exists():
            continue
        claim, created = PushDelivery.objects.get_or_create(
            notification=notification, device_id=device_id
        )
        if not created:
            continue
        data = {
            "recipient_id": str(notification.user_id),
            "target_type": notification.target_type,
            "target_id": notification.target_id,
            "notification_id": str(notification.id),
        }
        title = "New enquiry activity"
        body = ""
        message = messaging.Message(
            token=token.removeprefix(FCM_TOKEN_PREFIX),
            # The OS may display a queued alert after local logout. Keep lock
            # screen text free of account and conversation information.
            data=data,
            android=messaging.AndroidConfig(
                ttl=max(timedelta(0), notification.created_at + timedelta(hours=1) - now),
                priority="high",
                data={
                    "title": title, "message": body, "body": json.dumps(data),
                    "channelId": "messages", "tag": str(notification.id),
                },
            ),
            apns=messaging.APNSConfig(
                headers={
                    "apns-collapse-id": str(notification.id),
                    "apns-expiration": str(int(notification.created_at.timestamp()) + 3600),
                    "apns-push-type": "alert",
                    "apns-priority": "10",
                },
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(
                        alert=messaging.ApsAlert(title=title, body=body), sound="default"
                    ),
                    body=data,
                ),
            ),
        )
        try:
            messaging.send(message, app=app)
        except messaging.UnregisteredError:
            Device.objects.filter(id=device_id, push_token=token).update(push_token="")
        except messaging.QuotaExceededError:
            # A quota rejection is explicit. Keep claims for ambiguous failures
            # so replay cannot send the same alert after an unknown outcome.
            claim.delete()
            retry = True
        except Exception as exc:
            logger.warning("FCM send failed", extra={"error": type(exc).__name__})
        else:
            Notification.objects.filter(id=notification.id, push_sent_at__isnull=True).update(
                push_sent_at=timezone.now()
            )
    if retry:
        raise PushUnavailable("FCM quota rejected delivery")
