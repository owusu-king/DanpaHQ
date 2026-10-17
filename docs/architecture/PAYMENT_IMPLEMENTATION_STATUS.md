# Payments Core — implementation status and handover

**Checkpoint: 31 August 2026 — payment readiness complete, checkout still
closed.** The integrity audit, the three architectural blockers it found, and the
three readiness items after them: transaction boundaries, the Paystack lifecycle,
and an alert path that leaves the process. This file is the reconciliation
between `PAYMENT_ARCHITECTURE.md`, ADRs 0027/0028/0030/0031 and the repository.
It records what is true of the code, not what was planned. Where it contradicts
anything below it, this section wins.

**Checkout is not exposed and no production PSP is enabled.** Nothing in this
work changed that.

Written to be picked up by somebody who was not here.

---

## 1. Where this actually stands

**No money can move.** `PAYMENT_BACKEND` is empty by default, production refuses
`memory`, and a live `sk_live_` key does nothing without `PAYSTACK_ALLOW_LIVE`.
No Paystack sandbox or production request has ever been made; every adapter call
in every test is mocked. That caps the severity of everything below: the defects
found in this audit were latent, not live.

**Lease activation is still acceptance-driven** (ADR 0028 §8). Nothing in the
payment path activates a lease. `LeaseActivationRequirement.INITIAL_PAYMENT`
exists as a seam and nothing selects it.

**The domain is complete enough to switch on**, once the PSP checklist in
`PAYSTACK_INTEGRATION.md` is done and the open decisions in §11–§13 are made.

---

## 2. The implemented architecture

The chain the architecture document draws, as the code actually builds it:

```text
Portfolio (organization.Organization)
  └── PayoutProfile          one selected, provider-verified, Portfolio-scoped
Property → Unit → Lease      lease.Lease carries the financial terms
  └── RentCharge             the authoritative obligation; built once on activation
        └── PaymentIntent    server-priced, one open per obligation
              └── PaymentAttempt      one per try; at most one succeeds
              └── PaymentTransaction  the provider's fact; immutable
                    ├── PaymentAllocation   which obligation this money answers for
                    ├── LedgerEntry ×2      balanced, immutable
                    ├── Receipt             frozen snapshot + frozen PDF
                    └── Settlement          pending until a provider batch says otherwise
        └── ObligationAdjustment   waiver / write-off; immutable, never a payment
        └── RentPayment            the row rent settlement arithmetic reads
```

Two things about that diagram are worth stating plainly because the code and the
older prose disagreed:

**`RentCharge` is the only obligation table.** Payments never created a parallel
one. This is ADR 0028 §1 and it held.

**A charge's paid total is computed from confirmed `RentPayment` rows, not from
allocations.** `rent._resettle` sums `charge.payments.filter(status=CONFIRMED)`.
A PSP success writes *both* a `RentPayment` (marked `verification_source=psp`)
and a `PaymentAllocation`, in one transaction, and they are expected to agree.
An off-platform cash payment writes only the `RentPayment`, because there is no
provider transaction for an allocation to hang off. Earlier comments claimed
allocation was the sole authority; it is not, and
`reconciliation.sweep_unallocated_transactions` exists exactly to notice when
the two records diverge. Unifying them is an open design question (§11), not a
refactor.

---

## 3. Supported payment paths, and what each one does

Every path below was traced end to end through the code for this checkpoint.

