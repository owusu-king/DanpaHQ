from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("organization", "0004_organizationinvitation_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="organizationinvitation",
            name="sms_failed_reason",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="organizationinvitation",
            name="sms_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
