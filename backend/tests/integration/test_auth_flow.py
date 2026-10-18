"""End-to-end authentication. These need a database because the guarantees are
transactional: attempt counters, unique constraints and session rotation.
"""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.core.exceptions import PermissionDenied, RateLimited, ValidationFailed
from apps.identity import services
from apps.identity.models import (
    AuthChallenge,
    ChallengePurpose,
    ChallengeStatus,
    Device,
    Session,
    User,
)
from apps.identity.otp_policy import MAX_VERIFY_ATTEMPTS
from apps.identity.services import ChallengeFailed

pytestmark = pytest.mark.django_db


def sent_code(provider, index=-1):
    """Pull the code out of the message the memory provider captured."""
    body = provider.outbox[index].body
    return "".join(ch for ch in body.split()[0] if ch.isdigit())


def register_new_number(sms, phone, **details):
    """Walk a brand-new number all the way to an account.

    Proving the number no longer creates one, so tests that need an account
    from a cold start have to go through the form as a person does. Returns
    the account that registering creates."""
    challenge = services.start_challenge(raw_phone=phone, purpose=ChallengePurpose.SIGN_UP)
    verified = services.verify_challenge(challenge_id=challenge.id, code=sent_code(sms))
    handoff = services.complete_sign_in(challenge=verified)
    return services.complete_registration(
        ticket=handoff["registration_ticket"],
        data={
            "account_type": "tenant",
            "first_name": "Akos",
            "last_name": "Darko",
            "date_of_birth": date(1992, 4, 11),
            "password": "correct-horse-battery-staple",
            **details,
        },
    )


class TestSignUpMeetsAnExistingAccount:
    """Told at the number, not after the code.

    Someone signing up with the number they already use should learn that on the
    screen where they typed it — not after waiting for an SMS and typing six
    digits. Nothing is sent and nothing is created for a refused sign-up.
    """

    def test_an_existing_account_is_refused_before_any_code_is_sent(self, sms, user):
        from apps.identity.models import AuthChallenge
        from apps.identity.services import AccountExists

        with pytest.raises(AccountExists) as refusal:
            services.start_challenge(raw_phone=user.phone, purpose=ChallengePurpose.SIGN_UP)

        assert refusal.value.code == "ACCOUNT_EXISTS"
        assert refusal.value.status_code == 409
        assert sms.outbox == [], "no message may go out for a refused sign-up"
        assert not AuthChallenge.objects.filter(
            phone=user.phone, purpose=ChallengePurpose.SIGN_UP
        ).exists()

    @pytest.mark.parametrize(
        "written",
        ["0201234567", "+233201234567", "233201234567", "020 123 4567"],
    )
    def test_the_number_is_recognised_however_it_is_written(self, sms, user, written):
        """One normaliser, the same one the rest of authentication uses."""
        from apps.identity.services import AccountExists

        with pytest.raises(AccountExists):
            services.start_challenge(raw_phone=written, purpose=ChallengePurpose.SIGN_UP)

    def test_a_new_number_still_gets_its_code(self, sms):
        challenge = services.start_challenge(
            raw_phone="0247778888", purpose=ChallengePurpose.SIGN_UP
        )

        assert challenge.purpose == ChallengePurpose.SIGN_UP
        assert len(sms.outbox) == 1

    def test_an_unfinished_sign_up_may_carry_on(self, sms):
        """A proved number with no password is not an account to sign in to.

        Sending these people to the sign-in screen would strand them: there is
        no credential to sign in with, and the only way out is to finish the
        registration they abandoned.
        """
        from apps.identity.models import User

        half_made = User.objects.create_user(phone="0247779999")
        half_made.mark_phone_verified()
        assert not half_made.is_registration_complete

        challenge = services.start_challenge(
            raw_phone=half_made.phone, purpose=ChallengePurpose.SIGN_UP
        )

        assert challenge is not None
        assert len(sms.outbox) == 1

    def test_browsing_purposes_still_answer_alike(self, sms, user):
        """The enumeration resistance elsewhere is untouched.

        Sign-up and recovery both distinguish a known number, each because
        answering later costs the person an SMS and a wait for news they
        could have had immediately. Every other purpose answers identically.
        """
        known = services.start_challenge(raw_phone=user.phone, purpose=ChallengePurpose.CONTINUE)
        unknown = services.start_challenge(
            raw_phone="0248889999", purpose=ChallengePurpose.CONTINUE
        )

        assert known.purpose == unknown.purpose == ChallengePurpose.CONTINUE

    def test_recovery_for_an_unknown_number_is_refused_before_sending(self, sms):
        from apps.identity.services import NoAccount

        with pytest.raises(NoAccount) as refusal:
            services.start_challenge(
                raw_phone="0248889999", purpose=ChallengePurpose.RECOVER_ACCOUNT
            )

        assert refusal.value.code == "NO_ACCOUNT"
        assert refusal.value.status_code == 404
        assert sms.outbox == [], "nothing goes out when there is nothing to reset"


