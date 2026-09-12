"""API-level contract and access control.

The access-control tests matter most: broken object-level authorisation is the
failure that actually gets exploited, and a role check alone does not catch it.
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import PermissionDenied
from apps.identity import services
from apps.identity.models import Session
from tests.conftest import TEST_PASSWORD

pytestmark = pytest.mark.django_db


def code_from(sms):
    return "".join(ch for ch in sms.outbox[-1].body.split()[0] if ch.isdigit())


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def signed_in(api, sms, sign_in_as):
    return sign_in_as(api, "0247770001", device_fingerprint="test-device")


class TestPublicEndpoints:
    def test_requesting_a_code_needs_no_auth(self, api):
        response = api.post("/api/v1/auth/challenge/", {"phone": "0241234567"}, format="json")
        assert response.status_code == 201
        assert "challenge_id" in response.data

    def test_the_response_never_reveals_whether_an_account_exists(self, api, user, sms):
        known = api.post("/api/v1/auth/challenge/", {"phone": user.phone}, format="json")
        unknown = api.post("/api/v1/auth/challenge/", {"phone": "0248889999"}, format="json")
        assert set(known.data) == set(unknown.data)
        assert "is_registered" not in known.data
        assert "exists" not in known.data

    def test_signing_up_with_a_known_number_is_refused_at_the_number(self, api, user, sms):
        """The contract the phone screen branches on.

        409 and this exact code, so the client can show "sign in instead"
        rather than an error. No message goes out.
        """
        response = api.post(
            "/api/v1/auth/challenge/",
            {"phone": user.phone, "purpose": "sign_up"},
            format="json",
        )

        assert response.status_code == 409
        assert response.data["error"]["code"] == "ACCOUNT_EXISTS"
        assert response.data["error"]["message"] == "This number already has an account."
        assert sms.outbox == []
        assert "challenge_id" not in response.data

    def test_signing_up_with_a_new_number_is_unchanged(self, api, sms):
        response = api.post(
            "/api/v1/auth/challenge/",
            {"phone": "0248887766", "purpose": "sign_up"},
            format="json",
        )

        assert response.status_code == 201
        assert set(response.data) == {
            "challenge_id",
            "phone_display",
            "expires_in",
            "resend_in",
            "attempts_allowed",
        }
        assert len(sms.outbox) == 1

    def test_a_malformed_number_gets_a_human_message(self, api):
        response = api.post("/api/v1/auth/challenge/", {"phone": "12345"}, format="json")
        assert response.status_code == 422
        assert response.data["error"]["code"] == "validation_failed"

    def test_the_code_is_never_in_the_response(self, api, sms):
        response = api.post("/api/v1/auth/challenge/", {"phone": "0241234567"}, format="json")
        assert code_from(sms) not in str(response.data)


class TestProtectedEndpoints:
    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/me/",
            "/api/v1/me/security/",
            "/api/v1/me/devices/",
            "/api/v1/me/sessions/",
            "/api/v1/trust/verifications/",
        ],
    )
    def test_everything_personal_requires_a_token(self, api, path):
        assert api.get(path).status_code in (401, 403)

    def test_a_forged_token_is_refused(self, api):
        api.credentials(HTTP_AUTHORIZATION="Bearer v1.forged.signature")
        assert api.get("/api/v1/me/").status_code in (401, 403)

    def test_me_returns_the_signed_in_user(self, api, signed_in):
        response = api.get("/api/v1/me/")
        assert response.status_code == 200
        assert response.data["is_phone_verified"] is True

    def test_me_never_returns_the_raw_phone_number(self, api, signed_in):
        """Only the formatted national display form leaves the API."""
        response = api.get("/api/v1/me/")
        assert "+233" not in str(response.data)

    def test_me_carries_the_trust_summary(self, api, signed_in):
        response = api.get("/api/v1/me/")
        assert response.data["trust"]["phone"]["state"] == "verified"
        assert response.data["trust"]["identity"]["state"] == "unverified"

    def test_me_is_the_canonical_account_and_routing_context(self, api, signed_in):
        response = api.get("/api/v1/me/")
        assert response.data["account_status"] == "active"
        assert response.data["authentication_state"] == "authenticated"
        assert response.data["registration_state"] == "complete"
        assert response.data["entry_routes"] == {
            "mobile": "/(app)/(tabs)",
            "web": "/home",
        }

    def test_me_carries_the_capabilities_clients_render_from(self, api, signed_in):
        capabilities = api.get("/api/v1/me/").data["capabilities"]

        assert capabilities["account_type"] == "tenant"
        assert capabilities["phone_verified"] is True
        assert capabilities["provider"] == {
            "exists": False,
            "verification_status": None,
            "onboarding_complete": False,
            "workspace_access": False,
            "can_create_property": False,
        }


class TestRegistrationJourney:
    """Phone, code, account type, profile, password — then an account exists."""

    def _prove_number(self, api, sms, phone):
        """Prove a number and come away with a ticket, not an account.

        No session either: there is nobody to open one for until the form
        is finished.
        """
        challenge = api.post(
            "/api/v1/auth/challenge/",
            {"phone": phone, "purpose": "sign_up"},
            format="json",
            HTTP_X_CLIENT="mobile",
        )
        assert challenge.status_code == 201
        verified = api.post(
            "/api/v1/auth/verify/",
            {
                "challenge_id": challenge.data["challenge_id"],
                "code": code_from(sms),
                "platform": "android",
                "device_fingerprint": "registration-device",
            },
            format="json",
            HTTP_X_CLIENT="mobile",
        )
        assert verified.status_code == 200
        assert verified.data["registration_required"] is True
        assert "access_token" not in verified.data
        return verified.data["registration_ticket"]

    def _register(self, api, ticket, **fields):
        """Submit the form the ticket authorises."""
        return api.post(
            "/api/v1/me/registration/",
            {"registration_ticket": ticket, "platform": "android", **fields},
            format="json",
            HTTP_X_CLIENT="mobile",
        )

    def test_a_tenant_registers_and_lands_in_discovery(self, api, sms):
        from apps.identity.models import User

        ticket = self._prove_number(api, sms, "0247770088")
        assert not User.objects.filter(phone="+233247770088").exists()

        created = self._register(
            api,
            ticket,
            account_type="tenant",
            first_name="Abena",
            last_name="Mensah",
            date_of_birth="1994-03-02",
            password="correct-horse-battery-staple",
        )

        assert created.status_code == 201
        # Registering is what opens the first session, because it is what
        # creates the account the session belongs to.
        assert created.data["access_token"]
        me = created.data["user"]
        assert me["registration_state"] == "complete"
        assert me["capabilities"]["tenant"]["workspace_access"] is True
        assert me["capabilities"]["provider"]["workspace_access"] is False
        assert me["entry_routes"] == {
            "mobile": "/(app)/(tabs)",
            "web": "/home",
        }

    def test_a_provider_registers_and_waits_on_verification(self, api, sms):
        ticket = self._prove_number(api, sms, "0247770089")

        created = self._register(
            api,
            ticket,
            account_type="provider",
            first_name="Kwesi",
            last_name="Owusu",
            date_of_birth="1988-11-20",
            email="kwesi@example.com",
            password="correct-horse-battery-staple",
        )

        assert created.status_code == 201
        me = created.data["user"]
        provider = me["capabilities"]["provider"]
        assert provider["exists"] is True
        assert provider["verification_status"] == "not_started"
        assert provider["workspace_access"] is False
        assert me["entry_routes"] == {
            "mobile": "/(app)/provider",
            "web": "/provider",
        }
        # Declaring provider grants no role. Roles now follow a decision.
        assert me["roles"] == []

    def test_a_ticket_is_not_a_session(self, api, sms):
        """A proved number can create an account and do nothing else.

        There used to be a row and a session here, which made "prove a
        number" the first half of "be somebody". Presenting the ticket as a
        bearer token reaches nothing, and no account exists to reach it as.
        """
        from apps.identity.models import User

        ticket = self._prove_number(api, sms, "0247770090")
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {ticket}")

        blocked = api.post(
            "/api/v1/portfolio/properties/",
            {"title": "Too Early", "property_type": "residential"},
            format="json",
        )

        assert blocked.status_code in (401, 403)
        assert api.get("/api/v1/me/").status_code in (401, 403)
        assert not User.objects.filter(phone="+233247770090").exists()

    def test_registration_refuses_someone_under_eighteen(self, api, sms):
        from datetime import date

        ticket = self._prove_number(api, sms, "0247770091")
        too_young = date.today().replace(year=date.today().year - 15)

        response = self._register(
            api,
            ticket,
            account_type="tenant",
            first_name="Ama",
            last_name="Yeboah",
            date_of_birth=too_young.isoformat(),
            password="correct-horse-battery-staple",
        )

        assert response.status_code == 422
        assert "18" in str(response.data)

    def test_every_problem_is_reported_at_once_and_named_by_field(self, api, sms):
        """A form must be able to point at the input that caused each fault.

        Reporting one fault per submission makes someone with four faults submit
        five times, and reporting them all in one sentence next to the button
        leaves them guessing which of six boxes it is about.
        """
        ticket = self._prove_number(api, sms, "0247770093")

        response = self._register(
            api,
            ticket,
            account_type="tenant",
            first_name="",
            last_name="",
            date_of_birth="2015-01-01",
            password="abc",
        )

        assert response.status_code == 422
        fields = response.data["error"]["details"]["fields"]
        assert set(fields) == {"first_name", "last_name", "date_of_birth", "password"}
        assert "18" in " ".join(fields["date_of_birth"])

    def test_an_eight_character_password_is_accepted(self, api, sms):
        """The floor is eight. It was ten, which was longer than Django's own
        default and the main reason the form was abandoned."""
        ticket = self._prove_number(api, sms, "0247770094")

        response = self._register(
            api,
            ticket,
            account_type="tenant",
            first_name="Adwoa",
            last_name="Boateng",
            date_of_birth="1992-05-11",
            password="kenkey-9x",
        )

        assert response.status_code == 201
        assert response.data["user"]["registration_state"] == "complete"

    def test_registration_refuses_a_weak_password(self, api, sms):
        ticket = self._prove_number(api, sms, "0247770092")

        response = self._register(
            api,
            ticket,
            account_type="tenant",
            first_name="Ama",
            last_name="Yeboah",
            date_of_birth="1990-01-01",
            password="12345678",
        )

        assert response.status_code == 422


class TestPasswordSignIn:
    def test_a_registered_account_signs_in_with_its_password(self, api, user):
        from tests.conftest import TEST_PASSWORD

        response = api.post(
            "/api/v1/auth/sign-in/",
            {"phone": user.phone, "password": TEST_PASSWORD, "platform": "android"},
            format="json",
        )

        assert response.status_code == 200
        assert response.data["user"]["id"] == str(user.id)
        assert "access_token" in response.data

    def test_a_wrong_password_is_refused(self, api, user):
        response = api.post(
            "/api/v1/auth/sign-in/",
            {"phone": user.phone, "password": "wrong-one-entirely", "platform": "android"},
            format="json",
        )

        assert response.status_code in (401, 403)

    def test_forgotten_password_is_recovered_with_a_code(self, api, user, sms):
        started = api.post("/api/v1/auth/password-reset/", {"phone": user.phone}, format="json")
        assert started.status_code == 201

        verified = api.post(
            "/api/v1/auth/password-reset/verify/",
            {"challenge_id": started.data["challenge_id"], "code": code_from(sms)},
            format="json",
        )
        assert verified.status_code == 200
        # A reset token, deliberately not a session.
        assert "access_token" not in verified.data

        completed = api.post(
            "/api/v1/auth/password-reset/complete/",
            {
                "reset_token": verified.data["reset_token"],
                "new_password": "another-entirely-fresh-secret",
                "platform": "android",
            },
            format="json",
        )
        assert completed.status_code == 200

        signed_in = api.post(
            "/api/v1/auth/sign-in/",
            {
                "phone": user.phone,
                "password": "another-entirely-fresh-secret",
                "platform": "android",
            },
            format="json",
        )
        assert signed_in.status_code == 200

    def test_reset_for_an_unknown_number_is_refused_before_any_code_is_sent(self, api, sms):
        response = api.post("/api/v1/auth/password-reset/", {"phone": "0209999999"}, format="json")

        assert response.status_code == 404
        assert response.data["error"]["code"] == "NO_ACCOUNT"
        # The point of moving the check: nothing was spent finding this out.
        assert sms.outbox == []

    def test_reset_for_an_unfinished_registration_is_refused(self, api, sms):
        """A proved number with no account behind it is not an account.

        There is no password to reset, and answering "check your messages" would
        send someone looking for a code that leads nowhere.
        """
        from apps.identity.models import User

        User.objects.create_user(phone="+233208888888", is_phone_verified=True)

        response = api.post("/api/v1/auth/password-reset/", {"phone": "0208888888"}, format="json")

        assert response.status_code == 404
        assert response.data["error"]["code"] == "NO_ACCOUNT"
        assert sms.outbox == []

    def test_an_account_predating_passwords_may_still_recover(self, api, sms):
        """Sign-in tells these accounts to use "Forgot password" to set one.

        Gating recovery on a *complete* registration would lock the door that
        message points at, because "no usable password" is exactly what makes
        them incomplete.
        """
        from datetime import date

        from django.utils import timezone

        from apps.identity.models import User

        user = User.objects.create_user(
            phone="+233207777777",
            first_name="Adjoa",
            last_name="Boateng",
            account_type="tenant",
            date_of_birth=date(1990, 6, 15),
            is_phone_verified=True,
            phone_verified_at=timezone.now(),
        )
        user.set_unusable_password()
        user.save(update_fields=["password"])
        assert user.registration_state == "password_required"

        response = api.post("/api/v1/auth/password-reset/", {"phone": "0207777777"}, format="json")

        assert response.status_code == 201
        assert sms.outbox != []


class TestRoles:
    def test_declaring_an_intent_to_manage_grants_no_provider_role(self, api, signed_in):
        """Intent is a stated journey. It used to hand out the landlord role,
        which is how an account could reach the provider workspace having
        proved nothing."""
        completed = api.post(
            "/api/v1/me/onboarding/intent/", {"intent": "manage_property"}, format="json"
        )

        assert completed.status_code == 200
        assert "landlord" not in completed.data["roles"]
        assert completed.data["capabilities"]["provider"]["workspace_access"] is False
        assert completed.data["entry_routes"]["web"] != "/properties"

    def test_intent_selection_is_retry_safe(self, api, signed_in):
        response = api.post(
            "/api/v1/me/onboarding/intent/", {"intent": "find_property"}, format="json"
        )
        assert response.status_code == 200

        repeated = api.post(
            "/api/v1/me/onboarding/intent/", {"intent": "find_property"}, format="json"
        )
        assert repeated.status_code == 200
        assert repeated.data["intents"].count("find_property") == 1

    def test_onboarding_rejects_controlled_roles(self, api, signed_in):
        response = api.post("/api/v1/me/onboarding/role/", {"role": "admin"}, format="json")
        assert response.status_code == 422

    def test_a_user_cannot_give_themselves_the_landlord_role(self, api, signed_in):
        """The hole, as an HTTP request.

        This call used to return 201 and a provider workspace. Provider standing
        is now a decision someone makes about evidence, so the only thing this
        endpoint will do is point at the verification that decides it.
        """
        response = api.post("/api/v1/me/roles/", {"role": "landlord"}, format="json")

        assert response.status_code == 422
        assert "provider verification" in response.data["error"]["message"]
        assert "landlord" not in api.get("/api/v1/me/").data["roles"]

    def test_a_user_can_still_add_the_tenant_role(self, api, signed_in):
        """Renting is not a privilege: every action behind it needs the other
        side's agreement."""
        response = api.post("/api/v1/me/roles/", {"role": "tenant"}, format="json")

        assert response.status_code == 201
        assert "tenant" in response.data["roles"]

    def test_a_user_cannot_grant_themselves_staff_roles(self, api, signed_in):
        response = api.post("/api/v1/me/roles/", {"role": "admin"}, format="json")
        assert response.status_code == 422

    def test_a_role_profile_needs_the_role_first(self, api, signed_in):
        assert api.get("/api/v1/me/profile/landlord/").status_code == 403
        assert api.get("/api/v1/me/profile/tenant/").status_code == 200


