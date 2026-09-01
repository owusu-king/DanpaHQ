import apps.core.ids
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


KNOWN_CANCELLATION_REASONS = {
    "schedule_conflict",
    "emergency",
    "transportation_problem",
    "no_longer_interested",
    "property_unavailable",
    "other",
}


def preserve_existing_appointments(apps, schema_editor):
    ViewingRequest = apps.get_model("viewing", "ViewingRequest")
    ViewingAppointment = apps.get_model("viewing", "ViewingAppointment")
    state_map = {
        "confirmed": "confirmed",
        "checked_in": "checked_in",
        "cancelled": "cancelled",
        "completed": "completed",
        "tenant_no_show": "tenant_no_show",
        "host_no_show": "host_no_show",
    }
    for viewing in ViewingRequest.objects.exclude(confirmed_slot_id=None).select_related(
        "confirmed_slot"
    ):
        slot = viewing.confirmed_slot
        cancelled_at = viewing.updated_at if viewing.status == "cancelled" else None
        cancellation_reason = viewing.cancellation_reason
        cancellation_note = ""
        if cancellation_reason and cancellation_reason not in KNOWN_CANCELLATION_REASONS:
            cancellation_note = cancellation_reason[:300]
            cancellation_reason = "other"
        appointment = ViewingAppointment.objects.create(
            viewing_id=viewing.id,
            sequence=1,
            scheduled_at=slot.starts_at,
            duration_minutes=slot.duration_minutes,
            note=slot.note,
            status=state_map.get(viewing.status, "confirmed"),
            confirmed_at=viewing.confirmed_at or viewing.updated_at,
            confirmed_by_id=viewing.tenant_id,
            cancelled_at=cancelled_at,
            cancelled_by_id=viewing.cancelled_by_id,
            cancellation_reason=cancellation_reason,
            cancellation_note=cancellation_note,
            cancellation_notice_minutes=0 if cancelled_at else None,
        )
        viewing.current_appointment_id = appointment.id
        if cancelled_at:
            viewing.cancelled_at = cancelled_at
            viewing.cancellation_reason = cancellation_reason
            viewing.cancellation_note = cancellation_note
            viewing.cancellation_notice_minutes = 0
        viewing.save(
            update_fields=[
                "current_appointment",
                "cancelled_at",
                "cancellation_reason",
                "cancellation_note",
                "cancellation_notice_minutes",
            ]
        )


