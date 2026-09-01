# ADR 0017: Progressive property capabilities

**Status:** accepted, 15 August 2026. The capability matrix below is superseded
by [ADR 0018](0018-account-and-property-verification-are-separate-gates.md),
which separates account verification from property authority. The rest of this
decision — private creation as an unverified claim, per-actor capabilities
recomputed at the moment of action — still stands.

## Decision

Treat private property creation as an unverified operational claim. Store
`created_by` separately and leave verified ownership/management authority empty
until a current review supports it. Do not derive high-trust authorization from
the creator, the legacy owner shortcut or a generic private-management check.

Compute actor-specific capabilities for private inventory, tenant access,
leases, payment collection and publication. Invitations, join approval and
leases require current phone, identity and property-specific authority.
Provider-side payment receiving additionally requires a current bank or mobile
money account verification. Publication keeps its separate listing moderation
gate.

## Consequences

Users can immediately create private properties, buildings, units, rooms, beds,
photos, expenses and draft listings. None of those actions imply verified
ownership, create a public trust badge or expose inventory through discovery.
Verification revocation immediately disables dependent actions because every
sensitive transition is checked server-side at execution time.