class TestReviewAccessControl:
    def test_an_ordinary_user_cannot_see_the_review_queue(self, api, signed_in):
        # The legacy consumer/staff reviewer surface no longer exists.
        assert api.get("/api/v1/trust/review/queue/").status_code == 404

    def test_an_ordinary_user_cannot_decide_a_verification(self, api, signed_in, user, staff):
        from apps.trust import services as trust_services
        from apps.trust.models import SubjectType, VerificationKind, VerificationMethod

        verification = trust_services.start_verification(
            subject_type=SubjectType.USER,
            subject_id=user.id,
            kind=VerificationKind.IDENTITY,
            method=VerificationMethod.DOCUMENT_REVIEW,
        )
        response = api.post(
            f"/api/v1/trust/review/verifications/{verification.id}/decide/",
            {"approved": True},
            format="json",
        )
        assert response.status_code == 404

    def test_legacy_staff_principal_has_no_review_endpoint(self, api, sms, staff):
        """Management principals are a different model and cannot be a consumer subject."""
        from apps.trust import services as trust_services
        from apps.trust.models import SubjectType, VerificationKind, VerificationMethod

        # Even force-authenticating an old consumer staff row cannot restore the
        # removed review route.
        api.force_authenticate(user=staff)

        own = trust_services.start_verification(
            subject_type=SubjectType.USER,
            subject_id=staff.id,
            kind=VerificationKind.IDENTITY,
            method=VerificationMethod.DOCUMENT_REVIEW,
        )
        response = api.post(
            f"/api/v1/trust/review/verifications/{own.id}/decide/",
            {"approved": True},
            format="json",
        )
        assert response.status_code == 404


