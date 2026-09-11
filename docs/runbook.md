# Runbook

## First run

```bash
git clone <repo> && cd ghana-rental-platform
cp .env.example .env
docker compose up
```

The api service applies migrations and seeds reference data on start. The
`.env` defaults are development placeholders; production secrets come from the
platform's secret manager. The web image installs its dependencies during the
first build; ordinary restarts reuse the `web_node_modules` volume and start
Next.js directly.

| Service | URL |
|---|---|
| Web console | http://localhost:3000 |
| API | http://localhost:8000/api/v1/meta/ |
| API docs (dev only) | http://localhost:8000/api/docs/ |
| Django admin | http://localhost:8000/admin/ (`createsuperuser` first) |
| MinIO console | http://localhost:9001 |

Mobile:

```bash
cd mobile && npm install && npx expo start
```

The API URL is resolved per platform: `10.0.2.2:8000` on an Android emulator,
`localhost:8000` on an iOS simulator, and the machine serving the JS bundle on a
real phone. Override it explicitly when none of those is right:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.42:8000/api/v1 npx expo start
```

## Everyday commands

```bash
docker compose exec api pytest                     # backend suite
docker compose exec api pytest tests/unit -q       # fast, no database
docker compose exec api ruff check .               # lint
docker compose exec api mypy apps config           # type check
docker compose exec api python manage.py makemigrations
docker compose exec api python manage.py migrate
docker compose exec api python manage.py createsuperuser
docker compose exec web npx tsc --noEmit           # web type check
docker compose logs -f api                         # logs
docker compose logs -f web                         # web startup/compile logs
docker compose up --build web                      # rebuild after web dependency changes
docker compose down -v                             # destroy local data
```

Design tokens are built with Node on the host, since the generated files are
committed: `node packages/design-tokens/build.mjs` (add `--check` to fail on
drift, which is what CI runs).

## Health

- `GET /healthz` — liveness. Touches nothing. If this fails the process is
  wedged; restart it.
- `GET /readyz` — readiness. Checks Postgres and Redis, returns 503 when either
  is unreachable, and reports per-check latency.

Do not point a liveness probe at `/readyz`. A slow database would then kill
healthy pods and turn degradation into an outage.

## When something is wrong

**Outbox events are not being delivered.**
Check `beat` is running (it schedules the dispatcher every 5 seconds) and that
`worker` is consuming the `default` queue. Then:

```sql
SELECT status, count(*) FROM outbox_event GROUP BY status;
SELECT name, attempts, last_error FROM outbox_event
 WHERE status = 'dead' ORDER BY created_at DESC LIMIT 20;
