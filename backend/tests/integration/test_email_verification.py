"""Adding or changing an email address goes through a code sent to it.

The address is held on the verification, not the account, until the code comes
back — so nothing about the account changes on a mistyped or borrowed address.
"""

from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.identity.models import EmailVerification, User

pytestmark = pytest.mark.django_db


def code_from_email() -> str:
    return mail.outbox[-1].body.split()[0]


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def member(api, sign_in_as):
    sign_in_as(api, "0247770101")
    return User.objects.get(phone="+233247770101")


def start(api, email):
    return api.post("/api/v1/me/email/", {"email": email}, format="json")


def confirm(api, verification_id, code):
    return api.post(
        "/api/v1/me/email/verify/",
        {"verification_id": str(verification_id), "code": code},
        format="json",
    )


class TestAddingAnAddress:
    def test_a_code_is_sent_and_nothing_changes_until_it_returns(self, api, member):
        response = start(api, "Ama@Example.com")

        assert response.status_code == 201
        assert response.data["email"] == "ama@example.com"
        assert response.data["resend_in"] > 0
        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == ["ama@example.com"]
        code = code_from_email()
        assert len(code) == 6 and code.isdigit()
        assert code in mail.outbox[0].subject

        member.refresh_from_db()
        assert member.email is None
        assert member.is_email_verified is False

        confirmed = confirm(api, response.data["verification_id"], code)
        assert confirmed.status_code == 200
        assert confirmed.data["email"] == "ama@example.com"
        assert confirmed.data["is_email_verified"] is True

        member.refresh_from_db()
        assert member.email == "ama@example.com"
        assert member.is_email_verified is True

    def test_the_code_is_never_stored(self, api, member):
        start(api, "ama@example.com")
        row = EmailVerification.objects.get(user=member)
        assert code_from_email() not in (row.code_hash, row.code_salt)

    def test_a_changed_address_keeps_the_old_one_until_confirmed(self, api, member):
        member.email = "old@example.com"
        member.is_email_verified = True
        member.save()

        response = start(api, "new@example.com")
        assert response.status_code == 201

        member.refresh_from_db()
        assert member.email == "old@example.com"
        assert member.is_email_verified is True

        confirm(api, response.data["verification_id"], code_from_email())
        member.refresh_from_db()
        assert member.email == "new@example.com"

    def test_an_address_given_at_registration_can_be_confirmed(self, api, member):
        member.email = "ama@example.com"
        member.save()

        response = start(api, "ama@example.com")
        assert response.status_code == 201
        confirm(api, response.data["verification_id"], code_from_email())

        member.refresh_from_db()
        assert member.is_email_verified is True


class TestRefusals:
    def test_an_address_someone_else_has_is_refused_on_the_field(self, api, member):
        other = User.objects.create_user(phone="0247770102", email="taken@example.com")
        assert other.email

        response = start(api, "TAKEN@example.com")
        assert response.status_code == 422
        assert "email" in response.data["error"]["details"]["fields"]
        assert mail.outbox == []

    def test_a_malformed_address_is_refused_on_the_field(self, api, member):
        response = start(api, "not-an-address")
        assert response.status_code == 422
        assert response.data["error"]["details"]["fields"]["email"] == ["Check the email address."]

    def test_a_wrong_code_counts_down_and_changes_nothing(self, api, member):
        response = start(api, "ama@example.com")
        code = code_from_email()
        wrong = "000000" if code != "000000" else "111111"

        refused = confirm(api, response.data["verification_id"], wrong)
        assert refused.status_code == 400
        assert refused.data["error"]["details"]["attempts_remaining"] == 4

        member.refresh_from_db()
        assert member.email is None

    def test_five_wrong_codes_end_the_request(self, api, member):
        response = start(api, "ama@example.com")
        code = code_from_email()
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            confirm(api, response.data["verification_id"], wrong)

        late = confirm(api, response.data["verification_id"], code)
        assert late.status_code == 400
        member.refresh_from_db()
        assert member.email is None

    def test_an_expired_code_is_refused(self, api, member):
        response = start(api, "ama@example.com")
        EmailVerification.objects.filter(id=response.data["verification_id"]).update(
            last_sent_at=timezone.now() - timedelta(minutes=6)
        )
        refused = confirm(api, response.data["verification_id"], code_from_email())
        assert refused.status_code == 400
        member.refresh_from_db()
        assert member.email is None

    def test_another_accounts_request_cannot_be_confirmed(self, api, member, sign_in_as):
        response = start(api, "ama@example.com")
        code = code_from_email()

        intruder = APIClient()
        sign_in_as(intruder, "0247770103")
        refused = confirm(intruder, response.data["verification_id"], code)
        assert refused.status_code == 400
        assert User.objects.get(phone="+233247770103").email is None

    def test_an_immediate_resend_waits_and_a_resend_keeps_the_attempt_count(self, api, member):
        first = start(api, "ama@example.com")
        again = start(api, "ama@example.com")
        assert again.status_code == 429

        row = EmailVerification.objects.get(id=first.data["verification_id"])
        row.attempts = 3
        row.last_sent_at = timezone.now() - timedelta(minutes=2)
        row.save()

        resent = start(api, "ama@example.com")
        assert resent.status_code == 201
        assert resent.data["verification_id"] == first.data["verification_id"]
        row.refresh_from_db()
        assert row.attempts == 3
        assert row.send_count == 2

    def test_needs_a_signed_in_account(self, api):
        assert start(api, "ama@example.com").status_code == 401


class TestPatchCannotSkipTheCode:
    def test_a_new_address_through_patch_is_refused(self, api, member):
        response = api.patch("/api/v1/me/", {"email": "sneaky@example.com"}, format="json")
        assert response.status_code == 422
        member.refresh_from_db()
        assert member.email is None

    def test_sending_back_the_same_address_with_other_fields_still_saves(self, api, member):
        member.email = "ama@example.com"
        member.is_email_verified = True
        member.save()

        response = api.patch(
            "/api/v1/me/",
            {"email": "ama@example.com", "preferred_name": "Ama"},
            format="json",
        )
        assert response.status_code == 200
        member.refresh_from_db()
        assert member.preferred_name == "Ama"
        assert member.is_email_verified is True

    def test_clearing_the_address_needs_no_code(self, api, member):
        member.email = "ama@example.com"
        member.is_email_verified = True
        member.save()

        response = api.delete("/api/v1/me/email/")
        assert response.status_code == 200
        member.refresh_from_db()
        assert member.email is None
        assert member.is_email_verified is False
