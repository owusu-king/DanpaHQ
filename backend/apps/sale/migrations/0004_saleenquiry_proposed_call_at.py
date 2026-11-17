from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("sale", "0003_saleenquiry_contact")]

    operations = [
        migrations.AddField(
            model_name="saleenquiry",
            name="proposed_call_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
