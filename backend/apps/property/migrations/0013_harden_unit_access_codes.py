"""Replace persistent plaintext Unit join codes with expiring peppered hashes."""

import hashlib
import hmac
from datetime import timedelta

from django.conf import settings
from django.db import migrations, models
from django.utils import timezone


def hash_legacy_codes(apps, schema_editor):
    Unit = apps.get_model("property", "Unit")
    pepper = getattr(settings, "UNIT_ACCESS_CODE_PEPPER", None) or settings.SECRET_KEY
    now = timezone.now()
    expires_at = now + timedelta(days=30)

    for unit in Unit.objects.exclude(access_code_hash__isnull=True).iterator():
        raw = str(unit.access_code_hash).strip().upper()
        digest = hmac.new(pepper.encode(), f":{raw}".encode(), hashlib.sha256).hexdigest()
        Unit.objects.filter(id=unit.id).update(
            access_code_hash=digest,
            access_code_issued_at=now,
            access_code_expires_at=expires_at,
            access_code_version=1,
        )


class Migration(migrations.Migration):
    dependencies = [("property", "0012_verified_units_own_join_codes")]

    operations = [
        migrations.RenameField(
            model_name="unit",
            old_name="join_code",
            new_name="access_code_hash",
        ),
        migrations.AlterField(
            model_name="unit",
            name="access_code_hash",
            field=models.CharField(
                blank=True,
                default=None,
                help_text="Peppered hash of the private share code; never the raw credential.",
                max_length=64,
                null=True,
                unique=True,
            ),
        ),
        migrations.AddField(
            model_name="unit",
            name="access_code_issued_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="unit",
            name="access_code_expires_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="unit",
            name="access_code_revoked_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="unit",
            name="access_code_version",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunPython(hash_legacy_codes, migrations.RunPython.noop),
    ]
