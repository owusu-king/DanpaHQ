"""OTP policy: the rules, separated from the storage.

Kept framework-free and pure so the decisions can be tested exhaustively without
a database. Every function takes the current state and returns a decision; no
function reads a clock or a model.

The threat model this encodes:

* **Brute force.** A six-digit code is a million guesses, which is nothing to a
  script. Verify attempts are capped per challenge, and the challenge dies rather
  than reissuing.
* **SMS pumping.** Each SMS costs money and each resend is an attack surface.
  Resends escalate in cost to the attacker (60s, then 120s, then 300s) and are
  capped per hour per number and per IP.
* **Enumeration.** The API must not reveal whether a number has an account.
  Start-sign-in returns the same shape either way; `is_registered` is used only
  to decide what the *next screen* says after a successful verification.
* **Lockout as denial of service.** Locking a number out entirely lets an
  attacker deny a real user their account by burning attempts. So lockout is
  short (15 minutes) and per-challenge attempts matter more than per-number ones.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

CODE_LENGTH = 6
CODE_TTL_SECONDS = 300  # 5 minutes: long enough for a delayed SMS, short enough to matter
MAX_VERIFY_ATTEMPTS = 5
MAX_SENDS_PER_HOUR_PER_PHONE = 5
MAX_SENDS_PER_HOUR_PER_IP = 20
LOCKOUT_SECONDS = 900
RESEND_BACKOFF_SECONDS = (60, 120, 300)


class Decision(StrEnum):
    ALLOW = "allow"
    RATE_LIMITED = "rate_limited"
    COOLDOWN = "cooldown"
    LOCKED_OUT = "locked_out"
    EXPIRED = "expired"
    TOO_MANY_ATTEMPTS = "too_many_attempts"
    INCORRECT = "incorrect"


@dataclass(frozen=True, slots=True)
class SendDecision:
    decision: Decision
    retry_after_seconds: int = 0
    message: str = ""


@dataclass(frozen=True, slots=True)
class VerifyDecision:
    decision: Decision
    attempts_remaining: int = 0
    message: str = ""


def resend_delay(send_count: int) -> int:
    """Seconds a user must wait before the next code. Escalates, then plateaus."""
    if send_count <= 0:
        return 0
    index = min(send_count - 1, len(RESEND_BACKOFF_SECONDS) - 1)
    return RESEND_BACKOFF_SECONDS[index]


def may_send(
    *,
    sends_last_hour_phone: int,
    sends_last_hour_ip: int,
    seconds_since_last_send: int | None,
    send_count_this_session: int,
    locked_out_seconds_remaining: int = 0,
) -> SendDecision:
    if locked_out_seconds_remaining > 0:
        return SendDecision(
            Decision.LOCKED_OUT,
            locked_out_seconds_remaining,
            "Too many incorrect codes. Try again in a few minutes.",
        )

    if sends_last_hour_phone >= MAX_SENDS_PER_HOUR_PER_PHONE:
        return SendDecision(
            Decision.RATE_LIMITED,
            3600,
            "You have asked for too many codes. Try again in an hour, or contact support.",
        )

    if sends_last_hour_ip >= MAX_SENDS_PER_HOUR_PER_IP:
        # Deliberately the same message as the per-phone limit: a message that
        # distinguishes them tells an attacker which limit they hit.
        return SendDecision(
            Decision.RATE_LIMITED,
            3600,
            "You have asked for too many codes. Try again in an hour, or contact support.",
        )

    required = resend_delay(send_count_this_session)
    if seconds_since_last_send is not None and seconds_since_last_send < required:
        wait = required - seconds_since_last_send
        return SendDecision(Decision.COOLDOWN, wait, f"Wait {wait} seconds before asking again.")

    return SendDecision(Decision.ALLOW)


def may_verify(
    *,
    challenge_age_seconds: int,
    attempts_used: int,
    already_consumed: bool,
) -> VerifyDecision:
    """Whether a verification attempt may even be made. Correctness is separate."""
    if already_consumed:
        return VerifyDecision(
            Decision.EXPIRED, 0, "That code has already been used. Ask for a new one."
        )
    if challenge_age_seconds >= CODE_TTL_SECONDS:
        return VerifyDecision(Decision.EXPIRED, 0, "That code has expired. Ask for a new one.")
    if attempts_used >= MAX_VERIFY_ATTEMPTS:
        return VerifyDecision(
            Decision.TOO_MANY_ATTEMPTS, 0, "Too many incorrect codes. Ask for a new one."
        )
    return VerifyDecision(Decision.ALLOW, MAX_VERIFY_ATTEMPTS - attempts_used)


def after_incorrect(attempts_used: int) -> VerifyDecision:
    """The message shown after a wrong code.

    Counting down out loud is a deliberate choice. A person mistyping a code on a
    cracked screen deserves to know they have two tries left; an attacker learns
    nothing they could not measure anyway.
    """
    remaining = max(MAX_VERIFY_ATTEMPTS - attempts_used, 0)
    if remaining == 0:
        return VerifyDecision(
            Decision.TOO_MANY_ATTEMPTS, 0, "Too many incorrect codes. Ask for a new one."
        )
    if remaining == 1:
        return VerifyDecision(Decision.INCORRECT, 1, "That code is not right. One more try.")
    return VerifyDecision(
        Decision.INCORRECT, remaining, f"That code is not right. {remaining} tries left."
    )
