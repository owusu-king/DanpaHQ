"""Optional walkthroughs share the upload security and review boundary, not photo slots."""

import subprocess
from pathlib import Path
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict, PermissionDenied, ValidationFailed
from apps.files import services as uploads
from apps.files.models import ScanStatus, StoredFile, UploadStatus
from apps.files.storage import get_storage, reset_storage
from apps.files.validation import FileValidationError, validate_declared_upload
from apps.files.videos import prepare_video, video_payload
from apps.property.videos import set_video

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def storage():
    reset_storage()
    yield get_storage()
    reset_storage()


@pytest.fixture
def records(landlord):
    from apps.geo.models import Address, Locality, Region
    from apps.property.models import Property, Unit

    region = Region.objects.create(name="Video Region", code="VR")
    place = Locality.objects.create(name="Video Place", region=region)
    prop = Property.objects.create(
        owner=landlord,
        title="Video Property",
        property_type="residential",
        address=Address.objects.create(locality=place),
    )
    return prop, Unit.objects.create(
        property=prop, label="Flat A", space_type="apartment", bedrooms=1, bathrooms=1
    )


def clip(tmp_path: Path, seconds=1, *, container="mp4", audio=False):
    output = tmp_path / f"sample.{container}"
    command = ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=green:s=320x240:r=30"]
    if audio:
        command += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"]
    command += ["-t", str(seconds), "-c:v", "libvpx" if container == "webm" else "libx264"]
    if audio:
        command += ["-c:a", "libvorbis" if container == "webm" else "aac"]
    subprocess.run([*command, "-y", str(output)], check=True, capture_output=True, timeout=20)  # noqa: S603
    return output.read_bytes()


def ready(owner, purpose="property_video"):
    return StoredFile.objects.create(
        storage_key=f"video/{uuid4()}.mp4.ready",
        bucket="test",
        purpose=purpose,
        original_filename="video.mp4",
        content_type="video/mp4",
        size_bytes=1000,
        uploaded_by=owner,
        upload_status=UploadStatus.READY,
        scan_status=ScanStatus.CLEAN,
        metadata={"video_validated": True, "duration_ms": 1000},
    )


@pytest.mark.parametrize("container", ["mp4", "mov", "webm"])
def test_actual_video_is_normalized_for_web_and_mobile(tmp_path, container):
    content, metadata = prepare_video(clip(tmp_path, container=container, audio=True))
    assert b"ftyp" in content[:16]
    assert 0 < metadata["duration_ms"] <= 10_000
    assert metadata["video_validated"] is True
    assert len(content) <= 3_300_000


def test_ten_second_boundary_and_long_video_are_checked_from_bytes(tmp_path):
    _, metadata = prepare_video(clip(tmp_path, 10, audio=True))
    assert metadata["duration_ms"] <= 10_000
    with pytest.raises(FileValidationError, match="10 seconds"):
        prepare_video(clip(tmp_path, 10.2))


def test_corrupt_container_and_disallowed_types_fail_closed():
    with pytest.raises(FileValidationError):
        prepare_video(b"\x00\x00\x00\x18ftypmp42" + bytes(200))
    for purpose in ("property_video", "unit_video"):
        with pytest.raises(FileValidationError):
            validate_declared_upload(purpose=purpose, content_type="image/jpeg", size_bytes=1000)
        with pytest.raises(FileValidationError):
            validate_declared_upload(
                purpose=purpose, content_type="video/mp4", size_bytes=30 * 1024**2 + 1
            )


def test_complete_validates_compresses_scans_and_seals_once(
    landlord, tmp_path, storage, django_capture_on_commit_callbacks
):
    raw = clip(tmp_path)
    file, _ = uploads.reserve_upload(
        user=landlord,
        purpose="property_video",
        filename="exterior.mp4",
        content_type="video/mp4",
        size_bytes=len(raw),
    )
    original = file.storage_key
    storage.write(key=original, data=raw)
    with django_capture_on_commit_callbacks(execute=True):
        uploads.complete_upload(user=landlord, file_id=file.id)
    file.refresh_from_db()
    assert file.is_usable and file.storage_key.endswith(".prepared.mp4.ready")
    assert file.metadata["duration_ms"] <= 10_000
    assert not storage.exists(key=original)
    assert uploads.complete_upload(user=landlord, file_id=file.id).pk == file.pk


