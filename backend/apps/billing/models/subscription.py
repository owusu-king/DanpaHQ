"""What a Portfolio is on now, and what happened to get it there."""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel


class SubscriptionStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    #: A renewal failed and the clock is running. Everything still works.
    GRACE_PERIOD = "grace_period", "Payment overdue"
    #: Grace ran out. Premium creation closes; records stay reachable.
    PAST_DUE = "past_due", "Past due"
    CANCELLED = "cancelled", "Cancelled"
    EXPIRED = "expired", "Expired"


#: The states in which a subscription still decides entitlements. A Portfolio in
#: grace is a Portfolio whose renewal is late, not one that has lost what it
#: bought — locking it out on the first failed charge punishes a bank outage.
ENTITLED_STATUSES = (SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE_PERIOD)

#: The states that still occupy the one-live-subscription slot, so a Portfolio
#: cannot quietly hold two.
LIVE_STATUSES = (
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.GRACE_PERIOD,
    SubscriptionStatus.PAST_DUE,
)


class BillingInterval(models.TextChoices):
    MONTHLY = "monthly", "Monthly"
    ANNUAL = "annual", "Annual"


class Subscription(BaseModel):
    billing_account = models.ForeignKey(
        "billing.BillingAccount", on_delete=models.PROTECT, related_name="subscriptions"
    )
    plan = models.ForeignKey("billing.Plan", on_delete=models.PROTECT, related_name="subscriptions")

    status = models.CharField(
        max_length=16, choices=SubscriptionStatus.choices, default=SubscriptionStatus.ACTIVE
    )
    billing_interval = models.CharField(
        max_length=12, choices=BillingInterval.choices, default=BillingInterval.MONTHLY
    )

    #: Free has no period end: there is nothing to renew and nothing to expire,
    #: and inventing a date would mean inventing a renewal job to move it.
    current_period_start = models.DateTimeField(null=True, blank=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)

    #: Empty for Free. **No fake provider subscription is created for a plan
    #: nobody pays for** — a `provider="none"` row that looks like a PSP record
    #: is exactly the kind of thing a later reconciliation sweep would try to
    #: match against a provider that has never heard of it.
    provider = models.CharField(max_length=40, blank=True)
    provider_customer_reference = models.CharField(max_length=120, blank=True)
    provider_subscription_reference = models.CharField(max_length=120, blank=True)

    cancelled_at = models.DateTimeField(null=True, blank=True)
    #: When grace ends. Set on entering grace so the sweep has a deadline rather
    #: than a duration it has to recompute from the failure it did not see.
    grace_expires_at = models.DateTimeField(null=True, blank=True)

    #: A cheaper paid plan this moves to when the current paid period ends. The
    #: Portfolio paid for the period it is in and keeps it. Moving to Free at the
    #: end of a period is `cancel_at_period_end`, never this.
    scheduled_plan = models.ForeignKey(
        "billing.Plan",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )

    class Meta:
        db_table = "billing_subscription"
        ordering = ("-created_at",)
        constraints = [
            # One live subscription per account. The database holds this rather
            # than a service, because two live subscriptions means two answers
            # to "what may this Portfolio do".
            models.UniqueConstraint(
                fields=["billing_account"],
                condition=models.Q(status__in=LIVE_STATUSES),
                name="billing_one_live_subscription_per_account",
            ),
            # One pending change at a time. "Cancel at period end, and also
            # move to Pro at period end" is not a state anything should have
            # to interpret.
            models.CheckConstraint(
                condition=~(
                    models.Q(cancel_at_period_end=True) & models.Q(scheduled_plan__isnull=False)
                ),
                name="billing_one_scheduled_change",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "current_period_end"], name="billing_sub_period_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.billing_account_id}:{self.plan_id}:{self.status}"

    @property
    def grants_entitlements(self) -> bool:
        return self.status in ENTITLED_STATUSES


class BillingEventType(models.TextChoices):
    SUBSCRIPTION_CREATED = "subscription_created", "Subscription created"
    PLAN_CHANGED = "plan_changed", "Plan changed"
    ENTERED_GRACE = "entered_grace", "Entered grace period"
    RESTORED = "restored", "Restored to active"
    PAST_DUE = "past_due", "Became past due"
    CANCELLED = "cancelled", "Cancelled"
    EXPIRED = "expired", "Expired"
    OVERRIDE_APPLIED = "override_applied", "Entitlement override applied"
    OVERRIDE_REMOVED = "override_removed", "Entitlement override removed"
    #: A server-confirmed payment bought the next period of the same plan.
    RENEWED = "renewed", "Renewed"
    #: A move to a cheaper paid plan, waiting for the paid period to end.
    CHANGE_SCHEDULED = "change_scheduled", "Plan change scheduled"
    SCHEDULED_CHANGE_CANCELLED = "scheduled_change_cancelled", "Scheduled change cancelled"


class BillingEvent(BaseModel):
    """The subscription's own history, in the shape billing needs to read it.

    Distinct from `audit_log` on purpose, and the distinction is worth stating
    because two histories of one thing is usually a mistake. The audit log is
    the tamper-evident, actor-centric record of *who did what* across the whole
    platform, append-only at the database. This is the billing domain's own
    queryable timeline of *what state this subscription moved through*, which is
    what a plan-history screen and revenue reporting read.

    Both are written in the same transaction. Neither is derived from the other,
    and neither may be treated as the source for the other's question.
    """

    billing_account = models.ForeignKey(
        "billing.BillingAccount", on_delete=models.PROTECT, related_name="events"
    )
    subscription = models.ForeignKey(
        Subscription, null=True, blank=True, on_delete=models.PROTECT, related_name="events"
    )
    event_type = models.CharField(max_length=32, choices=BillingEventType.choices)

    from_plan_code = models.CharField(max_length=16, blank=True)
    to_plan_code = models.CharField(max_length=16, blank=True)
    from_status = models.CharField(max_length=16, blank=True)
    to_status = models.CharField(max_length=16, blank=True)

    #: Who. Null for a scheduled transition — grace expiring is nobody's act.
    actor = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    actor_management_id = models.UUIDField(null=True, blank=True, db_index=True)
    reason = models.CharField(max_length=300, blank=True)
    occurred_at = models.DateTimeField()

    class Meta:
        db_table = "billing_event"
        ordering = ("-occurred_at",)
        indexes = [
            models.Index(
                fields=["billing_account", "-occurred_at"], name="billing_event_account_idx"
            )
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Billing events are history; record another rather than editing.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Billing events cannot be deleted.")
