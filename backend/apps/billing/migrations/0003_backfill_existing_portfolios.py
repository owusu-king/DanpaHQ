"""Give every Portfolio that predates billing its account and its Free plan.

`entitlement_service` already falls back to Free for a Portfolio with no
subscription, so nothing was behaving wrongly — but it was right by accident
rather than by record. A Portfolio with no row has no plan history, no billing
account to attach an invoice to later, and nothing for a support screen to show.

Idempotent and safe to re-run: it skips any Portfolio that already has a live
subscription, so it will not disturb one that has since been upgraded.
"""

from django.db import migrations
from django.utils import timezone

LIVE = ("active", "grace_period", "past_due")


def backfill(apps, schema_editor):
    Organization = apps.get_model("organization", "Organization")
    BillingAccount = apps.get_model("billing", "BillingAccount")
    Subscription = apps.get_model("billing", "Subscription")
    BillingEvent = apps.get_model("billing", "BillingEvent")
    Plan = apps.get_model("billing", "Plan")

    free = Plan.objects.filter(code="FREE").first()
    if free is None:
        # 0002 seeds the catalogue. If it is not there, something ran these out
        # of order and inventing a plan here would hide it.
        return

    now = timezone.now()
    for organization in Organization.objects.all().iterator():
        account, _ = BillingAccount.objects.get_or_create(
            organization=organization, defaults={"billing_email": ""}
        )
        if Subscription.objects.filter(billing_account=account, status__in=LIVE).exists():
            continue
        subscription = Subscription.objects.create(
            billing_account=account,
            plan=free,
            status="active",
            billing_interval="monthly",
            current_period_start=now,
            # Free has no period end and no provider reference, the same as a
            # Portfolio created through `ensure_free_subscription` today.
            current_period_end=None,
        )
        BillingEvent.objects.create(
            billing_account=account,
            subscription=subscription,
            event_type="subscription_created",
            from_plan_code="",
            to_plan_code="FREE",
            from_status="",
            to_status="active",
            actor=None,
            reason="Backfilled: Portfolio predates billing",
            occurred_at=now,
        )


def noop(apps, schema_editor):
    """Deliberately not reversible.

    Deleting subscriptions on a rollback would take the plan history of any
    Portfolio that had since been upgraded. Leaving Free rows behind is
    harmless; the forward migration skips them.
    """


class Migration(migrations.Migration):
    dependencies = [
        ("billing", "0002_seed_catalogue"),
        ("organization", "0005_organizationinvitation_sms_delivery"),
    ]

    operations = [migrations.RunPython(backfill, noop)]
