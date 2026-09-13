# Rooomly — production deployment

What *this repository* needs to move from development into production. Not a
Django tutorial: every item below was read out of the code, and every file path
and setting name is real.

Read `docs/runbook.md` for day-to-day operation and the payment on-call
procedure, and `docs/architecture/PAYMENT_IMPLEMENTATION_STATUS.md` for the
state of the money domain.

---

## 0. The two things that block everything else

**There is no SMS provider.** `apps/identity/providers.py` registers exactly
three adapters — `console`, `memory`, `null` — and Rooomly is phone-first with
OTP authentication (ADR 0004, ADR 0010). `console` prints one-time codes to the
log; `null` discards them. **No real user can register or sign in in
production until a real adapter is written.** An unknown `SMS_BACKEND` now
raises `ImproperlyConfigured` at startup rather than silently falling back to
printing codes, so a deploy that names a vendor Rooomly has not integrated stops
instead of leaking credentials into logs.

**There is no payment provider in production.** `PAYMENT_BACKEND` defaults to
empty, `memory` is refused by `config/settings/production.py`, and a `sk_live_`
Paystack key does nothing unless `PAYSTACK_ALLOW_LIVE` is separately true. This
is deliberate and correct — it is what lets you launch the rental product before
the money product. See §9.

Everything else in this document is ordinary work. Those two are the gates.

---

## 1. Django backend

**WHAT** — run `config.settings.production`, never `local`.
**WHERE** — `DJANGO_SETTINGS_MODULE` in the API, worker and beat environments.
**WHY** — `production.py` fails to start rather than starting insecurely: it
requires every secret explicitly, forces `DEBUG=False`, SSL redirect, HSTS for a
year with preload, secure session and CSRF cookies, and `DB_SSLMODE=require`.
**HOW** — the image already runs the right process:

```
gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 60 --access-logfile -
```

`backend/Dockerfile` builds a two-stage image with no build toolchain in the
runtime layer, runs as non-root uid 10001, and carries a `HEALTHCHECK` against
`/healthz`. Build production images **without** `INSTALL_DEV=true`; the compose
file sets it and production must not.

Three workers is a starting point, not a measurement. `--timeout 60` matters:
checkout and status-refresh requests make a Paystack call inside the request
transaction (see §14), so the gunicorn timeout must stay above Paystack's
20-second client timeout or a slow provider becomes a killed worker.

### Required environment (production refuses to start without these)

| Variable | Why |
|---|---|
| `DJANGO_SECRET_KEY` | Django signing |
| `ALLOWED_HOSTS` | comma-separated; the API hostname(s) |
| `CSRF_TRUSTED_ORIGINS` | `https://` origins that may POST forms |
| `CORS_ALLOWED_ORIGINS` | `https://` browser origins allowed credentialed API calls. Required in production because `base.py` defaults it to `http://localhost:3000` and `CORS_ALLOW_CREDENTIALS` is on |
| `OTP_PEPPER` | one-time-code hashing; deliberately not derived from `SECRET_KEY` |
| `ACCESS_TOKEN_KEY` | access-token signing |
| `NATIONAL_ID_PEPPER` | Ghana Card hashing |
| `UNIT_ACCESS_CODE_PEPPER` | unit access-code hashing |
| `MANAGEMENT_CSRF_KEY` | Management portal CSRF, separate from consumer auth |
| `STORAGE_SIGNING_KEY` | presigned URL signing |
| `SMS_BACKEND` | see §0 |

Generate each secret independently. Reusing one value across two of these
defeats the separation they exist for.

### Optional but deliberate

| Variable | Default | Note |
|---|---|---|
| `DB_SSLMODE` | `require` | do not weaken |
| `FILE_SCAN_MODE` | `strict` | `permissive` is a development shortcut |
| `PAYMENT_INTENT_TTL_MINUTES` | 30 | how long a checkout stays open |
| `PAYMENT_MINIMUM_PART_MINOR` | 5000 (GHS 50) | floor under a part payment |
| `PAYMENT_RECONCILIATION_AGEING_HOURS` | 4 | when an open exception starts alerting |
| `PAYMENT_RECONCILIATION_BREACH_HOURS` | 24 | when it escalates to `critical` |
| `IDEMPOTENCY_TTL_HOURS` | 24 | replay window |
| `LOG_FORMAT` | `json` | keep JSON in production; the formatter redacts phone numbers and long digit runs |
| `LOG_LEVEL` | `INFO` | |

