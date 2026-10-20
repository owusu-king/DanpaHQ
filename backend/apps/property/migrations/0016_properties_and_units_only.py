"""Properties and Units only, part one: move the data before the columns go.

Owner, 2026-10-20: there is no level between a property and its Units, so the
`Building` table goes. A Unit's block name is kept in its `wing`, which already
names a part of the building, so a tenant's directions lose nothing.

The three property facts change vocabulary. Old values map to the closest new
one; where none is honest the fact goes back to "not stated" and the provider is
asked again. `is_gated` becomes the compound answer; `has_security` is the
"Security guard" amenity now, so both columns go.
"""

from django.db import migrations, models
from django.utils import timezone

WATER = {"estate": "gwl_mains", "borehole": "borehole_pump", "sachet": "none"}
POWER = {"shared": "unknown", "generator": "unknown"}
RETIRED_AMENITIES = (
    "Generator",
    "Borehole water",
    "Water storage tank",
    "Walled and gated",
    "Garden / compound",
)


def forwards(apps, schema_editor):
    Property = apps.get_model("property", "Property")
    Unit = apps.get_model("property", "Unit")
    Amenity = apps.get_model("property", "Amenity")
    PropertyAmenity = apps.get_model("property", "PropertyAmenity")

    for old, new in WATER.items():
        Property.objects.filter(water_source=old).update(water_source=new)
    for old, new in POWER.items():
        Property.objects.filter(power_meter_type=old).update(power_meter_type=new)

    gated_by_amenity = PropertyAmenity.objects.filter(
        amenity__name="Walled and gated", removed_at__isnull=True
    ).values("property_id")
    Property.objects.filter(
        models.Q(is_gated=True)
        | models.Q(compound_type="estate")
        | models.Q(id__in=gated_by_amenity)
    ).update(compound_type="walled_gated")
    Property.objects.exclude(compound_type="walled_gated").update(compound_type="unknown")

    for unit in Unit.objects.filter(building__isnull=False).select_related("building"):
        name = unit.building.name
        unit.wing = (f"{name} · {unit.wing}" if unit.wing else name)[:40]
        unit.save(update_fields=["wing"])

    now = timezone.now()
    PropertyAmenity.objects.filter(
        amenity__name__in=RETIRED_AMENITIES, removed_at__isnull=True
    ).update(removed_at=now)
    Amenity.objects.filter(name__in=RETIRED_AMENITIES).update(is_active=False)


class Migration(migrations.Migration):
    dependencies = [
        ("property", "0015_property_purpose_alter_property_property_type_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