```

Dead letters are not deleted. Fix the handler, then reset the rows you have
verified are safe to replay.

**An audit chain does not verify.**

```python
from apps.audit.services import verify_chain
verify_chain("lease", "<lease-id>")   # -> (ok, [broken entry ids])
```

A break means rows were changed or removed outside the application. Treat it as
a security incident: preserve the database, check who holds owner-level
credentials, and do not "repair" the chain.

**A user says they were charged twice.**
Search logs by their request id, then:

```sql
SELECT * FROM idempotency_key WHERE actor_id = '<uuid>' ORDER BY created_at DESC;
```

Two `completed` rows with different keys for the same intent means the client
sent two logical requests — a client bug. One row means the retry was absorbed
correctly and the second debit came from elsewhere.

**Migrations are slow or locking.**
Nothing in this repository should add a `NOT NULL` column with a default to a
large table, or build an index non-concurrently. If a migration is doing that,
stop it and split it: add nullable → backfill in a job → enforce.

## Payment reconciliation: who is on call, and for what

A reconciliation exception means Rooomly's financial record and the payment
provider's do not agree, or that authenticated provider evidence could not be
applied. **Somebody's rent is in question until it is closed.** The queue is
deliberately unable to move money, so it does nothing at all unless a person
answers it — which is why the worker escalates rather than waiting to be read.

### Alert routing

Two paths, and both are configuration.

**The webhook.** Set `PAYMENT_ALERT_WEBHOOK_URL` to an incoming webhook — Slack,
PagerDuty, Opsgenie and every log platform accept one — and set
`PAYMENT_ALERT_OWNER` to the rota that owns these. Every alert is then posted
there as well as logged, carrying the exception id, kind, provider, status, age,
owner and a link to the workspace. **It carries no tenant, no amount and no
provider payload**: alert streams are copied into chat channels and retained by
third parties, and the exception id is enough to find everything else behind the
authenticated, audited workspace. Delivery is best-effort with a five-second
ceiling and can never stop reconciliation; a delivery failure is itself logged
at `error`, because an alerting path that has quietly stopped working is the
failure that hides every other failure.

**The log stream.** Bind these `event` values as well, or instead if you have no
webhook. They are the record either way:

| `event` | Level | Meaning | Response |
|---|---|---|---|
| `payment_reconciliation_exception_opened` | `error` | A new disagreement was found | Triage within the working day |
| `payment_reconciliation_exception_ageing` | `error` | Still open after `PAYMENT_RECONCILIATION_AGEING_HOURS` (default 4) | Assign an owner now |
| `payment_reconciliation_exception_breached` | `critical` | Still open after `PAYMENT_RECONCILIATION_BREACH_HOURS` (default 24) | **Page.** A payment has been unaccounted for a full day |
| `payment_reconciliation_exception_stalled` | `warning` | Acknowledged, and *still* open past the breach window | Somebody took it and it stopped moving. Reassign |
| `payment_alert_delivery_failed` | `error` | The alerting endpoint refused or could not be reached | Fix it now: every alert below is currently going nowhere |
| `settlement_batch_import_unavailable` | `warning` | Provider settlement report could not be read | Check provider status; payouts are not being confirmed |
| `reconciliation_provider_unavailable` | `warning` | The provider could not be reached by the sweep | Lost callbacks are not being recovered while this persists |
| `outbox_dead` | `error` | An event exhausted its retries | Inspect `outbox_event`; a dead `lease.activated.v1` means a tenancy with no rent schedule |
| `outbox_reclaimed` | `warning` | A dispatcher died mid-batch and its events were returned to the retry path | Expected occasionally; investigate if frequent |

`payments.alert_open_exceptions` re-emits every 30 minutes, so an ignored alert
keeps firing rather than scrolling away.

**Acknowledging.** Move an exception to `investigating` and the paging stops —
continuing to page somebody who has already answered is how a team learns to
mute the channel. It does **not** close anything: the row stays in the queue and
in the counts, and if it is still open past the breach window it speaks up again
as `..._stalled`. Only a person resolves an exception.

**One thing this cannot do.** Alerting runs on the Celery worker, so a worker
that is down cannot tell you it is down. That needs external liveness
monitoring — see `docs/deployment/PRODUCTION_DEPLOYMENT.md` §14.

### Triage

Open `GET /management/payments/` as an Operations Admin. `counts` reports
`open_exceptions`, `oldest_open_age_hours` and `breached_exceptions`, so the
first question — *has anything been sitting here?* — is answered without
reading rows.

What each kind means and what actually fixes it:

| Kind | What happened | What to do |
|---|---|---|
| `provider_succeeded_internal_pending` | The sweep found a provider-confirmed payment it could **not** post | Read `detail.confirmation_refused`. This is the reason the automatic recovery was refused; it is usually an obligation that changed underneath the payment |
| `provider_succeeded_internal_failed` | The provider took money for a payment Rooomly had recorded as failed, and the sweep could **not** post it | Read `detail.confirmation_refused`. Usually a payer told the payment failed who then replaced the checkout or paid again. Decide with the payer whether it is applied or refunded at the provider — nothing in Rooomly moves it |
| `amount_mismatch` / `currency_mismatch` | Rooomly and the provider disagree about the figure | Never "correct" Rooomly to match. Establish which is right with the provider first |
| `settlement_amount_mismatch` | A payout batch paid a figure Rooomly did not expect | Compare against the provider's settlement report; fees are the usual cause |
| `reversal` | The provider reversed a confirmed payment | Treat as a chargeback: the obligation is unpaid again, and that needs a product decision, not an edit |
| `unallocated_transaction` | Confirmed money whose purpose is not recorded | Find the intent's obligation; this is a code defect, not an operations one — escalate to engineering |
| `unmatched_provider_event` | A signed callback matched nothing, or could not be applied | Read `detail.error_message`. If a payment exists at the provider with no Rooomly intent, it must be refunded at the provider — Rooomly has no record to credit |
| `duplicate_provider_transaction` | One provider transaction seen twice | Usually a genuine double payment by the tenant; needs a refund decision |

### What resolving does and does not do

`POST /management/payments/reconciliation/:id/` records **an administrative
decision only**. It cannot change a transaction, allocation, receipt, rent
balance or settlement, and a closed exception cannot be reopened through the
API. Resolve it when you have understood it, not to silence the alert — the
note is the record of what was checked, and it is append-only in the audit log.

If the underlying money genuinely needs moving, that is a separate, deliberate
action taken with the provider. Nothing in this workspace is a repair tool.

## Authentication problems

**A user is not receiving codes.**
Check the SMS backend first — in development it is `console`, so codes appear in
the API logs rather than on a phone. Then:

```sql
SELECT purpose, status, attempts, send_count, created_at
  FROM identity_auth_challenge
 WHERE phone = '+233XXXXXXXXX'
 ORDER BY created_at DESC LIMIT 10;
```

`status = 'failed'` with `locked_until` in the future means the attempt cap was
hit; it clears itself in 15 minutes. Five rows in the last hour means the
per-number cap. Neither is cleared by hand — that is the control working.

**A user says they were signed out unexpectedly.**
Most likely a refresh-token reuse detection. Look for it:

```sql
SELECT family_id, generation, revoked_reason, revoked_at
  FROM identity_session WHERE user_id = '<uuid>' ORDER BY issued_at DESC;
```

`revoked_reason = 'token_reuse_detected'` means a rotated token was presented
again. That is either a stolen token or a client that failed mid-rotation. Both
are worth investigating; do not dismiss it as a client bug without checking the
device and IP on the sessions involved.

**A verification is stuck.**
Claims expire after 30 minutes and `trust.release_stale_claims` returns them to
the queue every ten. If an item is neither claimed nor moving, check the queue
depth and priorities:

```sql
SELECT priority, count(*), max(now() - created_at) AS longest
  FROM trust_review_queue WHERE resolved_at IS NULL GROUP BY priority;
```

**Never reset someone's verification by editing the row.** Use
`supersede_and_restart` so the previous decision stays readable. A verification
edited by hand is a verification nobody can defend in a dispute.

## Backups (planned)

Managed Postgres with point-in-time recovery, daily verified restores into a
scratch environment, and object storage versioning. **Not yet provisioned. No
backup exists for local data — `docker compose down -v` is irreversible.**


## Adding an outbox subscriber

A Celery worker builds its handler registry when the process starts. A handler
added while workers are running will **miss every event those workers dispatch**
until they restart — the event is consumed, finds no subscriber, and is marked
published. It is not retried, because nothing failed.

So when a deploy adds a `@subscribe` handler:

```bash
docker compose restart worker beat
```

Restart the workers **before** the code that emits the new events goes live. If
you find events published with no effect, that is this, and the events are gone
— they have to be replayed by hand from the outbox table.
