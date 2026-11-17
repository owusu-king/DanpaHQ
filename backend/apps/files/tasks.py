"""File maintenance and scanning."""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from kombu.exceptions import OperationalError  # type: ignore[import-untyped]

from .models import ScanStatus, StoredFile, UploadStatus
from .scanner import ScanError, scan_with_cloudmersive
from .storage import StorageError

logger = logging.getLogger("files")


@transaction.atomic
def mark_scan_failed(file_id, reason):
    stored = StoredFile.objects.select_for_update().filter(
        id=file_id, upload_status=UploadStatus.UPLOADED,
    ).first()
    if stored is not None:
        stored.scan_status = ScanStatus.FAILED
        stored.metadata = {**stored.metadata, "scan_failure": reason}
        stored.save(update_fields=["scan_status", "metadata", "updated_at"])


def dispatch_scan(file_id):
    try:
        scan_file.delay(file_id)
    except OperationalError:
        logger.warning("could not queue the file safety check", extra={
            "event": "file_scan_queue_failed", "file_id": file_id,
        })
        mark_scan_failed(file_id, "queue_unavailable")


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
            reason = exc.reason if isinstance(exc, ScanError) else "storage_seal_failed"
            status = exc.status if isinstance(exc, ScanError) else None
            logger.warning(
                "file safety check failed: %s (provider HTTP %s)",
                reason, status,
                extra={"event": "file_scan_failed", "file_id": file_id, "provider": mode},
            )
            retryable = not isinstance(exc, ScanError) or exc.retryable
            if retryable and self.request.retries < self.max_retries:
                raise self.retry(countdown=60 * (2**self.request.retries)) from None
            mark_scan_failed(file_id, reason)
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
    from .storage import get_storage
    from .videos import VIDEO_PURPOSES

    now = timezone.now()
    stale = StoredFile.objects.filter(
        upload_status=UploadStatus.AWAITING_UPLOAD, upload_expires_at__lt=now
    )
    due = timezone.localdate() - timedelta(days=1)
    expired = stale.update(upload_status=UploadStatus.EXPIRED, updated_at=now, retain_until=due)
    # An expired reservation may already have bytes in storage even though the
    # client never completed it. Put these on the existing retryable purge path,
    # including reservations expired by an earlier version of this task.
    StoredFile.objects.filter(upload_status=UploadStatus.EXPIRED, retain_until__isnull=True).update(
        retain_until=due,
    )
    sources_removed = 0
    for stored in StoredFile.all_objects.filter(
        purpose__in=VIDEO_PURPOSES,
        upload_expires_at__lt=now,
        metadata__source_cleanup_pending=True,
    ).iterator():
        original = stored.storage_key.removesuffix(".ready").removesuffix(".prepared.mp4")
        if original == stored.storage_key:
            continue
        try:
            get_storage().delete(key=original)
        except StorageError:
            logger.warning("video source cleanup failed", extra={
                "event": "upload_cleanup_failed", "file_id": str(stored.id),
            })
            continue
        metadata = {**stored.metadata, "source_cleanup_pending": False}
        StoredFile.all_objects.filter(pk=stored.pk).update(metadata=metadata)
        sources_removed += 1
    return {"expired": expired, "video_sources_removed": sources_removed}


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
