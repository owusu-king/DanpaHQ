from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0001_initial")]

    operations = [
        migrations.AlterField(
            model_name="managementreport",
            name="subject_type",
            field=models.CharField(
                choices=[
                    ("user", "User"),
                    ("property", "Property"),
                    ("listing", "Listing"),
                    ("viewing", "Viewing"),
                ],
                max_length=16,
            ),
        )
    ]