class TestSignUp:
    def test_a_proved_number_yields_a_ticket_and_no_account(self, sms):
        """Proving a number is not joining.

        Someone who taps through an OTP and then thinks better of it used to
        be left on the platform as an account with no name and no password.
        The proof is carried in a signed ticket instead.
        """
        challenge = services.start_challenge(raw_phone="0241112222")
        verified = services.verify_challenge(challenge_id=challenge.id, code=sent_code(sms))

        result = services.complete_sign_in(challenge=verified, device_fingerprint="fp-1")

        assert result["registration_required"] is True
        assert result["registration_ticket"]
        # Not a session: it reads nothing and can act on nothing.
        assert "access_token" not in result
        assert not User.objects.filter(phone="+233241112222").exists()

    def test_abandoning_the_form_leaves_nothing_behind(self, sms):
        """The requirement in one test: cancel, and you were never here."""
        challenge = services.start_challenge(raw_phone="0241112230")
        verified = services.verify_challenge(challenge_id=challenge.id, code=sent_code(sms))
        services.complete_sign_in(challenge=verified)

        # The person closes the app. Nothing has to run, because there is
        # nothing to clean up.
        assert not User.objects.filter(phone="+233241112230").exists()

    def test_a_form_that_fails_validation_creates_no_account(self, sms):
        """The row is made inside the same transaction as the validation.

        A password the validators refuse must not leave behind the account
        that was going to hold it.
        """
        challenge = services.start_challenge(raw_phone="0241112231")
        verified = services.verify_challenge(challenge_id=challenge.id, code=sent_code(sms))
        handoff = services.complete_sign_in(challenge=verified)

        with pytest.raises(ValidationFailed):
            services.complete_registration(
                ticket=handoff["registration_ticket"],
                data={
                    "account_type": "tenant",
                    "first_name": "Akos",
                    "last_name": "Darko",
                    "date_of_birth": date(1992, 4, 11),
                    "password": "1234",
                },
            )

        assert not User.objects.filter(phone="+233241112231").exists()

    def test_the_ticket_creates_the_account_when_the_form_is_finished(self, sms):
        user = register_new_number(sms, "0241112232")

        assert user.phone == "+233241112232"
        assert user.is_phone_verified
        assert user.is_registration_complete

    def test_a_proved_number_no_longer_signs_an_existing_account_in(self, sms, user):
        """The SIM-swap closure.

        Proving the number says which account this is, not that the person
        holding the SIM is its owner. A finished account has a password, and
        that is the only way back into it.
        """
        challenge = services.start_challenge(raw_phone=user.phone)
        verified = services.verify_challenge(challenge_id=challenge.id, code=sent_code(sms))

        with pytest.raises(PermissionDenied, match="Sign in with your password"):
            services.complete_sign_in(challenge=verified)

    def test_a_password_signs_an_existing_account_in(self, user):
        from tests.conftest import TEST_PASSWORD

        result = services.sign_in_with_password(
            raw_phone=user.phone, password=TEST_PASSWORD, device_fingerprint="fp-pw"
        )

        assert result["created"] is False
        assert result["user"].id == user.id

    def test_a_wrong_password_says_nothing_about_whether_the_account_exists(self, user):
        """Both answers are identical, so this cannot be used to enumerate."""
        with pytest.raises(PermissionDenied) as wrong:
            services.sign_in_with_password(raw_phone=user.phone, password="not-it-at-all")
        with pytest.raises(PermissionDenied) as unknown:
            services.sign_in_with_password(raw_phone="0249998877", password="not-it-at-all")

        assert str(wrong.value) == str(unknown.value)

    def test_a_failed_sign_in_survives_as_an_audit_entry(self, user):
        """A sign-in that did not happen is evidence.

        This is the reason the credential check is outside a transaction: the
        record is written and then the attempt is refused, so an enclosing
        atomic block would roll away the only trace of it.
        """
        from apps.audit.models import AuditAction, AuditLog

        with pytest.raises(PermissionDenied):
            services.sign_in_with_password(raw_phone=user.phone, password="not-it-at-all")

        assert AuditLog.objects.filter(
            action=AuditAction.LOGIN_FAILED, aggregate_id=str(user.id)
        ).exists()

    def test_staff_cannot_use_consumer_phone_authentication(self, sms, staff):
        challenge = services.start_challenge(raw_phone=staff.phone)
        verified = services.verify_challenge(challenge_id=challenge.id, code=sent_code(sms))

        with pytest.raises(PermissionDenied, match="operations sign-in"):
            services.complete_sign_in(challenge=verified)

    def test_sign_in_does_not_create_an_unknown_account(self, sms):
        challenge = services.start_challenge(
            raw_phone="0241112299", purpose=ChallengePurpose.SIGN_IN
        )
        verified = services.verify_challenge(challenge_id=challenge.id, code=sent_code(sms))

        with pytest.raises(ValidationFailed, match="no account"):
            services.complete_sign_in(challenge=verified)

        assert not User.objects.filter(phone="+233241112299").exists()

    def test_a_new_account_gets_a_profile_but_not_an_assumed_role(self, sms):
        """A tenant holds the tenant role. Nothing else is inferred."""
        user = register_new_number(sms, "0241112223")

        assert user.roles == {"tenant"}
        assert user.onboarding_completed_at is None
        assert hasattr(user, "profile")

    def test_signing_up_creates_a_dated_phone_verification(self, sms):
        """Not a boolean flag: a real record with a method and an expiry, because
        numbers get reassigned."""
        from apps.trust.models import Verification, VerificationKind

        user = register_new_number(sms, "0241112224")

        record = Verification.objects.for_subject("user", user.id).get(kind=VerificationKind.PHONE)
        assert record.display_state == "verified"
        assert record.expires_at is not None
        assert record.evidence.count() == 1


