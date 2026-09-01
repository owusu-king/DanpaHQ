"""Upload lifecycle integration tests.

These need a database to test the model state transitions, but use the memory
storage backend rather than any external service - so they run in CI without
MinIO and on Windows without Docker for the storage layer.
"""

import pytest

from apps.files.models import ScanStatus, StoredFile, UploadStatus
from apps.files.storage import reset_storage
from apps.files.tasks import expire_abandoned_uploads

JPEG_HEADER = b"\xff\xd8\xff\xe0" + b"\x00" * 60
PNG_HEADER = b"\x89PNG\r\n\x1a\n" + b"\x00" * 56

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def run_on_commit_inline(monkeypatch):
    """Make transaction.on_commit callbacks fire during tests.

    pytest-django wraps each test in a transaction it never commits, so
    on_commit callbacks are silently dropped. The scan that releases an upload
    from `uploaded` to `ready` is scheduled that way, so without this every
    completed upload looks stuck and the download tests fail for a reason that
    has nothing to do with what they are testing.
    """
    from django.db import transaction

    monkeypatch.setattr(transaction, "on_commit", lambda func, using=None: func())


@pytest.fixture(autouse=True)
def memory_storage(settings):
    """Every test in this module uses the in-memory backend so no MinIO or
    filesystem needed. Isolated per test via `autouse` and the reset call."""
    settings.STORAGE_BACKEND = "memory"
    settings.FILE_SCAN_MODE = "permissive"
    reset_storage()
    from apps.files.storage import get_storage

    backend = get_storage()
    yield backend
    reset_storage()


def _write_jpeg(backend, key: str, size: int = 100_000) -> None:
    """Simulate a direct-to-storage upload of a JPEG."""
    data = JPEG_HEADER + b"\x00" * (size - len(JPEG_HEADER))
    backend.write(key=key, data=data)


class TestReserveUpload:
    def test_reserve_creates_a_pending_row(self, user):
        from apps.files import services

        stored, presigned = services.reserve_upload(
            user=user,
            purpose="identity_document",
            filename="ghana-card.jpg",
            content_type="image/jpeg",
            size_bytes=1_000_000,
        )
        assert stored.upload_status == UploadStatus.AWAITING_UPLOAD
        assert stored.is_owned_by(user)
        assert presigned.url

    def test_key_is_never_derived_from_the_filename(self, user):
        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="avatar",
            filename="../../etc/passwd",
            content_type="image/jpeg",
            size_bytes=100,
        )
        assert "etc" not in stored.storage_key
        assert "passwd" not in stored.storage_key

    def test_wrong_type_for_purpose_is_rejected_before_presign(self, user):
        from apps.core.exceptions import ValidationFailed
        from apps.files import services

        with pytest.raises(ValidationFailed):
            services.reserve_upload(
                user=user,
                purpose="lease_document",
                filename="agreement.jpg",
                content_type="image/jpeg",
                size_bytes=500_000,
            )

    def test_oversized_claim_is_rejected_before_presign(self, user):
        from apps.core.exceptions import ValidationFailed
        from apps.files import services

        with pytest.raises(ValidationFailed):
            services.reserve_upload(
                user=user,
                purpose="avatar",
                filename="photo.jpg",
                content_type="image/jpeg",
                size_bytes=50 * 1024 * 1024,
            )


class TestCompleteUpload:
    def test_complete_releases_the_file_as_ready(self, user, memory_storage):
        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="identity_document",
            filename="card.jpg",
            content_type="image/jpeg",
            size_bytes=1_000_000,
        )
        _write_jpeg(memory_storage, stored.storage_key)
        completed = services.complete_upload(user=user, file_id=stored.id)
        # The scan runs after completion and is what releases the file, so the
        # row has moved on from the instance complete_upload returned.
        completed.refresh_from_db()

        assert completed.upload_status == UploadStatus.READY
        assert completed.scan_status == ScanStatus.CLEAN
        assert completed.is_usable
        assert completed.content_type == "image/jpeg"
        assert completed.checksum_sha256  # 64-char hex
        assert completed.size_bytes > 0

    def test_complete_is_idempotent(self, user, memory_storage):
        """A client that retries after a network failure must get the same answer."""
        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="avatar",
            filename="me.jpg",
            content_type="image/jpeg",
            size_bytes=500_000,
        )
        _write_jpeg(memory_storage, stored.storage_key)
        services.complete_upload(user=user, file_id=stored.id)
        second = services.complete_upload(user=user, file_id=stored.id)
        second.refresh_from_db()
        assert second.upload_status == UploadStatus.READY

    def test_another_user_cannot_complete_someone_elses_upload(
        self, user, landlord, memory_storage
    ):
        from apps.core.exceptions import NotFound
        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="avatar",
            filename="me.jpg",
            content_type="image/jpeg",
            size_bytes=100_000,
        )
        _write_jpeg(memory_storage, stored.storage_key)
        with pytest.raises(NotFound):
            services.complete_upload(user=landlord, file_id=stored.id)

    def test_completing_without_uploading_gives_a_clear_message(self, user):
        from apps.core.exceptions import Conflict
        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="avatar",
            filename="me.jpg",
            content_type="image/jpeg",
            size_bytes=100_000,
        )
        # Nothing uploaded to storage
        with pytest.raises(Conflict, match="not received"):
            services.complete_upload(user=user, file_id=stored.id)

    def test_executable_disguised_as_jpeg_is_rejected(self, user, memory_storage):
        from apps.core.exceptions import ValidationFailed
        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="identity_document",
            filename="card.jpg",
            content_type="image/jpeg",
            size_bytes=1_000_000,
        )
        # Push an EXE with a JPEG extension
        exe_header = b"MZ\x90\x00" + b"\x00" * 60
        memory_storage.write(
            key=stored.storage_key,
            data=exe_header + b"\x00" * 10000,
        )
        with pytest.raises(ValidationFailed, match="executable"):
            services.complete_upload(user=user, file_id=stored.id)

        stored.refresh_from_db()
        assert stored.upload_status == UploadStatus.REJECTED
        assert not memory_storage.exists(key=stored.storage_key)  # bytes deleted

    def test_file_bytes_are_checksummed(self, user, memory_storage):
        import hashlib

        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="avatar",
            filename="photo.jpg",
            content_type="image/jpeg",
            size_bytes=500_000,
        )
        data = JPEG_HEADER + b"\xab" * 10000
        memory_storage.write(key=stored.storage_key, data=data)
        completed = services.complete_upload(user=user, file_id=stored.id)
        expected = hashlib.sha256(data).hexdigest()
        assert completed.checksum_sha256 == expected


