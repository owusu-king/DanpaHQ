# Architecture overview

## The shape

```text
   Android / iOS (Expo)        Browser (Next.js)
            │                          │
            └──────────┬───────────────┘
                       │ HTTPS, JSON, one error envelope
                 ┌─────▼──────┐
                 │  Django    │  modular monolith
                 │  + DRF     │  strict module boundaries
                 └─────┬──────┘
        ┌──────────────┼───────────────┬─────────────┐
   ┌────▼────┐   ┌─────▼─────┐   ┌─────▼─────┐  ┌────▼─────┐
   │Postgres │   │   Redis   │   │  Celery   │  │ S3 store │
   │ system  │   │cache/broker│  │ workers   │  │  files   │
   │of record│   └───────────┘   └─────┬─────┘  └──────────┘
   └─────────┘                         │
                                 outbox dispatcher
                                 → notifications, media,
                                   provider webhooks
```

## Module boundaries

Modules live under `backend/apps/`. The dependency rule is one-directional:

```text
platform layer   core → (nothing)
                 audit, outbox, idempotency, files, geo → core
domain layer     identity, property, listing, lease, payments, … → platform layer
edge             api → domain layer
```

A domain module may **not** import another domain module's models. Cross-domain
work goes through a service function or a domain event. When that rule starts to
hurt, that is the signal a boundary is wrong — not a reason to reach across it.

Why this and not microservices: the hard problems here are relational and
transactional (a lease, its charges, its payments and its audit trail must move
together). Distributing that across services replaces a transaction with a saga
and buys nothing at current scale. The boundaries are drawn now so extraction is
possible later; see `adr/0002-modular-monolith.md`.

## Cross-cutting mechanics

**Request context.** `RequestContextMiddleware` mints a request id and holds
actor, IP and client in a `contextvar`. Logs, audit entries and outbox events all
read from it, so one id ties a tenant's tap to every record it produced.

**Events.** State changes emit domain events into the outbox inside the same
transaction. The dispatcher claims batches with `FOR UPDATE SKIP LOCKED`, so it
scales by adding replicas.

**Errors.** One envelope for the whole API. Clients branch on `code`; `message`
is written for the person reading it.

**Money.** Integer minor units and an explicit currency, everywhere, in Python
and TypeScript, with the same formatting on both sides.

**Idempotency.** Selected high-impact mutations accept `Idempotency-Key`. An
actor/path/key advisory lock serialises concurrent duplicates, and the effect,
audit/outbox writes and replayable response commit in one transaction. Reusing
the key with different request details is a conflict; a completed replay returns
the original response. Existing non-payment routes keep the header optional for
installed-client compatibility; future payment mutations can require it. See
ADR 0027.

## Environments

| | Local | CI | Production (planned) |
|---|---|---|---|
| Runtime | docker compose | GitHub Actions services | containers behind a load balancer |
| Database | Postgres 16 container | Postgres 16 service | managed Postgres, PITR, read replica later |
| Files | MinIO | in-memory storage | S3-compatible object storage |
| Secrets | `.env` | Actions secrets | platform secret manager, never in images |

Production topology is documented, not provisioned. Nothing in this repository
has been deployed.