`config/settings/production.py` also hard-sets `STORAGE_BACKEND = "s3"` and
`LEASE_TEMPLATE_REQUIRE_APPROVAL = True` regardless of environment.

---

## 2. PostgreSQL

**WHAT** — a managed PostgreSQL 16 instance with the **`postgis`** and
**`pg_trgm`** extensions allowed. `docker-compose.yml` runs
`postgis/postgis:16-3.5-alpine` for development; do not run that container in
production.
**WHERE** — `POSTGRES_DB/USER/PASSWORD/HOST/PORT`, plus `DB_CONN_MAX_AGE`
(default 60) and `DB_SSLMODE` (default `require`).
**WHY** — the schema depends on PostgreSQL specifics that are not portable:
partial unique indexes carry the financial invariants, `pg_advisory_xact_lock`
carries HTTP idempotency, row-level security makes the audit log append-only,
and PL/pgSQL triggers make transactions, ledger lines, receipts, allocations and
obligation adjustments append-only. Map search (ADR 0033) adds a spatial index
on listings' public points and a trigram index on place names.

Migration `geo.0002` runs `CREATE EXTENSION postgis` and `CREATE EXTENSION
pg_trgm`. Where the migration role may not create extensions, have an
administrator create both first; `IF NOT EXISTS` then makes the migration a
no-op. The API image must carry GDAL, GEOS and PROJ from Debian bookworm (see
`backend/Dockerfile`): the trixie versions are newer than Django 5.1 supports and
crashed the test process intermittently.
**HOW** — after the first `migrate`, run as the **database owner**:

```bash
python manage.py harden_database
```

This applies `ops/sql/audit_append_only.sql`: RLS forced on `audit_log`, INSERT
and SELECT policies only, `UPDATE`/`DELETE`/`TRUNCATE` revoked from the
application role. The application role must therefore **not** be the owner —
create a separate least-privilege role for the app and keep the owner for
migrations and hardening.

Reference data, once:

```bash
python manage.py seed_geo
python manage.py seed_amenities
```

---

## 3. Redis

**WHAT** — a managed Redis, used for three different jobs: the Django cache, the
Celery broker, and the Celery result backend.
**WHERE** — `REDIS_URL`, with `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND`
defaulting to it.
**WHY** — `/readyz` checks the cache, so Redis loss takes instances out of the
load balancer rather than serving errors. Throttling counters live here too: if
Redis is shared and flushed, rate limits reset.
**HOW** — use separate logical databases (or separate instances) for cache and
broker. A `FLUSHDB` aimed at the cache must not delete queued financial work.

---

## 4. Celery workers

**WHAT** — at least one worker consuming all four queues.
**WHERE** — `CELERY_TASK_ROUTES` in `config/settings/base.py` routes
`payments.*` and `rent.*` → `payments`, `notifications.*` → `notifications`,
`media.*` → `media`, everything else → `default`.
**WHY** — money and notifications must not queue behind image processing.
**HOW**

```
celery -A config worker -Q default,payments,notifications,media -l info
```

`CELERY_TASK_ACKS_LATE = True` and `CELERY_TASK_REJECT_ON_WORKER_LOST = True`
are already set, so a task redelivers if a worker dies. Every scheduled task in
this repository is written to be re-runnable. Scale by adding workers; the
outbox claims with `SELECT ... FOR UPDATE SKIP LOCKED`, so several dispatchers
are safe.

`CELERY_TASK_TIME_LIMIT = 300` / soft 240. The hourly reconciliation makes
paginated provider calls and is the task most likely to approach that.

---

## 5. Celery Beat — **exactly one replica**

