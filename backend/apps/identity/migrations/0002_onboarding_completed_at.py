from django.db import migrations, models
from django.utils import timezone


def backfill_completed_onboarding(apps, schema_editor):
    User = apps.get_model("identity", "User")
    UserRole = apps.get_model("identity", "UserRole")
    user_ids = UserRole.objects.filter(revoked_at__isnull=True).values_list("user_id", flat=True)
    User.objects.filter(id__in=user_ids, onboarding_completed_at__isnull=True).update(
        onboarding_completed_at=timezone.now()
    )


class Migration(migrations.Migration):
    dependencies = [("identity", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="onboarding_completed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_completed_onboarding, migrations.RunPython.noop),
    ]