| Path | Behaviour |
|---|---|
| **PSP success (webhook)** | Signature verified → event recorded → **provider re-queried for a second opinion** → intent locked → amount/currency/method/reference checked → `RentPayment(psp, confirmed)` + immutable `PaymentTransaction` + `PaymentAllocation` + 2 ledger lines + `Receipt` (snapshot **and** frozen PDF) + pending `Settlement` → competing intents cancelled → audit `money_movement` + `payment.succeeded.v1` |
| **PSP success (tenant returns from checkout)** | `POST /payments/intents/:id/refresh/`. The client supplies no financial fact; the server queries the PSP and runs the answer through the *same* function as a webhook |
| **PSP success (webhook lost)** | The hourly sweep queries the provider and applies the result through that same function. New in this checkpoint — see §9 |
| **PSP failure** | One `PaymentTransaction(failed)` per provider transaction id, attempt concluded `failed`, intent `failed`, `payment.failed.v1`. The failure is kept: it is what a person disputing a charge needs |
| **Abandoned / expired** | `expires_at` (default 30 min) + `payments.expire_intents` every 5 minutes. Expiry releases the one-open-intent gate |
| **Retry** | `POST /payments/intents/:id/retry/` reopens the *same* intent with a new numbered attempt. The provider is re-initiated with the same `client_reference`, which is the outbound idempotency key, so it returns the same transaction rather than charging twice |
| **Duplicate request** | `Idempotency-Key` is mandatory on all three intent mutations; a replay returns the first response with `X-Idempotent-Replay: true`. The DB constraint `payments_one_open_intent_per_obligation` is the backstop |
| **Duplicate / replayed webhook** | `(provider, event_id)` unique; a reused id with different bytes is a 409; an already-processed event short-circuits before the provider is re-queried |
| **Amount / currency / method mismatch** | Refused before anything posts, at three points: the callback vs the provider's own record, the callback vs the intent, and the intent vs the obligation's current outstanding balance |
| **Overpayment** | Impossible: an intent must equal the whole outstanding amount, `allocate` refuses to exceed the collectible amount, and `record_payment` refuses to exceed the outstanding balance |
| **Partial payment** | **Allowed on both rails, under one rule.** Positive, no more than is outstanding, and — unless it clears the whole remaining balance — at least `PAYMENT_MINIMUM_PART_MINOR` (default GHS 50). See §3.1 |
| **External cash / direct MoMo / bank** | `POST /rent/payments/` records a *claim*. Whoever records it cannot confirm it. Only a confirmed claim moves a balance |
| **Tenant confirms an external payment** | `POST /rent/payments/:id/confirm/` by the other party → `_resettle` → an external `Receipt` frozen against the `RentPayment` |
| **Tenant disputes** | `POST /rent/payments/:id/dispute/`. Never deletes the claim. Refused outright for a PSP-confirmed payment — that requires reconciliation, not the offline workflow |
| **Refund / reversal** | `Refund` is an additive model with a working adapter operation, and **nothing creates one**. Deliberate: see §10 |
| **Settlement** | `pending` on confirmation. Only a successful Paystack settlement batch containing that exact provider transaction id makes it `settled`. Disagreement opens an exception and leaves it pending |
| **Post-tenancy** | An ended lease keeps its incurred arrears, stays payable through the same intent path, and can be closed with waivers/write-offs. §8 |
| **Concurrency** | Row locks on the obligation, the intent, the webhook, the settlement, the lease and the charge; partial unique indexes carry the invariants that a service could forget to check |

### 3.1 Part payment

`rent.record_payment` has always accepted part of an outstanding charge. Digital
checkout demanded the whole balance. The same two thirds of an advance was
therefore recordable if it was handed over in a stairwell and refused if it went
through the processor — which pushed exactly the payments Danpa HQ most wants
on-platform off it, and made the product's own rule depend on which door the
money came through.

There is now one rule, `payments.resolve_payable_amount`, enforced on the server
for both rails:

- the amount is a **request**, never a price: the client may ask, and the server
  bounds it against the obligation's locked outstanding balance;
- it must be positive and no greater than what is outstanding, so overpayment
  remains impossible;
- a part payment must be at least `PAYMENT_MINIMUM_PART_MINOR` (default 5000
  pesewas). **Settling the whole remaining balance is always allowed however
  small it is**, so the floor can never trap somebody who owes less than it.

The floor exists for one reason: the receiving Portfolio bears the processor's
transaction fee (§6). Without it, forty payments of one pesewa would cost a
landlord forty fees to collect forty pesewas, which is a cost transfer onto the
person owed the money.

Omitting the amount means the whole outstanding balance, which is what every
current client sends. `digital_payment` now carries `allows_partial`,
`minimum_part_minor`, `outstanding_minor` and `currency` alongside the existing
fields, so a client never has to infer the rule it will be judged by — and every
refusal returns the same keys, so no client has to feature-detect a "no".

One consequence worth stating: the confirmation check against the obligation
changed from equality to an upper bound. A part payment is deliberately less
than the balance; what must never happen is money arriving against an obligation
that has since *shrunk* below it — a waiver landing mid-flight, or another
payment settling first. That still fails closed and reconciles by hand.

**Not built:** a UI for choosing a part amount. The server contract exists and
the clients pass the amount through, but both still offer the full balance. That
is product work, and it belongs with the checkout exposure this checkpoint stops
short of.

---

## 3.2 Transaction boundaries at the provider edge

