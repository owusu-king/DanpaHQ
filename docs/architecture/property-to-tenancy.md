# Property → Rental → Tenancy

The target architecture for the rental lifecycle, reconciled against what is
already built. Companion to `docs/phases.md`, which sequences the work.

This is an evolution, not a rewrite. Most of the model is already correct.

---

## What already satisfies the target

These were checked against the code, not assumed:

- **Property authorization already exists and is already separate from
  `created_by`.** `property.PropertyRelationship` carries `user`,
  `relationship_type` (owner / manager / agent / company_representative /
  listing_manager), `granted_by`, `ended_at` and `authority_verification_id`.
  `Property` separately carries `owner`, `managed_by` and `created_by`, and
  `created_by` is audit metadata only. No new `PropertyAuthorization` table is
  needed; introducing one would be a rename with a migration attached.
- **Provider type is already separate from property type.**
  `organization.OrganizationType` describes the operator; `property.PropertyType`
  describes the building.
- **Historical invitations are preserved but no longer acquire tenants.**
  `occupancy.PropertyInvitation` remains for audit/history and existing foreign
  keys. Open rows are revoked by migration; creation, token decisions and
  invitation-linked lease drafting are retired with HTTP 410 responses.
- **Viewing request and rental application are already separate models.**
- **Lease terms are already snapshotted** onto the lease row — rent, period,
  advance, deposit, agency fee, term, conditions — and `Lease.supersedes`
  records renegotiation as history rather than an edit.
- **Verification is already dated, evidenced and superseded**, never a boolean
  (ADR 0013), and provider standing is already separate from property authority
  (ADR 0018).

---

## The real gaps

### 1. Occupancy is not temporal  ✅ *fixed in P1*

`Occupancy` has `starts_on` and `ends_on`, but every constraint keys on
`ended_at IS NULL` — "currently active", not "overlapping in time". There is no
`ExclusionConstraint` anywhere in the codebase and `btree_gist` is not enabled.

Consequences today:

- Two occupancies of the same bed with **non-overlapping future dates** are
  rejected, because the constraint sees only "active".
- Two occupancies with **overlapping dates** are accepted once `ended_at` is
  set.
- A whole-unit occupancy and bed-level occupancies **in the same unit** are not
  mutually excluded at all: `occupancy_unique_active_user_unit` applies only
  when `bed IS NULL`, and `occupancy_unique_active_bed` only when it is not.

Double-letting is the fraud this product exists to make impossible, so this is
the gap to close first.

**Target:** allocation is a period. Overlap prevented by a Postgres exclusion
constraint over `(target, daterange)`, with application-level validation for the
message. A unit allocated whole excludes its beds for the same period, and vice
versa.

### 2. The rented thing is unit-only  *(partly fixed in P1)*

`Listing.unit`, `Lease.unit` and `lease_one_live_per_unit` all assume a unit.
So:

- a **hostel bed cannot have its own lease** — a four-bed room admits one live
  lease in total, which is exactly the segment the product targets;
- a **whole property cannot be listed or leased** as one thing;
- `Unit.unit_type` reuses `PropertyType`, which has no `ROOM` or `BED_SPACE`.

**Target:** a *rentable space* is what is offered. Rather than a polymorphic
table — which would mean migrating three foreign keys and every query behind
them — the space is identified by a constrained pair on the rows that already
exist, plus a `space_type` on `Unit` that stops borrowing `PropertyType`. The
existing Property → Building → Unit → Bed tree stays: it is sound, it already
models hostels correctly, and renaming it buys nothing.

The tree is deliberately narrower than the foreign key alone suggests: a Bed
may exist only beneath a `room` Unit in a Property whose canonical category is
`hostel`. Residential rooms remain whole-Unit rentable spaces. The backend
serves and enforces that same rule, including during Property category changes;
legacy invalid rows are retained as history but cannot enter acquisition,
lease or occupancy workflows.

### 3. Evidence is hardcoded  ✅ *fixed in P2*

`trust/evidence_policy.py` resolves requirements at runtime from what the
records already say, and carries a `POLICY_VERSION` recorded against every
submission — so raising or lowering the bar later does not retroactively make an
existing approval look deficient.

Property-level and space-level evidence stayed separate, and P3/P4 used that
separation: the property is asked for its front, its side, its surroundings and
its authority document; the **space** is asked for one photograph — the main
interior view, or whatever stands in for it where a space has no interior — plus
two invited ones. The reasoning is that the property above the space has already
been reviewed, and the space review only has to add what that could not show.

What was given up, said plainly: a slot per bedroom and per bathroom, which
existed so nobody arrives to fewer rooms than they agreed. See
`docs/known-limitations.md`.

