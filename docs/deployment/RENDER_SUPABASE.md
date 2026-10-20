# Render + Supabase pilot deployment

This is a low-cost **pilot topology**, not the production sign-off described in
[RELEASE_READINESS.md](RELEASE_READINESS.md). Check each provider's current
pricing and limits before choosing a plan; free-tier availability, backups,
regions, quotas and commercial terms can change.

| Piece | Service | Operational note |
|---|---|---|
| API, Celery worker and scheduler | Render web service (`render.yaml`) | One container; background tasks stop when the service sleeps or restarts |
| Redis for Celery | Render Key Value (`render.yaml`) | Private network; inspect persistence and capacity for your plan |
| Database (PostgreSQL + PostGIS) | Supabase | Confirm backup/restore and role capabilities for your plan |
| Photos and documents | Cloudflare R2 | Private bucket, scoped key, signed access only |
| Web app | Netlify | Build-time API/OAuth values and correct custom domain |

Do the steps in this order: Render asks for the Supabase and R2 details when it
creates the services.

---

## 1. Supabase: the database

1. Sign in at supabase.com → **New project**.
   - Choose the closest permitted region to the Render service after checking
     data-residency requirements for identity documents and account records.
   - Set a strong **database password** and keep it; you need it in step 4.
2. When the project is ready, open **Connect** (top of the dashboard) →
   **Session pooler**. Note these four values:

   | Supabase shows | You will enter it as |
   |---|---|
   | host, e.g. `aws-0-eu-central-1.pooler.supabase.com` | `POSTGRES_HOST` |
   | port `5432` | already set in `render.yaml` |
   | user, e.g. `postgres.abcdefghijklmnop` | `POSTGRES_USER` |
   | your database password | `POSTGRES_PASSWORD` |

   The Blueprint expects the **Session pooler** on port 5432. Verify the
   current Supabase connection guidance in your dashboard; do not substitute
   the transaction pooler without reviewing Django connection behavior.
3. Extensions: nothing to do. The migrations create `postgis`, `pg_trgm` and
   `btree_gist` themselves. If the first deploy fails with *permission denied to
   create extension*, enable those three under **Database → Extensions** and
   redeploy.

## 2. Cloudflare R2: file storage

1. cloudflare.com → **R2** → **Create bucket** named `danpahq-media` (the name
   `render.yaml` expects).
2. R2 → **Manage API tokens** → **Create API token** → *Object Read & Write*,
   limited to that bucket. Note the **Access Key ID**, the **Secret Access Key**
   and the **S3 endpoint** (`https://<account-id>.r2.cloudflarestorage.com`).
3. Keep the bucket private. The API hands out short-lived signed links.

## 3. Push the code to GitHub

Render deploys from a GitHub repository, so commit and push. `render.yaml` must
be at the repository root.

## 4. Render: the API and Redis

1. render.com → **New → Blueprint** → choose the repository. Render reads
   `render.yaml` and lists `danpahq-api` and `danpahq-redis`.
2. Fill in the values it asks for:

   | Variable | Value |
   |---|---|
   | `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | from step 1 |
   | `S3_ENDPOINT_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | from step 2 |
   | `GOOGLE_MAPS_SERVER_API_KEY` | your Google server key (Places and geocoding) |
   | `CLOUDMERSIVE_API_KEY` | API key from a Cloudmersive account; required before this Blueprint starts |
   | `RESEND_API_KEY` | API key from Resend; verify `oskec.com` in Resend first so `no-reply@oskec.com` can send |
   | `GOOGLE_OAUTH_CLIENT_ID` | Google Web client ID; use the same audience as `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the web build |

   The Blueprint generates its independent application secrets. Review the
   **entire** environment list in `render.yaml` against the live dashboard;
   `sync: false` values are not recovered from Git during a later sync. The
   Blueprint allows `api.oskec.com` and `app.oskec.com`; change those origins
   if the deployed domains change.

   Optionally add `ADMIN_URL` (for example `ops-7f3k2q/`) in the dashboard to
   move Django admin off the default `/admin/`. The login is capped at 10
   attempts per email and 20 per address in 15 minutes either way; the path
   just keeps scanners away from the password form.
3. **Apply.** The first build takes several minutes (it installs the map
   libraries). On start the service migrates, applies the packaged audit-log
   hardening SQL, seeds Ghana's places and amenities, starts Celery, then serves.
4. Check `https://api.oskec.com/healthz` and `/readyz`, then run the
   live-domain smoke tests in the release-readiness guide. `healthz` alone does
   not prove the worker, scanner, mailer or database policy works.

## 5. Point the apps at it

- **Mobile builds:** `EXPO_PUBLIC_API_URL=https://api.oskec.com/api/v1`.
  It is `https`, so release builds accept it.
- **Web (Netlify):** set `NEXT_PUBLIC_API_URL=https://api.oskec.com/api/v1`
  and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` **before the build**. Both are baked into
  the JavaScript bundle. Make sure `CORS_ALLOWED_ORIGINS` on Render holds the
  actual web address exactly, with `https://` and no trailing slash. Also
  verify that the Google OAuth authorized origin is `https://app.oskec.com`.

---

## What to know

- **Availability.** A free sleeping service cannot reliably run scheduled
  Celery work. A health-check pinger is not an availability architecture; move
  API, worker and beat to always-on capacity before depending on timely OTP,
  notifications, reconciliation or maintenance jobs.
- **Uploads are virus-scanned through Cloudmersive.** The application enforces
  a 3,500,000-byte maximum for this adapter. Confirm the current account quota
  and file limit with the provider. A missing key, provider error or
  ambiguous verdict never releases a file. Identity documents are sent to a
  third party for scanning; review the provider's data-processing terms and
  disclose this in the privacy notice before accepting real documents.
- **Email uses HTTPS.** The Blueprint uses Resend's HTTPS API for
  address-verification messages. Confirm the current account limits; a missing
  key stops startup.
- **SMS and payments start off.** One-time codes are not sent until Arkesel is
  configured in Management; checkout stays off until Paystack keys are set.
- **No shell on the free plan.** Run one-off commands (creating an operations
  account, for example) from your own machine against the Supabase connection,
  with `DJANGO_SETTINGS_MODULE=config.settings.production` and the same variables.
- **Database privilege.** This Blueprint uses the same `POSTGRES_USER` for
  startup migrations and application traffic. That does **not** satisfy the
  separate least-privilege runtime-role/RLS gate. Do not infer hardening from a
  successful `harden_database` log line while serving as the owner role.
- **Backups.** Do not rely on an occasional export as production recovery.
  Confirm automated retention and rehearse a restore to a scratch instance.
  If the chosen plan cannot do this, keep it to synthetic-data pilots.

## When something fails

| Symptom in Render's logs | Fix |
|---|---|
| `X must be set in the environment` | A value from step 4 is missing. |
| `could not translate host name` / connection timeout | `POSTGRES_HOST` is the direct host; use the Session pooler host. |
| `password authentication failed` | `POSTGRES_USER` must be `postgres.<project-ref>`, not `postgres`. |
| `permission denied to create extension` | Enable `postgis`, `pg_trgm`, `btree_gist` in Supabase, redeploy. |
| Out of memory (exit 137) | Already at one gunicorn worker; drop `--threads` to 2 in `render.yaml`. |
| Browser shows a CORS error | `CORS_ALLOWED_ORIGINS` does not match the web address exactly. |
