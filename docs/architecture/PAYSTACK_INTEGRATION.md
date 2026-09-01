# Paystack — integration contract and go-live checklist

**Status: adapter, subaccount split, and batch-settlement importer written and
unit-tested. Not connected to Paystack. Disabled in every environment.**

Paystack was selected as Rooomly's first PSP on 28 August 2026. This file records
what the adapter does, what was verified against Paystack's published guidance,
what is still assumed, and exactly what has to happen before real money moves.

The code is `backend/apps/payments/paystack.py`. It implements
`providers.PaymentProvider`, so nothing outside that file knows Paystack exists.

---

## What is switched off, and how

Three independent things must all be true before a tenant sees a checkout:

1. `PAYMENT_BACKEND=paystack` — otherwise the registry returns
   `UnconfiguredPaymentProvider`, which refuses every operation.
2. `PAYSTACK_SECRET_KEY` set — otherwise the adapter raises
   `ProviderUnavailable` before any row is written.
3. `PAYSTACK_ALLOW_LIVE=true`, **but only for an `sk_live_` key.** A test key
   works without it; a live key does nothing without it.
4. `PAYSTACK_PLATFORM_CHARGE_BPS` set explicitly. Missing platform-share policy
   refuses checkout. Paystack's transaction fee is always borne by the provider
   subaccount.

The third is the one that matters. A secret key is a string somebody pastes into
an environment, and the difference between the test one and the live one is four
characters. The guard is on the key rather than on one operation, so a live key
cannot even authenticate a callback — a deployment nobody switched on cannot
process real money through a redelivered webhook.

There is a test for each of these.

---

## Verified against Paystack's published guidance (August 2026)

| Thing | What it is | Where it shows up |
|---|---|---|
| Webhook signature | HMAC-**SHA512**, hex, over the raw body, keyed with the secret key | `verify_webhook` |
| Signature header | `x-paystack-signature` | read case-insensitively |
| Amount unit | Subunits — **pesewas** for GHS. GHS 50 = 5000 | nothing converts; `amount_minor` *is* the pesewa |
| Mobile money | Ghana only, GHS only; networks MTN, AirtelTigo, Vodafone/Telecel | `channels=["mobile_money"]` |
| Verify endpoint | `GET /transaction/verify/{reference}` | `query_payment` |
| Guidance | Verify the signature, return 200, **then call verify before granting value** | `services._confirm_with_provider` |
| Split payment | `subaccount`, flat `transaction_charge`, and `bearer` | frozen on the intent and sent by `initiate` |
| Settlements | Batch: list settlements, then the transactions in each. **No per-transaction lookup** | `list_settlement_batches` + importer |
| Ghana institutions | Bank list with `country=ghana`, `currency=GHS`; `ghipss` and `mobile_money` types | payout-institution endpoint |
| Bank account confirmation | `GET /bank/resolve` with account number and bank code | confirmation before bank provisioning |

Paystack names the institution field differently across those two calls:
account confirmation sends `bank_code`; subaccount creation sends
`settlement_bank`. The adapter translates at that boundary so Rooomly's domain
continues to use one provider-neutral `bank_code` input.

SHA-512 is worth repeating because most providers use SHA-256, and a check
written from habit would pass nothing and be discovered in production. There is a
test that a SHA-256 signature is rejected.

---

## Decisions taken in the adapter, and why

**Paystack-hosted checkout, not the Charge API.** Every method goes through
`transaction/initialize`. The adapter retains both Paystack's hosted URL and
its transaction `access_code`: web resumes that server-created transaction in
Paystack Popup, while installed mobile clients can continue through the hosted
URL. In both cases Paystack owns the payment form and Rooomly never receives a
mobile-money PIN, OTP or CVV. Popup success is navigation only; the authenticated
webhook or a server-side verify query remains the authority for money movement.

**Our reference is the outbound idempotency key.** `client_reference` is sent as
Paystack's `reference`. Initiating twice with it returns the same transaction
rather than charging twice, which is what makes `retry_intent` safe.

**Channels are restricted to the method the tenant chose.** Otherwise a payer
offered every option could pay by card against a mobile-money intent, and
confirmation would reject a payment that really happened. If that ever occurs
anyway, the intent stays open and `reconciliation.sweep_open_intents` raises
`PROVIDER_SUCCEEDED_INTERNAL_PENDING` — the money is found, not lost. Failing
closed is safe here *because* reconciliation exists.

**An unmapped status or channel is refused, never guessed.** Paystack adding a
status Rooomly has not seen must not become a wrong balance by being mapped to
the nearest-looking value.

**A timeout is not a failure.** `requests.Timeout` raises `ProviderUnavailable`
with its own message, because Paystack may well have accepted the request.
Calling that a failure is how a retry charges somebody twice.

**Composed event ids.** Paystack sends no distinct event id, so the adapter uses
`{event}:{data.id}`. `ProviderWebhook` is unique on `(provider, event_id)`,
which is what makes a redelivery a no-op.

**The Portfolio is the beneficiary.** Paystack subaccounts are held on
`PayoutProfile.organization`, not on a team member. Checkout is refused unless
exactly one verified Portfolio both manages the property and includes the human
who signed the lease for the provider.