### 4. Verification and publication share one field  ✅ *fixed in P4*

Two levels, and both are now separated.

On the **listing**, `ModerationState` / `PublicationState` / `AvailabilityState`
are their own columns and `status` is derived from them (P4, first pass).

On the **space**, the read model carries `verification`, `publication` and
`availability` as three fields, and both clients render all three, always. A
space can be verified, private, available and unoccupied at once — the
combination the single field could not express, and the one the private
invitation path lives in.

`availability` reads occupancy first and the listing second, deliberately: a
room let privately is not available whether or not it was ever advertised.

**The defect this found.** `trust.gates.can_publish` had refused an unchecked
space since P3 and `publish_listing` never called it — so the gate below,
*space verification blocks publishing that space*, was a paragraph and nothing
more. An unchecked room could be advertised and was merely queued for
moderation. It is enforced now, and because a checked space needs no second
opinion, publishing it goes live directly.

### 5b. Tenancy had no record  ✅ *fixed in P8*

`Tenancy` is now a record in `apps/tenancy`, distinct from the agreement and
from the allocation, with `Lease.tenancy` and `Occupancy.tenancy` pointing at
it. It is the anchor rent, maintenance, inspections, notices, renewals and
disputes attach to when they are built — none of them are built here, and
`apps.rent` still hangs off `Lease` until its own phase moves it.

`ensure_tenancy` is find-then-create, which is what makes a renewal continue an
existing relationship rather than opening a second one. `upcoming` distinguishes
a tenancy that has been agreed from one that has begun.

An active or upcoming tenancy now carries `activation_lease`, the accepted
agreement that first opened the relationship. A database check rejects either
state without that link. `pending_lease` is context only: it preserves a
historical or real-world arrangement that still needs a Rooomly agreement, but
does not grant an active platform tenancy.

### 5. Executed lease terms and acceptance evidence  ✅ *fixed in P7 and P5 repair*

The lifecycle row transitions
`draft → offered → awaiting_activation → active → ended`, but the
terms do not transition with it. `LeaseAgreement` freezes the complete offer at
`offered`, stores its canonical content hash, and `LeaseAcceptance` records who,
when, method and request evidence against that same hash. Tenant clients receive
and review the frozen terms; acceptance fails closed if the terms or an earlier
acceptance no longer match the hash. A changed agreement must therefore be a
new version rather than a silent edit. This is an audit trail, **not** a claim
of legal e-signature compliance — see Open questions.

`awaiting_activation` is an explicit gate. Today `lease_accepted` satisfies it
immediately after both parties accept. A future lease may instead require
`initial_payment`; it remains accepted but creates no Tenancy or Occupancy until
a trusted payment-confirmed event satisfies that requirement.


### 6. The tenant portal assumes one tenancy  ✅ *fixed in P0.5*

`GET /me/occupancies/` returns every open occupancy. Both clients then collapse
the list to one:

```
occupancies.find(active) ?? occupancies[0] ?? null
```

`web/src/lib/tenant.ts` (`currentOccupancy`, `currentLease`) and the mobile
tenant home do the same thing. A tenant renting two places today sees one of
them, chosen arbitrarily, and the other is invisible with no indication it
exists. The backend is correct; the clients are not.

A tenant may hold several tenancies at once — a family home and a shop, a room
while a lease overlaps a move — and historically many more.

**Target:** the tenant home is a portfolio when there is more than one tenancy
and stays a single view when there is one. Nothing is chosen for them
implicitly.

- **Per-tenancy context.** Lease, rent, maintenance, notices and documents
  belong to *a* tenancy and are reached through it, not through a global
  "current" pointer.
- **Tenant-level, outside any tenancy.** Explore, saved, applications,
  viewings, notifications, account and preferences. These are properties of the
  person, not of a tenancy.
- **No `currentTenancy` in state.** Selecting one is navigation — a route
  parameter — never ambient state that another screen can silently inherit.

The same rule already applies on the provider side: `available_workspaces` is a
list and the portal renders all of them.

---

## Invariants

1. Property ≠ Rentable Space ≠ Listing ≠ Lease ≠ Tenancy
2. Verification ≠ Publication ≠ Availability ≠ Occupancy
3. Invitation ≠ Lease Offer
4. Viewing Request ≠ Rental Application
5. Provider identity ≠ Property authorization
6. Lease Offer ≠ Executed Lease
7. Tenancy ≠ Occupancy
8. Evidence requirements are policy, not code
9. Occupancy is temporal
10. Executed lease content is immutable and versioned
11. Authorization never derives from `created_by`
12. Future rental operations attach to Tenancy rather than growing inside it
13. A tenant may hold many tenancies, including different Units in the same
    Property; exclusivity is scoped to the rented Unit/Bed and no surface
    assumes one
