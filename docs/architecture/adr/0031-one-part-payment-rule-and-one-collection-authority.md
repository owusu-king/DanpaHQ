# ADR 0031 — One part-payment rule, and one authority for collection readiness

**Status:** accepted · 31 August 2026 · Payment integrity checkpoint

Supersedes the deferrals recorded in ADR 0028's amendment ("No partial payment")
and closes two of the three blockers named in
`docs/architecture/PAYMENT_IMPLEMENTATION_STATUS.md`.

## Problem

The payment audit of 31 August 2026 found two questions the system was answering
twice, differently.

**Part payment.** `rent.record_payment` has always accepted part of an
outstanding charge — a tenant who brings two thirds of the advance in cash gets
it recorded, and `ChargeStatus.PART_PAID` exists for exactly that. Digital
checkout required an intent to equal the whole outstanding balance. The same two
thirds was therefore acceptable if it was handed over in a stairwell and refused
if it went through the processor. That is not a conservative policy; it is a
policy that depends on which door the money came through, and it pushes exactly
the payments Rooomly most wants on-platform off it.

**Collection readiness.** `PropertyCapability.PAYMENT_COLLECTION` was computed
from a *person's* `BANK_ACCOUNT` trust stamp. The payment path resolved a
*Portfolio's* provider-verified `PayoutProfile`. A provider could be told
payments were not ready while checkout worked, or told they were ready while an
intent would fail closed. The same flag was also being used for a third,
unrelated question — whether somebody may record an off-platform payment —
which is neither of those things.

## Decision

### 1. One part-payment rule, on the server, for both rails

`payments.resolve_payable_amount` is the single rule:

- the amount is a **request, not a price**: a client may ask, and the server
  bounds it against the obligation's outstanding balance read under
  `SELECT ... FOR UPDATE`;
- it must be positive and no greater than what is outstanding, so **overpayment
  remains impossible**;
- a part payment must be at least `PAYMENT_MINIMUM_PART_MINOR` (default 5000
  pesewas), **except** that settling the whole remaining balance is always
  allowed however small it is.

The floor is not squeamishness about small amounts. The receiving Portfolio
bears the processor's transaction fee (ADR 0030), so unbounded micro-payments
are a cost transfer onto the person owed the money. The exemption for a final
balance is what stops the floor trapping somebody who genuinely owes less
than it.

The confirmation check against the obligation changes from equality to an upper
bound. A part payment is deliberately less than the balance; what must never
happen is money arriving against an obligation that has since *shrunk* below it.
That still fails closed and reconciles by hand.

### 2. One authority for whether rent can be collected here

`payments.payouts._verified_destinations` is the single queryset. Two callers
read it and cannot drift apart:

- `eligible_payout_profiles(prop, member, provider_name)` — the routing an
  intent freezes at checkout;
- `ready_payout_organization_ids(user, provider_name)` — the capability layer,
  in one query for a whole portfolio.

`PropertyCapability.PAYMENT_COLLECTION` now means exactly one thing: *rent can
be collected through Rooomly for this property*, which requires an available
payment rail and — where the rail settles to subaccounts — a Portfolio the
member belongs to holding a verified, selected destination.

Recording an off-platform payment is separated back out and follows
`PropertyCapability.LEASES`, the authority the lease-ledger endpoint has always
enforced. Cash already changed hands outside Rooomly; a provider with no payout
destination has not lost the ability to acknowledge money they were handed.

## Why this direction

Both decisions resolve an inconsistency by **removing a restriction that only
existed on one side**, rather than by adding one to the other. The alternatives
were available and were rejected:

- *Forbid external part payments too.* This would make the product refuse to
  record money a landlord has actually received. The record would still be true;
  Rooomly would simply not hold it.
- *Keep the personal bank stamp as the readiness authority.* It is about a
  person, and a Portfolio outlives whichever member is signed in. Money must not
  follow a team member out of the door, which is the reason `PayoutProfile` is
  Portfolio-scoped in the first place.

## Trade-offs

- A provider receiving four part payments pays four transaction fees instead of
  one. `PAYMENT_MINIMUM_PART_MINOR` bounds it; whether the default is right for
  this market is a commercial question the first live cohort answers.
- Overpayment is still refused outright, on both rails. Whether a surplus should
  become a credit against the next period remains undecided, and is now the only
  remaining gap between what a tenant can hand over and what the product takes.
- `property_capabilities` gained an optional per-request `cache` so a prepared
  portfolio list stays constant-cost. Without it the readiness check would have
  been a query per property and the guarantee in
  `tests/integration/test_property_list_queries.py` would have broken.
- No part-payment UI exists. The server contract is live and both clients pass
  the amount through, but they still offer the full balance. That is product
  work and belongs with checkout exposure, which has not happened.

## Security and migration impact

No migration. No schema change. `PaymentAllocation`, `RentCharge.PART_PAID` and
`rent._resettle` already expressed part payment; only the intent-creation bound
and the confirmation comparison changed.

Overpayment, cross-currency allocation, duplicate transactions and the
one-open-intent-per-obligation constraint are untouched. A client that sends no
`amount_minor` behaves exactly as before.

The readiness change is a *narrowing* in production: with no configured adapter,
`payment_collection` is now false for everybody, where it previously depended on
a trust stamp unrelated to whether money could move. Nothing that was refused
before is permitted now.
