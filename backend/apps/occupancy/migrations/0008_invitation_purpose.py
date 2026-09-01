from django.db import migrations, models


def classify_legacy_invitations(apps, schema_editor):
    Invitation = apps.get_model("occupancy", "PropertyInvitation")
    # The old product used a null lease for existing-tenant onboarding. Any
    # invitation already carrying a proposed lease was the attempted private
    # acquisition flow and must not keep the occupancy-on-accept behavior.
    Invitation.objects.filter(lease_id__isnull=False).update(purpose="prospective_tenant")


class Migration(migrations.Migration):
    dependencies = [("occupancy", "0007_invitation_decline")]

    operations = [
        migrations.AddField(
            model_name="propertyinvitation",
            name="purpose",
            field=models.CharField(
                choices=[
                    ("existing_tenant", "Existing tenant"),
                    ("prospective_tenant", "Prospective tenant"),
                ],
                db_index=True,
                default="existing_tenant",
                max_length=24,
            ),
        ),
        migrations.RunPython(classify_legacy_invitations, migrations.RunPython.noop),
    ]
