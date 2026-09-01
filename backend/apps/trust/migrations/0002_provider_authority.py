from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("trust", "0001_initial")]

    operations = [
        migrations.AlterField(
            model_name="verification",
            name="subject_type",
            field=models.CharField(
                choices=[
                    ("user", "Person"),
                    ("property", "Property"),
                    ("provider_application", "Property provider application"),
                    ("listing", "Listing"),
                    ("organisation", "Organisation"),
                ],
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="verification",
            name="kind",
            field=models.CharField(
                choices=[
                    ("phone", "Phone number"),
                    ("identity", "Identity (Ghana Card)"),
                    ("selfie_match", "Face matches ID"),
                    ("address", "Residential address"),
                    ("agency", "Agent licence or agency"),
                    ("company", "Company registration"),
                    ("bank_account", "Bank or mobile money account"),
                    ("ownership", "Property ownership"),
                    ("property_authority", "Authority to list a property"),
                ],
                max_length=24,
            ),
        ),
        migrations.AlterField(
            model_name="verificationevidence",
            name="evidence_type",
            field=models.CharField(
                choices=[
                    ("ghana_card_front", "Ghana Card (front)"),
                    ("ghana_card_back", "Ghana Card (back)"),
                    ("passport", "Passport"),
                    ("drivers_licence", "Driver's licence"),
                    ("selfie", "Selfie"),
                    ("utility_bill", "Utility bill"),
                    ("tenancy_agreement", "Tenancy agreement"),
                    ("business_certificate", "Business certificate"),
                    ("agency_licence", "Agency licence"),
                    ("ownership_document", "Ownership document"),
                    ("authorization_letter", "Owner authorization"),
                    ("management_agreement", "Property management agreement"),
                    ("provider_response", "Response from an authority"),
                    ("otp_confirmation", "One-time code confirmation"),
                ],
                max_length=32,
            ),
        ),
    ]