**WHAT** — one, and only one, beat process.
**WHERE** — `celery -A config beat -l info --schedule <path>`.
**WHY** — the schedule is code (`CELERY_BEAT_SCHEDULE`), not database rows.
`django-celery-beat` is **not** installed and `DatabaseScheduler` is not
configured, so beat keeps its state in a local file. **Two beat replicas would
fire every scheduled task twice**, including reconciliation and rent reminders.
**HOW** — run it as a singleton (a Deployment with `replicas: 1`, or an ECS
service with desired count 1). Point `--schedule` at a writable path; the
development compose uses `/tmp/celerybeat-schedule`, which is fine because every
entry is an interval rather than a wall-clock time — a restart loses nothing but
the next tick.

### What beat runs

| Task | Interval | What breaks if it stops |
|---|---|---|
| `outbox.dispatch_pending` | 5s | **All** notifications, rent-schedule creation on lease activation, and every downstream domain effect. This is the single most important scheduled task |
| `payments.reconcile` | 1h | Lost provider callbacks are never recovered; settlements are never imported; payout provisioning is never reconciled |
| `payments.alert_open_exceptions` | 30m | Unresolved financial disagreements stop escalating |
| `payments.expire_intents` | 5m | Abandoned checkouts keep holding the one-open-intent gate |
| `rent.emit_due_reminders` | 1h | Tenants stop being reminded before and after a due date |
| `trust.expire_verifications` | 1h | Lapsed verifications keep granting capabilities |
| `trust.warn_expiring_verifications` | 1d | |
| `trust.release_stale_claims` | 10m | Reviewer claims stay stuck |
| `identity.purge_expired_challenges` | 6h | |
| `idempotency.purge_expired` | 1h | Replay table grows unbounded |
| `viewing.emit_due_notifications` | 5m | |
| `media.expire_abandoned_uploads` | 1h | |
| `media.purge_expired_files` | 1d | |

**There is no separate outbox worker to deploy.** The outbox is a beat task on
the `default` queue; "start the outbox worker" means "beat is running and a
worker consumes `default`".

---

## 6. Object storage and media

**WHAT** — S3 or an S3-compatible bucket. Production forces
`STORAGE_BACKEND = "s3"`; the MinIO container in `docker-compose.yml` is for
development only.
**WHERE** — `AWS_STORAGE_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL` (omit for real
AWS), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_REGION_NAME`.
**WHY** — identity documents, payment evidence and property media live here.
Uploads are presigned and go browser→storage directly; downloads are presigned
with a **60-second** TTL for sensitive files, and every sensitive read is
written to the audit log.
**HOW** — `python manage.py ensure_bucket` creates it if absent. The bucket must
be **private**: there is no public download path in the code
(`tests/unit/test_schema_invariants.py::test_no_public_download_path_exists`
holds that), and a public bucket would route around the entire authorization and
audit boundary. Give the app an IAM identity scoped to that one bucket.

**Map assets are the one public bucket, and a separate one** (ADR 0033).
`MAP_ASSETS_BUCKET` (default `rooomly-map`) holds the Ghana basemap archive and
its label fonts: public geography, identical for every visitor, read by range
request. Serve it through a CDN and set `MAP_ASSETS_PUBLIC_URL` to that origin;
left empty, clients are pointed at the object store's public endpoint. It needs
a CORS rule allowing `GET` and `HEAD` with the `Range` header from the web
origins, and exposing `ETag`, `Content-Range` and `Content-Length`.
`publish_map_assets` applies the rule where the provider supports bucket CORS, and
MinIO answers every origin itself. Nothing a person uploads is ever written
there, and the upload bucket above stays private.

---

## 7. Static assets

**WHAT** — `collectstatic` before serving.
**WHERE** — WhiteNoise is already in `MIDDLEWARE`; `STATIC_ROOT` is
`backend/staticfiles/`.
**WHY** — the Django admin and the DRF browsable pages need them. The
development container logs `No directory at: /app/staticfiles/` precisely
because this has not been run.
**HOW** — `python manage.py collectstatic --noinput` in the image build or an
init step. A CDN is optional; WhiteNoise is sufficient at launch volumes.

---

## 8. Web (Next.js)

**WHAT** — a production Next.js build with the API URL inlined.
**WHERE** — `NEXT_PUBLIC_API_URL` at **build** time, `web/Dockerfile`.
**WHY** — `NEXT_PUBLIC_*` is inlined into the bundle, not read at runtime. A
build made without it used to bake `http://localhost:8000/api/v1` into the
shipped app. `web/src/lib/apiBase.ts` now refuses: a production build with no
value, or a non-`https://` value, fails the build with a named error.
**HOW**

