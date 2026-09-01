"""Telling people things happened.

Until now every workflow in this product was silent: a landlord found out about
a viewing request by opening the console, which is not how anyone works. This
module turns domain events into messages.

Two design points carry most of the weight:

* **In-app is the channel that works today.** It needs no provider, no
  credentials and no delivery contract with anyone, so the product stops being
  silent immediately. SMS goes through the adapter that already exists for OTP
  and prints to the log in development; push is defined and not built. Nothing
  here claims a message reached a phone.
* **Delivery is idempotent by construction.** The outbox retries a failed
  handler, and a handler that has already sent an SMS would send it twice. Every
  notification carries a dedupe key derived from the event and the recipient,
  with a unique index behind it, so a retry is a no-op rather than a second
  message at two in the morning.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel


class NotificationChannel(models.TextChoices):
    IN_APP = "in_app", "In the app"
    SMS = "sms", "Text message"
    PUSH = "push", "Push notification"


class Notification(BaseModel):
    user = models.ForeignKey(
        "identity.User", on_delete=models.CASCADE, related_name="notifications"
    )

    #: The event that caused this, e.g. "viewing.requested". Kept as the raw
    #: name so a new event type does not need a migration.
    kind = models.CharField(max_length=64)
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=300)

    #: Where tapping it should land. Deliberately a loose pair rather than a
    #: generic foreign key: notifications point at several unrelated tables and
    #: must survive the target being withdrawn.
    target_type = models.CharField(max_length=32, blank=True)
    target_id = models.CharField(max_length=64, blank=True)

    read_at = models.DateTimeField(null=True, blank=True)

    #: What actually went out, per channel. Null means not attempted.
    sms_sent_at = models.DateTimeField(null=True, blank=True)
    sms_failed_reason = models.CharField(max_length=200, blank=True)
    push_sent_at = models.DateTimeField(null=True, blank=True)

    #: event id + recipient. The unique index is what makes an outbox retry
    #: harmless.
    dedupe_key = models.CharField(max_length=120, unique=True)

    class Meta:
        db_table = "notification"
        ordering = ("-created_at",)
        indexes = [
            models.Index(
                fields=["user", "-created_at"],
                name="notification_unread_idx",
                condition=models.Q(read_at__isnull=True),
            ),
            models.Index(fields=["user", "-created_at"], name="notification_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.kind} for {self.user_id}"

    @property
    def is_read(self) -> bool:
        return self.read_at is not None


class NotificationPreference(BaseModel):
    """What a person wants to be told, and how.

    SMS costs the platform money and costs the user attention, and on a metered
    connection a push is not free either. Defaulting everything on and offering
    no way off is how an app ends up muted at the OS level, after which nothing
    reaches the user at all.
    """

    user = models.OneToOneField(
        "identity.User", on_delete=models.CASCADE, related_name="notification_preference"
    )
    sms_enabled = models.BooleanField(default=True)
    push_enabled = models.BooleanField(default=True)
    #: Even with SMS on, only the things worth a text: a confirmed viewing, a
    #: decision on an application. Chatter stays in the app.
    sms_important_only = models.BooleanField(default=True)

    class Meta:
        db_table = "notification_preference"

    def __str__(self) -> str:
        return f"preferences for {self.user_id}"
