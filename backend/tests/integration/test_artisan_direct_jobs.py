"""Direct jobs: work a tenant or provider hires an artisan for themselves.

Pinned here: anybody signed in may post one, with no property or repair behind
it, and nothing is written to maintenance; only the person who posted it
invites, approves, declines or cancels; an invited artisan reads the job and
the area and nothing that finds the home or the person, and the address and the
customer's phone open only once their quote is approved; extra cost is a
revised quote the owner approves; suspension stops an approval.
"""

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.artisan.models import DirectJob, DirectJobStatus, Quote, QuoteInvitation, QuoteStatus
from apps.files.models import FilePurpose
from apps.maintenance.models import MaintenanceRequest
from apps.notifications.models import Notification
from apps.outbox.tasks import dispatch_pending

from .test_artisan_discover import _artisan
from .test_maintenance import _file

pytestmark = pytest.mark.django_db


@pytest.fixture
def locality(db):
    from apps.geo.models import District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    found, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return found


@pytest.fixture
def carpenter(registered, locality):
    return _artisan(
        registered, "0240000301", "Kwame", trades=["carpentry"], district=locality.district
    )


@pytest.fixture
def rival(registered, locality):
    return _artisan(
        registered, "0240000302", "Abena", trades=["carpentry"], district=locality.district
    )


def _client(sign_in_as, person):
    api = APIClient()
    sign_in_as(api, user=person)
    return api


def _post_job(api, owner, locality, **extra):
    body = {
        "trade": "carpentry",
        "title": "Assemble a wardrobe",
        "description": "A flat-pack wardrobe, two doors, needs assembling and fixing to the wall.",
        "locality_id": str(locality.id),
        "photo_file_id": str(_file(owner, FilePurpose.ARTISAN_JOB_PHOTO).id),
        "house_number": "7",
        "street": "Cantonments Road",
        "landmark": "Blue gate opposite the pharmacy",
        **extra,
    }
    return api.post("/api/v1/me/direct-jobs/", body, format="json")


def _job(sign_in_as, owner, locality):
    response = _post_job(_client(sign_in_as, owner), owner, locality)
    assert response.status_code == 201, response.data
    return DirectJob.objects.get(id=response.data["job"]["id"])


def _invite(api, job, artisan):
    return api.post(
        f"/api/v1/me/direct-jobs/{job.id}/invitations/",
        {"artisan_id": str(artisan.id)},
        format="json",
    )


def _quote(api, invitation_id, price_minor=60000):
    return api.post(
        f"/api/v1/me/artisan/invitations/{invitation_id}/quotes/",
        {"price_minor": price_minor, "scope": "Assemble the wardrobe and fix it to the wall."},
        format="json",
    )


def _invitation(job, artisan):
    return QuoteInvitation.objects.get(direct_job=job, artisan=artisan)


def _approved(sign_in_as, owner, job, artisan):
    owner_api = _client(sign_in_as, owner)
    assert _invite(owner_api, job, artisan).status_code == 201
    artisan_api = _client(sign_in_as, artisan.user)
    invitation = _invitation(job, artisan)
    quoted = _quote(artisan_api, invitation.id)
    assert quoted.status_code == 201, quoted.data
    approved = owner_api.post(
        f"/api/v1/artisan-quotes/{quoted.data['quotes'][0]['id']}/approve/", {}, format="json"
    )
    assert approved.status_code == 200, approved.data
    return owner_api, artisan_api, invitation


