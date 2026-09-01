# 26. Unit access codes are expiring hashed share credentials

> ADR 0029 later retired the direct invitation workflow. The access-code
> security decision remains current; comparisons with invitation tokens below
> describe the historical alternatives considered at the time.

**Status:** Accepted  
**Date:** 2026-08-21

## Problem

The existing Unit join code was a ten-character hexadecimal possession secret
stored in plaintext. Verification approval created it automatically, every
provider Unit read returned it forever, and the only lifecycle operation was
clearing it when Unit verification changed. There was no expiry, rotation,
revocation, dedicated throttling or durable credential version.

That design also blurred two different acquisition credentials. A Unit share
code is intentionally reusable and creates a pending request that a manager
must decide. A tenant invitation is one-recipient, phone-bound and drives an
explicit invitation decision. Treating either as the other would weaken both.

## Options considered

### Encrypt the raw code for continued display

Rejected. Continued readability makes a database plus application-secret
compromise disclose every live code and encourages clients to treat a standing
secret as ordinary Unit data. A provider can rotate when a new copy is needed.

### Reuse the invitation-token model

Rejected. Invitation tokens are recipient-bound acquisition decisions. A share
code proves possession only and can legitimately be used by multiple existing
tenants, with each resulting request still requiring manager approval.

### Store a hash and expose an explicit credential lifecycle

Chosen. It retains the existing manager-approved join-request workflow while
removing plaintext persistence and making every credential transition explicit.

## Decision

1. Only an active verified Unit whose parent Property is fully verified may
   create or use a private access code. Approval makes creation eligible; it
   does not create a secret automatically.
2. Generation uses 128 random bits and a `U-` presentation prefix identifying
   it as a Unit credential; hyphens and spaces are presentation-only during
   verification.
3. The raw code is returned exactly once by the create/rotate response. Normal
   Unit reads return only state, timestamps, version and allowed actions.
4. Persistence is an HMAC-SHA256 under a dedicated
   `UNIT_ACCESS_CODE_PEPPER`, plus issued, expires, revoked and monotonically
   increasing version fields. Production must supply the pepper separately.
5. Codes expire after `UNIT_ACCESS_CODE_TTL_DAYS` (30 by default). Rotation
   replaces the hash atomically, so the previous code fails immediately.
   Revocation preserves metadata and audit history.
6. Unit or Property verification loss, verification expiry, re-check and
   archive revoke affected codes. Re-verification never revives an old code.
7. Lookup and join-request endpoints have per-account and per-IP throttles and
   return the same not-found response for malformed, missing, expired, revoked
   and verification-ineligible codes.
8. The share code is not single-use. It creates no tenancy or occupancy; each
   request requires an authorized property manager's approval. Retired
   invitation tokens are not accepted by access-code endpoints.

## Migration impact

Migration `property.0013_harden_unit_access_codes` renames the existing column
in place, hashes every retained legacy code under the new pepper and gives it a
30-day compatibility expiry. It adds nullable lifecycle fields and a version;
it does not delete Unit, verification, join-request, tenancy, occupancy or audit
history. Existing readable codes continue to work during that bounded window
but cannot be recovered from the database afterward.

The deprecated response field `join_code` remains temporarily as always-null,
and the old request key remains a write-only alias, so installed clients fail
closed without receiving plaintext while they migrate to `access_code`.

## Security and operational impact

- Database disclosure alone does not reveal active codes.
- Pepper rotation invalidates current codes and therefore requires an explicit
  operational rotation plan if the secret changes.
- Audit entries record create/rotate/revoke reason, version and expiry without
  recording the raw code or hash.
- The generic failure contract and dual throttles reduce enumeration and
  online guessing without revealing whether a candidate once existed.

## Consequences

Providers cannot retrieve a forgotten active code. They rotate it and share the
new one, which immediately invalidates old copies. This is an intentional
security/operability trade: a readable forever-secret is not Unit metadata.
