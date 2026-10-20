"""Properties and Units only, part two: the columns and the vocabulary.

Separate from 0016 because Postgres refuses to alter a table in the same
transaction that just updated its rows under deferred foreign-key triggers.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("property", "0016_properties_and_units_only"),
    ]

    operations = [
        migrations.RemoveField(model_name="unit", name="building"),
        migrations.DeleteModel(name="Building"),
        migrations.RemoveField(model_name="property", name="has_security"),
        migrations.RemoveField(model_name="property", name="is_gated"),
        migrations.AlterField(
            model_name="property",
            name="water_source",
            field=models.CharField(
                choices=[
                    ("borehole_pump", "Borehole with automated pump (Polytank)"),
                    ("gwl_mains", "GWL mains only (direct to tap)"),
                    ("well", "Hand-dug well / manual well"),
                    ("none", "No water source"),
                    ("unknown", "Not stated"),
                ],
                default="unknown",
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="property",
            name="power_meter_type",
            field=models.CharField(
                choices=[
                    ("prepaid", "Prepaid (credit meter)"),
                    ("postpaid", "Postpaid (ECG bill)"),
                    ("none", "No electricity"),
                    ("unknown", "Not stated"),
                ],
                default="unknown",
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="property",
            name="compound_type",
            field=models.CharField(
                choices=[
                    ("walled_gated", "Walled and gated"),
                    ("fenced", "Fenced (no gate)"),
                    ("open", "Open compound"),
                    ("unknown", "Not stated"),
                ],
                default="unknown",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="unit",
            name="wing",
            field=models.CharField(
                blank=True,
                help_text="Wing, block or side of the building, where one is named.",
                max_length=40,
            ),
        ),
    ]
