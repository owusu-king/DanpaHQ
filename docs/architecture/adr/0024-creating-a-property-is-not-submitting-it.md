# 24. Creating a property is not submitting it for verification

> **Extended by ADR 0025.** The document and photo checks are now explicitly
> linked to one property submission and receive one final management decision.

Date: 2026-08-20

## Status

Accepted. Extends ADR 0018 (account and property verification are separate
gates), ADR 0021 (state transitions are backend policy) and ADR 0023 (a property
has one verification state). Revises the deletion rule in ADR 0022.

## Context

The provider's report was about button labels. Step two of the property creation
wizard said **"Send this claim for review"**. The final step — the one that
should have finished creating a property — said **"Send photographs"**.

Both labels were accurate. That was the problem.

**Recording the document *was* submitting it.**
`services.submit_provider_application` created the claim already at
`PENDING_REVIEW` and put it in the queue. So the Documents step of creation
filed a review, four steps before the provider had finished describing the
property. By the time they reached the last step, `needsClaim` was false and the
only half left to send was the photographs — hence the label.

**The photographs already worked the other way.** `condition.attach` collects
evidence onto an open, unqueued review; `submit_for_review` is what queues it.
Two halves of one property, with opposite architectures, and the asymmetry
produced every symptom:

- a reviewer received an ownership claim for a property with no photographs,
  then later photographs of a building whose claim they had already decided;
- the provider was asked to send the same property twice and reasonably
  concluded the first attempt had failed;
- the creation flow had no ending — `isSetupComplete` was defined as *both
  halves submitted*, so a property could not be finished without being sent.

**And the state model had no word for the result.** A property that was
complete and unsent could not be described, because "complete" meant "sent".

Three further faults fell out of the same confusion.

**Deletion was backwards.** `can_delete_property` and `can_archive_property`
keyed on `_has_authority`, a live `PropertyRelationship` — which only exists once
an authority claim has been **approved**. So the provider could not delete the
draft they had just created, and *could* delete the property that had just been
verified. Neither policy consulted the verification state at all.

**Withdrawal was a dead end.** `PropertyProviderApplication.property` is a
`OneToOneField`: one claim per property, permanently. Withdrawal marked the row
`WITHDRAWN`, which left it occupying that one slot, so the corrected claim it
existed to enable could never be inserted — `IntegrityError`, at the database.
The test covering this queried the open-claims set and never tried to insert.

**A property that had never been sent reported a submission date.**
`lifecycle()` read the condition review's `created_at`, and that review opens on
the first photograph.

## Decision

### Documents behave like photographs

`submit_provider_application` gains `queue: bool`. With `queue=False` the claim
is recorded as a `DRAFT` with its evidence attached and nobody is asked to look
at it. `services.record_property_claim` is the creation flow's entry point;
`POST /properties/:id/claim/` is its endpoint.

`ProviderApplicationStatus.DRAFT` already existed in the enum and nothing had
ever written it.

### One submission, both halves, afterwards

`services.submit_property_for_verification` flips the draft claim to
`PENDING_REVIEW`, queues its verification, and queues the condition review — in
one transaction, behind one `enforce(can_submit_property(...))`.
`POST /properties/:id/verification/` now means *send the property*, not *send
its photographs*.

`can_submit_property` requires both halves. A reviewer holding photographs of a
building nobody has claimed cannot decide anything.

The identity and phone checks moved with the submission. They used to sit on the
claim endpoint; asking somebody to verify their identity before they may save a
document into a property they are still creating is the same conflation. The
reviewer is who needs the identity confirmed, so the check belongs where the
reviewer does.

### The state model already had the word

No new column, and no `setup_complete` flag — ADR 0023's read model needed one
line. A `DRAFT` claim now reports as `ready_for_submission` on the authority
half, so the combined state reads:

```
draft                 still being created
ready_for_submission  CREATED, verification not submitted   ← the new state
submitted/under_review  with the team, locked
verified / changes_requested / rejected / suspended
```

`ready_for_submission` is not a waiting room. A provider may run a property as
private inventory indefinitely; verification is what lets them advertise it.

### The wizard ends by creating

Details → Documents → Photos → Amenities → Review → **Create property**, then
back to the properties list with confirmation. The last step calls nothing —
creation completes when its inputs are in, which is why no flag is needed. The
`/verify` route is the separate, read-only submission flow, reached from the
property afterwards.

`describePropertySetup` reads `verification.authority.state` instead of
`authority_state`. The old field collapses through `display_state` and cannot
tell a document recorded during creation from one never added.

### A verified property is fixed, with no half-door

