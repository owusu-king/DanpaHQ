from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("occupancy", "0006_backfill_tenancies")]

    operations = [
        migrations.AddField(
            model_name="propertyinvitation",
            name="decline_reason",
            field=models.CharField(blank=True, max_length=300),
        ),
        migrations.AddField(
            model_name="propertyinvitation",
            name="declined_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="propertyinvitation",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("accepted", "Accepted"),
                    ("declined", "Declined"),
                    ("revoked", "Revoked"),
                    ("expired", "Expired"),
                ],
                default="pending",
                max_length=16,
            ),
        ),
    ]
