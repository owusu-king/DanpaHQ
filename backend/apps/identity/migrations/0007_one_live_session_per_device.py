from typing import ClassVar

from django.db import migrations, models
from django.utils import timezone


def retire_duplicate_device_sessions(apps, schema_editor):
    """Keep the newest unrevoked row for each known installation.

    Session rows are security history, so the migration revokes duplicates
    instead of deleting them before the database starts enforcing the rule.
    """

    Session = apps.get_model("identity", "Session")
    device_ids = (
        Session.objects.filter(device_id__isnull=False, revoked_at__isnull=True)
        .values_list("device_id", flat=True)
        .distinct()
    )
    now = timezone.now()
    for device_id in device_ids.iterator():
        session_ids = list(
            Session.objects.filter(device_id=device_id, revoked_at__isnull=True)
            .order_by("-issued_at", "-id")
            .values_list("id", flat=True)
        )
        if len(session_ids) > 1:
            Session.objects.filter(id__in=session_ids[1:]).update(
                revoked_at=now,
                revoked_reason="duplicate_device_session",
            )


class Migration(migrations.Migration):
    dependencies: ClassVar[list] = [
        ("identity", "0006_backfill_account_type_and_provider_standing")
    ]

    operations: ClassVar[list] = [
        migrations.RunPython(
            retire_duplicate_device_sessions,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name="session",
            constraint=models.UniqueConstraint(
                condition=models.Q(revoked_at__isnull=True),
                fields=("device",),
                name="identity_one_live_device",
            ),
        ),
    ]