**Routing is immutable per intent.** Subaccount code/id, payout profile,
Portfolio, platform charge, and provider fee bearer are copied onto
`PaymentIntent` before checkout. Replacing a Portfolio's bank account cannot
redirect money already in flight. The tenant amount remains the authoritative
rent obligation; the owner subaccount bears Paystack's fee.

## Payout-destination provisioning

Paystack's create-subaccount API does not publish an idempotency-key contract.
Rooomly therefore does not treat a timed-out create as safe to retry:

1. The owner/admin request carries Rooomly's required `Idempotency-Key`.
2. A `PayoutProvisioningOperation` is committed before the external call.
3. Its UUID is sent in the subaccount metadata as
   `rooomly_provisioning_reference`.
4. A definite validation rejection closes the operation as failed. A timeout or
   unavailable response leaves it `needs_reconciliation` and returns `202`.
5. The scheduled worker lists Paystack subaccounts and recovers only an exact
   metadata match. It never repeats the create call.

The operation stores an HMAC fingerprint of the request for replay comparison,
not the account number. The resulting `PayoutProfile` stores masked display data
and provider tokens only. API serializers do not expose Paystack's subaccount
code or numeric id.

Provider setup lives on a dedicated screen on web and mobile rather than a
modal. Only a Portfolio owner or admin can enter it. Bank setup requires a
confirmed account name; Mobile Money setup uses the provider's current Ghana
network directory and remains subject to the sandbox checks below.

---

## Still assumed — confirm in the sandbox before going live

1. **Telecel's channel code.** Vodafone Ghana became Telecel in 2023. Paystack's
   documented provider codes are `mtn | atl | vod`. Whether `vod` still applies,
   or a `tel` code exists, was not confirmed. This only matters if Rooomly ever
   moves to the Charge API — hosted checkout picks the network itself — but it
   should be checked before that.
2. **Which events Paystack actually sends for a failure.** `charge.success` is
   certain. Whether a failed hosted-checkout payment produces a webhook at all,
   or only shows up on verify, changes how quickly a tenant is told. The status
   map covers `failed` and `abandoned` either way.
3. **`data.id` versus `data.reference` for refunds.** `refund_payment` sends the
   transaction id; Paystack accepts either in some versions.
4. **Settlement timing for Ghana**, which varies by channel and account.

None of these block writing the adapter. All of them block trusting it.

---

## Batch settlement import

`PaymentProvider.query_settlement(provider_transaction_id=...)` assumes a
provider can say what happened to one transaction's payout. **Paystack cannot.**
It settles in batches and exposes: list settlements, then list the transactions
inside one.

Building the per-transaction answer out of those would mean listing every
settlement and searching it, once per pending row. Wrong shape, and a lot of
calls to discover it.

The provider contract now has
`list_settlement_batches(since, provider_account_id)`. Paystack paginates both
the batch list and each batch's transactions; the adapter consumes every
advertised page with a defensive cap.

The hourly worker imports successful batches before reconciliation. It marks a
row settled only when the exact provider transaction id, amount, and currency
match the immutable Rooomly transaction for that snapshotted subaccount. Any
disagreement opens an exception and leaves the settlement pending. Re-importing
the same batch is idempotent.

---

## Lifecycle coverage — 31 August 2026

`tests/integration/test_paystack_lifecycle.py` runs the **whole** payment
lifecycle with Paystack as the configured adapter, against authentic Paystack
payload shapes, mocking only the `requests` boundary. Twenty-three tests.

This does not prove Paystack's Ghana sandbox behaves as documented — only an
account can, and every item below that needs one is still open. It proves the
half that is Rooomly's own: given a response of the shape Paystack documents,
this system does the right thing, and given a *wrong* one it refuses rather than
guessing. A failure there is now a Rooomly bug rather than an integration
surprise, and the sandbox exercise has a much shorter list to confirm.

| Behaviour | Covered |
|---|---|
| Checkout sends exact pesewas, split, bearer, callback URL | ✅ |
| Each channel restricted to what the tenant chose (momo/card/bank) | ✅ |
| Success → transaction, allocation, balanced ledger, receipt, pending settlement | ✅ |
| Callback cross-checked against `transaction/verify` before value is granted | ✅ |
| A callback verify does not recognise is refused | ✅ |
| Wrong amount / currency / method / reference all refused | ✅ |
| Unmatched reference recorded and raised by the sweep | ✅ |
| Redelivered webhook changes nothing, and re-queries nothing | ✅ |
| Late callback after the tenant already refreshed | ✅ |
| Out-of-order (stale) event cannot demote a settled payment | ✅ |
| Failure, then successful retry → one allocation, one `RentPayment` | ✅ |
| Timeout during initiation → resumable reservation, same outbound reference | ✅ |
| Abandonment → expiry, and the obligation is free again | ✅ |
| Partial payment across two intents settles exactly | ✅ |
| Settlement batch import; gross/fee/net; re-import is idempotent | ✅ |
| Settlement paying a different amount raises rather than accepts | ✅ |
| Lost callback recovered by reconciliation | ✅ |
| A disagreement recorded and never repaired | ✅ |
| Account-level events (`transfer.*`) acknowledged and ignored | ✅ |