class TestEnumerationResistance:
    def test_the_response_is_identical_for_known_and_unknown_numbers(self, sms, user):
        known = services.start_challenge(raw_phone=user.phone)
        unknown = services.start_challenge(raw_phone="0249998888")

        # Same shape, same fields, nothing that distinguishes them.
        assert known.purpose == unknown.purpose
        assert (known.user is not None) != (unknown.user is not None)  # internal only
        assert known.status == unknown.status == ChallengeStatus.PENDING


class TestBruteForce:
    def test_wrong_codes_are_counted_and_capped(self, sms):
        challenge = services.start_challenge(raw_phone="0241113333")

        for _ in range(MAX_VERIFY_ATTEMPTS):
            with pytest.raises(ChallengeFailed):
                services.verify_challenge(challenge_id=challenge.id, code="000000")

        challenge.refresh_from_db()
        assert challenge.status == ChallengeStatus.FAILED
        assert challenge.locked_until is not None

    def test_the_real_code_stops_working_after_the_cap(self, sms):
        challenge = services.start_challenge(raw_phone="0241113334")
        code = sent_code(sms)

        for _ in range(MAX_VERIFY_ATTEMPTS):
            with pytest.raises(ChallengeFailed):
                services.verify_challenge(challenge_id=challenge.id, code="000000")

        with pytest.raises(ChallengeFailed):
            services.verify_challenge(challenge_id=challenge.id, code=code)

    def test_resending_does_not_reset_the_attempt_counter(self, sms):
        """Otherwise five guesses then 'resend' is an unlimited guessing budget."""
        challenge = services.start_challenge(raw_phone="0241113335")
        with pytest.raises(ChallengeFailed):
            services.verify_challenge(challenge_id=challenge.id, code="000000")

        AuthChallenge.objects.filter(id=challenge.id).update(
            last_sent_at=timezone.now() - timedelta(seconds=300)
        )
        services.start_challenge(raw_phone="0241113335")

        challenge.refresh_from_db()
        assert challenge.attempts == 1

    def test_resending_too_soon_is_refused(self, sms):
        services.start_challenge(raw_phone="0241113336")
        with pytest.raises(RateLimited):
            services.start_challenge(raw_phone="0241113336")


