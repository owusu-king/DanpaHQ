# ADR 0012 — Short access tokens, rotating refresh tokens, reuse detection

**Status:** accepted · 2026-08 · Phase 1

## Decision
- **Access token:** a signed payload (HMAC-SHA256, version-prefixed), 15 minutes,
  validated with no database read. Carries subject, session id, roles and
  phone-verified state.
- **Refresh token:** 256 bits of entropy, 30 days, stored only as a SHA-256 hash,
  **rotated on every use**, grouped into a family.
- **Reuse detection:** presenting a rotated token revokes the entire family.
- **One live refresh session per installation:** a client-generated random
  installation id identifies a browser profile or native installation. Signing
  in again on that installation revokes its older token family before opening
  the new one; sessions on genuinely different devices remain independent.

## Reasoning

**Not JWT.** JWT's `alg` header is a well-known footgun — the `none` algorithm,
and confusion between HMAC and RSA verification. This system needs exactly one
algorithm with no negotiation, so it uses a version-prefixed format that offers
a rotation path without importing that complexity.

**Stateless access tokens** save a database round trip on every request. On these
networks the database is the cheap part; the trade is 15 minutes of staleness on
a revoked role, which we close by signing sessions out when a role is revoked.

**Rotation makes theft detectable.** A stolen refresh token used after the real
device has rotated presents the same token twice. We cannot distinguish theft
from a client that failed mid-rotation, so we treat it as theft: revoke the
family, sign everyone out, and say why. Inconveniencing a real user beats leaving
an attacker with a live session.

**Single-flight refresh on both clients.** Two concurrent rotations would look
exactly like reuse and sign the user out spuriously — a self-inflicted outage on
a flaky connection. Both clients share one in-flight promise.

**Refresh bypasses access-token lookup.** The refresh token is the credential
for `/auth/refresh/`. A native refresh request must not ask the shared API client
for a bearer token: bearer lookup starts refresh, which would make the shared
single-flight promise wait on itself indefinitely.

## Consequences
- Revocation is not instant for access tokens. Anything that must be immediate
  (`require_live_session`) checks the session explicitly; everything in Phase 5
  that touches money will use it.
- Clients must handle rotation correctly. A client that loses the new token
  locks the user out until they sign in again.
- Native refresh failures preserve their meaning. A server refusal clears the
  secure session; an unavailable network propagates as unavailable and retains
  the refresh token plus the last secure identity snapshot. It is never turned
  into an empty bearer token and retried as an anonymous protected request.
- Tokens are stored in memory on web and in the Keychain/Keystore on mobile,
  never in `localStorage`.
- The web installation id is stored in `localStorage`, but it is public,
  randomly generated metadata—not an authentication or refresh credential.
  It enables useful device labels and prevents every password sign-in from
  appearing as a new “Unknown device”.
- Historical session rows are revoked rather than deleted. During rollout, the
  next refresh attaches a current device-less web session to its installation
  and retires the older indistinguishable legacy sessions.