class TestPosting:
    def test_a_tenant_posts_a_job_with_no_property_and_nothing_reaches_maintenance(
        self, sign_in_as, user, locality
    ):
        before = MaintenanceRequest.objects.count()

        response = _post_job(_client(sign_in_as, user), user, locality)

        assert response.status_code == 201, response.data
        assert response.data["job"]["status"] == DirectJobStatus.OPEN
        assert response.data["job"]["area"]["locality"] == "Osu"
        assert response.data["job"]["photo"]["url"]
        assert response.data["permissions"]["invite"] is True
        assert MaintenanceRequest.objects.count() == before

    def test_posting_from_a_profile_asks_that_artisan_at_once(
        self, sign_in_as, user, locality, carpenter
    ):
        response = _post_job(
            _client(sign_in_as, user), user, locality, invite_artisan_id=str(carpenter.id)
        )

        assert response.status_code == 201, response.data
        assert [row["artisan"]["id"] for row in response.data["invitations"]] == [str(carpenter.id)]
        assert response.data["invitations"][0]["state"] == "invited"

    def test_a_job_posted_for_yourself_as_artisan_is_not_left_behind(
        self, sign_in_as, locality, carpenter
    ):
        before = DirectJob.objects.count()

        response = _post_job(
            _client(sign_in_as, carpenter.user),
            carpenter.user,
            locality,
            invite_artisan_id=str(carpenter.id),
        )

        assert response.status_code == 422
        assert DirectJob.objects.count() == before

    def test_a_provider_can_post_one_too(self, sign_in_as, landlord, locality):
        response = _post_job(_client(sign_in_as, landlord), landlord, locality)

        assert response.status_code == 201, response.data
        assert DirectJob.objects.get(id=response.data["job"]["id"]).owner == landlord

    def test_somebody_else_s_photo_cannot_be_attached(self, sign_in_as, user, landlord, locality):
        response = _post_job(
            _client(sign_in_as, user),
            user,
            locality,
            photo_file_id=str(_file(landlord, FilePurpose.ARTISAN_JOB_PHOTO).id),
        )

        assert response.status_code == 404

    def test_an_unknown_trade_is_refused(self, sign_in_as, user, locality):
        response = _post_job(_client(sign_in_as, user), user, locality, trade="astrology")

        assert response.status_code == 422

    def test_open_jobs_appear_under_requests_even_before_anybody_is_asked(
        self, sign_in_as, user, locality
    ):
        job = _job(sign_in_as, user, locality)

        overview = _client(sign_in_as, user).get("/api/v1/artisan-work/")

        assert overview.status_code == 200, overview.data
        rows = [row for row in overview.data["requests"] if row["request"]["id"] == str(job.id)]
        assert rows and rows[0]["request"]["kind"] == "direct_job"
        assert rows[0]["permissions"]["invite"] is True


class TestOwnership:
    def test_only_the_owner_reads_invites_or_cancels(
        self, sign_in_as, user, landlord, locality, carpenter
    ):
        job = _job(sign_in_as, user, locality)
        stranger = _client(sign_in_as, landlord)

        assert stranger.get(f"/api/v1/me/direct-jobs/{job.id}/").status_code == 404
        assert _invite(stranger, job, carpenter).status_code == 404
        cancel = stranger.post(f"/api/v1/me/direct-jobs/{job.id}/cancel/", {}, format="json")
        assert cancel.status_code == 404
        assert not QuoteInvitation.objects.filter(direct_job=job).exists()

    def test_only_the_owner_approves(self, sign_in_as, user, landlord, locality, carpenter):
        job = _job(sign_in_as, user, locality)
        assert _invite(_client(sign_in_as, user), job, carpenter).status_code == 201
        quoted = _quote(_client(sign_in_as, carpenter.user), _invitation(job, carpenter).id)
        quote_id = quoted.data["quotes"][0]["id"]

        for intruder in (landlord, carpenter.user):
            response = _client(sign_in_as, intruder).post(
                f"/api/v1/artisan-quotes/{quote_id}/approve/", {}, format="json"
            )
            assert response.status_code == 404
        job.refresh_from_db()
        assert job.assigned_artisan_id is None

    def test_at_most_three_artisans_are_asked_at_once(self, sign_in_as, user, registered, locality):
        job = _job(sign_in_as, user, locality)
        api = _client(sign_in_as, user)
        for index in range(3):
            artisan = _artisan(
                registered,
                f"024000040{index}",
                f"C{index}",
                trades=["carpentry"],
                district=locality.district,
            )
            assert _invite(api, job, artisan).status_code == 201
        fourth = _artisan(
            registered, "0240000409", "C9", trades=["carpentry"], district=locality.district
        )

        assert _invite(api, job, fourth).status_code == 409