class TestCodeLifetime:
    def test_an_expired_code_is_refused(self, sms):
        challenge = services.start_challenge(raw_phone="0241114444")
        code = sent_code(sms)
        AuthChallenge.objects.filter(id=challenge.id).update(
            expires_at=timezone.now() - timedelta(seconds=1),
            created_at=timezone.now() - timedelta(minutes=10),
        )
        with pytest.raises(ChallengeFailed):
            services.verify_challenge(challenge_id=challenge.id, code=code)

    def test_a_code_cannot_be_used_twice(self, sms):
        challenge = services.start_challenge(raw_phone="0241114445")
        code = sent_code(sms)
        services.verify_challenge(challenge_id=challenge.id, code=code)
        with pytest.raises(ChallengeFailed):
            services.verify_challenge(challenge_id=challenge.id, code=code)

    def test_the_code_is_never_stored_in_the_clear(self, sms):
        services.start_challenge(raw_phone="0241114446")
        code = sent_code(sms)
        challenge = AuthChallenge.objects.get(phone="+233241114446")
        assert code not in challenge.code_hash
        assert len(challenge.code_hash) == 64


class TestSessions:
    def test_refresh_rotates_the_token(self, sms, sign_in_as):
        first = sign_in_as(phone="0241115555", device_fingerprint="fp")

        second = services.rotate_session(refresh_token=first["refresh_token"])
        assert second["refresh_token"] != first["refresh_token"]

    def test_reusing_an_old_refresh_token_signs_the_family_out(self, sms, sign_in_as):
        """The theft-detection property: an attacker replaying a stolen token
        after the real device rotated loses the whole lineage."""
        first = sign_in_as(phone="0241115556", device_fingerprint="fp")

        second = services.rotate_session(refresh_token=first["refresh_token"])

        with pytest.raises(PermissionDenied):
            services.rotate_session(refresh_token=first["refresh_token"])

        assert not Session.objects.get(id=second["session"].id).is_active

    def test_an_unknown_refresh_token_is_refused(self):
        with pytest.raises(PermissionDenied):
            services.rotate_session(refresh_token="not-a-real-token")

    def test_refresh_tokens_are_stored_only_as_hashes(self, sms, sign_in_as):
        result = sign_in_as(phone="0241115557")

        assert not Session.objects.filter(refresh_token_hash=result["refresh_token"]).exists()

    def test_sign_out_everywhere_ends_every_session(self, sms, user):
        for fingerprint in ("a", "b", "c"):
            from tests.conftest import TEST_PASSWORD

            services.sign_in_with_password(
                raw_phone=user.phone,
                password=TEST_PASSWORD,
                device_fingerprint=fingerprint,
            )

        services.sign_out_everywhere(user=user)
        assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 0

    def test_signing_in_again_on_the_same_device_supersedes_its_old_session(self, user):
        from tests.conftest import TEST_PASSWORD

        first = services.sign_in_with_password(
            raw_phone=user.phone,
            password=TEST_PASSWORD,
            device_fingerprint="same-browser",
            platform="web",
            device_label="Chrome on Windows",
        )
        second = services.sign_in_with_password(
            raw_phone=user.phone,
            password=TEST_PASSWORD,
            device_fingerprint="same-browser",
            platform="web",
            device_label="Chrome on Windows",
        )

        assert first["device"].id == second["device"].id
        assert (
            Session.objects.filter(
                user=user,
                device=second["device"],
                revoked_at__isnull=True,
            ).count()
            == 1
        )
        first["session"].refresh_from_db()
        assert first["session"].revoked_reason == "device_signed_in_again"

    def test_different_devices_keep_independent_live_sessions(self, user):
        from tests.conftest import TEST_PASSWORD

        for fingerprint in ("home-browser", "work-browser"):
            services.sign_in_with_password(
                raw_phone=user.phone,
                password=TEST_PASSWORD,
                device_fingerprint=fingerprint,
                platform="web",
            )

        assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 2

    def test_refresh_recognises_a_legacy_web_session_and_retires_unknown_duplicates(self, user):
        from tests.conftest import TEST_PASSWORD

        older = services.sign_in_with_password(
            raw_phone=user.phone,
            password=TEST_PASSWORD,
        )
        current = services.sign_in_with_password(
            raw_phone=user.phone,
            password=TEST_PASSWORD,
        )

        refreshed = services.rotate_session(
            refresh_token=current["refresh_token"],
            device_fingerprint="upgraded-browser",
            platform="web",
            device_label="Firefox on Linux",
        )

        assert refreshed["session"].device.fingerprint == "upgraded-browser"
        assert refreshed["session"].device.label == "Firefox on Linux"
        assert Session.objects.filter(user=user, revoked_at__isnull=True).count() == 1
        older["session"].refresh_from_db()
        assert older["session"].revoked_reason == "legacy_device_recognised"


