"""The welcome screen's three journeys, and what choosing one does.

A journey is a context choice. It decides which experience someone is shown and
nothing else — not what they are allowed to do, and not who they are. These
tests exist because the previous routing collapsed the two: it read a role name,
ignored the choice, and sent people somewhere they had not asked to go.
"""

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 4096


@pytest.fixture(autouse=True)
def storage(settings, monkeypatch):
    from django.db import transaction

    from apps.files.storage import get_storage, reset_storage

    settings.STORAGE_BACKEND = "memory"
    settings.FILE_SCAN_MODE = "permissive"
    reset_storage()
    monkeypatch.setattr(transaction, "on_commit", lambda func, using=None: func())
    yield get_storage()
    reset_storage()


def approve_identity(user):
    from django.utils import timezone

    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    return Verification.objects.create(
        subject_type=SubjectType.USER,
        subject_id=str(user.id),
        kind=VerificationKind.IDENTITY,
        method=VerificationMethod.DOCUMENT_REVIEW,
        status=VerificationStatus.APPROVED,
        submitted_by=user,
        decided_at=timezone.now(),
    )


def submit_provider_documents(user, storage):
    from apps.files import services as file_services
    from apps.identity import services

    stored, _ = file_services.reserve_upload(
        user=user,
        purpose="identity_document",
        filename="card.jpg",
        content_type="image/jpeg",
        size_bytes=len(JPEG),
    )
    storage.write(key=stored.storage_key, data=JPEG)
    document = file_services.complete_upload(user=user, file_id=stored.id)
    document.refresh_from_db()
    return services.start_provider_verification(
        user=user, documents=[{"file": document, "evidence_type": "ghana_card_front"}]
    )


class TestFindAProperty:
    """Rule 1. Browsing is anonymous, and stays anonymous."""

    def test_searching_needs_no_account_and_creates_none(self, db):
        from apps.identity.models import User

        before = User.objects.count()
        response = APIClient().get("/api/v1/listings/")

        assert response.status_code == 200
        assert User.objects.count() == before

    def test_an_action_with_a_counterparty_is_where_authentication_starts(self, db):
        response = APIClient().post("/api/v1/me/viewings/", {"listing_id": "x"}, format="json")

        assert response.status_code in (401, 403)


class TestTenantAskingForTheProviderJourney:
    """A tenant signing in through the provider door is turned back.

    Entering them into the provider journey made the welcome screen a way to
    declare yourself a provider. The refusal carries its own code so the client
    can answer with a screen offering the tenant space or a way out, rather than
    an error banner.
    """

    def test_the_request_is_refused_with_a_code_the_client_can_act_on(self, registered, sign_in_as):
        person = registered("0207770001", account_type="tenant")
        api = APIClient()
        sign_in_as(api, user=person)

        refused = api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")

        assert refused.status_code == 403
        assert refused.data["error"]["code"] == "NOT_A_PROVIDER"

    def test_the_session_survives_the_refusal(self, registered, sign_in_as):
        """Signing in worked; only the requested experience did not.

        The client answers with a screen offering the tenant space or a way
        out, so the session has to still be there when it does.
        """
        person = registered("0207770009", account_type="tenant")
        api = APIClient()
        sign_in_as(api, user=person)

        api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")

        assert api.get("/api/v1/me/").status_code == 200

    def test_a_provider_account_is_still_admitted(self, registered, sign_in_as):
        """The refusal is about the account type, not the workspace."""
        person = registered("0207770010", account_type="provider")
        api = APIClient()
        sign_in_as(api, user=person)

        chosen = api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")

        assert chosen.status_code == 200
        assert chosen.data["capabilities"]["active_workspace"] == "provider"

    def test_the_tenant_is_left_exactly_as_they_were(self, registered, sign_in_as):
        from apps.identity.models import User

        person = registered("0207770002", account_type="tenant")
        api = APIClient()
        sign_in_as(api, user=person)
        before = User.objects.count()

        api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")

        me = api.get("/api/v1/me/").data
        assert User.objects.count() == before, "no second account"
        assert me["id"] == str(person.id)
        assert me["capabilities"]["provider"]["exists"] is False
        assert me["capabilities"]["active_workspace"] == "tenant"
        assert me["capabilities"]["tenant"]["workspace_access"] is True
        assert me["entry_routes"]["web"] == "/home"