14. Destructive intent becomes archival wherever dependent records exist
15. Every state transition is a backend policy, never a hidden button
16. A space's photographs are the evidence its check was decided on — the same
    files, uploaded once
17. A space inherits where it is from its property and copies none of it
18. Every active or upcoming Rooomly Tenancy has an accepted activation Lease;
    acquisition approval alone never activates Tenancy or Occupancy
19. Provider tenant management is a permission-scoped projection of existing
    Occupancy, Tenancy, Lease and Rent records. It never creates a parallel
    Tenant record, and a portfolio row follows the Occupancy's exact Unit/bed
    and Lease rather than guessing from its parent Property or Unit.
20. Physical viewings are free. A confirmed viewing must pass one temporary,
    server-verified QR/six-digit check-in before completion; completion creates
    no Tenancy and may only lead into the canonical tenancy-request workflow.

---


## Permissions and state transitions

Every rule below is a **backend policy**. The client asks what is permitted and
renders that; it never decides. This is the same rule the identity work
settled — hiding a control is a courtesy, the server is the boundary — applied
to the rental lifecycle, where the records have legal and financial weight.

Each transition answers four questions: **who** may do it, **when** it is
allowed, **what it destroys**, and **what it must record**.

### Destruction becomes archival once anything depends on it

`SoftDeleteModel` already provides `deleted_at` and `deleted_reason`. The policy
is when it is used rather than a hard delete, and when neither is allowed.

| Target | Hard delete | Archive | Blocked outright |
|---|---|---|---|
| Property | never once any space, listing or occupancy has existed | when no live dependents | while a live lease, tenancy or open dispute exists |
| Rentable space | never once listed, leased or occupied | when only drafts reference it | while allocated for any period, now or future |
| Listing | only while `draft` and never published | after publication — withdraw, do not remove | while an application or viewing is open against it |
| Invitation | never — revoke instead | revoked is a state, not a deletion | — |
| Lease offer | while `draft` and never sent | after it is sent — withdraw with a reason | after acceptance |
| Executed lease | **never** | never | it is a record of agreement; it ends, it does not disappear |
| Tenancy | never | ends with a date and a reason | — |
| Occupancy | never | closed with an end date | — |

The rule underneath: **anything a counterparty has seen or relied on is
preserved.** A tenant who accepted terms must still be able to read them after
the provider moves on. A draft nobody has seen may be removed.

Where a provider genuinely wants a property gone from their workspace, the
answer is archival plus exclusion from their portfolio view — not deletion of
the tenancy history attached to it.

Archive is reversible, but restoration is a fresh lifecycle decision rather
than clearing a flag unconditionally. The provider must still be authorized;
the resource must still be archived; no active lease, occupancy or listing may
contradict restoration; a Unit's parent Property must be active; and the
Property/space/bed structure must still satisfy the current category rules.
Restoring inventory does not restore marketplace availability, private access
credentials or an expired/revoked verification. Every archive and restore
transition remains in the append-only audit history.

### Who may act

| Action | Tenant | Provider (authorized on that property) | Administrator |
|---|---|---|---|
| Create property / space | — | yes, with approved provider standing | — |
| Edit space details | — | yes while not under review | — |
| Publish / withdraw listing | — | yes, verification permitting | may suspend, with reason |
| Revoke invitation | — | yes | yes, with reason |
| Issue lease offer | — | yes | — |
| Accept / decline offer | yes, while it is open and addressed to them | — | — |
| Withdraw offer | — | yes, before acceptance | — |
| Withdraw own application | yes, before a decision | — | — |
| End tenancy | request only | yes, with a date and reason | — |
| Reverse an executed lease | — | — | yes, recorded, exceptional |
| Change occupancy dates | — | yes, if no overlap results | yes |

"Provider" means holding a live `PropertyRelationship` on *that* property.
Organization membership alone is not authority over every property in it.

### Tenant-side transitions

A lease offer may be accepted or declined only while it is open, only by the
person it names, and only before it expires. Acceptance is irreversible by the
tenant — withdrawal after acceptance is a request to the provider, not a state
the tenant can set. This protects the provider from a lease that silently
evaporates, and the tenant from accidentally discarding an agreement.

An application may be withdrawn until it is decided; after a decision it is
closed with an outcome rather than removed, because the tenant's history is
their record too.

### What every consequential action records

Confirmation, a reason, and an audit entry — the existing audit infrastructure
already supports this and is where these belong:

