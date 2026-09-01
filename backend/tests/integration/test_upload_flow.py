"""Upload lifecycle integration tests.

These cover the full three-step contract:
  reserve → (client uploads) → complete
and every security property the API must maintain.
"""

from uuid import uuid4

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def run_on_commit_inline(monkeypatch):
    """See the note in test_upload.py: pytest-django's uncommitted transaction
    would otherwise swallow the scan that releases an upload."""
    from django.db import transaction

    monkeypatch.setattr(transaction, "on_commit", lambda func, using=None: func())


@pytest.fixture
def api(user, sign_in_as):
    client = APIClient()
    # Sign the user in and get a real token
    from django.conf import settings

    settings.SMS_BACKEND = "memory"
    sign_in_as(client, user=user, device_fingerprint="test")
    return client


@pytest.fixture
def storage():
    from django.conf import settings

    from apps.files.storage import reset_storage

    settings.STORAGE_BACKEND = "memory"
    reset_storage()
    backend = __import__("apps.files.storage", fromlist=["get_storage"]).get_storage()
    yield backend
    reset_storage()


class TestReserveUpload:
    def test_reserve_returns_presigned_url(self, api, storage):
        response = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "photo.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 500_000,
            },
            format="json",
        )
        assert response.status_code == 201
        assert "file_id" in response.data
        assert "url" in response.data
        assert "method" in response.data
        assert "max_bytes" in response.data

    def test_unauthenticated_reserve_is_refused(self):
        client = APIClient()
        response = client.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "x.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 100,
            },
            format="json",
        )
        assert response.status_code in (401, 403)

    def test_disallowed_content_type_is_refused(self, api, storage):
        response = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "malware.exe",
                "content_type": "application/octet-stream",
                "size_bytes": 1000,
            },
            format="json",
        )
        assert response.status_code == 422

    def test_oversized_reserve_is_refused(self, api, storage):
        response = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "huge.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 100 * 1024 * 1024,
            },
            format="json",
        )
        assert response.status_code == 422

    def test_unknown_purpose_is_refused(self, api, storage):
        response = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "secret_documents",
                "filename": "x.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 1000,
            },
            format="json",
        )
        assert response.status_code == 422

    def test_path_traversal_in_filename_is_stripped(self, api, storage):
        response = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "../../etc/passwd",
                "content_type": "image/jpeg",
                "size_bytes": 100,
            },
            format="json",
        )
        # Either accepted with a safe filename, or refused
        if response.status_code == 201:
            from apps.files.models import StoredFile

            stored = StoredFile.objects.get(id=response.data["file_id"])
            assert "/" not in stored.original_filename
            assert "\\" not in stored.original_filename
        else:
            assert response.status_code == 422


class TestCompleteUpload:
    def _reserve(self, api, storage, purpose="avatar"):
        r = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": purpose,
                "filename": "test.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 500_000,
            },
            format="json",
        )
        assert r.status_code == 201
        return r.data["file_id"]

    def _write_jpeg(self, storage, file_id):
        from apps.files.models import StoredFile

        stored = StoredFile.objects.get(id=file_id)
        storage.write(key=stored.storage_key, data=b"\xff\xd8\xff\xe0" + b"\x00" * 1000)

    def test_complete_after_upload_moves_to_ready(self, api, storage):
        file_id = self._reserve(api, storage)
        self._write_jpeg(storage, file_id)
        response = api.post(f"/api/v1/files/uploads/{file_id}/complete/", format="json")
        assert response.status_code == 200
        # In permissive scan mode it should be ready or at least uploaded
        assert response.data["upload_status"] in ("ready", "uploaded")
        assert response.data["content_type"] == "image/jpeg"

    def test_complete_without_uploading_gives_clear_message(self, api, storage):
        file_id = self._reserve(api, storage)
        response = api.post(f"/api/v1/files/uploads/{file_id}/complete/", format="json")
        assert response.status_code == 409
        assert "received" in response.data["error"]["message"].lower()

    def test_complete_is_idempotent(self, api, storage):
        file_id = self._reserve(api, storage)
        self._write_jpeg(storage, file_id)
        r1 = api.post(f"/api/v1/files/uploads/{file_id}/complete/", format="json")
        r2 = api.post(f"/api/v1/files/uploads/{file_id}/complete/", format="json")
        assert r1.status_code == 200
        assert r2.status_code == 200

    def test_exe_disguised_as_jpeg_is_rejected(self, api, storage):
        file_id = self._reserve(api, storage)
        from apps.files.models import StoredFile

        stored = StoredFile.objects.get(id=file_id)
        # Put a Windows PE header into the object
        storage.write(key=stored.storage_key, data=b"MZ\x90\x00" + b"\x00" * 1000)
        response = api.post(f"/api/v1/files/uploads/{file_id}/complete/", format="json")
        assert response.status_code == 422
        assert "executable" in response.data["error"]["message"].lower()

    def test_another_user_cannot_complete_someones_upload(self, api, storage, landlord, sign_in_as):
        file_id = self._reserve(api, storage)
        self._write_jpeg(storage, file_id)
        # Sign in as a different user
        from django.conf import settings

        settings.SMS_BACKEND = "memory"
        other_client = APIClient()
        sign_in_as(other_client, user=landlord, device_fingerprint="landlord-device")
        response = other_client.post(f"/api/v1/files/uploads/{file_id}/complete/", format="json")
        assert response.status_code in (403, 404)


