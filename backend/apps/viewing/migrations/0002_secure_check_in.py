import apps.core.ids
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("viewing", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RemoveField(model_name="viewingrequest", name="viewing_fee_currency"),
        migrations.RemoveField(model_name="viewingrequest", name="viewing_fee_minor"),
        migrations.RemoveField(model_name="viewingrequest", name="viewing_fee_note"),
        migrations.AlterField(
            model_name="viewingrequest",
            name="status",
            field=models.CharField(
                choices=[
                    ("requested", "Waiting for the landlord"),
                    ("offered", "Times offered"),
                    ("confirmed", "Confirmed"),
                    ("checked_in", "Checked in"),
                    ("declined", "Declined by the landlord"),
                    ("cancelled", "Cancelled"),
                    ("completed", "Viewing happened"),
                    ("tenant_no_show", "Tenant did not attend"),
                    ("host_no_show", "Landlord did not attend"),
                ],
                default="requested",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="approaching_notified_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="check_in_method",
            field=models.CharField(
                blank=True, choices=[("qr", "QR code"), ("code", "6-digit code")], max_length=8
            ),
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="check_in_notified_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="checked_in_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="checked_in_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="tenant_follow_up",
            field=models.CharField(
                blank=True,
                choices=[
                    ("request_home", "Requested this home"),
                    ("save", "Saved for later"),
                    ("report", "Reported a problem"),
                    ("not_interested", "Not interested"),
                ],
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="tenant_follow_up_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="ViewingCheckInSession",
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
                ("credential_version", models.PositiveIntegerField(default=0)),
                ("qr_token_hash", models.CharField(blank=True, db_index=True, max_length=64)),
                ("code_hash", models.CharField(blank=True, max_length=64)),
                ("not_before", models.DateTimeField()),
                ("expires_at", models.DateTimeField(db_index=True)),
                ("failed_code_attempts", models.PositiveSmallIntegerField(default=0)),
                ("last_failed_at", models.DateTimeField(blank=True, null=True)),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                ("invalidated_at", models.DateTimeField(blank=True, null=True)),
                ("invalidated_reason", models.CharField(blank=True, max_length=80)),
                (
                    "used_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "viewing",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="check_in_session",
                        to="viewing.viewingrequest",
                    ),
                ),
            ],
            options={
                "db_table": "viewing_check_in_session",
                "indexes": [
                    models.Index(
                        fields=["viewing", "expires_at"], name="viewing_checkin_window_idx"
                    )
                ],
            },
        ),
        migrations.RemoveIndex(model_name="viewingrequest", name="viewing_open_idx"),
        migrations.RemoveConstraint(
            model_name="viewingrequest", name="viewing_one_open_request_per_tenant"
        ),
        migrations.AddIndex(
            model_name="viewingrequest",
            index=models.Index(
                condition=models.Q(
                    status__in=["requested", "offered", "confirmed", "checked_in"]
                ),
                fields=["status", "-created_at"],
                name="viewing_open_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="viewingrequest",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    status__in=["requested", "offered", "confirmed", "checked_in"]
                ),
                fields=("listing", "tenant"),
                name="viewing_one_open_request_per_tenant",
            ),
        ),
    ]
