"""Upload lifecycle.

Three steps, and the split is the security design rather than an implementation
detail:

1. **Reserve** (`reserve_upload`) — the server picks the key, checks the declared
   type and size against the purpose, records a row in `awaiting_upload`, and
   returns a short-lived presigned URL. Nothing is trusted yet.
2. **Upload** — the client sends bytes straight to storage. Django never handles
   them, so a slow phone upload does not occupy a worker.
3. **Complete** (`complete_upload`) — the server reads the object back, checks
   what it *actually* is, checksums it, and only then moves it to `ready`.

Step 3 is why the client's claims in step 1 do not matter much. Someone can
presign for a 2MB JPEG and push something else; the file will not become usable.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.core.ids import uuid7
from apps.outbox.services import emit

from .models import FilePurpose, ScanStatus, StoredFile, UploadStatus
from .storage import ObjectNotFound, StorageError, get_storage
from .validation import (
    HEADER_BYTES,
    FileValidationError,
    validate_declared_upload,
    validate_uploaded_bytes,
)

# Cross-domain calls are function-scoped imports so the module-level graph
# stays acyclic (tested by tests/unit/test_module_boundaries.py).
# identity and trust are imported only inside the functions that need them.

logger = logging.getLogger("files")

UPLOAD_WINDOW_MINUTES = 15
DOWNLOAD_TTL_SECONDS = 300
SENSITIVE_DOWNLOAD_TTL_SECONDS = 60

#: Purposes whose contents are personal or identifying. These get shorter URL
#: lifetimes, audited reads, and a retention date.
SENSITIVE_PURPOSES = frozenset(
    {
        FilePurpose.IDENTITY_DOCUMENT,
        FilePurpose.PAYMENT_EVIDENCE,
        FilePurpose.LEASE_DOCUMENT,
    }
)

#: How long an identity document is kept after it is uploaded. Long enough to
#: defend a verification decision, short enough to honour data minimisation.
RETENTION_DAYS = {FilePurpose.IDENTITY_DOCUMENT: 400}


def _extension_for(content_type: str) -> str:
    return {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/heic": "heic",
        "application/pdf": "pdf",
        "video/mp4": "mp4",
        "video/quicktime": "mov",
        "video/webm": "webm",
    }.get(content_type, "bin")


def build_key(*, purpose: str, owner_id: str, content_type: str) -> str:
    """Server-chosen storage key.

    Never derived from the client's filename. A client-supplied path is how you
    get directory traversal, and how one user overwrites another's evidence.
    The date prefix keeps object listings navigable and gives retention jobs a
    cheap prefix to sweep.
    """
    today = timezone.now()
    unique = uuid7().hex
    return f"{purpose}/{today:%Y/%m}/{owner_id}/{unique}.{_extension_for(content_type)}"


@transaction.atomic
def reserve_upload(
    *,
    user,
    purpose: str,
    filename: str,
    content_type: str,
    size_bytes: int,
) -> tuple[StoredFile, object]:
    """Step 1. Validate the claim, reserve a row, return a presigned URL."""
    if not user or not user.is_authenticated:
        raise PermissionDenied("Sign in to upload a file.")

    try:
        limits = validate_declared_upload(
            purpose=purpose, content_type=content_type, size_bytes=size_bytes
        )
    except FileValidationError as exc:
        raise ValidationFailed(str(exc)) from exc

    normalised_type = content_type.split(";")[0].strip().lower()
    key = build_key(purpose=purpose, owner_id=str(user.id), content_type=normalised_type)
    storage = get_storage()

    try:
        presigned = storage.presign_upload(
            key=key,
            content_type=normalised_type,
            max_bytes=limits.max_bytes,
            expires_in=UPLOAD_WINDOW_MINUTES * 60,
        )
    except StorageError as exc:
        logger.exception("presign failed", extra={"event": "upload_presign_failed"})
        raise Conflict("We could not start that upload. Try again in a moment.") from exc

    retention = RETENTION_DAYS.get(purpose)
    stored = StoredFile.objects.create(
        storage_key=key,
        bucket=getattr(storage, "bucket", storage.name),
        storage_backend=storage.name,
        original_filename=filename[:255],
        declared_content_type=normalised_type,
        purpose=purpose,
        is_sensitive=purpose in SENSITIVE_PURPOSES,
        upload_status=UploadStatus.AWAITING_UPLOAD,
        upload_expires_at=timezone.now() + timedelta(minutes=UPLOAD_WINDOW_MINUTES),
        uploaded_by=user,
        owner_id_snapshot=str(user.id),
        retain_until=((timezone.now() + timedelta(days=retention)).date() if retention else None),
    )

    record(
        action=AuditAction.CREATE,
        aggregate_type="file",
        aggregate_id=stored.id,
        actor=user,
        metadata={
            "purpose": purpose,
            "declared_type": normalised_type,
            "declared_size": size_bytes,
        },
    )
    return stored, presigned


class _UploadRejected(Exception):
    """Internal signal: the bytes are not what was claimed.

    Carried out of the completing transaction so the rejection can be recorded
    in one of its own, then reported as ValidationFailed.
    """


def complete_upload(*, user, file_id) -> StoredFile:
    """Step 3. Read the object back and decide whether it is what was claimed."""
    try:
        return _complete_upload(user=user, file_id=file_id)
    except _UploadRejected as rejection:
        _reject_upload(user=user, file_id=file_id, reason=str(rejection))
        raise ValidationFailed(str(rejection)) from rejection


@transaction.atomic
def _reject_upload(*, user, file_id, reason: str) -> None:
    """Mark an upload refused and destroy its bytes. Durable by design."""
    stored = StoredFile.objects.select_for_update().filter(id=file_id).first()
    if stored is None:
        return

    stored.upload_status = UploadStatus.REJECTED
    stored.rejection_reason = reason[:300]
    stored.scan_status = ScanStatus.FAILED
    stored.save(update_fields=["upload_status", "rejection_reason", "scan_status", "updated_at"])

    # Remove the bytes immediately. Keeping a rejected executable around
    # because a row references it would be the whole problem.
    try:
        get_storage().delete(key=stored.storage_key)
    except StorageError:
        logger.warning("could not delete rejected upload", extra={"event": "upload_cleanup_failed"})

    record(
        action=AuditAction.UPDATE,
        aggregate_type="file",
        aggregate_id=stored.id,
        actor=user,
        metadata={"rejected": True, "reason": reason[:200]},
    )


@transaction.atomic
def _complete_upload(*, user, file_id) -> StoredFile:
    stored = StoredFile.objects.select_for_update().filter(id=file_id).first()
    if stored is None:
        raise NotFound("We could not find that upload.")

    if not stored.is_owned_by(user):
        # Deliberately the same message as a missing file: telling a stranger
        # that a file exists but is not theirs is an information leak.
        raise NotFound("We could not find that upload.")

    if stored.upload_status == UploadStatus.READY:
        return stored  # idempotent: a retried request must not fail

    if stored.upload_status in (UploadStatus.REJECTED, UploadStatus.EXPIRED):
        raise Conflict("That upload was not accepted. Start a new one.")

    if stored.upload_expires_at and timezone.now() > stored.upload_expires_at:
        stored.upload_status = UploadStatus.EXPIRED
        stored.save(update_fields=["upload_status", "updated_at"])
        raise Conflict("That upload took too long. Try again.")

    storage = get_storage()
    try:
        actual_size, _etag = storage.stat(key=stored.storage_key)
        header = storage.read(key=stored.storage_key, length=HEADER_BYTES)
    except ObjectNotFound as exc:
        raise Conflict("We have not received that file yet. Finish uploading, then retry.") from exc
    except StorageError as exc:
        raise Conflict("We could not read that file. Try uploading it again.") from exc

    try:
        detected = validate_uploaded_bytes(
            purpose=stored.purpose,
            header=header,
            actual_size=actual_size,
            declared_content_type=stored.declared_content_type,
        )
    except FileValidationError as exc:
        # Signal the rejection rather than raising here: this function runs
        # inside a transaction, and raising would roll back the rejected status
        # and its audit entry, leaving a refused executable looking like an
        # upload that simply never arrived. The wrapper records it after this
        # transaction has ended, then raises.
        raise _UploadRejected(str(exc)) from exc

    full = storage.read(key=stored.storage_key)
    checksum = hashlib.sha256(full).hexdigest()

    stored.content_type = detected
    stored.size_bytes = actual_size
    stored.checksum_sha256 = checksum
    stored.upload_status = UploadStatus.UPLOADED
    stored.uploaded_at = timezone.now()
    stored.save(
        update_fields=[
            "content_type",
            "size_bytes",
            "checksum_sha256",
            "upload_status",
            "uploaded_at",
            "updated_at",
        ]
    )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="file",
        aggregate_id=stored.id,
        actor=user,
        changes={"upload_status": [UploadStatus.AWAITING_UPLOAD, UploadStatus.UPLOADED]},
        metadata={"detected_type": detected, "size": actual_size},
    )
    emit(
        DomainEvent(
            "files.upload_completed.v1",
            "file",
            str(stored.id),
            {"purpose": stored.purpose, "content_type": detected, "size_bytes": actual_size},
        )
    )

    # Scanning is asynchronous in production. Until a scanner is wired up the
    # policy is explicit rather than implied - see mark_scanned().
    from .tasks import scan_file

    transaction.on_commit(lambda: scan_file.delay(str(stored.id)))
    return stored


@transaction.atomic
def mark_scanned(*, file_id, clean: bool, detail: str = "") -> StoredFile:
    """Record a scan result and release the file for use if it passed."""
    stored = StoredFile.objects.select_for_update().filter(id=file_id).first()
    if stored is None:
        raise NotFound("We could not find that upload.")

    stored.scan_status = ScanStatus.CLEAN if clean else ScanStatus.INFECTED
    stored.scanned_at = timezone.now()
    if clean:
        stored.upload_status = UploadStatus.READY
    else:
        stored.upload_status = UploadStatus.REJECTED
        stored.rejection_reason = detail or "This file did not pass a security check."
        try:
            get_storage().delete(key=stored.storage_key)
        except StorageError:
            logger.warning(
                "could not delete infected upload", extra={"event": "upload_cleanup_failed"}
            )

    stored.save(
        update_fields=[
            "scan_status",
            "scanned_at",
            "upload_status",
            "rejection_reason",
            "updated_at",
        ]
    )
    emit(
        DomainEvent(
            "files.scan_completed.v1",
            "file",
            str(stored.id),
            {"clean": clean, "purpose": stored.purpose},
        )
    )
    return stored


def issue_download(*, user, stored: StoredFile, reason: str = "") -> object:
    """Mint a short-lived read URL, after checking the caller may have it.

    Access is never granted by knowing the id. Reads of sensitive files are
    audited, because "who looked at this person's Ghana Card" is a question the
    Data Protection Act expects an answer to.
    """
    if not stored.is_usable:
        raise Conflict("That file is not ready yet.")

    if not can_read(user=user, stored=stored):
        raise NotFound("We could not find that file.")

    ttl = SENSITIVE_DOWNLOAD_TTL_SECONDS if stored.is_sensitive else DOWNLOAD_TTL_SECONDS
    presigned = get_storage().presign_download(
        key=stored.storage_key, expires_in=ttl, filename=stored.original_filename
    )

    if stored.is_sensitive:
        record(
            action=AuditAction.VIEW,
            aggregate_type="file",
            aggregate_id=stored.id,
            actor=user,
            metadata={"purpose": stored.purpose, "reason": reason},
        )
    return presigned


def can_read(*, user, stored: StoredFile) -> bool:
    """Who may read a file.

    Four ways in, and no others:

    1. You uploaded it.
    2. You are staff, support or admin — the review team must see the evidence
       they are deciding on.
    3. You are a party to the rent payment this file evidences, or to the
       maintenance request this photograph or video shows.
    4. It is the profile photo of somebody living in a property you manage.

    Notably absent: any notion of "public". There is no branch for it, and
    adding one should require changing this function and its tests.
    """
    if user is None or not getattr(user, "is_authenticated", False):
        return False

    if stored.is_owned_by(user):
        return True

    from apps.identity.models import Role  # function-scope cross-domain import

    if user.is_staff or user.has_role(Role.SUPPORT) or user.has_role(Role.ADMIN):
        return True

    if stored.purpose == FilePurpose.PAYMENT_EVIDENCE:
        from apps.rent.models import RentPayment

        payment = (
            RentPayment.objects.filter(evidence_file=stored)
            .select_related("lease__unit__property")
            .first()
        )
        if payment is not None:
            if str(payment.lease.tenant_id) == str(user.id):
                return True
            return payment.lease.unit.property.is_managed_by(user)

    if stored.purpose in (FilePurpose.MAINTENANCE_PHOTO, FilePurpose.MAINTENANCE_VIDEO):
        from django.db.models import Q

        from apps.maintenance.models import MaintenanceRequest

        request = (
            MaintenanceRequest.objects.filter(Q(photo=stored) | Q(video=stored))
            .select_related("property")
            .first()
        )
        if request is not None:
            if str(request.tenant_id) == str(user.id):
                return True
            return request.property.is_managed_by(user)

    if stored.purpose == FilePurpose.AVATAR:
        # A provider sees the photo of somebody living in a property they
        # manage (owner, 2026-10-05: tenant cards should show the person). Only
        # an active occupancy counts — not an enquiry, not a past tenant — so a
        # photo reaches the people the tenant actually lives with as a landlord.
        # Whose photo it is comes from the profile it is set on: an upload that
        # is not anybody's current photo is readable by its owner alone.
        from apps.identity.models import Profile  # function-scope cross-domain import
        from apps.occupancy.models import Occupancy  # function-scope cross-domain import

        person_ids = list(Profile.objects.filter(avatar=stored).values_list("user_id", flat=True))
        if not person_ids:
            return False
        occupancies = Occupancy.objects.filter(
            user_id__in=person_ids, ended_at__isnull=True, status="active"
        ).select_related("property")
        return any(row.property.is_managed_by(user) for row in occupancies)
    return False


@transaction.atomic
def attach_to_verification(
    *, user, stored: StoredFile, verification, evidence_type: str, notes: str = ""
):
    """Link a ready file to a verification as evidence.

    The ownership check here is not redundant with the upload check: an attacker
    who learns another user's file id must not be able to enter it as their own
    evidence, which would put someone else's Ghana Card in front of a reviewer
    as if it were theirs.
    """
    if not stored.is_owned_by(user):
        raise NotFound("We could not find that upload.")

    if not stored.is_usable:
        raise ValidationFailed("That file is still being checked. Wait a moment and try again.")

    from apps.trust.services import attach_evidence

    return attach_evidence(
        verification,
        evidence_type=evidence_type,
        file=stored,
        collected_by=user,
        notes=notes,
    )
