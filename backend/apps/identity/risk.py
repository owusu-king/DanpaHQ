"""Account-takeover risk rules, in particular SIM swap.

Why this file exists: in Ghana the phone number is the credential *and* the
payment rail. If an attacker convinces a network to reissue a SIM, an OTP-only
system hands them the account and the money in it. That is not a hypothetical -
it is the standard attack against phone-first fintech across West Africa.

The response is not to abandon OTP. It is to make OTP sufficient for *reading*
and insufficient for *irreversible money movement* when the signals look fresh.

Signals we can see ourselves, without any provider integration:

* the account's phone number changed recently
* this device has never been seen before
* the previous session was signed out from a different device
* a payout destination changed recently

Signals we cannot see yet, and must not pretend to: the network's own SIM-swap
date. Ghanaian operators expose this through aggregator APIs; the adapter
interface is defined in Phase 5, and until then `sim_change_reported_at` stays
`None` and the rules degrade to the signals above.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

#: How long after a phone or SIM change irreversible money movement is held.
#: Long enough that a real owner notices the SMS and calls; short enough that a
#: legitimate user who changed phones is not stuck for a week.
SECURITY_HOLD_HOURS = 72

#: A device must be seen for this long before it counts as familiar.
DEVICE_TRUST_HOURS = 24


class RiskLevel(StrEnum):
    NORMAL = "normal"
    ELEVATED = "elevated"
    HIGH = "high"


class SensitiveAction(StrEnum):
    CHANGE_PHONE = "change_phone"
    ADD_PAYOUT_DESTINATION = "add_payout_destination"
    WITHDRAW_FUNDS = "withdraw_funds"
    CHANGE_BANK_DETAILS = "change_bank_details"
    DELETE_ACCOUNT = "delete_account"
    GRANT_ROLE = "grant_role"


@dataclass(frozen=True, slots=True)
class RiskSignals:
    hours_since_phone_change: float | None = None
    hours_since_sim_change_reported: float | None = None
    hours_since_device_first_seen: float | None = None
    device_is_new: bool = False
    hours_since_payout_change: float | None = None
    failed_verifications_last_day: int = 0


@dataclass(frozen=True, slots=True)
class RiskAssessment:
    level: RiskLevel
    reasons: tuple[str, ...]
    hold_remaining_hours: float

    @property
    def blocks_money_movement(self) -> bool:
        return self.level is RiskLevel.HIGH


def assess(signals: RiskSignals) -> RiskAssessment:
    reasons: list[str] = []
    hold = 0.0

    for hours, reason in (
        (signals.hours_since_sim_change_reported, "The SIM on this number changed recently."),
        (signals.hours_since_phone_change, "The phone number on this account changed recently."),
    ):
        if hours is not None and hours < SECURITY_HOLD_HOURS:
            reasons.append(reason)
            hold = max(hold, SECURITY_HOLD_HOURS - hours)

    if hold > 0:
        return RiskAssessment(RiskLevel.HIGH, tuple(reasons), hold)

    if signals.device_is_new or (
        signals.hours_since_device_first_seen is not None
        and signals.hours_since_device_first_seen < DEVICE_TRUST_HOURS
    ):
        reasons.append("This device is new to the account.")

    if signals.hours_since_payout_change is not None and signals.hours_since_payout_change < 24:
        reasons.append("The payout destination changed in the last day.")

    if signals.failed_verifications_last_day >= 3:
        reasons.append("There have been several failed sign-in attempts today.")

    return RiskAssessment(RiskLevel.ELEVATED if reasons else RiskLevel.NORMAL, tuple(reasons), 0.0)


#: Actions that always need a fresh factor, whatever the risk level. Re-entering
#: an OTP proves the person holding the session still holds the number *now*,
#: which is what a stolen or borrowed unlocked phone does not.
ALWAYS_STEP_UP = frozenset(
    {
        SensitiveAction.CHANGE_PHONE,
        SensitiveAction.ADD_PAYOUT_DESTINATION,
        SensitiveAction.CHANGE_BANK_DETAILS,
        SensitiveAction.WITHDRAW_FUNDS,
        SensitiveAction.DELETE_ACCOUNT,
    }
)

#: Actions held entirely during a security hold, rather than merely stepped up.
HELD_DURING_SECURITY_HOLD = frozenset(
    {
        SensitiveAction.ADD_PAYOUT_DESTINATION,
        SensitiveAction.CHANGE_BANK_DETAILS,
        SensitiveAction.WITHDRAW_FUNDS,
    }
)


def requirement_for(action: SensitiveAction, assessment: RiskAssessment) -> str:
    """Return ``allow``, ``step_up`` or ``hold`` for an action under this risk."""
    if assessment.blocks_money_movement and action in HELD_DURING_SECURITY_HOLD:
        return "hold"
    if action in ALWAYS_STEP_UP or assessment.level is not RiskLevel.NORMAL:
        return "step_up"
    return "allow"
