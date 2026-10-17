# 22. The rentable space has three lifecycles, and its photographs are its evidence

Date: 2026-08-19

## Status

Accepted. Completes P3 (verification lifecycle) and P4 (publication) from
`docs/phases.md` for the space level, and extends ADR 0013 (verification is
dated and evidenced), ADR 0017 (progressive capabilities) and ADR 0021 (state
transitions are backend policy).

## Context

The property side of the model was already right. A `Property` is the physical
address; a `Unit` is the rentable space inside it; `Listing` is the
advertisement; `space_rules` decides which kinds of space a category of
property may contain. None of that needed changing.

Four things around it did not hold.

**One status per space, in three different places.** Whether a space had been
checked lived in `trust`, whether it was advertised lived on the listing, and
whether it could be taken was inferred from whichever of those a screen
happened to read. Both clients then rendered a single pill. A provider who got
a room checked could not tell from the interface whether that had also
advertised it, and a provider who took an advertisement down had no way to know
the check survived.

**The publication gate was written down and not enforced.**
`trust.gates.can_publish` has refused an unchecked space since P3, and
`listing.services.publish_listing` never called it — it published anyway and
sent the listing to a moderation queue. So the rule the architecture states,
*space verification blocks publishing that space*, existed as a paragraph. An
unchecked room reached strangers on the strength of nobody having looked at it
yet.

**A space had no photographs of its own.** Photographs existed as verification
evidence (private) or as listing media (attached to an advertisement). A space
that was checked but not advertised had nothing to show, which is exactly the
case the private access-code path is for: a tenant reviewing a private Unit
never sees a public listing.

**Space evidence asked for the property's evidence again.** Every bedroom, every
bathroom, every declared feature, per space — after the building's front, side,
surroundings and authority document had already been reviewed. A hostel with
eight rooms was forty photographs before anything could be let.

## Decision

### Three lifecycles, three fields, never one

A space's read model carries `verification`, `publication` and `availability`
separately, and both clients render all three, always. They move independently
and for different reasons:

| Axis | Answers | Owned by |
|---|---|---|
| `verification` | has this been checked | `trust` — the `SPACE_CONDITION` review |
| `publication` | is it being offered publicly | the listing's `publication_state` |
| `availability` | can it still be taken | occupancy first, listing second |

A verified, private, unoccupied space is a normal state and is now expressible.
`availability` reads occupancy rather than the listing deliberately: a room let
privately is not available, advertisement or none, and "available" over an
occupied room is the most damaging thing this product could show a tenant.

The verification axis gets its own vocabulary, because two distinctions matter
to a provider and the old one collapsed both: **draft** versus **ready to send**
(work left, versus waiting on them), and **submitted** versus **under review**
(queued, versus somebody actually looking).

```
DRAFT → READY FOR SUBMISSION → SUBMITTED → UNDER REVIEW → VERIFIED
                                    ↓
              CHANGES REQUESTED / REJECTED / SUSPENDED / EXPIRED
```

The older `condition_state` field is kept alongside it. A mobile build already
installed reads it and cannot be forced to update.

### Publication is enforced where it is claimed

`publish_listing` now calls `can_publish` through `enforce`. An unchecked space
cannot be advertised at all, rather than being advertised and queued.

`enforce` was also changed to include a decision's blockers in the exception it
raises. It had been dropping them, so a refusal arrived as "this cannot be
advertised yet" with no indication of which review was outstanding — the
actionable half of a `Decision`, discarded at the one moment it was needed.

Because a checked space needs no second opinion, publishing it goes live
directly. Moderation keeps its teeth in the other direction: an advertisement
already in front of people can still be flagged or suspended.

### Occupancy protects the Unit somebody relies on

`Occupancy` is the availability truth for both an active Danpa HQ tenancy and
physical occupancy recorded as `pending_lease`. Once either exists, the Unit is
not merely absent from discovery: checked characteristics, amenities,
photographs, verification re-check and bed allocation are protected until the
occupancy ends. Archive and deletion remain refused by lifecycle policy.

Private entrance directions are the operational exception. They help an
authorized provider manage access, are never public, and do not change what was
verified or leased. A Unit's label remains part of its checked identity and is
not in that exception.

Automatic listing withdrawal and access-code revocation are cleanup, not the
security boundary. Publication, viewing requests, public applications and
private join requests each check occupancy themselves. Those mutations and occupancy activation lock
the Unit row in the same order, so a request cannot pass a stale availability
check while possession begins concurrently.

