"""Finding an artisan, their profile, and the certificates behind it.

Pinned here: only approved, unsuspended artisans are listed; a listing and a
profile carry facts and never a phone number or an address; certified artisans
come first; electrical work hides the uncertified unless asked; and a
certificate reads "provided" until Management checks it.
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.artisan import services as artisan_services
from apps.artisan.models import ArtisanCertificate, ArtisanPortfolioPhoto, ArtisanProfile
from apps.files.models import FilePurpose
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

from .test_artisan_application import _file
from .test_management_portal import management_user, signed_in_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def accra(db):
    from apps.geo.models import District, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    found, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    return found


@pytest.fixture
def kumasi(db):
    from apps.geo.models import District, Region

    region, _ = Region.objects.get_or_create(name="Ashanti", defaults={"code": "AH"})
    found, _ = District.objects.get_or_create(region=region, name="Kumasi Metropolitan")
    return found


def _artisan(registered, phone, name, *, trades, district, status=VerificationStatus.APPROVED):
    person = registered(phone, first_name=name)
    profile = ArtisanProfile.objects.create(user=person, trades=trades, bio=f"{name} at work.")
    profile.districts.set([district])
    ArtisanPortfolioPhoto.objects.create(
        profile=profile, file=_file(person, FilePurpose.ARTISAN_WORK_PHOTO)
    )
    Verification.objects.create(
        subject_type=SubjectType.USER,
        subject_id=str(person.id),
        kind=VerificationKind.ARTISAN,
        method=VerificationMethod.DOCUMENT_REVIEW,
        status=status,
        decided_at=timezone.now() if status == VerificationStatus.APPROVED else None,
    )
    return profile


def _certificate(profile, trade, *, verified=True, expires_in_days=365):
    return ArtisanCertificate.objects.create(
        profile=profile,
        trade=trade,
        file=_file(profile.user, FilePurpose.ARTISAN_CERTIFICATE),
        issuing_body="Energy Commission",
        expires_on=timezone.localdate() + timedelta(days=expires_in_days),
        verified_at=timezone.now() if verified else None,
    )


def _client(sign_in_as, person):
    api = APIClient()
    sign_in_as(api, user=person)
    return api


def _names(response):
    return [row["name"].split()[0] for row in response.data["results"]]


class TestWhoIsListed:
    def test_only_approved_unsuspended_artisans_other_than_you(
        self, sign_in_as, registered, user, accra
    ):
        _artisan(registered, "0240000001", "Kofi", trades=["plumbing"], district=accra)
        _artisan(
            registered,
            "0240000002",
            "Esi",
            trades=["plumbing"],
            district=accra,
            status=VerificationStatus.PENDING,
        )
        paused = _artisan(registered, "0240000003", "Yaw", trades=["plumbing"], district=accra)
        paused.suspended_at = timezone.now()
        paused.save()
        me = _artisan(registered, "0240000004", "Abena", trades=["plumbing"], district=accra)

        listed = _client(sign_in_as, me.user).get("/api/v1/artisans/")

        assert listed.status_code == 200, listed.data
        assert _names(listed) == ["Kofi"]

    def test_a_listing_and_a_profile_never_carry_contact_or_address(
        self, sign_in_as, registered, user, accra
    ):
        kofi = _artisan(registered, "0240000001", "Kofi", trades=["plumbing"], district=accra)
        api = _client(sign_in_as, user)

        listing = api.get("/api/v1/artisans/")
        profile = api.get(f"/api/v1/artisans/{kofi.id}/")

        assert profile.status_code == 200, profile.data
        for payload in (listing.data["results"][0], profile.data):
            text = str(payload)
            assert "0240000001" not in text and "+233240000001" not in text
            assert not {"phone", "email", "address", "street", "digital_address"} & set(payload)
        assert profile.data["portfolio"][0]["url"]
        assert "file_id" not in str(profile.data["certificates"])

    def test_a_suspended_or_pending_artisan_has_no_profile_to_open(
        self, sign_in_as, registered, user, accra
    ):
        paused = _artisan(registered, "0240000003", "Yaw", trades=["plumbing"], district=accra)
        paused.suspended_at = timezone.now()
        paused.save()
        pending = _artisan(
            registered,
            "0240000002",
            "Esi",
            trades=["plumbing"],
            district=accra,
            status=VerificationStatus.PENDING,
        )
        api = _client(sign_in_as, user)

        assert api.get(f"/api/v1/artisans/{paused.id}/").status_code == 404
        assert api.get(f"/api/v1/artisans/{pending.id}/").status_code == 404

    def test_finding_an_artisan_needs_an_account(self, registered, accra):
        _artisan(registered, "0240000001", "Kofi", trades=["plumbing"], district=accra)

        assert APIClient().get("/api/v1/artisans/").status_code == 401


class TestFilters:
    def test_by_trade_and_area(self, sign_in_as, registered, user, accra, kumasi):
        _artisan(registered, "0240000001", "Kofi", trades=["plumbing"], district=accra)
        _artisan(registered, "0240000002", "Esi", trades=["painting"], district=accra)
        _artisan(registered, "0240000003", "Yaw", trades=["plumbing"], district=kumasi)
        api = _client(sign_in_as, user)

        plumbers_in_accra = api.get(f"/api/v1/artisans/?trade=plumbing&district={accra.id}")

        assert _names(plumbers_in_accra) == ["Kofi"]

    def test_certified_artisans_come_first_and_can_be_the_only_ones(
        self, sign_in_as, registered, user, accra
    ):
        _artisan(registered, "0240000001", "Kofi", trades=["plumbing"], district=accra)
        esi = _artisan(registered, "0240000002", "Esi", trades=["plumbing"], district=accra)
        _certificate(esi, "plumbing")
        api = _client(sign_in_as, user)

        everyone = api.get("/api/v1/artisans/?trade=plumbing")
        certified = api.get("/api/v1/artisans/?trade=plumbing&certified=true")

        assert _names(everyone) == ["Esi", "Kofi"]
        assert everyone.data["results"][0]["certified_trades"] == ["Plumbing"]
        assert _names(certified) == ["Esi"]

    def test_a_certificate_that_is_not_yet_checked_or_has_expired_does_not_certify(
        self, sign_in_as, registered, user, accra
    ):
        kofi = _artisan(registered, "0240000001", "Kofi", trades=["plumbing"], district=accra)
        _certificate(kofi, "plumbing", verified=False)
        esi = _artisan(registered, "0240000002", "Esi", trades=["plumbing"], district=accra)
        _certificate(esi, "plumbing", expires_in_days=-1)

        certified = _client(sign_in_as, user).get("/api/v1/artisans/?certified=true")

        assert _names(certified) == []


class TestElectrical:
    def test_uncertified_electricians_are_hidden_unless_asked_for(
        self, sign_in_as, registered, user, accra
    ):
        _artisan(registered, "0240000001", "Kofi", trades=["electrical"], district=accra)
        esi = _artisan(registered, "0240000002", "Esi", trades=["electrical"], district=accra)
        _certificate(esi, "electrical")
        # A certificate in another trade says nothing about wiring.
        yaw = _artisan(
            registered, "0240000003", "Yaw", trades=["electrical", "plumbing"], district=accra
        )
        _certificate(yaw, "plumbing")
        api = _client(sign_in_as, user)

        default = api.get("/api/v1/artisans/?trade=electrical")
        everyone = api.get("/api/v1/artisans/?trade=electrical&show_uncertified=true")

        assert default.data["electrical"] is True
        assert _names(default) == ["Esi"]
        assert default.data["hidden_uncertified"] == 2
        assert _names(everyone)[0] == "Esi" and set(_names(everyone)) == {"Esi", "Kofi", "Yaw"}
        assert everyone.data["hidden_uncertified"] == 0


class TestMyProfile:
    def _body(self, person, district, **overrides):
        return {
            "trades": ["plumbing", "roofing"],
            "district_ids": [str(district.id)],
            "bio": "Now roofing too.",
            "portfolio_file_ids": [str(_file(person, FilePurpose.ARTISAN_WORK_PHOTO).id)],
            **overrides,
        }

    def test_an_approved_artisan_keeps_their_profile_current(
        self, sign_in_as, registered, accra, kumasi
    ):
        kofi = _artisan(registered, "0240000001", "Kofi", trades=["plumbing"], district=accra)
        api = _client(sign_in_as, kofi.user)

        response = api.put(
            "/api/v1/me/artisan/profile/", self._body(kofi.user, kumasi), format="json"
        )

        assert response.status_code == 200, response.data
        assert [trade["value"] for trade in response.data["profile"]["trades"]] == [
            "plumbing",
            "roofing",
        ]
        assert response.data["profile"]["districts"][0]["name"] == "Kumasi Metropolitan"
        # Editing is not re-applying: the approval stands.
        assert response.data["status"] == "approved"

    def test_an_applicant_cannot_use_the_editor_to_skip_review(
        self, sign_in_as, registered, accra
    ):
        esi = _artisan(
            registered,
            "0240000002",
            "Esi",
            trades=["plumbing"],
            district=accra,
            status=VerificationStatus.PENDING,
        )

        response = _client(sign_in_as, esi.user).put(
            "/api/v1/me/artisan/profile/", self._body(esi.user, accra), format="json"
        )

        assert response.status_code == 403

    def test_describing_a_checked_certificate_differently_undoes_the_check(
        self, sign_in_as, registered, accra
    ):
        kofi = _artisan(registered, "0240000001", "Kofi", trades=["electrical"], district=accra)
        certificate = _certificate(kofi, "electrical")
        api = _client(sign_in_as, kofi.user)
        unchanged = {
            "file_id": str(certificate.file_id),
            "trade": "electrical",
            "issuing_body": "Energy Commission",
            "expires_on": certificate.expires_on.isoformat(),
        }

        kept = api.put(
            "/api/v1/me/artisan/profile/",
            self._body(kofi.user, accra, certificates=[unchanged]),
            format="json",
        )
        assert kept.data["profile"]["certificates"][0]["status"] == "verified"

        renamed = api.put(
            "/api/v1/me/artisan/profile/",
            self._body(
                kofi.user, accra, certificates=[{**unchanged, "issuing_body": "Somebody else"}]
            ),
            format="json",
        )
        assert renamed.data["profile"]["certificates"][0]["status"] == "provided"


class TestCertificateChecks:
    def test_management_verifies_with_the_date_and_the_artisan_hears(
        self, sign_in_as, registered, user, accra
    ):
        kofi = _artisan(registered, "0240000001", "Kofi", trades=["electrical"], district=accra)
        certificate = _certificate(kofi, "electrical", verified=False)
        management = signed_in_client(management_user())

        queue = management.get("/api/v1/management/artisan-certificates/")
        assert [row["id"] for row in queue.data] == [str(certificate.id)]
        assert management.get(
            f"/api/v1/management/artisan-certificates/{certificate.id}/file/"
        ).data["url"]

        decided = management.post(
            f"/api/v1/management/artisan-certificates/{certificate.id}/decision/",
            {"verified": True},
            format="json",
        )

        assert decided.status_code == 200, decided.data
        assert decided.data["status"] == "verified"
        assert management.get("/api/v1/management/artisan-certificates/").data == []
        dispatch_pending()
        assert Notification.objects.filter(
            user=kofi.user, kind="artisan.certificate_verified"
        ).exists()
        listed = _client(sign_in_as, user).get("/api/v1/artisans/?trade=electrical")
        assert _names(listed) == ["Kofi"]

    def test_a_declined_certificate_is_never_shown_and_the_artisan_reads_why(
        self, sign_in_as, registered, user, accra
    ):
        kofi = _artisan(registered, "0240000001", "Kofi", trades=["electrical"], district=accra)
        certificate = _certificate(kofi, "electrical", verified=False)
        management = signed_in_client(management_user())

        refused = management.post(
            f"/api/v1/management/artisan-certificates/{certificate.id}/decision/",
            {"verified": False},
            format="json",
        )
        assert refused.status_code in (400, 422)

        declined = management.post(
            f"/api/v1/management/artisan-certificates/{certificate.id}/decision/",
            {"verified": False, "note": "The certificate number does not match the register."},
            format="json",
        )
        assert declined.data["status"] == "declined"

        public = _client(sign_in_as, user).get(f"/api/v1/artisans/{kofi.id}/")
        assert public.data["certificates"] == []
        own = _client(sign_in_as, kofi.user).get("/api/v1/me/artisan/")
        assert own.data["profile"]["certificates"][0]["status"] == "declined"
        assert "does not match" in own.data["profile"]["certificates"][0]["decision_note"]

    def test_a_certificate_is_checked_once(self, registered, accra):
        kofi = _artisan(registered, "0240000001", "Kofi", trades=["electrical"], district=accra)
        certificate = _certificate(kofi, "electrical", verified=False)
        artisan_services.decide_certificate(
            certificate_id=certificate.id, management_actor=None, verified=True
        )

        from apps.core.exceptions import Conflict

        with pytest.raises(Conflict):
            artisan_services.decide_certificate(
                certificate_id=certificate.id, management_actor=None, verified=True
            )

    def test_support_admins_and_consumers_cannot_decide(
        self, sign_in_as, registered, user, accra
    ):
        kofi = _artisan(registered, "0240000001", "Kofi", trades=["electrical"], district=accra)
        certificate = _certificate(kofi, "electrical", verified=False)
        support = signed_in_client(
            management_user(role=ManagementRole.SUPPORT_ADMIN, email="support@example.com")
        )
        path = f"/api/v1/management/artisan-certificates/{certificate.id}/decision/"

        assert support.post(path, {"verified": True}, format="json").status_code == 403
        assert (
            _client(sign_in_as, user).post(path, {"verified": True}, format="json").status_code
            in (401, 403)
        )
        certificate.refresh_from_db()
        assert certificate.verified_at is None
