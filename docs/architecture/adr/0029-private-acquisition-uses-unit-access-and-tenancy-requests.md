# ADR 0029 — Private acquisition uses Unit access and tenancy requests

**Status:** Accepted  
**Date:** 2026-08-23

## Decision

Rooomly has one active private tenant-acquisition lifecycle:

`Verified Unit → access code → private Unit review → tenancy request → provider
decision → lease offer → tenant acceptance → tenancy/occupancy`.

Direct prospective/existing-tenant invitations are retired. New invitations
cannot be created or decided, and an accepted historical invitation cannot
authorize a new lease. The compatibility endpoints return HTTP 410 with the
replacement path so installed clients fail explicitly.

## Historical data

`PropertyInvitation`, its applied migrations, linked leases and audit/outbox
history remain intact. A data migration changes open `pending` invitations to
`revoked`; it deletes no row. Authorized providers may still read historical
invitations, but there is no active provider or tenant invitation UI.

## Consequences

- Every new private lease names an approved `PropertyJoinRequest` for the exact
  Unit or Bed.
- Provider approval creates no Tenancy or Occupancy.
- Lease acceptance remains the activation boundary and can later pause for a
  required-payment confirmation without changing acquisition.
- Older clients cannot bypass the request step through invitation creation,
  token acceptance or `invitation_id` lease drafting.
