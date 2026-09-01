from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("lease", "0003_lease_tenancy")]

    operations = [
        migrations.AddField(
            model_name="lease",
            name="activation_requirement",
            field=models.CharField(
                choices=[
                    ("lease_accepted", "Lease accepted"),
                    ("initial_payment", "Required initial payment confirmed"),
                ],
                default="lease_accepted",
                max_length=24,
            ),
        ),
        migrations.AlterField(
            model_name="lease",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("offered", "Waiting for the tenant"),
                    ("awaiting_activation", "Accepted — awaiting activation"),
                    ("active", "Active"),
                    ("declined", "Declined by the tenant"),
                    ("cancelled", "Cancelled"),
                    ("ended", "Ended"),
                ],
                default="draft",
                max_length=24,
            ),
        ),
        migrations.RemoveConstraint(model_name="lease", name="lease_one_live_per_unit"),
        migrations.RemoveConstraint(model_name="lease", name="lease_one_live_per_bed"),
        migrations.RemoveIndex(model_name="lease", name="lease_open_idx"),
        migrations.AddConstraint(
            model_name="lease",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    bed__isnull=True,
                    status__in=["draft", "offered", "awaiting_activation", "active"],
                ),
                fields=("unit",),
                name="lease_one_live_per_unit",
            ),
        ),
        migrations.AddConstraint(
            model_name="lease",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    bed__isnull=False,
                    status__in=["draft", "offered", "awaiting_activation", "active"],
                ),
                fields=("unit", "bed"),
                name="lease_one_live_per_bed",
            ),
        ),
        migrations.AddIndex(
            model_name="lease",
            index=models.Index(
                condition=models.Q(
                    status__in=["draft", "offered", "awaiting_activation", "active"]
                ),
                fields=["status", "-created_at"],
                name="lease_open_idx",
            ),
        ),
    ]
