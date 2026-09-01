"""Viewing requests — the first real contact between a tenant and a landlord.

Phase 2 ends with a tenant finding a room. This is what happens next, and it is
where several specifically Ghanaian problems live:

* **Free attendance.** Rooomly viewings are free. Scheduling must never become
  a payment or fee-collection surface.
* **Wasted journeys.** A viewing that does not happen costs a tenant a fare and
  most of a day. Both no-shows are recorded against the request, so a pattern of
  them is visible rather than folklore.
* **Phone numbers as a harvestable asset.** Contact details are exchanged only
  once a specific time is confirmed, so a listing cannot be farmed for numbers.

The status field is a small state machine rather than a pile of booleans,
because "did they cancel before or after we agreed a time" is exactly the
question a dispute turns on.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class ViewingStatus(models.TextChoices):
    REQUESTED = "requested", "Waiting for the landlord"
    OFFERED = "offered", "Times offered"
    CONFIRMED = "confirmed", "Confirmed"
    CHECKED_IN = "checked_in", "Checked in"
    ATTENDANCE_PENDING = "attendance_pending", "Attendance needs a response"
    DECLINED = "declined", "Declined by the landlord"
    WITHDRAWN = "withdrawn", "Withdrawn by the tenant"
    CANCELLED = "cancelled", "Cancelled"
    COMPLETED = "completed", "Viewing happened"
    TENANT_NO_SHOW = "tenant_no_show", "Tenant did not attend"
    HOST_NO_SHOW = "host_no_show", "Landlord did not attend"
    DISPUTED = "disputed", "Attendance disputed"


#: The states from which a request can still move somewhere. Anything else is
#: finished, and a finished request is never edited - a new one is made.
OPEN_STATUSES = (
    ViewingStatus.REQUESTED,
    ViewingStatus.OFFERED,
    ViewingStatus.CONFIRMED,
    ViewingStatus.CHECKED_IN,
    ViewingStatus.ATTENDANCE_PENDING,
)


class CheckInMethod(models.TextChoices):
    QR = "qr", "QR code"
    CODE = "code", "6-digit code"


class ViewingFollowUp(models.TextChoices):
    REQUEST_HOME = "request_home", "Requested this home"
    SAVE = "save", "Saved for later"
    REPORT = "report", "Reported a problem"
    NOT_INTERESTED = "not_interested", "Not interested"


class CancellationReason(models.TextChoices):
    SCHEDULE_CONFLICT = "schedule_conflict", "Schedule conflict"
    EMERGENCY = "emergency", "Emergency"
    TRANSPORTATION_PROBLEM = "transportation_problem", "Transportation problem"
    NO_LONGER_INTERESTED = "no_longer_interested", "No longer interested"
    PROPERTY_UNAVAILABLE = "property_unavailable", "Property or unit no longer available"
    OTHER = "other", "Other"


class ViewingAppointmentStatus(models.TextChoices):
    CONFIRMED = "confirmed", "Confirmed"
    RESCHEDULED = "rescheduled", "Rescheduled"
    CANCELLED = "cancelled", "Cancelled"
    CHECKED_IN = "checked_in", "Checked in"
    ATTENDANCE_PENDING = "attendance_pending", "Attendance needs a response"
    COMPLETED = "completed", "Completed"
    TENANT_NO_SHOW = "tenant_no_show", "Tenant did not attend"
    HOST_NO_SHOW = "host_no_show", "Host did not attend"
    DISPUTED = "disputed", "Attendance disputed"


class AttendanceParty(models.TextChoices):
    TENANT = "tenant", "Tenant"
    HOST = "host", "Host"


class AttendanceResponse(models.TextChoices):
    CONFIRM = "confirm", "Confirm"
    DISPUTE = "dispute", "Dispute"


class AttendanceResolutionStatus(models.TextChoices):
    PENDING = "pending", "Awaiting response"
    VERIFIED = "verified", "Confirmed by both parties"
    DISPUTED = "disputed", "Disputed"


class ViewingRequest(BaseModel):
    listing = models.ForeignKey(
        "listing.Listing", on_delete=models.PROTECT, related_name="viewing_requests"
    )
    tenant = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="viewing_requests"
    )

    status = models.CharField(
        max_length=20, choices=ViewingStatus.choices, default=ViewingStatus.REQUESTED
    )

    #: What the tenant said when asking. Kept verbatim; it is often the only
    #: context the landlord has before deciding whether to offer a time.
    message = models.TextField(blank=True, max_length=600)
    #: Free text on purpose - "weekends, or after 5 on a weekday" is how people
    #: actually describe when they are free, and a rigid picker loses it.
    availability_note = models.CharField(max_length=200, blank=True)

    responded_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="viewings_responded",
        help_text="Whoever answered on the listing's behalf - owner, manager or agent.",
    )
    responded_at = models.DateTimeField(null=True, blank=True)
    #: Shown to the tenant when a request is declined. Says what to do next.
    response_note = models.CharField(max_length=300, blank=True)

    confirmed_slot = models.ForeignKey(
        "viewing.ViewingSlot",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    current_appointment = models.ForeignKey(
        "viewing.ViewingAppointment",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    #: Numbers are exchanged at this moment and not before.
    contact_released_at = models.DateTimeField(null=True, blank=True)

    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_in_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    check_in_method = models.CharField(max_length=8, choices=CheckInMethod.choices, blank=True)

    approaching_notified_at = models.DateTimeField(null=True, blank=True)
    check_in_notified_at = models.DateTimeField(null=True, blank=True)

    cancelled_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.CharField(
        max_length=40, choices=CancellationReason.choices, blank=True
    )
    cancellation_note = models.CharField(max_length=300, blank=True)
    cancellation_notice_minutes = models.PositiveIntegerField(null=True, blank=True)

    outcome_note = models.CharField(max_length=300, blank=True)
    outcome_recorded_at = models.DateTimeField(null=True, blank=True)

    tenant_follow_up = models.CharField(max_length=20, choices=ViewingFollowUp.choices, blank=True)
    tenant_follow_up_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "viewing_request"
        ordering = ("-created_at",)
        constraints = [
            # One live request per tenant per listing. Without this, tapping the
            # button twice on a slow connection produces two conversations about
            # the same room and the landlord answers both.
            models.UniqueConstraint(
                fields=["listing", "tenant"],
                condition=models.Q(
                    status__in=[
                        "requested",
                        "offered",
                        "confirmed",
                        "checked_in",
                        "attendance_pending",
                    ]
                ),
                name="viewing_one_open_request_per_tenant",
            )
        ]
        indexes = [
            models.Index(fields=["listing", "status", "-created_at"], name="viewing_listing_idx"),
            models.Index(fields=["tenant", "-created_at"], name="viewing_tenant_idx"),
            models.Index(
                fields=["status", "-created_at"],
                name="viewing_open_idx",
                condition=models.Q(
                    status__in=[
                        "requested",
                        "offered",
                        "confirmed",
                        "checked_in",
                        "attendance_pending",
                    ]
                ),
            ),
        ]

    def __str__(self) -> str:
        return f"viewing of {self.listing_id} for {self.tenant_id} ({self.status})"

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES

    @property
    def contacts_are_released(self) -> bool:
        return self.contact_released_at is not None

    @property
    def directions_are_released(self) -> bool:
        """Whether the confirmed appointment still needs exact directions.

        Confirmation opens the location window immediately so the tenant can
        plan the journey. Cancelling or recording an outcome closes it, and a
        forgotten confirmed request cannot expose an address forever after its
        appointment has passed.
        """
        if (
            self.status not in (ViewingStatus.CONFIRMED, ViewingStatus.CHECKED_IN)
            or self.confirmed_slot is None
        ):
            return False
        ends_at = self.confirmed_slot.starts_at + timedelta(
            minutes=self.confirmed_slot.duration_minutes
        )
        return ends_at > timezone.now()

    @property
    def is_upcoming(self) -> bool:
        if self.status != ViewingStatus.CONFIRMED or self.confirmed_slot is None:
            return False
        return self.confirmed_slot.starts_at > timezone.now()


class ViewingAppointment(BaseModel):
    """Immutable schedule evidence for one confirmed appointment.

    The current viewing keeps its compact state machine, while every confirmed
    time remains here after rescheduling or cancellation. This is evidence, not
    a trust score: no credibility consequence is calculated by this model.
    """

    viewing = models.ForeignKey(
        ViewingRequest, on_delete=models.CASCADE, related_name="appointments"
    )
    sequence = models.PositiveSmallIntegerField()
    scheduled_at = models.DateTimeField(db_index=True)
    duration_minutes = models.PositiveSmallIntegerField(default=30)
    note = models.CharField(max_length=200, blank=True)
    status = models.CharField(
        max_length=24,
        choices=ViewingAppointmentStatus.choices,
        default=ViewingAppointmentStatus.CONFIRMED,
    )
    confirmed_at = models.DateTimeField()
    confirmed_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    rescheduled_at = models.DateTimeField(null=True, blank=True)
    rescheduled_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    cancellation_reason = models.CharField(
        max_length=40, choices=CancellationReason.choices, blank=True
    )
    cancellation_note = models.CharField(max_length=300, blank=True)
    cancellation_notice_minutes = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "viewing_appointment"
        ordering = ("sequence",)
        constraints = [
            models.UniqueConstraint(
                fields=["viewing", "sequence"], name="viewing_appointment_sequence_unique"
            )
        ]
        indexes = [
            models.Index(fields=["viewing", "-scheduled_at"], name="viewing_appt_history_idx")
        ]


class ViewingAttendanceResolution(BaseModel):
    """A no-show allegation and the counterparty's response.

    A pending allegation is deliberately not a verified no-show. Only the
    alleged absent party's confirmation can produce a verified no-show state;
    disagreement remains an explicit dispute for later support review.
    """

    appointment = models.OneToOneField(
        ViewingAppointment,
        on_delete=models.CASCADE,
        related_name="attendance_resolution",
    )
    reported_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    alleged_absent_party = models.CharField(max_length=8, choices=AttendanceParty.choices)
    reported_at = models.DateTimeField()
    report_note = models.CharField(max_length=300, blank=True)
    response = models.CharField(max_length=8, choices=AttendanceResponse.choices, blank=True)
    responded_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    responded_at = models.DateTimeField(null=True, blank=True)
    response_note = models.CharField(max_length=300, blank=True)
    dispute_status = models.CharField(
        max_length=12,
        choices=AttendanceResolutionStatus.choices,
        default=AttendanceResolutionStatus.PENDING,
    )

    class Meta:
        db_table = "viewing_attendance_resolution"
        indexes = [
            models.Index(
                fields=["dispute_status", "-reported_at"], name="viewing_attendance_state_idx"
            )
        ]


class ViewingCheckInSession(BaseModel):
    """One temporary credential pair for one confirmed physical viewing.

    The QR token and six-digit code rotate together. Only their hashes are
    stored, so a database read cannot reveal an attendee credential.
    """

    viewing = models.OneToOneField(
        ViewingRequest, on_delete=models.CASCADE, related_name="check_in_session"
    )
    credential_version = models.PositiveIntegerField(default=0)
    qr_token_hash = models.CharField(max_length=64, blank=True, db_index=True)
    code_hash = models.CharField(max_length=64, blank=True)
    not_before = models.DateTimeField()
    expires_at = models.DateTimeField(db_index=True)
    failed_code_attempts = models.PositiveSmallIntegerField(default=0)
    last_failed_at = models.DateTimeField(null=True, blank=True)
    used_at = models.DateTimeField(null=True, blank=True)
    used_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    invalidated_at = models.DateTimeField(null=True, blank=True)
    invalidated_reason = models.CharField(max_length=80, blank=True)

    class Meta:
        db_table = "viewing_check_in_session"
        indexes = [
            models.Index(fields=["viewing", "expires_at"], name="viewing_checkin_window_idx")
        ]

    @property
    def is_consumed(self) -> bool:
        return self.used_at is not None

    @property
    def is_invalidated(self) -> bool:
        return self.invalidated_at is not None


class ViewingSlot(BaseModel):
    """One time the host has offered.

    Several are offered at once and the tenant picks, rather than the two sides
    trading single suggestions - that negotiation is where arrangements die,
    especially over SMS-speed connections.
    """

    request = models.ForeignKey(ViewingRequest, on_delete=models.CASCADE, related_name="slots")
    starts_at = models.DateTimeField()
    duration_minutes = models.PositiveSmallIntegerField(default=30)
    note = models.CharField(max_length=200, blank=True)

    proposed_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "viewing_slot"
        ordering = ("starts_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["request", "starts_at"], name="viewing_slot_unique_time"
            )
        ]

    def __str__(self) -> str:
        return f"{self.starts_at:%a %d %b, %H:%M}"

    @property
    def is_past(self) -> bool:
        return self.starts_at < timezone.now()
