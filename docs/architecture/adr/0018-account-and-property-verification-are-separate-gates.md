# ADR 0018: Account and property verification are separate gates

**Status:** accepted, 16 August 2026. Supersedes the capability matrix in
[ADR 0017](0017-progressive-property-capabilities.md).

## Context

ADR 0017 required current phone, identity **and** property-specific authority
for tenant access and leases. That collapsed two different questions into one
gate, and the cost was paid by the most ordinary user we have: a landlord with
four units who wants the platform for rent records and nothing else.

That landlord already knows their tenants. They have their phone numbers. The
tenancy exists whether or not we bless it. Requiring them to submit an indenture
or a management agreement, and to wait for a human reviewer, before they can
write down a tenancy that started two years ago asks them to prove something to
us that nobody in the arrangement disputes — and asks it at the exact moment
they are deciding whether this product is worth the trouble. Meanwhile the
review queue fills with documents for properties nobody intends to advertise,
which slows the reviews that actually protect someone.

## Decision

Split the trust bases by what they answer, and gate each action on the one that
is actually load-bearing for it.

**Account verification** (phone + identity, subject `user`) answers *who is
this person*. Earned once, it travels with them to every property they touch.

**Property authority** (subject `property`, per property) answers *does this
person control this address*. It is reviewed against evidence and does not
generalise to their other properties.

| Capability | Requires |
| --- | --- |
| `private_inventory` | property access only |
| `tenant_access` | account verification |
| `leases` | account verification |
| `publication` | account verification + property authority |
| `payment_collection` | account verification + property authority + receiving account |

The dividing line is who bears the risk of the claim being false. A private
tenancy is an arrangement between two people who found each other outside the
platform and can each walk away; the platform needs to know who the manager is,
and the tenant confirms the relationship by accepting a phone-bound invitation
or having their join request approved. An advertisement makes a claim to
strangers who have no way to check it, and rent collection moves their money.
Those two wait for a reviewed authority document.

Neither basis substitutes for the other, and the tests assert both directions:
an approved authority document held by an unidentified account reaches nothing
beyond private inventory, and a verified account cannot advertise a property
whose authority has not been reviewed.

Advertising stays an explicit, per-unit act. Approving a property's authority
grants the *option* to publish; it publishes nothing. A property leaves the
private workspace only when someone creates a listing for one of its units and
submits it, and it reaches renters only after listing moderation approves it.

## Consequences

A verified person runs a private portfolio — units, tenants, leases, rent
records — immediately, and submits authority evidence per property only when
they choose to advertise it or collect rent through the platform. Verification
work now correlates with the properties that face the public, so the review
queue holds cases where review is what protects someone.

Revocation still bites at the moment of action, and the blast radius now follows
the same split: a lapsed identity check stops that person everywhere, while a
lapsed property authority suspends that property's listings and payment
collection without disturbing tenancies already recorded against it. Ending a
tenancy is a decision for the parties and, if it comes to it, a court; it is not
something an expiring document should do silently.

The exposure this accepts is that someone can record tenants against a property
they do not control. It buys them nothing: no listing, no discovery, no money
through the platform, and no badge — every public surface still reads the
property's own authority state, which stays unverified. What it costs them is a
verified identity attached to an audit trail, which is the trade we want.
