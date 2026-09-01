"""Private tenant access, separate from organizations and leases."""

from __future__ import annotations

from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import (
    DateRangeField,
    RangeBoundary,
    RangeOperators,
)
from django.db import models
from django.db.models import Func

from apps.core.fields import PhoneNumberField
from apps.core.models import BaseModel


class DateRange(Func):
    """SQL ``daterange(lower, upper, bounds)`` for use in a constraint.

    Django has no built-in wrapper for this. A null bound becomes an infinite
    one in Postgres, which is exactly what the domain means: no start date is
    "since before we recorded it", and no end date is "still running".
    """

    function = "DATERANGE"
    output_field = DateRangeField()


class OccupancyStatus(models.TextChoices):
    #: Real-world possession recorded for follow-up. This blocks contradictory
    #: allocation, but is not an active Rooomly tenancy until a lease activates.
    PENDING_LEASE = "pending_lease", "Lease required"
    ACTIVE = "active", "Active"
    ENDED = "ended", "Ended"


class InvitationStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    ACCEPTED = "accepted", "Accepted"
    DECLINED = "declined", "Declined"
    REVOKED = "revoked", "Revoked"
    EXPIRED = "expired", "Expired"


class InvitationPurpose(models.TextChoices):
    """Historical classification retained for legacy invitation rows."""

    EXISTING_TENANT = "existing_tenant", "Existing tenant"
    PROSPECTIVE_TENANT = "prospective_tenant", "Prospective tenant"


class JoinRequestStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


class Occupancy(BaseModel):
    user = models.ForeignKey("identity.User", on_delete=models.PROTECT, related_name="occupancies")
    property = models.ForeignKey(
        "property.Property", on_delete=models.PROTECT, related_name="occupancies"
    )
    unit = models.ForeignKey("property.Unit", on_delete=models.PROTECT, related_name="occupancies")
    bed = models.ForeignKey(
        "property.Bed",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="occupancies",
    )
    #: The relationship this allocation belongs to. An occupancy is where
    #: somebody is; the tenancy is the arrangement under which they are there,
    #: and it outlives any one allocation or lease.
    tenancy = models.ForeignKey(
        "tenancy.Tenancy",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="occupancies",
    )
    lease = models.ForeignKey(
        "lease.Lease",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="occupancies",
    )
    status = models.CharField(
        max_length=16,
        choices=OccupancyStatus.choices,
        default=OccupancyStatus.PENDING_LEASE,
    )
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "occupancy_occupancy"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["user", "unit"],
                condition=models.Q(ended_at__isnull=True, bed__isnull=True),
                name="occupancy_unique_active_user_unit",
            ),
            models.UniqueConstraint(
                fields=["user", "bed"],
                condition=models.Q(ended_at__isnull=True, bed__isnull=False),
                name="occupancy_unique_active_user_bed",
            ),
            models.CheckConstraint(
                condition=(
                    ~models.Q(status="active")
                    | (models.Q(lease__isnull=False) & models.Q(tenancy__isnull=False))
                ),
                name="occupancy_active_requires_lease_tenancy",
            ),
            # --- allocation is a period, not a flag --------------------------
            #
            # These replaced a plain unique constraint on `bed` that keyed on
            # "not ended". It was wrong in both directions: two bookings of the
            # same bed for *different* months were refused, and two overlapping
            # ones were accepted as soon as `ended_at` was set on either.
            #
            # `daterange(starts_on, ends_on)` gives the semantics the domain
            # already means — a null start is unbounded past, a null end is
            # open-ended — so no extra column is needed to express it.
            #
            # `[)` is deliberate: a tenancy ending on the 1st and another
            # starting on the 1st is a handover, not a clash.
            ExclusionConstraint(
                name="occupancy_no_overlapping_unit_allocation",
                expressions=[
                    (
                        DateRange("starts_on", "ends_on", RangeBoundary()),
                        RangeOperators.OVERLAPS,
                    ),
                    ("unit", RangeOperators.EQUAL),
                ],
                condition=models.Q(ended_at__isnull=True, bed__isnull=True),
            ),
            ExclusionConstraint(
                name="occupancy_no_overlapping_bed_allocation",
                expressions=[
                    (
                        DateRange("starts_on", "ends_on", RangeBoundary()),
                        RangeOperators.OVERLAPS,
                    ),
                    ("bed", RangeOperators.EQUAL),
                ],
                condition=models.Q(ended_at__isnull=True, bed__isnull=False),
            ),
            # Whole-unit versus per-bed allocation of the *same* unit cannot be
            # expressed as one exclusion constraint: bed rows must conflict with
            # a unit row on `unit`, but must not conflict with each other on it.
            # That check lives in `services.assert_space_is_free`, which is the
            # honest split — the database holds what it can express exactly, and
            # the service holds the rest with a message a person can act on.
        ]
        indexes = [
            models.Index(fields=["user", "status"], name="occupancy_user_idx"),
            models.Index(fields=["property", "status"], name="occupancy_property_idx"),
        ]


