# ADR 0030 — Paystack is the first payment provider, behind a switch that is off

**Status:** accepted (28 August 2026), amended for subaccounts and settlement import
**Supersedes:** nothing. **Amends:** ADR 0028 §7, which left the PSP unselected.

## Decision

Paystack is Rooomly's first payment service provider. An adapter now exists at
`apps/payments/paystack.py` implementing the five-operation
`PaymentProvider` contract.

**It is disabled in every environment and has never contacted Paystack.**

## Why Paystack

It is licensed in Ghana, settles GHS, and covers the three channels this product
needs — mobile money, card and bank. Mobile money is the one that matters: it is
how rent is actually paid here, and a provider without it would be a card
gateway in a market that mostly does not use cards.

## What the adapter commits to

**Vendor vocabulary stops at the adapter.** Statuses, channel names, payload
shapes and identifiers are translated inside that file. `services` and
`reconciliation` do not know Paystack exists, which is the property that makes a
second provider — or a replacement — a new file rather than a migration.

**Hosted checkout rather than the Charge API.** Every method goes through
`transaction/initialize`. The Charge API would let Rooomly drive the mobile-money
PIN and OTP from its own screens; that is a nicer flow and one where a credential
passes through Rooomly's infrastructure. Never *receiving* a PIN is stronger than
not storing one, and the architecture's security section is worth more than a
screen.

**Our reference is the outbound idempotency key.** Initiating twice with the same
`client_reference` returns the same Paystack transaction rather than charging
twice. `retry_intent` depends on this.

**An unmapped status is refused, not guessed.** A status Rooomly has not seen
goes to reconciliation. Mapping it to the nearest-looking value is how a
provider's new state silently becomes a wrong balance.

**A timeout is not a failure.** Paystack may have accepted a request that timed
out, so it raises `ProviderUnavailable` rather than reporting a failed payment —
the distinction that stops a retry charging somebody twice.

## The live-mode guard

A test key works on configuration alone. A `sk_live_` key does nothing unless
`PAYSTACK_ALLOW_LIVE` is separately true.

The guard is on the **key**, not on one operation, so a live key cannot even
authenticate a callback. A secret key is a string somebody pastes into an
environment and the difference between test and live is four characters; this
makes that mistake cost nothing rather than cost a tenant's rent.

## Amendment: organization subaccounts and batch settlement import

Rooomly uses one Paystack subaccount per receiving Portfolio and initializes a
single-subaccount split payment. The Portfolio—not the human team member—is the
beneficiary. The intent snapshots its Portfolio, payout profile, subaccount code
and numeric id, flat platform charge, and Paystack fee bearer before checkout.

The platform share remains configuration rather than an architectural guess:
`PAYSTACK_PLATFORM_CHARGE_BPS` calculates the snapshotted flat
`transaction_charge`. Paystack's own transaction fee is a settled product
policy: `bearer=subaccount`, so the receiving property owner bears it and the
tenant is never surcharged above the authoritative obligation.

Paystack subaccounts are provisioned through an owner/admin-only domain service.
The raw bank account number is transient; it is sent to Paystack and never stored
or logged by Rooomly. Only provider references and masked display data remain.
A public mutation endpoint is deferred until retries can deduplicate against
Paystack after a lost response; database-only HTTP idempotency is insufficient
for an external subaccount-creation side effect.

## Consequence: settlement is a batch import

Writing this adapter found that `query_settlement(provider_transaction_id=...)`
assumes something Paystack cannot do. Paystack settles in **batches** — list
settlements, then list the transactions inside one. There is no per-transaction
payout lookup.

`PaymentProvider.list_settlement_batches(since, provider_account_id)` now models
that shape. The Paystack adapter paginates both batch and transaction lists. The
worker matches exact immutable provider transaction ids for the snapshotted
subaccount; only a successful matching batch marks a settlement complete.
Mismatches stay pending and become reconciliation exceptions.

## What is deliberately not decided here

- The platform charge basis points. Product/commercial owners still choose that
  value; the Paystack fee bearer is no longer undecided.
- Whether lease activation becomes payment-driven. ADR 0028 §8 still stands.

## Verification

The focused payment suites currently contain 67 passing tests, covering
signature authenticity (including that a SHA-256
signature is rejected — Paystack uses SHA-512), status and channel translation,
the live-mode guard, amount handling in pesewas, channel restriction, timeout
semantics, subaccount provisioning, split payloads, batch pagination, exact
transaction matching and idempotent import. Every outbound call is stubbed;
none of it proves Rooomly can take a payment, and it is not meant to.

`docs/architecture/PAYSTACK_INTEGRATION.md` carries the go-live checklist,
what was verified against Paystack's published guidance, and what is still
assumed. Nothing on that checklist is done.