- who acted, and under which relationship or admin identity
- when, and from what session
- the prior state and the new state
- the reason, captured as text where the action affects a counterparty
- for administrator actions, always a reason — no silent overrides

Actions requiring elevated permission: reversing an executed lease, overriding
an occupancy conflict, suspending a listing, and any change to another party's
records.

### Legally sensitive, deliberately conservative

Where a permission depends on unsettled interpretation, the safest reversible
behaviour is chosen and the question is flagged rather than answered here. In
particular:

- **Ending a tenancy** — notice periods and grounds are a legal question. The
  product records what happened and when; it does not assert that an ending was
  lawful.
- **Withholding a deposit** — not modelled as a provider-side action at all
  until the rules are confirmed.
- **Eviction** — deliberately absent. The product has no such action, and
  ending a tenancy record is not one.

No Ghana-specific right or obligation is invented anywhere in this
architecture. Where one is needed, it is a policy input awaiting legal review.

---

## Gates

Where each check happens, and what it blocks:

| Gate | Blocks | Does not block |
|---|---|---|
| Provider standing approved | creating a property | registering, browsing |
| Property verification package verified | **submitting a space for review** | creating spaces, entering details, photographing them |
| Property authority verified | publishing, tenant access | private inventory work |
| Space verification | publishing that space | drafting it, editing it |
| Publication | public discovery | private Unit access code |
| Availability + occupancy | issuing a lease offer for a period | drafting the offer |
| Executed lease | activating a tenancy | reviewing the offer |

Private acquisition has one active path:

`Verified Unit → access code → tenancy request → provider approval → lease offer
→ tenant acceptance → tenancy/occupancy`.

Physical occupancy may be recorded as context, but it does not re-enable the
retired invitation path or authorize a lease without a tenancy request.

Draft work is never blocked by a review in progress. Only actions with a
real-world counterparty are gated.

Submitting a *space* for review is the one gate whose counterparty is our own
reviewer rather than a tenant. "Is this room as described" only means something
once the parent property's complete document-and-photo package has been
approved, so a space waits for the unified property result — while everything
about the space stays editable in the meantime. The property's own review is
deliberately exempt: requiring a verified property before the property could be
verified is a deadlock, and
`trust.condition.assert_property_is_ready` scopes the check to spaces for that
reason.

---

## Settled policy stances

Three questions were raised and have been answered as product decisions. Each
keeps the safest reversible behaviour and leaves the architecture open.

### Acceptance is a record, not a signature

In-app acceptance stays as it is: the tenant accepts, and the platform records
it. The architecture treats this as an **auditable acceptance record** and the
product makes **no claim that it constitutes a legally binding electronic
signature.** Copy must not imply otherwise.

What is preserved at acceptance, so a stronger mechanism can be layered on
later without losing history:

- the exact content accepted, as a hash over the snapshotted terms
- who accepted, when, from which session and device
- the offer version, and that it was open and addressed to them at the time

A formal e-signature provider becomes an additional evidence record against the
same executed lease. It does not replace this one, and it does not require the
lease model to change.

### Rent advance is a configurable policy, not a constant

No legal limit is hard-coded, and none is determined here. Advance months are
evaluated by a policy returning one of three outcomes:

| Outcome | Behaviour |
|---|---|
| `allow` | proceed silently |
| `warn` | proceed, but state the concern to both parties and record that it was shown |
| `block` | refuse, with the reason |

The policy is data — scoped by property category and space type, versioned, and
changeable without a migration. Until compliance confirms the production
values, the default is `allow` with the ceiling left unset, because a wrong
`block` would stop lawful lettings and a wrong number presented as law would be
worse than none.

The *outcome* is recorded on the offer, so a later dispute can see what the
platform said at the time.

### Coordinates now, proximity later

`geo.Address` already stores `latitude` and `longitude`, and `geo.Locality`
carries its own pair. That is enough, and it is what P1 preserves: accurate
coordinates captured against the property and its spaces.

Campus-distance computation is **not** built in P1. Manually entered distances
are a claim rather than a fact and should not be presented as measured. Keeping
coordinates means proximity search, campus reference points and radius
filtering can be added later — with PostGIS if it earns its place — without
touching the property model.

---

## Open questions requiring legal review

Flagged rather than answered. Each currently resolves to the most conservative
reversible behaviour.

- **Tenancy termination** — notice periods, grounds, and what a provider may do
  unilaterally.
- **Deposit handling and deductions** — not modelled as a provider action until
  confirmed.
- **Rent advance ceiling** — the values for the policy above.
- **Whether in-app acceptance suffices** for a tenancy agreement of a given
  term, and from what term a formal signature is required.
