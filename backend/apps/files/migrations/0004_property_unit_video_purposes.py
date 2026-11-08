# Optional walkthrough upload purposes.

from typing import ClassVar

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies: ClassVar = [
        ("files", "0003_alter_storedfile_purpose"),
    ]

    operations: ClassVar = [
        migrations.AlterField(
            model_name="storedfile",
            name="purpose",
            field=models.CharField(
                choices=[
                    ("identity_document", "Identity document"),
                    ("property_photo", "Property photo"),
                    ("property_video", "Property video"),
                    ("unit_video", "Unit video"),
                    ("property_document", "Property document"),
                    ("lease_document", "Lease document"),
                    ("payment_evidence", "Payment evidence"),
                    ("maintenance_photo", "Maintenance photo"),
                    ("maintenance_video", "Maintenance video"),
                    ("avatar", "Profile photo"),
                    ("artisan_work_photo", "Artisan portfolio photo"),
                    ("artisan_certificate", "Artisan certificate"),
                    ("artisan_job_photo", "Photo of a job to quote for"),
                    ("artisan_done_photo", "Photo of finished artisan work"),
                    ("artisan_receipt", "Receipt for artisan work"),
                    ("report_evidence", "Evidence for a report"),
                    ("other", "Other"),
                    ("guide_video", "How It Works video"),
                    ("guide_thumbnail", "How It Works thumbnail"),
                    ("guide_captions", "How It Works captions"),
                ],
                max_length=32,
            ),
        ),
    ]
