"""The plan taglines the provider plan chooser leads with.

Descriptions are data and are meant to be edited, so this only rewrites a
description that still reads exactly as it was seeded. A tagline somebody has
deliberately changed is left alone, which is the same additive rule
`catalogue.sync_catalogue` follows.
"""

from django.db import migrations

TAGLINES = {
    "FREE": (
        "For individual landlords getting started.",
        "For individual landlords getting started",
    ),
    "PRO": (
        "For landlords managing a growing portfolio.",
        "For growing landlords who need automation and deeper management tools",
    ),
    "BUSINESS": (
        "For professional property operations and teams.",
        "For professional property operations and teams",
    ),
}


def forward(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    for code, (seeded, tagline) in TAGLINES.items():
        Plan.objects.filter(code=code, description=seeded).update(description=tagline)


def backward(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    for code, (seeded, tagline) in TAGLINES.items():
        Plan.objects.filter(code=code, description=tagline).update(description=seeded)


class Migration(migrations.Migration):
    dependencies = [("billing", "0004_invoices_and_scheduled_changes")]

    operations = [migrations.RunPython(forward, backward)]
