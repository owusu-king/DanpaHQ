# ruff: noqa: F811 — the fixtures imported below are taken by name as arguments.
"""Finishing artisan work: done, confirmed, paid, reviewed, and Report a problem.

Pinned here: only the assigned artisan reports work done, with photos; on a
repair the tenant still confirms, through maintenance's own flow, and on a
direct job the person who posted it does; payment is recorded only once work
is confirmed, by the payer, mirrored into the property's books on a repair and
never moving money; one review per job, by the payer, with no score; and a
report keeps its evidence and a snapshot of the job as it stood.
"""

import pytest
from rest_framework.test import APIClient

from apps.artisan.models import ArtisanReview, DirectJobStatus, Quote, WorkReport
from apps.files.models import FilePurpose
from apps.maintenance.models import MaintenanceStatus
from apps.notifications.models import Notification
from apps.operations.models import ManagementReport
from apps.outbox.tasks import dispatch_pending
from apps.rent.models import ExpenseCategory, PropertyExpense

from .test_artisan_direct_jobs import _approved as _approved_job
from .test_artisan_direct_jobs import _job, carpenter, locality, rival  # noqa: F401 — fixtures
from .test_artisan_quotes import _approved as _approved_repair
from .test_artisan_quotes import district, plumber, repair  # noqa: F401 — fixtures
from .test_maintenance import _file, address, tenancy, unit  # noqa: F401 — fixtures

pytestmark = pytest.mark.django_db


def _client(sign_in_as, person):
    api = APIClient()
    sign_in_as(api, user=person)
    return api


def _done(
    api, invitation_id, person, *, photos=1, receipts=0, note="Fitted and fixed to the wall."
):
    return api.post(
        f"/api/v1/me/artisan/invitations/{invitation_id}/work-reports/",
        {
            "note": note,
            "photo_file_ids": [
                str(_file(person, FilePurpose.ARTISAN_WORK_DONE_PHOTO).id) for _ in range(photos)
            ],
            "receipt_file_ids": [
                str(_file(person, FilePurpose.ARTISAN_RECEIPT).id) for _ in range(receipts)
            ],
        },
        format="json",
    )


# --- a direct job ---------------------------------------------------------------------


