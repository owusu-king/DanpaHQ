# 23. A property has one verification state, and a submission has a way back

> **Refined by ADR 0025.** The detailed combined state remains for setup and
> compatibility, while `review_state` is now the sole provider-facing outcome
> and Operations decides the linked package atomically.

Date: 2026-08-19

## Status

Accepted. Extends ADR 0013 (verification is dated and evidenced), ADR 0018
(account and property verification are separate gates), ADR 0021 (state
transitions are backend policy) and ADR 0022 (the space's three lifecycles).

## Context

The property detail page offered **"Continue with property details"** in every
state. To a provider whose property was sitting with a reviewer. To one whose
ownership claim had been rejected. To one approved three weeks earlier. The
same button, in the same place, meaning nothing.

The obvious reading is that the page ignored the state. It did not. It rendered
the only state it was given, and that field could not express the difference.

**A property has two reviews and no single answer.** `PROPERTY_AUTHORITY` asks
whether this person may act for this address; `PROPERTY_CONDITION` asks whether
the photographs show the place. Both are real, they move at different speeds,
and no field combined them. A screen wanting to say "where does my property
stand" had to pick one review and be wrong about the other.

**`display_state` has four values and the flow has nine.** It collapses
`REJECTED`, `REVOKED`, `EXPIRED` and never-started into `unverified`. A page
reading it cannot separate a provider whose claim was refused — who has
something specific to fix — from one who has not begun. Both got "continue
setup", which is right for exactly one of them.

**A submission was a one-way door.** Once sent, a provider who noticed the
wrong document attached had no move at all. Not editing (correctly refused while
a reviewer holds it), not replacing the evidence, not sending again. The only
route was to wait for a rejection they already knew was coming, which spends a
reviewer's attention to tell somebody what they told us first.

## Decision

### One state for the property, worst half first

`apps.property.verification.lifecycle(prop)` returns a single state, plus an
`authority` and a `photos` block naming where each half stands.

```
draft → ready_for_submission → submitted → under_review → verified
                                   ↓
        changes_requested / rejected / suspended / expired
```

When the halves disagree, precedence is **worst first**: suspended, rejected,
changes requested, expired, draft, submitted, under review, ready, verified. A
property whose ownership document was rejected is not "waiting" because its
photographs happen to be queued. The thing needing the provider's attention is
the thing the page must lead with.

Both halves are still reported, because "changes requested" without saying
whether it is the document or the photographs says almost nothing.

This is a read model over the two `Verification` rows. It stores nothing and
adds no migration. `display_state` keeps its four values for clients built
before this existed; `authority_state` stays on the payload for the same reason.

### The state decides what is offered, and the backend decides the state

| State | Offers |
|---|---|
| draft | continue setup, progress, edit — **no** submit |
| ready for submission | review, submit, edit |
| submitted / under review | **withdraw** — no continue, no submit, no edit |
| verified | manage, add spaces, view the decision, edit what was not checked |
| changes requested / rejected | the feedback, update, resubmit |
| suspended / revoked | the reason and a route to support — no submit, no publish |

Every control on both clients is gated by `permitted_actions`, per ADR 0021.
The table above is what `can_edit_property`, `can_submit_property` and
`can_withdraw_property_submission` answer; neither client derives it.

The states nobody can reach through the product are still handled. `expired`
and `suspended` are what a reviewer's revocation produces, and a page that
renders them as "draft" tells a provider to continue setting up a property that
has been taken away from them.

### Withdrawal, and what it costs

`POST /properties/:id/verification/withdraw/` and the space equivalent take a
submission back out of the queue.

```
PENDING → WITHDRAW → READY FOR SUBMISSION → EDIT → RESUBMIT
```

The verification row stays `PENDING`; the `ReviewQueueEntry` is deleted. That
is the whole mechanism — `lifecycle_state` reads the queue entry, so a pending
verification nobody is holding is already "ready for submission". No new status
value, no migration, and no second way to be in the queue.

Refused with 409 unless a reviewer is actually holding it. There is nothing to
withdraw from a draft, and an approved decision is undone by a re-check, not a
withdrawal — sharing a verb is how somebody undoes an approval meaning to cancel
a submission.

The evidence stays attached. A provider withdraws to correct one thing, and
making them re-upload five photographs to change one is how withdrawal becomes
a worse option than waiting.

**The withdrawn submission stays in the audit record.** A queue entry a reviewer
may already have opened is history, and ADR 0021's rule is that anything a
counterparty has seen is preserved. The transition is recorded with its reason.

The provider's *claim* is treated the same way: withdrawing it sets
`ProviderApplicationStatus.WITHDRAWN` rather than deleting the row. A new status
value was needed because `DRAFT`, `PENDING_REVIEW` and `NEEDS_MORE` all count as
an open claim — parking a withdrawn one in any of them would refuse the
corrected claim that withdrawal exists to enable. Withdrawal would have been a
trap instead of a way out.

### A verified property is partly editable, and the line is the evidence policy

`title`, `has_security`, `is_gated` and `notes` stay editable after approval.
`property_type`, `water_source`, `power_meter_type` and `compound_type` do not.

The line is not importance, it is whether `trust.evidence_policy` reads the
field. Those four decide which photographs a property must show. Changing one
after a decision moves the checklist under a decision already made: a property
approved on three views silently becomes one that should have shown five, with
an approval that no longer covers what it claims to.

`can_edit_property` answers `partial` here, and both clients render the split
rather than an all-or-nothing lock.

## Consequences

**Two clients gain a state machine each.** `PropertyLifecycle` on web and on
mobile dispatch on `verification.state` to five renderers. ADR 0014's terms
hold: the same states and the same words, in each platform's own idiom.

**A provider can take a submission back**, which they could not before, and a
reviewer stops receiving submissions their author has already disowned.

**Nine states must each be tested.** A state machine whose wrong branches are
only unreachable through the interface is not enforced —
`tests/integration/test_property_lifecycle.py` puts a property into all nine and
asserts both what `permitted_actions` offers and that the matching API call is
refused. It is the same request the page would have made with its button shown
in the wrong state, which is precisely what was happening.

## The lesson

The page was not ignoring the state. It was rendering the only state it had,
and that field could not express the difference.

When a screen behaves identically in situations that differ, the first question
is whether it was ever given anything to distinguish them. Four values were
being asked to carry nine, and no amount of care in the component would have
recovered the five that had already been thrown away.