```bash
NEXT_PUBLIC_API_URL=https://api.rooomly.com/api/v1 npm run build
```

Add that origin to the API's `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS`.

---

## 9. Mobile (Expo / React Native)

**WHAT** — release builds for Android and iOS with the API URL configured.
**WHERE** — `EXPO_PUBLIC_API_URL`, or `expo.extra.apiUrl` in `mobile/app.json`
(currently deliberately unset with an explanatory comment).
**WHY** — `mobile/src/api.ts` falls back to `10.0.2.2` / `localhost` for
emulators. A release build must never do that, so it now **throws at startup**
if the value is missing or is not `https://`. A misconfigured release fails
loudly in QA instead of silently failing every request in the field.
**HOW** — set it in the EAS build profile. There is no `eas.json` in the
repository yet; creating one is part of the first mobile release.

An app store release is not a rollback you can perform in minutes. Treat mobile
as the slowest-moving surface and keep the API backward-compatible with the
oldest release in the field.

---

## 10. Domains, TLS and the reverse proxy

| Host | Serves |
|---|---|
| `api.rooomly.com` | Django/gunicorn |
| `rooomly.com` (or `app.`) | Next.js |
| storage | S3/CDN endpoint for media |

TLS terminates at the load balancer. The proxy **must** send
`X-Forwarded-Proto`: `production.py` sets
`SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")`, and without it
`SECURE_SSL_REDIRECT` will loop. `SECURE_HSTS_PRELOAD` is on with a one-year
max-age and `includeSubDomains` — be certain every subdomain can serve HTTPS
before this reaches a browser, because preload is hard to undo.

Health checks: point the load balancer at **`/readyz`** (checks the database and
cache), and the container/orchestrator liveness probe at **`/healthz`** (process
only). Using `/readyz` for liveness would let a brief database blip kill healthy
processes and turn a degradation into an outage — the split exists for that
reason.

---

## 11. Secrets

**WHAT** — every value in §1 comes from a secret manager, never from a file in
the image or the repository.
**WHY** — `.env` is gitignored but `.env.example` is the contract; treat the
list there as the checklist and the values as unknown to the repository.
**HOW** — inject as environment variables at task start (AWS Secrets Manager,
GCP Secret Manager, Kubernetes Secrets, Doppler). Rotating `ACCESS_TOKEN_KEY`
invalidates every live session; rotating `OTP_PEPPER` invalidates codes in
flight; rotating `NATIONAL_ID_PEPPER` **breaks the ability to match stored ID
hashes and is effectively irreversible** — plan that one, do not react with it.

---

## 12. Notifications

**SMS** — see §0. Nothing to configure until an adapter exists. When one is
written, register it in `_PROVIDERS` in `apps/identity/providers.py` and set
`SMS_BACKEND` to its name.

**Email and push** — not integrated. `apps/notifications` writes in-app
notifications and delivers through the outbox; there is no email or push
transport in this repository. Anything the product implies about email receipts
or push reminders is not yet true.

---

## 13. Payments and the PSP

**Do not skip `docs/architecture/PAYSTACK_INTEGRATION.md`.** It has a go-live
checklist and *nothing on it is done*. Summary of what production needs:

| Variable | Note |
|---|---|
| `PAYMENT_BACKEND` | empty = no checkout offered anywhere. Set to `paystack` only after sandbox validation |
| `PAYSTACK_SECRET_KEY` | `sk_test_` for sandbox, `sk_live_` for production |
| `PAYSTACK_ALLOW_LIVE` | must be explicitly true before a `sk_live_` key does anything |
| `PAYSTACK_PLATFORM_CHARGE_BPS` | the Rooomly platform share, in basis points. Mandatory; an intent fails closed without it |
| `PAYSTACK_CALLBACK_URL` | the deployed web return route |
| `PAYMENT_RECEIPT_EMAIL_DOMAIN` | Paystack requires an email; phone-first accounts get a routable per-account address on this domain |