**Nothing holds a database transaction while a provider is answering.** This was
the last structural risk on the checkpoint and it was ADR 0027's own constraint
being broken by the endpoints that mattered most: `create_intent` took
`SELECT ... FOR UPDATE` on the tenant's `RentCharge`, `idempotent_mutation`
wrapped the view in one transaction holding a `pg_advisory_xact_lock`, and
Paystack was called inside both with a twenty-second timeout. Every checkout,
retry and status refresh pinned a connection and a rent row for as long as the
provider took.

**Three phases: reserve, call, record.**

```text
  reserve   ── atomic, short ──  lock the obligation, validate, price,
                                 write the intent (status `created`), COMMIT
  call      ── nothing held ──   provider.initiate(intent)
  record    ── atomic, short ──  lock the intent, apply the answer,
                                 open the attempt, COMMIT
```

**Resuming is what makes it safe.** The reservation is durable *before* the
network call, so a lost or ambiguous response leaves a real intent to find
rather than nothing. `create_intent` called again for the same obligation,
amount and method resumes that intent instead of creating a second — and
`client_reference` is the provider's own idempotency key, so re-initiating
reaches the same provider transaction rather than opening a new one. An open
intent that already has a provider reference is returned rather than
re-initiated; one that never reached the provider and no longer matches the
tenant's request is cancelled rather than left holding the one-open-intent gate.

`retry_intent` is split identically.

**The HTTP layer needed a matching mode.** `idempotent_mutation(external_calls=True)`
commits the claim, runs the view holding nothing, then records the outcome. The
claim therefore needs a lease (`in_flight_until`, default 90s) so a request that
dies does not make its key permanently unusable, and taking over an expired
lease re-runs the request — which is only safe because the service resumes. A
5xx is recorded `failed` and retryable rather than rolled back, because the view
has already committed its own work. See ADR 0027's 31 August amendment.

Only the three payment endpoints use this mode. Everything else keeps the
one-transaction guarantee unchanged.

---

## 3.3 Paystack lifecycle coverage

`tests/integration/test_paystack_lifecycle.py` runs the whole lifecycle with
Paystack as the configured adapter, against authentic payload shapes, mocking
only the `requests` boundary: checkout, success, failure, timeout, abandonment,
retry, redelivery, late and out-of-order callbacks, wrong
amount/currency/method/reference, partial payment, allocation, ledger, receipt,
settlement import and reconciliation recovery.

It does not prove Paystack's sandbox behaves as documented — only an account
can. It proves that given a documented response this system is correct, and
given a wrong one it refuses. `PAYSTACK_INTEGRATION.md` marks which checklist
items are now covered in code and which still need the account.

**One defect it found:** `charge.failed` was not in `HANDLED_EVENTS`, so a
Paystack failure callback was acknowledged and ignored — the tenant would have
waited for their intent to expire on a payment already declined, and the
domain's complete failure path would never have been reached.

---

## 4. Financial invariants, and where each is enforced

"Enforced by" matters more than the invariant: a rule that lives only in a
service is a rule that the next queryset can walk past.

