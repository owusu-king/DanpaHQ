from typing import ClassVar

from django.db import migrations
from django.utils import timezone


def revoke_open_invitations(apps, schema_editor):
    """Close obsolete offers without deleting their historical records."""
    invitation_model = apps.get_model("occupancy", "PropertyInvitation")
    invitation_model.objects.filter(status="pending").update(
        status="revoked",
        updated_at=timezone.now(),
    )


class Migration(migrations.Migration):
    dependencies: ClassVar[list[tuple[str, str]]] = [
        ("occupancy", "0010_active_requires_lease")
    ]

    operations: ClassVar[list] = [
        migrations.RunPython(revoke_open_invitations, migrations.RunPython.noop),
    ]
