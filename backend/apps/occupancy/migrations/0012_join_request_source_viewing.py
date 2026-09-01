import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("occupancy", "0011_retire_property_invitations"),
        ("viewing", "0002_secure_check_in"),
    ]

    operations = [
        migrations.AddField(
            model_name="propertyjoinrequest",
            name="source_viewing",
            field=models.OneToOneField(
                blank=True,
                help_text="The completed public viewing that led to this tenancy request, if any.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="tenancy_request",
                to="viewing.viewingrequest",
            ),
        )
    ]