class TestDownload:
    def test_owner_can_get_a_download_url(self, user, memory_storage):
        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="avatar",
            filename="photo.jpg",
            content_type="image/jpeg",
            size_bytes=100_000,
        )
        _write_jpeg(memory_storage, stored.storage_key)
        services.complete_upload(user=user, file_id=stored.id)
        stored.refresh_from_db()

        presigned = services.issue_download(user=user, stored=stored)
        assert presigned.url

    def test_a_pending_file_cannot_be_downloaded(self, user):
        from apps.core.exceptions import Conflict
        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="avatar",
            filename="photo.jpg",
            content_type="image/jpeg",
            size_bytes=100_000,
        )
        with pytest.raises(Conflict):
            services.issue_download(user=user, stored=stored)

    def test_stranger_cannot_download(self, user, landlord, memory_storage):
        from apps.core.exceptions import NotFound
        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="avatar",
            filename="photo.jpg",
            content_type="image/jpeg",
            size_bytes=100_000,
        )
        _write_jpeg(memory_storage, stored.storage_key)
        services.complete_upload(user=user, file_id=stored.id)
        stored.refresh_from_db()

        with pytest.raises(NotFound):
            services.issue_download(user=landlord, stored=stored)

    def test_staff_can_access_any_file(self, user, staff, memory_storage):
        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="identity_document",
            filename="card.jpg",
            content_type="image/jpeg",
            size_bytes=500_000,
        )
        _write_jpeg(memory_storage, stored.storage_key)
        services.complete_upload(user=user, file_id=stored.id)
        stored.refresh_from_db()

        presigned = services.issue_download(user=staff, stored=stored)
        assert presigned.url


class TestRetention:
    def test_expired_reservations_are_swept(self, user):
        from datetime import timedelta

        from django.utils import timezone

        from apps.files import services

        stored, _ = services.reserve_upload(
            user=user,
            purpose="avatar",
            filename="photo.jpg",
            content_type="image/jpeg",
            size_bytes=100_000,
        )
        # Backdate the expiry
        StoredFile.objects.filter(id=stored.id).update(
            upload_expires_at=timezone.now() - timedelta(minutes=30)
        )

        result = expire_abandoned_uploads()
        assert result["expired"] >= 1
        stored.refresh_from_db()
        assert stored.upload_status == UploadStatus.EXPIRED


class TestApiEndpoints:
    def test_reserve_endpoint_requires_auth(self, client):
        response = client.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "photo.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 100000,
            },
            content_type="application/json",
        )
        assert response.status_code in (401, 403)

    def test_limits_endpoint_requires_auth(self, client):
        response = client.get("/api/v1/files/limits/")
        assert response.status_code in (401, 403)

    def test_reserve_returns_presigned_fields(self, user, memory_storage, sign_in_as):
        from rest_framework.test import APIClient

        api = APIClient()
        sign_in_as(api, user=user, device_fingerprint="api-test")

        response = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "me.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 100000,
            },
            format="json",
        )
        assert response.status_code == 201
        body = response.data
        assert "file_id" in body
        assert "url" in body
        assert "method" in body
        assert "expires_in" in body

    def test_limits_endpoint_returns_all_purposes(self, user, sign_in_as):
        from rest_framework.test import APIClient

        from apps.files.validation import LIMITS

        api = APIClient()
        sign_in_as(api, user=user, device_fingerprint="lim-test")

        response = api.get("/api/v1/files/limits/")
        assert response.status_code == 200
        for purpose in LIMITS:
            assert purpose in response.data


def _code(user):
    """Pull the most recent OTP out of the memory SMS backend."""
    from apps.identity.providers import get_sms_provider

    provider = get_sms_provider()
    return "".join(ch for ch in provider.outbox[-1].body.split()[0] if ch.isdigit())
