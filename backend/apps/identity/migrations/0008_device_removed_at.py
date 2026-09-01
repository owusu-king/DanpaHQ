"""Separate "the owner signed this out" from "the handset is stolen".

Both used to set `blocked_at`, and nothing ever cleared it, so anybody who
tidied their device list barred that installation from their own account for
good. Every such row is released here: the block becomes a removal, which is
what its owner actually chose, and those handsets can sign in again with a
one-time code.

Only rows carrying the exact reason the old endpoint wrote are touched. It was
the single writer of that string, so a genuine block cannot be caught by this.
"""

from django.db import migrations, models


def release_devices_removed_by_their_owner(apps, schema_editor):
    Device = apps.get_model("identity", "Device")
    Device.objects.filter(
        blocked_at__isnull=False,
        blocked_reason="removed by user",
    ).update(removed_at=models.F("blocked_at"), blocked_at=None, blocked_reason="")


class Migration(migrations.Migration):
    dependencies = [
        ("identity", "0007_one_live_session_per_device"),
    ]

    operations = [
        migrations.AddField(
            model_name="device",
            name="removed_at",
            field=models.DateTimeField(
                blank=True,
                help_text="Signed out by its owner. Cleared when the installation signs in again.",
                null=True,
            ),
        ),
        migrations.RunPython(
            release_devices_removed_by_their_owner,
            # Deliberately not reversible. Going back would have to guess which
            # removals had been blocks, and guessing wrong locks somebody out of
            # their phone again — the exact failure this migration exists to end.
            migrations.RunPython.noop,
        ),
    ]