class TestSwitchingBack:
    """Rule 6. A context switch is navigation and nothing else."""

    def test_switching_to_tenant_does_not_cancel_a_review_in_progress(
        self, registered, sign_in_as, storage
    ):
        person = registered("0207770003", account_type="provider")
        approve_identity(person)
        api = APIClient()
        sign_in_as(api, user=person)

        api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")
        verification = submit_provider_documents(person, storage)
        assert (
            api.get("/api/v1/me/").data["capabilities"]["provider"]["verification_status"]
            == "pending"
        )

        switched = api.post("/api/v1/me/workspace/", {"workspace": "tenant"}, format="json")

        assert switched.status_code == 200
        assert switched.data["capabilities"]["active_workspace"] == "tenant"
        assert switched.data["entry_routes"]["web"] == "/home"
        # The review is exactly where it was.
        verification.refresh_from_db()
        assert verification.status == "pending"
        assert switched.data["capabilities"]["provider"]["verification_status"] == "pending"

    def test_switching_does_not_end_the_session(self, registered, sign_in_as):
        person = registered("0207770004", account_type="provider")
        api = APIClient()
        sign_in_as(api, user=person)

        api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")

        # The same bearer token still works afterwards.
        assert api.get("/api/v1/me/").status_code == 200

    def test_switching_back_and_forth_is_stable(self, registered, sign_in_as):
        person = registered("0207770005", account_type="provider")
        api = APIClient()
        sign_in_as(api, user=person)

        for workspace, route in (
            ("provider", "/provider"),
            ("tenant", "/home"),
            ("provider", "/provider"),
        ):
            response = api.post("/api/v1/me/workspace/", {"workspace": workspace}, format="json")
            assert response.data["capabilities"]["active_workspace"] == workspace
            assert response.data["entry_routes"]["web"] == route


class TestBothCapabilities:
    """Rule 5. One person, one account, two legitimate relationships."""

    def test_an_approved_provider_can_also_be_a_tenant(
        self, registered, sign_in_as, storage, staff
    ):
        from apps.trust import services as trust_services

        person = registered("0207770006", account_type="provider")
        approve_identity(person)
        verification = submit_provider_documents(person, storage)
        trust_services.decide(verification, approved=True, decided_by=staff)

        api = APIClient()
        sign_in_as(api, user=person)
        api.post("/api/v1/me/workspace/", {"workspace": "tenant"}, format="json")
        capabilities = api.get("/api/v1/me/").data["capabilities"]

        assert capabilities["tenant"]["workspace_access"] is True
        assert capabilities["provider"]["workspace_access"] is True
        assert capabilities["available_workspaces"] == ["discovery", "tenant", "provider"]
        assert capabilities["active_workspace"] == "tenant"

    def test_choosing_the_tenant_workspace_acquires_the_tenant_capability(
        self, registered, sign_in_as
    ):
        """Rule 2's escape hatch: the backend explicitly allows this one."""
        person = registered("0207770007", account_type="provider")
        api = APIClient()
        sign_in_as(api, user=person)
        assert api.get("/api/v1/me/").data["capabilities"]["tenant"]["workspace_access"] is False

        chosen = api.post("/api/v1/me/workspace/", {"workspace": "tenant"}, format="json")

        assert chosen.data["capabilities"]["tenant"]["workspace_access"] is True

    def test_choosing_the_provider_workspace_never_acquires_provider_access(
        self, registered, sign_in_as
    ):
        """The asymmetry, stated. Asking puts you in front of the review."""
        person = registered("0207770008", account_type="provider")
        api = APIClient()
        sign_in_as(api, user=person)

        chosen = api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")

        assert chosen.data["capabilities"]["provider"]["workspace_access"] is False
        assert chosen.data["capabilities"]["provider"]["can_create_property"] is False
        assert "landlord" not in chosen.data["roles"]


