"""Creating and delivering notifications.

``notify()`` is the only way in. It writes the in-app record and then attempts
the other channels, in that order and never the reverse: the in-app record is
the thing we can guarantee, and it must exist even if every external provider is
down or absent.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from .models import Notification, NotificationKey, NotificationPreference

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
    "lease.expiring",
    "account.deletion_declined",
    # The tenant is asked to act; the provider is told their fix did not hold.
    "maintenance.awaiting_confirmation",
    "maintenance.reopened",
}

#: The alerts a person can choose between, in the order they are offered.
#: ``prefixes`` match notification kinds; the first matching topic wins, so the
#: narrower ``lease.expiring`` sits before the general ``lease.``.
#: Reminders about something still live on its own page — a viewing about to
#: start, check-in open, rent coming due or late, a lease nearing its end.
#: They are informational: once read they have done their job and are deleted.
#: Everything else is *activity* — something happened to a record.
INFORMATIONAL_KINDS = frozenset({
    "viewing.approaching",
    "viewing.checkin_available",
    "rent.payment_due_soon",
    "rent.payment_due_now",
    "rent.payment_overdue",
    "lease.expiring",
})



def is_informational(kind: str) -> bool:
    return kind in INFORMATIONAL_KINDS


ALERT_TOPICS: list[dict] = [
    {
        "key": "payments",
        "label": "Payments",
        "description": "Rent due and overdue, payments received, recorded or disputed.",
        "prefixes": ("rent.", "payment.", "billing."),
    },
    {
        "key": "lease_expiry",
        "label": "Lease expiry",
        "description": "When a lease is 60, 30 and 7 days from its end date.",
        "prefixes": ("lease.expiring",),
    },
    {
        "key": "leases",
        "label": "Agreements",
        "description": "Agreements offered, accepted, activated or ended.",
        "prefixes": ("lease.",),
    },
    {
        "key": "requests",
        "label": "Tenancy requests",
        "description": "New applications and requests, and decisions on them.",
        "prefixes": ("application.", "tenancy_request.", "property_invitation."),
    },
    {
        "key": "maintenance",
        "label": "Maintenance",
        "description": "Repairs reported, started, fixed, confirmed or reopened.",
        "prefixes": ("maintenance.",),
    },
    {
        "key": "viewings",
        "label": "Viewings",
        "description": "Requests, confirmed times, reminders and check-ins.",
        "prefixes": ("viewing.",),
    },
    {
        "key": "enquiries",
        "label": "Enquiries",
        "description": "New enquiries and replies about a property for sale.",
        "prefixes": ("sale.",),
    },
    {
        "key": "account",
        "label": "Team and account",
        "description": "Portfolio invitations and changes to your access.",
        "prefixes": ("organization.", "account."),
    },
]

ALERT_KEYS = [topic["key"] for topic in ALERT_TOPICS]


def topic_for(kind: str) -> str | None:
    for topic in ALERT_TOPICS:
        if kind.startswith(topic["prefixes"]):
            return topic["key"]
    return None


def alert_wanted(preference: NotificationPreference, kind: str) -> bool:
    """Whether this kind may interrupt the person outside the app."""
    topic = topic_for(kind)
    return topic is None or bool((preference.alerts or {}).get(topic, True))


def alerts_for(preference: NotificationPreference) -> dict[str, bool]:
    chosen = preference.alerts or {}
    return {key: bool(chosen.get(key, True)) for key in ALERT_KEYS}


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
            # The key outlives the row (models.NotificationKey): a reminder
            # deleted after reading must still count as sent.
            NotificationKey.objects.create(key=dedupe_key[:120])
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
    prune(user=user)
    return notification


def _try_sms(notification: Notification) -> None:
    """Best effort. A failed text must never lose the in-app record."""
    preference = preferences_for(notification.user)
    if not preference.sms_enabled:
        return
    if preference.sms_important_only and notification.kind not in IMPORTANT_KINDS:
        return
    if not alert_wanted(preference, notification.kind):
        return

    try:
        from apps.identity.providers import get_sms_provider

        provider = get_sms_provider()
        result = provider.send(
            to=preference.sms_number or notification.user.phone,
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
    """Mark some or all of a person's notifications read, then let go of them.

    Reading is what ends a reminder's life, so the prune runs here.
    """
    queryset = Notification.objects.filter(user=user, read_at__isnull=True)
    if notification_ids:
        queryset = queryset.filter(id__in=notification_ids)
    marked = queryset.update(read_at=timezone.now())
    prune(user=user)
    return marked


def prune(*, user) -> int:
    """Delete acknowledged informational alerts; retain all activity."""
    informational = Q(kind__in=INFORMATIONAL_KINDS)
    read = Notification.objects.filter(user=user, read_at__isnull=False)
    reminders, _ = read.filter(informational).delete()
    return reminders


#: Unread longer than this, a notification is history (owner, 2026-10-05). A
#: record cannot tell when the agreement, viewing or payment it was about was
#: dealt with — and almost always it has been — so "an agreement to look at"
#: from August would otherwise sit in the badge forever (a tenant had 72).
#: The thing itself is never lost: Home and each record's page read live state.
STALE_AFTER_DAYS = 14


def age_out(*, user=None) -> int:
    """Mark notifications unread for longer than ``STALE_AFTER_DAYS`` as read.

    Activity stays in history. Informational alerts wait for an explicit read
    or dismissal, regardless of age. For one person on each read of their
    list, and for everyone in the daily sweep. Returns how many were aged out.
    """
    cutoff = timezone.now() - timedelta(days=STALE_AFTER_DAYS)
    stale = Notification.objects.filter(read_at__isnull=True, created_at__lt=cutoff).exclude(
        kind__in=INFORMATIONAL_KINDS
    )
    if user is not None:
        stale = stale.filter(user=user)
        people = [user]
    else:
        from apps.identity.models import User  # function-scope cross-domain import

        people = list(User.objects.filter(id__in=stale.values("user_id").distinct()))
    marked = stale.update(read_at=timezone.now())
    if marked:
        for person in people:
            prune(user=person)
    return marked


def unread_count(*, user) -> int:
    return Notification.objects.filter(user=user, read_at__isnull=True).count()
