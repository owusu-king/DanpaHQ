"""Housing Passport: a tenant's own record, and the parts of it they choose to show.

What these pin down, in the order a tenant meets them:

* The passport is read from the records that own each fact, with the right
  word for how each fact is known — confirmed by both parties, verified by a
  check, pending, disputed — and an absence stays an absence.
* A share link shows exactly the chosen scope, to anyone holding it, and
  nothing else about the person: no contact details, no other tenancies.
* Ownership is enforced on every route, revocation and expiry take effect on
  the next request, and every link made or opened is audited without the token.
* A correction routes to Management's support queue and marks the record as
  disputed, to the tenant and to recipients, until it is decided.
"""

from datetime import date, timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.passport.models import PassportShare
from tests.conftest import sign_in

pytestmark = pytest.mark.django_db

OPEN = "/api/v1/passport-shares/open/"


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


@pytest.fixture
def units(landlord, address, approve_provider):
    from apps.property.models import Property, Unit

    prop = Property.objects.create(
        owner=landlord, address=address, title="Osu block", property_type="apartment"
    )
    approve_provider(landlord, prop)
    return [
        Unit.objects.create(property=prop, label=f"Flat {letter}", bedrooms=1, bathrooms=1)
        for letter in "AB"
    ]


def _let(landlord, tenant, unit, **overrides):
    from apps.lease import services as lease_services

    terms = {
        "rent_minor": 150000,
        "advance_months": 6,
        "deposit_months": 1,
        "agency_fee_months": 0,
        "starts_on": date.today(),
        "term_months": 12,
    }
    terms.update(overrides)
    lease = lease_services.draft_lease(user=landlord, unit=unit, tenant=tenant, data=terms)
    lease = lease_services.offer_lease(lease=lease, user=landlord)
    lease = lease_services.accept_lease(lease=lease, user=tenant)
    lease.refresh_from_db()
    return lease


def _pay(lease, *, by, confirm_by=None, dispute_by=None, paid_on=None):
    from apps.rent import services as rent

    charge = rent.build_schedule(lease)[0]
    payment = rent.record_payment(
        lease=lease,
        user=by,
        data={
            "amount_minor": charge.amount_minor,
            "paid_on": paid_on or date.today(),
            "charge_id": charge.id,
            "method": "momo",
        },
    )
    if confirm_by:
        payment = rent.confirm_payment(payment=payment, user=confirm_by)
    if dispute_by:
        payment = rent.dispute_payment(payment=payment, user=dispute_by, reason="Never received")
    return payment


def _client(user):
    api = APIClient()
    sign_in(api, user=user)
    return api


def _tenancy_id(lease):
    lease.refresh_from_db()
    return str(lease.tenancy_id)


def _share(api, **body):
    payload = {"include_identity": True, "include_payments": True, **body}
    response = api.post("/api/v1/me/passport/shares/", payload, format="json")
    assert response.status_code == 201, response.content
    return response.json()


def _open(token, **extra):
    return APIClient().post(OPEN, {"token": token}, format="json", **extra)


# --- the owner's passport ---------------------------------------------------------


