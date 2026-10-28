"""Editorial permissions, draft isolation, upload ownership and scan gates."""

import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.core.exceptions import PermissionDenied
from apps.files import services as files
from apps.files.models import StoredFile
from apps.files.storage import get_storage
from apps.operations.guides import CONTENT_ID, default_guides, video_source
from apps.operations.models import HowItWorksContent, ManagementRole
from tests.conftest import make_account
from tests.integration.test_management_portal import management_user, signed_in_client

pytestmark = pytest.mark.django_db
BASE = "/api/v1/management/how-it-works/"


def guide(**values):
    return {**default_guides()[0], **values}


def test_bootstrap_preserves_existing_welcome_and_public_feed_is_anonymous():
    response = APIClient().get("/api/v1/how-it-works/")
    assert response.status_code == 200
    assert len(response.data["guides"]) == 8
    assert response.data["guides"][0]["src"] == "/videos/welcome.mp4"
    assert "video_file_id" not in response.data["guides"][0]
    assert response["Cache-Control"] == "no-store"


def test_save_publish_order_and_empty_collection_never_restore_defaults():
    operator = management_user()
    api = signed_in_client(operator)
    response = api.put(
        BASE,
        {"revision": 0, "guides": [guide(id="second", title="Second"), guide(published=False)]},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["revision"] == 1
    public = APIClient().get("/api/v1/how-it-works/").data["guides"]
    assert [row["id"] for row in public] == ["second"]
    assert AuditLog.objects.filter(
        aggregate_type="how_it_works", management_actor_id=operator.id
    ).exists()
    assert api.put(BASE, {"revision": 1, "guides": []}, format="json").status_code == 200
    assert APIClient().get("/api/v1/how-it-works/").data["guides"] == []


def test_stale_editor_cannot_overwrite_another_save():
    api = signed_in_client(management_user())
    payload = {"revision": 0, "guides": [guide()]}
    assert api.put(BASE, payload, format="json").status_code == 200
    assert api.put(BASE, payload, format="json").status_code == 409
    assert HowItWorksContent.objects.get(id=CONTENT_ID).revision == 1


def test_preview_does_not_publish_and_limits_are_enforced():
    api = signed_in_client(management_user())
    response = api.post(
        BASE + "preview/", guide(url="https://youtu.be/6Kea_GJ0SHQ", published=False), format="json"
    )
    assert response.status_code == 200
    assert response.data["kind"] == "youtube"
    assert not HowItWorksContent.objects.exists()
    assert (
        api.put(
            BASE,
            {"revision": 0, "guides": [guide(id=f"chapter-{i}") for i in range(11)]},
            format="json",
        ).status_code
        == 422
    )
    assert (
        api.put(BASE, {"revision": 0, "guides": [guide(), guide()]}, format="json").status_code
        == 422
    )


@pytest.mark.parametrize(
    "url,kind,expected",
    [
        (
            "https://youtube.com/shorts/6Kea_GJ0SHQ?si=test",
            "youtube",
            "https://www.youtube-nocookie.com/embed/6Kea_GJ0SHQ?rel=0",
        ),
        (
            "https://www.youtube.com/watch?v=6Kea_GJ0SHQ",
            "youtube",
            "https://www.youtube-nocookie.com/embed/6Kea_GJ0SHQ?rel=0",
        ),
        (
            "https://vimeo.com/12345678/abcdef",
            "vimeo",
            "https://player.vimeo.com/video/12345678?h=abcdef",
        ),
        (
            "https://media.example.com/intro.mp4?signature=test",
            "video",
            "https://media.example.com/intro.mp4?signature=test",
        ),
    ],
)
def test_known_video_links_are_normalized(url, kind, expected):
    assert video_source(url) == (expected, kind)


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "//evil.test/video.mp4",
        "http://example.com/a.mp4",
        "https://youtube.com.evil.test/watch?v=6Kea_GJ0SHQ",
        "<iframe src='x'>",
        "/videos/../private.mp4",
    ],
)
def test_unsafe_or_unsupported_links_cannot_be_saved(url):
    api = signed_in_client(management_user())
    assert (
        api.put(BASE, {"revision": 0, "guides": [guide(url=url)]}, format="json").status_code == 422
    )
    assert not HowItWorksContent.objects.exists()


def test_non_editors_and_consumers_cannot_manage_or_upload():
    anonymous = APIClient()
    support = signed_in_client(management_user(ManagementRole.SUPPORT_ADMIN))
    for api in [anonymous, support]:
        assert api.get(BASE).status_code in (401, 403)
        assert api.put(BASE, {"revision": 0, "guides": []}, format="json").status_code in (401, 403)
        assert api.post(BASE + "uploads/", {}, format="json").status_code in (401, 403)
    with pytest.raises(PermissionDenied):
        files.reserve_upload(
            user=make_account("0207788991"),
            purpose="guide_video",
            filename="intro.mp4",
            content_type="video/mp4",
            size_bytes=100,
        )


