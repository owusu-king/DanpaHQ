from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [("geo", "0003_delete_place")]

    operations = [
        migrations.AlterField(
            model_name="address",
            name="locality",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="addresses",
                to="geo.locality",
            ),
        ),
        migrations.AddField(
            model_name="address",
            name="place_name",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name="address",
            name="place_context",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name="address",
            name="place_provider",
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name="address",
            name="place_reference",
            field=models.CharField(blank=True, max_length=300),
        ),
        migrations.AddConstraint(
            model_name="address",
            constraint=models.CheckConstraint(
                condition=models.Q(locality__isnull=False) | ~models.Q(place_name=""),
                name="geo_address_has_location",
            ),
        ),
    ]
