"""File maintenance and scanning."""

from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import ScanStatus, StoredFile, UploadStatus

logger = logging.getLogger("files")


@shared_task(name="media.scan_file")
def scan_file(file_id: str) -> dict:
    """Scan an uploaded file for malware.

    **No scanner is integrated.** What happens instead is governed by
    ``FILE_SCAN_MODE`` and is deliberately explicit rather than a silent pass:

    * ``strict`` (the production default) — files stay ``pending`` and therefore
      unusable until a real scanner marks them. A deploy without a scanner
      configured will visibly fail to release files, which is the correct
      behaviour: better a stuck upload than an unscanned document served as
      trusted.
    * ``permissive`` (development) — releases the file and logs loudly, so local
      work is possible without standing up ClamAV.

    Magic-byte validation in ``services.complete_upload`` has already rejected
    executables, archives and scripts. That is a meaningful control but it is not
    virus scanning, and this docstring exists so nobody mistakes one for the
    other.
    """
    from .services import mark_scanned

    mode = getattr(settings, "FILE_SCAN_MODE", "strict")

    if mode == "permissive":
        logger.warning(
            "releasing file without a virus scan (FILE_SCAN_MODE=permissive)",
            extra={"event": "file_scan_skipped", "provider": "none"},
        )
        mark_scanned(file_id=file_id, clean=True)
        return {"scanned": False, "released": True, "mode": mode}

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
