# ADR 0015: Canonical session context and persisted onboarding

**Status:** accepted, 14 August 2026.

## Decision

Persist onboarding completion independently of authentication. Expand `/me/`
to own account/onboarding/context/routing truth. Keep active context as a
validated client-local preference and primary role as its backend default, not
authorization. OTP verification creates identity/session/profile but grants no
role; onboarding performs the first explicit grant.

## Consequences

Interrupted onboarding resumes consistently on web and mobile. Clients share
one routing vocabulary. Multi-role users retain one account and may use different
contexts on different devices. Backend object authorization remains unchanged.
Existing accounts with an active role are backfilled complete.

