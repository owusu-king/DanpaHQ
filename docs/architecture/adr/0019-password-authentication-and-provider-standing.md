# ADR 0019: Password authentication, account types, and provider standing

**Status:** accepted, 17 August 2026. Supersedes the sign-in half of
[ADR 0010](0010-otp-authentication.md). Extends
[ADR 0016](0016-account-intent-and-resource-authorization.md) and
[ADR 0018](0018-account-and-property-verification-are-separate-gates.md).

## Context

Three things were true at once, and together they were a hole.

Sign-in was an OTP to the registered number, so **controlling the SIM was
controlling the account**. Roles were self-grantable — `POST /me/roles/` with
`landlord`, or simply choosing "I own or manage property" during onboarding,
both granted the landlord role outright. And the provider workspace was offered
on the strength of that role name.

So anyone who could receive one SMS could reach the provider interface, with no
check having been made about who they were or what they controlled. The
navigation was the only thing standing in the way, and navigation is not a
security boundary.

Underneath that was a modelling gap. There was no such thing as an approved
*provider*. `PropertyProviderApplication` was always about one property, and
`provider_readiness()` faked an account-level view by mixing the person's
identity check with whichever property application happened to be first. There
was nowhere to record "this person may operate here", so nothing could require
it.

## Decision

### The number identifies; a password authenticates

The phone number remains the identifier and remains how OTPs, invitations and
mobile money reach someone. It is no longer the credential. Sign-in is
`POST /auth/sign-in/` with a phone number and a password.

OTP keeps the two jobs it is actually good at: proving a number belongs to
whoever is holding it during registration, and authorising a password reset.
Proving a number no longer opens a session on a finished account — the
registration path refuses one and says to use the password instead.

Reset is three steps, and returns a token rather than a session:
`password-reset/` issues the code, `password-reset/verify/` exchanges the code
for a short-lived token authorising exactly one password change, and
`password-reset/complete/` sets the password and signs every existing session
out. A swapped SIM therefore reaches a password change that the real owner is
told about by SMS, not a silent read of the account.

Existing accounts have no usable password. They are told so specifically —
"this account was created before passwords, choose Forgot password" — rather
than receiving the generic failure, because the generic failure would leave them
locked out with no idea why. Every other failure mode stays generic, so the
endpoint cannot be used to test which numbers hold accounts.

### Registration is separate from onboarding

`registration_state` runs `phone_required → account_type_required →
profile_required → password_required → complete`. Until it is `complete`, the
account row exists only so registration has somewhere to write; the
authentication layer refuses it everywhere except reading its own state,
finishing itself, refreshing and signing out.

Registration collects the account type, name, date of birth, optional email and
password. `account_type` records what someone said they came here to be. It is a
starting point and a default workspace, never a grant — capabilities stay
additive on top of it, so the tenant who later lets out a room does not need a
second account.

### Provider standing is about the person; property authority is about the address

`VerificationKind.PROVIDER`, subject `user`, is the account-level decision:
*may this account operate as a provider at all*. It requires a current identity
check first — identity answers who someone is, this answers whether that person
may operate here, and folding the two together is how a per-property review
ended up standing in for both. It does not expire on a timer; ending it is a
revocation someone decides and records a reason for.

`PROPERTY_AUTHORITY`, subject `property`, keeps answering the separate question
of whether they control one particular address. The two are independent, so an
approved provider can hold an approved property A, a pending property B and a
rejected property C, and a rejected property review never touches their account.

### The backend decides; clients render

`GET /me/` carries `capabilities`:

```json
{
  "account_type": "provider",
  "registration_state": "complete",
  "phone_verified": true,
  "provider": {
    "exists": true,
    "verification_status": "pending",
    "workspace_access": false,
    "private_inventory_access": true
  },
  "tenant": { "workspace_access": false }
}
```

`private_inventory_access` is separate from `workspace_access` on purpose. A
declared provider may set up buildings and units while the review is
outstanding, because nothing there reaches a tenant or the public — that is the
progressive-inventory position of ADR 0016, kept. What waits for approval is the
workspace that acts on other people, and the verification screen stands in front
of it.

The role vocabulary survives as a navigation hint and nothing more. `landlord`
is granted by the backend when provider verification is approved and revoked
when it ends; `tenant` remains self-grantable, because everything behind it
either needs the other party's agreement or is reversible.

Crucially the gate is enforced in the domain, not only in routing: provider
standing joins phone and identity in the account-level requirement of
`property_capabilities`, so a rejected or revoked provider stops reaching
tenants through properties they had already created. Fixing this in the
navigation alone would have left the API open.

## Consequences

The specific hole is closed at three separate places that each used to open it:
`POST /me/roles/` no longer accepts provider roles, intent selection no longer
grants them, and entry routing no longer keys off a role name. Tests pin all
three, including the reverse direction — an approved authority document held by
an unidentified account still reaches nothing.

Every existing account gets an `account_type` inferred from its roles. Providers
who had already passed a property authority review are granted provider standing
automatically, because a human had already looked at their evidence and
approving them again would be theatre. Providers who only ever self-granted the
role lose provider navigation and rejoin the queue — that is the correction, not
a side effect. Their private inventory is untouched either way.

The cost we accept: everyone who signs in has to set a password once, through a
reset they did not ask for. That is a real and unpleasant migration for a user
base that has never needed one. We take it because the alternative is leaving
every account reachable by whoever holds the SIM next, and rental accounts carry
tenancy records and money.

Clients must now read `capabilities` rather than inferring from `account_type`
or role names. Web and mobile still need the welcome screen, anonymous browsing
entry, registration, password sign-in, reset and the provider verification
screen built against this contract; the backend is the source of truth for all
of it and will refuse anything a client gets wrong.