| Invariant | Enforced by |
|---|---|
| Money is never a float | `core.money.Money` (integer minor units) + `MoneyField` (BIGINT + CHAR(3)); no float arithmetic exists in `payments` or `rent` |
| Amount and currency are server-derived | `create_intent` prices from the locked `RentCharge`; the API accepts only `obligation_id` and `payment_method` |
| A frontend can never mark a payment successful | Every confirmation path goes through `_process_verified_event`, whose only inputs are a signed webhook or a server-side provider query |
| Webhooks are authenticated | Adapter `verify_webhook`; Paystack = HMAC-SHA512 over the raw bytes, constant-time compare |
| Webhooks are replay-safe | DB unique `(provider, event_id)`, payload-hash comparison, processed short-circuit |
| One successful attempt per intent | DB partial unique index `payments_one_successful_attempt_per_intent` |
| One successful transaction per intent | DB partial unique index `payments_one_successful_transaction_per_intent` |
| Provider transaction ids are globally unique | DB unique `(provider, provider_transaction_id)` |
| One open intent per obligation | DB partial unique constraint |
| Transactions, ledger lines and receipts are immutable | Model guard **and** PostgreSQL trigger (`payments/0002`) |
| **Allocations are immutable** | Model guard **and** PostgreSQL trigger (`payments/0013` — added by this audit) |
| **Waivers/write-offs are immutable** | Model guard **and** PostgreSQL trigger (`rent/0009` — added by this audit) |
| Ledger lines balance | `_create_ledger` writes exactly one debit and one credit of the same amount and currency per transaction |
| An allocation cannot exceed what arrived, or overpay a charge | `allocate`, refused rather than clamped; plus DB check `amount_minor > 0` |
| A part payment is bounded by the locked outstanding balance | `resolve_payable_amount` at intent creation, and an upper-bound recheck under `SELECT ... FOR UPDATE` at confirmation |
| Online collection readiness and checkout routing answer from one fact | `payouts._verified_destinations`, read by both `eligible_payout_profiles` (routing) and `ready_payout_organization_ids` (capability) |
| No transaction is held while a provider answers | Three-phase `create_intent`/`retry_intent`, `idempotent_mutation(external_calls=True)`; asserted from inside the adapter |
| An ambiguous provider response is recoverable | The reservation commits before the call; `create_intent` resumes it, and `client_reference` is the provider's idempotency key |
| A financial exception reaches a person | `alerts.deliver` posts to `PAYMENT_ALERT_WEBHOOK_URL` on open and on every escalation; acknowledgement quietens, never closes |
| An alert carries no tenant detail | `alerts.build_payload` is the only builder, and its exact key set is asserted |
| Payment success ≠ allocation | Separate rows, separate sweep (`sweep_unallocated_transactions`) |
| Payment success ≠ settlement | Separate model; `pending` until a provider batch says otherwise; the Portfolio read model never presents a pending fee or net as final |
| Refunds never rewrite the original | `Refund` is additive; the transaction is trigger-protected anyway |
| External payments never masquerade as PSP-confirmed | `RentPayment.verification_source`; a PSP row cannot enter the offline dispute workflow |
| Waivers never appear as money paid | `_resettle` never counts an adjustment as `amount_paid`; a fully adjusted charge becomes `waived`/`written_off`/`adjusted`, never `paid` |
| Ended leases keep real arrears | `close_schedule(through=today)` cancels only unrun future periods and never touches a charge with money against it |
| Payout destinations are Portfolio-scoped | `PayoutProfile.organization`; DB partial unique index allows one selected profile; owner/admin only |
| Payout routing cannot be redirected mid-flight | The intent snapshots organization, profile, subaccount code/id, platform charge and fee bearer |
| Financial permissions are server-side | `assert_property_capability`, `assert_may_manage_payouts`, `assert_obligation_capability`, Management `Capability.RECONCILE_PAYMENTS` |
| Sensitive financial actions are audited | `AuditAction.MONEY_MOVEMENT` on every posting, allocation, adjustment and settlement; `audit_log` is append-only by RLS |
| Reconciliation can detect disagreement | Four sweeps, hourly (§9) |

---

## 5. State machines

```text
PaymentIntent   created → pending → processing → succeeded
                                              ↘ failed → (retry) → pending
                                  ↘ expired
                                  ↘ cancelled        (another payment settled the charge)

PaymentAttempt  started → pending → succeeded | failed | timed_out | abandoned
                (numbered per intent; at most one succeeded, by index)

PaymentTransaction  succeeded | failed | reversed   — written once, never edited

RentCharge      due → part_paid → paid
                    ↘ waived | written_off | adjusted   (non-cash)
                    ↘ cancelled                          (the period never happened)
                effective_status adds `overdue` and `disputed`, both derived, never stored

RentPayment     claimed → confirmed → disputed
                (a PSP row is born confirmed and cannot enter this workflow)

Settlement      pending → settled            (only via a matched provider batch)
                       → processing | failed | reversed

ProviderWebhook received → processed | failed | rejected | ignored

ReconciliationException  open → investigating → resolved | accepted
                         (terminal; cannot be reopened through the API)

Refund          requested → approved → processing → completed | failed | rejected
                (no code path creates one yet)
```

---

## 6. The PSP boundary

Vendor vocabulary stops at `apps/payments/paystack.py`. `services` and
`reconciliation` see only `VerifiedProviderEvent`, `ProviderPaymentState`,
`ProviderRefundResult`, `ProviderSettlementState`, `ProviderSettlementBatch` and
`ProviderPayoutDestination`.

- Required: `initiate`, `verify_webhook`. Everything else raises
  `ProviderUnavailable` by default so a partially integrated provider is usable
  for the flows it does support.
- Danpa HQ never sees a PIN, an OTP, a CVV or a card number. All methods go
  through Paystack's hosted checkout.