class TestDevices:
    def test_a_device_is_recorded_on_first_sign_in(self, sms, sign_in_as):
        result = sign_in_as(phone="0241116666", device_fingerprint="pixel-7")

        assert result["device"].fingerprint == "pixel-7"

    def test_a_device_reported_stolen_cannot_sign_in(self, sms, user):
        Device.objects.create(
            user=user,
            fingerprint="stolen",
            platform="android",
            blocked_at=timezone.now(),
            blocked_reason="reported lost or stolen by owner",
        )
        challenge = services.start_challenge(raw_phone=user.phone, user=user)
        verified = services.verify_challenge(challenge_id=challenge.id, code=sent_code(sms))

        with pytest.raises(PermissionDenied):
            services.complete_sign_in(challenge=verified, device_fingerprint="stolen")

    def test_a_device_its_owner_signed_out_can_sign_in_again(self, sms, user):
        """Signing a device out is not a life sentence for the handset.

        Removal used to set `blocked_at`, and nothing anywhere cleared it, so
        somebody tidying their device list could never use that phone on that
        account again. The refusal told them to contact support, and support had
        no tool for it but Django admin.
        """
        from tests.conftest import TEST_PASSWORD

        first = services.sign_in_with_password(
            raw_phone=user.phone,
            password=TEST_PASSWORD,
            device_fingerprint="my-own-phone",
        )
        services.forget_device(device=first["device"], actor=user)

        first["device"].refresh_from_db()
        assert first["device"].removed_at is not None
        assert first["device"].blocked_at is None
        assert not Session.objects.filter(
            user=user, device=first["device"], revoked_at__isnull=True
        ).exists()

        alerts_before = sum(1 for m in sms.outbox if "new device" in m.body.lower())
        again = services.sign_in_with_password(
            raw_phone=user.phone,
            password=TEST_PASSWORD,
            device_fingerprint="my-own-phone",
        )

        assert again["device"].id == first["device"].id
        assert again["device"].removed_at is None
        # It returns as unfamiliar, so its owner hears that it signed in. That
        # alert is the point: a removal that is quietly undone is worse than one
        # that cannot be undone at all.
        alerts_after = sum(1 for m in sms.outbox if "new device" in m.body.lower())
        assert alerts_after == alerts_before + 1

    def test_a_signed_out_device_leaves_the_list_and_a_stolen_one_stays_barred(self, user):
        kept = Device.objects.create(user=user, fingerprint="kept", platform="android")
        signed_out = Device.objects.create(user=user, fingerprint="out", platform="android")
        stolen = Device.objects.create(user=user, fingerprint="gone", platform="android")

        services.forget_device(device=signed_out, actor=user)
        services.block_device(device=stolen, reason="reported lost or stolen by owner", actor=user)

        listed = Device.objects.filter(
            user=user, blocked_at__isnull=True, removed_at__isnull=True
        )
        assert list(listed) == [kept]
        stolen.refresh_from_db()
        assert stolen.is_blocked
        assert not stolen.is_listed

    def test_a_new_device_on_an_existing_account_sends_an_alert(self, sms, user):
        from tests.conftest import TEST_PASSWORD

        services.sign_in_with_password(
            raw_phone=user.phone,
            password=TEST_PASSWORD,
            device_fingerprint="unseen-device",
        )

        assert any("new device" in m.body.lower() for m in sms.outbox)


class TestClosedAccounts:
    def test_a_deactivated_account_cannot_sign_in(self, sms, user):
        user.is_active = False
        user.save(update_fields=["is_active"])

        challenge = services.start_challenge(raw_phone=user.phone, user=user)
        verified = services.verify_challenge(challenge_id=challenge.id, code=sent_code(sms))
        with pytest.raises(PermissionDenied):
            services.complete_sign_in(challenge=verified)