class TestPublicProfiles:
    def test_another_user_sees_a_masked_number_and_the_stamps(self, api, signed_in, landlord):
        response = api.get(f"/api/v1/trust/users/{landlord.id}/")
        assert response.status_code == 200
        assert "***" in response.data["phone_masked"]
        assert "trust" in response.data

    def test_another_user_never_sees_evidence(self, api, signed_in, landlord):
        response = api.get(f"/api/v1/trust/users/{landlord.id}/")
        assert "evidence" not in str(response.data)
        assert "national_id" not in str(response.data)


class TestSessionEndpoints:
    def test_refresh_returns_a_new_pair(self, api, signed_in):
        response = api.post(
            "/api/v1/auth/refresh/",
            {"refresh_token": signed_in["refresh_token"]},
            format="json",
        )
        assert response.status_code == 200
        assert response.data["refresh_token"] != signed_in["refresh_token"]

    def test_the_device_list_marks_the_current_device(self, api, signed_in):
        response = api.get("/api/v1/me/devices/")
        assert response.status_code == 200
        assert any(device["is_current"] for device in response.data)

    def test_a_removed_device_disappears_and_cannot_keep_showing_its_action(self, api, signed_in):
        other = services.sign_in_with_password(
            raw_phone=signed_in["user"].phone,
            password=TEST_PASSWORD,
            device_fingerprint="device-to-remove",
            platform="android",
        )

        removed = api.delete(f"/api/v1/me/devices/{other['device'].id}/")
        assert removed.status_code == 200
        assert removed.data["blocked"] is False

        listed = api.get("/api/v1/me/devices/")
        assert listed.status_code == 200
        assert str(other["device"].id) not in {row["id"] for row in listed.data}
        other["device"].refresh_from_db()
        # Signed out, not barred. This assertion used to read `blocked_at is not
        # None`, which is the bug it was pinning: removal set a block nothing
        # ever cleared, so tidying a device list cost somebody that handset.
        assert other["device"].removed_at is not None
        assert other["device"].blocked_at is None
        assert api.delete(f"/api/v1/me/devices/{other['device'].id}/").status_code == 404

    def test_a_device_reported_stolen_is_barred_and_the_owner_cannot_undo_it(self, api, signed_in):
        other = services.sign_in_with_password(
            raw_phone=signed_in["user"].phone,
            password=TEST_PASSWORD,
            device_fingerprint="taken-from-me",
            platform="android",
        )

        blocked = api.post(f"/api/v1/me/devices/{other['device'].id}/block/", {}, format="json")
        assert blocked.status_code == 200
        assert blocked.data["blocked"] is True

        other["device"].refresh_from_db()
        assert other["device"].blocked_at is not None
        listed = api.get("/api/v1/me/devices/").data
        assert str(other["device"].id) not in {row["id"] for row in listed}

        # The handset stays out, and the owner has no self-service way back:
        # lifting it is Management's, which is what makes the choice meaningful.
        with pytest.raises(PermissionDenied):
            services.sign_in_with_password(
                raw_phone=signed_in["user"].phone,
                password=TEST_PASSWORD,
                device_fingerprint="taken-from-me",
            )

    def test_the_current_device_cannot_be_removed_from_the_device_list(self, api, signed_in):
        response = api.delete(f"/api/v1/me/devices/{signed_in['device'].id}/")

        assert response.status_code == 409
        signed_in["device"].refresh_from_db()
        assert signed_in["device"].blocked_at is None

    def test_session_list_returns_only_unexpired_live_sessions(self, api, signed_in):
        signed_in["session"].expires_at = timezone.now() - timedelta(seconds=1)
        signed_in["session"].save(update_fields=["expires_at"])

        # Use a fresh session for the request while leaving the expired row
        # unrevoked, which is the legacy state this endpoint must not call live.
        replacement = services.sign_in_with_password(
            raw_phone=signed_in["user"].phone,
            password=TEST_PASSWORD,
            device_fingerprint="replacement-device",
        )
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {replacement['access_token']}")
        response = api.get("/api/v1/me/sessions/")

        assert response.status_code == 200
        assert [row["id"] for row in response.data] == [str(replacement["session"].id)]

    def test_a_user_can_sign_out_another_session_without_blocking_its_device(self, api, signed_in):
        other = services.sign_in_with_password(
            raw_phone=signed_in["user"].phone,
            password=TEST_PASSWORD,
            device_fingerprint="other-device",
            platform="android",
        )

        response = api.delete(f"/api/v1/me/sessions/{other['session'].id}/")

        assert response.status_code == 204
        other["session"].refresh_from_db()
        assert other["session"].revoked_reason == "signed_out_from_session_list"
        assert other["device"].blocked_at is None
        signed_in["session"].refresh_from_db()
        assert signed_in["session"].is_active

    def test_the_current_or_another_users_session_cannot_be_ended_from_the_list(
        self, api, signed_in, registered
    ):
        current = api.delete(f"/api/v1/me/sessions/{signed_in['session'].id}/")
        assert current.status_code == 409

        other_user = registered("0247770099")
        foreign = services.sign_in_with_password(
            raw_phone=other_user.phone,
            password=TEST_PASSWORD,
            device_fingerprint="foreign-device",
        )
        hidden = api.delete(f"/api/v1/me/sessions/{foreign['session'].id}/")
        assert hidden.status_code == 404
        assert Session.objects.get(id=foreign["session"].id).is_active

    def test_security_status_is_written_for_a_person(self, api, signed_in):
        response = api.get("/api/v1/me/security/")
        assert response.status_code == 200
        assert set(response.data) >= {"level", "reasons", "payouts_held", "active_sessions"}