def test_managed_upload_reuses_validation_scanning_and_namespaced_ownership(
    django_capture_on_commit_callbacks,
):
    operator = management_user()
    api = signed_in_client(operator)
    binary = b"\x00\x00\x00\x18ftypmp42" + bytes(64)
    reserved = api.post(
        BASE + "uploads/",
        {
            "purpose": "guide_video",
            "filename": "intro.mp4",
            "content_type": "video/mp4",
            "size_bytes": len(binary),
        },
        format="json",
    )
    assert reserved.status_code == 201
    file_id = reserved.data["file_id"]
    stored = StoredFile.objects.get(id=file_id)
    assert stored.uploaded_by is None
    assert stored.owner_id_snapshot == f"management:{operator.id}"
    collision = make_account("0207788992", id=operator.id)
    assert not stored.is_owned_by(collision)
    other = signed_in_client(management_user(email="second@example.com"))
    assert other.post(BASE + f"uploads/{file_id}/", {}, format="json").status_code == 404
    get_storage().write(key=stored.storage_key, data=binary)
    # A pending upload cannot be attached, even by its owner.
    assert (
        api.put(
            BASE,
            {"revision": 0, "guides": [guide(url="", video_file_id=str(file_id))]},
            format="json",
        ).status_code
        == 422
    )
    with django_capture_on_commit_callbacks(execute=True):
        assert api.post(BASE + f"uploads/{file_id}/", {}, format="json").status_code == 200
    stored.refresh_from_db()
    assert stored.is_usable
    assert (
        api.put(
            BASE,
            {"revision": 0, "guides": [guide(url="", video_file_id=str(file_id))]},
            format="json",
        ).status_code
        == 200
    )
    item = APIClient().get("/api/v1/how-it-works/").data["guides"][0]
    assert item["kind"] == "video"
    assert ".ready" in item["src"]
    assert "disposition=inline" in item["src"]


def test_private_or_wrong_purpose_files_cannot_be_published():
    operator = management_user()
    api = signed_in_client(operator)
    stored = StoredFile.objects.create(
        storage_key="private/id",
        bucket="memory",
        purpose="identity_document",
        original_filename="id.pdf",
        upload_status="ready",
        scan_status="clean",
        owner_id_snapshot=f"management:{operator.id}",
    )
    assert (
        api.put(
            BASE,
            {"revision": 0, "guides": [guide(url="", video_file_id=str(stored.id))]},
            format="json",
        ).status_code
        == 422
    )


def test_invalid_video_bytes_are_rejected_and_not_publishable():
    api = signed_in_client(management_user())
    reserved = api.post(
        BASE + "uploads/",
        {
            "purpose": "guide_video",
            "filename": "intro.mp4",
            "content_type": "video/mp4",
            "size_bytes": 20,
        },
        format="json",
    )
    stored = StoredFile.objects.get(id=reserved.data["file_id"])
    get_storage().write(key=stored.storage_key, data=b"<html>not a video</html>")
    assert api.post(BASE + f"uploads/{stored.id}/", {}, format="json").status_code == 422
    stored.refresh_from_db()
    assert not stored.is_usable
    assert stored.upload_status == "rejected"


@pytest.mark.parametrize(
    "purpose,content_type,binary,field",
    [
        (
            "guide_captions",
            "text/vtt",
            b"WEBVTT\n\n00:00.000 --> 00:01.000\nWelcome.\n",
            "captions_file_id",
        ),
        ("guide_thumbnail", "image/png", b"\x89PNG\r\n\x1a\n" + bytes(64), "thumbnail_file_id"),
    ],
)
def test_optional_assets_follow_the_same_checked_upload_pipeline(
    purpose, content_type, binary, field, django_capture_on_commit_callbacks
):
    api = signed_in_client(management_user())
    reserved = api.post(
        BASE + "uploads/",
        {
            "purpose": purpose,
            "filename": "guide-asset",
            "content_type": content_type,
            "size_bytes": len(binary),
        },
        format="json",
    )
    assert reserved.status_code == 201
    stored = StoredFile.objects.get(id=reserved.data["file_id"])
    get_storage().write(key=stored.storage_key, data=binary)
    with django_capture_on_commit_callbacks(execute=True):
        assert api.post(BASE + f"uploads/{stored.id}/", {}, format="json").status_code == 200
    assert (
        api.put(
            BASE, {"revision": 0, "guides": [guide(**{field: str(stored.id)})]}, format="json"
        ).status_code
        == 200
    )
    public = APIClient().get("/api/v1/how-it-works/").data["guides"][0]
    assert public["captions" if field == "captions_file_id" else "thumbnail"]


def test_editor_mutations_require_management_csrf():
    api = signed_in_client(management_user())
    api.credentials()
    assert api.put(BASE, {"revision": 0, "guides": []}, format="json").status_code == 403


@pytest.mark.parametrize(
    "purpose,content_type,binary",
    [
        ("guide_video", "video/mp4", b"\x00\x00\x00\x18ftypmp42" + bytes(64)),
        ("guide_captions", "text/vtt", b"WEBVTT\n\n00:00.000 --> 00:01.000\nWelcome.\n"),
    ],
)
def test_local_storage_serves_only_checked_guide_media_inline(
    purpose, content_type, binary, settings, tmp_path
):
    from apps.files.storage import reset_storage

    settings.STORAGE_BACKEND = "local"
    settings.LOCAL_STORAGE_ROOT = tmp_path
    reset_storage()
    try:
        backend = get_storage()
        key = f"guides/{purpose}.ready"
        backend.write(key=key, data=binary)
        stored = StoredFile.objects.create(
            storage_key=key,
            bucket="local",
            storage_backend="local",
            purpose=purpose,
            content_type=content_type,
            original_filename="guide",
            upload_status="ready",
            scan_status="clean",
        )
        signed = backend.presign_download(key=key, filename="guide", disposition="inline")
        path = "/api/v1/storage/" + signed.url.split("/storage/", 1)[1]
        response = APIClient().get(path)
        assert response.status_code == 200
        assert response["Content-Type"] == content_type
        assert response["Content-Disposition"] == "inline"
        stored.upload_status = "uploaded"
        stored.save(update_fields=["upload_status", "updated_at"])
        assert APIClient().get(path)["Content-Type"] == "application/octet-stream"
    finally:
        reset_storage()
