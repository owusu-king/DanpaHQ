# Danpa HQ — system integrity status

**Checkpoint: 31 August 2026.** Written to be picked up by somebody who was not
here. It records what is true of the code, not what was planned.

Companion documents, each authoritative for its own scope:

- `docs/architecture/PAYMENT_IMPLEMENTATION_STATUS.md` — the money domain
- `docs/deployment/PRODUCTION_DEPLOYMENT.md` — what production needs
- `docs/runbook.md` — day-to-day operation and payment on-call
- `docs/known-limitations.md` — what was considered and left undone

---

## 1. What was inspected

Backend (Django 5.1.5, 21 apps), web (Next.js), mobile (Expo/React Native),
PostgreSQL schema and 100+ migrations, Redis/Celery/beat, the transactional
outbox, authentication and authorization, Portfolio/team permissions, provider
and tenant workspaces, properties/units, listings, applications, viewings,
access-code and join flows, leases/tenancies/occupancy, rent obligations,
payments/ledger/allocations, receipts/settlements/refunds, reconciliation,
post-tenancy balances, notifications, audit logs, file and media handling, CI,
and deployment configuration.

The payment domain had already been audited twice in this session; this pass
re-verified it for regressions and covered everything else.

## 2. Critical workflows traced

The chain was walked end to end, and the walk is now **executable and in CI**
rather than a claim in a document:

```
Account → ProviderAccess → Portfolio → Property → Unit → Listing
  → Application/Viewing/Access request → Lease → Tenancy → Occupancy
  → Rent obligation → Payment → Allocation/Ledger → Receipt/Settlement
  → Lease end → Post-tenancy balance
```

| Test | Covers |
|---|---|
| `tests/integration/test_core_lifecycle_smoke.py` | Registration → provider verification → property → unit → listing → application → lease → tenancy → occupancy → rent schedule → external payment → counterparty confirmation → rental history |
| `tests/integration/test_money_lifecycle_smoke.py` | **New.** Checkout availability → part payment → forged callback refused → signed callback → transaction/allocation/balanced ledger/receipt/pending settlement → redelivery is a no-op → receipt authorization → lease end → surviving arrears vs cancelled future periods → waiver → closing balance → history unchanged |

Writing the second one immediately found a defect that every piecewise test had
missed (§4, P1-1). That is the argument for it.

## 3. Verdict

**The system is architecturally sound.** The audit did not find a broken domain,
a duplicated source of truth in the core model, or an authorization hole. What
it found was a small number of failure-mode defects in the seams between
subsystems, and a CI pipeline that had stopped enforcing anything.

Specifically confirmed healthy:

- **Authorization.** All 167 view classes with HTTP methods declare or inherit
  permissions. Every object-by-id lookup traced was followed by an ownership or
  capability check — `services.can_read`, `check_object_permissions`, or the
  `enforce(decision)` policy boundary from ADR 0021. No IDOR found.
- **Money.** Integer minor units everywhere, no float arithmetic anywhere in
  `payments` or `rent`. Amounts are server-derived. Immutability is enforced by
  PostgreSQL triggers, not only by Python.
- **Concurrency.** Read-then-write patterns exist, but each one traced is backed
  by a partial unique constraint, so a race produces an `IntegrityError` rather
  than a duplicate.
- **Module boundaries.** Enforced by a test that walks real import statements,
  not by review.
- **No debug residue.** No `console.log`, no `debugger`, no `TODO`/`FIXME`
  anywhere in application code.

## 4. Issues found and fixed

### P1 — broken core behaviour

