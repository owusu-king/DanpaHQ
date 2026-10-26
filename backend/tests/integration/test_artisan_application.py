"""Becoming an artisan: applying, the decision, switching in, and suspension.

What is pinned here is that the artisan experience is *earned*: applying moves
nobody, asking for the workspace early is refused, and suspension stops new
work at once while leaving everything already recorded where it was.
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.artisan import services as artisan_services
from apps.artisan.models import ArtisanCertificate, ArtisanProfile, CertificateStatus
from apps.core.exceptions import PermissionDenied
from apps.files.models import FilePurpose, ScanStatus, StoredFile, UploadStatus
from apps.notifications.models import Notification
from apps.operations.models import ManagementRole
from apps.outbox.tasks import dispatch_pending
from apps.trust.models import (
    SubjectType,
    Verification,
    VerificationKind,
    VerificationMethod,
    VerificationStatus,
)

from .test_management_portal import management_user, signed_in_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def district(db):
    from apps.geo.models import District, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    found, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    return found


def _file(owner, purpose, *, ready=True):
    return StoredFile.objects.create(
        storage_key=f"{purpose}/2026/10/{owner.id}/{StoredFile.objects.count()}.bin",
        bucket="test",
        storage_backend="local",
        original_filename="upload.jpg",
        declared_content_type="image/jpeg",
        content_type="image/jpeg",
        size_bytes=2048,
        checksum_sha256="c" * 64,
        purpose=purpose,
        upload_status=UploadStatus.READY if ready else UploadStatus.UPLOADED,
        scan_status=ScanStatus.CLEAN if ready else ScanStatus.PENDING,
        uploaded_by=owner,
        owner_id_snapshot=str(owner.id),
    )


def _client(sign_in_as, person):
    api = APIClient()
    sign_in_as(api, user=person)
    return api


def _application(person, district, **overrides):
    body = {
        "trades": ["plumbing", "tiling"],
        "district_ids": [str(district.id)],
        "bio": "Twelve years fixing pipes and laying tiles around Accra.",
        "portfolio_file_ids": [str(_file(person, FilePurpose.ARTISAN_WORK_PHOTO).id)],
        "identity_documents": [
            {
                "file_id": str(_file(person, FilePurpose.IDENTITY_DOCUMENT).id),
                "evidence_type": "ghana_card_front",
            }
        ],
    }
    body.update(overrides)
    return body


def _apply(api, person, district, **overrides):
    return api.post(
        "/api/v1/me/artisan/", _application(person, district, **overrides), format="json"
    )


def _capabilities(api):
    return api.get("/api/v1/me/").data["capabilities"]


def _queue_item(management):
    queue = management.get("/api/v1/management/verifications/")
    assert queue.status_code == 200, queue.data
    return next(row for row in queue.data["items"] if row["verification"]["kind"] == "artisan")


def _decide(management, *, approved, note=""):
    item = _queue_item(management)
    return management.post(
        f"/api/v1/management/verifications/{item['verification']['id']}/decision/",
        {"approved": approved, "note": note},
        format="json",
    )


def _approved_artisan(sign_in_as, person, district):
    api = _client(sign_in_as, person)
    assert _apply(api, person, district).status_code == 201
    management = signed_in_client(management_user())
    assert _decide(management, approved=True).status_code == 200
    return api, management


class TestApplying:
    def test_applying_records_a_pending_review_and_moves_nobody(self, sign_in_as, user, district):
        api = _client(sign_in_as, user)
        before = _capabilities(api)

        response = _apply(api, user, district)

        assert response.status_code == 201, response.data
        assert response.data["status"] == "pending"
        assert [trade["value"] for trade in response.data["profile"]["trades"]] == [
            "plumbing",
            "tiling",
        ]
        assert response.data["profile"]["districts"][0]["name"] == "Accra Metropolitan"
        assert response.data["profile"]["portfolio"][0]["url"]

        after = _capabilities(api)
        assert after["artisan"] == {
            "status": "pending",
            "workspace_access": False,
            "can_quote": False,
        }
        # Never auto-switched, and nothing else about the account moved.
        assert after["active_workspace"] == before["active_workspace"]
        assert after["available_workspaces"] == before["available_workspaces"]
        assert "artisan" not in after["available_workspaces"]

    def test_a_second_application_waits_for_the_first(self, sign_in_as, user, district):
        api = _client(sign_in_as, user)
        assert _apply(api, user, district).status_code == 201

        again = _apply(api, user, district)

        assert again.status_code == 409

    def test_an_id_is_required_unless_danpa_hq_already_holds_one(self, sign_in_as, user, district):
        api = _client(sign_in_as, user)
        refused = _apply(api, user, district, identity_documents=[])
        assert refused.status_code == 422
        assert "Ghana Card" in str(refused.data)

        Verification.objects.create(
            subject_type=SubjectType.USER,
            subject_id=str(user.id),
            kind=VerificationKind.IDENTITY,
            method=VerificationMethod.DOCUMENT_REVIEW,
            status=VerificationStatus.APPROVED,
            decided_at=timezone.now(),
            expires_at=timezone.now() + timedelta(days=300),
        )
        accepted = _apply(api, user, district, identity_documents=[])
        assert accepted.status_code == 201, accepted.data
        assert accepted.data["identity_on_file"] is True

    def test_a_selfie_alone_does_not_say_who_somebody_is(self, sign_in_as, user, district):
        api = _client(sign_in_as, user)
        selfie = _file(user, FilePurpose.IDENTITY_DOCUMENT)

        response = _apply(
            api,
            user,
            district,
            identity_documents=[{"file_id": str(selfie.id), "evidence_type": "selfie"}],
        )

        assert response.status_code == 422

    def test_somebody_elses_photo_cannot_be_entered_as_your_work(
        self, sign_in_as, user, landlord, district
    ):
        api = _client(sign_in_as, user)
        theirs = _file(landlord, FilePurpose.ARTISAN_WORK_PHOTO)

        response = _apply(api, user, district, portfolio_file_ids=[str(theirs.id)])

        assert response.status_code == 404
        assert not Verification.objects.filter(kind=VerificationKind.ARTISAN).exists()

    def test_a_work_photo_must_be_a_work_photo(self, sign_in_as, user, district):
        api = _client(sign_in_as, user)
        wrong = _file(user, FilePurpose.MAINTENANCE_PHOTO)

        response = _apply(api, user, district, portfolio_file_ids=[str(wrong.id)])

        assert response.status_code == 422

    def test_certificates_are_optional_and_an_expired_one_is_refused(
        self, sign_in_as, user, district
    ):
        api = _client(sign_in_as, user)
        expired = _apply(
            api,
            user,
            district,
            certificates=[
                {
                    "file_id": str(_file(user, FilePurpose.ARTISAN_CERTIFICATE).id),
                    "trade": "electrical",
                    "issuing_body": "Energy Commission",
                    "expires_on": (timezone.localdate() - timedelta(days=1)).isoformat(),
                }
            ],
        )
        assert expired.status_code == 422

        current = _apply(
            api,
            user,
            district,
            certificates=[
                {
                    "file_id": str(_file(user, FilePurpose.ARTISAN_CERTIFICATE).id),
                    "trade": "electrical",
                    "issuing_body": "Energy Commission",
                    "expires_on": (timezone.localdate() + timedelta(days=200)).isoformat(),
                }
            ],
        )
        assert current.status_code == 201, current.data
        assert current.data["profile"]["certificates"][0]["status"] == "provided"

    def test_a_certificate_loses_its_badge_the_day_it_expires(self, sign_in_as, user, district):
        api = _client(sign_in_as, user)
        file = _file(user, FilePurpose.ARTISAN_CERTIFICATE)
        _apply(
            api,
            user,
            district,
            certificates=[
                {
                    "file_id": str(file.id),
                    "trade": "electrical",
                    "issuing_body": "Energy Commission",
                    "expires_on": (timezone.localdate() + timedelta(days=30)).isoformat(),
                }
            ],
        )
        certificate = ArtisanCertificate.objects.get()
        certificate.verified_at = timezone.now()
        certificate.save()
        assert certificate.status == CertificateStatus.VERIFIED

        certificate.expires_on = timezone.localdate() - timedelta(days=1)
        certificate.save()
        assert certificate.status == CertificateStatus.EXPIRED

    def test_an_unconfirmed_phone_cannot_apply(self, user, district):
        # Over HTTP the session layer refuses such an account first; the service
        # refuses on its own too, for any caller that is not a request.
        user.is_phone_verified = False

        with pytest.raises(PermissionDenied):
            artisan_services.apply(
                user=user,
                trades=["plumbing"],
                district_ids=[district.id],
                portfolio_file_ids=[_file(user, FilePurpose.ARTISAN_WORK_PHOTO).id],
            )


class TestTheWorkspaceIsEarned:
    def test_asking_for_the_artisan_workspace_before_approval_is_refused(
        self, sign_in_as, user, district
    ):
        api = _client(sign_in_as, user)
        _apply(api, user, district)

        response = api.post("/api/v1/me/workspace/", {"workspace": "artisan"}, format="json")

        assert response.status_code == 403
        assert response.data["error"]["code"] == "NOT_AN_ARTISAN"
        assert _capabilities(api)["active_workspace"] != "artisan"

    def test_onboarding_cannot_declare_somebody_an_artisan(self, sign_in_as, user):
        api = _client(sign_in_as, user)

        response = api.post(
            "/api/v1/me/onboarding/intent/", {"intent": "artisan_work"}, format="json"
        )

        assert response.status_code == 422
        assert _capabilities(api)["active_workspace"] != "artisan"

    def test_approval_opens_the_workspace_without_switching_into_it(
        self, sign_in_as, user, district
    ):
        api, _ = _approved_artisan(sign_in_as, user, district)
        dispatch_pending()

        capabilities = _capabilities(api)
        assert capabilities["artisan"] == {
            "status": "approved",
            "workspace_access": True,
            "can_quote": True,
        }
        assert "artisan" in capabilities["available_workspaces"]
        assert capabilities["active_workspace"] == "tenant"
        assert Notification.objects.filter(user=user, kind="artisan.approved").exists()

    def test_approval_records_the_identity_it_checked(self, sign_in_as, user, district):
        _approved_artisan(sign_in_as, user, district)

        identity = Verification.objects.get(
            subject_type=SubjectType.USER,
            subject_id=str(user.id),
            kind=VerificationKind.IDENTITY,
        )
        assert identity.status == VerificationStatus.APPROVED
        # Only the ID travels across; photographs of their work prove nothing
        # about who took them.
        assert set(identity.evidence.values_list("evidence_type", flat=True)) == {
            "ghana_card_front"
        }

    def test_switching_in_and_back_out_leaves_the_tenant_side_alone(
        self, sign_in_as, user, district
    ):
        api, _ = _approved_artisan(sign_in_as, user, district)

        entered = api.post("/api/v1/me/workspace/", {"workspace": "artisan"}, format="json")
        assert entered.status_code == 200, entered.data
        assert entered.data["capabilities"]["active_workspace"] == "artisan"
        assert entered.data["entry_routes"]["mobile"] == "/(app)/(artisan-tabs)"
        assert entered.data["capabilities"]["tenant"]["workspace_access"] is True

        back = api.post("/api/v1/me/workspace/", {"workspace": "tenant"}, format="json")
        assert back.status_code == 200
        assert back.data["capabilities"]["active_workspace"] == "tenant"
        assert back.data["capabilities"]["artisan"]["status"] == "approved"

    def test_the_reviewer_reads_the_trades_and_area_beside_the_evidence(
        self, sign_in_as, user, district
    ):
        api = _client(sign_in_as, user)
        _apply(api, user, district)

        item = _queue_item(signed_in_client(management_user()))

        context = item["verification"]["subject_context"]
        assert context["trades"] == "Plumbing, Tiling"
        assert context["districts"] == "Accra Metropolitan"
        assert {row["evidence_type"] for row in item["verification"]["evidence"]} == {
            "ghana_card_front",
            "artisan_work_photo",
        }


class TestTheDecision:
    def test_a_rejection_says_why_and_the_person_may_apply_again(self, sign_in_as, user, district):
        api = _client(sign_in_as, user)
        _apply(api, user, district)
        management = signed_in_client(management_user())

        decided = _decide(management, approved=False, note="The ID photo is too blurred to read.")
        assert decided.status_code == 200
        dispatch_pending()

        mine = api.get("/api/v1/me/artisan/").data
        assert mine["status"] == "rejected"
        assert mine["decision_note"] == "The ID photo is too blurred to read."
        assert "artisan" not in _capabilities(api)["available_workspaces"]
        assert Notification.objects.filter(user=user, kind="artisan.rejected").exists()

        again = _apply(api, user, district)
        assert again.status_code == 201
        assert again.data["status"] == "pending"

    def test_answering_more_information_returns_the_same_review_to_the_queue(
        self, sign_in_as, user, district
    ):
        api = _client(sign_in_as, user)
        _apply(api, user, district)
        management = signed_in_client(management_user())
        item = _queue_item(management)
        asked = management.post(
            f"/api/v1/management/verifications/{item['verification']['id']}/more-info/",
            {"note": "Add a photo of a finished job."},
            format="json",
        )
        assert asked.status_code == 200, asked.data
        assert api.get("/api/v1/me/artisan/").data["status"] == "needs_more_info"

        answered = _apply(api, user, district)

        assert answered.status_code == 201, answered.data
        assert answered.data["status"] == "pending"
        assert (
            Verification.objects.filter(
                kind=VerificationKind.ARTISAN, subject_id=str(user.id)
            ).count()
            == 1
        )


class TestSuspension:
    def _suspend(self, management, person, **body):
        return management.post(
            f"/api/v1/management/artisans/{person.id}/suspension/",
            {"suspended": True, "reason": "Two reports of unfinished work.", **body},
            format="json",
        )

    def test_suspension_stops_new_work_and_keeps_the_record(self, sign_in_as, user, district):
        api, management = _approved_artisan(sign_in_as, user, district)
        api.post("/api/v1/me/workspace/", {"workspace": "artisan"}, format="json")

        response = self._suspend(management, user)

        assert response.status_code == 200, response.data
        assert response.data["status"] == "suspended"
        capabilities = _capabilities(api)
        assert capabilities["artisan"] == {
            "status": "suspended",
            "workspace_access": True,
            "can_quote": False,
        }
        # Still in their experience, reading their own records.
        assert capabilities["active_workspace"] == "artisan"
        mine = api.get("/api/v1/me/artisan/").data
        assert mine["suspended_reason"] == "Two reports of unfinished work."
        assert mine["profile"]["portfolio"]
        with pytest.raises(PermissionDenied):
            artisan_services.require_working_artisan(user)

        dispatch_pending()
        assert Notification.objects.filter(user=user, kind="artisan.suspended").exists()

    def test_reinstating_restores_new_work(self, sign_in_as, user, district):
        api, management = _approved_artisan(sign_in_as, user, district)
        self._suspend(management, user)

        response = management.post(
            f"/api/v1/management/artisans/{user.id}/suspension/",
            {"suspended": False},
            format="json",
        )

        assert response.status_code == 200, response.data
        assert _capabilities(api)["artisan"]["can_quote"] is True
        assert artisan_services.require_working_artisan(user) == ArtisanProfile.objects.get(
            user=user
        )

    def test_a_suspension_needs_a_reason(self, sign_in_as, user, district):
        _, management = _approved_artisan(sign_in_as, user, district)

        response = self._suspend(management, user, reason="")

        assert response.status_code in (400, 422)
        assert not ArtisanProfile.objects.get(user=user).is_suspended

    def test_only_an_approved_artisan_can_be_suspended(self, sign_in_as, user, district):
        api = _client(sign_in_as, user)
        _apply(api, user, district)

        response = self._suspend(signed_in_client(management_user()), user)

        assert response.status_code == 409

    def test_support_admins_and_consumers_cannot_suspend(
        self, sign_in_as, user, landlord, district
    ):
        _approved_artisan(sign_in_as, user, district)
        support = signed_in_client(
            management_user(role=ManagementRole.SUPPORT_ADMIN, email="support@example.com")
        )
        consumer = _client(sign_in_as, landlord)

        assert self._suspend(support, user).status_code == 403
        assert self._suspend(consumer, user).status_code in (401, 403)
        assert not ArtisanProfile.objects.get(user=user).is_suspended

    def test_management_lists_artisans_by_status(self, sign_in_as, user, district):
        _, management = _approved_artisan(sign_in_as, user, district)
        self._suspend(management, user)

        suspended = management.get("/api/v1/management/artisans/?status=suspended")
        pending = management.get("/api/v1/management/artisans/?status=pending")

        assert suspended.status_code == 200
        assert [row["user_id"] for row in suspended.data] == [str(user.id)]
        assert suspended.data[0]["trades"] == ["Plumbing", "Tiling"]
        assert pending.data == []


def test_an_unapproved_person_cannot_start_new_work(user):
    with pytest.raises(PermissionDenied):
        artisan_services.require_working_artisan(user)
