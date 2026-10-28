from typing import ClassVar

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies: ClassVar = [("identity", "0001_initial")]

    operations: ClassVar = [
        migrations.AlterField(
            model_name="user",
            name="account_type",
            field=models.CharField(
                blank=True,
                choices=[
                    ("tenant", "Tenant"),
                    ("provider", "Property provider"),
                    ("artisan", "Artisan"),
                ],
                default="",
                max_length=16,
            ),
        ),
    ]
