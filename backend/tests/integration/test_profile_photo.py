"""An optional profile photo, and whose file may become one.

`Profile.avatar` was a column with no way to set it. Wiring it up is mostly
plumbing; the part worth testing is that a file id is not a capability. Without
an ownership check, handing over somebody else's upload id would have the product
serve their identity document back as a picture.
"""

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


def _upload(user, *, purpose="avatar", usable=True, content_type="image/jpeg"):
    """A stored file in the state a real one reaches after scanning."""
    from apps.files.models import ScanStatus, StoredFile, UploadStatus

    return StoredFile.objects.create(
        uploaded_by=user,
        owner_id_snapshot=str(user.id),
        purpose=purpose,
        original_filename="face.jpg",
        declared_content_type=content_type,
        content_type=content_type,
        size_bytes=120_000,
        storage_key=f"avatars/{user.id}/face.jpg",
        upload_status=UploadStatus.READY if usable else UploadStatus.UPLOADED,
        scan_status=ScanStatus.CLEAN if usable else ScanStatus.PENDING,
    )


class TestSettingAPhoto:
    def test_a_photo_can_be_attached_and_read_back(self, api, sign_in_as, user):
        stored = _upload(user)
        sign_in_as(api, user=user)

        response = api.patch(
            "/api/v1/me/profile/", {"avatar_file_id": str(stored.id)}, format="json"
        )

        assert response.status_code == 200, response.data
        assert response.data["avatar_url"] == f"/api/v1/files/{stored.id}/download/"

    def test_the_photo_shows_up_on_the_signed_in_user(self, api, sign_in_as, user):
        stored = _upload(user)
        sign_in_as(api, user=user)
        api.patch("/api/v1/me/profile/", {"avatar_file_id": str(stored.id)}, format="json")

        me = api.get("/api/v1/me/")

        assert me.data["profile"]["avatar_url"] == f"/api/v1/files/{stored.id}/download/"

    def test_a_profile_without_one_says_so_rather_than_guessing(self, api, sign_in_as, user):
        sign_in_as(api, user=user)

        response = api.get("/api/v1/me/profile/")

        assert response.status_code == 200
        assert response.data["avatar_url"] is None

    def test_it_counts_towards_a_complete_profile(self, api, sign_in_as, user):
        stored = _upload(user)
        sign_in_as(api, user=user)

        before = api.get("/api/v1/me/profile/").data["completeness"]
        after = api.patch(
            "/api/v1/me/profile/", {"avatar_file_id": str(stored.id)}, format="json"
        ).data["completeness"]

        assert after > before

    def test_removing_it_is_explicit(self, api, sign_in_as, user):
        stored = _upload(user)
        sign_in_as(api, user=user)
        api.patch("/api/v1/me/profile/", {"avatar_file_id": str(stored.id)}, format="json")

        response = api.patch("/api/v1/me/profile/", {"avatar_file_id": None}, format="json")

        assert response.status_code == 200
        assert response.data["avatar_url"] is None

    def test_editing_something_else_leaves_the_photo_alone(self, api, sign_in_as, user):
        """A PATCH that does not mention the avatar must not clear it."""
        stored = _upload(user)
        sign_in_as(api, user=user)
        api.patch("/api/v1/me/profile/", {"avatar_file_id": str(stored.id)}, format="json")

        response = api.patch("/api/v1/me/profile/", {"bio": "I rent in Adenta."}, format="json")

        assert response.data["avatar_url"] == f"/api/v1/files/{stored.id}/download/"


class TestAFileIdIsNotACapability:
    """The part that matters."""

    def test_another_persons_upload_cannot_become_my_photo(self, api, sign_in_as, user, registered):
        stranger = registered("0209680001")
        theirs = _upload(stranger)
        sign_in_as(api, user=user)

        response = api.patch(
            "/api/v1/me/profile/", {"avatar_file_id": str(theirs.id)}, format="json"
        )

        assert response.status_code == 422
        assert api.get("/api/v1/me/profile/").data["avatar_url"] is None

    def test_a_document_uploaded_for_verification_cannot_be_promoted(self, api, sign_in_as, user):
        """An identity document has a different audience and different retention."""
        document = _upload(user, purpose="identity_document")
        sign_in_as(api, user=user)

        response = api.patch(
            "/api/v1/me/profile/", {"avatar_file_id": str(document.id)}, format="json"
        )

        assert response.status_code == 422

    def test_an_unscanned_upload_is_not_served_yet(self, api, sign_in_as, user):
        pending = _upload(user, usable=False)
        sign_in_as(api, user=user)

        response = api.patch(
            "/api/v1/me/profile/", {"avatar_file_id": str(pending.id)}, format="json"
        )

        assert response.status_code == 422

    def test_an_unknown_id_is_refused(self, api, sign_in_as, user):
        sign_in_as(api, user=user)

        response = api.patch(
            "/api/v1/me/profile/",
            {"avatar_file_id": "01a00000-0000-7000-8000-000000000000"},
            format="json",
        )

        assert response.status_code == 422

    def test_a_photo_that_stops_being_servable_stops_being_linked(self, api, sign_in_as, user):
        """A link that 404s is worse than none: the client just retries it."""
        from apps.files.models import ScanStatus, StoredFile

        stored = _upload(user)
        sign_in_as(api, user=user)
        api.patch("/api/v1/me/profile/", {"avatar_file_id": str(stored.id)}, format="json")

        StoredFile.objects.filter(id=stored.id).update(scan_status=ScanStatus.INFECTED)

        assert api.get("/api/v1/me/profile/").data["avatar_url"] is None


class TestTheUploadItself:
    def test_an_avatar_upload_can_be_reserved(self, api, sign_in_as, user):
        """Reuses the existing reserve-then-complete flow, not a second path."""
        sign_in_as(api, user=user)

        response = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "face.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 120_000,
            },
            format="json",
        )

        assert response.status_code == 201, response.data
        assert response.data["file_id"]
        # The upload URL is rehosted to something the caller can actually reach;
        # a loopback address is the host machine, which is useless to a phone.
        assert response.data["url"]

    def test_an_oversized_photo_is_refused_before_upload(self, api, sign_in_as, user):
        sign_in_as(api, user=user)

        response = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "huge.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 40 * 1024 * 1024,
            },
            format="json",
        )

        assert response.status_code == 422

    def test_a_pdf_is_not_a_profile_photo(self, api, sign_in_as, user):
        sign_in_as(api, user=user)

        response = api.post(
            "/api/v1/files/uploads/",
            {
                "purpose": "avatar",
                "filename": "cv.pdf",
                "content_type": "application/pdf",
                "size_bytes": 50_000,
            },
            format="json",
        )

        assert response.status_code == 422
