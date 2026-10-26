# Deploy DanpaHQ

For the separate `staging` branch and test environment, see
[Staging setup](#8-staging-setup) at the end of this document.

| Part | Host | Updates |
|---|---|---|
| Web — `danpahq.com` | Cloudflare Pages | Push to `main` |
| API, jobs and scheduler — `api.danpahq.com` | Render: `danpahq-api` | Automatic after CI + database release pass |
| Redis | Render: `danpahq-redis` | Blueprint-managed |
| Database / private files | Supabase / Cloudflare R2 | Setup below |
| Android / iOS | Expo EAS | Build when mobile changes |

**Readiness is unconfirmed.** Repository configuration and local tests do not verify live secrets, permissions or delivery. Complete the operator checklist in §6 before launch.

**Every release:** push reviewed `main` → GitHub checks/migrations → Render deploys → verify §6. Routine database releases run in GitHub, not local API shells. Create infrastructure/provider accounts first; Render is paid.

## 1. Collect keys — once

Prerequisites: GitHub Actions, Git; Node **22.13+ (22.x)** for mobile. Keep secrets in host settings/password manager, never Git or client bundles.

| Where | Collect / configure |
|---|---|
| Supabase → Connect → **Session pooler** | Frankfurt project; host, owner login/password, port `5432`, database `postgres`. Enable `postgis,pg_trgm,btree_gist`; disable public Data API exposure for Django tables. |
| Cloudflare R2 → `danpahq-media` | Private bucket; bucket-scoped Object Read & Write token; endpoint `https://<account-id>.r2.cloudflarestorage.com`; apply [CORS policy](../ops/r2-cors.json). |
| Deployment email provider | Current templates select Resend: verify the sender domain and obtain `RESEND_API_KEY`. Management can select Brevo for alerts and verification; see §5.2 before choosing a Brevo-only deployment. |
| Cloudmersive | `CLOUDMERSIVE_API_KEY`; upload limit **3,500,000 bytes**. |
| Google Cloud → Web OAuth client | Authorize origin `https://danpahq.com`; no Web redirect URI is needed for the current sign-in flow. Use this ID for Render/EAS `GOOGLE_OAUTH_CLIENT_ID`, Pages `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and mobile's `webClientId`. |
| Google Cloud → iOS OAuth client | Register bundle ID `com.danpahq.app` in the same Google Cloud project. Set its separate ID as EAS `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in preview/production. App configuration registers its reversed-ID callback scheme; rebuild/regenerate native iOS configuration when it changes. |
| Google Cloud → Android OAuth client(s) | In the same project, register package `com.danpahq.app` with the SHA-1 of every certificate used to sign installed builds: development/preview as applicable and the Play app-signing certificate. The upload certificate alone does not cover Play-distributed apps. Android client IDs remain in Google Cloud; this app does not take an Android client ID environment variable. |

Reuse existing clients where their registrations match. The native clients are separate from the shared Web/server client: both native platforms still use the Web ID as the backend token audience; do not replace `GOOGLE_OAUTH_CLIENT_ID` with an iOS or Android ID. Client IDs are public identifiers; client secrets must not be bundled. See Google's [iOS client/server configuration](https://developers.google.com/identity/sign-in/ios/start-integrating) and [Android signing-certificate requirements](https://developers.google.com/android/guides/client-auth).

**Optional maps:** enable billing/APIs. Restrict `GOOGLE_MAPS_SERVER_API_KEY` to Places API (New)/server IPs; `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to Maps JavaScript/`https://danpahq.com/*`; add `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Restrict `GOOGLE_MAPS_ANDROID_API_KEY` to Android Maps SDK/package/SHA-1s. iOS uses Apple Maps; missing keys show lists.

## 2. API on Render

**First time**

1. **New → Blueprint → repository → `render.yaml`**: one `1c-2g` service + private `256mb` Redis (`noeviction`), branch `main`, **After CI Checks Pass**. Supply a random **50+ character** `DJANGO_SECRET_KEY`; preserve existing secrets.

| Render variable | Value |
|---|---|
| `POSTGRES_HOST,POSTGRES_USER,POSTGRES_PASSWORD` | Session pooler host, runtime login `grp_app.<project-ref>`, distinct runtime password |
| `S3_ENDPOINT_URL,S3_ACCESS_KEY,S3_SECRET_KEY` | R2 endpoint and credentials from §1 |
| `RESEND_API_KEY,CLOUDMERSIVE_API_KEY,GOOGLE_OAUTH_CLIENT_ID` | Values from §1 |

2. **Apply**; initial startup can fail until the owner release completes. Do not bypass the startup permission checks. Fill [owner template](../backend/production-owner.env.example): **owner** DB credentials, existing Render secrets, `DATABASE_RUNTIME_PASSWORD` matching runtime password. Save contents in GitHub **Settings → Environments → production → Secret `PRODUCTION_OWNER_ENV`**; restrict branches to `main`. Protect `main`/workflows. Never put owner/bootstrap secrets in Render.
3. First admin: include all three `DJANGO_SUPERUSER_PHONE,DJANGO_SUPERUSER_EMAIL,DJANGO_SUPERUSER_PASSWORD` in that secret. **Any** existing superuser (including disabled) skips creation; regular accounts are never promoted. After successful bootstrap, remove those fields. Remove `DATABASE_RUNTIME_PASSWORD` after initial role provisioning; supply it again only for an explicit runtime-password rotation coordinated with runtime `POSTGRES_PASSWORD`. Retain the separate owner credential for future releases.
4. Push `main` or rerun its failed workflow. Tests → **Production database release** (migrate/harden/seed/bootstrap) → Render. Errors block auto-deployment. Startup checks runtime DB permissions, collects static files and supervises all processes; child exit stops the service. Scheduler’s DB lease prevents concurrent beat instances: keep Session pooling/one instance.
5. **Custom Domains → `api.danpahq.com`**: use Render’s DNS target, DNS-only until HTTPS is issued. Optional settings go in `danpahq-integrations`; add new `sync:false` inputs manually. Migrating from split services? Once healthy, suspend old `danpahq-worker`/`danpahq-beat`; removing YAML entries does not stop them.

**Command boundary:** GitHub runs [`sh scripts/render-migrate.sh`](../backend/scripts/render-migrate.sh) from `backend/` with the owner environment: `check --deploy --fail-level WARNING` → `migrate --noinput` → `provision_runtime_database` (including audit hardening) → `seed_geo` → `seed_amenities` → `bootstrap_superuser`. Use the complete current migration graph; do not target historical migration names, fake migration history or reuse an existing database with incompatible historical records.

Render runs [`sh scripts/render-start.sh`](../backend/scripts/render-start.sh) with runtime credentials: reject owner/bootstrap secrets → deployment checks → `check_runtime_database` → static collection → API/worker/scheduler supervision. Runtime startup does not run migrations. The scheduler requires a persistent database session; use Session pooling, not transaction pooling. Do not substitute the image's bare Gunicorn default for this startup command.

**Every release:** watch GitHub **Release checks**, then Render **Events**. Back up before schema changes; migrations must support running code. Never bypass failed CI with Manual Deploy; migrations may need repair. API/jobs share capacity: monitor memory/queue delay. Diagnostics: [README.md](../README.md).

<div style="break-after: page;"></div>

## 3. Management and integrations — once

1. Sign in at `https://api.danpahq.com/admin/`; scan the authenticator QR, confirm its code and save recovery codes. Provision Management users for `https://danpahq.com/management`. Operations Admin → **Configuration → Two-factor authentication** sets consumer/Management policies: Disabled, Optional or Required (default: required for administrators; disabled for consumers). Changes require a reason and revoke sessions; Support is denied. Super Admin security remains in Super Admin. Google/password recovery obey policy. Emergency administrator recovery: trusted shell `python manage.py enroll_admin_mfa --surface django --email <email> --reset` (or `--surface management`); never startup/CI. Preserve `RUNTIME_CONFIG_ENCRYPTION_KEY` with backups.
2. Management → `SMS_BACKEND=arkesel`, `ARKESEL_API_KEY`, approved `ARKESEL_SENDER_ID`, `ARKESEL_SANDBOX=false`. Saved settings override environment; `null` sends nothing.
3. **Keep payments disabled** (`PAYMENT_BACKEND` empty, `PAYSTACK_ALLOW_LIVE=false`) until tested. Management: `PAYSTACK_TEST_SECRET_KEY,PAYSTACK_TEST_PUBLIC_KEY,PAYSTACK_PLATFORM_CHARGE_BPS`. Set `PAYSTACK_CALLBACK_URL=https://danpahq.com/record/payment-return`; Paystack webhook `https://api.danpahq.com/api/v1/webhooks/payments/paystack/`. Verify signed/duplicate/reordered callbacks, reconciliation, subaccounts/balances before supplying `PAYSTACK_LIVE_SECRET_KEY,PAYSTACK_LIVE_PUBLIC_KEY` and approving live mode. Configure `PAYMENT_ALERT_OWNER,PAYMENT_ALERT_WEBHOOK_URL` or monitored logs.

## 4. Web on Cloudflare Pages

**First time:** Workers & Pages → **Pages → Connect to Git → this repository**.

| Setting | Value |
|---|---|
| Production branch / root | `main` / `web`; keep sibling `packages/design-tokens` |
| Build command / output | `npm ci && npm run build` / `out` |
| `NODE_VERSION` | `22.13.0` |
| `NEXT_PUBLIC_API_URL` | `https://api.danpahq.com/api/v1` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same Web OAuth ID as Render |
| Optional map variables | Browser key and Map ID from §1 |
| Optional `NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_PLAY_STORE_URL` | Public store listing URLs for the front door's **Get the mobile app**; leave empty until live (badges read "Coming soon") |

**Custom domains → `danpahq.com`**: apply supplied DNS, verify HTTPS; redirect `www` if used. Preserve `_headers`/`_redirects`, especially `Cross-Origin-Opener-Policy: same-origin-allow-popups`. Build needs Google Fonts access; static export needs no `next start`.

**Every release:** push to `main`; check **Deployments**. Changed `NEXT_PUBLIC_*` values require a rebuild (**Retry deployment**).

## 5. Mobile with Expo EAS

**Existing EAS project:** obtain Apple/Play accounts/store records. EAS profiles contain production API/`GOOGLE_OAUTH_CLIENT_ID`; confirm ID matches Render. From `mobile/`: `npm ci`, then `npx eas-cli login`. Supply the existing `EXPO_PUBLIC_EAS_PROJECT_ID` as in §5.1 and run `npx eas-cli project:info` to confirm the project. Do not initialize a replacement project.
Retain project link. EAS preview/production include `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`; verify its Google registration uses bundle ID `com.danpahq.app`. Set optional map key in EAS. Android OAuth: `com.danpahq.app` + preview/upload/Play SHA-1s (`npx eas-cli credentials --platform android`; Play App Integrity); Android client IDs stay in Google Cloud, not app environment. EAS generates the iOS reversed-ID callback scheme during prebuild; regenerate any existing native iOS project after changing the ID.

**Test APK:** `npx eas-cli build --platform android --profile preview`.

**Store release:**
```sh
npx eas-cli build --platform all --profile production
npx eas-cli submit --platform android --latest
npx eas-cli submit --platform ios --latest
```
Preserve checked-in Android sources. EAS manages signing; missing/debug release certificates fail. Test physical devices; Google needs native builds, not Expo Go. Never bundle signing/OAuth secrets.

**When a listing goes public:** set its URL in Cloudflare Pages (`NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_PLAY_STORE_URL`, §4) and **Retry deployment**; the front door's badge links to it from then on.

### 5.1 Native property-interest push

For Android/iOS sales-property interest notifications; buyer–seller chat is not part of the current UI. Enable **Push notifications** and the phone's notification permission.
The existing **Enquiries** topic preference must also allow alerts.

**1. Set up the existing project.** Copy its UUID from Expo → Project settings →
General. Download `google-services.json` for Firebase Android app `com.danpahq.app`.
Use a current [EAS CLI](https://docs.expo.dev/eas/cli/). From the repository root, in PowerShell:

```powershell
Set-Location .\mobile
$env:EXPO_PUBLIC_EAS_PROJECT_ID = Read-Host 'Existing EAS project UUID'
npx eas-cli project:info
$pushGoogleServices = (Resolve-Path (Read-Host 'Full path to google-services.json')).Path
foreach ($pushEnvironment in 'preview', 'production') {
    npx eas-cli env:set $pushEnvironment --name EXPO_PUBLIC_EAS_PROJECT_ID --value $env:EXPO_PUBLIC_EAS_PROJECT_ID --type string --visibility plaintext --scope project --non-interactive
    npx eas-cli env:set $pushEnvironment --name GOOGLE_SERVICES_JSON --value $pushGoogleServices --type file --visibility secret --scope project --non-interactive
}
```

Confirm the project name before continuing; do not run `eas init`. For future
terminals, save `EXPO_PUBLIC_EAS_PROJECT_ID=<UUID>` in the ignored root `.env`.

**2. Configure push credentials.** Run:

```powershell
npx eas-cli credentials --platform android
npx eas-cli credentials --platform ios
```

Android: production → **Google Service Account** → **Push Notifications (FCM V1)**;
select/upload a service-account key from the same Firebase project and enable its
Cloud Messaging API. This key is separate from `google-services.json`.
iOS: production → **Push Notifications** → select/create the APNs key.
[Expo credential guide](https://docs.expo.dev/push-notifications/fcm-credentials/).

**3. Enable the backend.** Complete the full current migration release through §2; no historical migration target is needed. In Render →
`danpahq-api` → Environment, set `EXPO_PUSH_ENABLED=true` and save/redeploy.
Set `EXPO_ACCESS_TOKEN` only if Expo Enhanced Push Security is enabled.

**4. Build and test a new app.** From the same terminal:

```powershell
npx eas-cli build --platform android --profile preview
# For an iPhone test, register the phone first:
npx eas-cli device:create
npx eas-cli build --platform ios --profile preview
```

Install on a real phone and sign in as the seller; allow notifications. From another
account, express interest in a sales property with no prior interest from that buyer
while the seller app is backgrounded/closed normally. Tap to open the property-interest
record. Disable Push notifications and use another fresh buyer/property pair:
no new push; the enquiry and in-app notification must still be recorded.
Use a new native build, not Expo Go. Already queued pushes cannot be recalled.

### 5.2 Email alerts (Brevo)

1. In Brevo, verify/authenticate your sender domain, authorize a sender address,
   enable transactional sending, and create an **API key** (not an SMTP key).
2. Complete the full current migration release through §2; do not target superseded migration names.
3. In **Management → Configuration → Email delivery**, save the Brevo API key,
   sender email/name, and choose **Brevo** as provider. The key is encrypted and
   hidden after saving; changes apply to the next alert without a restart.
4. Users add/verify their account email, then enable **Email alerts** in web or
   mobile notification preferences. Existing topic switches also apply.
5. Test an upcoming viewing or rent reminder. Turn Email alerts off and repeat:
   no new alert email; the inbox still works. Separately request and complete an
   account-email verification code, including with Email alerts disabled.

**Email routing:** with Management `NOTIFICATION_EMAIL_BACKEND=brevo`, both account-verification codes and eligible alerts use the same `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` and `BREVO_SENDER_NAME`. Verification is user-requested security mail and does not require alert opt-in or an already-verified address; alerts require a verified recipient, Email alerts enabled and the applicable topic enabled. Without the Brevo selection, verification uses deployment `EMAIL_BACKEND` and these alerts stay off. A Brevo failure does not automatically fall back to Resend.

**Deployment decision:** the current Blueprint and owner template select `apps.identity.email_backend.ResendEmailBackend`, so production startup still requires `RESEND_API_KEY`, even when Management selects Brevo. Keep that deployment default configured, or explicitly configure `EMAIL_BACKEND=apps.identity.email_backend.BrevoEmailBackend` in both owner and runtime environments for a Brevo-only deployment. In the latter case, configure and verify Management's Brevo credentials before opening email-verification workflows. Management selection alone does not change deployment `EMAIL_BACKEND` or its startup requirements.

Email alerts start off. Existing jobs/outbox events send reminders and other
notifications; keep the worker/scheduler running. Existing reminder timing and
plan eligibility still apply. Provider acceptance is recorded
as `email_sent_at`; failures use `email_failed_reason` and `notify_email_failed`
logs without addresses, keys or message content. Acceptance does not guarantee
inbox delivery: check Brevo's transactional logs for bounces or blocked recipients.
[Brevo sending guide](https://developers.brevo.com/docs/send-a-transactional-email).

## 6. Verify each release

`curl -fsS https://api.danpahq.com/readyz` → `status=ok,environment=production`; `/healthz` is liveness. Check worker/scheduler logs; browser/native OTP/password/Google, email, refresh/logout/revocation, maps, clean/rejected/scanner-failed uploads, direct links/cross-account denial. Exercise listing → application → agreement → rent. Leases require legal approval: `LeaseTemplate.review_status=approved_for_production`.

### 6.1 Mandatory production confirmations

All boxes are outstanding operator confirmations, not claims about deployed infrastructure. Record the environment, checked release SHA, date and responsible operator; never record secret values here.

- [ ] **Settings and secrets:** owner and runtime use `DJANGO_SETTINGS_MODULE=config.settings.production`. Supply independent, strong `DJANGO_SECRET_KEY`, `OTP_PEPPER`, `ACCESS_TOKEN_KEY`, `NATIONAL_ID_PEPPER`, `UNIT_ACCESS_CODE_PEPPER`, `PASSPORT_SHARE_PEPPER`, `MANAGEMENT_CSRF_KEY`, `RUNTIME_CONFIG_ENCRYPTION_KEY` and `STORAGE_SIGNING_KEY`. Preserve existing values and encrypted-data backups; copy matching values into the [owner template](../backend/production-owner.env.example), not new keys on each release.
- [ ] **Release controls:** configure GitHub `PRODUCTION_OWNER_ENV`, production-environment approvals/branch restrictions and protected `main`/workflow changes. Confirm Render waits for the release checks. Owner/bootstrap credentials and `DATABASE_RUNTIME_PASSWORD` must not enter the runtime service. First-admin bootstrap is conditional on no superuser existing; require MFA and retain recovery codes.
- [ ] **Database:** explicitly set `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and `DATABASE_RUNTIME_ROLE` for each environment. Confirm owner versus runtime identity, TLS via `DB_SSLMODE`, Session pooling and `postgis`, `pg_trgm`, `btree_gist`. Confirm managed-host permission to create/provision the runtime role and apply extensions, grants and hardening. Disable unintended public Data API exposure for Django tables. Do not reuse incompatible pre-baseline migration history.
- [ ] **Effective permissions:** use read-only privilege inspection on production; after owner release, verify `check_runtime_database` succeeds using the runtime credential in a controlled host diagnostic. Confirm migration-history SELECT succeeds while INSERT/UPDATE/DELETE/TRUNCATE fail; no column/PUBLIC grants, memberships or owner-role switching may bypass this. Confirm no runtime schema creation or audit UPDATE/DELETE/TRUNCATE, and that normal application reads/writes still work. Run destructive denial probes only against an isolated disposable copy, never live records.
- [ ] **Redis and processes:** confirm private, reachable `REDIS_URL`, the Blueprint's `noeviction` policy, worker queues, one active scheduler lease and process restart/shutdown behavior. If overriding `CELERY_BROKER_URL` or `CELERY_RESULT_BACKEND`, confirm those targets and any required transport security too. Database/Redis/storage settings inherit development defaults if omitted; do not deploy `.env.example` as a production environment.
- [ ] **Private files and scanning:** verify `S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, private bucket policy and [R2 CORS](../ops/r2-cors.json). R2 requires `S3_UPLOAD_METHOD=put`; confirm any `S3_PUBLIC_ENDPOINT_URL` is the intended client-reachable signing endpoint, with request-host following disabled. Current templates select Cloudmersive: verify `CLOUDMERSIVE_API_KEY`, quota and clean/rejected/failed-scan behavior. An intentional `FILE_SCAN_MODE=strict` holds new uploads closed; production forbids the permissive bypass.
- [ ] **Domains and clients:** verify API/web DNS and TLS, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `CORS_ALLOWED_ORIGINS` and proxy HTTPS handling. Confirm `NEXT_PUBLIC_API_URL` and `EXPO_PUBLIC_API_URL` point to the intended API; rebuild clients after public configuration changes. Check `/readyz` and `/healthz` as above. Client bundles must contain no provider/private signing keys.
- [ ] **Email and recovery:** choose the deployment email backend as in §5.2, provide its required credentials and verify sender-domain authorization and actual verification-code delivery. Startup validation is not a delivery test. Establish monitored logs, database/object backups and an isolated restore procedure before launch.

### 6.2 Conditional features and operator decisions

- [ ] **Phone OTP / provider applications:** before enabling these workflows, configure Management's `SMS_BACKEND`, `ARKESEL_API_KEY`, `ARKESEL_SENDER_ID` and `ARKESEL_SANDBOX`; verify real OTP delivery/verification. Production's `null` default sends nothing. Providers cannot submit for management review without verified phone ownership.
- [ ] **Email alerts:** optional opt-in feature; configure Management's Brevo provider/sender credentials (§5.2). Test a real eligible viewing/rent event, verified recipient, topic opt-out and Email alerts opt-out. Check provider acceptance and eventual delivery separately; keep jobs running.
- [ ] **Native push:** optional and disabled by default; confirm `EXPO_PUSH_ENABLED`, and `EXPO_ACCESS_TOKEN` if enhanced security is enabled. Verify the existing EAS project, Firebase/FCM and APNs credentials, native build, device permission, intended recipient, tap navigation and opt-out using §5.1. This does not establish web-browser push support.
- [ ] **Google / maps:** enable only after matching OAuth client identifiers, native package/bundle registrations and signing fingerprints; configure restricted map keys if maps are required. Verify native and browser behavior; no key is proof of a working integration.
- [ ] **Payments:** keep `PAYMENT_BACKEND` disabled and `PAYSTACK_ALLOW_LIVE` off until test credentials, callbacks, signed/duplicate/reordered webhooks, reconciliation and alert ownership are verified (§3). Approve live credentials/mode explicitly. Production rejects the memory payment backend. Confirm production-approved lease templates and legal/processor approvals before enabling the associated workflows.

Unchecked requirements block the affected launch/workflow. Passing repository tests or filling a template does not establish production readiness.

| Problem | Check |
|---|---|
| Runtime refuses to start | GitHub database release passed? Runtime role/secrets correct? |
| Upload remains pending | Worker, R2 CORS, Cloudmersive key/quota and file limit |

**Launch gates:** credentials/DNS/billing, integration/device/MFA tests, privacy/processor/lease approval, DB/object backups + isolated restore. Mobile's patched decoder has navigation regression tests; Expo CLI's `node-forge`/Zod advisories still require review. Do not force Expo downgrades or expose Metro/DevTools publicly. Record SHA/deployment IDs/on-call owner.

## 7. Roll back

**Web:** Pages → previous deployment → **Rollback**. **API:** Render → previous deploy → **Rollback** only if schema-compatible; migrations do not revert. Disable auto-deploy until a corrected release is ready. **Mobile:** corrective build; support older clients. Monitor outbox/payment exceptions: [README.md](../README.md).


---

<div style="break-before: page;"></div>

## 8. Staging setup

Staging is a separate place to test changes before sending them to production.
Use the `staging` branch with these addresses:

| Part | Staging value |
|---|---|
| Website | `https://staging.danpahq.com` |
| API | `https://api-staging.danpahq.com` |
| Render Blueprint file | [`render.staging.yaml`](../render.staging.yaml) |
| GitHub environment | `staging` |
| GitHub release secret | `STAGING_OWNER_ENV` |

Follow these steps in order. Keep staging databases, files and application
secrets separate from production. Render resources add hosting costs.

### Step 1 — Create the staging database in Supabase

1. Sign in to Supabase and create a new project named **danpahq-staging**.
2. Choose **Frankfurt**, matching the staging Render services. Set a strong
   database password and save it in your password manager.
3. Enable the database extensions **postgis**, **pg_trgm** and **btree_gist**.
   Disable Data API exposure for the Django application tables.
4. Open **Connect → Session pooler** and save the host, username, database name
   and port. Use port **5432** and SSL mode **require**. Use the Session pooler,
   rather than the direct IPv6 connection or Transaction pooler.
5. Choose a second strong password for the application runtime role `grp_app`.
   The GitHub release will create this role; you do not need to create it manually.

### Step 2 — Create staging file storage in Cloudflare R2

1. Create a private bucket named **danpahq-media-staging**.
2. Create an Object Read & Write token restricted to this staging bucket.
   Save its access key, secret key and R2 endpoint securely.
3. Open **R2 Object Storage → danpahq-media-staging → Settings**.
4. Under **CORS Policy**, select **Add CORS policy** (or edit the existing policy).
   Select the **JSON** tab and paste the following contents of
   [`ops/r2-cors.staging.json`](../ops/r2-cors.staging.json):

   ```json
   [
     {
       "AllowedOrigins": ["https://staging.danpahq.com"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

5. Click **Save** and confirm the policy appears in the bucket's Settings.
   This lets the staging website upload and retrieve files using signed URLs.
   Keep the bucket private; enabling public access is not required.

### Step 3 — Set up the staging API in Render

The staging configuration files must be committed and pushed to `staging`
before Render can read them. An initial GitHub release may fail until Step 4
adds its secret; rerun it after completing that step.

1. In Render, choose **New → Blueprint** and select this GitHub repository.
2. Select branch **staging** and set **Blueprint Path** to **render.staging.yaml**.
   Review the price before applying it. This creates **danpahq-api-staging** and
   **danpahq-redis-staging**.
3. Fill the Blueprint's requested environment values using the staging database,
   R2 bucket, email provider, scanner and Google OAuth configuration. Generate
   fresh staging application secrets; do not copy production secrets.
4. Use these database values for the Render API service:

| Variable | Value |
|---|---|
| `POSTGRES_HOST` | Staging Supabase Session pooler host |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_DB` | `postgres` |
| `POSTGRES_USER` | `grp_app.<staging-project-ref>` |
| `POSTGRES_PASSWORD` | Runtime password chosen in Step 1 |
| `DATABASE_RUNTIME_ROLE` | `grp_app` |
| `DB_SSLMODE` | `require` |

The Blueprint sets `DJANGO_SETTINGS_MODULE=config.settings.staging`, HTTPS,
staging origins, the staging bucket and a separate Redis connection. Keep
**After CI Checks Pass** selected. Save the generated application secret values
securely because the GitHub release needs matching values in Step 4.

5. Add **api-staging.danpahq.com** under the API service's **Custom Domains**.
   In Cloudflare DNS, add the DNS record Render supplies. Wait for HTTPS to work.

Initial API startup can fail until the GitHub release creates the database role
and tables. Keep database owner credentials, `DATABASE_RUNTIME_PASSWORD` and
`DJANGO_SUPERUSER_*` entries out of Render's runtime environment.

### Step 4 — Add the staging release secret in GitHub

1. Open the repository → **Settings → Environments → New environment**.
   Name it **staging** and restrict deployment branches to **staging**.
2. Fill [`backend/staging-owner.env.example`](../backend/staging-owner.env.example).
   Store your filled copy outside Git or in the ignored `.env.staging.owner` file.
3. For this release environment, use the Supabase **owner** login from Step 1
   (`postgres.<staging-project-ref>`) and the project database password.
   Set `DATABASE_RUNTIME_PASSWORD` to the runtime password used by Render.
4. Copy the staging application's secret values from Render into the matching
   entries. Fill the remaining storage, Redis, email and scanner values to match
   staging. Keep `DJANGO_SETTINGS_MODULE=config.settings.staging`.
5. To create the first staging administrator, fill all three entries:
   `DJANGO_SUPERUSER_PHONE`, `DJANGO_SUPERUSER_EMAIL` and
   `DJANGO_SUPERUSER_PASSWORD`. Use a valid Ghana phone number and a strong password.
6. In the GitHub **staging** environment, create a secret named
   **STAGING_OWNER_ENV**. Paste the complete filled template into that one secret.
7. Push the staging configuration, or rerun the failed **Release checks** workflow
   for `staging` if it was already pushed. Watch **Actions → Release checks**:
   tests must pass, followed by **Staging database release**. Render then deploys.

After successful bootstrap, remove the three `DJANGO_SUPERUSER_*` entries from
the GitHub secret. Remove `DATABASE_RUNTIME_PASSWORD` after role provisioning;
include it again only when intentionally rotating that password. Retain the
owner credential and matching application secrets for future migrations.

### Step 5 — Set up the staging website in Cloudflare Pages

Create a **separate Pages project** connected to this repository. Use:

| Setting | Value |
|---|---|
| Project name | `danpahq-staging` |
| Production branch for this project | `staging` |
| Root directory | `web` (keep sibling `packages/design-tokens` accessible) |
| Build command | `npm ci && npm run build` |
| Build output directory | `out` |
| `NODE_VERSION` | `22.13.0` |
| `NEXT_PUBLIC_API_URL` | `https://api-staging.danpahq.com/api/v1` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Staging Web OAuth client ID, matching the API |

Add **staging.danpahq.com** under this project's **Custom domains** and follow
Cloudflare's DNS instructions. Add `https://staging.danpahq.com` as an allowed
origin on the staging Google Web OAuth client. Configure restricted Maps keys
if needed. Keep this project's preview configuration pointed at staging too.

Pages builds independently of the database release. Confirm the API release
has succeeded before testing a website change that requires new database tables.

### Step 6 — Test staging, then promote changes

1. Open `https://api-staging.danpahq.com/healthz` and
   `https://api-staging.danpahq.com/readyz`. Readiness should return `status=ok`
   and `environment=staging`.
2. Open `https://staging.danpahq.com` and test login, email, uploads and the
   workflows you changed. Check Render's worker and scheduler logs.
3. Sign in to `https://api-staging.danpahq.com/admin/`, enroll the staging
   administrator in MFA and save recovery codes.
4. Use test accounts and test payment credentials. Leave payments disabled
   until configured, and do not enable live payments in staging.
5. For future changes, push to `staging`, wait for GitHub and Render, then test.
   When ready, open a pull request from **staging → main**. Merging it runs the
   separate production release using production's own resources and secret.
