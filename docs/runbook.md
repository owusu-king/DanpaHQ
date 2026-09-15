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

## Maps and places

Maps and place search run on Google Maps Platform (ADR 0034), and every key is
optional. Without keys Explore is a list, a listing's Location section says its
map is not available, and place suggestions come from Rooomly's localities that
have a centre. `seed_geo` seeds names without centres, so a fresh database
suggests nothing until centres exist.

**Keys, locally.** Use keys from a development Google Cloud project, never
production's (`docs/deployment/PRODUCTION_DEPLOYMENT.md` §9a has the setup).
Put them in the root `.env`, then recreate the containers that read them:
Compose reads `.env` when it creates a container, and Next inlines
`NEXT_PUBLIC_*` values when it compiles.

```bash
# .env
GOOGLE_MAPS_SERVER_API_KEY=...        # Places API (New); only the API uses it
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...   # Maps JavaScript API; allow http://localhost:3000/*
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=       # empty in development uses Google's DEMO_MAP_ID

docker compose up -d --force-recreate api web
```

Check the API reaches Google:

```bash
curl "http://localhost:8000/api/v1/geo/places/suggest/?q=osu&session=5b1f0c9e-3d2a-4b7c-9e8f-1a2b3c4d5e6f"
```

`"provider": "google"` means it does. `"rooomly"` means Google was not asked or
did not answer. With no key in the container nothing is logged: the localities
answer by design. Otherwise the API log shows `place_suggestions_fell_back`
beside `location_provider_refused`, which carries Google's status, or
`location_provider_unreachable`.

**The web map.** A map that says it is not available was built without
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (or, in a production build, without a Map ID):
recreate `web`. A map that starts to load and then gives up was refused by
Google, and the browser console names why: `RefererNotAllowedMapError` (add the
origin to the key's website restrictions), `ApiNotActivatedMapError` (enable the
Maps JavaScript API), `BillingNotEnabledMapError` or `InvalidKeyMapError`. A map
that draws but shows no price markers has an invalid Map ID.

**The phone.** Expo Go needs no keys. On Android it draws Google Maps with Expo
Go's own key; on an iPhone it draws Apple Maps, because Expo Go cannot load
Google's iOS SDK. A development or release build reads its keys when its native
project is generated, from the environment or `mobile/.env`:

```bash
GOOGLE_MAPS_ANDROID_API_KEY=... GOOGLE_MAPS_IOS_API_KEY=... npx expo run:android
```

A build without its platform's key shows Explore as a list. An Android build
that draws a blank map beneath its markers has a key whose restriction does not
match the build's package name and SHA-1 fingerprint, and `adb logcat` reports
an authorization failure. After `react-native-maps` or `app.config.js` changes,
restart Metro with `npx expo start -c`.

**Listing positions.** `refresh_listing_locations` recomputes every listing's
approximate public point (ADR 0033 §3). Run it after property coordinates or
locality centres change:

```bash
docker compose exec api python manage.py refresh_listing_locations
```

## Health

- `GET /healthz` — liveness. Touches nothing. If this fails the process is
  wedged; restart it.
- `GET /readyz` — readiness. Checks Postgres and Redis, returns 503 when either
  is unreachable, and reports per-check latency.

Do not point a liveness probe at `/readyz`. A slow database would then kill
healthy pods and turn degradation into an outage.

## When something is wrong

**A web page 404s, and its route file is right there on disk.**
The route was never registered by the dev server, not deleted. Next builds its
route map when it starts, and on a Windows bind mount a directory appearing or
changing inside `web/app` does not reliably reach the container's watcher —
`WATCHPACK_POLLING` rebuilds modules it already knows about, which is a
different thing. The symptom is a plain Next 404 for every account while the API
answers 200 for the same record:

```bash
docker compose logs web --tail 50 | grep " 404 "   # the page, not the API
docker compose restart web                          # the fix
```

Confirm the API is innocent before restarting, so a real authorization 404 is
not mistaken for this: `docker compose exec api python manage.py shell` and call
the endpoint with `APIClient().force_authenticate(user=…)`. A 500 with
`Manifest file is empty` in the first seconds after a restart is the dev server
compiling several routes at once; it clears on the next request.

**Redis will not start, and one page answers 500 while the rest are fine.**
An unclean shutdown — a host crash, a power cut — can leave a partial write at
the end of Redis's append-only file. Redis refuses to load it and exits 1 on
every start:

```bash
docker compose ps -a | grep redis                      # Exited (1)
docker compose logs redis --tail 5 | grep "Bad file format"
```

Repair the AOF rather than deleting the volume; the fix truncates the unparseable
tail and keeps everything before it:

```bash
docker run --rm -v rental_redisdata:/data redis:7-alpine \
  sh -lc 'cd /data/appendonlydir && echo y | redis-check-aof --fix appendonly.aof.manifest'
docker compose up -d --wait redis
```

What is lost is whatever was written in the last moments before the crash:
cached values, which are re-read, and any Celery task still queued, which is why
a dead Redis is a degradation rather than a data loss. Application code must
treat it that way too:

* a read-through cache goes through `apps.core.cache.cache_get` / `cache_set`,
  never `cache.get` directly, so an unreachable Redis costs a query and not a
  page;
* a rate limit subclasses `apps.core.throttling.CacheAwareRateThrottle` and
  states its `fail_open`. DRF reads throttle history straight from the cache, so
  a throttle left on `SimpleRateThrottle` answers 500 from inside
  `allow_request` no matter how careful the view behind it is. Cost and
  throughput limits fail open; anything in front of a credential fails closed
  with a 503 rather than opening a guessing window;
* a limit DRF cannot express — the Management sign-in cap is twenty attempts in
  fifteen minutes — counts with `apps.core.throttling.count_attempt`, never with
  `cache.get` then `cache.set`. That read-modify-write let simultaneous attempts
  all read the same number, so the cap never closed; `count_attempt` is atomic
  (`add` then `incr`) and refuses with a 503 when it cannot count.

`apps/core/health.py` is the exception to all of it: saying whether the cache is
reachable is its whole job, so it reads the cache directly and must keep
failing loudly.

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
