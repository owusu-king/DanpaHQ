"""Maintenance — a tenant reporting something broken, and seeing it put right.

A request belongs to the **tenancy**, not the lease or the room (see
``apps.tenancy``): three years of repairs across three renewals is one history.
Property, Unit and bed are copied from the tenancy when the request is made so a
provider's list can be scoped and filtered without walking the relationship, and
so the record still says where the leak was if the tenancy later ends.

### The lifecycle

```text
SUBMITTED ──provider starts──▶ IN_PROGRESS ──provider reports fixed──▶ AWAITING_TENANT_CONFIRMATION
    ▲                                                                          │
    └──────────── REOPENED ◀── tenant: not fixed ──┬── tenant: fixed ──▶ COMPLETED
```

``REOPENED`` goes back to the provider exactly as ``SUBMITTED`` does: it is work
waiting to be started. Nothing is ever deleted; every move is a
``MaintenanceEvent``.

### What deliberately is not here

Vendors, assignment, estimates and costs. When they arrive, assignment is one
more ``MaintenanceEvent`` kind and one nullable foreign key on the request; the
statuses above do not change, because "a plumber has it" is still in progress
from the tenant's side.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel

#: The longest clip a request may carry. Clients cut to it on the device.
MAX_CLIP_MS = 5000

#: `property` is a field on the request (as on `Tenancy`) and shadows the builtin
#: inside the class body; captured so computed attributes can still use it.
_py_property = property


class MaintenanceCategory(models.TextChoices):
    PLUMBING = "plumbing", "Plumbing and leaks"
    ELECTRICAL = "electrical", "Electrical and power"
    WATER = "water", "Water supply"
    APPLIANCE = "appliance", "Appliances and fittings"
    STRUCTURE = "structure", "Walls, roof, doors and windows"
    SECURITY = "security", "Locks and security"
    PESTS = "pests", "Pests"
    OTHER = "other", "Something else"


class MaintenanceStatus(models.TextChoices):
    SUBMITTED = "submitted", "Submitted"
    IN_PROGRESS = "in_progress", "In progress"
    AWAITING_TENANT_CONFIRMATION = "awaiting_tenant_confirmation", "Awaiting your confirmation"
    COMPLETED = "completed", "Completed"
    REOPENED = "reopened", "Reopened"


#: Work the provider has not started: new, or sent back by the tenant.
WAITING_ON_PROVIDER = (MaintenanceStatus.SUBMITTED, MaintenanceStatus.REOPENED)
#: Everything that is not finished.
OPEN_STATUSES = (
    MaintenanceStatus.SUBMITTED,
    MaintenanceStatus.IN_PROGRESS,
    MaintenanceStatus.AWAITING_TENANT_CONFIRMATION,
    MaintenanceStatus.REOPENED,
)


class MaintenanceRequest(BaseModel):
    tenancy = models.ForeignKey(
        "tenancy.Tenancy", on_delete=models.PROTECT, related_name="maintenance_requests"
    )
    tenant = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="maintenance_requests"
    )
    property = models.ForeignKey(
        "property.Property", on_delete=models.PROTECT, related_name="maintenance_requests"
    )
    unit = models.ForeignKey(
        "property.Unit", on_delete=models.PROTECT, related_name="maintenance_requests"
    )
    bed = models.ForeignKey(
        "property.Bed",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="maintenance_requests",
    )

    category = models.CharField(max_length=24, choices=MaintenanceCategory.choices)
    description = models.TextField(max_length=2000)

    #: Exactly one photograph, required: "the tap is broken" is not actionable,
    #: a picture of it usually is.
    photo = models.ForeignKey(
        "files.StoredFile", on_delete=models.PROTECT, related_name="maintenance_photo_of"
    )
    #: Optional, and at most five seconds.
    video = models.ForeignKey(
        "files.StoredFile",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="maintenance_video_of",
    )
    #: The part of ``video`` to play, when the device could not cut the file
    #: itself (Android picks from the library). Null when the file *is* the clip.
    video_clip_start_ms = models.PositiveIntegerField(null=True, blank=True)
    video_clip_end_ms = models.PositiveIntegerField(null=True, blank=True)

    status = models.CharField(
        max_length=32, choices=MaintenanceStatus.choices, default=MaintenanceStatus.SUBMITTED
    )
    #: When the status last changed, so lists can sort by "most recently moved"
    #: and a provider can see how long something has waited.
    status_changed_at = models.DateTimeField()

    started_at = models.DateTimeField(null=True, blank=True)
    #: The latest time the provider reported it fixed.
    fixed_reported_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    reopened_at = models.DateTimeField(null=True, blank=True)
    reopen_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "maintenance_request"
        ordering = ("-status_changed_at",)
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(video_clip_start_ms__isnull=True, video_clip_end_ms__isnull=True)
                    | models.Q(
                        video__isnull=False,
                        video_clip_start_ms__isnull=False,
                        video_clip_end_ms__gt=models.F("video_clip_start_ms"),
                        video_clip_end_ms__lte=models.F("video_clip_start_ms") + MAX_CLIP_MS,
                    )
                ),
                name="maintenance_clip_is_at_most_five_seconds",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "-status_changed_at"], name="maint_tenant_idx"),
            models.Index(fields=["property", "status"], name="maint_property_idx"),
            models.Index(fields=["tenancy", "-created_at"], name="maint_tenancy_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.get_category_display()} at {self.unit_id} ({self.status})"

    @_py_property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES


class MaintenanceEventKind(models.TextChoices):
    SUBMITTED = "submitted", "Reported"
    STARTED = "started", "Work started"
    FIXED_REPORTED = "fixed_reported", "Reported fixed"
    CONFIRMED = "confirmed", "Confirmed fixed"
    REOPENED = "reopened", "Reopened"


class MaintenanceEvent(BaseModel):
    """One thing that happened to a request, in order. Append-only.

    The tenant's tracker and the provider's history are both this list. A note
    travels with the event it explains: the provider's "replaced the washer" with
    the report that it was fixed, the tenant's "still dripping" with the reopen.
    """

    request = models.ForeignKey(MaintenanceRequest, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=24, choices=MaintenanceEventKind.choices)
    actor = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="maintenance_events",
    )
    from_status = models.CharField(max_length=32, blank=True)
    to_status = models.CharField(max_length=32)
    note = models.CharField(max_length=500, blank=True)

    class Meta:
        db_table = "maintenance_event"
        ordering = ("created_at",)
