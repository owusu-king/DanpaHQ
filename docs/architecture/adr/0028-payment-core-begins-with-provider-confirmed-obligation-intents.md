# ADR 0028 — Payment Core begins with provider-confirmed obligation intents

**Status:** accepted · 2026-08 · Payment Core foundation

## Problem

The rental domain already has structured lease terms, `RentCharge` obligations,
an external/offline payment-claim workflow, audit, outbox and request
idempotency. The payment architecture calls for a dedicated provider-neutral
core, but no licensed PSP or payout-destination token contract has been selected.
The live lease workflow currently satisfies its explicit activation gate as
soon as both parties accept. Requiring payment at that gate before a real rail
exists would strand accepted tenants and break the completed rental lifecycle.

## Decision

1. `RentCharge` remains the authoritative rental obligation. Payment Core does
   not create a parallel obligation table.
2. A `PaymentIntent` is priced exclusively from one locked outstanding charge.
   The first version requires full settlement of that obligation and requires
   the existing HTTP `Idempotency-Key` protocol.
3. Provider adapters receive a stable server reference and own outbound retry
   semantics. An uncertain timeout must remain `processing`; an adapter must not
   raise after the PSP may have accepted the request.
4. Success enters through an authenticated provider webhook. Amount, currency,
   method, intent reference and provider transaction uniqueness are verified
   server-side before any balance changes.
5. A confirmed result creates an immutable `PaymentTransaction`, balanced
   non-custodial ledger lines, a durable receipt, a pending settlement record,
   and one `RentPayment` marked `verification_source=psp`. It never impersonates
   the existing two-party offline confirmation.
6. Transaction, ledger and receipt rows reject update/delete both in the model
   and through PostgreSQL triggers. Reversal and refund records will be
   additive; they will not rewrite the original success.
7. Production has no default payment adapter. The signed memory adapter is
   test-only. A real checkout is not exposed until a licensed PSP and a tokenized
   beneficiary/payout contract are selected and tested in its sandbox.
8. Lease activation remains acceptance-driven during this foundation slice.
   `awaiting_activation` and `activation_requirement` provide the boundary; a
   lease selects `initial_payment` only with the first operational PSP, a data
   migration for already-active agreements, and end-to-end activation tests.

## Why

This establishes the irreversible financial integrity boundary without
pretending Rooomly can move or settle money today. It reuses the obligations and
permission systems that already work, preserves the current rental lifecycle,
and leaves one explicit seam for a licensed PSP rather than embedding a vendor
SDK in rent or lease services.

## Trade-offs

- Digital checkout remains unavailable in production until PSP selection.
- Settlement is recorded as pending after payment confirmation; success does
  not claim that the beneficiary has received funds.
- One intent settles one complete obligation. Partial allocation and one payment
  across several obligations are deferred, but the transaction/ledger model can
  add allocation rows without changing existing history.
- The current beneficiary snapshot is the lease landlord. A real adapter must
  replace this with the selected PSP's verified, tokenized beneficiary contract
  before it is enabled for organization-managed payouts.

## Security and migration impact

The migrations are additive. Existing rent payments backfill to
`party_confirmation`; none become PSP-confirmed. The provider event table stores
payload hashes and processing metadata, not raw sensitive payloads. Forged
signatures, changed replay payloads, cross-tenant intent creation, amount or
currency mismatches, duplicate provider transactions, manual disputes of PSP
records, and missing idempotency keys fail closed.

---

## Amendment — 28 August 2026 (Implementation A and B)

Two of this ADR's trade-offs have been addressed without changing its decision.

**"One intent settles one complete obligation. Partial allocation and one
payment across several obligations are deferred, but the transaction/ledger
model can add allocation rows without changing existing history."**

`PaymentAllocation` now exists and carries every confirmed payment. The deferral
stands at the *rent-policy* level — an intent must still equal the whole
outstanding amount — but the model no longer prevents partial payment, and no
existing history was rewritten to add it.

**`PaymentTransaction.intent` was one-to-one and is now a foreign key.** That
shape made this ADR's own retry story impossible: a failed attempt wrote a
transaction, so the successful retry had nowhere to go. Failures are financial
history and stay; a partial unique index on `status='succeeded'` carries the
property that mattered. `PaymentAttempt` records the tries that produce no
transaction at all — a timeout, or a person who closed the app at the PIN
prompt — which are exactly the ones a provider never reports.

**"The current beneficiary snapshot is the lease landlord. A real adapter must
replace this with the selected PSP's verified, tokenized beneficiary
contract."**

`PayoutProfile` is that contract's Rooomly-side shape: one per organization, an
opaque provider token plus a masked display string, owner/admin only, every
change audited with the masked value and never the token. It is not yet wired
into settlement — `assert_can_receive_settlement` exists and nothing calls it —
because settlement still moves no money.

**Unchanged:** production has no PSP adapter, lease activation remains
acceptance-driven, and no fee model is encoded.

Reconciliation was added as a first-class capability rather than a later
concern: an hourly sweep that compares Rooomly's record with the provider's and
**opens an exception rather than repairing anything.** The reason to compare two
ledgers is that you do not know which is wrong, so a sweep that corrected what
it found could corrupt what it found.

See `docs/architecture/PAYMENT_IMPLEMENTATION_STATUS.md`.

---

## Amendment — 31 August 2026 (payment integrity audit)

Decision §8 is unchanged: lease activation remains acceptance-driven.

One amendment to the reconciliation principle stated above. "**Opens an
exception rather than repairing anything**" was written for the case it
describes — two ledgers that disagree, where you do not know which is wrong. It
was also being applied to a case that is not a disagreement at all: a lost
callback, where Rooomly holds no record and the provider is the only authority
on whether the payment happened. In that state the sweep recorded an exception
and stopped, and because the exception queue is deliberately unable to move
money, a tenant who had genuinely paid stayed uncredited unless they personally
returned to the app.

The sweep now applies provider-confirmed success through
`services.apply_provider_state` — the identical amount/currency/method,
transaction, allocation, ledger, receipt, settlement and audit boundary that a
signed webhook and a tenant's return-from-checkout both go through — recording
`evidence_source="reconciliation_sweep"`. Anything that boundary refuses opens
an exception carrying the refusal reason. Amount mismatches, currency
mismatches, settlement disagreements, reversals and unallocated money are
untouched: they are still only ever recorded.

`PaymentAllocation`'s role is also stated more precisely. It records which
obligation confirmed money answers for. It is not the arithmetic that settles a
charge — `rent._resettle` does that from confirmed `RentPayment` rows, because
an external cash payment has no transaction to allocate from. Making allocation
the single authority is an open decision.

See `docs/architecture/PAYMENT_IMPLEMENTATION_STATUS.md` §9 and §11.