**1. A redelivered `lease.activated.v1` after a tenancy ended failed forever.**
*Root cause:* `rent.build_schedule` asked the lifecycle question ("is this lease
ended?") **before** the idempotence question ("has a schedule already been
built?"). Outbox dispatch is at-least-once, so a redelivery — a worker restart,
a reclaimed claim, a backed-up queue — raised `Conflict` about a schedule that
already existed and was already correct. The event then failed, retried through
backoff, and dead-lettered, taking every other subscriber on that event with it.
*Fix:* the already-built check runs first, under the lease lock. A genuinely new
schedule on an ended lease is still refused.
*Tests:* `test_money_lifecycle_smoke.py::test_a_redelivered_activation_after_the_tenancy_ends_is_not_a_failure` and `::test_an_ended_tenancy_still_refuses_a_brand_new_schedule`.

### P0 — security

**2. An unknown `SMS_BACKEND` silently fell back to printing OTP codes.**
*Root cause:* `_PROVIDERS.get(backend, ConsoleSmsProvider)`. Production
*requires* `SMS_BACKEND` to be set, and no real adapter exists, so the natural
mistake is to set it to the vendor you intend to integrate — `hubtel`,
`arkesel`. The fallback would then have written every one-time authentication
code into the production log.
*Fix:* raises `ImproperlyConfigured` at startup, matching how `STORAGE_BACKEND`
already behaved.

**3. Both clients shipped pointing at `localhost` if their API URL was unset.**
*Root cause:* `NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1"` in two web
modules, and an emulator fallback chain in `mobile/src/api.ts`. Both values are
baked in at build time, so a release built without the variable is broken on
every machine but the developer's — and talking plain HTTP while it fails.
*Fix:* `web/src/lib/apiBase.ts` fails the production **build**; `mobile/src/api.ts`
throws at startup in a release. Both require `https://`. Verified: `npm run build`
without the variable now fails with a named error.

**4. `CORS_ALLOWED_ORIGINS` was not required in production.** It defaults to
`http://localhost:3000` in `base.py` and `CORS_ALLOW_CREDENTIALS` is on, so a
deploy that forgot it would allow a localhost origin to make credentialed calls.
*Fix:* `required=True` in `production.py`; CI's deploy check supplies it.

### P2 — reliability and integration

**5. CI had stopped gating anything.** `ruff format --check` failed on 45 files
and `mypy` reports 282 errors, and both run **before** the tests. Because a
failing step ends the job, the test suite, `bandit`, `pip-audit` and
`check --deploy` had not been running on any push.
*Fix:* `ruff format` applied (47 files, mechanical, no behaviour change —
verified by a full suite run before and after). **mypy is still red** — see §8.

**6. The mobile contract suite never ran in CI.** 101 tests holding navigation
shape, screen ownership and the rule that a client never decides its own
permissions were enforced on web only.
*Fix:* `npm run lint` and `node --test src/*.test.mjs` added to the mobile job.

**7. Four stale client contract tests.** Each asserted an implementation that had
been deliberately replaced by a better one — a native checkbox, prose that became
a pipeline, a modal that became a route.
*Fix:* assertions now test the intent against the current implementation. One
was a genuine code defect: `web/app/leases/new/page.tsx` shadowed the shared
`Check` control with a local unstyled `<input type="checkbox">`, so the operating
system drew it on that one screen. Replaced with the shared control and the dead
CSS removed.

### P3 — hardening

**8.** A `useMemo` on both clients listed `intents` as a dependency of a list
derived only from `accounts`, recomputing the payment history on every checkout
poll. Removed.

## 5. Payment integrity — re-verified, no regressions

Every invariant from the payment checkpoint was re-checked after this pass. The
full payment suite (`test_payment_core`, `test_payment_domain`,
`test_payment_integrity`, `test_paystack_adapter`, `test_rent`) passes, and the
new end-to-end money smoke exercises the chain over HTTP.

Confirmed intact: idempotency (HTTP keys and DB constraints), immutable
financial history (model guards **and** triggers on transactions, ledger,
receipts, allocations, obligation adjustments), balanced ledger, `RentCharge` as
the single obligation source, intent/attempt/transaction separation,
`PaymentAllocation`, settlement independence from payment, webhook
authentication and replay protection, reconciliation that recovers lost
callbacks but never repairs a disagreement, external-payment evidence kept
distinct from PSP evidence, waivers that never appear as money paid,
post-tenancy balances, Portfolio-scoped payout authority, and audit coverage.

## 6. Cleanup performed

**Removed:**

| Item | Why |
|---|---|
| `danpahq-phase-02-property-v0.3.0/` | Orphaned release-archive residue; a single stale lockfile from a past phase |
| `needsfix.md` | Tracked, empty |
| `web/tsconfig.tsbuildinfo` | Build artifact, already in `.gitignore` but committed before the rule existed |
| `.claude/settings.local.json` | Per-machine tool state carrying absolute paths; `settings.json` stays tracked |
| `uvicorn[standard]`, `django-celery-beat` | Unused runtime dependencies — nothing serves ASGI, and beat uses the file scheduler with no `DatabaseScheduler` configured |
| `factory-boy`, `freezegun`, `pytest-xdist` | Unused dev dependencies |
| `.lease-check` CSS rules | Dead after the shadowed control was removed |

`.gitignore` gained `.claude/settings.local.json` and `danpahq-phase-*/`.

**Intentionally retained:**

| Item | Classification | Why |
|---|---|---|
| `ops/package.py` | DEPRECATED — KEEP FOR NOW | Working release-archive tool from the phase methodology. Unreferenced by CI, but it is deliverable tooling and removing it on a text search would be wrong |
| `SELF_WRITTEN_DOCS/` | REQUIRED / INTENTIONAL | The owner's own domain notes — source requirements, not generated |
| `UptoPhase3` | SAFE TO CONSOLIDATE | A 41KB phase-3 brief at the repository root. Unreferenced, but it is the owner's writing; suggest moving under `docs/history/` rather than deleting |
| `apps/payments.Refund` | REQUIRED / INTENTIONAL | Deliberately unexposed; see the payment checkpoint |
| `assert_can_receive_settlement` | REQUIRED / INTENTIONAL | The seam the first real settlement run will use |
| `designs/` | REQUIRED / INTENTIONAL | Already gitignored; local design reference |

## 7. Web / mobile parity

No divergence in **domain rules** was found. Both clients read capabilities and
permissions from the server, and neither computes its own authority. The
differences are presentational and deliberate.

One parity gap closed in this pass: the mobile contract suite was not running in
CI, so the two clients were not held to the same standard even where the tests
existed.

Known asymmetry, intentional: neither client has a part-payment amount picker
yet, though the server contract and both API clients support it. That is queued
with checkout exposure.

## 8. Unresolved — production blockers

| # | Blocker | Severity | Where |
|---|---|---|---|
| 1 | **No SMS provider exists.** Only `console`, `memory`, `null`. Danpa HQ is phone-first with OTP auth, so no real user can register or sign in | **Blocks first user** | `apps/identity/providers.py` |
| 2 | **mypy: 282 errors in 60 files.** CI stops before the tests, security scan and deploy check | P2 | backend |
| 3 | **No error monitoring.** No Sentry or equivalent; a 500 exists only in an unwatched log line | P2 | deployment |
| 4 | **No email or push transport.** `apps/notifications` writes in-app records only | P2 | `apps/notifications` |
| 5 | **Financial alerts deliver, but nothing receives them yet.** `PAYMENT_ALERT_WEBHOOK_URL` and `PAYMENT_ALERT_OWNER` unset; no rota named | Blocks real money | deployment |
| ~~6~~ | ~~Provider HTTP calls inside the request transaction~~ — **resolved 31 Aug**, see payment checkpoint §3.2 | — | — |
| 7 | **No deployment automation.** No deploy workflow, Terraform, K8s manifests or `eas.json` | P2 | repository |
| 8 | **Paystack: nothing on the go-live checklist is done** | Blocks real money | `PAYSTACK_INTEGRATION.md` |

## 9. Remaining technical debt

- The mypy backlog (§8.2) is the largest single item and the one that unblocks
  the rest of CI.
- `RentCharge.amount_paid_minor` and `PaymentAllocation` are two records
  expected to agree; a sweep notices when they do not. Unifying them is an open
  design decision, not a refactor.
- Beat's file-backed schedule means exactly one replica, enforced by convention
  rather than by anything in the code.
- `ADMIN_VERIFIED` payment evidence exists in the vocabulary with no workflow.
- Refund execution is deliberately unbuilt.

## 10. Tests protecting critical invariants

| File | Holds |
|---|---|
| `test_core_lifecycle_smoke.py` | The rental chain, registration → confirmed rent record |
| `test_money_lifecycle_smoke.py` | **New.** The money chain, checkout → closing balance, plus outbox redelivery safety |
| `test_payment_integrity.py` | 32 tests: engine-level append-only, incomplete provider evidence, ignored provider events, unmatched evidence, rent idempotency, part payment, one collection authority, alert escalation |
| `test_payment_core.py`, `test_payment_domain.py`, `test_paystack_adapter.py` | Server-priced intents, signed confirmation, attempts, allocation, payout authority, settlement import, reconciliation |
| `test_rent.py` | Obligations, the two-party confirmation rule, adjustments, reminders, closing summaries |
| `test_outbox.py` | At-least-once delivery, retry, dead-lettering, reclaim of abandoned claims |
| `test_module_boundaries.py` | ADR 0002, by walking real imports |
| `test_schema_invariants.py` | Hashed secrets, uniqueness, immutability, no public download path, no default payment adapter |
| `test_property_list_queries.py` | Constant-cost property lists as a portfolio grows |
| `test_allocation_integrity.py` | No double-letting of a unit or bed |

## 11. Validation at this checkpoint

| Gate | Result |
|---|---|
| Backend tests | **1322 passed, 0 failed** |
| Backend lint (`ruff check`) | pass |
| Backend format (`ruff format --check`) | pass — 298 files |
| Migration drift | none |
| `check --deploy` (production settings) | pass, 0 issues |
| Web typecheck | pass |
| Web lint | pass, 0 warnings |
| Web contract tests | **294 passed, 0 failed** |
| Web production build | pass with `NEXT_PUBLIC_API_URL`; **fails closed** without it |
| Mobile typecheck | pass |
| Mobile lint | pass, 0 warnings |
| Mobile contract tests | **101 passed, 0 failed** |
| `mypy apps config` | **282 errors — known, unresolved (§8.2)** |

Both client suites are fully green for the first time in this session; four
stale contract tests had been failing before this audit began.

## 12. Recommended next development step

**Write the SMS adapter.** It is the only thing standing between this system and
a real user, it is a contained piece of work against an existing interface
(`SmsProvider` in `apps/identity/providers.py`, three methods), and everything
else in the product already works without a PSP: providers and tenants can
record, confirm and receipt cash, mobile money and bank payments today.

Then, in order: clear the mypy backlog so CI gates again, add error monitoring,
and only then return to the Paystack go-live checklist.

**Do not start a new feature phase before the SMS adapter exists.** Every
feature added before it is a feature no real user can reach.

---

## 13. Addendum — 31 August 2026

Sections 1–12 are the audit checkpoint and are left as written. Work has landed
since; this records where the gates stand now rather than rewriting history.

### 13.1 What landed after the audit

- **Payment transaction boundaries.** Provider calls no longer happen inside a
  database transaction: reserve (atomic) → call (nothing held) → record
  (atomic), with a new `external_calls=True` idempotency mode that leases a
  claim instead of holding a lock across the network.
- **Paystack sandbox lifecycle**, end to end against the provider-neutral
  adapter contract. It found `charge.failed` being silently ignored.
- **Reconciliation escalation** now leaves the queue: ageing → breached, with
  delivery and acknowledgement semantics and no tenant detail in the payload.
- **Tenant Services hub** on mobile, architected to settle through the Payments
  Core rather than growing a second payment system.
- **Provider plans and entitlements** — this change. See §13.3.

### 13.2 Gates, re-run 31 August 2026

| Gate | Result |
|---|---|
| Backend tests | **1395 passed, 0 failed** |
| Backend lint (`ruff check`) | pass |
| Backend format (`ruff format --check`) | pass — 320 files |
| Migration drift | none |
| Web contract tests | **295 passed, 0 failed** |
| Web typecheck | pass |
| Mobile contract tests | **106 passed, 1 failed** — not from this change |
| Mobile typecheck | **4 errors** — not from this change |

**The mobile red is in-flight Spaces/Units work, not billing.** The four
typecheck errors are in `mobile/app/(app)/(provider-tabs)/index.tsx`, which
indexes design tokens that do not exist in `theme.ts` (`ink.400`,
`laterite.500`, `lagoon.20`), and the failing contract test reads that same
file. Billing is backend-only and is referenced by no mobile source or test.
Those files are uncommitted work by another hand and were deliberately left
alone rather than "fixed" mid-flight.

### 13.3 Billing bounded context

`apps/billing` is a new bounded context, separate from `apps/payments` on
purpose: billing answers *why Danpa HQ charges this Portfolio*, Payments Core
answers *how money moved*. 30 new tests, including a real two-connection
concurrency test proving two simultaneous creates cannot both take the last
slot.

Deliberate departures from the brief, each argued in ADR 0032 rather than made
silently: no `PortfolioUsage` cache (live authoritative counts); `MoneyField`
integer minor units instead of `Decimal`, because ADR 0006 already gives
exactness and a second money representation is a duplicated source of truth;
`BillingInvoice` not modelled yet, because an invoice with no way to be paid is
a table shape guessed a phase early.

### 13.4 Still true from §8

The production blockers in §8 are unchanged. **The SMS adapter is still the
single thing standing between this system and a real user**, and billing does
not move that: a plan nobody can sign up to reach is not a step toward revenue.
Nothing in this change enables a production PSP or exposes checkout.