@pytest.mark.parametrize("index,purpose", [(0, "property_video"), (1, "unit_video")])
def test_one_video_replacement_removal_and_retries_leave_photos_alone(
    records, landlord, index, purpose
):
    subject = records[index]
    first, second = ready(landlord, purpose), ready(landlord, purpose)
    subject = set_video(subject=subject, user=landlord, file_id=first.id)
    subject = set_video(subject=subject, user=landlord, file_id=first.id)
    assert subject.video_id == first.id
    assert subject.media.count() == 0
    subject = set_video(subject=subject, user=landlord, file_id=second.id)
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.retain_until is not None and second.retain_until is None
    assert subject.video_id == second.id
    subject = set_video(subject=subject, user=landlord, file_id=None)
    assert subject.video_id is None


def test_ownership_purpose_scan_and_cross_record_association_are_enforced(records, landlord, agent):
    from apps.property.models import Unit

    prop, unit = records
    with pytest.raises(PermissionDenied):
        set_video(subject=prop, user=agent, file_id=ready(agent).id)
    with pytest.raises(PermissionDenied):
        set_video(subject=prop, user=landlord, file_id=ready(agent).id)
    with pytest.raises(ValidationFailed):
        set_video(subject=unit, user=landlord, file_id=ready(landlord).id)
    unsafe = ready(landlord, "unit_video")
    unsafe.scan_status = ScanStatus.PENDING
    unsafe.save()
    with pytest.raises(ValidationFailed):
        set_video(subject=unit, user=landlord, file_id=unsafe.id)
    file = ready(landlord, "unit_video")
    set_video(subject=unit, user=landlord, file_id=file.id)
    other = Unit.objects.create(
        property=prop, label="Flat B", space_type="apartment", bedrooms=1, bathrooms=1
    )
    with pytest.raises(Conflict):
        set_video(subject=other, user=landlord, file_id=file.id)


def test_video_never_completes_photo_requirements_or_escapes_review(records, landlord, monkeypatch):
    from apps.trust import condition

    prop, unit = records
    before = condition.snapshot(unit)["required_outstanding"]
    unit = set_video(subject=unit, user=landlord, file_id=ready(landlord, "unit_video").id)
    assert condition.snapshot(unit)["required_outstanding"] == before > 0
    assert video_payload(unit, public=True) is None
    monkeypatch.setattr(condition, "lifecycle_state", lambda *args, **kwargs: "verified")
    assert video_payload(unit, public=True)["id"] == str(unit.video_id)
    with pytest.raises(Conflict):
        set_video(subject=unit, user=landlord, file_id=None)
    with pytest.raises(Conflict):
        set_video(subject=prop, user=landlord, file_id=ready(landlord).id)


def test_video_api_is_optional_private_and_idempotent(records, landlord):
    prop, _ = records
    api = APIClient()
    url = f"/api/v1/properties/{prop.id}/video/"
    assert api.get(url).status_code == 401
    api.force_authenticate(landlord)
    assert api.get(url).data is None
    assert api.put(url, {"file_id": "bad"}, format="json").status_code == 422
    file = ready(landlord)
    assert api.put(url, {"file_id": str(file.id)}, format="json").status_code == 200
    assert api.put(url, {"file_id": str(file.id)}, format="json").status_code == 200
    assert api.delete(url).status_code == 204
    assert api.delete(url).status_code == 204


