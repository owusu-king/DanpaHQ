"""Seed the three plans and the entitlement catalogue.

Additive and idempotent — see `catalogue.sync_catalogue`. Reversing it removes
only the rows this created *if nothing subscribes to them*, because deleting a
plan out from under a live subscription is not a migration, it is data loss.
"""

from django.db import migrations

from apps.billing.catalogue import sync_catalogue


def forwards(apps, schema_editor):
    sync_catalogue(apps)


def backwards(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    Subscription = apps.get_model("billing", "Subscription")
    if Subscription.objects.exists():
        raise RuntimeError(
            "Refusing to remove plans while subscriptions reference them. "
            "Migrate the subscriptions first."
        )
    Plan.objects.filter(code__in=["FREE", "PRO", "BUSINESS"]).delete()
    apps.get_model("billing", "Entitlement").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("billing", "0001_initial")]

    operations = [migrations.RunPython(forwards, backwards)]
