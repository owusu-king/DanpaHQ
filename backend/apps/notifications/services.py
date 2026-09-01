"""Creating and delivering notifications.

``notify()`` is the only way in. It writes the in-app record and then attempts
the other channels, in that order and never the reverse: the in-app record is
the thing we can guarantee, and it must exist even if every external provider is
down or absent.
"""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Notification, NotificationPreference

logger = logging.getLogger("notifications")

#: Kinds worth a text message when the recipient has asked for important-only.
#: Everything else waits in the app. A viewing being confirmed is worth a text
#: because the person has to be somewhere at a time; a request being received is
#: not, because it can wait until they next open the console.
IMPORTANT_KINDS = {
    "organization.invitation_created",
    "viewing.confirmed",
    "viewing.declined",
    "viewing.cancelled",
    "viewing.rescheduled",
    "viewing.checkin_available",
    "application.accepted",
    "application.rejected",
    "lease.offered",
    "lease.activated",
    "lease.ended",
    "rent.payment_due_now",
    "rent.payment_overdue",
    "rent.external_payment_recorded",
}


def preferences_for(user) -> NotificationPreference:
    preference, _ = NotificationPreference.objects.get_or_create(user=user)
    return preference


@transaction.atomic
def notify(
    *,
    user,
    kind: str,
    title: str,
    body: str,
    dedupe_key: str,
    target_type: str = "",
    target_id: str = "",
) -> Notification | None:
    """Record a notification and try to deliver it.

    Returns None when this exact notification already exists, which is the
    normal outcome of an outbox retry rather than an error.
    """
    try:
        with transaction.atomic():
            notification = Notification.objects.create(
                user=user,
                kind=kind,
                title=title[:120],
                body=body[:300],
                target_type=target_type,
                target_id=str(target_id or ""),
                dedupe_key=dedupe_key[:120],
            )
    except IntegrityError:
        # Already delivered. The outbox is at-least-once, so this is expected.
        logger.info("notification already sent", extra={"event": "notify_duplicate", "kind": kind})
        return None

    _try_sms(notification)
    return notification


def _try_sms(notification: Notification) -> None:
    """Best effort. A failed text must never lose the in-app record."""
    preference = preferences_for(notification.user)
    if not preference.sms_enabled:
        return
    if preference.sms_important_only and notification.kind not in IMPORTANT_KINDS:
        return

    try:
        from apps.identity.providers import get_sms_provider

        provider = get_sms_provider()
        result = provider.send(
            to=notification.user.phone,
            body=f"{notification.title}. {notification.body}",
            reference=str(notification.id),
        )
        if result.accepted:
            notification.sms_sent_at = timezone.now()
            notification.save(update_fields=["sms_sent_at", "updated_at"])
        else:
            notification.sms_failed_reason = "The provider did not accept it."
            notification.save(update_fields=["sms_failed_reason", "updated_at"])
    except Exception as exc:  # never let a delivery failure break the record
        logger.warning(
            "sms notification failed",
            extra={"event": "notify_sms_failed", "error": type(exc).__name__},
        )
        notification.sms_failed_reason = f"{type(exc).__name__}"[:200]
        notification.save(update_fields=["sms_failed_reason", "updated_at"])


def mark_read(*, user, notification_ids: list[str] | None = None) -> int:
    """Mark some or all of a person's notifications read."""
    queryset = Notification.objects.filter(user=user, read_at__isnull=True)
    if notification_ids:
        queryset = queryset.filter(id__in=notification_ids)
    return queryset.update(read_at=timezone.now())


def unread_count(*, user) -> int:
    return Notification.objects.filter(user=user, read_at__isnull=True).count()
