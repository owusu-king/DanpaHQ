from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("listing", "0001_initial")]

    operations = [
        migrations.AlterField(
            model_name="listing",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("pending_review", "Pending review"),
                    ("active", "Active"),
                    ("rented", "Rented"),
                    ("withdrawn", "Withdrawn"),
                    ("expired", "Expired"),
                    ("suspended", "Suspended"),
                ],
                default="draft",
                max_length=20,
            ),
        ),
    ]