Every field, including the name.

The four the evidence policy reads are the obvious ones. The name was briefly
let through, on the reasoning that a reviewer does not check what a property is
called — and that reasoning is wrong at the level that matters. A verification
is a statement about a described thing, and the description a tenant is shown
includes the name. Letting "Adom Heights" become something else under a live
approval means the mark now vouches for a property nobody looked at.

`can_edit_property` therefore denies outright rather than returning a `partial`
allowance, and `update_property` has one gate instead of a field filter. The
verified property page offers management (add a space, view the decision) and no
edit at all.

The honest way to change a verified property is to have it looked at again.
Spaces have that — `spaces.request_recheck` supersedes the approval and returns
the space to draft. Properties do not yet, so the refusal says to contact
support rather than offering a control the API would refuse. **When a property
re-check exists, `can_edit_property` is where it gets named.**

### Deletion follows the reviewer, not the relationship

Both archival and deletion now use `_manages` and consult the verification
state:

| | archive | delete |
|---|---|---|
| being created / created | yes | yes |
| with the team | **no** | **no** |
| decided (verified, rejected, changes requested) | yes | **no** |

This **revises ADR 0022**, which kept `_has_authority` for archival and deletion
on the reasoning that they ask "who may destroy a record" rather than "who may
work on one". The distinction is sound; the predicate was the wrong way to draw
it. Who may destroy a record is answered by *what the record is* — and a
property a reviewer has seen is archived, not deleted, which is ADR 0021's rule
applied to a reviewer as counterparty.

The same boundary applies one level down to a Unit. A provider who manages a
private Property may archive or delete its untouched Unit even before a direct
`PropertyRelationship` exists; authorization comes from
`Property.is_managed_by`, as it does for Property lifecycle. A Unit currently
with the review team must be withdrawn before archival, and a Unit with a
settled review can only be archived. Permanent Unit deletion requires an
explicit reason and confirmation and remains limited to a draft no reviewer,
listing or tenant has relied on.

### Withdrawal returns the claim to draft

Same mechanism as the photographs: the verification stays `PENDING` with its
evidence, only the queue entry goes, and the one application row is reused.
`WITHDRAWN` remains the word for a claim genuinely set aside — as when a
different document replaces it during setup.

The evidence stays attached deliberately. A provider withdraws to correct one
thing, and making them re-upload the indenture to fix a typo in the owner's name
is how withdrawal becomes worse than waiting.

### The detail page shows the property

Amenities were a live checkbox form on the detail page, offered whenever the
page was in "managing" mode — which included a property a reviewer was holding.
The page invited a change the backend then refused. They are now displayed;
changing them is Edit property, which the lifecycle offers when the state allows.

## Consequences

**`POST /properties/:id/verification/` is a breaking change in meaning.** It
submitted photographs and now submits the property, and refuses when no document
is recorded. No client shipped against the old meaning except our own two.

**Creation can be abandoned harmlessly**, and the resulting draft can be
deleted — which it could not before.

**A provider can hold a document without an identity check**, and cannot send it
without one. This is a loosening at rest and no loosening at the gate.

**27 tests in `test_property_creation.py`** walk the journey over HTTP and assert
that the queue is empty after every step of it. Verified by reverting the split
and watching ten of them go red.

## What the first attempt at this missed

The document/submission split above was implemented and tested before anyone
looked at the flow, and the provider's verdict was that it behaved the same and
read worse. Both halves of that were right.

The entry point was untouched. "Add private property" led to a standalone page
headed *Add a property* whose button said **Create private property**, which
created the record and handed over to a differently shaped "setup" flow — now
ending in a second button also called **Create property**. Two creates, the name
asked twice, and no indication on the first screen that five more steps
followed. Fixing what *happened* without fixing the *shape* of the journey made
the shape more obviously wrong, not less.

So `/properties/new` is now step one of six rather than a create action of its
own: same step list, same progress bar, and a button that says *Save and
continue*. `describePropertySetup` gained a `basics` step — the property's name,
kind and address, always done by the time it is asked, listed because it **is**
a step of creating a property and leaving it out is precisely what let the first
screen drift into a separate action. Back/Skip navigation runs under every step.

The lesson inside the lesson: a defect can be genuinely fixed, fully tested, and
still leave the reported experience untouched, because the report was about the
journey and the fix was about one request inside it.

## The lesson

The complaint was about two button labels, and both labels were telling the
truth. "Send the photographs" was the correct description of what the last step
of the wizard actually did, because the other half had already gone.

When a label is wrong and accurate at the same time, the thing to change is not
the label.