**Webhook** — register `https://api.rooomly.com/api/v1/webhooks/payments/paystack/`
in the Paystack dashboard. It authenticates with HMAC-SHA512 over the raw body
using the secret key; there is no separate webhook secret. The endpoint is
IP-throttled at 120/min — if Paystack bursts above that it receives 429 and
retries, and the hourly sweep recovers anything that never lands.

**Payout readiness is per Portfolio, not per deployment.** Each Portfolio's
owner or admin provisions a Paystack subaccount through
`POST /organizations/:id/payout-destination/`. Until a Portfolio has a verified,
selected destination, its tenants are correctly not offered checkout.

**External payments keep working with no PSP at all.** Cash, direct MoMo and
bank transfers are recorded through `POST /rent/payments/` and confirmed by the
counterparty. This is why the rental product can launch before the money
product.

---

## 14. Observability

**Logging** — JSON via `apps/core/logging.py`, one line per event, carrying the
request id and actor. Phone numbers and long digit runs are masked in the
message, the exception and every structured field. Ship stdout to your log
platform; do not reformat to text in production.

**Financial alerts** — set two variables and alerts leave the process:

| Variable | Note |
|---|---|
| `PAYMENT_ALERT_WEBHOOK_URL` | An incoming webhook — Slack, PagerDuty, Opsgenie, or your log platform. Empty means the log line is the only path |
| `PAYMENT_ALERT_OWNER` | The rota that owns these. Named in every alert |
| `PAYMENT_ALERT_TIMEOUT_SECONDS` | Default 5. Best-effort; a failure never stops reconciliation |

The payload carries the exception id, kind, provider, status, age, owner and a
workspace link — and deliberately no tenant, amount or provider payload, because
alert streams are copied into chat channels and retained by third parties.

Also bind these `event` values from the log stream. The full table, with what
each one means and what to do, is in `docs/runbook.md`:

| `event` | Level |
|---|---|
| `payment_reconciliation_exception_breached` | `critical` — **page** |
| `payment_reconciliation_exception_opened` | `error` |
| `payment_reconciliation_exception_ageing` | `error` |
| `payment_reconciliation_exception_stalled` | `warning` — acknowledged and stalled |
| `payment_alert_delivery_failed` | `error` — **alerts are going nowhere** |
| `outbox_dead` | `error` |
| `settlement_batch_import_unavailable` | `warning` |
| `reconciliation_provider_unavailable` | `warning` |
| `outbox_reclaimed` | `warning` |

**Error monitoring** — not integrated. There is no Sentry or equivalent DSN in
the settings. Add one before real users; a 500 currently exists only in a log
line nobody is watching.

**Metrics** — none exported. The most valuable first four: outbox queue depth
(`outbox_event` where `status IN ('pending','failed')`), open reconciliation
exceptions, Celery queue depth on `payments`, and gunicorn request duration.

---

## 15. Backups and restore

**WHAT** — automated PostgreSQL backups with point-in-time recovery, plus
versioning on the media bucket.
**WHY** — the financial history is append-only *by design*: transactions,
ledger lines, receipts, allocations and obligation adjustments cannot be
corrected in place. A bad write is corrected by another record, and a lost
database cannot be reconstructed from anywhere else.
**HOW** — managed automated backups, 30-day retention minimum, PITR enabled.
**Rehearse the restore before launch.** A backup nobody has restored is a
hypothesis. Test specifically that the append-only triggers and audit RLS
survive the restore — they are schema objects created by
`payments/0002`, `payments/0013`, `rent/0009` and `harden_database`, and a
restore that drops them silently removes the protection.

---

## 16. CI/CD

`.github/workflows/ci.yml` runs, per push: ruff lint **and format check**, mypy,
missing-migration check, the full pytest suite with coverage, bandit,
`pip-audit --strict`, `check --deploy --fail-level WARNING` against production
settings, module-boundary and schema-invariant tests, design-token freshness,
web typecheck/lint/tests/build, and mobile typecheck/lint/tests.

