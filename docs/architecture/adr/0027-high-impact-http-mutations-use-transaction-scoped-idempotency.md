# 0027 — High-impact HTTP mutations use transaction-scoped idempotency

**Status:** Accepted  
**Date:** 21 August 2026

## Context

`IdempotencyKey` existed, and both client transports could send a key, but no
request execution path claimed or replayed one. Retrying after a lost response
therefore remained unsafe: application submission, viewing confirmation,
invitation acceptance, lease acceptance or a verification decision could run a
second time. Domain uniqueness rules catch some duplicates, but they cannot
return the first response and do not cover audit, outbox and every transition.

Persisting the domain effect and cached response in separate transactions would
leave the same gap. A connection can disappear after the effect commits but
before its response is saved.

## Decision

Selected high-impact DRF mutations use `idempotent_mutation`. When a valid
`Idempotency-Key` is present, one outer database transaction:

1. takes a transaction-scoped PostgreSQL advisory lock over actor, endpoint and
   key;
2. claims or reads `IdempotencyKey`;
3. checks a fingerprint of method, full request target and raw body;
4. executes the domain service inside a savepoint;
5. commits the domain write, audit/outbox records and JSON response together.

Concurrent duplicates wait for the first transaction and then replay its status
and body with `X-Idempotent-Replay: true`. Reusing a key for different request
details returns `idempotency_conflict` (409). Responses below 500 are final and
replayable. A 5xx records `FAILED`, rolls back the savepoint's domain work and
allows the same request to retry. Claims expire after 24 hours by default.

Consumer keys are scoped to `identity.User`. Management uses its isolated
`ManagementUser` UUID because that authentication surface deliberately does not
share the consumer user table. Anonymous scope exists in the schema but none of
the currently protected mutations is anonymous.

Web, Expo and Management create one key per logical protected mutation and keep
it stable across at most three transient/network attempts. Unsafe requests are
not retried globally. The header remains optional on current non-payment routes
so installed clients continue to work; domain constraints and row locks remain
mandatory regardless. The decorator supports `required=True` for a future
Payment Core endpoint, where an unkeyed mutation will not be acceptable.

Invitation creation and Unit access-code rotation are intentionally not wrapped:
both return a one-time raw possession secret. Storing the response for replay
would silently reintroduce plaintext secret persistence. Those calls remain
single-attempt until an encrypted or otherwise non-recoverable replay design is
justified.

## Alternatives considered

- **Global middleware for every POST/PATCH/DELETE.** Rejected: several POSTs are
  reads with secrets in their body, while other writes have different replay
  semantics. Blind retry would widen risk.
- **Redis locks and a later database response write.** Rejected: lock expiry and
  split persistence recreate the effect-without-response failure window.
- **Unique constraints only.** Retained as domain invariants, but insufficient
  for replaying an original response or suppressing duplicate side effects.
- **A second model for Management.** Rejected: one protocol and table can scope
  the two authenticated actor types without duplicating lifecycle logic.

## Consequences

The protocol depends on PostgreSQL advisory locks, matching the supported
database. The transaction remains open while the protected domain service runs;
these services must not wait on slow external providers. Celery beat removes
expired claims hourly. Current installed clients that omit the header receive
existing domain protection but not response replay; Payment Core must make the
header required.

Migration `idempotency.0003_management_actor_scope` is additive apart from
replacing the existing uniqueness definition. It preserves all claims and
responses and adds nullable management attribution.

---

## Amendment — 31 August 2026

**Rent's financial mutations now use this protocol.** Recording an off-platform
payment, confirming or disputing one, waiving or writing off an obligation, and
recording a property expense were all unprotected, which is exactly the class
this ADR exists for. The web and mobile clients were already sending keys for
most of them and the server was discarding them. The header stays optional on
these routes per the installed-client rule above; the expense endpoints now send
keys too.

**The Consequences section's warning was being violated, and now is not.**
"These services must not wait on slow external providers" — but `create_intent`,
`retry_intent` and `refresh_intent_from_provider` each made a Paystack call, with
a 20-second timeout, inside the transaction this protocol opens, and
`create_intent` also held `SELECT ... FOR UPDATE` on the tenant's `RentCharge`
for the duration.

---

## Amendment — 31 August 2026: external-call mode

`idempotent_mutation(external_calls=True)` is the second mode this ADR's
Consequences section implied was needed. It keeps the protocol and drops the one
thing it cannot have — a transaction held while a provider answers — by
committing in three steps instead of one: **claim, run, record.**

The trade is explicit. Because the claim commits first:

- a request that dies mid-flight leaves a committed `in_flight` row, so the
  claim needs a lease (`in_flight_until`, default 90s, longer than the provider
  timeout it exists to survive) or the key would be permanently unusable;
- taking over an expired lease **re-runs the request**, making the effect
  at-least-once;
- a 5xx is no longer rolled back, because the view has already committed its own
  work and may have called a provider. It is recorded `failed` and retryable.

**This mode is therefore only safe where the domain service is itself idempotent
on a durable anchor**, and the payment services were restructured to be:
`create_intent` reserves and commits before any network call, then *resumes*
that reservation rather than creating a second, and `client_reference` is the
provider's own idempotency key so re-initiating reaches the same provider
transaction. `retry_intent` is split the same way.

The transactional mode is unchanged and remains the default for every other
protected mutation. Nothing that was one transaction has become three except the
three payment endpoints that needed it.

Held by `tests/integration/test_payment_transaction_boundaries.py`, which
asserts from inside the adapter that `connection.in_atomic_block` is false when
the provider is called, and that the obligation row is lockable at that moment.

Migration `idempotency/0004_in_flight_lease` is additive and nullable.