class TestStepUp:
    def test_step_up_issues_a_separate_purpose(self, sms, user):
        challenge = services.require_step_up(user=user, action="add a payout account")
        assert challenge.purpose == ChallengePurpose.STEP_UP

    def test_a_sign_in_code_cannot_be_used_as_a_step_up(self, sms, user):
        """Purpose binding: otherwise a code phished for 'sign in' authorises a
        payout change."""
        challenge = services.start_challenge(
            raw_phone=user.phone, purpose=ChallengePurpose.SIGN_IN, user=user
        )
        code = sent_code(sms)
        with pytest.raises(PermissionDenied):
            services.confirm_step_up(
                user=user, challenge_id=challenge.id, code=code, action="withdraw"
            )


class TestWebRefreshCookie:
    """The browser's refresh token must not be readable by script.

    The web client refreshes with an empty body and relies on the cookie; before
    this existed it sent nothing and got a validation error, so any full page
    load signed the user out with no way back.
    """

    def _register_as(self, client_name: str, sms):
        """Registering is where a new account's first session is opened now.

        /auth/verify hands back a ticket and no tokens, so the cookie this class
        is about is set one call later than it used to be.
        """
        from rest_framework.test import APIClient

        client = APIClient()
        start = client.post(
            "/api/v1/auth/challenge/",
            {"phone": "0241119999", "purpose": "sign_up"},
            format="json",
            HTTP_X_CLIENT=client_name,
        )
        verified = client.post(
            "/api/v1/auth/verify/",
            {
                "challenge_id": start.data["challenge_id"],
                "code": sent_code(sms),
                "platform": "web",
            },
            format="json",
            HTTP_X_CLIENT=client_name,
        )
        response = client.post(
            "/api/v1/me/registration/",
            {
                "registration_ticket": verified.data["registration_ticket"],
                "account_type": "tenant",
                "first_name": "Akos",
                "last_name": "Darko",
                "date_of_birth": "1992-04-11",
                "password": "correct-horse-battery-staple",
                "platform": "web",
            },
            format="json",
            HTTP_X_CLIENT=client_name,
        )
        return client, response

    def test_a_browser_gets_the_refresh_token_in_an_httponly_cookie(self, sms):
        _, response = self._register_as("web", sms)
        assert response.status_code == 201
        # Not in the body: script on the page must not be able to read it.
        assert "refresh_token" not in response.data
        cookie = response.cookies.get("danpahq_refresh")
        assert cookie is not None
        assert cookie["httponly"]
        assert cookie["samesite"] == "Lax"

    def test_a_browser_can_refresh_with_an_empty_body(self, sms):
        client, _ = self._register_as("web", sms)
        refreshed = client.post("/api/v1/auth/refresh/", {}, format="json", HTTP_X_CLIENT="web")
        assert refreshed.status_code == 200
        assert refreshed.data["access_token"]
        assert "refresh_token" not in refreshed.data

    def test_a_native_client_still_gets_the_token_in_the_body(self, sms):
        """Mobile has the Keychain and the Keystore, which beat a cookie."""
        _, response = self._register_as("mobile", sms)
        assert response.data["refresh_token"]
        assert "danpahq_refresh" not in response.cookies

    def test_refreshing_with_neither_a_cookie_nor_a_body_is_refused(self):
        from rest_framework.test import APIClient

        response = APIClient().post("/api/v1/auth/refresh/", {}, format="json", HTTP_X_CLIENT="web")
        assert response.status_code == 422
        assert response.data["error"]["code"] == "validation_failed"
        assert response.data["error"]["message"] == "Sign in again."
        assert response.data["error"]["details"] == {}

    def test_a_browser_with_an_invalid_refresh_cookie_is_refused_as_an_ended_session(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.cookies["danpahq_refresh"] = "not-a-real-refresh-token"
        response = client.post("/api/v1/auth/refresh/", {}, format="json", HTTP_X_CLIENT="web")

        assert response.status_code == 403
        assert response.data["error"]["code"] == "permission_denied"
        assert response.data["error"]["message"] == "Your session has ended. Sign in again."