**One known-red gate: `mypy apps config` reports 282 errors across 60 files.**
Because Lint and Type check run before Tests, the backend job currently stops
early, which means the security scan and the deploy check have not been gating
anything. The formatting half of that was fixed in this pass; the type errors
are real technical debt and are listed in `SYSTEM_INTEGRITY_STATUS.md`. Until
they are cleared, treat CI as advisory and run the suite manually before a
deploy.

Deployment itself is not automated in this repository — there is no deploy
workflow, no Terraform, no Kubernetes manifests, no `eas.json`. Those are
yours to write.

---

## 17. Deployment classification

### REQUIRED BEFORE FIRST REAL USER

1. **A real SMS adapter** (§0). Without it nobody can sign in.
2. Managed PostgreSQL, with `harden_database` run as owner and a separate
   least-privilege application role (§2).
3. Managed Redis, cache and broker separated (§3).
4. Production settings module with every required secret from a secret manager
   (§1, §11).
5. Private S3 bucket, `ensure_bucket` run, scoped IAM identity (§6).
6. `collectstatic` (§7).
7. TLS at the proxy with `X-Forwarded-Proto`; `/readyz` on the load balancer,
   `/healthz` for liveness (§10).
8. `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` set to the real web origin
   (§1, §8).
9. Celery worker on all four queues, and **exactly one** beat (§4, §5).
10. Web built with `NEXT_PUBLIC_API_URL` (§8).
11. Django superuser created, then the first Operations Admin created through
    Django admin → Management users (§18 step 12).
12. Automated backups with a **rehearsed** restore (§15).
13. Error monitoring (§14).

### REQUIRED BEFORE ACCEPTING REAL MONEY

1. Every unchecked box in `docs/architecture/PAYSTACK_INTEGRATION.md`.
2. Paystack Ghana business account verified; subaccount model and fee structure
   confirmed commercially.
3. Full sandbox exercise: one real payment on each of mobile money, card and
   bank; a webhook delivered to the deployed URL; a settlement batch imported.
4. `PAYSTACK_PLATFORM_CHARGE_BPS` set deliberately, not defaulted.
5. `PAYSTACK_ALLOW_LIVE=true` as a separate, deliberate act from installing the
   live key.
6. `PAYMENT_ALERT_WEBHOOK_URL` and `PAYMENT_ALERT_OWNER` set, and a named
   on-call rota (§14). The application escalates and delivers; nothing receives
   it until these are configured.
7. At least one Portfolio through the full payout-destination flow, verified by
   Paystack, end to end.
8. Reconciliation confirmed running hourly, with its output being read by a
   person.
9. Ghana rent-receipt formalities reviewed by counsel (Act 220 s. 33).
10. The transaction-boundary risk in §14 of the payment checkpoint understood
    and accepted, or fixed.

### RECOMMENDED SHORTLY AFTER LAUNCH

- Clear the mypy backlog so CI gates again (§16).
- Metrics and dashboards (§14).
- Email and push transports (§12).
- Automated deployment and rollback.
- Read replicas if reporting queries grow.
- Rate-limit tuning under real traffic.

### CAN SAFELY WAIT

- CDN in front of media.
- Refund execution (deliberately unbuilt — see the payment checkpoint).
- Multi-region anything.
- `eas.json` update automation and OTA update channels.
- Wallet, escrow, lending, utilities, airtime.

---

## 18. Deployment sequence

1. Provision the VPC/network, managed PostgreSQL 16, managed Redis, and a
   private S3 bucket.
2. Create DNS records for `api.` and the web host; issue TLS certificates.
3. Load every secret from §1 into the secret manager. Generate each one
   independently.
4. Build the backend image from `backend/Dockerfile` **without**
   `INSTALL_DEV=true`.
5. Run `migrate` as the database **owner**, then `harden_database`, then
   `seed_geo` and `seed_amenities`. Confirm the append-only triggers and audit
   RLS exist.
6. Create the least-privilege application role and switch the app's
   `POSTGRES_USER` to it.
7. `collectstatic`, then deploy the API behind the load balancer with
   `/readyz` as the health check. Confirm `/healthz` and `/readyz` both answer.
