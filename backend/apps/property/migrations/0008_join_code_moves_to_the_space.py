"""The join code names a space, because that is what somebody joins.

One code per property meant handing every student in a hostel the same secret
and trusting each to claim only their own room. A code now belongs to the unit
it admits somebody to.

Written by hand rather than generated: adding a unique column to a table with
rows in it needs the values to exist before the constraint does, which is three
steps and not one.
"""

from django.db import migrations, models

import apps.property.models
from apps.property.models import generate_join_code


def give_each_space_a_code(apps, schema_editor):
    """One distinct code per existing unit.

    Generated per row rather than by the field default, because a default is
    evaluated once for an AddField and every row would receive the same value —
    which is exactly what the unique constraint added afterwards would reject.
    """
    # Imported by name: the `apps` argument shadows the `apps.property` package,
    # so reaching through it here finds the migration state instead of the module.
    Unit = apps.get_model("property", "Unit")

    for unit in Unit.objects.filter(join_code__isnull=True).iterator():
        code = generate_join_code()
        while Unit.objects.filter(join_code=code).exists():
            code = generate_join_code()
        Unit.objects.filter(pk=unit.pk).update(join_code=code)


def clear_codes(apps, schema_editor):
    """Reverse of the backfill. The column goes with the AddField below it."""
    Unit = apps.get_model("property", "Unit")
    Unit.objects.update(join_code=None)


class Migration(migrations.Migration):
    dependencies = [
        ("property", "0007_property_category_and_rentable_space_type"),
    ]

    operations = [
        # Nullable and not yet unique, so existing rows are legal while empty.
        migrations.AddField(
            model_name="unit",
            name="join_code",
            field=models.CharField(
                max_length=10,
                null=True,
                blank=True,
                help_text="Possession secret for tenant join requests to this space.",
            ),
        ),
        migrations.RunPython(give_each_space_a_code, clear_codes),
        # Now that every row holds a distinct value, the constraint can go on.
        migrations.AlterField(
            model_name="unit",
            name="join_code",
            field=models.CharField(
                max_length=10,
                unique=True,
                null=True,
                blank=True,
                default=apps.property.models.generate_join_code,
                help_text="Possession secret for tenant join requests to this space.",
            ),
        ),
        # The property-level code goes. Leaving both would mean two secrets for
        # one door, and no way to tell which a tenant had been given.
        migrations.RemoveField(
            model_name="property",
            name="join_code",
        ),
    ]
