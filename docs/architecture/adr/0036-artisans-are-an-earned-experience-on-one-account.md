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

## Phase 2: profiles, certificates and Discover (20 October 2026)

- **Discover** (`GET /artisans/`) lists approved, unsuspended artisans other than
  the person asking, filtered by trade and district, with a Certified filter.
  The one ordering rule is stated: artisans with a current verified certificate
  (in the chosen trade, when one is chosen) come first.
- **Electrical** lists only artisans with a current verified electrical
  certificate unless the request opts in (`show_uncertified`), and reports how
  many it held back so the choice is informed. A certificate in another trade
  says nothing about wiring.
- **A listing or profile** carries facts only — ID checked, certificates and
  their status, jobs completed here, reviews — and never a phone number, an
  address or a certificate's file. Customers reach an artisan by inviting a
  quote (Phase 3), which Danpa HQ records.
- **Certificates** are checked by Management (`DECIDE_VERIFICATIONS`): verified
  with the date, or not accepted with a note the artisan reads. A declined
  certificate is never shown publicly. Describing a certificate differently
  clears its check. Status is computed, so expiry needs no sweep.
- **Profile editing** (`PUT /me/artisan/profile/`) is for approved artisans,
  suspended included, and starts no new review; a suspended artisan is not
  listed, so nobody sees an edit until they are reinstated.
- **One entry point**: web's top bar opens an Artisans sheet (Find, Requests,
  Records) over the current page, from a button or `openArtisans()`; mobile
  reaches the same from the Services tile (tenants) and More (providers) — a
  modal at first, pushed pages since Phase 3. Requests and Records fill in with
  Phases 3–5.

## Phase 3: quotes, revisions and assignment on maintenance (20 October 2026)

- **No parallel record.** `QuoteInvitation` and `Quote` hold only who was asked
  and what each quote said. The maintenance request stays the record: approving
  a quote sets two nullable fields on it (`assigned_artisan`, `assigned_quote`)
  and writes an `ASSIGNED` event naming the approver, the artisan and the price.
  Work waiting to start moves to in progress; no status was added.
- **Who may act.** Anyone who runs the property invites up to three artisans;
  a tenant may suggest one, which the landlord sends on or not. Only the payer
  approves (`organization.services.may_approve_spending`: owner, Portfolio
  owner or administrator, assigned Property Manager) — narrower than who runs
  the repair, and never platform staff. A suspended artisan cannot quote, and a
  quote sent before a suspension cannot be approved after it.
- **Extra cost is a revised quote.** Only the assigned artisan sends one, with a
  reason; it changes nothing until the payer approves it, when it becomes the
  price on record (`REVISION_APPROVED` event) and the previous one is marked
  superseded. A declined revision leaves the price on record.
- **The privacy unlock** (`artisan.work`). An invited artisan reads the problem,
  its photograph and the area (locality, district, region). The address, the
  unit, the tenant's name and phone, the approver and the history open only on
  the request they were assigned to. The tenant reads who is doing the work and
  never the price.
- **Advice, not escrow.** Wherever a payer approves a price the app says: pay
  after the work is confirmed done, or a small deposit at most. Approval asks
  once more before it commits.
- **Migrations** add two tables and three nullable columns on
  `maintenance_request`; existing requests are untouched.
- **Mobile** Find Artisans is a pushed page and each profile its own page
  (owner, 2026-10-20), reached from Menu, More, Services and a repair.