class TestPrivacy:
    def test_an_invited_artisan_reads_the_job_and_the_area_and_nothing_that_finds_the_home(
        self, sign_in_as, user, locality, carpenter
    ):
        job = _job(sign_in_as, user, locality)
        assert _invite(_client(sign_in_as, user), job, carpenter).status_code == 201

        listed = _client(sign_in_as, carpenter.user).get("/api/v1/me/artisan/invitations/")

        assert listed.status_code == 200, listed.data
        view = listed.data[0]
        assert view["request"]["kind"] == "direct_job"
        assert view["request"]["title"] == "Assemble a wardrobe"
        assert view["request"]["area"]["locality"] == "Osu"
        assert view["request"]["photo"]["url"]
        assert view["unlocked"] is False and "job" not in view
        text = str(view)
        for secret in ("Cantonments", "Blue gate", user.display_name, "0201234567"):
            assert secret not in text

    def test_approval_unlocks_the_address_and_the_customer_s_phone(
        self, sign_in_as, user, locality, carpenter
    ):
        job = _job(sign_in_as, user, locality)
        _, artisan_api, invitation = _approved(sign_in_as, user, job, carpenter)

        view = artisan_api.get(f"/api/v1/me/artisan/invitations/{invitation.id}/").data

        assert view["state"] == "assigned" and view["unlocked"] is True
        assert "Cantonments Road" in view["job"]["address"]["line"]
        assert view["job"]["address"]["landmark"].startswith("Blue gate")
        assert view["job"]["contact"]["name"] == user.display_name
        assert view["job"]["contact"]["phone"]
        assert view["job"]["contact"]["role"] == "Customer"
        assert view["job"]["approved_by"] == user.display_name
        jobs = artisan_api.get("/api/v1/me/artisan/jobs/").data
        assert [row["id"] for row in jobs] == [str(invitation.id)]

    def test_a_rival_who_lost_never_sees_the_address(
        self, sign_in_as, user, locality, carpenter, rival
    ):
        job = _job(sign_in_as, user, locality)
        owner_api = _client(sign_in_as, user)
        assert _invite(owner_api, job, rival).status_code == 201
        rival_quote = _quote(_client(sign_in_as, rival.user), _invitation(job, rival).id)
        assert rival_quote.status_code == 201
        _approved(sign_in_as, user, job, carpenter)

        view = (
            _client(sign_in_as, rival.user)
            .get(f"/api/v1/me/artisan/invitations/{_invitation(job, rival).id}/")
            .data
        )

        assert view["state"] == "closed" and view["unlocked"] is False
        assert "Cantonments" not in str(view)
        assert Quote.objects.get(id=rival_quote.data["quotes"][0]["id"]).status == (
            QuoteStatus.DECLINED
        )