### Beds are allocation structure inside hostel rooms only

`room` is a rentable-space type shared by residential and hostel Properties,
but it does not mean the same allocation model in both. Only a `room` whose
parent `Property.property_type` is `hostel` may contain `Bed` rows. A
residential room is let as one Unit; `bed_space` is already the smallest
rentable hostel space and cannot itself be subdivided.

This cross-table rule cannot be expressed by a PostgreSQL check constraint, so
`space_rules.is_hostel_room` is the canonical predicate. Bed creation policy
and service validation, the served space-type vocabulary, Unit read models,
private acquisition, occupancy and lease drafting all use it. Property category
changes also validate existing Units and refuse to move a Property with Bed
history out of `hostel`.

Legacy non-hostel Bed rows are retained rather than silently deleted. Active
provider and tenant surfaces do not expose them, and they cannot be used to
create a new lease or allocation. Preserving those rows keeps historical data
recoverable without allowing it to compete with the current domain rule.

### Photographs are the space's, and also its evidence

`UnitMedia` holds a space's photographs. `spaces.attach_photo` stores the row
*and* files the same file against the named evidence slot, in one call.

One upload, two consequences. Photographing a room once for a reviewer and
again for a tenant is how the reviewed room and the advertised room become
different rooms — and on a phone, standing in the room, it is also how a
provider gives up. The first photograph is the primary one, enforced by a
partial unique index rather than by whichever screen wrote last.

After approval the set is frozen. Changing it is `request_recheck`, which
supersedes the approval, returns the space to draft, and takes its live
listings out of discovery — a listing left up on a superseded check advertises
an unchecked room under a check that no longer applies.

### Space evidence: overview, selected amenities, and context

`POLICY_VERSION` `2026.08.4` supersedes the one-overview-only requirement from
`2026.08.3`. One overview remains required, named for what the space actually
is — the main interior for a flat or room, the bed for a bed space, the inside
for a shop, the plot for land. Every selected Unit amenity adds its own required
photo slot, and two context views remain optional.

The reasoning is that the property above has already been reviewed, and the
space review only has to add what that could not show.

**What was given up is real.** A two-bedroom flat is no longer required to
photograph both bedrooms, and the per-room slot existed so that nobody arrives
to fewer rooms than they agreed. That protection now rests on the declared
counts, the provider's own photographs and the viewing. It is recorded in
`docs/known-limitations.md` rather than left to be discovered from a diff.

Evidence collected under an earlier policy version is still judged against what
it was actually asked for; `POLICY_VERSION` is recorded on every submission for
exactly this.

Legacy `FEATURE_EVIDENCE` survives for non-checklist Unit flags. The canonical
creation rule follows active `UnitAmenity` rows so a newly seeded amenity gains
the evidence rule without a client-side map.

### A space waits for its property before it may ask for a decision

`submit_for_review` requires the parent property's unified
`verification.review_state` to be `verified`, enforced in `trust.condition` so
no caller routes around it and mirrored in `can_submit_space` so the client
renders the same answer. An approved authority document is only one evidence
check and cannot advance a space while the property's photographs remain
pending, rejected or unsubmitted (ADR 0025).

Scoped to spaces. A property's own condition review requiring the property to be
verified is a deadlock, and it is the same shape of mistake `assert_may_review`
was already once written into.

Everything short of asking for a decision stays open under an unverified
property: creating the space, describing it, its amenities, its photographs, and
saving it for later.

### An access code begins and ends with space verification

Draft, pending, rejected and re-checking spaces have no usable access code. New
spaces store `NULL`; approval of `SPACE_CONDITION` only makes explicit code
creation eligible. Provider serializers fail closed for any unverified space,
while lookup and join-request services independently enforce the same
verification boundary. Migration `property.0012` cleared legacy unverified
codes without changing verification or tenancy history.

ADR 0026 completes the subsequent security repair: one-time disclosure,
peppered hashed persistence, expiration, rotation, revocation, throttling and
the deliberate multi-use semantics of a manager-approved share-code request.

### Amenities are scoped, and the flags they mirror stay in step

`Amenity` gains `scope` (property / unit / both) and `space_types`, so the
picker is filtered server-side and neither client keeps its own copy of which
amenities suit which kind of space. `PropertyAmenity` is the compound's set;
`UnitAmenity` was already the space's.

