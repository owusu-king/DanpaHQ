"""File maintenance and scanning."""

from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import ScanStatus, StoredFile, UploadStatus
from .scanner import ScanError, scan_with_cloudmersive
from .storage import StorageError

logger = logging.getLogger("files")


@shared_task(bind=True, name="media.scan_file", max_retries=3)
def scan_file(self, file_id: str) -> dict:
    """Scan an uploaded file for malware.

    A provider failure never releases the file. The development-only permissive
    mode is explicit; production rejects that setting at startup.
    """
    from .services import mark_scanned

    mode = getattr(settings, "FILE_SCAN_MODE", "strict")
    stored = StoredFile.objects.filter(id=file_id).first()
    if stored is None or stored.upload_status != UploadStatus.UPLOADED:
        return {"scanned": False, "released": False, "mode": mode}

    if mode == "permissive":
        logger.warning(
            "releasing file without a virus scan (FILE_SCAN_MODE=permissive)",
            extra={"event": "file_scan_skipped", "provider": "none"},
        )
        mark_scanned(file_id=file_id, clean=True)
        return {"scanned": False, "released": True, "mode": mode}

    if mode == "cloudmersive":
        try:
            clean = scan_with_cloudmersive(stored)
            mark_scanned(file_id=file_id, clean=clean)
        except (ScanError, StorageError) as exc:
            logger.warning("malware scan unavailable", extra={"event": "file_scan_failed"})
            if self.request.retries < self.max_retries:
                raise self.retry(exc=exc, countdown=60 * (2**self.request.retries)) from exc
            StoredFile.objects.filter(id=file_id, upload_status=UploadStatus.UPLOADED).update(
                scan_status=ScanStatus.FAILED, updated_at=timezone.now()
            )
            return {"scanned": False, "released": False, "mode": mode}
        return {"scanned": True, "released": clean, "mode": mode}

    logger.info(
        "file awaiting a real scanner; it stays unusable until one reports",
        extra={"event": "file_scan_pending", "provider": "none"},
    )
    return {"scanned": False, "released": False, "mode": mode}


@shared_task(name="media.expire_abandoned_uploads")
def expire_abandoned_uploads() -> dict:
    """Close out reservations the client never honoured.

    A presign that is never used leaves a row and possibly a partial object.
    Without this they accumulate forever, and on a network where uploads fail
    often that is a lot of rows.
    """
    now = timezone.now()
    stale = StoredFile.objects.filter(
        upload_status=UploadStatus.AWAITING_UPLOAD, upload_expires_at__lt=now
    )
    expired = stale.update(upload_status=UploadStatus.EXPIRED, updated_at=now)
    return {"expired": expired}


@shared_task(name="media.purge_expired_files")
def purge_expired_files() -> dict:
    """Delete files whose retention period has passed.

    Data minimisation with teeth: an identity document is kept only as long as
    it is needed to defend the verification decision it supported. The row stays
    (evidence must remain traceable) but the bytes go, and the row records that
    they were purged rather than lost.
    """
    from .storage import StorageError, get_storage

    storage = get_storage()
    today = timezone.now().date()
    due = StoredFile.all_objects.filter(
        retain_until__isnull=False, retain_until__lt=today, deleted_at__isnull=True
    )

    purged = failed = 0
    for stored in due.iterator():
        try:
            storage.delete(key=stored.storage_key)
        except StorageError:
            failed += 1
            logger.warning("retention delete failed", extra={"event": "retention_failed"})
            continue

        stored.deleted_at = timezone.now()
        stored.deleted_reason = "retention period elapsed"
        stored.scan_status = ScanStatus.PENDING
        stored.save(update_fields=["deleted_at", "deleted_reason", "scan_status", "updated_at"])
        purged += 1

    return {"purged": purged, "failed": failed}