class TestTheOwnersPassport:
    def test_a_new_account_shows_what_is_checked_and_what_is_not(self, user):
        body = _client(user).get("/api/v1/me/passport/").json()

        stamps = {row["key"]: row for row in body["identity"]["credentials"]}
        # make_account leaves a dated phone verification, as registration does.
        assert stamps["phone"]["status"] == "verified"
        # "Not checked" is drawn, not omitted.
        assert stamps["identity"]["status"] == "unverified"
        assert stamps["email"]["status"] == "unverified"
        assert body["tenancies"] == []
        # No history is no history: nothing in the summary reads as a mark against.
        assert body["summary"]["tenancies"] == 0
        assert body["summary"]["payments_confirmed"] == 0
        assert body["not_recorded"] == ["inspections", "references"]
        assert [event["kind"] for event in body["timeline"]] == ["joined"]

    def test_an_agreed_tenancy_is_confirmed_by_both_parties(self, landlord, user, units):
        lease = _let(landlord, user, units[0])

        body = _client(user).get("/api/v1/me/passport/").json()

        [tenancy] = body["tenancies"]
        assert tenancy["id"] == _tenancy_id(lease)
        assert tenancy["credential"]["status"] == "confirmed"
        assert (
            "both" in tenancy["credential"]["basis"]
            or "tenant and the provider" in tenancy["credential"]["basis"]
        )
        assert tenancy["place"]["title"] == "Osu block"
        assert tenancy["place"]["locality"] == "Osu"
        # The owner sees their own amounts.
        assert tenancy["rent"]["formatted"]
        # Nothing recorded is said plainly, not scored.
        assert tenancy["payments"]["status"] == "none"
        assert body["summary"]["tenancies"] == 1
        assert "agreement" in {event["kind"] for event in body["timeline"]}

    def test_payment_states_follow_the_ledger(self, landlord, user, units):
        lease = _let(landlord, user, units[0])
        api = _client(user)

        claimed = _pay(lease, by=user)
        payments = api.get("/api/v1/me/passport/").json()["tenancies"][0]["payments"]
        assert payments["status"] == "pending"
        assert payments["awaiting"] == 1
        assert payments["confirmed"] == 0

        from apps.rent import services as rent

        rent.confirm_payment(payment=claimed, user=landlord)
        payments = api.get("/api/v1/me/passport/").json()["tenancies"][0]["payments"]
        assert payments["status"] == "confirmed"
        assert payments["confirmed"] == 1
        assert payments["on_time"] == 1
        assert payments["late"] == 0

    def test_a_disputed_payment_marks_the_record_disputed(self, landlord, user, units):
        lease = _let(landlord, user, units[0])
        _pay(lease, by=landlord, dispute_by=user)

        payments = _client(user).get("/api/v1/me/passport/").json()["tenancies"][0]["payments"]
        assert payments["status"] == "disputed"
        assert payments["disputed"] == 1

    def test_a_pending_record_that_ended_without_an_agreement_is_not_history(
        self, landlord, user, units
    ):
        from apps.tenancy.models import Tenancy, TenancyStatus

        Tenancy.objects.create(
            tenant=user,
            property=units[1].property,
            unit=units[1],
            status=TenancyStatus.ENDED,
            ended_on=date.today(),
        )
        assert _client(user).get("/api/v1/me/passport/").json()["tenancies"] == []

    def test_someone_else_sees_only_their_own(self, landlord, user, registered, units):
        _let(landlord, user, units[0])
        stranger = registered("0209990001", first_name="Kwesi")

        body = _client(stranger).get("/api/v1/me/passport/").json()
        assert body["tenancies"] == []
        assert body["holder"]["name"].startswith("Kwesi")

    def test_it_needs_a_session(self):
        assert APIClient().get("/api/v1/me/passport/").status_code == 401


# --- sharing ------------------------------------------------------------------------


