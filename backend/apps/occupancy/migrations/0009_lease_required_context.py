import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lease", "0004_lease_activation_gate"),
        ("occupancy", "0008_invitation_purpose"),
    ]

    operations = [
        migrations.AlterField(
            model_name="occupancy",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending_lease", "Lease required"),
                    ("active", "Active"),
                    ("ended", "Ended"),
                ],
                default="pending_lease",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="propertyjoinrequest",
            name="lease",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="join_requests",
                to="lease.lease",
            ),
        ),
    ]
