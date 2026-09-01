from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0008_payoutprovisioningoperation"),
    ]

    operations = [
        migrations.AddField(
            model_name="reconciliationexception",
            name="resolved_by_management_id",
            field=models.UUIDField(blank=True, db_index=True, null=True),
        ),
    ]
