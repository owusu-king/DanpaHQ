# ADR 0010 — OTP as the primary factor, and what it is not enough for

**Status:** accepted · 2026-08 · Phase 1. The sign-in half is superseded by
[ADR 0019](0019-password-authentication-and-provider-standing.md): a password
authenticates, and an OTP no longer opens a session on a finished account. What
this ADR says about *what an OTP is not enough for* stands, and is in fact the
reasoning ADR 0019 follows to its conclusion. The OTP mechanics below — peppered
hashing, attempt caps, purpose binding, per-number and per-IP limits — are
unchanged and still govern registration and password recovery.

## Context
The phone number is the credential (ADR 0004). The question is what proves
control of it, and what that proof is sufficient to authorise.

## Decision
A six-digit SMS code is the primary authentication factor. Most accounts have no
password at all. The code is peppered-hashed, five-attempt capped, five-minute
lived, bound to a purpose, and rate-limited per number *and* per IP.

OTP alone authorises reading and ordinary use. It does **not** authorise
irreversible money movement when risk signals are fresh, and never authorises a
payout or bank-detail change without a *new* code (step-up).

## Reasoning
Passwords in this market mean shared passwords, written passwords, and a reset
flow that goes through the same SMS channel anyway — so a password would add
friction without adding a factor.

The parameters are not arbitrary:

- **Five attempts** against a million-wide space. More attempts multiply an
  attacker's odds; fewer punishes someone typing on a cracked screen.
- **Five minutes.** Long enough for a delayed SMS on a congested network, short
  enough that a code glimpsed on a lock screen goes stale.
- **Resend replaces the code on the same challenge and keeps the attempt
  counter.** Otherwise "five guesses, then resend" is an unlimited guessing
  budget — this is the bug that quietly defeats most OTP implementations.
- **Two rate limits with the same error message.** Different messages would tell
  an attacker which limit they hit.

## Consequences
- SMS delivery is now a hard dependency and a real cost. Delivery rates vary by
  network, and no provider is integrated yet, so none is claimed to work.
- Users who lose their number lose their account. A recovery path with identity
  verification is needed before that becomes common, and is not built.
- Code interception (SS7, SIM swap, a shoulder-surfed lock screen) is a real
  residual risk. It is mitigated by step-up and the security hold in ADR 0011,
  not eliminated.