- A raw bank/MoMo account number is passed straight through to Paystack during
  subaccount provisioning and never written to Danpa HQ's database or audit log.
  Only the `ACCT_` code, the numeric id, a masked display string and the
  provider's verification state survive.
- Subaccount creation has no documented Paystack idempotency key, so
  `PayoutProvisioningOperation` is committed *before* the call and its UUID is
  embedded in provider metadata. An ambiguous timeout is recovered by exact
  metadata lookup, never by a blind second create.
- The tenant pays the authoritative obligation with no surcharge. Paystack's
  transaction fee is borne by the provider subaccount (`bearer=subaccount`).
  That is product policy, hard-coded. The Danpa HQ platform share stays explicit
  basis-point configuration (`PAYSTACK_PLATFORM_CHARGE_BPS`) and is frozen per
  intent as a flat `transaction_charge`.
- The destination an intent routes to and the readiness a provider is shown on
  their dashboard are the same queryset. A provider is never told rent
  collection is ready when an intent would fail closed, or the reverse.
- An authenticated event that is not `charge.success` is acknowledged with 200
  and recorded `ignored`. Refusing account-level events makes a provider retry
  them and eventually disable the endpoint real payments arrive on.

---

## 7. External / off-platform payments

The rule is the whole point: **whoever records a payment cannot confirm it.**

- Either party may record. A provider additionally needs Property `leases`
  authority — and deliberately **not** a Danpa HQ receiving account, because the
  cash or transfer already reached them outside Danpa HQ. The separate
  `payment_collection` capability, which does turn on a verified receiving
  account, describes platform collection.
- A claim moves no balance. Only a counterparty confirmation does.
- A confirmed external payment issues a `Receipt` against the `RentPayment`,
  with `source=EXTERNAL` and `evidence=COUNTERPARTY_CONFIRMED`. It never
  produces a `PaymentTransaction`, allocation or settlement: those are PSP
  facts.
- Disputing sets `disputed`, preserves the claim, and re-derives the balance.
- `ADMIN_VERIFIED` exists in the evidence vocabulary and has no workflow behind
  it yet.

---

## 8. Post-tenancy

Ending a tenancy and resolving its money are independent. `lease.ended.v1` →
`close_schedule(through=today)` cancels only unpaid charges for periods that
will not happen; incurred arrears, disputes, history, receipts and live refund
credits survive. An ended lease stays payable through the same server-priced
intent path.

Waiver and write-off are immutable `ObligationAdjustment` rows carrying amount,
reason, actor and timestamp. They are restricted to the creditor/property owner
or an owning Portfolio owner/admin — property managers, accountants, staff and
property assignees do not inherit them — and are **lifecycle-gated to after the
tenancy has ended**. The closing summary is a read model over charges, confirmed
payments, adjustments and decided refund credits; there is no mutable balance
column.

---

## 9. What this audit changed

Every item was a confirmed defect reproduced against the code first.

**P1 — financial correctness**

1. **Allocations and obligation adjustments were immutable in Python only.**
   `QuerySet.update()` and `QuerySet.delete()` never call `Model.save`/`delete`,
   so a single line could silently rewrite which obligation a payment settled,
   or edit away a waiver. Transactions, ledger lines and receipts had carried a
   trigger since `payments/0002`; these had not. Added: `payments/0013`,
   `rent/0009`.

2. **A confirmed payment with no completion time crashed mid-post.** Paystack's
   adapter let an unparseable `paid_at` through as `None`; the confirmation then
   raised `AttributeError` while writing the `RentPayment`, which reached the
   provider as a 500 and was retried for ever, leaving the webhook row stuck at
   `received` where nothing looked at it. Now refused at the adapter *and* at
   `_process_verified_event`, so it is recorded and rejected like any other
   malformed callback. A final state with no provider transaction id is refused
   the same way — two such callbacks would otherwise have collided on the empty
   string against a unique index.