class TestAssignment:
    def test_approval_assigns_the_artisan_to_the_job(self, sign_in_as, user, locality, carpenter):
        job = _job(sign_in_as, user, locality)
        owner_api, _, _ = _approved(sign_in_as, user, job, carpenter)

        job.refresh_from_db()
        assert job.status == DirectJobStatus.ASSIGNED
        assert job.assigned_artisan == carpenter
        assert job.assigned_quote.price_minor == 60000
        overview = owner_api.get("/api/v1/artisan-work/").data
        assert [row["request"]["id"] for row in overview["records"]] == [str(job.id)]

    def test_a_suspended_artisan_cannot_be_approved(self, sign_in_as, user, locality, carpenter):
        job = _job(sign_in_as, user, locality)
        owner_api = _client(sign_in_as, user)
        assert _invite(owner_api, job, carpenter).status_code == 201
        quoted = _quote(_client(sign_in_as, carpenter.user), _invitation(job, carpenter).id)
        carpenter.suspended_at = timezone.now()
        carpenter.save(update_fields=["suspended_at"])

        response = owner_api.post(
            f"/api/v1/artisan-quotes/{quoted.data['quotes'][0]['id']}/approve/", {}, format="json"
        )

        assert response.status_code == 409
        job.refresh_from_db()
        assert job.assigned_artisan_id is None

    def test_a_revised_price_counts_only_once_the_owner_approves_it(
        self, sign_in_as, user, locality, carpenter
    ):
        job = _job(sign_in_as, user, locality)
        owner_api, artisan_api, _ = _approved(sign_in_as, user, job, carpenter)

        revised = artisan_api.post(
            f"/api/v1/direct-jobs/{job.id}/revisions/",
            {
                "price_minor": 85000,
                "scope": "Assemble, fix to the wall and replace two broken hinges.",
                "reason": "Two of the door hinges in the box are cracked.",
            },
            format="json",
        )
        assert revised.status_code == 201, revised.data
        job.refresh_from_db()
        assert job.assigned_quote.price_minor == 60000

        revision_id = next(q["id"] for q in revised.data["quotes"] if q["revises"])
        approved = owner_api.post(
            f"/api/v1/artisan-quotes/{revision_id}/approve/", {}, format="json"
        )

        assert approved.status_code == 200, approved.data
        job.refresh_from_db()
        assert job.assigned_quote.price_minor == 85000
        assert approved.data["assigned"]["price_on_record"]["price_minor"] == 85000

    def test_somebody_else_cannot_revise_the_price(
        self, sign_in_as, user, locality, carpenter, rival
    ):
        job = _job(sign_in_as, user, locality)
        _approved(sign_in_as, user, job, carpenter)

        response = _client(sign_in_as, rival.user).post(
            f"/api/v1/direct-jobs/{job.id}/revisions/",
            {
                "price_minor": 99000,
                "scope": "Something else entirely, a lot more.",
                "reason": "I would like more money please.",
            },
            format="json",
        )

        assert response.status_code == 404


class TestCancelling:
    def test_cancelling_lapses_waiting_quotes_and_tells_the_assigned_artisan(
        self, sign_in_as, user, locality, carpenter
    ):
        job = _job(sign_in_as, user, locality)
        owner_api, artisan_api, invitation = _approved(sign_in_as, user, job, carpenter)

        response = owner_api.post(f"/api/v1/me/direct-jobs/{job.id}/cancel/", {}, format="json")

        assert response.status_code == 200, response.data
        assert response.data["job"]["status"] == DirectJobStatus.CANCELLED
        assert response.data["permissions"]["invite"] is False
        dispatch_pending()
        assert Notification.objects.filter(
            user=carpenter.user, kind="artisan.job_cancelled"
        ).exists()
        view = artisan_api.get(f"/api/v1/me/artisan/invitations/{invitation.id}/").data
        assert view["state"] == "cancelled" and view["unlocked"] is False
        assert "Cantonments" not in str(view)

    def test_a_cancelled_job_takes_no_quotes(self, sign_in_as, user, locality, carpenter):
        job = _job(sign_in_as, user, locality)
        owner_api = _client(sign_in_as, user)
        assert _invite(owner_api, job, carpenter).status_code == 201
        owner_api.post(f"/api/v1/me/direct-jobs/{job.id}/cancel/", {}, format="json")

        quoted = _quote(_client(sign_in_as, carpenter.user), _invitation(job, carpenter).id)

        assert quoted.status_code == 409


class TestNotifications:
    def test_the_owner_hears_about_a_quote_on_their_job(
        self, sign_in_as, user, locality, carpenter
    ):
        job = _job(sign_in_as, user, locality)
        assert _invite(_client(sign_in_as, user), job, carpenter).status_code == 201
        dispatch_pending()
        invited = Notification.objects.get(user=carpenter.user, kind="artisan.quote_invited")
        assert "Osu" in invited.body and "Cantonments" not in invited.body

        _quote(_client(sign_in_as, carpenter.user), _invitation(job, carpenter).id)
        dispatch_pending()

        submitted = Notification.objects.get(user=user, kind="artisan.quote_submitted")
        assert submitted.target_type == "artisan_direct_job"
        assert str(submitted.target_id) == str(job.id)