**One defect this found.** `charge.failed` was not in `HANDLED_EVENTS`, so a
Paystack failure callback was acknowledged and ignored — the tenant would have
waited for their intent to expire on a payment the provider had already
declined, and the domain's complete failure path would never have been reached.
Now handled. Assumption 2 below is still unconfirmed; handling an event that
never arrives costs nothing, and ignoring one that does costs the tenant a wait.

---

## Go-live checklist

Ordered so that each step is reversible until the last. Items marked **[code]**
are now covered by the lifecycle suite above and need confirming rather than
discovering; everything else still requires a Paystack account.

### Commercial and regulatory

- [ ] Paystack Ghana business account created and verified.
- [ ] Paystack confirms Rooomly's use of organization-owned subaccounts and
      single-subaccount split payments for Ghana rent collection.
- [ ] Fee structure confirmed; set `PAYSTACK_PLATFORM_CHARGE_BPS` deliberately.
      Confirm in sandbox that `bearer=subaccount` deducts Paystack's fee from
      the provider settlement exactly as the dashboard reports.
- [ ] Settlement schedule confirmed for card and for mobile money.
- [ ] Ghana rent-receipt requirements (Act 220 s. 33) reviewed by counsel —
      see `docs/legal/GHANA_RESIDENTIAL_LEASE_CLAUSE_REVIEW.md`.

### Technical, in Paystack's sandbox

- [ ] `sk_test_` key in a non-production environment, `PAYMENT_BACKEND=paystack`.
- [ ] Set `PAYSTACK_CALLBACK_URL` to the deployed web return route
      (`https://<tenant-app>/payments/return`). Confirm the same HTTPS domain is
      associated with the iOS and Android app before relying on automatic
      mobile return; until then, mobile remains safe and refreshes when the
      tenant manually returns to Rooomly.
- [ ] Webhook URL registered; confirm Paystack reaches
      `POST /api/v1/webhooks/payments/paystack/`.
- [ ] One real sandbox payment on each channel: mobile money, card, bank.
      **[code]** — the request shape and channel restriction are covered; what
      the sandbox must confirm is that Paystack accepts them for a Ghana
      subaccount.
- [ ] Confirm the amount arrives as pesewas and matches `amount_minor` exactly.
      **[code]** — asserted on the outbound request; confirm against the
      dashboard figure.
- [ ] Redeliver a webhook from the Paystack dashboard; confirm the second
      delivery changes nothing. **[code]**
- [ ] Kill the worker mid-payment; confirm reconciliation finds the payment.
      **[code]** — and it now *applies* it rather than only raising, so confirm
      the recovered payment carries a receipt.
- [ ] A failed payment, then a successful retry on the same intent; confirm one
      allocation and one `RentPayment`. **[code]** — and confirm whether
      Paystack actually emits `charge.failed` for hosted checkout (assumption 2).
- [ ] A refund through `refund_payment`. **Not covered**: no refund execution
      path exists by design, so there is nothing to exercise beyond the adapter
      call itself.
- [ ] Create and verify a test subaccount; confirm list-settlement filtering uses
      the returned numeric subaccount id in Ghana.
- [ ] Confirm a successful split transaction appears in that subaccount's batch
      and that the imported gross/fee/net match the Paystack dashboard exactly.
      **[code]** — the arithmetic and the idempotent re-import are covered; the
      dashboard comparison is the part only an account can settle.
- [ ] Confirm a timed-out `transaction/initialize` followed by a retry with the
      same `reference` returns the *same* Paystack transaction rather than
      opening a second. **[code]** against the documented behaviour; this is the
      single assumption the whole recovery design rests on, so confirm it first.

### Before the first live payment

- [ ] `PayoutProfile` provisioned and verified for every Portfolio receiving
      money. Checkout already fails closed without it.
- [ ] Decide whether lease activation becomes payment-driven. ADR 0028 §8 keeps
      it acceptance-driven, and changing it needs a data migration for
      already-active agreements plus activation tests.
- [ ] `PAYSTACK_ALLOW_LIVE=true` set deliberately, by a person, with the live key.
- [ ] Reconciliation exceptions monitored. The application now escalates and
      delivers: an exception is posted to `PAYMENT_ALERT_WEBHOOK_URL` when
      opened, re-alerted while it stays unanswered, raised to `critical` past
      the breach window, and quietened — not closed — once acknowledged. What
      remains is a deployment decision: **set `PAYMENT_ALERT_WEBHOOK_URL` and
      `PAYMENT_ALERT_OWNER`, and name a rota.** See `docs/runbook.md`.

---

## What this adapter does not do

No payment-driven lease activation. No production enablement. It does not infer
commission or fee policy, and it does not claim the mocked implementation proves
Paystack's Ghana sandbox behavior; the checks above remain mandatory.

The lifecycle suite narrows what the sandbox has to discover. It does not
replace it.
