"""Quotes on maintenance requests, assignment, revisions and the privacy unlock.

Pinned here: an invited artisan reads the area and the problem and nothing that
finds the home or the person; only the payer approves, and approving assigns
the artisan to the same request; the address and a contact open only then;
extra cost exists only once a revised quote is approved; and suspension stops
a pending quote from being approved.
"""

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.artisan.models import Quote, QuoteInvitation, QuoteStatus
from apps.maintenance.models import MaintenanceEventKind, MaintenanceRequest, MaintenanceStatus
from apps.notifications.models import Notification
from apps.outbox.tasks import dispatch_pending

from .test_artisan_discover import _artisan
from .test_maintenance import _file as maintenance_file
from .test_maintenance import address, tenancy, unit  # noqa: F401 — fixtures

pytestmark = pytest.mark.django_db


@pytest.fixture
def district(address):  # noqa: F811 — the fixture above, by name
    return address.locality.district


@pytest.fixture
def repair(sign_in_as, user, tenancy):  # noqa: F811
    api = _client(sign_in_as, user)
    response = api.post(
        "/api/v1/me/maintenance/",
        {
            "tenancy_id": str(tenancy.id),
            "category": "plumbing",
            "description": "The kitchen tap drips all night and the sink is flooding.",
            "photo_file_id": str(maintenance_file(user).id),
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    tenancy.unit.property.address.street = "Oxford Street"
    tenancy.unit.property.address.house_number = "14B"
    tenancy.unit.property.address.save()
    return MaintenanceRequest.objects.get(id=response.data["id"])


@pytest.fixture
def plumber(registered, district):
    return _artisan(registered, "0240000101", "Kofi", trades=["plumbing"], district=district)


@pytest.fixture
def rival(registered, district):
    return _artisan(registered, "0240000102", "Esi", trades=["plumbing"], district=district)


def _client(sign_in_as, person):
    api = APIClient()
    sign_in_as(api, user=person)
    return api


def _invite(api, repair, artisan):
    return api.post(
        f"/api/v1/maintenance/{repair.id}/artisan-invitations/",
        {"artisan_id": str(artisan.id)},
        format="json",
    )


def _quote(
    api, invitation_id, price_minor=45000, scope="Replace the tap washer and reseal the sink trap."
):
    return api.post(
        f"/api/v1/me/artisan/invitations/{invitation_id}/quotes/",
        {
            "price_minor": price_minor,
            "scope": scope,
            "materials": [{"item": "Tap washer", "quantity": "2", "cost_minor": 1500}],
        },
        format="json",
    )


def _invitation(repair, artisan):
    return QuoteInvitation.objects.get(maintenance_request=repair, artisan=artisan)


def _approved(sign_in_as, landlord, repair, plumber):
    landlord_api = _client(sign_in_as, landlord)
    assert _invite(landlord_api, repair, plumber).status_code == 201
    artisan_api = _client(sign_in_as, plumber.user)
    invitation = _invitation(repair, plumber)
    quoted = _quote(artisan_api, invitation.id)
    assert quoted.status_code == 201, quoted.data
    quote_id = quoted.data["quotes"][0]["id"]
    approved = landlord_api.post(f"/api/v1/artisan-quotes/{quote_id}/approve/", {}, format="json")
    assert approved.status_code == 200, approved.data
    return landlord_api, artisan_api, invitation


class TestInviting:
    def test_an_invited_artisan_reads_the_area_and_the_problem_and_nothing_that_finds_the_home(
        self, sign_in_as, landlord, user, repair, plumber
    ):
        assert _invite(_client(sign_in_as, landlord), repair, plumber).status_code == 201
        artisan_api = _client(sign_in_as, plumber.user)

        listed = artisan_api.get("/api/v1/me/artisan/invitations/")

        assert listed.status_code == 200, listed.data
        view = listed.data[0]
        assert view["state"] == "invited" and view["unlocked"] is False
        assert view["request"]["description"].startswith("The kitchen tap")
        assert view["request"]["area"]["locality"] == "Osu"
        assert view["request"]["photo"]["url"]
        text = str(view)
        for secret in ("Oxford Street", "14B", user.display_name, "0201234567", "Near the beach"):
            assert secret not in text
        assert "job" not in view

    def test_only_the_people_who_run_the_property_can_invite(
        self, sign_in_as, user, registered, repair, plumber
    ):
        stranger = registered("0249999999", first_name="Stranger")

        assert _invite(_client(sign_in_as, user), repair, plumber).status_code == 403
        assert _invite(_client(sign_in_as, stranger), repair, plumber).status_code in (403, 404)

    def test_at_most_three_artisans_are_asked_at_once(
        self, sign_in_as, landlord, registered, district, repair
    ):
        api = _client(sign_in_as, landlord)
        for index in range(3):
            artisan = _artisan(
                registered, f"024000020{index}", f"A{index}", trades=["plumbing"], district=district
            )
            assert _invite(api, repair, artisan).status_code == 201
        fourth = _artisan(
            registered, "0240000299", "Fourth", trades=["plumbing"], district=district
        )

        assert _invite(api, repair, fourth).status_code == 409

    def test_a_suspended_artisan_cannot_be_invited(self, sign_in_as, landlord, repair, plumber):
        plumber.suspended_at = timezone.now()
        plumber.save()

        assert _invite(_client(sign_in_as, landlord), repair, plumber).status_code == 404

    def test_a_tenants_suggestion_tells_the_landlord_and_not_the_artisan(
        self, sign_in_as, landlord, user, repair, plumber
    ):
        response = _client(sign_in_as, user).post(
            f"/api/v1/maintenance/{repair.id}/artisan-suggestions/",
            {"artisan_id": str(plumber.id)},
            format="json",
        )
        assert response.status_code == 201, response.data
        dispatch_pending()

        assert Notification.objects.filter(user=landlord, kind="artisan.suggested").exists()
        assert not Notification.objects.filter(user=plumber.user).exists()
        assert _client(sign_in_as, plumber.user).get("/api/v1/me/artisan/invitations/").data == []

        # The landlord sends it on; only then is the artisan asked.
        assert _invite(_client(sign_in_as, landlord), repair, plumber).status_code == 201
        dispatch_pending()
        assert Notification.objects.filter(user=plumber.user, kind="artisan.quote_invited").exists()


class TestQuoting:
    def test_one_quote_waits_at_a_time(self, sign_in_as, landlord, repair, plumber):
        _invite(_client(sign_in_as, landlord), repair, plumber)
        api = _client(sign_in_as, plumber.user)
        invitation = _invitation(repair, plumber)

        assert _quote(api, invitation.id).status_code == 201
        assert _quote(api, invitation.id, price_minor=40000).status_code == 409

    def test_a_suspended_artisan_cannot_quote(self, sign_in_as, landlord, repair, plumber):
        _invite(_client(sign_in_as, landlord), repair, plumber)
        plumber.suspended_at = timezone.now()
        plumber.save()

        response = _quote(_client(sign_in_as, plumber.user), _invitation(repair, plumber).id)

        assert response.status_code == 403

    def test_an_artisan_cannot_quote_on_somebody_elses_invitation(
        self, sign_in_as, landlord, repair, plumber, rival
    ):
        _invite(_client(sign_in_as, landlord), repair, plumber)

        response = _quote(_client(sign_in_as, rival.user), _invitation(repair, plumber).id)

        assert response.status_code == 404


class TestApproval:
    def test_the_payer_approves_and_the_artisan_is_assigned_to_the_same_request(
        self, sign_in_as, landlord, user, repair, plumber, rival
    ):
        landlord_api = _client(sign_in_as, landlord)
        _invite(landlord_api, repair, rival)
        _quote(_client(sign_in_as, rival.user), _invitation(repair, rival).id, price_minor=60000)

        _approved(sign_in_as, landlord, repair, plumber)

        repair.refresh_from_db()
        assert repair.assigned_artisan_id == plumber.id
        assert repair.status == MaintenanceStatus.IN_PROGRESS
        event = repair.events.get(kind=MaintenanceEventKind.ASSIGNED)
        assert event.actor_id == landlord.id
        assert "Kofi" in event.note and "GH" in event.note and landlord.display_name in event.note
        # Nobody else is left waiting for an answer.
        assert Quote.objects.get(invitation__artisan=rival).status == QuoteStatus.DECLINED
        assert _invitation(repair, rival).closed_at is not None
        # No parallel record: still exactly one maintenance request.
        assert MaintenanceRequest.objects.count() == 1

    def test_approval_unlocks_the_address_and_a_contact_for_the_assigned_artisan_only(
        self, sign_in_as, landlord, user, repair, plumber, rival
    ):
        _invite(_client(sign_in_as, landlord), repair, rival)
        _, artisan_api, _ = _approved(sign_in_as, landlord, repair, plumber)

        job = artisan_api.get("/api/v1/me/artisan/jobs/").data[0]
        assert job["unlocked"] is True
        assert "Oxford Street" in job["job"]["address"]["line"]
        assert job["job"]["contact"]["name"] == user.display_name
        assert job["job"]["contact"]["phone"]
        assert job["job"]["approved_by"] == landlord.display_name

        other = _client(sign_in_as, rival.user).get("/api/v1/me/artisan/invitations/").data[0]
        assert other["state"] == "closed" and other["unlocked"] is False
        assert "Oxford Street" not in str(other)

    def test_the_tenant_sees_who_is_doing_it_and_never_the_price(
        self, sign_in_as, landlord, user, repair, plumber
    ):
        _approved(sign_in_as, landlord, repair, plumber)
        dispatch_pending()

        detail = _client(sign_in_as, user).get(f"/api/v1/maintenance/{repair.id}/").data["artisans"]
        assert detail["assigned"]["artisan"]["name"].startswith("Kofi")
        assert detail["assigned"]["price_on_record"] is None
        assert "450.00" not in str(detail)
        assert Notification.objects.filter(user=user, kind="maintenance.assigned").exists()
        assert Notification.objects.filter(
            user=plumber.user, kind="artisan.quote_approved"
        ).exists()

    def test_an_agent_who_runs_the_repair_cannot_approve_spending(
        self, sign_in_as, landlord, registered, repair, plumber
    ):
        from apps.property.models import PropertyRelationship

        agent = registered("0247777777", first_name="Agent")
        PropertyRelationship.objects.create(
            property=repair.property, user=agent, relationship_type="agent"
        )
        agent_api = _client(sign_in_as, agent)
        assert _invite(agent_api, repair, plumber).status_code == 201
        quoted = _quote(_client(sign_in_as, plumber.user), _invitation(repair, plumber).id)

        refused = agent_api.post(
            f"/api/v1/artisan-quotes/{quoted.data['quotes'][0]['id']}/approve/", {}, format="json"
        )

        assert refused.status_code == 403
        repair.refresh_from_db()
        assert repair.assigned_artisan_id is None

    def test_platform_staff_cannot_approve_spending(
        self, sign_in_as, landlord, registered, repair, plumber
    ):
        _invite(_client(sign_in_as, landlord), repair, plumber)
        quoted = _quote(_client(sign_in_as, plumber.user), _invitation(repair, plumber).id)
        staff = registered("0248888888", first_name="Staff")
        type(staff).objects.filter(id=staff.id).update(is_staff=True)
        staff.refresh_from_db()

        # Staff cannot sign in to the consumer API at all; the rule holds below it
        # too, even though `is_managed_by` lets staff run any repair.
        from apps.artisan import quotes as artisan_quotes
        from apps.core.exceptions import PermissionDenied

        with pytest.raises(PermissionDenied):
            artisan_quotes.approve_quote(user=staff, quote_id=quoted.data["quotes"][0]["id"])
        repair.refresh_from_db()
        assert repair.assigned_artisan_id is None

    def test_a_tenant_cannot_approve(self, sign_in_as, landlord, user, repair, plumber):
        _invite(_client(sign_in_as, landlord), repair, plumber)
        quoted = _quote(_client(sign_in_as, plumber.user), _invitation(repair, plumber).id)

        refused = _client(sign_in_as, user).post(
            f"/api/v1/artisan-quotes/{quoted.data['quotes'][0]['id']}/approve/", {}, format="json"
        )

        assert refused.status_code in (403, 404)

    def test_suspension_stops_a_pending_quote_from_being_approved(
        self, sign_in_as, landlord, repair, plumber
    ):
        landlord_api = _client(sign_in_as, landlord)
        _invite(landlord_api, repair, plumber)
        quoted = _quote(_client(sign_in_as, plumber.user), _invitation(repair, plumber).id)
        plumber.suspended_at = timezone.now()
        plumber.save()

        refused = landlord_api.post(
            f"/api/v1/artisan-quotes/{quoted.data['quotes'][0]['id']}/approve/", {}, format="json"
        )

        assert refused.status_code == 409
        repair.refresh_from_db()
        assert repair.assigned_artisan_id is None


class TestRevisions:
    def _revise(self, api, repair, price_minor=65000):
        return api.post(
            f"/api/v1/maintenance/{repair.id}/revisions/",
            {
                "price_minor": price_minor,
                "scope": "Replace the whole tap; the body is cracked.",
                "reason": "The tap body is cracked, so a washer will not hold.",
            },
            format="json",
        )

    def test_extra_cost_counts_only_once_the_payer_approves_it(
        self, sign_in_as, landlord, repair, plumber
    ):
        landlord_api, artisan_api, _ = _approved(sign_in_as, landlord, repair, plumber)
        original = Quote.objects.get(status=QuoteStatus.APPROVED)

        sent = self._revise(artisan_api, repair)
        assert sent.status_code == 201, sent.data
        repair.refresh_from_db()
        assert repair.assigned_quote_id == original.id  # nothing changes yet

        revision = Quote.objects.get(revises=original)
        approved = landlord_api.post(
            f"/api/v1/artisan-quotes/{revision.id}/approve/", {}, format="json"
        )
        assert approved.status_code == 200, approved.data

        repair.refresh_from_db()
        original.refresh_from_db()
        assert repair.assigned_quote_id == revision.id
        assert original.status == QuoteStatus.SUPERSEDED
        assert repair.events.filter(kind=MaintenanceEventKind.REVISION_APPROVED).exists()
        assert approved.data["assigned"]["price_on_record"]["price_minor"] == 65000

    def test_a_declined_revision_leaves_the_price_on_record(
        self, sign_in_as, landlord, repair, plumber
    ):
        landlord_api, artisan_api, _ = _approved(sign_in_as, landlord, repair, plumber)
        original = Quote.objects.get(status=QuoteStatus.APPROVED)
        self._revise(artisan_api, repair)
        revision = Quote.objects.get(revises=original)

        landlord_api.post(
            f"/api/v1/artisan-quotes/{revision.id}/decline/",
            {"note": "Please fix the washer as quoted."},
            format="json",
        )

        repair.refresh_from_db()
        assert repair.assigned_quote_id == original.id
        assert Quote.objects.get(id=revision.id).status == QuoteStatus.DECLINED

    def test_only_the_assigned_artisan_can_ask_for_more(
        self, sign_in_as, landlord, repair, plumber, rival
    ):
        _approved(sign_in_as, landlord, repair, plumber)

        refused = self._revise(_client(sign_in_as, rival.user), repair)

        assert refused.status_code == 404


class TestTheSheet:
    def test_providers_read_requests_and_tenants_read_records_without_prices(
        self, sign_in_as, landlord, user, repair, plumber
    ):
        landlord_api = _client(sign_in_as, landlord)
        _invite(landlord_api, repair, plumber)
        _quote(_client(sign_in_as, plumber.user), _invitation(repair, plumber).id)

        waiting = landlord_api.get("/api/v1/artisan-work/").data
        assert len(waiting["requests"]) == 1 and waiting["records"] == []
        assert waiting["requests"][0]["invitations"][0]["quotes"][0]["price_minor"] == 45000

        quote_id = waiting["requests"][0]["invitations"][0]["quotes"][0]["id"]
        landlord_api.post(f"/api/v1/artisan-quotes/{quote_id}/approve/", {}, format="json")

        tenant_view = _client(sign_in_as, user).get("/api/v1/artisan-work/").data
        assert len(tenant_view["records"]) == 1
        assert tenant_view["records"][0]["assigned"]["price_on_record"] is None
        assert "45000" not in str(tenant_view)
