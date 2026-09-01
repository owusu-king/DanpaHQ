# ADR 0001 — Django and DRF as the core backend

**Status:** accepted · 2026-08 · Phase 0

## Context
The platform's centre of gravity is relational and transactional: leases,
charges, payments, verifications and audit trails that must move together. It
also needs an operations console on day one, because verification decisions are
made by humans before they are made by models.

## Options
1. **Django + DRF.** Mature ORM, migrations, admin, auth, a large security track
   record.
2. **FastAPI + SQLAlchemy.** Faster per-request, async-native, but the admin,
   auth and migration story is assembled by hand.
3. **Node/NestJS.** One language across the stack; weaker data-migration and
   admin tooling for this shape of problem.

## Decision
Django + DRF + PostgreSQL.

## Reasoning
The admin alone is months of console work we do not have to build. The ORM's
transaction and constraint story is what a money domain needs. Per-request
latency is not the binding constraint — network round-trip time on a Ghanaian
mobile connection dominates anything we save in the handler.

## Consequences
- Sync-first. Long provider calls go to Celery, not to async views.
- FastAPI stays available for a genuinely different workload (model inference,
  a high-fan-out webhook receiver), introduced only with its own ADR.
- We inherit Django's release cadence and must track LTS versions deliberately.