class TestDirectJobFinish:
    def test_the_artisan_reports_it_done_and_the_owner_confirms(
        self,
        sign_in_as,
        user,
        locality,
        carpenter,
    ):
        job = _job(sign_in_as, user, locality)
        owner_api, artisan_api, invitation = _approved_job(sign_in_as, user, job, carpenter)

        done = _done(artisan_api, invitation.id, carpenter.user, receipts=1)

        assert done.status_code == 201, done.data
        assert done.data["work"]["reports"][0]["photos"][0]["url"]
        assert done.data["work"]["reports"][0]["receipts"][0]["name"]
        job.refresh_from_db()
        assert job.status == DirectJobStatus.DONE_REPORTED
        dispatch_pending()
        assert Notification.objects.filter(user=user, kind="artisan.work_reported").exists()

        view = owner_api.get(f"/api/v1/me/direct-jobs/{job.id}/").data
        assert view["permissions"]["confirm"] is True
        assert view["permissions"]["cancel"] is False
        confirmed = owner_api.post(f"/api/v1/me/direct-jobs/{job.id}/confirm/", {}, format="json")

        assert confirmed.status_code == 200, confirmed.data
        assert confirmed.data["job"]["status"] == DirectJobStatus.COMPLETED
        assert confirmed.data["work"]["finished"] is True
        assert confirmed.data["work"]["may_record_paid"] is True
        assert confirmed.data["work"]["may_review"] is True
        dispatch_pending()
        assert Notification.objects.filter(
            user=carpenter.user, kind="artisan.work_confirmed"
        ).exists()

    def test_a_photo_is_needed_and_only_the_assigned_artisan_reports(
        self,
        sign_in_as,
        user,
        locality,
        carpenter,
        rival,
    ):
        job = _job(sign_in_as, user, locality)
        _, artisan_api, invitation = _approved_job(sign_in_as, user, job, carpenter)

        assert _done(artisan_api, invitation.id, carpenter.user, photos=0).status_code == 422
        stranger = _client(sign_in_as, rival.user)
        assert _done(stranger, invitation.id, rival.user).status_code == 404
        job.refresh_from_db()
        assert job.status == DirectJobStatus.ASSIGNED

    def test_reopening_sends_it_back_and_keeps_the_first_report(
        self,
        sign_in_as,
        user,
        locality,
        carpenter,
    ):
        job = _job(sign_in_as, user, locality)
        owner_api, artisan_api, invitation = _approved_job(sign_in_as, user, job, carpenter)
        assert _done(artisan_api, invitation.id, carpenter.user).status_code == 201

        reopened = owner_api.post(
            f"/api/v1/me/direct-jobs/{job.id}/reopen/",
            {"reason": "The left door does not close."},
            format="json",
        )

        assert reopened.status_code == 200, reopened.data
        assert reopened.data["job"]["status"] == DirectJobStatus.ASSIGNED
        assert reopened.data["work"]["reports"][0]["reopen_reason"].startswith("The left door")
        again = _done(artisan_api, invitation.id, carpenter.user, note="Door hinge adjusted.")
        assert again.status_code == 201, again.data
        assert WorkReport.objects.filter(invitation=invitation).count() == 2
        dispatch_pending()
        assert Notification.objects.filter(
            user=carpenter.user, kind="artisan.work_reopened"
        ).exists()

    def test_finished_work_cannot_be_cancelled(self, sign_in_as, user, locality, carpenter):
        job = _job(sign_in_as, user, locality)
        owner_api, artisan_api, invitation = _approved_job(sign_in_as, user, job, carpenter)
        _done(artisan_api, invitation.id, carpenter.user)

        response = owner_api.post(f"/api/v1/me/direct-jobs/{job.id}/cancel/", {}, format="json")

        assert response.status_code == 409

    def test_paid_is_recorded_only_after_confirmation_and_moves_nothing(
        self,
        sign_in_as,
        user,
        locality,
        carpenter,
    ):
        job = _job(sign_in_as, user, locality)
        owner_api, artisan_api, invitation = _approved_job(sign_in_as, user, job, carpenter)
        early = owner_api.post(f"/api/v1/artisan-jobs/{invitation.id}/paid/", {}, format="json")
        assert early.status_code == 409
        _done(artisan_api, invitation.id, carpenter.user)
        owner_api.post(f"/api/v1/me/direct-jobs/{job.id}/confirm/", {}, format="json")
        expenses = PropertyExpense.objects.count()

        paid = owner_api.post(f"/api/v1/artisan-jobs/{invitation.id}/paid/", {}, format="json")

        assert paid.status_code == 200, paid.data
        assert paid.data["work"]["paid_at"]
        assert paid.data["work"]["may_record_paid"] is False
        # A direct job has no property, so there are no books to mirror into.
        assert PropertyExpense.objects.count() == expenses
        assert (
            owner_api.post(f"/api/v1/artisan-jobs/{invitation.id}/paid/", {}, format="json")
        ).status_code == 409
        dispatch_pending()
        assert Notification.objects.filter(
            user=carpenter.user, kind="artisan.paid_recorded"
        ).exists()


# --- a repair ------------------------------------------------------------------------


