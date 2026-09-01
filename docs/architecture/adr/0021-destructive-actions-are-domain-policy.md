# 21. Destructive actions and state transitions are domain policy

Date: 2026-08-18

## Status

Accepted. Extends ADR 0016 (resource authorization) into the rental lifecycle.

## Context

The rental domain creates records two parties rely on: an accepted lease, a
tenancy, a rent ledger, an application someone was refused. Once the property
work begins, each new phase adds transitions — publish, withdraw, revoke,
accept, decline, end, archive — and each is a chance to let the client decide
something the server should own.

We have already been bitten by the client-decides pattern in identity: routing
read a role name, so an account that had granted itself a role reached the
provider console. The fix was to make the backend answer and the client render.
The same discipline has to reach the lifecycle before the lifecycle is built,
not after.

There is a second pressure specific to this domain. A provider will want to
delete a property. The obvious implementation — a delete button and a `DELETE`
endpoint — destroys the tenancy history of people who have no say in it, and
some of that history may matter later in a dispute.

## Decision

**Every state transition is a backend policy, expressed once, in the domain
layer.** The API exposes what is currently permitted; clients render that and
never derive it. A hidden control is a courtesy, never a boundary.

**Destructive intent becomes archival wherever a dependent record exists.**
Hard deletion is available only for drafts no counterparty has seen. Anything
that has been published, sent, accepted or occupied is ended or archived, with
a date and a reason, and remains readable. An executed lease is never deleted.

**Consequential actions record who, when, from what session, the prior and new
state, and a reason.** Administrator actions always require a reason; there are
no silent overrides.

**Where a permission depends on unsettled legal interpretation, the safest
reversible behaviour is chosen and the question is flagged.** No Ghana-specific
right or obligation is invented in code. Notice periods, deposit deductions and
eviction are deliberately absent rather than guessed at.

## Consequences

Each phase must state its transitions and their policy before it ships, which
is slower per phase and much cheaper than retrofitting authorization across
eight of them.

Providers cannot truly delete a property once it has been let. Archival plus
exclusion from the portfolio view has to be good enough, and the interface has
to explain why — an unexplained refusal reads as a bug.

Some policies are data rather than code (rent advance limits, evidence
requirements), so they can change without a migration when compliance settles
them.

The alternative considered and rejected: enforce in serializers and views as
each endpoint is written. It is faster initially and produces the drift this
codebase has already paid for once.
