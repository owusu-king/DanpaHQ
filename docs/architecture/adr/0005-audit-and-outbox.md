# ADR 0005 — Hash-chained audit log and a transactional outbox

**Status:** accepted · 2026-08 · Phase 0

## Audit
Disputes are decided by records. The log is append-only in the application
(`save()` on an existing row raises) and in the database (no UPDATE or DELETE
policy for the application role). Each entry stores the hash of the previous
entry for the same aggregate, so a silent edit or a removed row breaks the chain
and `verify_chain()` finds it.

This is tamper **evidence**. An owner-level credential could recompute the whole
chain. Real prevention means shipping entries to append-only external storage,
which is a Phase 4 hardening item, not a claim we make now.

The actor's label is denormalised onto the entry so a deleted account still
yields a readable history. Sensitive fields are recorded as having changed, never
with their values.

## Outbox
Queueing a Celery task inside a transaction lets a worker pick it up before the
transaction commits — or after it rolls back. The failure mode is an SMS about a
payment that did not happen, which in this market is worse than no SMS at all.

Events are rows, written in the same transaction as the state change. A
dispatcher on a 5-second beat claims batches with `FOR UPDATE SKIP LOCKED`,
which is what makes multiple dispatcher replicas safe.

Cost: up to ~5s of added latency for event-driven side effects, and a table that
needs a retention job. Both accepted. Failures back off exponentially and land in
`dead` rather than retrying forever, so a broken consumer is visible instead of
being a queue that never drains.
