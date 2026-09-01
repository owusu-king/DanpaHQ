from django.db import migrations, models
from django.utils import timezone


def confirm_existing_non_empty_selections(apps, schema_editor):
    Property = apps.get_model("property", "Property")
    PropertyAmenity = apps.get_model("property", "PropertyAmenity")
    selected = PropertyAmenity.objects.filter(removed_at__isnull=True).values_list(
        "property_id", flat=True
    )
    Property.objects.filter(id__in=selected).update(amenities_confirmed_at=timezone.now())


class Migration(migrations.Migration):
    dependencies = [
        ("property", "0013_harden_unit_access_codes"),
    ]

    operations = [
        migrations.AddField(
            model_name="property",
            name="amenities_confirmed_at",
            field=models.DateTimeField(
                blank=True,
                help_text=(
                    "When a provider explicitly confirmed the property's shared-amenity "
                    "checklist, including the valid answer that the compound shares none."
                ),
                null=True,
            ),
        ),
        migrations.RunPython(confirm_existing_non_empty_selections, migrations.RunPython.noop),
    ]