class TestFileDownload:
    def test_owner_gets_a_signed_url(self, api, storage):
        # Reserve + write + complete
        r = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "me.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 100_000,
            },
            format="json",
        )
        file_id = r.data["file_id"]
        from apps.files.models import StoredFile

        stored = StoredFile.objects.get(id=file_id)
        storage.write(key=stored.storage_key, data=b"\xff\xd8\xff\xe0" + b"\x00" * 100)
        api.post(f"/api/v1/files/uploads/{file_id}/complete/", format="json")

        response = api.get(f"/api/v1/files/{file_id}/download/")
        assert response.status_code == 200
        assert "url" in response.data

    def test_unauthenticated_download_is_refused(self, storage):
        client = APIClient()
        # Must be a well-formed UUID, or the route simply does not match and
        # the 404 tells us nothing about whether the endpoint checks auth.
        response = client.get(f"/api/v1/files/{uuid4()}/download/")
        assert response.status_code in (401, 403)

    def test_a_marketing_photo_is_served_inline(self, settings, landlord):
        """Otherwise a browser refuses to paint it and the gallery is empty.

        The default is `attachment`, which is right for a document: it downloads
        rather than opening, and nothing executes it. A photograph on a public
        listing needs the opposite, and Chrome blocks the image outright when it
        does not get it — every request came back 200 and every frame stayed
        blank. The caller asks, because storage cannot tell a bedroom from a
        Ghana Card.
        """
        from apps.files.storage import LocalStorageBackend, get_storage, reset_storage

        settings.STORAGE_BACKEND = "local"
        reset_storage()
        try:
            backend = get_storage()
            assert isinstance(backend, LocalStorageBackend)

            document = backend.presign_download(key="k/doc.pdf", filename="deed.pdf")
            photo = backend.presign_download(
                key="k/room.jpg", filename="room.jpg", disposition="inline"
            )

            assert "disposition=" not in document.url, "a document must still download"
            assert "disposition=inline" in photo.url
        finally:
            reset_storage()

    def test_only_an_image_may_be_served_inline(self, api, storage, user):
        """`inline` on a document would let a signed URL render in the tab.

        The disposition is not covered by the signature — it decides how already
        authorised bytes are presented — so the view has to decide for itself
        rather than believe the query string.
        """
        from django.conf import settings

        from apps.files.models import ScanStatus, StoredFile, UploadStatus
        from apps.files.storage import LocalStorageBackend, get_storage, reset_storage

        settings.STORAGE_BACKEND = "local"
        reset_storage()
        try:
            backend = get_storage()
            assert isinstance(backend, LocalStorageBackend)
            key = f"documents/{uuid4().hex}.pdf"
            backend.write(key=key, data=b"%PDF-1.4 not really")
            StoredFile.objects.create(
                uploaded_by=user,
                owner_id_snapshot=str(user.id),
                purpose="property_document",
                original_filename="deed.pdf",
                declared_content_type="application/pdf",
                content_type="application/pdf",
                size_bytes=19,
                storage_key=key,
                upload_status=UploadStatus.READY,
                scan_status=ScanStatus.CLEAN,
            )
            signed = backend.presign_download(key=key, filename="deed.pdf", disposition="inline")
            # The signed URL is absolute in this configuration; the route it
            # names lives under the API prefix.
            path = "/api/v1/storage/" + signed.url.split("/storage/", 1)[1]

            response = APIClient().get(path)

            assert response.status_code == 200
            assert response["Content-Disposition"].startswith("attachment")
            assert response["Content-Type"] == "application/octet-stream"
        finally:
            reset_storage()

    def test_limits_endpoint_requires_auth(self):
        client = APIClient()
        response = client.get("/api/v1/files/limits/")
        assert response.status_code in (401, 403)

    def test_limits_describes_every_purpose(self, api, storage):
        response = api.get("/api/v1/files/limits/")
        assert response.status_code == 200
        assert "identity_document" in response.data
        assert "property_photo" in response.data
        assert "max_bytes" in response.data["identity_document"]


class TestStorageKeySecurity:
    def test_storage_key_is_never_in_the_api_response(self, api, storage):
        r = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "me.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 10_000,
            },
            format="json",
        )
        # No storage_key in the response - clients should not know where the
        # object physically lives
        assert "storage_key" not in str(r.data)
        assert "bucket" not in str(r.data)

    def test_file_key_is_server_chosen(self, api, storage):
        """The client cannot influence the storage key. If it could, one user
        could overwrite another's file by guessing the path."""
        from apps.files.models import StoredFile

        r = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "../../admin/secret.jpg",  # attempted traversal
                "content_type": "image/jpeg",
                "size_bytes": 10_000,
            },
            format="json",
        )
        if r.status_code == 201:
            stored = StoredFile.objects.get(id=r.data["file_id"])
            assert stored.storage_key.startswith("avatar/")
