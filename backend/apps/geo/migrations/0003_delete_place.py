"""Places are looked up through a location provider, not stored (ADR 0034).

The OpenStreetMap-derived place table goes with the self-hosted basemap. PostGIS
stays: listings keep their approximate public point.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("geo", "0002_map_search"),
    ]

    operations = [
        migrations.DeleteModel(name="Place"),
    ]
