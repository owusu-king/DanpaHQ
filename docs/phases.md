# Development phases

The concise roadmap for the whole project. `projectBible` (repository root) is
the standing brief and quality bar; this file is what is actually being built,
in what order, and why that order. Current state per phase lives in
`status.md`; reasoning behind decisions lives in `architecture/adr/`.

A phase is a **vertical slice**: domain, database, API, web, mobile, tests,
docs. Backend-only phases are allowed only where infrastructure genuinely
cannot be sliced.

---

## Completed

| Phase | Shipped |
|---|---|
| **0 — Foundation** | Money as integer minor units, UUIDv7, Ghana phone normalisation, digital addresses, audit + outbox, health checks, Django/Postgres/Redis/Celery, Next.js, Expo, shared design tokens, CI |
| **1 — Identity & trust** | Phone-first accounts, verification model (dated, evidenced, superseded), devices, sessions with reuse detection, profiles |
| **2 — Property & listings** | Properties, buildings, units, beds, addresses, amenities, media with virus scanning and presigned URLs, listing lifecycle with moderation, public search that fails closed |
| **3 — Rental workflows** | Viewing requests with contact release on confirmation, rental applications, leases, rent ledger, notifications |
| **3.5 — Stabilisation** | Authorization tightened to resource scope rather than global role names, property relationship boundaries corrected |
| **4 — Property operations** | Organizations with time-bounded memberships, private inventory before verification, Unit access-code tenancy requests, occupancies, permission-scoped provider Tenants, portfolio and Archive read models; legacy invitations retained as inactive history |
| **4.5 — Identity rebuild** | Passwords for sign-in (OTP demoted to registration and recovery), registration separated from onboarding with no account until it completes, provider standing as an account-level verification, workspace as context not capability, self-grant closed |
| **4.6 — Web portal** | Shared authenticated application shell, role-aware navigation, role-specific home, tenant Explore reusing the public listing implementation, collapsible sidebar, Account & Settings Archive, session resilience |

---

## Current work

**UI/UX refinement is proceeding one journey at a time alongside domain work.**
Provider Properties → Property → Unit and Provider Home have passed their
quality gates. Provider entry and Property-category contract inconsistencies
were repaired first: individual providers begin with a Property and receive a
personal Portfolio automatically, activities no longer remove valid categories,
and explicit business/team setup remains a separate Team path. Native Property
detail and Provider Tenants → Tenancy have passed user retesting. Payments is a
first-class provider destination on web and the legacy mobile `messages` route
was replaced by the canonical `tenants` route. Provider Viewings, Tenancy
Requests and Leases are complete; Leases is awaiting user testing and Provider
Rent is next. Native physical-device visual validation
remains unavailable in the current environment. The exact handoff and journey evidence are in
`docs/design/UI_UX_PRODUCT_DESIGN.md`.

**Payment Core foundation is current.** P5 Discovery, viewing requests and
applications is complete. Public search
over spaces keeps viewing requests and rental applications distinct. Web slot confirmation and the
participant-only exact-location release are complete. Public web application
submission, authentication continuation, confirmation and tenant/provider
status views are now complete. Tenant web and mobile lease review, acceptance
and decline now consume the frozen offer snapshot and existing lease
transitions. Private acquisition now has one active path: verified Unit access
code, tenancy request, provider decision, lease offer and tenant acceptance.
Legacy invitation creation/decision UI and services are retired, open rows are
revoked without deletion, and `invitation_id` cannot authorize a new lease.
Active/upcoming tenancies are database-required to carry an
activation lease; accepted leases pass through an explicit activation gate so
future payment confirmation can be inserted without rewriting acquisition.
Request idempotency now protects its high-impact creates and transitions across
Django, web, mobile and Management, including concurrent duplicate requests;
the protocol is now mandatory for payment-intent creation. Repair #10 is complete: the canonical isolated smoke test now
executes the current provider → Property → Unit → listing → viewing →
application → lease → Tenancy/Occupancy → rent-record path without bypassing
either verification gate. Repair #11 closed the remaining client gaps: mobile
providers can receive and decide viewings/applications, provider notifications
open the correct queues, web tenants can withdraw open applications, both
listing clients recognize existing requests, and web/mobile application claims
now capture the same context.

Repair batch FIX 3 now treats current Unit occupancy as a protection boundary.
Publication, viewing and tenancy requests fail closed, checked characteristics,
amenities, photographs and bed allocation cannot change, and archive/delete
remain blocked. Private entrance directions stay operationally editable. The
Unit row serializes occupancy activation against publication and request
creation so a concurrent request cannot slip through the state change.

Repair batch FIX 4 makes Bed allocation hostel-only. The canonical eligibility
rule is now `PropertyType.HOSTEL + RentableSpaceType.ROOM`, enforced in backend
policy/services and served to both clients. Non-hostel screens neither manage
nor request Bed data, Property type changes cannot strand existing Bed history,
and legacy invalid rows cannot enter acquisition, lease or occupancy paths.

