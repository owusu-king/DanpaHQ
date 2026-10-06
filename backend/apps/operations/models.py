"""Dedicated principals and case records for the Management Portal."""

from __future__ import annotations

from typing import ClassVar

from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class ManagementRole(models.TextChoices):
    OPERATIONS_ADMIN = "operations_admin", "Operations Admin"
    SUPPORT_ADMIN = "support_admin", "Support Admin"


class ManagementUser(BaseModel):
    """An operational principal that can never be a consumer or Super Admin."""

    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=80)
    last_name = models.CharField(max_length=80)
    role = models.CharField(max_length=24, choices=ManagementRole.choices)
    password = models.CharField(max_length=128)

    is_active = models.BooleanField(default=True)
    must_change_password = models.BooleanField(default=True)
    last_login = models.DateTimeField(null=True, blank=True)
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)
    failed_login_count = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "operations_management_user"
        ordering = ("first_name", "last_name", "email")
        indexes: ClassVar[list[models.Index]] = [
            models.Index(fields=["role", "is_active"], name="operations_role_idx")
        ]

    def save(self, *args, **kwargs):
        self.email = self.email.strip().lower()
        super().save(*args, **kwargs)

    def set_password(self, raw_password: str) -> None:
        self.password = make_password(raw_password)

    def check_password(self, raw_password: str) -> bool:
        return check_password(raw_password, self.password)

    @property
    def is_authenticated(self) -> bool:
        return True

    @property
    def is_anonymous(self) -> bool:
        return False

    @property
    def display_name(self) -> str:
        return " ".join(part for part in (self.first_name, self.last_name) if part) or self.email

    @property
    def is_locked(self) -> bool:
        return bool(self.locked_until and self.locked_until > timezone.now())

    def __str__(self) -> str:
        return f"{self.display_name} ({self.get_role_display()})"


class ManagementSession(BaseModel):
    user = models.ForeignKey(ManagementUser, on_delete=models.CASCADE, related_name="sessions")
    token_hash = models.CharField(max_length=64, unique=True)
    csrf_hash = models.CharField(max_length=64)
    issued_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(db_index=True)
    last_used_at = models.DateTimeField(default=timezone.now)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=80, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = "operations_management_session"
        ordering = ("-issued_at",)
        indexes: ClassVar[list[models.Index]] = [
            models.Index(fields=["user", "-issued_at"], name="operations_session_user_idx")
        ]

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and self.expires_at > timezone.now() and self.user.is_active


class ReportSubject(models.TextChoices):
    USER = "user", "User"
    PROPERTY = "property", "Property"
    LISTING = "listing", "Listing"
    VIEWING = "viewing", "Viewing"


class CaseStatus(models.TextChoices):
    OPEN = "open", "Open"
    IN_REVIEW = "in_review", "In review"
    RESOLVED = "resolved", "Resolved"
    DISMISSED = "dismissed", "Dismissed"


class Priority(models.TextChoices):
    LOW = "low", "Low"
    NORMAL = "normal", "Normal"
    HIGH = "high", "High"
    URGENT = "urgent", "Urgent"


class ManagementReport(BaseModel):
    subject_type = models.CharField(max_length=16, choices=ReportSubject.choices)
    subject_id = models.CharField(max_length=64, db_index=True)
    reported_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reports_made",
    )
    category = models.CharField(max_length=40)
    summary = models.CharField(max_length=180)
    details = models.TextField(blank=True, max_length=3000)
    priority = models.CharField(max_length=12, choices=Priority.choices, default=Priority.NORMAL)
    status = models.CharField(max_length=16, choices=CaseStatus.choices, default=CaseStatus.OPEN)
    assigned_to = models.ForeignKey(
        ManagementUser,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_reports",
    )
    resolution_note = models.TextField(blank=True, max_length=1000)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "operations_report"
        ordering = ("-created_at",)
        indexes: ClassVar[list[models.Index]] = [
            models.Index(
                fields=["status", "priority", "-created_at"], name="operations_report_queue_idx"
            )
        ]


class SupportCategory(models.TextChoices):
    ACCOUNT = "account", "Account access"
    VERIFICATION = "verification", "Verification"
    APPLICATION = "application", "Application"
    LEASE = "lease", "Lease"
    PAYMENT = "payment", "Payment"
    PROPERTY = "property", "Property or listing"
    OTHER = "other", "Other"


class SupportCase(BaseModel):
    user = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="support_cases",
    )
    category = models.CharField(max_length=20, choices=SupportCategory.choices)
    summary = models.CharField(max_length=180)
    details = models.TextField(blank=True, max_length=3000)
    priority = models.CharField(max_length=12, choices=Priority.choices, default=Priority.NORMAL)
    status = models.CharField(max_length=16, choices=CaseStatus.choices, default=CaseStatus.OPEN)
    assigned_to = models.ForeignKey(
        ManagementUser,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_cases",
    )
    related_application_id = models.UUIDField(null=True, blank=True)
    related_lease_id = models.UUIDField(null=True, blank=True)
    resolution_note = models.TextField(blank=True, max_length=1000)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "operations_support_case"
        ordering = ("-created_at",)
        indexes: ClassVar[list[models.Index]] = [
            models.Index(
                fields=["status", "priority", "-created_at"], name="operations_support_queue_idx"
            )
        ]


class DeletionStatus(models.TextChoices):
    PENDING = "pending", "Waiting for Management"
    COMPLETED = "completed", "Account deleted"
    DECLINED = "declined", "Declined"
    CANCELLED = "cancelled", "Cancelled by the person"


class AccountDeletionRequest(BaseModel):
    """Someone asking for their account and personal data to be deleted.

    The person asks; Management decides. Deletion cannot be undone and can
    collide with obligations the platform has to others — a tenancy still
    running, money still owed, records the law says to keep — so a person
    never erases themselves directly. While it waits they can withdraw it.
    """

    user = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="deletion_requests"
    )
    reason = models.TextField(blank=True, max_length=1000)
    status = models.CharField(
        max_length=16, choices=DeletionStatus.choices, default=DeletionStatus.PENDING
    )
    #: What stood in the way when it was asked, as the person was shown it.
    blockers = models.JSONField(default=list, blank=True)
    decided_by = models.ForeignKey(
        ManagementUser,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deletion_decisions",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True, max_length=1000)

    class Meta:
        db_table = "operations_account_deletion_request"
        ordering = ("-created_at",)
        constraints: ClassVar[list] = [
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(status="pending"),
                name="operations_one_pending_deletion_per_user",
            )
        ]