class TestTenantCapabilityIsRecordedNotAssumed:
    """Rule 9. Being signed in is not being a tenant."""

    def test_a_signed_in_account_is_not_a_tenant_until_it_acts_as_one(self, registered):
        from apps.identity.services import account_capabilities

        person = registered("0207770009", account_type="provider")

        assert account_capabilities(person)["tenant"]["workspace_access"] is False

    def test_asking_to_view_a_place_establishes_the_capability(
        self, registered, landlord, address_for_listing
    ):
        from apps.identity.services import account_capabilities
        from apps.viewing import services as viewing_services

        person = registered("0207770010", account_type="provider")
        assert account_capabilities(person)["tenant"]["workspace_access"] is False

        viewing_services.request_viewing(listing=address_for_listing, tenant=person)

        assert account_capabilities(person)["tenant"]["workspace_access"] is True


@pytest.fixture
def address_for_listing(landlord):
    """A live listing to act against."""
    from apps.geo.models import Address, District, Locality, Region
    from apps.listing.models import Listing, ListingStatus
    from apps.property.models import Property, Unit

    region = Region.objects.create(name="Greater Accra", code="WS-GA")
    district = District.objects.create(region=region, name="Ablekuma")
    locality = Locality.objects.create(district=district, name="Dansoman")
    address = Address.objects.create(locality=locality, digital_address="GA-777-1111")
    prop = Property.objects.create(
        owner=landlord, address=address, title="Dansoman block", property_type="apartment"
    )
    unit = Unit.objects.create(property=prop, label="Flat 2", bedrooms=1, bathrooms=1)
    return Listing.objects.create(
        unit=unit,
        created_by=landlord,
        status=ListingStatus.ACTIVE,
        rent_minor=120000,
        headline="Chamber and hall",
        description="Prepaid meter.",
        locality_id_cache=address.locality_id,
        bedrooms_cache=1,
    )


