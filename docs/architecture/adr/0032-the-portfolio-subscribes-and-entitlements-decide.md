# ADR 0032 — The Portfolio subscribes, and entitlements decide

**Status:** accepted · 31 August 2026 · Monetization phases 1–4

## Problem

Rooomly needs paid provider plans. The two ways this normally goes wrong are
both structural and both expensive to undo later.

**Putting the plan on the user.** It reads naturally — a landlord upgrades — and
it breaks the moment anything real happens: a property company where four people
work in one paid workspace, a Portfolio handed to a new owner, one person
helping with two businesses on different plans. Unwinding it later means
migrating live subscriptions.

**Scattering plan checks.** `if portfolio.plan == "PRO"` in a property service
welds a commercial decision into domain logic. Repackaging then becomes a code
change in a dozen files, and every one of them is wrong the day an override, a
grace period or a fourth plan exists.

## Decision

### 1. The Portfolio is the subscriber

```text
User ─ membership ─> Portfolio ─> BillingAccount ─> Subscription ─> Plan ─> Entitlements
```

`BillingAccount` is one-to-one with `organization.Organization`. Nothing about
plans lives on `identity.User`.

### 2. Exactly three plans, and their codes are immutable

`FREE`, `PRO`, `BUSINESS`. `Plan.save` refuses a code change. Business limits
are configuration, which is what an Enterprise tier would otherwise have been —
a plan ladder grows hidden rungs the moment the vocabulary allows it.

### 3. Capabilities are named independently of plans

`Entitlement` names a capability or a limit; `PlanEntitlement` says what a plan
grants for it. Raising Pro's property limit or moving a feature between plans is
a data change with an audit trail, not a deploy.

Unlimited is `is_unlimited=True`, never a large number. A limit of 999999 is a
lie that eventually gets compared, printed or summed, and the first person to
see "999999 properties" on a billing screen learns something false.

### 4. One service answers "may this Portfolio do X"

`entitlement_service.can`, `.limit`, `.assert_within_limit`. Resolution is
override → entitled subscription's plan → Free.

Falling back to **Free** rather than to "deny everything" is deliberate: a
Portfolio with a missing billing row is a Rooomly bug, and the person on the
other end should lose the paid extras, never their tenants.

### 5. Domain modules import `billing.enforcement`, never a plan code

A test walks every Python file outside `apps/billing` and fails on a literal
`"FREE"`, `"PRO"` or `"BUSINESS"`. That is the invariant this ADR exists to
protect, so it is enforced rather than reviewed.

### 6. A limit is checked inside the transaction that takes the slot

Every `assert_can_add_*` locks the Portfolio row first. Counting properties and
then creating one in two transactions is how two concurrent requests both find
the last slot free. Held by a real two-connection test.

### 7. Usage is counted live, and there is no cache

The spec sketched a `PortfolioUsage` table. It is deliberately not built: a
stored count is a second answer to "how many properties does this Portfolio
have", and the first time it drifts it either blocks a customer who is under
their limit or lets one past it. The queries are indexed and only run on a
create. A display cache can be added later as an explicit, named cache — but the
enforcement path must never read something that might be stale.

### 8. A downgrade never deletes anything

*Amended 11 September 2026 — see "Safe downgrade restrictions" below. Nothing is
deleted, but what sits above the new allowance no longer stays lettable.*

A Business Portfolio with 24 properties that moves to Free keeps all 24. They
stay readable, editable and lettable; what changes is that a 25th cannot be
created, and `entitlement_service.over_limit` describes that state rather than
treating it as an error. **There is no code path that could delete a provider's
properties because of a billing event**, and there must never be one.

### 9. Billing failure never reaches the rental record

`GRACE_PERIOD` still grants entitlements — a renewal that failed this morning
has not taken away what was bought. After grace, premium *creation* closes and
nothing else: leases, tenants, rent history, receipts and audit records stay
reachable, because people have legal and practical need of them and a billing
dispute is not a reason to withhold them.

### 10. Billing and Payments stay separate

Billing answers *why Rooomly charges this Portfolio*. Payments Core answers *how
money moved*. When paid checkout lands it uses the existing provider-neutral
architecture — a `BillingInvoice` priced by the server, settled by a
`PaymentIntent` — and a second Paystack integration is not introduced. **A plan
is never activated because a client returned from a checkout page.**

## Trade-offs

- Every Portfolio now starts on Free with a one-property limit, so existing test
  fixtures that build several properties must state a plan. `conftest.upgrade_portfolio`
  makes that one readable line, and Free's limits stay real everywhere else.
- Plan values are cached for 60 seconds. A limit raised through the admin is
  visible within that window; the alternative is a query per check on every
  write.