Repair batch FIX 5 gives public Unit detail one gallery with Unit-primary
prominence and verified Property context. It references existing Unit, Listing
and immutable Property-condition evidence files, orders them by meaning,
deduplicates by file ID, and excludes sensitive, wrong-purpose or no-longer-
verified Property evidence. Web and mobile label the wider-Property images and
no longer render a disconnected second Property gallery.

Repair batch FIX 7 makes archival usable from provider Account & Settings on
web and mobile. A single authorized read model lists archived Properties and
Units without creating a parallel Archive domain. Restore is shared backend
policy: it refuses active dependents, archived parents, open review conflicts,
incompatible space categories and non-hostel bed inventory. Valid restoration
returns only the inventory record to work; listings stay withdrawn, access
codes stay revoked, verification remains current and audit history is kept.

Repair #12 has completed its plan review and first backend integrity slice.
`RentCharge` remains the obligation source; provider-neutral intents, signed
webhook processing, immutable transactions and ledger lines, receipts, pending
settlements, audit and outbox events now exist. Production checkout remains off
until a licensed PSP and tokenized payout-destination contract are selected and
sandbox-tested. Lease activation is deliberately unchanged until that rail is
operational. See ADR 0028.

---

## Next: Property → Rental → Tenancy

Ordered by dependency. Each is independently testable and shippable.

### P0.5 — Multi-tenancy correction + lifecycle policy  ✅ **done**
Shipped two things:

**The defect.** Both clients collapsed the occupancy list with
`find(active) ?? [0] ?? null`, so a tenant with two tenancies saw one. Replaced
by `GET /me/tenancies/`, a read model returning each tenancy whole. Tenant home
is a portfolio above one and a single panel at one; each tenancy has its own
route (`/tenancies/[id]`, mobile `(app)/tenancy`). The `currentOccupancy` and
`currentLease` helpers were deleted rather than left as a trap.

**The policy foundation** every later phase extends: `apps/core/policy.py`
(Decision, Blocker, enforce, permitted_actions) plus `property/policies.py` and
`lease/policies.py`. Archival over deletion, dependent-record blocking, reason
and confirmation requirements, per-property authorization, and
`permitted_actions` serialized so clients render rather than decide. ADR 0021.

**Deferred:** per-tenancy maintenance/notices/documents surfaces — the seams
are in, the features come with their own phases. Occupancy/invitation/listing
policies land with the phases that own them.

### P1 — Rentable space & allocation integrity  ✅ **done**
Allocation is a period, and double-letting is now impossible at the database
level.

**Shipped:**
- `btree_gist`, plus two `ExclusionConstraint`s over
  `daterange(starts_on, ends_on)` — one per unit, one per bed. Bounds are `[)`
  so a same-day handover is not a clash, and null bounds mean unbounded, which
  is what the domain already meant by "no recorded start" and "still running".
- `services.assert_space_is_free` for the whole-unit-versus-its-beds case,
  which cannot be one exclusion constraint: bed rows must conflict with a unit
  row on `unit` while not conflicting with each other on it. It runs first, so
  a clash is a sentence rather than an integrity error.
- Lease dates flow onto the allocation, so the constraints see a real period
  instead of two nulls that overlap everything.
- `Unit.space_type` (`SpaceType`) separate from `PropertyType`, with
  `WHOLE_PROPERTY`, `ROOM` and `BED_SPACE` — which `unit_type` could not
  express. Backfilled from `unit_type`; nothing was guessed into `room` or
  `bed_space`, because that is a claim only a provider can make.

**Moved to P7, deliberately:** `Lease.bed` and replacing
`lease_one_live_per_unit`. Leasing a bed is a lease-model change, P7 rewrites
that model for the executed-lease snapshot, and doing it now means migrating it
twice. Hostel *allocation* works today; hostel *leasing* lands with P7.

**Still deferred:** listing/publication changes (P4), evidence policy (P2),
campus-proximity computation (coordinates are preserved; the computation is
not built).

### P1.5 — Lifecycle authorization & state-transition policy
The deletion, archival and transition rules as backend policy: who may act,
when, what is preserved, what is recorded. Capability payload extended so
clients render permitted actions rather than deciding them. Reason capture and
audit on every consequential action.

Sits here because P2–P8 each add transitions, and they should land against an
existing policy rather than each inventing one.

**Depends on:** P1.

### P2 — Evidence policy engine  ✅ **done**
Replace the hardcoded evidence map with a policy resolved from property
category, space type and declared features. Verification screens read
requirements rather than hardcoding them.