class PropertyInvitation(BaseModel):
    """Retired direct-acquisition record retained for history and old links."""

    property = models.ForeignKey(
        "property.Property", on_delete=models.CASCADE, related_name="tenant_invitations"
    )
    unit = models.ForeignKey(
        "property.Unit", on_delete=models.CASCADE, related_name="tenant_invitations"
    )
    bed = models.ForeignKey(
        "property.Bed",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="tenant_invitations",
    )
    invitee_phone = PhoneNumberField(db_index=True)
    purpose = models.CharField(
        max_length=24,
        choices=InvitationPurpose.choices,
        default=InvitationPurpose.EXISTING_TENANT,
        db_index=True,
    )
    invitee_user = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="property_invitations",
    )
    token_hash = models.CharField(max_length=64, unique=True)
    status = models.CharField(
        max_length=16, choices=InvitationStatus.choices, default=InvitationStatus.PENDING
    )
    expires_at = models.DateTimeField(db_index=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)
    decline_reason = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="tenant_invitations_created"
    )
    note = models.CharField(max_length=240, blank=True)

    #: The lease created after a prospective tenant accepts the invitation.
    #: Invitation acceptance never accepts this lease; the tenant decides the
    #: immutable offer later through the lease workflow.
    lease = models.ForeignKey(
        "lease.Lease",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invitations",
    )

    class Meta:
        db_table = "occupancy_property_invitation"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "invitee_phone"],
                condition=models.Q(status="pending", bed__isnull=True),
                name="occupancy_unique_pending_unit_invite",
            ),
            models.UniqueConstraint(
                fields=["bed", "invitee_phone"],
                condition=models.Q(status="pending", bed__isnull=False),
                name="occupancy_unique_pending_bed_invite",
            ),
        ]


class PropertyJoinRequest(BaseModel):
    requester = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="property_join_requests"
    )
    property = models.ForeignKey(
        "property.Property", on_delete=models.CASCADE, related_name="tenant_join_requests"
    )
    unit = models.ForeignKey(
        "property.Unit", on_delete=models.CASCADE, related_name="tenant_join_requests"
    )
    bed = models.ForeignKey(
        "property.Bed",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="tenant_join_requests",
    )
    source_viewing = models.OneToOneField(
        "viewing.ViewingRequest",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tenancy_request",
        help_text="The completed public viewing that led to this tenancy request, if any.",
    )
    status = models.CharField(
        max_length=16, choices=JoinRequestStatus.choices, default=JoinRequestStatus.PENDING
    )
    message = models.CharField(max_length=400, blank=True)
    decided_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=400, blank=True)
    lease = models.ForeignKey(
        "lease.Lease",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="join_requests",
    )

    class Meta:
        db_table = "occupancy_property_join_request"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["requester", "unit"],
                condition=models.Q(status="pending", bed__isnull=True),
                name="occupancy_unique_pending_unit_join",
            ),
            models.UniqueConstraint(
                fields=["requester", "bed"],
                condition=models.Q(status="pending", bed__isnull=False),
                name="occupancy_unique_pending_bed_join",
            ),
        ]
        indexes = [models.Index(fields=["property", "status"], name="occupancy_join_queue_idx")]
