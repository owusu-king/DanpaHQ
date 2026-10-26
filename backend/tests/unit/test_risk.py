"""SIM-swap and account-takeover risk rules."""

from apps.identity.risk import (
    SECURITY_HOLD_HOURS,
    RiskLevel,
    RiskSignals,
    SensitiveAction,
    assess,
    requirement_for,
)


class TestSimSwapHold:
    def test_recent_sim_change_blocks_money_movement(self):
        assessment = assess(RiskSignals(hours_since_sim_change_reported=2))
        assert assessment.level is RiskLevel.HIGH
        assert assessment.blocks_money_movement
        assert requirement_for(SensitiveAction.WITHDRAW_FUNDS, assessment) == "hold"

    def test_recent_phone_change_blocks_money_movement(self):
        assessment = assess(RiskSignals(hours_since_phone_change=1))
        assert assessment.blocks_money_movement

    def test_the_hold_counts_down_rather_than_being_permanent(self):
        assessment = assess(RiskSignals(hours_since_phone_change=48))
        assert round(assessment.hold_remaining_hours) == SECURITY_HOLD_HOURS - 48

    def test_an_old_phone_change_no_longer_holds(self):
        assessment = assess(RiskSignals(hours_since_phone_change=SECURITY_HOLD_HOURS + 1))
        assert not assessment.blocks_money_movement

    def test_reading_is_not_blocked_during_a_hold(self):
        """A held account is not a locked account. The user can still use the
        product; only irreversible money movement waits."""
        assessment = assess(RiskSignals(hours_since_phone_change=1))
        assert requirement_for(SensitiveAction.GRANT_ROLE, assessment) == "step_up"

    def test_the_reason_is_explainable_to_the_user(self):
        assessment = assess(RiskSignals(hours_since_phone_change=1))
        assert assessment.reasons
        assert all(reason.endswith(".") for reason in assessment.reasons)


class TestElevatedSignals:
    def test_a_new_device_raises_risk_without_holding(self):
        assessment = assess(RiskSignals(device_is_new=True))
        assert assessment.level is RiskLevel.ELEVATED
        assert not assessment.blocks_money_movement

    def test_repeated_failures_raise_risk(self):
        assert assess(RiskSignals(failed_verifications_last_day=3)).level is RiskLevel.ELEVATED

    def test_a_quiet_familiar_account_is_normal(self):
        assessment = assess(RiskSignals(hours_since_device_first_seen=1000))
        assert assessment.level is RiskLevel.NORMAL
        assert assessment.reasons == ()


class TestStepUp:
    def test_payout_changes_always_step_up_even_when_calm(self):
        calm = assess(RiskSignals(hours_since_device_first_seen=1000))
        assert requirement_for(SensitiveAction.ADD_PAYOUT_DESTINATION, calm) == "step_up"

    def test_changing_the_phone_number_always_steps_up(self):
        calm = assess(RiskSignals(hours_since_device_first_seen=1000))
        assert requirement_for(SensitiveAction.CHANGE_PHONE, calm) == "step_up"

    def test_ordinary_actions_are_not_gated_when_calm(self):
        calm = assess(RiskSignals(hours_since_device_first_seen=1000))
        assert requirement_for(SensitiveAction.GRANT_ROLE, calm) == "allow"