- `BillingEvent` and `audit_log` both record plan changes. That is deliberate,
  not duplication: audit is the tamper-evident actor trail across the platform,
  `BillingEvent` is billing's own queryable timeline for plan history and
  revenue reporting. Both are written in one transaction and neither is derived
  from the other.
- Prices are `MoneyField` (integer minor units), not `Decimal`. The spec asked
  for Decimal; the requirement behind it — exact, never float — is what ADR 0006
  already gives, and a second money representation in one codebase is a
  duplicated source of truth. Tests assert exactness rather than the type.

## Not built in the first slice

Phases 5–10 were deferred: the provider billing UI, paid checkout, renewal and
grace transitions, admin billing controls, listing promotions, platform fees and
service commissions. `BillingInvoice` was not modelled, on purpose: an invoice
with no way to be paid is a table shape guessed a phase early.

---

## Amendment — 11 September 2026: subscription checkout

The boundary moved: a Portfolio can now pay Rooomly for a plan. Decision §10 is
what it was built on, and it held — **a plan is activated only by a
server-confirmed payment**, through the existing Payments Core, with no second
Paystack integration.

**`BillingInvoice` is the obligation.** Issued under a lock on the billing
account, priced from the plan row for the chosen interval, less a credit for
already-paid unused time on the current plan (integer microseconds and pesewas,
rounded in Rooomly's favour by at most a pesewa). One open invoice per account
at the database. An open invoice can start a payment for 60 minutes and is then
repriced; paid and void invoices are final, refused by the model and by a
PostgreSQL trigger.

**`PaymentIntent.purpose` separates rent from subscriptions on one rail.** A
check constraint makes the two shapes exclusive — rent names a tenant, lease and
`RentCharge`; a subscription names a `BillingInvoice` and the owner or
administrator who initiated it — and a partial unique index allows one open
intent per invoice. Confirmation stays in `payments._process_verified_event`, so
the signed webhook, a provider query and the reconciliation sweep apply the same
checks. A subscription success writes the immutable transaction, a
`PaymentAllocation` to the invoice, two ledger lines against
`subscription_invoice:{id}` and a frozen `rooomly.subscription_receipt.v1`
receipt, then calls `billing.invoice_service.settle` in the same transaction.
There is no `Settlement` row: the money is Rooomly's, not a beneficiary's. Rent
and subscription outcomes emit different events, so no rent handler ever sees a
subscription.

**Settlement refuses rather than guesses.** Money for an invoice that was
replaced, or for a subscription whose plan changed while the payer approved the
charge, raises; the webhook is recorded as failed and reaches the reconciliation
queue for a person. Cancelling a checkout asks the provider first and refuses if
the provider cannot say nothing was taken.

**Subscriptions are prepaid.** Mobile money has no card on file to charge again.
A paid period ends; the `billing.advance_subscriptions` sweep then moves a
cancelled subscription to Free, applies a scheduled downgrade, and puts an unpaid
next period into `GRACE_PERIOD` (seven days, still entitled, §9), then
`PAST_DUE`. Renewal is a checkout: early (extends from the period end), in grace
(pays for the time grace covered) or past due (starts on payment). A downgrade
during a paid period is scheduled for its end; otherwise it is immediate.
Administrative grants through `change_plan` carry no paid period, so they are
complimentary and are never swept into grace.

**Endpoints.** `GET billing/quote/`, `POST billing/checkout/` and its `refresh`,
`retry` and `cancel` use the external-call idempotency mode (ADR 0027) with a
required key; `POST billing/plan-change/` and `keep-plan/` use the transactional
mode. Owner and administrator only; accountants read billing and invoices. The
Portfolio billing read now carries `viewer`, `checkout`, `renewal`, `invoices`
and `usage_for_limit`, and no longer carries staff-written event reasons.

**Still not built:** automatic recurring charges on a saved card authorization,
grace and past-due reminders, refunds for downgrades, tax invoices,
payment-method management, native mobile checkout, listing promotions, platform
fees and service commissions.

---

## Amendment — 11 September 2026: safe downgrade restrictions

§8 promised that a downgraded Portfolio's properties "stay readable, editable
and lettable". That kept records safe, and it also let a paid plan's operating
capacity outlive the downgrade indefinitely: a Business Portfolio could move to
Free and go on letting 24 properties. **§8 is superseded in that respect.** A
downgrade still deletes nothing — no property, unit, tenant, agreement,
obligation, payment, receipt or history — and still ends nothing already running.
What sits above the new allowance keeps its records and its running tenancies,
and starts nothing new.

**Access is its own state, never the lifecycle.** `billing.ResourceAccess` holds
one row per restricted property or unit, in `WIND_DOWN` or `READ_ONLY`; no row
means `FULL`. A plan never writes `Property.status`, verification, publication,
occupancy, or a tenancy's or lease's status. Every access change is audited on
the property or unit (`changes.billing_access`, with the plan and the reason).

| State | Applies to | Still works | Refused |
| --- | --- | --- | --- |
| `FULL` | Within the allowance | Everything | — |
| `WIND_DOWN` | Above it, with something running: a tenancy `upcoming` or `active`, or a lease `offered`, `tenant_accepted`, `awaiting_activation` or `active` | Existing tenants' access; the agreement already offered or in force, to its end; rent obligations, recording and confirming payments, receipts and history; upkeep of what exists | New tenants, join requests and their approval; new leases, offers and renewals; listings created or published — a listing already up leaves discovery until the resource is reactivated; applications, viewings, access codes; new units, buildings and beds |
| `READ_ONLY` | Above it, with nothing running | Every record, payment, receipt, export and the audit trail | Everything `WIND_DOWN` refuses, and editing the property's or unit's details, amenities and photos |

`WIND_DOWN` settles to `READ_ONLY` when the last tenancy or agreement stops
running — in the same transaction as `end_tenancy`, `decline_lease` and
`cancel_lease`, with the 15-minute `billing.reconcile_resource_access` sweep as
the backstop. A restriction never lifts on its own.

**Who stays fully active is the provider's choice, then a documented order.** A
downgrade quote carries `resource_choice`: the fully active properties with their
units, the plan's limits, the limits the choice `covers`, and `selected` — the
saved `KeepActiveChoice`, or what the fallback would keep. Without a choice, and
for any place a choice leaves open, the fallback keeps the properties with the
most running units first, then the oldest, then by id; inside a kept property,
units with something running first, then the oldest. `POST billing/plan-change/`
accepts `keep_active` and refuses a choice above the plan's limits, outside the
fully active resources, or naming units outside the properties kept. A scheduled
downgrade keeps the choice until its period ends; keeping the plan discards it.
Both clients open the review on `selected` and ask for a whole choice, so what the
review shows is what happens. Neither ever chooses on a provider's behalf.

**Restrictions are written wherever the enforced limits fall.** `change_plan` (an
immediate downgrade), a scheduled downgrade reaching its period end, grace ending
in `PAST_DUE`, and an override that lapses or is revoked all run
`resource_access_service.reconcile`, which only ever restricts. Past due
restricts because its limits are Free's; §9 still holds, and every record stays
reachable.

**Coming back is deliberate.** Upgrading, or archiving a fully active property,
makes room; nothing is reactivated by itself, because an access state changing
without the provider asking is its own surprise. `POST
billing/resource-access/reactivate/` (owner or administrator, required
idempotency key) takes the Portfolio lock, counts the allowance again and refuses
with `plan_limit_reached` when there is no room; a unit inside a restricted
property cannot come back on its own. Restoring an archived property or unit is
checked against the allowance the same way.

**Enforcement stays behind the billing seam.** Domain services call
`billing.enforcement` — `assert_open_for_new_activity`,
`assert_accepting_requests`, `assert_details_editable`, `accepts_new_activity`,
`rental_activity_ended` — inside their own transactions, and the API answers
`409 resource_restricted` naming the resource, its state and the refused action.
No domain module checks a plan. Discovery drops restricted units in its read
model instead of rewriting listings. Property and unit reads carry
`billing_access` (state, label, message) so clients can show a restriction; they
decide nothing, and an action a client offers anyway is refused by the API.

**Counting.** A new property or unit needs a place that is fully free:
`assert_capacity` counts fully active resources under the Portfolio lock. The
billing read reports them as `active_usage`, beside `usage` (everything held) and
`resource_access` (active, winding down, read-only, limit and room, per kind,
with the restricted resources listed). Unit counts exclude archived properties.

**Held by** `tests/integration/test_billing_resource_access.py` (37 tests: within
and above the limits, the fallback order, choosing properties and units, a
scheduled downgrade applying the choice, wind-down and read-only, rent recorded
and confirmed while winding down, an offer already sent still accepted, the last
tenancy ending, the sweep, refused agreements, listings, discovery, requests,
access codes and new spaces, upgrades that make room without reactivating,
archive and restore, grace running out, and the API refusing what a client might
still offer) and by a two-connection test that two reactivations cannot both take
the last place.

**Unchanged.** Team members above a plan's limit keep their access; adding more
stays refused until there is room. No restriction deletes, cancels or refunds
anything, touches a rent obligation, or hides a receipt.