Revised at P3/P4 (`POLICY_VERSION` `2026.08.3`): the *space* review became one
required overview plus two invited views. Revised again at `2026.08.4`: every
selected Unit amenity adds one required, named photograph. The property review
is unchanged, and bedroom/bathroom counts still do not multiply slots unless a
corresponding amenity is explicitly claimed. The remaining tradeoff is recorded
in `known-limitations.md`.

**Depends on:** P1 (space type is a policy input).

### P3 — Property & space verification lifecycle  ✅ **done**
Separate verification state from publication state. Draft work continues while
review is underway; trust gates block only the unsafe actions.

**Shipped:** the space's own vocabulary — `DRAFT → READY FOR SUBMISSION →
SUBMITTED → UNDER REVIEW → VERIFIED`, plus `CHANGES_REQUESTED`, `REJECTED`,
`SUSPENDED`, `EXPIRED` — served rather than derived by each client. It tells
apart the two pairs the old `condition_state` collapsed: work still to do from
work waiting on a button, and queued from actually being looked at.
`condition_state` stays alongside it, because an installed mobile build reads it.

Editing follows the state: open while the space is with the provider, closed
while a reviewer holds it, and fixed after approval — where changing it is
`request_recheck`, which supersedes the approval rather than editing under it.

**Sequential repairs #2 and #8:** space submission now waits for the unified
parent Property result, not authority alone. Draft work remains open. Private
Unit access codes are eligible only while both Property and Unit are verified;
they are created explicitly, disclosed once, stored as expiring peppered
hashes, rotated/revoked with audit history and rate-limited at lookup. They are
not tenant invitation tokens. See ADRs 0022 and 0026.

**Sequential repair #9:** harmful duplicate HTTP execution is now serialised and
replayed for selected application, viewing, invitation, lease and verification
mutations. Existing clients may omit the key; current web/mobile/Management
clients send it and retry only protected calls. See ADR 0027.

**Depends on:** P2.

### P4 — Publication & listing  ✅ **done**
Listing targets a rentable space rather than a unit. Publication becomes its
own axis, independent of verification and availability.

**Shipped:** three axes on the space's read model —
`verification` / `publication` / `availability` — rendered as three marks on
both clients, always all three. `availability` reads occupancy rather than the
listing: a room let privately is not available, advertisement or none.

**The defect this found.** `trust.gates.can_publish` has refused an unchecked
space since P3 and `publish_listing` never called it, so the rule blocking
publication on space verification existed as a paragraph and nowhere else — an
unchecked room could be advertised and merely queued for moderation. Enforced
now. Because a checked space needs no second opinion, publishing goes live
directly; moderation keeps `flag` and `suspend` over live listings.

`core.policy.enforce` was dropping a decision's blockers when it raised, so the
refusal said "this cannot be advertised yet" and named nothing. It now says what
is in the way, which is the half a person can act on.

**Also shipped:** `UnitMedia` — a space's own photographs, which are the same
photographs its check is decided on. One upload, two consequences. Amenities
gained `scope` and `space_types` so the picker is filtered server-side, and
`PropertyAmenity` gives the compound its own set. See ADR 0022.

**Depends on:** P1, P3.

### P5 — Discovery, viewing requests & applications ✅ **done**
Public search over spaces. Viewing request and application remain distinct.
Mostly already built — this phase reconciles them with P1/P4. Tenant web and
mobile can now complete offered viewing slots, and exact directions are served
only during a valid confirmed appointment to its participants. Physical
viewings are free and use one temporary hashed QR/six-digit credential pair:
confirmed → checked in → completed. A provider cannot record verified
attendance by completion alone; cancellation/reschedule invalidates the pair,
and post-viewing interest enters the canonical tenancy-request workflow. Public web
tenants can now apply from an active listing, see the advance shortfall before
submitting, return through sign-in or registration, and follow the application
status; providers receive the same application in their existing inbox.
Application uniqueness follows the Unit, not a replaceable Listing campaign;
submitted, under-review and accepted applications hold the gate until rejection
or tenant withdrawal. Provider and tenant decision surfaces now have web/mobile
parity for the implemented lifecycle, including cancellation/withdrawal,
expired-slot feedback, role-aware notification routing and explicit loading,
empty and error states.

**Depends on:** P4.

### P6 — Private access → tenancy request → lease offer ✅

**Delivered and simplified.** A verified Unit access code lets the tenant
review the private Unit and send a Unit/Bed tenancy request. Provider approval
authorizes a request-linked lease; tenant lease acceptance is the sole
activation point. Direct prospective/existing invitations are preserved only
as historical records and cannot create or authorize new lifecycle state.

**Depends on:** P1.

### P7 — Lease offer, acceptance & executed lease ✅

**Delivered.** `LeaseAgreement` freezes the terms when the offer is made — not
at activation, so the tenant accepts a hash that already exists rather than one
computed afterwards from a row that could have moved. `LeaseAcceptance` records
each party separately, because the two acceptances are different events by
different people, often days apart, and a dispute is usually about one of them.
`execution.verify()` answers both "have the stored terms been altered" and "did
each party accept these words", which fail for different reasons.

**No claim of a legally binding electronic signature.** `method` is a field
with one value so a formal provider can be added later as an additional record.
See `docs/known-limitations.md`.

Offered agreements are pending actions on tenant home in both clients, and the
web tenant rail links directly to Agreements. Notifications remain additive,
not the only way a tenant can find the decision screen.

Rent advance moved to `advance_policy.py`: configurable threshold and stance
(`allow` / `warn` / `block`), defaulting to `warn`. `Lease.exceeds_statutory_advance`
now defers to it, and the old `STATUTORY_ADVANCE_LIMIT_MONTHS` constant is
gone — two definitions of one threshold would have drifted the first time an
operator changed either. The notice wording is composed server-side so there is
one text to review; both clients now render it instead of each writing its own.

Bed-level leases land: `Lease.bed`, and `lease_one_live_per_unit` replaced by a
pair — one live lease per whole unit, one per bed. The cross-level case (a
whole-unit lease against the beds inside it) is not expressible as a unique
constraint either way round, so it lives in `services.assert_target_is_free`,
mirroring `occupancy.services.assert_space_is_free` deliberately: same rule,
one answer.

Also fixed on the way: letting one bed no longer closes the whole room's market
— it was rejecting applicants who may have been after the beds still free.

**Migration `lease.0002` is additive and reversible**: a nullable FK, two new
tables, and a constraint swap that is strictly more permissive than what it
replaced. Existing rows satisfy it unchanged.

**Depends on:** P1, P1.5, P6.

### P8 — Tenancy ✅

**Delivered.** `apps/tenancy` — its own app, deliberately. Rent, maintenance and
disputes are questions about the *relationship*, so putting the anchor inside
`occupancy` would have made every future one depend on the allocation, which is
exactly the coupling this phase exists to remove.

Three things were being conflated, and each is a different fact:

| Record | What it is | What it answers |
|---|---|---|
| `Lease` | the agreement | what was agreed, and by whom |
| `Occupancy` | the allocation | who is in this space, when |
| `Tenancy` | the relationship | everything that outlives both |

The distinction earns its keep at renewal. Three successive one-year leases on
one room are one tenancy, not three, and `ensure_tenancy` is find-then-create
so that when a renewal flow is built it lands on the existing relationship
rather than splitting the history in two.

`upcoming` is a real state: a tenancy agreed in July to start in September
exists in August and is simply not one anyone has moved into. Both clients now
say "from" rather than "since" for those, which they would otherwise have
described as having already begun.

**Many per tenant, enforced by absence.** No `current_tenancy` anywhere, in the
model or either client. The unique constraints say one person cannot hold the
same space twice — deliberately *not* that two people cannot hold it, which is
the occupancy exclusion constraints' job and would be a second place to get it
wrong.

`/me/tenancies/` now reads the real record. The response shape is unchanged
from when it was a read model over occupancies, which is why P0.5 named its
fields for the tenancy at the time; neither client needed restructuring.

**Seams created, nothing built on them.** `apps.rent` still hangs off `Lease`
and was left alone — moving it is its own phase with its own migration.

#### The P7 defect this found

`ensure_for_lease` matched and created occupancies on `(user, unit)`, ignoring
`bed`. So accepting a lease for one bed allocated **the whole room** — P7 made
four bed leases expressible, but the first acceptance took the unit and the
other three could not be honoured. A four-bed hostel still held one tenant.
Fixed, and pinned by `test_four_students_can_actually_move_in`.

**Migrations are additive and reversible, verified by running them both ways**:
`tenancy.0001`, two nullable FKs, and a data migration that backfills a tenancy
per existing `(tenant, unit, bed)` group. Reversed to `occupancy.0005` and
re-applied; the three existing occupancies survived unchanged.

**Depends on:** P7.

---

## Later phases (unchanged from the brief)

| Phase | Scope |
|---|---|
| **5 — Payments** | Core foundation started: obligations reused, intent/transaction/webhook/ledger/receipt/settlement boundary implemented; no production PSP or money movement yet |
| **6 — Wallet** | |
| **7 — Digital services** | Mobile already shows a Services tab listing what is coming |
| **8 — Financial services** | |
| **9 — AI & housing intelligence** | |

---

## Quality gate

Every phase closes only when all of these are true, actually executed:

- backend suite green
- web typecheck, lint, unit tests, production build green
- mobile typecheck, lint, bundle green
- the change verified against the **running** system, not the source
- authorization enforced server-side, never by hidden navigation
- public browsing unaffected
- mobile and web contracts unchanged unless the phase is explicitly changing them
- docs updated: `status.md`, `delivery-log.md`, ADR where a decision was made