3. **A lost webhook was detected and never recovered.** The sweep opened a
   `provider_succeeded_internal_pending` exception and stopped, and the
   exception queue is deliberately unable to move money — so a tenant who had
   paid stayed uncredited unless they personally returned to the app and tapped
   refresh. The sweep now *ingests* provider-confirmed success through
   `services.apply_provider_state`, the identical boundary a signed webhook and
   a tenant's return both use, with `evidence_source="reconciliation_sweep"` in
   the audit record.

   **This narrows a documented rule, deliberately and not silently.** "The sweep
   never repairs" still holds for every genuine disagreement: an amount or
   currency mismatch, a settlement that paid the wrong figure, a reversal, money
   with no allocation. Those still only ever open an exception. What changed is
   the case that was never a disagreement — Danpa HQ holds *no* record and the
   provider is the sole authority on whether a payment happened. Anything the
   confirmation boundary refuses still opens an exception, now carrying the
   refusal reason. A `min_age_seconds` (default 300) keeps the sweep off
   payments whose callback is merely in flight.

4. **Authenticated provider evidence that could not be applied was invisible.**
   A callback refused for any reason — no matching intent, an obligation that
   changed underneath, a transaction id already spent — was recorded as
   `ProviderWebhook(status=failed)` in a table nothing ever queried. New sweep
   `sweep_unmatched_provider_events` raises those into the exception queue after
   30 minutes.

5. **Abandoned outbox claims were lost for ever.** Claiming a batch commits
   `processing` in its own transaction, and the dispatcher only ever queried
   `pending`/`failed`. A worker killed mid-batch therefore orphaned its events
   permanently: a lost `lease.activated.v1` means a live tenancy with **no rent
   schedule at all**, and a lost `payment.succeeded.v1` means a paid tenant with
   no receipt notification. `reclaim_stale_processing` returns claims older than
   15 minutes to the retry path; the claim now stamps `updated_at` so the grace
   period measures the claim rather than the row's last edit.

**P2 — correctness and consistency**

6. **`build_schedule` was a read-then-write with no lock.** Two deliveries of
   `lease.activated.v1` could each see no charges and each write a full
   schedule, and nothing in the table forbids the duplicate — a tenant billed
   twice for one tenancy. The lease is now the lock.

7. **`dispute_payment` did not lock the charge** while `confirm_payment` did.
   Both end in `_resettle`, which recomputes from every confirmed payment, so a
   dispute and a confirmation of two claims against one charge could each read
   the set before the other committed and the later write would discard the
   earlier.