def test_reservation_retry_reuses_file_row(landlord):
    api = APIClient()
    api.force_authenticate(landlord)
    body = {
        "purpose": "unit_video",
        "filename": "unit.mp4",
        "content_type": "video/mp4",
        "size_bytes": 1200,
    }
    first = api.post(
        "/api/v1/files/uploads/", body, format="json", HTTP_IDEMPOTENCY_KEY="video-reservation-test"
    )
    again = api.post(
        "/api/v1/files/uploads/", body, format="json", HTTP_IDEMPOTENCY_KEY="video-reservation-test"
    )
    assert first.status_code == again.status_code == 201
    assert first.data["file_id"] == again.data["file_id"]
    assert StoredFile.objects.filter(purpose="unit_video").count() == 1


def test_forged_duration_is_checked_again_after_decoding(tmp_path, monkeypatch):
    from apps.files import videos

    raw = clip(tmp_path, 11)
    original = videos._probe

    def forged(path, **kwargs):
        duration, streams = original(path, **kwargs)
        return (1, streams) if path.name == "source" else (duration, streams)

    monkeypatch.setattr(videos, "_probe", forged)
    with pytest.raises(FileValidationError, match="10 seconds"):
        videos.prepare_video(raw)


def test_signed_local_playback_supports_byte_ranges(landlord, settings, tmp_path):
    settings.STORAGE_BACKEND = "local"
    settings.LOCAL_STORAGE_ROOT = str(tmp_path)
    reset_storage()
    storage = get_storage()
    file = ready(landlord)
    storage.write(key=file.storage_key, data=b"0123456789")
    signed = storage.presign_download(key=file.storage_key, disposition="inline").url
    from urllib.parse import urlsplit

    parsed = urlsplit(signed)
    path = f"{parsed.path}?{parsed.query}"
    response = APIClient().get(path, HTTP_RANGE="bytes=2-5")
    assert response.status_code == 206
    assert response.content == b"2345"
    assert response["Content-Type"] == "video/mp4"
    assert response["Content-Range"] == "bytes 2-5/10"
    assert APIClient().get(path, HTTP_RANGE="bytes=50-").status_code == 416


def test_failed_scan_can_retry_the_same_upload(
    landlord, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.files.tasks import scan_file

    file = ready(landlord)
    file.upload_status = UploadStatus.UPLOADED
    file.scan_status = ScanStatus.FAILED
    file.save()
    queued = []
    monkeypatch.setattr(scan_file, "delay", lambda key: queued.append(key))
    with django_capture_on_commit_callbacks(execute=True):
        uploads.complete_upload(user=landlord, file_id=file.id)
        uploads.complete_upload(user=landlord, file_id=file.id)
    file.refresh_from_db()
    assert queued == [str(file.id)]
    assert file.scan_status == ScanStatus.PENDING
    assert not file.is_usable


def test_submission_freezes_optional_video_for_the_reviewer(records, landlord, monkeypatch):
    from apps.trust import condition
    from apps.trust.models import Verification
    from apps.trust.serializers import ReviewerVerificationSerializer

    prop, _ = records
    file = ready(landlord)
    prop = set_video(subject=prop, user=landlord, file_id=file.id)
    review = Verification.objects.create(
        subject_type="property",
        subject_id=str(prop.id),
        kind="property_condition",
        method="document_review",
        status="pending",
        submitted_by=landlord,
    )
    # The existing condition suite covers prerequisites and required photos.
    # Here the subject is otherwise complete, so isolate the optional snapshot.
    monkeypatch.setattr(condition, "assert_may_review", lambda **kwargs: None)
    monkeypatch.setattr(condition, "assert_property_is_ready", lambda subject: None)
    monkeypatch.setattr(condition, "_missing_required", lambda *args: [])
    submitted = condition.submit_for_review(subject=prop, actor=landlord)
    assert submitted.pk == review.pk
    assert submitted.provider_response["walkthrough_file_id"] == str(file.id)
    with pytest.raises(Conflict):
        set_video(subject=prop, user=landlord, file_id=None)
    assert ReviewerVerificationSerializer(submitted).data["subject_context"]["video"]["id"] == str(
        file.id
    )
