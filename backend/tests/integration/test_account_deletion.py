"""Deleting an account: the person asks, Management decides."""

import pytest
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict, ValidationFailed
from apps.operations import deletion
from apps.operations.models import AccountDeletionRequest, DeletionStatus, ManagementUser
from tests.conftest import make_account, sign_in

pytestmark = pytest.mark.django_db


@pytest.fixture
def person(db):
    return make_account("0241230001", first_name="Esi", last_name="Quaye")


@pytest.fixture
def manager(db):
    return ManagementUser.objects.create(
        email="ops@rooomly.test", first_name="Ops", last_name="Lead", role="admin"
    )


class TestAsking:
    def test_the_request_needs_the_typed_confirmation(self, person):
        with pytest.raises(ValidationFailed):
            deletion.request_deletion(user=person, reason="", confirmation="delete me")
        item = deletion.request_deletion(user=person, reason="Moving abroad", confirmation="DELETE")
        assert item.status == DeletionStatus.PENDING
        # Asking changes nothing about the account itself.
        person.refresh_from_db()
        assert person.is_active

    def test_one_request_waits_at_a_time_and_can_be_withdrawn(self, person):
        deletion.request_deletion(user=person, reason="", confirmation="DELETE")
        with pytest.raises(Conflict):
            deletion.request_deletion(user=person, reason="", confirmation="DELETE")
        deletion.cancel_deletion(user=person)
        assert deletion.pending_for(person) is None
        deletion.request_deletion(user=person, reason="", confirmation="DELETE")

    def test_over_http(self, person):
        api = APIClient()
        sign_in(api, user=person)
        empty = api.get("/api/v1/me/account-deletion/")
        assert empty.status_code == 200
        assert empty.data["request"] is None
        assert empty.data["confirmation"] == "DELETE"

        refused = api.post("/api/v1/me/account-deletion/", {"confirmation": "no"}, format="json")
        assert refused.status_code == 422
        made = api.post(
            "/api/v1/me/account-deletion/", {"confirmation": "DELETE", "reason": "x"}, format="json"
        )
        assert made.status_code == 201
        assert made.data["request"]["status"] == "pending"
        withdrawn = api.delete("/api/v1/me/account-deletion/")
        assert withdrawn.data["request"]["status"] == "cancelled"


class TestDeciding:
    def test_approval_erases_what_identifies_the_person(self, person, manager):
        phone = person.phone
        item = deletion.request_deletion(user=person, reason="", confirmation="DELETE")
        deletion.approve(item_id=item.id, actor=manager, note="Checked: nothing outstanding.")

        person.refresh_from_db()
        assert not person.is_active
        assert person.first_name == "" and person.last_name == ""
        assert person.display_name == "Deleted account"
        assert person.email is None
        assert person.phone != phone
        assert not person.has_usable_password()
        item.refresh_from_db()
        assert item.status == DeletionStatus.COMPLETED
        assert item.decided_by == manager

        # The real number is free for whoever holds it next.
        make_account(phone, first_name="New")

    def test_declining_needs_a_reason_and_leaves_the_account(self, person, manager):
        item = deletion.request_deletion(user=person, reason="", confirmation="DELETE")
        with pytest.raises(ValidationFailed):
            deletion.decline(item_id=item.id, actor=manager, note=" ")
        deletion.decline(item_id=item.id, actor=manager, note="Your tenancy is still active.")
        person.refresh_from_db()
        assert person.is_active
        assert AccountDeletionRequest.objects.get(id=item.id).status == DeletionStatus.DECLINED

    def test_a_decided_request_cannot_be_decided_again(self, person, manager):
        item = deletion.request_deletion(user=person, reason="", confirmation="DELETE")
        deletion.decline(item_id=item.id, actor=manager, note="Not yet.")
        with pytest.raises(Conflict):
            deletion.approve(item_id=item.id, actor=manager)
