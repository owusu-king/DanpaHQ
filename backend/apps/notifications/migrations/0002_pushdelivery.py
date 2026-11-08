import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("identity", "0002_artisan_account_type"),
        ("notifications", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PushDelivery",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True,
                                           serialize=False, verbose_name="ID")),
                ("device", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                             to="identity.device")),
                ("notification", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                                   to="notifications.notification")),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("notification", "device"), name="unique_notification_push_device"
                    ),
                ],
            },
        ),
    ]
