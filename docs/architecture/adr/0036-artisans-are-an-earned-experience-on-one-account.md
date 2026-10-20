# ADR 0036: Artisans are an earned experience on one account

**Status:** accepted, 20 October 2026. Phase 1 of the artisan network.

## Context

Danpa HQ is adding tradespeople — plumbers, electricians, carpenters — who quote
for and carry out work for tenants and property providers. The owner's rules:
no separate app, no second account, no parallel maintenance lifecycle, and an
experience that is earned rather than chosen. ADR 0020 already separates which
experience somebody is in from what they may do there; this extends it with a
third experience.

## Decision

1. **An application is a trust verification.** `VerificationKind.ARTISAN` on the
   person, reviewed in the same Management queue as provider standing, with the
   same evidence rules (immutable, checksummed, claimable). Its status *is* the
   application's status; `apps.artisan` copies none of it. Approval also records
   the identity check when the application carried a government ID, through the
   same `record_identity_from_review` the provider decision uses. A person
   Danpa HQ already identified is not asked for their ID again.
2. **Suspension is a reversible field, not a verification outcome.**
   `ArtisanProfile.suspended_at` pauses an approved artisan: `can_quote` closes
   at once, `workspace_access` stays open, and no record is removed. Lifting it
   restores new work. Revocation remains the trust domain's permanent ending.
3. **The experience appears only on approval.** `artisan` joins
   `available_workspaces` when the application is approved (suspended
   included). `POST /me/workspace/` refuses it before then with
   `NOT_AN_ARTISAN`, and the onboarding intent endpoint cannot select it.
   Applying and approval never move anybody: an applicant stays in the
   experience they were in.
4. **Every action that starts new work asks `require_working_artisan`**, read
   live from the verification and the profile. Clients render from
   `capabilities.artisan`; hiding a tab is a courtesy.
5. **Four places only.** Web adds an artisan rail (Home, Requests, Jobs, My
   Profile); mobile adds `(artisan-tabs)` with the same four, guarded by the
   gate as the provider tabs are. Route names carry an `artisan-` prefix so no
   tab shares an address with the renter's.
6. **Facts, not scores.** Profiles state ID checked, certificate status, jobs
   completed on Danpa HQ and reviews. No label says trusted, guaranteed or
   payment protected. Certificates are optional for every trade, and a
   certificate's status (provided, verified, expired) is computed from its dates
   so an expired one loses its badge without a sweep.

## Consequences

- Migrations are additive: three new tables, and choice additions on
  `trust_verification`, `files_storedfile` and `identity_user_intent` that compile
  to no SQL.
- Quotes, assignment on maintenance requests, direct jobs (for tenants *and*
  providers, with no property or maintenance link), completion and reviews build
  on this in later phases; none of them adds a status to maintenance.
- A notification topic, "Artisan work", lets a person mute these alerts;
  decisions on the application are important and also go by SMS.
