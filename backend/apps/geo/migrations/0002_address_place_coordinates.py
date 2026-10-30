from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("geo", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="address",
            name="place_latitude",
            field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True),
        ),
        migrations.AddField(
            model_name="address",
            name="place_longitude",
            field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True),
        ),
    ]
