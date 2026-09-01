import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import apps.core.ids


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("geo", "0001_initial"),
        ("property", "0002_propertyrelationship"),
    ]

    operations = [
        migrations.AddField(
            model_name="propertyrelationship",
            name="authority_verification_id",
            field=models.UUIDField(
                blank=True,
                db_index=True,
                help_text="Trust verification that approved this exact relationship.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="propertyrelationship",
            name="authority_verified_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="propertyrelationship",
            name="relationship_type",
            field=models.CharField(
                choices=[
                    ("owner", "Owner"),
                    ("manager", "Property manager"),
                    ("agent", "Agent"),
                    ("company_representative", "Company representative"),
                    ("listing_manager", "Listing manager"),
                ],
                max_length=24,
            ),
        ),
        migrations.CreateModel(
            name="PropertyProviderApplication",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=apps.core.ids.uuid7,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "relationship_type",
                    models.CharField(
                        choices=[
                            ("owner", "Owner"),
                            ("agent", "Authorized agent"),
                            ("manager", "Property manager"),
                            ("company_representative", "Company representative"),
                        ],
                        max_length=24,
                    ),
                ),
                ("title", models.CharField(max_length=120)),
                (
                    "property_type",
                    models.CharField(
                        choices=[
                            ("apartment", "Apartment / Flat"),
                            ("house", "House"),
                            ("villa", "Villa"),
                            ("studio", "Studio"),
                            ("office", "Office"),
                            ("shop", "Shop"),
                            ("warehouse", "Warehouse"),
                            ("land", "Land"),
                            ("other", "Other"),
                        ],
                        max_length=20,
                    ),
                ),
                ("owner_name", models.CharField(blank=True, max_length=160)),
                ("owner_phone", models.CharField(blank=True, max_length=16)),
                ("company_name", models.CharField(blank=True, max_length=180)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("identity_verification", "Identity verification required"),
                            ("property_verification", "Property verification"),
                            ("pending_review", "Pending review"),
                            ("needs_more_info", "More information required"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("suspended", "Suspended"),
                            ("expired", "Expired"),
                        ],
                        db_index=True,
                        default="draft",
                        max_length=32,
                    ),
                ),
                (
                    "authority_verification_id",
                    models.UUIDField(blank=True, null=True, unique=True),
                ),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("decision_note", models.TextField(blank=True, max_length=600)),
                (
                    "address",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="provider_applications",
                        to="geo.address",
                    ),
                ),
                (
                    "applicant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="provider_applications",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "property",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="provider_application",
                        to="property.property",
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "property_provider_application",
                "ordering": ("-created_at",),
                "indexes": [
                    models.Index(
                        fields=["applicant", "-created_at"], name="provider_applicant_idx"
                    ),
                    models.Index(fields=["status", "created_at"], name="provider_review_idx"),
                ],
            },
        ),
    ]
