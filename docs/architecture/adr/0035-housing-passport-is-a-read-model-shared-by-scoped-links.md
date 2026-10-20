# 35. The Housing Passport is a read model, shared by scoped links

**Status:** Accepted
**Date:** 2026-10-20

## Problem

A tenant needs to show a prospective provider their housing history: where they
have lived, how the agreements were made, how rent was paid, and whether their
identity was checked. That history already exists, spread across Tenancy, Lease,
the rent ledger and Trust verifications. It must be shown honestly (no score, no
invented records, absence never counted against anyone), only in the parts the
tenant chooses, and withdrawable at any moment.

## Decision

1. **`apps.passport` owns no housing facts.** `record.assemble()` reads the
   passport afresh from the owning domains on every request: eligible tenancies
   (live ones, and ended ones opened by an accepted agreement), their accepted
   leases, `rent.services.payment_record()`, `trust.services.trust_summary()`
   and property verification. No snapshot exists to drift or to outlive a
   correction or revocation.
2. **One vocabulary, decided on the server**: `verified` (checked by Danpa HQ or
   a payment provider), `confirmed` (agreed by both parties), `pending`,
   `disputed`, `unverified`, `expired`; payments with nothing recorded say so
   (`none`). Each record carries a `basis` sentence saying how it is known.
   Inspections and landlord references are not recorded yet, and every passport
   says that their absence means nothing.
3. **A share is a stored scope, not stored content.** `PassportShare` keeps the
   chosen sections (identity; specific tenancies; payment record; amounts,
   off by default), a lifetime of 1, 7 or 30 days, view counts and
   `revoked_at`. Opening a link re-checks expiry, revocation and the owner's
   account, then assembles the scoped view. The preview the tenant sees before
   sharing is the same function's output, rendered by the same component.
4. **Tokens are derived, never stored.** `token = HMAC-SHA256(PASSPORT_SHARE_PEPPER,
   salt)`; the row stores the salt and the token's SHA-256. Unlike ADR 0026's
   show-once access codes, the owner can copy a live link again — the point of
   the feature is sending it — while a database read alone yields no token.
   Rotating the pepper invalidates every live link.
5. **The token travels in the URL fragment and a POST body.**
   `/shared-passport#<token>` keeps it out of server logs and Referer headers;
   `POST /passport-shares/open/` ignores any credentials, is throttled per IP
   (fails closed), and answers `no-store`, `noindex`, `no-referrer`. Unknown and
   malformed tokens share one 404; expired and revoked links get distinct 410
   codes, because the holder already has the link and is owed a reason.
6. **Corrections reuse the support queue.** `PassportCorrection` opens a
   `SupportCase` (category by record type) and reads its state through
   `operations.services.support_case_states()`. While a review is open the
   record shows as disputed to the owner and to recipients; the tenant's words
   stay between them and Management. Source records change only through their
   own domains.
7. **Audit.** Creating, revoking and every view are audit entries with scope
   metadata and never the token or digest.

## Consequences

- No migration touches another domain; `passport` is listed as a domain module
  in the boundary test and reads others only at function scope.
- Contact details, document numbers, conversations, exact addresses and the
  provider's identity never enter the shared view (tested).
- Mobile has not been built yet; the API is the shared contract it will use.
- Property Passports and provider trust profiles can reuse the same
  scope-plus-derived-token pattern without changing this one.
