from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("occupancy", "0009_lease_required_context"),
        ("tenancy", "0002_lease_required_activation"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="occupancy",
            constraint=models.CheckConstraint(
                condition=(
                    ~models.Q(status="active")
                    | (models.Q(lease__isnull=False) & models.Q(tenancy__isnull=False))
                ),
                name="occupancy_active_requires_lease_tenancy",
            ),
        )
    ]
