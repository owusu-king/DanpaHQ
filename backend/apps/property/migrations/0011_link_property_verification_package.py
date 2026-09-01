from django.db import migrations, models


def link_existing_condition_reviews(apps, schema_editor):
    """Attach the newest non-superseded photo review to each existing package.

    No verification or audit row is rewritten. Older submissions inferred this
    relationship from matching subject ids; persisting it makes future package
    decisions atomic while retaining the complete history.
    """

    Application = apps.get_model("property", "PropertyProviderApplication")
    Verification = apps.get_model("trust", "Verification")

    for application in Application.objects.exclude(property_id=None).iterator():
        review = (
            Verification.objects.filter(
                subject_type="property",
                subject_id=str(application.property_id),
                kind="property_condition",
            )
            .exclude(status="superseded")
            .order_by("-created_at")
            .first()
        )
        if review is not None:
            application.condition_verification_id = review.id
            application.save(update_fields=["condition_verification_id"])


class Migration(migrations.Migration):
    dependencies = [
        ("property", "0010_provider_application_can_be_withdrawn"),
        ("trust", "0008_property_condition_kind"),
    ]

    operations = [
        migrations.AddField(
            model_name="propertyproviderapplication",
            name="condition_verification_id",
            field=models.UUIDField(blank=True, null=True, unique=True),
        ),
        migrations.RunPython(link_existing_condition_reviews, migrations.RunPython.noop),
    ]
