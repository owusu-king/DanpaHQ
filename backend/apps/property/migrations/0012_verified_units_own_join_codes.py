import secrets

from django.db import migrations, models


def align_join_codes_with_verification(apps, schema_editor):
    """Remove draft secrets and preserve/issue them only for verified spaces."""
    Unit = apps.get_model("property", "Unit")
    Verification = apps.get_model("trust", "Verification")

    verified_ids = {
        str(subject_id)
        for subject_id in Verification.objects.filter(
            subject_type="space",
            kind="space_condition",
            status="approved",
        ).values_list("subject_id", flat=True)
    }

    for unit in Unit.objects.only("id", "join_code").iterator():
        if str(unit.id) not in verified_ids:
            if unit.join_code:
                Unit.objects.filter(id=unit.id).update(join_code=None)
            continue
        if unit.join_code:
            continue
        code = secrets.token_hex(5).upper()
        while Unit.objects.filter(join_code=code).exists():
            code = secrets.token_hex(5).upper()
        Unit.objects.filter(id=unit.id).update(join_code=code)


class Migration(migrations.Migration):
    dependencies = [
        ("property", "0011_link_property_verification_package"),
        ("trust", "0008_property_condition_kind"),
    ]

    operations = [
        migrations.AlterField(
            model_name="unit",
            name="join_code",
            field=models.CharField(
                blank=True,
                default=None,
                help_text="Possession secret issued after this space is verified.",
                max_length=10,
                null=True,
                unique=True,
            ),
        ),
        migrations.RunPython(align_join_codes_with_verification, migrations.RunPython.noop),
    ]