8. Deploy the Celery worker (all four queues). Deploy beat with
   **`replicas: 1`**. Confirm `outbox.dispatch_pending` is running — everything
   downstream of a domain event depends on it.
9. Build and deploy the web app with `NEXT_PUBLIC_API_URL`. Confirm sign-in
   reaches the API and CORS/CSRF are correct.
10. Configure the SMS adapter and send one real code to a real handset. **Do not
    proceed past this step without it** (§0).
11. Point log shipping at the platform; bind the alert events from §14; connect
    error monitoring.
12. `createsuperuser`, sign in to `/admin/`, create the first Management user
    with the Operations Admin role, then verify the Management portal signs in.
13. Enable backups; **perform a restore rehearsal** into a scratch instance and
    confirm triggers and RLS survive it.
14. Run production smoke tests (§19) against the real deployment, with real
    accounts, keeping `PAYMENT_BACKEND` empty.
15. **Open to a controlled group of real users, with external payment recording
    only.** The rental product is complete without a PSP: tenants and providers
    record and confirm cash, MoMo and bank payments and get receipts.
16. Separately, and only after the whole *before accepting real money* list is
    satisfied: set `PAYSTACK_SECRET_KEY` to the sandbox key with
    `PAYMENT_BACKEND=paystack`, register the webhook, and complete the sandbox
    exercise.
17. Install the live key, set `PAYSTACK_ALLOW_LIVE=true`, take **one real
    payment of a small amount** on one Portfolio, and verify the whole chain:
    transaction → allocation → ledger → receipt → pending settlement → imported
    settlement.
18. Build and submit the Android and iOS releases with `EXPO_PUBLIC_API_URL`.
19. Widen access.

---

## 19. Production smoke tests

Run against the real deployment, as real accounts. This mirrors
`tests/integration/test_core_lifecycle_smoke.py` and
`tests/integration/test_money_lifecycle_smoke.py`, which walk the same chain in
CI.

1. Register a provider; receive a real SMS code; sign in.
2. Submit provider verification; approve it from the Management portal.
3. Create a Property and a Unit; submit and approve property verification.
4. Publish a listing; confirm it appears in Explore signed out.
5. Register a tenant; apply; approve; prepare and send an agreement.
6. Accept as the tenant; confirm the lease is active, the tenancy and occupancy
   exist, and the rent schedule was generated — this proves the outbox is
   dispatching.
7. Record an external cash payment; confirm it as the counterparty; download the
   receipt PDF.
8. Confirm a second, unrelated account can reach none of the above (403/404).
9. Confirm `/healthz` and `/readyz` answer, and that `/readyz` fails when Redis
   is stopped.
10. Confirm a scheduled task has run: a `RentReminder` row, or reconciliation
    output in the logs.
11. Money-path smoke, sandbox first and then once for real: create an intent,
    complete hosted checkout, and verify the webhook produced a transaction,
    allocation, two balanced ledger lines, a receipt with a downloadable PDF,
    and a **pending** settlement. Then verify the redelivered webhook changes
    nothing.

---

## 20. Rollback

**API and web** — redeploy the previous image tag. Both are stateless.

**Migrations** — do not assume reversibility. Several are additive by design and
some create triggers and RLS. Before deploying a migration that is not purely
additive, take a snapshot; rolling *back* application code while leaving a newer
schema in place is usually the safer half of the operation.

**Financial data is never rolled back by editing it.** Transactions, ledger
lines, receipts, allocations and obligation adjustments are append-only at the
database level; the trigger refuses an UPDATE or DELETE regardless of who is
connected as. A wrong financial record is corrected by another record and a
reconciliation exception, and that is the intended path — not a manual fix.

**Mobile** — an app store release cannot be rolled back quickly. Keep the API
compatible with the oldest release in the field.

**Payments, specifically** — the fastest and safest disable is to set
`PAYMENT_BACKEND=""` and redeploy. Checkout disappears from both clients
immediately, external payment recording keeps working, and no in-flight
provider transaction is lost: the reconciliation sweep still recovers confirmed
payments once the adapter is re-enabled.
