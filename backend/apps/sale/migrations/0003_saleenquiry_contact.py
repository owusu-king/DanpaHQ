from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("sale", "0002_savedsale")]

    operations = [
        migrations.AddField(
            model_name="saleenquiry",
            name="contact_phone",
            field=models.CharField(blank=True, max_length=16),
        ),
        migrations.AddField(
            model_name="saleenquiry",
            name="contact_email",
            field=models.EmailField(blank=True, max_length=254),
        ),
    ]
