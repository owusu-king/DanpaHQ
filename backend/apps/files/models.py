"""Uploaded file metadata.

Every file in this product is either evidence (a Ghana Card, a tenancy
agreement, a receipt) or marketing (property photos). Both need the same
controls, for different reasons.

Rules encoded here:

* Files are **never public**. Access is through short-lived signed URLs issued
  after a permission check, so a leaked link ages out instead of exposing a
  tenant's ID document indefinitely.
* The checksum is stored, which gives deduplication for free and lets a dispute
  establish that the agreement shown today is the file signed in March.
* Uploads start as ``pending`` and only become usable after a scan. A property
  listing that accepts arbitrary uploads is a malware distribution channel.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import SoftDeleteModel


class FilePurpose(models.TextChoices):
    IDENTITY_DOCUMENT = "identity_document", "Identity document"
    PROPERTY_PHOTO = "property_photo", "Property photo"
    PROPERTY_DOCUMENT = "property_document", "Property document"
    LEASE_DOCUMENT = "lease_document", "Lease document"
    PAYMENT_EVIDENCE = "payment_evidence", "Payment evidence"
    MAINTENANCE_PHOTO = "maintenance_photo", "Maintenance photo"
    MAINTENANCE_VIDEO = "maintenance_video", "Maintenance video"
    AVATAR = "avatar", "Profile photo"
    OTHER = "other", "Other"


class ScanStatus(models.TextChoices):
    PENDING = "pending", "Pending scan"
    CLEAN = "clean", "Clean"
    INFECTED = "infected", "Infected"
    FAILED = "failed", "Scan failed"


class UploadStatus(models.TextChoices):
    """Where a file is in its lifecycle.

    A file is only usable at ``ready``. Every other state means something is
    still unknown about it, and the difference matters: ``awaiting_upload`` is a
    reservation the client may never honour, while ``rejected`` is a file we
    looked at and refused.
    """

    AWAITING_UPLOAD = "awaiting_upload", "Waiting for the upload"
    UPLOADED = "uploaded", "Uploaded, being checked"
    READY = "ready", "Ready"
    REJECTED = "rejected", "Rejected"
    EXPIRED = "expired", "Reservation expired"


class StoredFile(SoftDeleteModel):
    storage_key = models.CharField(max_length=500, unique=True)
    bucket = models.CharField(max_length=100)
    #: Which backend holds the bytes. Recorded so a migration from local
    #: storage to object storage can find what it still has to move, and so a
    #: stale row cannot be read against the wrong backend.
    storage_backend = models.CharField(max_length=16, default="s3")

    original_filename = models.CharField(max_length=255)
    #: What the client said at presign time. Kept for forensics, never trusted.
    declared_content_type = models.CharField(max_length=120, blank=True)
    #: What the bytes actually are, sniffed after upload. This is what is served.
    content_type = models.CharField(max_length=120, blank=True)
    size_bytes = models.BigIntegerField(null=True, blank=True)
    checksum_sha256 = models.CharField(max_length=64, blank=True, db_index=True)

    purpose = models.CharField(max_length=32, choices=FilePurpose.choices)
    #: Sensitive files get shorter signed-URL lifetimes and their reads are audited.
    is_sensitive = models.BooleanField(default=False)

    upload_status = models.CharField(
        max_length=20, choices=UploadStatus.choices, default=UploadStatus.AWAITING_UPLOAD
    )
    #: A presign that is never used leaves a reservation behind. This is what the
    #: cleanup job sweeps, so abandoned rows do not accumulate forever.
    upload_expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    uploaded_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.CharField(max_length=300, blank=True)

    uploaded_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="uploaded_files",
    )
    #: Denormalised owner id, kept even if the account is later deleted, so
    #: ownership checks and retention still work on an orphaned row.
    owner_id_snapshot = models.CharField(max_length=64, blank=True)

    scan_status = models.CharField(
        max_length=16, choices=ScanStatus.choices, default=ScanStatus.PENDING
    )
    scanned_at = models.DateTimeField(null=True, blank=True)

    #: Set for files with a retention limit, e.g. identity documents that must be
    #: destroyed after the verification decision plus the statutory period.
    retain_until = models.DateField(null=True, blank=True)

    metadata = models.JSONField(default=dict, blank=True)  # width, height, duration, exif-stripped

    class Meta:
        db_table = "file_stored"
        indexes = [
            models.Index(fields=["purpose", "-created_at"], name="file_purpose_idx"),
            models.Index(fields=["uploaded_by", "-created_at"], name="file_uploader_idx"),
            models.Index(
                fields=["retain_until"],
                name="file_retention_idx",
                condition=models.Q(retain_until__isnull=False),
            ),
            # The abandoned-reservation sweep's only query.
            models.Index(
                fields=["upload_expires_at"],
                name="file_pending_idx",
                condition=models.Q(upload_status="awaiting_upload"),
            ),
        ]

    @property
    def is_usable(self) -> bool:
        """The single gate every consumer checks before linking or serving.

        Both conditions are required. A clean scan on a file that never finished
        uploading is meaningless, and a completed upload that has not been
        scanned is exactly what this flag exists to keep out.
        """
        return self.upload_status == UploadStatus.READY and self.scan_status == ScanStatus.CLEAN

    def is_owned_by(self, user) -> bool:
        if user is None:
            return False
        if self.uploaded_by_id and str(self.uploaded_by_id) == str(user.id):
            return True
        return bool(self.owner_id_snapshot) and self.owner_id_snapshot == str(user.id)

    def __str__(self) -> str:
        return f"{self.original_filename} ({self.purpose})"