class TestSharing:
    def test_a_link_shows_exactly_the_chosen_scope(self, landlord, user, units):
        first = _let(landlord, user, units[0])
        _let(landlord, user, units[1])
        api = _client(user)

        share = _share(
            api,
            recipient_label="East Legon landlord",
            include_identity=False,
            tenancy_ids=[_tenancy_id(first)],
            include_payments=True,
            include_amounts=False,
        )
        assert share["state"] == "active"
        assert share["token"]

        response = _open(share["token"])
        assert response.status_code == 200
        view = response.json()
        assert view["identity"] is None
        assert [row["id"] for row in view["tenancies"]] == [_tenancy_id(first)]
        # Amounts are their own decision.
        assert view["tenancies"][0]["rent"] is None
        assert view["tenancies"][0]["payments"]["total_formatted"] is None
        assert view["share"]["recipient_label"] == "East Legon landlord"
        assert view["sections"] == {
            "identity": False,
            "tenancies": 1,
            "payments": True,
            "amounts": False,
        }

    def test_payments_can_be_left_out(self, landlord, user, units):
        lease = _let(landlord, user, units[0])
        share = _share(_client(user), tenancy_ids=[_tenancy_id(lease)], include_payments=False)

        view = _open(share["token"]).json()
        assert view["tenancies"][0]["payments"] is None

    def test_the_view_carries_no_contact_details(self, landlord, user, units):
        user.email = "ama.mensah@example.com"
        user.save(update_fields=["email"])
        lease = _let(landlord, user, units[0])
        share = _share(_client(user), tenancy_ids=[_tenancy_id(lease)], include_amounts=True)

        content = _open(share["token"]).content.decode()
        assert user.phone not in content
        assert user.phone[-9:] not in content
        assert "ama.mensah@example.com" not in content
        assert landlord.phone[-9:] not in content
        assert landlord.first_name not in content

    def test_the_preview_is_what_the_recipient_sees(self, landlord, user, units):
        lease = _let(landlord, user, units[0])
        api = _client(user)
        scope = {
            "include_identity": True,
            "tenancy_ids": [_tenancy_id(lease)],
            "include_payments": True,
            "include_amounts": True,
        }
        preview = api.post("/api/v1/me/passport/preview/", scope, format="json").json()
        share = _share(api, **scope)

        opened = _open(share["token"]).json()
        opened.pop("share")
        assert opened == preview

    def test_another_persons_tenancy_cannot_be_put_in_a_link(
        self, landlord, user, registered, units
    ):
        theirs = _let(landlord, registered("0209990002"), units[0])

        response = _client(user).post(
            "/api/v1/me/passport/shares/",
            {"include_identity": True, "tenancy_ids": [_tenancy_id(theirs)]},
            format="json",
        )
        assert response.status_code == 422
        assert not PassportShare.objects.exists()

    def test_something_must_be_chosen(self, user):
        response = _client(user).post(
            "/api/v1/me/passport/shares/", {"include_identity": False}, format="json"
        )
        assert response.status_code == 422

    def test_the_lifetime_is_one_of_the_offered_ones(self, user):
        response = _client(user).post(
            "/api/v1/me/passport/shares/",
            {"include_identity": True, "expires_in_days": 365},
            format="json",
        )
        assert response.status_code in {400, 422}

    def test_links_are_capped(self, user):
        from apps.passport.services import MAX_ACTIVE_SHARES

        api = _client(user)
        for _ in range(MAX_ACTIVE_SHARES):
            _share(api)
        response = api.post(
            "/api/v1/me/passport/shares/", {"include_identity": True}, format="json"
        )
        assert response.status_code == 409

    def test_nobody_else_can_list_or_revoke_a_link(self, user, registered):
        share = _share(_client(user))
        other = _client(registered("0209990003"))

        assert other.get("/api/v1/me/passport/shares/").json() == []
        response = other.post(f"/api/v1/me/passport/shares/{share['id']}/revoke/")
        assert response.status_code == 404
        assert _open(share["token"]).status_code == 200

    def test_revoking_stops_it_on_the_next_request(self, user):
        api = _client(user)
        share = _share(api)
        assert _open(share["token"]).status_code == 200

        revoked = api.post(f"/api/v1/me/passport/shares/{share['id']}/revoke/").json()
        assert revoked["state"] == "revoked"
        # The owner can no longer copy a link that does not work.
        assert revoked["token"] is None

        response = _open(share["token"])
        assert response.status_code == 410
        assert response.json()["error"]["code"] == "passport_share_revoked"
        assert "tenancies" not in response.json()

    def test_an_expired_link_says_so_and_shows_nothing(self, user):
        share = _share(_client(user))
        PassportShare.objects.filter(id=share["id"]).update(
            created_at=timezone.now() - timedelta(days=10),
            expires_at=timezone.now() - timedelta(seconds=1),
        )

        response = _open(share["token"])
        assert response.status_code == 410
        assert response.json()["error"]["code"] == "passport_share_expired"
        listed = _client(user).get("/api/v1/me/passport/shares/").json()
        assert listed[0]["state"] == "expired"
        assert listed[0]["token"] is None

    def test_unknown_and_malformed_tokens_get_one_answer(self, user):
        share = _share(_client(user))
        near_miss = share["token"][:-1] + ("A" if share["token"][-1] != "A" else "B")

        for token in (near_miss, "short", "x" * 43):
            response = _open(token)
            assert response.status_code == 404, token
            assert response.json()["error"]["code"] == "not_found"
        # No token at all is a malformed request, not a lookup.
        assert _open("").status_code == 422

    def test_a_deactivated_account_shares_nothing(self, user):
        share = _share(_client(user))
        user.is_active = False
        user.save(update_fields=["is_active"])

        assert _open(share["token"]).status_code == 404

    def test_opening_ignores_whoever_the_browser_is_signed_in_as(self, user):
        share = _share(_client(user))
        response = _open(share["token"], HTTP_AUTHORIZATION="Bearer not-a-real-token")
        assert response.status_code == 200

    def test_the_response_is_never_cached_or_indexed(self, user):
        share = _share(_client(user))
        for response in (_open(share["token"]), _open("x" * 43)):
            assert "no-store" in response["Cache-Control"]
            assert "noindex" in response["X-Robots-Tag"]
            assert response["Referrer-Policy"] == "no-referrer"

    def test_views_are_counted_and_audited_without_the_token(self, user):
        from apps.audit.models import AuditAction, AuditLog

        share = _share(_client(user))
        _open(share["token"])
        _open(share["token"])

        row = PassportShare.objects.get(id=share["id"])
        assert row.view_count == 2
        assert row.first_viewed_at and row.last_viewed_at

        entries = AuditLog.objects.filter(aggregate_type="passport_share", aggregate_id=share["id"])
        assert entries.filter(action=AuditAction.CREATE).count() == 1
        assert entries.filter(action=AuditAction.VIEW).count() == 2
        for entry in entries:
            text = f"{entry.changes} {entry.metadata}"
            assert share["token"] not in text
            assert row.token_digest not in text

    def test_the_database_never_holds_the_token(self, user):
        share = _share(_client(user))
        row = PassportShare.objects.get(id=share["id"])
        assert share["token"] not in (row.token_digest, row.salt)
        # The owner can copy it again while it is live.
        listed = _client(user).get("/api/v1/me/passport/shares/").json()
        assert listed[0]["token"] == share["token"]