class Migration(migrations.Migration):
    dependencies = [
        ("viewing", "0002_secure_check_in"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ViewingAppointment",
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
                ("sequence", models.PositiveSmallIntegerField()),
                ("scheduled_at", models.DateTimeField(db_index=True)),
                ("duration_minutes", models.PositiveSmallIntegerField(default=30)),
                ("note", models.CharField(blank=True, max_length=200)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("confirmed", "Confirmed"),
                            ("rescheduled", "Rescheduled"),
                            ("cancelled", "Cancelled"),
                            ("checked_in", "Checked in"),
                            ("attendance_pending", "Attendance needs a response"),
                            ("completed", "Completed"),
                            ("tenant_no_show", "Tenant did not attend"),
                            ("host_no_show", "Host did not attend"),
                            ("disputed", "Attendance disputed"),
                        ],
                        default="confirmed",
                        max_length=24,
                    ),
                ),
                ("confirmed_at", models.DateTimeField()),
                ("rescheduled_at", models.DateTimeField(blank=True, null=True)),
                ("cancelled_at", models.DateTimeField(blank=True, null=True)),
                (
                    "cancellation_reason",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("schedule_conflict", "Schedule conflict"),
                            ("emergency", "Emergency"),
                            ("transportation_problem", "Transportation problem"),
                            ("no_longer_interested", "No longer interested"),
                            (
                                "property_unavailable",
                                "Property or unit no longer available",
                            ),
                            ("other", "Other"),
                        ],
                        max_length=40,
                    ),
                ),
                ("cancellation_note", models.CharField(blank=True, max_length=300)),
                ("cancellation_notice_minutes", models.PositiveIntegerField(blank=True, null=True)),
                (
                    "cancelled_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "confirmed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "rescheduled_by",
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
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="appointments",
                        to="viewing.viewingrequest",
                    ),
                ),
            ],
            options={
                "db_table": "viewing_appointment",
                "ordering": ("sequence",),
                "indexes": [
                    models.Index(
                        fields=["viewing", "-scheduled_at"], name="viewing_appt_history_idx"
                    )
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("viewing", "sequence"),
                        name="viewing_appointment_sequence_unique",
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="ViewingAttendanceResolution",
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
                    "alleged_absent_party",
                    models.CharField(
                        choices=[("tenant", "Tenant"), ("host", "Host")], max_length=8
                    ),
                ),
                ("reported_at", models.DateTimeField()),
                ("report_note", models.CharField(blank=True, max_length=300)),
                (
                    "response",
                    models.CharField(
                        blank=True,
                        choices=[("confirm", "Confirm"), ("dispute", "Dispute")],
                        max_length=8,
                    ),
                ),
                ("responded_at", models.DateTimeField(blank=True, null=True)),
                ("response_note", models.CharField(blank=True, max_length=300)),
                (
                    "dispute_status",
                    models.CharField(
                        choices=[
                            ("pending", "Awaiting response"),
                            ("verified", "Confirmed by both parties"),
                            ("disputed", "Disputed"),
                        ],
                        default="pending",
                        max_length=12,
                    ),
                ),
                (
                    "appointment",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="attendance_resolution",
                        to="viewing.viewingappointment",
                    ),
                ),
                (
                    "reported_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "responded_by",
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
                "db_table": "viewing_attendance_resolution",
                "indexes": [
                    models.Index(
                        fields=["dispute_status", "-reported_at"],
                        name="viewing_attendance_state_idx",
                    )
                ],
            },
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="current_appointment",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="viewing.viewingappointment",
            ),
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="cancelled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="cancellation_note",
            field=models.CharField(blank=True, max_length=300),
        ),
        migrations.AddField(
            model_name="viewingrequest",
            name="cancellation_notice_minutes",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.RunPython(preserve_existing_appointments, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="viewingrequest",
            name="cancellation_reason",
            field=models.CharField(
                blank=True,
                choices=[
                    ("schedule_conflict", "Schedule conflict"),
                    ("emergency", "Emergency"),
                    ("transportation_problem", "Transportation problem"),
                    ("no_longer_interested", "No longer interested"),
                    ("property_unavailable", "Property or unit no longer available"),
                    ("other", "Other"),
                ],
                max_length=40,
            ),
        ),
        migrations.AlterField(
            model_name="viewingrequest",
            name="status",
            field=models.CharField(
                choices=[
                    ("requested", "Waiting for the landlord"),
                    ("offered", "Times offered"),
                    ("confirmed", "Confirmed"),
                    ("checked_in", "Checked in"),
                    ("attendance_pending", "Attendance needs a response"),
                    ("declined", "Declined by the landlord"),
                    ("withdrawn", "Withdrawn by the tenant"),
                    ("cancelled", "Cancelled"),
                    ("completed", "Viewing happened"),
                    ("tenant_no_show", "Tenant did not attend"),
                    ("host_no_show", "Landlord did not attend"),
                    ("disputed", "Attendance disputed"),
                ],
                default="requested",
                max_length=20,
            ),
        ),
        migrations.RemoveIndex(model_name="viewingrequest", name="viewing_open_idx"),
        migrations.RemoveConstraint(
            model_name="viewingrequest", name="viewing_one_open_request_per_tenant"
        ),
        migrations.AddIndex(
            model_name="viewingrequest",
            index=models.Index(
                condition=models.Q(
                    status__in=[
                        "requested",
                        "offered",
                        "confirmed",
                        "checked_in",
                        "attendance_pending",
                    ]
                ),
                fields=["status", "-created_at"],
                name="viewing_open_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="viewingrequest",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    status__in=[
                        "requested",
                        "offered",
                        "confirmed",
                        "checked_in",
                        "attendance_pending",
                    ]
                ),
                fields=("listing", "tenant"),
                name="viewing_one_open_request_per_tenant",
            ),
        ),
    ]