class TestRepairFinish:
    def test_the_tenant_still_confirms_a_repair_the_artisan_reported_done(
        self,
        sign_in_as,
        landlord,
        user,
        repair,
        plumber,
    ):
        _, artisan_api, invitation = _approved_repair(sign_in_as, landlord, repair, plumber)

        done = _done(artisan_api, invitation.id, plumber.user, receipts=1)

        assert done.status_code == 201, done.data
        repair.refresh_from_db()
        assert repair.status == MaintenanceStatus.AWAITING_TENANT_CONFIRMATION
        dispatch_pending()
        asked = Notification.objects.get(user=user, kind="maintenance.awaiting_confirmation")
        assert plumber.user.display_name in asked.body
        tenant_api = _client(sign_in_as, user)
        detail = tenant_api.get(f"/api/v1/maintenance/{repair.id}/").data
        work = detail["artisans"]["work"]
        assert work["reports"][0]["photos"]
        # Receipts are the money's side; the tenant reads what was done.
        assert work["reports"][0]["receipts"] == []
        assert work["may_record_paid"] is False

        confirmed = tenant_api.post(f"/api/v1/maintenance/{repair.id}/confirm/", {}, format="json")

        assert confirmed.status_code == 200, confirmed.data
        dispatch_pending()
        assert Notification.objects.filter(
            user=plumber.user, kind="artisan.work_confirmed"
        ).exists()

    def test_paid_is_mirrored_into_the_property_books_by_the_payer_only(
        self,
        sign_in_as,
        landlord,
        user,
        repair,
        plumber,
    ):
        from apps.organization.services import ensure_personal_organization_for_property

        # Real properties are held by an organization; the fixture builds a bare one.
        ensure_personal_organization_for_property(owner=landlord, prop=repair.property)
        landlord_api, artisan_api, invitation = _approved_repair(
            sign_in_as, landlord, repair, plumber
        )
        _done(artisan_api, invitation.id, plumber.user)
        _client(sign_in_as, user).post(
            f"/api/v1/maintenance/{repair.id}/confirm/", {}, format="json"
        )

        tenant_try = _client(sign_in_as, user).post(
            f"/api/v1/artisan-jobs/{invitation.id}/paid/", {}, format="json"
        )
        assert tenant_try.status_code in (403, 404)

        paid = landlord_api.post(f"/api/v1/artisan-jobs/{invitation.id}/paid/", {}, format="json")

        assert paid.status_code == 200, paid.data
        repair.refresh_from_db()
        quote = Quote.objects.get(id=repair.assigned_quote_id)
        assert quote.paid_at is not None
        expense = PropertyExpense.objects.get(id=quote.expense_id)
        assert expense.category == ExpenseCategory.MAINTENANCE
        assert expense.amount_minor == quote.price_minor
        assert plumber.user.display_name in expense.note


# --- reviews -------------------------------------------------------------------------


class TestReviews:
    def test_one_review_by_the_payer_once_confirmed_and_it_shows_on_the_profile(
        self,
        sign_in_as,
        user,
        locality,
        carpenter,
    ):
        job = _job(sign_in_as, user, locality)
        owner_api, artisan_api, invitation = _approved_job(sign_in_as, user, job, carpenter)
        body = {
            "text": "Tidy, on time, and fixed it to the wall properly.",
            "would_hire_again": True,
        }
        early = owner_api.post(f"/api/v1/artisan-jobs/{invitation.id}/review/", body, format="json")
        assert early.status_code == 409
        _done(artisan_api, invitation.id, carpenter.user)
        owner_api.post(f"/api/v1/me/direct-jobs/{job.id}/confirm/", {}, format="json")

        written = owner_api.post(
            f"/api/v1/artisan-jobs/{invitation.id}/review/", body, format="json"
        )

        assert written.status_code == 201, written.data
        assert written.data["work"]["review"]["would_hire_again"] is True
        again = owner_api.post(f"/api/v1/artisan-jobs/{invitation.id}/review/", body, format="json")
        assert again.status_code == 409
        assert ArtisanReview.objects.filter(artisan=carpenter).count() == 1

        profile = _client(sign_in_as, user).get(f"/api/v1/artisans/{carpenter.id}/").data
        assert profile["jobs_completed"] == 1
        assert profile["reviews_count"] == 1
        assert profile["reviews"][0]["text"].startswith("Tidy")
        assert "rating" not in str(profile) and "score" not in str(profile)
        dispatch_pending()
        assert Notification.objects.filter(user=carpenter.user, kind="artisan.reviewed").exists()

    def test_the_tenant_on_a_repair_does_not_review(
        self,
        sign_in_as,
        landlord,
        user,
        repair,
        plumber,
    ):
        _, artisan_api, invitation = _approved_repair(sign_in_as, landlord, repair, plumber)
        _done(artisan_api, invitation.id, plumber.user)
        tenant_api = _client(sign_in_as, user)
        tenant_api.post(f"/api/v1/maintenance/{repair.id}/confirm/", {}, format="json")

        response = tenant_api.post(
            f"/api/v1/artisan-jobs/{invitation.id}/review/",
            {"text": "Very good work all round.", "would_hire_again": True},
            format="json",
        )

        assert response.status_code in (403, 404)
        assert not ArtisanReview.objects.exists()


