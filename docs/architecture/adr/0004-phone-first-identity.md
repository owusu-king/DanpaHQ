# ADR 0004 — The phone number is the identity

**Status:** accepted · 2026-08 · Phase 0. Refined by
[ADR 0019](0019-password-authentication-and-provider-standing.md): the phone
number remains the *identifier* — it says which account — but it is no longer
the credential. A password says who is signing in.

## Context
A large share of the target users have no habitual email address, but everyone
renting has a phone number — and that number is also where mobile money lands.

## Decision
`AUTH_USER_MODEL` is a custom user keyed on a normalised E.164 phone number.
Email is optional and uniquely indexed only where present. Most accounts have no
usable password; OTP is the primary factor.

## Reasoning
`AUTH_USER_MODEL` cannot be changed after production data exists without a
migration nobody wants to write, so this lands in Phase 0 even though the sign-in
flow lands in Phase 1.

Normalisation is a correctness requirement, not formatting: without it,
`0241234567` and `+233241234567` are two rows and one person has two accounts,
which breaks rental history, which is the whole point.

## Known limitations, deliberately recorded
- **Shared and reassigned numbers.** Numbers change hands. Re-verification on a
  material action, and a re-registration flow that does not silently inherit the
  previous holder's data, are Phase 1 requirements.
- **Portability breaks prefix inference.** `guess_network()` returns the original
  NCA allocation and is marked `confident=False`. Payment routing must ask the
  provider. Encoding this in the type stops a future engineer treating the hint
  as fact.
- **SIM swap is a real attack here.** OTP alone must not authorise a payout or a
  bank-detail change; those need a second factor. Phase 5.
- Prefix allocations are data, in `apps/core/phone.py`, and are reviewed against
  the NCA numbering plan rather than remembered.
