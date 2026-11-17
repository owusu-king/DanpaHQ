from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("geo", "0004_widen_digital_address")]

    operations = [
        migrations.CreateModel(
            name="GeoSeedState",
            fields=[
                ("id", models.PositiveSmallIntegerField(primary_key=True, serialize=False)),
                ("fingerprint", models.CharField(max_length=64)),
            ],
        ),
    ]
