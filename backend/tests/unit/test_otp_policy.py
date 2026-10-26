"""OTP policy. Pure decisions, so every branch is covered directly."""

from apps.identity import otp_policy
from apps.identity.otp_policy import Decision, after_incorrect, may_send, may_verify, resend_delay


class TestResendBackoff:
    def test_first_send_is_immediate(self):
        assert resend_delay(0) == 0

    def test_backoff_escalates_then_plateaus(self):
        assert [resend_delay(n) for n in (1, 2, 3, 4, 10)] == [60, 120, 300, 300, 300]


class TestSendGate:
    def test_first_request_is_allowed(self):
        verdict = may_send(
            sends_last_hour_phone=0,
            sends_last_hour_ip=0,
            seconds_since_last_send=None,
            send_count_this_session=0,
        )
        assert verdict.decision is Decision.ALLOW

    def test_resend_inside_the_cooldown_is_refused(self):
        verdict = may_send(
            sends_last_hour_phone=1,
            sends_last_hour_ip=0,
            seconds_since_last_send=10,
            send_count_this_session=1,
        )
        assert verdict.decision is Decision.COOLDOWN
        assert verdict.retry_after_seconds == 50

    def test_resend_after_the_cooldown_is_allowed(self):
        verdict = may_send(
            sends_last_hour_phone=1,
            sends_last_hour_ip=0,
            seconds_since_last_send=61,
            send_count_this_session=1,
        )
        assert verdict.decision is Decision.ALLOW

    def test_hourly_cap_per_phone(self):
        verdict = may_send(
            sends_last_hour_phone=otp_policy.MAX_SENDS_PER_HOUR_PER_PHONE,
            sends_last_hour_ip=0,
            seconds_since_last_send=9999,
            send_count_this_session=1,
        )
        assert verdict.decision is Decision.RATE_LIMITED

    def test_hourly_cap_per_ip_catches_number_rotation(self):
        verdict = may_send(
            sends_last_hour_phone=0,
            sends_last_hour_ip=otp_policy.MAX_SENDS_PER_HOUR_PER_IP,
            seconds_since_last_send=None,
            send_count_this_session=0,
        )
        assert verdict.decision is Decision.RATE_LIMITED

    def test_the_two_rate_limits_are_indistinguishable_to_a_caller(self):
        """A different message would tell an attacker which limit they hit."""
        by_phone = may_send(
            sends_last_hour_phone=99,
            sends_last_hour_ip=0,
            seconds_since_last_send=9999,
            send_count_this_session=1,
        )
        by_ip = may_send(
            sends_last_hour_phone=0,
            sends_last_hour_ip=99,
            seconds_since_last_send=9999,
            send_count_this_session=1,
        )
        assert by_phone.message == by_ip.message

    def test_lockout_beats_everything_else(self):
        verdict = may_send(
            sends_last_hour_phone=0,
            sends_last_hour_ip=0,
            seconds_since_last_send=9999,
            send_count_this_session=0,
            locked_out_seconds_remaining=300,
        )
        assert verdict.decision is Decision.LOCKED_OUT


class TestVerifyGate:
    def test_fresh_challenge_may_be_attempted(self):
        assert (
            may_verify(challenge_age_seconds=10, attempts_used=0, already_consumed=False).decision
            is Decision.ALLOW
        )

    def test_expired_challenge_is_refused(self):
        assert (
            may_verify(
                challenge_age_seconds=otp_policy.CODE_TTL_SECONDS,
                attempts_used=0,
                already_consumed=False,
            ).decision
            is Decision.EXPIRED
        )

    def test_consumed_code_cannot_be_replayed(self):
        assert (
            may_verify(challenge_age_seconds=10, attempts_used=0, already_consumed=True).decision
            is Decision.EXPIRED
        )

    def test_attempts_are_capped(self):
        assert (
            may_verify(
                challenge_age_seconds=10,
                attempts_used=otp_policy.MAX_VERIFY_ATTEMPTS,
                already_consumed=False,
            ).decision
            is Decision.TOO_MANY_ATTEMPTS
        )

    def test_a_million_guesses_is_not_available(self):
        """The whole point: five attempts against a six-digit space."""
        assert otp_policy.MAX_VERIFY_ATTEMPTS < 10


class TestIncorrectMessaging:
    def test_countdown_is_shown_to_the_person(self):
        assert "2 tries left" in after_incorrect(3).message

    def test_last_try_is_phrased_clearly(self):
        assert after_incorrect(4).message.endswith("One more try.")

    def test_exhausted_attempts_direct_to_a_new_code(self):
        outcome = after_incorrect(otp_policy.MAX_VERIFY_ATTEMPTS)
        assert outcome.decision is Decision.TOO_MANY_ATTEMPTS
        assert outcome.attempts_remaining == 0
