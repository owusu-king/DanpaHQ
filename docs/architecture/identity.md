# Identity and account state

One account per person, keyed on a phone number. Roles and capabilities are
additive on top of it; there is never a second account for a second
relationship with the platform.

## What each piece of state means

| Concept | Stored as | Means |
|---|---|---|
| authentication | short-lived access token + rotating refresh session | this request proves a live session |
| account status | `User.is_active`, `deactivated_at` | active, restricted or deactivated |
| registration state | derived from phone, `account_type`, name, password | how much of account creation is finished |
| account type | `User.account_type` | what someone said they came here to be at sign-up |
| phone verification | `is_phone_verified` + a dated `Verification` | control of the number, not legal identity |
| provider standing | `Verification(kind=provider, subject=user)` | may this account operate as a provider |
| property authority | `Verification(kind=property_authority, subject=property)` | may they act on *this* address |
| roles | active `UserRole` grants | coarse navigation hints, never object authority |
| relationships | domain rows (membership, assignment, occupancy) | which resources they may act on |

## The number identifies; the password authenticates

The phone number says *which account*. The password says *who is signing in*.
These were the same thing while sign-in was an OTP, which made whoever held the
SIM the owner of the account (ADR 0019).

OTP now has exactly two jobs: proving a number during registration, and
authorising a password reset. Proving a number does not open a finished account.

## An account begins when someone finishes asking for one

Proving a number is not joining. `POST /auth/verify/` returns a signed, expiring
**registration ticket** and creates nothing; the account is created inside the
same transaction that validates the registration form, and that call opens the
first session. Abandon the form — or fail its validation — and nothing was
written, so someone who changed their mind was never a member.

This replaced creating the row at the OTP step, which made everyone who tapped
through a code and thought better of it an account with no name and no password.

`registration_state` still runs:

```
phone_required → account_type_required → profile_required → password_required → complete
```

It now describes rows created before tickets existed. Those can still be
finished in place with a session, and the authentication layer refuses them
everywhere except reading their own state, finishing themselves, refreshing and
signing out.

## Verification is never a boolean

Every check is a dated, evidenced `Verification` with a kind, a decider, and an
expiry. Re-checking supersedes rather than overwrites, so what was believed in
March and why stays readable in December (ADR 0013).

Approving provider standing also records an identity verification, with its own
copy of the evidence: the reviewer examined a government ID, so the identity
question is answered, and the rest of the product reads records rather than
inferences.

## Related

- `authorization.md` — what each state permits
- `onboarding.md` — the journeys that produce these states
- `adr/0004`, `adr/0013`, `adr/0019` — phone identity, verification model, passwords