class TestProviderNeverFallsThroughToTenantSpace:
    """The reported bug, pinned at the layer that decides.

    The backend was always right here — it returned the provider destination at
    every step. The fall-through happened in the clients, where a stored
    `discovery` context was allowed to override the answer. These tests hold the
    backend contract the client fix depends on: at no point in a provider's
    journey does the entry route point at the tenant shell.
    """

    def _register_provider(self, api, sms, phone):
        challenge = api.post(
            "/api/v1/auth/challenge/",
            {"phone": phone, "purpose": "sign_up"},
            format="json",
        )
        verified = api.post(
            "/api/v1/auth/verify/",
            {
                "challenge_id": challenge.data["challenge_id"],
                "code": "".join(ch for ch in sms.outbox[-1].body.split()[0] if ch.isdigit()),
                "platform": "android",
            },
            format="json",
        )
        # The ticket is the credential here: proving the number creates nothing,
        # so there is no session to attach until registration opens one.
        created = api.post(
            "/api/v1/me/registration/",
            {
                "registration_ticket": verified.data["registration_ticket"],
                "account_type": "provider",
                "first_name": "Yaw",
                "last_name": "Asante",
                "date_of_birth": "1990-04-04",
                "password": "kenkey-9x-plantain",
                "platform": "android",
            },
            format="json",
        )
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {created.data['access_token']}")
        return created

    def test_the_route_is_never_the_tenant_shell_at_any_step(self, db, sms, storage):
        from apps.identity.models import User
        from apps.trust import services as trust_services

        api = APIClient()
        created = self._register_provider(api, sms, "0207771001")

        # Straight after registration: provider onboarding, nothing submitted.
        assert created.data["user"]["capabilities"]["active_workspace"] == "provider"
        assert created.data["user"]["entry_routes"]["mobile"] == "/(app)/provider"

        # After choosing the workspace explicitly, still provider onboarding.
        chosen = api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")
        assert chosen.data["entry_routes"]["mobile"] == "/(app)/provider"

        person = User.objects.get(id=created.data["user"]["id"])
        approve_identity(person)
        verification = submit_provider_documents(person, storage)

        # Evidence in, review pending: still the provider screen, now showing
        # where the review stands rather than the form. Never the tenant shell.
        pending = api.get("/api/v1/me/").data
        assert pending["capabilities"]["provider"]["verification_status"] == "pending"
        assert pending["capabilities"]["provider"]["onboarding_complete"] is True
        assert pending["capabilities"]["provider"]["workspace_access"] is False
        assert pending["capabilities"]["provider"]["can_create_property"] is False
        assert pending["entry_routes"] == {
            "mobile": "/(app)/provider",
            "web": "/provider",
        }

        # And after approval it stays the provider workspace.
        trust_services.decide(
            verification,
            approved=True,
            decided_by=User.objects.create_user(phone="0507771001", is_staff=True),
        )
        approved = api.get("/api/v1/me/").data
        assert approved["capabilities"]["provider"]["can_create_property"] is True
        assert approved["entry_routes"]["mobile"] == "/(app)/(provider-tabs)"

    def test_a_pending_provider_is_not_an_incomplete_registration(self, db, sms, storage):
        """Waiting on a reviewer must never read as an unfinished sign-up."""
        from apps.identity.models import User

        api = APIClient()
        created = self._register_provider(api, sms, "0207771002")
        person = User.objects.get(id=created.data["user"]["id"])
        approve_identity(person)
        submit_provider_documents(person, storage)

        me = api.get("/api/v1/me/").data

        assert me["registration_state"] == "complete"
        assert me["capabilities"]["provider"]["onboarding_complete"] is True
        assert me["entry_routes"]["mobile"] != "/(auth)/register"


class TestProviderSwitchesToTenantAndBack:
    """The round trip the mobile More page and tenant profile drive.

    It was broken by a client that changed a local context and never told the
    backend: `active_workspace` stayed `provider`, the entry route kept pointing
    at the provider tabs, and the route gate returned the person immediately.
    Only the backend call moves anyone.
    """

    def test_a_provider_can_cross_over_and_come_back(
        self, registered, provider_standing, sign_in_as
    ):
        person = registered("0207771101", account_type="provider")
        provider_standing(person)
        api = APIClient()
        sign_in_as(api, user=person)

        to_tenant = api.post("/api/v1/me/workspace/", {"workspace": "tenant"}, format="json")

        assert to_tenant.status_code == 200
        assert to_tenant.data["capabilities"]["active_workspace"] == "tenant"
        assert to_tenant.data["entry_routes"]["mobile"] == "/(app)/(tabs)"
        # The way back has to still be on offer, or the crossing is one-way.
        assert "provider" in to_tenant.data["capabilities"]["available_workspaces"]

        back = api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json")

        assert back.status_code == 200
        assert back.data["entry_routes"]["mobile"] == "/(app)/(provider-tabs)"
        # Crossing and returning changed nothing about their standing.
        assert back.data["capabilities"]["provider"]["workspace_access"] is True
        assert back.data["capabilities"]["provider"]["can_create_property"] is True

    def test_a_tenant_only_account_is_offered_no_crossing(self, registered, sign_in_as):
        """Nothing to switch to, so the client shows no switch."""
        person = registered("0207771102", account_type="tenant")
        api = APIClient()
        sign_in_as(api, user=person)

        capabilities = api.get("/api/v1/me/").data["capabilities"]

        assert capabilities["available_workspaces"] == ["discovery", "tenant"]
        assert "provider" not in capabilities["available_workspaces"]
