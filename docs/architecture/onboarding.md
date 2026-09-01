# Onboarding

The welcome screen offers three journeys. Choosing one is a **context** choice —
it decides which experience someone is shown, never what they are allowed to do.

```
                        WELCOME
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
  Find a property     I'm a tenant     I own/manage property
        │                  │                  │
        ▼                  ▼                  ▼
   browse, no          sign in           sign in
    account              │                  │
        │                ▼                  ▼
        │          tenant space      provider standing?
        │                             ├─ approved → provider workspace
        │                             └─ otherwise → verification screen
        ▼
  anonymous until an action needs an account
```

## Find a property

Anonymous. No session, no tenant role, no tabs. Authentication is required only
at an action that creates an obligation — applying, asking to view, saving.
Browsing must never quietly make someone a tenant.

## Registration

Separate from onboarding, and the only path to an account:

```
phone → OTP → account type → name, date of birth, email (optional), password
```

Signing up with a number that already has an account is refused **at the number**
with `409 ACCOUNT_EXISTS`, before any code is sent, and the client offers
sign-in instead.

Account type is a starting point, not a grant. Choosing "property provider"
opens the provider journey; it does not open the provider workspace.

## Provider onboarding

```
register as provider → submit one government ID → PENDING_REVIEW → approved → workspace
```

One submission, one review, one decision. Identity is an *input* to the provider
decision, not a gate in front of it — requiring identity first meant uploading
the same card twice, in order, with nowhere to do the first step.

While a review is outstanding the person sees where it stands, not an empty
workspace. Property creation waits for approval (ADR 0018).

## Tenant and provider

Capabilities are additive on one account, but acquisition is asymmetric:

- **Tenant** capability is granted on request, and by the acts that constitute
  being one — applying, asking to view. Everything behind it needs the other
  party's agreement, so granting it costs nobody anything.
- **Provider** capability comes only from an approved verification. A tenant
  account asking for the provider experience is refused with `403 NOT_A_PROVIDER`
  and offered its tenant space or a way out. Becoming a provider starts at
  sign-up.

## Related

- `navigation.md` — where each state lands
- `authorization.md` — what each capability permits
- `adr/0018`, `adr/0019`, `adr/0020`