`Amenity.unit_flag_field` names the legacy `Unit` boolean an amenity mirrors —
`has_private_kitchen`, `is_furnished` and the rest — and the service writes
both. Those booleans are load-bearing: the evidence vocabulary reads them and
public search filters on them. Two independent ways to say "this room has a
kitchen" would have disagreed within a week.

### The space inherits its property, and copies nothing

Where a space is comes from `unit.property.address`, through the relationship.
A space carries only what differs *within* one address: building or block,
floor, wing, entrance note, and what to call it. A building whose flats each
hold their own copy of the address is a building whose flats can disagree about
where the building is.

The entrance note is deliberately not public. It is how somebody finds the
door, and it is released when a viewing is confirmed — as the street and house
number already were.

That release is carried by the viewing resource, never the public listing. It
is available only to the requesting tenant and a current manager while the
appointment is confirmed, and closes on cancellation, a recorded outcome or
the end of the slot. This prevents an abandoned confirmed request from becoming
permanent access to an exact address.

### The public page answers "what am I renting" before "where is it"

`ListingDetailSerializer` returns a `space` block and a `property_context`
block. The space is the subject: its photographs, its type, its amenities, its
price, its check. The property is context. Somebody renting one room in a
hostel is not renting the hostel, and a page that opens with the building's
photographs has already blurred that.

The detail response also returns one ordered `gallery`. The Unit's primary
photo remains first, followed by its other checked photos, unique campaign
photos and then photographs from the Property's **current approved condition
evidence**. The final group is labelled as the wider Property, so compound
context joins the main gallery without implying the tenant is renting the whole
building.

Gallery entries reference existing stored files; they are not copied into a
second media table. File IDs deduplicate a photo reused by Unit and Listing.
Only usable, non-sensitive `property_photo` files receive short-lived public
URLs. Arbitrary `PropertyMedia`, authority documents and evidence from a
revoked, expired or superseded Property review do not cross the public boundary.
Meter close-ups and location-context evidence also remain reviewer-only because
they can expose account identifiers or the exact location withheld until a
viewing is confirmed.
The older nested photo arrays remain for installed-client compatibility.

Search results keep the lighter shape. Each block costs a query and a page of
twenty cards needs none of them.

## Consequences

**A listing cannot be published until its space is checked.** This is a
tightening. Existing draft listings on unchecked spaces stay drafts and their
providers are told what is outstanding.

**Nothing lands in the listing moderation queue from the provider path.**
Publishing a checked space is a toggle. Reviewers keep `flag` and `suspend`
over live listings.

**Space verification is cheaper and shallower.** Faster for providers, and less
evidence behind each approval. Stated in `known-limitations.md`.

**`Unit` grows three columns and two tables appear.** `description`, `wing`,
`entrance_note`; `UnitMedia` and `PropertyAmenity`. Migration
`property.0009` is additive and reversible, verified both ways.

## The defect this shipped with, and what it taught

The four space policies were written against `_has_authority` — a live
`PropertyRelationship` — while every service that enforces on the same path
(`spaces.assert_can_manage`, `condition.assert_may_review`,
`listing.assert_can_manage`) asks `Property.is_managed_by`.

A property created privately or through an organization has **no**
relationship, deliberately. So `permitted_actions` answered "you do not manage
this property" about the provider's own property, the web workspace renders
controls from `permitted_actions`, and the submit button therefore never
appeared. What appeared instead was a button that scrolled the page, under a
line that counted photographs — because the fallback assumed the only possible
refusal was missing evidence.

Two rules came out of it, and both are now pinned by tests:

1. **A policy and the service it describes must use the same predicate.** They
   are two halves of one answer; ADR 0021 says the client renders and the server
   enforces, which only holds if they agree. `test_the_policy_and_the_service_agree`
   asserts it directly, across both sides of the gate.
2. **A refused action must state its reason and offer a route.** Hiding a
   control is a courtesy, and a courtesy that leaves nothing behind is the
   silent failure. Where the reason is the property, the screen links to it.

`_has_authority` keeps its narrower meaning for archival and deletion, which ask
who may destroy a record rather than who may work on one.

## What this did not change

The Property → Building → Unit → Bed tree, `PropertyType`, `RentableSpaceType`,
the `space_rules` matrix, `PropertyRelationship`, the occupancy exclusion
constraints, the lease execution model, and the tenancy record. All of them were
already right, and renaming or reshaping them would have bought nothing.
