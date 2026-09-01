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

## Not built in this slice

Phases 5–10: the provider billing UI, paid checkout, renewal and grace
transitions, admin billing controls, listing promotions, platform fees and
service commissions. The spec's own §31 says the first milestone is Portfolio →
plan → entitlements → limits, upgrade-ready, **before charging anyone**, and
that is what this is.

`BillingInvoice` is not modelled yet, on purpose: an invoice with no way to be
paid is a table shape guessed a phase early.