# --- Report a problem ----------------------------------------------------------------


class TestReports:
    def test_a_profile_report_reaches_management_with_its_evidence(
        self,
        sign_in_as,
        user,
        carpenter,
    ):
        evidence = _file(user, FilePurpose.REPORT_EVIDENCE)

        response = _client(sign_in_as, user).post(
            f"/api/v1/artisans/{carpenter.id}/reports/",
            {
                "category": "fake_profile",
                "summary": "These photos are from another company.",
                "file_ids": [str(evidence.id)],
            },
            format="json",
        )

        assert response.status_code == 201, response.data
        report = ManagementReport.objects.get(id=response.data["id"])
        assert report.subject_type == "artisan"
        assert report.subject_id == str(carpenter.id)
        assert report.evidence["files"] == [str(evidence.id)]

    def test_either_side_of_a_job_reports_with_a_snapshot_and_nobody_else_can(
        self,
        sign_in_as,
        user,
        landlord,
        locality,
        carpenter,
        rival,
    ):
        job = _job(sign_in_as, user, locality)
        _, artisan_api, invitation = _approved_job(sign_in_as, user, job, carpenter)
        _done(artisan_api, invitation.id, carpenter.user)
        body = {"category": "not_paid", "summary": "The customer has not paid the deposit."}

        from_artisan = artisan_api.post(
            f"/api/v1/artisan-jobs/{invitation.id}/reports/", body, format="json"
        )

        assert from_artisan.status_code == 201, from_artisan.data
        report = ManagementReport.objects.get(id=from_artisan.data["id"])
        assert report.subject_type == "artisan_job"
        assert report.evidence["reported_by_side"] == "artisan"
        snapshot = report.evidence["snapshot"]
        assert snapshot["quotes"][0]["price_minor"] == 60000
        assert len(snapshot["work_reports"][0]["photos"]) == 1
        # A customer's categories are about the artisan, not about themselves.
        customer = _client(sign_in_as, user).post(
            f"/api/v1/artisan-jobs/{invitation.id}/reports/", body, format="json"
        )
        assert customer.status_code == 422
        for stranger in (landlord, rival.user):
            response = _client(sign_in_as, stranger).post(
                f"/api/v1/artisan-jobs/{invitation.id}/reports/",
                {"category": "poor_work", "summary": "Not good at all."},
                format="json",
            )
            assert response.status_code == 404

    def test_somebody_else_s_file_is_not_evidence(self, sign_in_as, user, landlord, carpenter):
        response = _client(sign_in_as, user).post(
            f"/api/v1/artisans/{carpenter.id}/reports/",
            {
                "category": "conduct",
                "summary": "Shouted at my children.",
                "file_ids": [str(_file(landlord, FilePurpose.REPORT_EVIDENCE).id)],
            },
            format="json",
        )

        assert response.status_code == 404
        assert not ManagementReport.objects.filter(subject_type="artisan").exists()