# --- corrections -----------------------------------------------------------------------


class TestCorrections:
    def test_a_correction_goes_to_review_and_marks_the_record(self, landlord, user, units):
        from apps.operations.models import SupportCase

        lease = _let(landlord, user, units[0])
        tenancy_id = _tenancy_id(lease)
        api = _client(user)
        share = _share(api, tenancy_ids=[tenancy_id])

        response = api.post(
            "/api/v1/me/passport/corrections/",
            {
                "record_type": "tenancy",
                "record_id": tenancy_id,
                "reason": "I moved in on the 3rd, not the 1st.",
            },
            format="json",
        )
        assert response.status_code == 201
        assert response.json()["state"] == "under_review"

        case = SupportCase.objects.get(user=user)
        assert case.category == "lease"
        assert "Housing Passport" in case.summary

        mine = api.get("/api/v1/me/passport/").json()["tenancies"][0]
        assert mine["credential"]["status"] == "disputed"
        assert mine["credential"]["status_before_review"] == "confirmed"
        assert mine["review"]["note"].startswith("You asked")

        theirs = _open(share["token"]).json()["tenancies"][0]
        assert theirs["credential"]["status"] == "disputed"
        assert theirs["review"]["note"].startswith("The tenant has asked")
        # The reason is between the tenant and Management.
        assert "3rd" not in _open(share["token"]).content.decode()

    def test_a_record_already_in_review_is_not_reported_twice(self, landlord, user, units):
        lease = _let(landlord, user, units[0])
        api = _client(user)
        body = {
            "record_type": "payments",
            "record_id": _tenancy_id(lease),
            "reason": "A payment is missing from March.",
        }

        assert api.post("/api/v1/me/passport/corrections/", body, format="json").status_code == 201
        assert api.post("/api/v1/me/passport/corrections/", body, format="json").status_code == 409

    def test_a_decided_review_clears_the_dispute(self, landlord, user, units):
        from apps.operations.models import SupportCase

        lease = _let(landlord, user, units[0])
        api = _client(user)
        api.post(
            "/api/v1/me/passport/corrections/",
            {
                "record_type": "tenancy",
                "record_id": _tenancy_id(lease),
                "reason": "The start date is wrong here.",
            },
            format="json",
        )
        SupportCase.objects.filter(user=user).update(status="resolved", resolved_at=timezone.now())

        body = api.get("/api/v1/me/passport/").json()
        assert body["tenancies"][0]["credential"]["status"] == "confirmed"
        assert body["corrections"][0]["state"] == "resolved"

    def test_identity_can_be_reported(self, user):
        api = _client(user)
        response = api.post(
            "/api/v1/me/passport/corrections/",
            {"record_type": "identity", "reason": "My surname is spelled wrongly."},
            format="json",
        )
        assert response.status_code == 201
        assert api.get("/api/v1/me/passport/").json()["identity"]["review"]

    def test_only_your_own_records(self, landlord, user, registered, units):
        theirs = _let(landlord, registered("0209990004"), units[0])
        response = _client(user).post(
            "/api/v1/me/passport/corrections/",
            {
                "record_type": "tenancy",
                "record_id": _tenancy_id(theirs),
                "reason": "This is not right at all.",
            },
            format="json",
        )
        assert response.status_code == 404

    def test_the_reason_must_say_something(self, landlord, user, units):
        lease = _let(landlord, user, units[0])
        response = _client(user).post(
            "/api/v1/me/passport/corrections/",
            {"record_type": "tenancy", "record_id": _tenancy_id(lease), "reason": "wrong"},
            format="json",
        )
        assert response.status_code == 422
