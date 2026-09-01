import apps.core.ids
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("organization", "0002_backfill_personal_organizations"),
        ("property", "0005_property_created_by_property_join_code_and_more"),
        ("rent", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PropertyExpense",
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
                ("amount_minor", models.BigIntegerField()),
                ("amount_currency", models.CharField(default="GHS", max_length=3)),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("maintenance", "Maintenance"),
                            ("utilities", "Utilities"),
                            ("staff", "Staff"),
                            ("tax", "Tax or levy"),
                            ("supplies", "Supplies"),
                            ("other", "Other"),
                        ],
                        default="other",
                        max_length=20,
                    ),
                ),
                ("incurred_on", models.DateField()),
                ("note", models.CharField(blank=True, max_length=300)),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="property_expenses",
                        to="organization.organization",
                    ),
                ),
                (
                    "property",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="expenses",
                        to="property.property",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="property_expenses_recorded",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "rent_property_expense",
                "ordering": ("-incurred_on", "-created_at"),
                "indexes": [
                    models.Index(
                        fields=["organization", "-incurred_on"],
                        name="expense_org_date_idx",
                    ),
                    models.Index(
                        fields=["property", "-incurred_on"],
                        name="expense_property_idx",
                    ),
                ],
            },
        ),
    ]