8. **Rent's financial mutations ignored `Idempotency-Key`.** Recording an
   external payment, confirming, disputing, waiving, writing off and recording
   an expense had no replay protection, against ADR 0027's own class of
   "high-impact financial mutation". The web and mobile clients were *already
   sending keys* for most of them; the server discarded them. Now honoured
   (optional header, per ADR 0027's installed-client rule); the two expense
   endpoints now send keys too.

9. **Unrelated provider events were refused with a 4xx.** A Paystack account
   emits transfer, dispute and identification events; each was answered with 400
   and retried indefinitely. Now acknowledged and recorded `ignored`.

**P3 — observability**

10. **Structured logs dropped their diagnostics.** The JSON formatter copied a
    six-key allowlist, which did not include `detail` or `status` — the exact
    fields the reconciliation, settlement-import and Paystack warnings carried.
    Operators got "something failed" with the reason removed. The allowlist now
    covers the keys in use, and string values are redacted like the message.
    Two log sites that had been smuggling counts through the `provider` field
    now say `count`.

11. **A replayed webhook re-queried the provider** before the
    already-processed short-circuit. A redelivery storm became a query storm.

**The three architectural blockers, resolved**

14. **Partial payment: one rule for both rails.** See §3.1. This is a
    deliberate product decision, taken in the direction that removes an
    inconsistency rather than adding a restriction: the external rail's existing
    bounds became the digital rail's bounds too, with a fee-driven floor that
    can never trap a small final balance. Overpayment stays impossible.

15. **One authority for "can rent be collected here".** `payment_collection`
    read a *person's* `BANK_ACCOUNT` trust stamp while the payment path resolved
    a *Portfolio's* provider-verified destination, so the dashboard and checkout
    could disagree in either direction. `payments.payouts._verified_destinations`
    is now the single queryset; `eligible_payout_profiles` serves the routing an
    intent freezes, and `ready_payout_organization_ids` serves the capability
    layer in one query.

    Two questions had also been collapsed into that one flag, and are now
    separated: **recording an off-platform payment follows `leases`** — the same
    authority the lease-ledger endpoint has always enforced — because cash
    already changed hands outside Danpa HQ, and a provider with no payout
    destination has not lost the ability to acknowledge money they were handed.
    The portfolio summary's `can_record_payment` read collection readiness and
    now reads `leases`. Client copy that described the removed receiving-account
    rule was corrected on both platforms.

    `property_capabilities` takes an optional per-request `cache` so a prepared
    portfolio list stays constant-cost as it grows; the query-count guarantee in
    `test_property_list_queries.py` still holds.

16. **The exception queue has an owner.** `open_exception` now states the fact
    at `error` the moment it is found, with a stable `event` key and no tenant,
    amount or payload in it. `payments.alert_open_exceptions` runs every 30
    minutes and re-emits every unresolved exception — `error` past
    `PAYMENT_RECONCILIATION_AGEING_HOURS` (4), `critical` past
    `PAYMENT_RECONCILIATION_BREACH_HOURS` (24) — so an ignored queue gets louder
    instead of going quiet. The Operations workspace reports
    `oldest_open_age_hours` and `breached_exceptions`, so neglect is a number
    rather than something you notice by reading timestamps.

    Paging itself is a deployment binding, not application code: `docs/runbook.md`
    now carries the routing table, what each `ReconciliationKind` actually means,
    what fixes it, and the explicit statement that resolving records a decision
    and never moves money.

**Stale tests and outdated documentation corrected**

12. Two tests in `test_organization_and_occupancy.py` were failing before this
    audit began (verified against a clean tree) — one asserted the receiving-
    account rule that the last slice deliberately removed, the other compared a
    read-model row that had since grown `source` and `evidence`. Both now state
    the current rule. `api-contract.md` carried the old receiving-account claim
    and has been corrected.

13. `PaymentAllocation`'s own docstring claimed it was what makes an obligation
    paid. It is not — see §2.

---

## 10. Refunds and reversals

`Refund` exists, is additive, has a working Paystack adapter operation, and
**nothing creates one**. This is deliberate and should stay that way until the
reversing semantics are decided: completing a refund without a reversing
allocation and a rent-balance rule would leave the obligation falsely paid.

`closing_financial_summary` already treats an approved/processing refund as a
live credit and a completed one as history, so the read model is ready for
whichever semantics are chosen.

`TransactionStatus.REVERSED` and `ReconciliationKind.REVERSAL` exist; a provider
reversal opens an exception and is handled by a person.

---

## 11. Open product decisions

**Closed by this checkpoint:** partial payment (§3.1), the collection-readiness
authority (§9.15) and ownership of the exception queue (§9.16). What remains:

1. **Overpayment.** Refused outright. Whether a surplus should become a credit
   against the next period is undecided — and is now the only remaining gap
   between what a tenant can hand over in cash and what the product will take.
   Note that the external rail refuses it too, so the rails agree; this is a
   product question, not an inconsistency.
2. **One source of truth for "paid".** Whether to make `PaymentAllocation` the
   sole settlement arithmetic — which means giving external payments a synthetic
   transaction — or to keep the current dual record with a reconciliation sweep
   over it. See §2. Part payment makes this more visible, not more urgent: both
   records are still written in one transaction and still expected to agree.
3. **Who may change a payout destination.** Owner and Admin today. Extending to
   a Manager is a delegation change, not a client change.
4. **A part-payment UI.** The server contract is live and the clients pass an
   amount through, but neither offers the choice yet. Deliberately left with the
   checkout exposure this checkpoint stops short of.
5. **Who is actually on call.** The application now escalates and the runbook
   says what to do; assigning a rota and binding the alert events to a pager is
   a deployment decision that must be made before a live PSP.

## 12. Open PSP / regulatory decisions

1. **Paystack sandbox and production approval.** Nothing on the
   `PAYSTACK_INTEGRATION.md` checklist is done.
2. **Subaccount verification operations** must be observed and approved before a
   Portfolio can receive money.
3. **Settlement timing.** Ghana channel cadence needs sandbox confirmation; the
   importer deliberately does not invent an expected date.
4. **Ghana rent-receipt formalities.** The snapshot represents the particulars
   named in Act 220 s. 33. Whether an electronic receipt is sufficient, and
   stamping, remain questions for Ghana-qualified counsel. The product makes no
   compliance claim.
5. **Lease activation on payment.** ADR 0028 §8 stands. Flipping it needs the
   PSP, a data migration for already-active agreements, and activation tests.

## 13. Remaining risks

The structural risk that stood here — provider calls inside the request
transaction — is resolved (§3.2). What remains is smaller and named.

- **Alerting depends on the worker being alive.** `alert_open_exceptions` runs
  on the Celery worker, so a worker that is down cannot report that it is down.
  External liveness monitoring covers it and is a deployment item, not a code
  one.
- **The resume design rests on one provider assumption**: that Paystack returns
  the same transaction for a repeated `reference` on `transaction/initialize`.
  It is documented behaviour and the whole recovery path depends on it, so it is
  the first thing to confirm in the sandbox.
- **`RentCharge.amount_paid_minor` and `PaymentAllocation` are two records
  expected to agree.** A sweep notices when they do not. Unifying them is an
  open design decision (§11.2).
- **Beat must be a single replica.** The schedule is file-backed; two beats would
  double-fire reconciliation and reminders. Convention, not code.
- `Settlement.beneficiary` is still the lease landlord while payout is
  Portfolio-scoped; `beneficiary_organization` carries the real destination.
- Client-side amount entry converts major units with `Math.round(x * 100)`. The
  server re-derives and re-validates every figure.
- `ADMIN_VERIFIED` payment evidence has no workflow behind it.
- Part payment multiplies transaction fees for a provider receiving several
  small payments. `PAYMENT_MINIMUM_PART_MINOR` bounds it; whether the default
  floor suits this market is a commercial question.

## 14. Tests protecting these invariants

| File | What it holds |
|---|---|
| `tests/integration/test_payment_core.py` | Server-priced intents, signed confirmation writing every record exactly once, forged webhooks, ledger immutability, PSP rows outside the offline workflow, the API's idempotency and return-refresh contract, receipt snapshots surviving mutable records |
| `tests/integration/test_payment_domain.py` | Attempts (three tries pay once), allocation limits and immutability, payout destinations and their authority boundary, Paystack split routing and provisioning idempotency, the settlement batch importer, reconciliation |
| `tests/integration/test_payment_integrity.py` | **New, 32 tests.** Engine-level append-only for allocations and adjustments; a confirmation with no completion time or no transaction reference; account-level provider events acknowledged not refused; unmatched provider evidence reaching the exception queue; rent mutations replaying under one key. Plus the three blockers: part payment settling part of a charge and never overpaying one, the floor that does not trap a small balance, the two rails accepting the same amount, a waiver landing mid-flight; readiness and checkout refusing together and ignoring the personal bank stamp; and an exception that gets louder, stops when resolved, and carries no tenant detail |
| `tests/integration/test_paystack_adapter.py` | The adapter contract, in isolation from the domain |
| `tests/integration/test_payment_transaction_boundaries.py` | **New, 12 tests.** No transaction open while the provider answers; the obligation row lockable at that moment; a lost response resumable to the same provider transaction; a live checkout returned rather than duplicated; a callback that overtakes initiation not written over; concurrent duplicates, abandoned leases and replays at the HTTP layer |
| `tests/integration/test_paystack_lifecycle.py` | **New, 23 tests.** The whole lifecycle with Paystack configured — see §3.3 |
| `tests/integration/test_rent.py` | Obligations, the two-party confirmation rule, adjustments, reminders, closing summaries |
| `tests/integration/test_outbox.py` | At-least-once delivery, retry, dead-lettering, and **the reclaim of an abandoned claim** |
| `tests/unit/test_money.py` | Integer money, currency safety, lossless splitting |

Specifically worth knowing about the reconciliation tests: the case that used to
assert "nothing was repaired" for a lost callback now asserts the full financial
record is written, and a *new* sibling test asserts that a real disagreement
(an amount the provider does not agree with) is still only recorded.

---

## 15. Where to pick this up

Payment readiness work is complete. What is left before real money is not code:

1. **Set `PAYMENT_ALERT_WEBHOOK_URL` and `PAYMENT_ALERT_OWNER`, and name a
   rota.** The application escalates and delivers; nothing receives it yet.
2. **Do the Paystack sandbox checklist** in `PAYSTACK_INTEGRATION.md`. It is
   materially shorter than it was — the items marked `[code]` are covered and
   need confirming rather than discovering. Confirm the repeated-`reference`
   behaviour first; the recovery design rests on it.
3. **A real SMS adapter**, which blocks every user, not only paying ones — see
   `SYSTEM_INTEGRITY_STATUS.md`.
4. Then, and only then, the commercial and regulatory half of the checklist.

**Do not expose checkout, and do not enable a production PSP, until 1 and 2 are
done.** Production still has no adapter configured and that is the safe state.

Deliberately not built: refund execution, payment-driven lease activation, a
part-payment UI, wallet, escrow, lending, digital services.
