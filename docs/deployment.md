# Deploy Danpa HQ

Use this order: **create services → add secrets → deploy API → deploy web → build mobile → test**.

## Environment values

Use one column throughout setup. Create separate databases, Redis, buckets and application secrets.

| Setting | Staging | Production |
|---|---|---|
| Git branch | `staging` | `main` |
| Website | `https://staging.danpahq.com` | `https://danpahq.com` |
| API | `https://api-staging.danpahq.com` | `https://api.danpahq.com` |
| Blueprint / manual settings reference | [`render.staging.yaml`](../render.staging.yaml) (Free) | [`render.yaml`](../render.yaml) (paid) |
| Render API service | `danpahq-api-staging` | `danpahq-api` |
| R2 bucket | `danpahq-media-staging` | `danpahq-media` |
| GitHub environment | `staging` | `production` |
| GitHub secret | `STAGING_OWNER_ENV` | `PRODUCTION_OWNER_ENV` |
| Owner template | [`staging-owner.env.example`](../backend/staging-owner.env.example) | [`production-owner.env.example`](../backend/production-owner.env.example) |
| Django settings | `config.settings.staging` | `config.settings.production` |
| Mobile build profile | `staging` | `production` |
| EAS environment | `preview` | `production` |

## 1. Create provider credentials — once per environment

### Supabase database

1. Create a project in **Frankfurt**; name staging **danpahq-staging**.
2. Set a strong database owner password. Save it in your password manager.
3. Enable **postgis**, **pg_trgm** and **btree_gist**. Disable Data API exposure for Django tables.
4. Open **Connect → Session pooler**. Save the host and project reference. Use database `postgres`, port `5432`, SSL `require`.
5. Choose a different password for runtime role `grp_app`. GitHub creates this role during the first release.

Owner provisioning also fills missing RLS policies on Django-managed tables that already have RLS enabled: access is granted only to the backend runtime role, with migration history SELECT-only. Existing custom policies are preserved; audit remains append-only. No `BYPASSRLS`, owner runtime login or public/client policy is needed. Commit and push the provisioning fix so GitHub's owner release repairs the policies before Render redeploys. Runtime startup rejects RLS tables lacking an applicable SELECT policy; conditional/custom policies still need separate review. PostgreSQL otherwise hides all rows when RLS has no applicable policy. [Row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)

### Cloudflare R2 files

1. Open **R2 Object Storage → Create bucket**. Use the bucket name from the environment table. Keep it private.
2. Create an **Object Read & Write** token restricted to that bucket. Save the endpoint, access key and secret key.
3. Open the bucket → **Settings → CORS Policy → Add CORS policy → JSON**.
4. Open the matching file below, copy its **entire contents**, and paste into the JSON editor:

| Environment | File to copy |
|---|---|
| Staging | [`ops/r2-cors.staging.json`](../ops/r2-cors.staging.json) |
| Production | [`ops/r2-cors.json`](../ops/r2-cors.json) |

5. Click **Save**. Confirm the policy appears under Settings. Do not enable public access.

### Email delivery and file scanning

1. Choose **Brevo or Resend** for account-verification emails and opted-in alerts. Authorize the sender/domain and obtain its transactional API key. Configure the provider, key and sender in **Management → Configuration → Email delivery** after the API is running; see [Email delivery setup](#email-delivery-setup-brevo-and-resend).
2. Render Blueprints and owner templates use `EMAIL_BACKEND=apps.identity.email_backend.ManagementEmailBackend`. Provider credentials are not required to start the API, but email sending fails until a usable provider is configured. The selected provider's keys are encrypted in Management; no unused Resend key is required when choosing Brevo.
3. In **Cloudmersive**, create an API key. Save `CLOUDMERSIVE_API_KEY`. Current upload limit: **3,500,000 bytes**.

### Google login and free-first maps

1. In Google Cloud, configure the following OAuth registrations. Reuse existing registrations where they match.

| Registration | Configure |
|---|---|
| Web OAuth client | Authorize the website origin from the environment table; no Web redirect URI is needed for this login flow |
| iOS OAuth client | Bundle ID `com.danpahq.app`, in the same Google Cloud project |
| Android OAuth clients | Package `com.danpahq.app` plus each internal/upload/Play app-signing SHA-1 |

2. Use the **Web** client ID for API `GOOGLE_OAUTH_CLIENT_ID`, Pages `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and mobile `GOOGLE_OAUTH_CLIENT_ID`.
3. Use the **iOS** client ID for mobile `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Do not substitute it for the Web ID.
4. Maps use Leaflet and configurable public HTTPS XYZ tiles on web and mobile. No Google Maps/Places key or billing setup is needed. Configure matching `NEXT_PUBLIC_MAP_TILE_*` and `EXPO_PUBLIC_MAP_TILE_*` fallbacks as described in [Maps and Ghana reference data](#8-maps-and-ghana-reference-data), with the provider's required attribution. Rebuild clients after changing build inputs. The community OSM default is for light development, with no guaranteed capacity or SLA.

Keep Android OAuth client IDs in Google Cloud. Google Sign-In configuration remains separate from maps.

## 2. Deploy the API — repeat for staging and production

### A. Create Render services — choose one route

**What is already automated:** `render.yaml` and `render.staging.yaml` each declare the API **and** Redis-compatible Key Value service. When connected as a [Render Blueprint](https://render.com/docs/infrastructure-as-code), Render creates/manages both, supplies literal environment values, generates the declared secrets, and wires `REDIS_URL` using `fromService`. You do **not** create Redis or copy those generated settings manually on that route. Only `sync: false` credentials need initial input. [Blueprint environment rules](https://render.com/docs/blueprint-spec#setting-environment-variables)

| Component | What it actually does |
|---|---|
| Render Blueprint + the selected YAML | Provisions both services and their declared runtime configuration. Staging requests Free API/Key Value and the small staging profile; production retains API `1c-2g` and Key Value `256mb`. Review existing services before a plan change; Free Key Value has no persistence. [Compute plans](https://render.com/docs/compute-plans) |
| `.github/workflows/ci.yml` + `render-migrate.sh` | Runs checks, migrations, runtime-database provisioning, seeds and first-admin bootstrap with the GitHub owner secret. It does **not** create Render services or copy GitHub secrets into Render. |
| `render-start.sh` + `render-supervise.py` | Starts the API, worker and scheduler inside the existing Web Service; it does not provision Redis or read a Blueprint. |
| Render **New → Web Service**, without a Blueprint | Creates that service only; the manual settings below are needed because this route does not apply the YAML. No alternative Render API/CLI provisioning or secret-sync automation exists in this repository. |

For the least manual setup, use the existing YAML/Blueprint route below. For **no Blueprint**, use the manual route. Select the staging YAML for Free compute; the production YAML still requests paid instances.

#### Free manual setup — no Blueprint

Create **one Web Service plus one Key Value instance**, not two Web Services. **New → Web Service does not automatically create Key Value.** Keep Supabase and R2 from §1; no Render Postgres is needed. The YAML files above are settings references only; do not apply them for this route.

1. **Render → New → Key Value**: use `danpahq-redis-staging` or `danpahq-redis`, choose **Frankfurt**, **Free**, and maxmemory policy **noeviction**. Keep external access disabled; copy its **Internal URL** for runtime `REDIS_URL`. [Key Value setup](https://render.com/docs/key-value)
2. **Render → New → Web Service → connect this repository**. Use the matching environment's branch/name above and these Docker settings:

   | Field | Value |
   |---|---|
   | Region / instance | Frankfurt / **Free** |
   | Language | Docker |
   | Root Directory | Leave blank (repository root) |
   | Dockerfile Path | `./backend/Dockerfile` |
   | Docker Build Context Directory | `./backend` |
   | Docker Command | `sh scripts/render-start.sh` |
   | Health Check Path | `/healthz` |
   | Auto-Deploy | After CI Checks Pass |

   For Free **staging**, also set `DJANGO_SETTINGS_MODULE=config.settings.staging` and `RENDER_RUNTIME_PROFILE=staging-free` in the Web Service's environment. The Docker command runs the API, worker and scheduler together; do not create paid Background Worker/Cron services. [Web Service setup](https://render.com/docs/web-services), [Docker settings](https://render.com/docs/docker)
3. Under **Environment**, enter every runtime `envVars` setting from the matching YAML: copy literal `value` entries, fill `sync: false` entries, replace the Redis `fromService` reference with the Internal URL, and generate a separate random secret for each `generateValue: true` entry. Use 50+ random characters for `DJANGO_SECRET_KEY`; preserve existing secrets when reusing a deployment. The YAML's empty integrations group needs no setup. Use runtime database credentials from §1; **never import the owner-env file into Render**.
4. Create the service, then add the API custom domain/DNS as in the paid route below. Complete **§2 B GitHub release** with matching application secrets before expecting a healthy API. Initial startup can fail until that release provisions/migrates the database; no Render shell or pre-deploy migration command is needed. Keep the owner release on GitHub and never enable public Redis access just for it.

Free-tier limits: the web service sleeps after 15 idle minutes, pausing this app's worker/scheduler too. Free Key Value loses queued/cache data on restart; only one is available per workspace, so two isolated staging/production stores cannot both be free there. Usage limits apply; this is a light-traffic staging option, not reliable production scheduling. [Render free-instance limits](https://render.com/docs/free)

The `staging-free` profile uses one synchronous web request, a sequential Celery `solo` worker, and beat inside the existing lease-holding scheduler process. The same PostgreSQL overlap lock is checked before each scheduling tick; lease failure stops scheduling. Queues, Redis sessions, Argon2 and required MFA remain enabled. Production rejects this profile and keeps its existing process layout. Solo tasks cannot use prefork time-limit/child-recycling protections; long tasks delay other background work. Large uploads/reports or higher concurrency can still exceed Free capacity. [Celery concurrency](https://docs.celeryq.dev/en/v5.4.0/userguide/concurrency/)

Local verification (1 November 2026): an isolated Linux container capped at **512 MiB, no swap and 0.1 CPU** peaked at **446.8 MiB** through real Argon2 password rejection/login, MFA QR enrollment/code confirmation, authenticated admin navigation and scheduled outbox execution. The database/account were disposable synthetic fixtures; production security settings and runtime database grants were used. This is not an endurance/heavy-upload test or a verified Render deployment. The focused supervisor/scheduler/database/admin/MFA suite passed 73 tests; detailed local probe artifacts are under ignored `tmp/free-staging/`.

Deploy the profile code before setting the new environment variable. For an existing manually created staging service, save the two staging values above and redeploy; no database/password changes are needed. Keep its runtime `POSTGRES_*` and `REDIS_URL`, and keep owner/bootstrap credentials only in GitHub. Moving existing Redis to Free may lose queued/cache data; review that change separately rather than deleting/recreating a live store blindly.

#### YAML / Blueprint setup

1. Commit/push the selected environment's configuration before connecting Render.
2. Open **Render → New → Blueprint → this repository**.
3. Select the branch and Blueprint path from the environment table. Review the plan summary before applying: staging requests Free API/Key Value; production requests paid instances. A workspace can have only one Free Key Value instance.
4. Keep **After CI Checks Pass** enabled and one service instance. Keep Redis policy `noeviction`.
5. Fill the requested variables:

| Render variable | Enter |
|---|---|
| `POSTGRES_HOST` | Selected Supabase Session pooler host |
| `POSTGRES_PORT` / `POSTGRES_DB` / `DB_SSLMODE` | `5432` / `postgres` / `require` |
| `POSTGRES_USER` | `grp_app.<project-ref>` |
| `POSTGRES_PASSWORD` | Runtime password chosen in §1 |
| `DATABASE_RUNTIME_ROLE` | `grp_app` |
| `DJANGO_SECRET_KEY` | Independent random value of at least 50 characters |
| `S3_ENDPOINT_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Selected R2 credentials |
| `CLOUDMERSIVE_API_KEY` | Selected file-scanning credentials |
| `GOOGLE_OAUTH_CLIENT_ID` | Selected Web OAuth client ID |

6. Apply the Blueprint. Save generated application secrets securely; GitHub needs matching values below. Preserve them on future releases.
7. Open API service → **Custom Domains**. Add the API hostname from the environment table. Add Render's supplied DNS record in Cloudflare; keep DNS-only until HTTPS is issued.

The Blueprint supplies the selected settings module, origins, bucket, private Redis URL and `sh scripts/render-start.sh`. Initial startup may fail until the first GitHub database release finishes.

### B. Configure the GitHub release

1. Open repository → **Settings → Environments**. Create the environment from the table and restrict it to its matching branch. Protect production branch/workflow changes and require production approval as appropriate.
2. Copy the matching **owner template** to an ignored `.env.staging.owner` or `.env.production.owner` file. Fill every required blank.
3. Enter these database credentials in that template:

| Owner-template variable | Enter |
|---|---|
| `POSTGRES_USER` | `postgres.<project-ref>` — owner login, not Render's runtime login |
| `POSTGRES_PASSWORD` | Supabase project owner password |
| `DATABASE_RUNTIME_PASSWORD` | Same runtime password used in Render; needed for first provisioning |

4. Copy the **same application's** secret values from Render into matching template entries. Match database host, Redis, R2, email, scanner, origins and Django settings to the chosen environment.
5. To create the first administrator, fill all three: `DJANGO_SUPERUSER_PHONE` (valid Ghana number), `DJANGO_SUPERUSER_EMAIL`, `DJANGO_SUPERUSER_PASSWORD`.
6. In the GitHub environment, add the secret name from the table. Paste the **complete filled template** into that single secret.
7. Push the matching branch, or rerun its failed **Actions → Release checks** workflow.
8. Wait for backend/client checks → **Staging/Production database release** → Render deployment.
9. After success, remove `DJANGO_SUPERUSER_*` and `DATABASE_RUNTIME_PASSWORD` from the GitHub secret. Keep the owner credentials and application secrets for future releases. Supply the runtime password again only for intentional rotation.

Keep owner/bootstrap credentials out of Render. Any existing superuser skips bootstrap. GitHub runs migrations/provisioning/seeding; runtime startup does not. Use Session pooling, preserve migration history, and do not bypass failed release checks with Manual Deploy.

## 3. Configure application integrations

Use the selected environment's API and Management website.

### Administrator and SMS

1. Open `<API>/admin/`. Sign in, enroll in MFA, and save recovery codes.
2. Provision Management users; open `<website>/management`.
3. Under **Configuration → Two-factor authentication**, set consumer/Management policy as required. Policy changes require a reason and revoke sessions.
4. For phone verification, configure `SMS_BACKEND=arkesel`, `ARKESEL_API_KEY`, approved `ARKESEL_SENDER_ID`, and the intended `ARKESEL_SANDBOX` mode. Production delivery uses `false`; `null` sends nothing.
5. Back up `RUNTIME_CONFIG_ENCRYPTION_KEY`. For emergency admin MFA recovery only, use a trusted shell: `python manage.py enroll_admin_mfa --surface django --email <email> --reset` (`--surface management` for Management).

### Email delivery setup: Brevo and Resend

1. Open **Management → Configuration → Email delivery** as an Operations Admin. Select **Brevo** or **Resend**; enter that provider's API key, verified sender email and sender name. Brevo requires an API key, not an SMTP key.
2. Save the configuration. Secrets are encrypted and masked; Support cannot change them. The next delivery uses the saved selection without restarting the API or workers. Configure staging and production separately.
3. Verify an account email. Enable the account's **Email alerts** and topic switches, trigger an eligible reminder, and confirm acceptance in the selected provider and receipt in the inbox.
4. Disable alerts and repeat: no alert email. Requested account-verification codes must still work. Keep workers/scheduler running. Provider failures do not silently switch to another provider.

| Arrangement | Configuration and behavior |
|---|---|
| Brevo selected | `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` control verification and opted-in alerts. |
| Resend selected | `RESEND_API_KEY`, `RESEND_SENDER_EMAIL`, `RESEND_SENDER_NAME` control verification and opted-in alerts. |
| Deployment default selected | Alerts are off; verification uses `EMAIL_BACKEND`. The managed backend preserves the legacy Resend fallback when no provider is selected; without credentials, delivery fails explicitly. Local console/test backends remain available in development/tests. |

Existing deployments pinned to `ResendEmailBackend` must change `EMAIL_BACKEND` to `apps.identity.email_backend.ManagementEmailBackend` in Render and their GitHub owner-env secret once, then deploy this version. Subsequent provider/key/sender changes belong entirely in Management. Optional environment fallbacks remain supported; retain existing keys during migration until email delivery is verified. Never put credentials in source or public client variables. This guide does not establish which provider is selected in a running environment.

### Payments

1. Keep `PAYMENT_BACKEND` empty and `PAYSTACK_ALLOW_LIVE=false` until testing is complete.
2. Configure `PAYSTACK_TEST_SECRET_KEY`, `PAYSTACK_TEST_PUBLIC_KEY`, `PAYSTACK_PLATFORM_CHARGE_BPS` in Management.
3. Set `PAYSTACK_CALLBACK_URL=<website>/record/payment-return`; configure webhook `<API>/api/v1/webhooks/payments/paystack/`.
4. Test payment success/failure, signatures, duplicate/reordered webhooks and reconciliation. Configure `PAYMENT_ALERT_OWNER` and optional `PAYMENT_ALERT_WEBHOOK_URL`.
5. Keep staging on test credentials. Enable production live credentials/mode only after explicit approval and applicable processor/legal approvals.

## 4. Deploy the website — repeat per environment

1. Open **Cloudflare → Workers & Pages → Pages → Connect to Git**. Select this repository. Create a separate staging Pages project.
2. Enter:

| Setting | Staging | Production |
|---|---|---|
| Project name | `danpahq-staging` | Existing production Pages project |
| Production branch for this project | `staging` | `main` |
| Root / output | `web` / `out` | `web` / `out` |
| Build command | `npm ci && npm run build` | Same |
| `NODE_VERSION` | `22.13.0` | Same |
| `NEXT_PUBLIC_API_URL` | `https://api-staging.danpahq.com/api/v1` | `https://api.danpahq.com/api/v1` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Staging API's Web OAuth ID | Production API's Web OAuth ID |

3. Keep sibling `packages/design-tokens` accessible. Preserve `_headers` and `_redirects`; keep `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
4. Under **Custom domains**, add the selected website hostname. Follow Cloudflare's DNS instructions and verify HTTPS. Configure `www` redirect if used.
5. Add public tile variables from §1 only if changing the default provider. Keep staging previews pointed at staging.
6. Deploy/retry the build. Rebuild whenever `NEXT_PUBLIC_*` changes; do not run `next start` for this static export. Allow Google Fonts access during builds.
7. When mobile store listings are public, set `NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_PLAY_STORE_URL` and retry deployment.

## 5. Build and install mobile apps

Use Node **22.13+ (22.x)** and the existing Expo project. Run commands from `mobile/` unless stated otherwise.

### A. Link the existing EAS project

1. In Expo → **Project settings → General**, copy the existing project UUID.
2. From the repository root, run:

```powershell
Set-Location .\mobile
npm ci
npx eas-cli login
$env:EXPO_PUBLIC_EAS_PROJECT_ID = Read-Host 'Existing EAS project UUID'
npx eas-cli project:info
```

3. Confirm the project name. Do not run `eas init` or replace signing credentials.
4. Save the UUID in the ignored root `.env` for future terminals. All profiles retain `com.danpahq.app` and scheme `danpahq`; use separate staging devices because both builds cannot coexist. Sign out before switching installations; stored credentials may persist. Preserve committed Android sources and signing customizations; do not run `prebuild --clean`.

### B. Set EAS environment variables

1. Open Expo → project → **Environment variables**.
2. Set these values in **preview** for staging and **production** for store builds:

| Variable | `preview` environment | `production` environment | Visibility |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://api-staging.danpahq.com/api/v1` | `https://api.danpahq.com/api/v1` | Plain text |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Existing project UUID | Same UUID | Plain text |
| `GOOGLE_OAUTH_CLIENT_ID` | Web OAuth ID accepted by staging API | Copy `build.production.env` value from `eas.json` | Plain text |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | iOS OAuth ID registered for `com.danpahq.app` | Copy `build.production.env` value from `eas.json` | Plain text |
| `EXPO_PUBLIC_MAP_TILE_URL`, `EXPO_PUBLIC_MAP_TILE_ATTRIBUTION`, `EXPO_PUBLIC_MAP_TILE_ATTRIBUTION_URL` | Public tile URL and matching credits; see §8 | Same, using the chosen provider | Plain text (never private keys) |
| `GOOGLE_SERVICES_JSON` | Existing matching Firebase Android file, if push is used | Same matching file | Secret **file** |

3. To save/check API values by CLI:

```powershell
npx eas-cli env:set preview --name EXPO_PUBLIC_API_URL --value https://api-staging.danpahq.com/api/v1 --type string --visibility plaintext --scope project --non-interactive
npx eas-cli env:set production --name EXPO_PUBLIC_API_URL --value https://api.danpahq.com/api/v1 --type string --visibility plaintext --scope project --non-interactive
npx eas-cli env:list preview
npx eas-cli env:list production
```

4. Check local root `.env` values match the target environment; `app.config.js` can use them as fallback. `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is also accepted, but prefer `GOOGLE_OAUTH_CLIENT_ID`.
5. Keep API values aligned with `eas.json`: profile `env` overrides EAS environment variables during builds. The API URL is embedded in the bundle and must end in `/api/v1`. Never set `EXPO_PUBLIC_LOCAL_TEST_BUILD=1` for hosted releases or embed backend/signing secrets in public variables.
6. Verify native OAuth callbacks after changing iOS client IDs. Committed Android files are not automatically prebuilt; review native configuration when changing plugins/permissions/Firebase. Do not rotate production FCM/APNs keys for staging.

### C. Build and install staging

1. From the repository root, select and check the source:

```powershell
git switch staging
git status --short
Set-Location .\mobile
npm test
npm run typecheck
npm run lint
npx eas-cli build --platform android --profile staging
```

2. Open the completed EAS build's installation link on an Android test phone. Download/install the **APK**; allow installation from that source if prompted.
3. For iPhone, register the physical phone first, then build:

```powershell
npx eas-cli device:create
npx eas-cli build --platform ios --profile staging
```

4. Open the installation link on the registered iPhone. New devices need a new ad hoc build or explicit re-signing. An Apple Developer account is required.
5. Confirm the build profile is `staging`, API is `https://api-staging.danpahq.com/api/v1`, and requests appear in `danpahq-api-staging` logs. Run §6 on both staging web and mobile. Use installed builds, not Expo Go, for Google login/push.

| Profile | Connects to | Output |
|---|---|---|
| `staging` | Staging API; EAS environment `preview` | Internal APK / ad hoc IPA |
| `preview` (legacy) | **Production API**, despite its name | Internal production test build |
| `production` | Production API; EAS environment `production` | Store AAB / IPA |

### D. Build and submit production

1. Merge the approved staging pull request into `main`. Wait for production API/web release checks.
2. From the repository root, select the approved clean commit:

```powershell
git switch main
git pull --ff-only
git status --short
Set-Location .\mobile
npm ci
npx eas-cli project:info
npx eas-cli build --platform all --profile production
```

3. Confirm each resulting build uses profile `production`. Never submit a staging build or reuse its bundled API configuration.
4. Submit the exact production build IDs, not `--latest`:

```powershell
$androidProductionBuildId = Read-Host 'Verified production Android EAS build ID'
npx eas-cli submit --platform android --profile production --id $androidProductionBuildId
$iosProductionBuildId = Read-Host 'Verified production iOS EAS build ID'
npx eas-cli submit --platform ios --profile production --id $iosProductionBuildId
```

5. Complete existing store account/credential prompts. Test through Play testing / TestFlight, then approve review/public release in the store consoles. Production builds retain remote signing and automatic version increments.

### 5.1 Native property-interest push — optional

1. Download `google-services.json` for existing Firebase app `com.danpahq.app`. Upload the file and project UUID:

```powershell
$pushGoogleServices = (Resolve-Path (Read-Host 'Full path to google-services.json')).Path
foreach ($pushEnvironment in 'preview', 'production') {
    npx eas-cli env:set $pushEnvironment --name EXPO_PUBLIC_EAS_PROJECT_ID --value $env:EXPO_PUBLIC_EAS_PROJECT_ID --type string --visibility plaintext --scope project --non-interactive
    npx eas-cli env:set $pushEnvironment --name GOOGLE_SERVICES_JSON --value $pushGoogleServices --type file --visibility secret --scope project --non-interactive
}
npx eas-cli credentials --platform android
npx eas-cli credentials --platform ios
```

2. Android: **Google Service Account → Push Notifications (FCM V1)**. Use the matching Firebase service-account key and enable Cloud Messaging API. iOS: **Push Notifications → APNs key**. Preserve existing valid credentials shared by this package/EAS project. [Credential instructions](https://docs.expo.dev/push-notifications/fcm-credentials/).
3. In the selected Render API service, set `EXPO_PUSH_ENABLED=true`. Set `EXPO_ACCESS_TOKEN` only for Expo Enhanced Push Security. Redeploy after the database release.
4. Build a new installed app with the chosen profile. Enable phone notification permission, **Push notifications**, and the **Enquiries** topic.
5. Sign in as seller; background the app. From a fresh buyer/property pair, express sales-property interest. Confirm a push and tap-through to its record.
6. Disable push and repeat with another fresh pair: no new push; enquiry/in-app notification still exists. Keep staging device tokens in the staging database. Already queued pushes cannot be recalled.

### 5.2 Mobile changes and EAS Update

**EAS Update is currently disabled:** no `expo-updates`, update URL/runtime/channel configuration, and Android updates are disabled. Use new builds for mobile code, assets and embedded API-variable changes. Compatible backend-only changes need no mobile build.

| Change | New native build required? |
|---|---|
| Any mobile change with today's setup | Yes |
| Native library/SDK, permissions, plugin, signing, scheme, Firebase/Maps native settings, store version | Always |
| JS/assets after a future OTA setup | No, only if native runtime matches |

To enable OTA later:

1. Run `npx expo install expo-updates`, then `npx eas-cli update:configure` against the existing project.
2. Review update URL/runtime policy and native Android/iOS settings. Set channels: `staging` profile → `staging`; `production` → `production`; legacy `preview` → its own production-test channel.
3. Build/install new compatible binaries. Follow [Expo setup](https://docs.expo.dev/eas-update/getting-started/) and [runtime rules](https://docs.expo.dev/eas-update/runtime-versions/).
4. Only after that setup, publish using the matching channel **and** EAS environment:

```powershell
# Staging only
npx eas-cli update --channel staging --environment preview --message "Describe the staging change"
# Separately approved production source only
npx eas-cli update --channel production --environment production --message "Describe the approved production change"
```

5. Keep update branches/channels separate. Never repoint production to staging or republish staging's bundle to production. Rebundle approved production source with production variables: EAS Update does not read profile `env` from `eas.json`.
6. Restrict production publishing. Verify API, channel, environment, runtime and source SHA; reopen the installed app as required and check API requests before expanding rollout. [EAS environment rules](https://docs.expo.dev/eas/environment-variables/usage/).

## 6. Test and release

### Staging checklist

- [ ] API `/healthz` responds; `/readyz` reports `status=ok`, `environment=staging`.
- [ ] Test both `https://staging.danpahq.com` and installed staging Android/iOS apps.
- [ ] Verify login/logout/refresh, MFA, password recovery and Google login.
- [ ] Verify maps, camera, clean/rejected/scanner-failed uploads and authorized downloads.
- [ ] Complete the changed workflow; test cross-account access denial.
- [ ] Check worker/scheduler logs, email delivery and optional push.
- [ ] Confirm test records exist only in staging; keep payments in test mode.
- [ ] Record source SHA, mobile build IDs and device results.

### Production release checklist

1. Back up database/files; confirm restore procedure and compatibility with running code.
2. Merge **staging → main**. Wait for **Release checks → Production database release → Render** and the Pages build. Resolve failures before proceeding.
3. Verify `https://api.danpahq.com/readyz` returns `status=ok`, `environment=production` and test the production website.
4. Check runtime database permissions with `check_runtime_database`; keep owner credentials isolated. Do not run destructive privilege probes on production.
5. Confirm private storage/CORS, real email delivery, Redis/worker/scheduler health, HTTPS, and matching API origins/secrets.
6. Complete legal/privacy/processor approvals for enabled workflows. Leases require `LeaseTemplate.review_status=approved_for_production`.
7. Follow §5 D for production mobile build, store testing and release approval. Keep older installed clients API-compatible.
8. Record release SHA, deployment/build IDs and responsible operator. Monitor errors, queues and payment alerts.

## 7. Roll back or diagnose

| Problem | Action |
|---|---|
| Runtime will not start | Check GitHub database release, settings/secrets and runtime role permissions; use `scripts/render-start.sh` |
| Upload stays pending | Check worker, selected R2 bucket/CORS, Cloudmersive key/quota and file size |
| Google mobile login fails | Check Web ID matches API, iOS callback ID, Android package and actual signing SHA-1 |
| Admin email/password rejected | Admin accepts email only (case-insensitive), not phone. Check the owner-release bootstrap result: `Superuser exists; bootstrap skipped.` means new `DJANGO_SUPERUSER_*` values did not update the existing account. Verify that the expected superuser is active, staff, email-verified and belongs to the same database as the runtime. Use an authorized password-reset procedure for an existing account; do not recreate it, overwrite it through bootstrap or disable MFA. |
| Admin password matches as owner but login fails | Compare row visibility using the runtime role. RLS enabled without policies can hide `identity_user` and other application tables despite SQL grants. Rerun the updated `provision_runtime_database` in the isolated GitHub owner release; preserve RLS and audit protections rather than switching Render to the owner role. |
| Mobile reaches wrong API | Confirm profile and embedded API; build/install the correct artifact |
| Web release fails | Cloudflare Pages → previous deployment → **Rollback** |
| API release fails | Disable auto-deploy; Render → schema-compatible previous deployment → **Rollback**; migrations are not reverted |
| Mobile release fails | Issue a corrective build; current apps do not support OTA rollback |

## 8. Maps and Ghana reference data

**Map configuration.** Management → System → Configuration → Maps (`/management/configuration?section=maps`) controls rendering, public HTTPS XYZ tile URL and attribution/copyright link. `/api/v1/map/config/` exposes only public values; overrides take precedence over client defaults. New map instances cache configuration for at most one minute; mounted maps keep their current provider. Reload/restart updated clients for immediate application. Old binaries need the supporting JS update.

Optional build fallbacks use these suffixes with both `NEXT_PUBLIC_MAP_TILE_` and `EXPO_PUBLIC_MAP_TILE_`: `URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png`, `ATTRIBUTION=© OpenStreetMap contributors`, `ATTRIBUTION_URL=https://www.openstreetmap.org/copyright`. Never put private credentials in public settings. Native Google login/FCM credentials remain separate; do not remove them with obsolete Google Maps keys.

Leaflet is BSD-licensed. The [OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/) requires visible attribution, identification/referrers, normal caching and no bulk/offline scraping. Commercial data rights do not guarantee community tile capacity: under 100 daily map views is an early-development estimate, not a quota or SLA. Select a host against measured tile requests and its current terms before production. [Geoapify](https://www.geoapify.com/pricing-details/) was researched as an optional commercial free-tier alternative, not activated; recheck pricing/attribution before choosing it. Standard OSM tiles do not provide satellite imagery; imagery requires separate licensing/provider configuration.

**Reference sources and credits.** The packaged [snapshot and licence notice](../backend/data/geography/README.md), [manifest](../backend/data/geography/manifest.json) and crosswalk retain source identities, checksums and attribution:

| Obtained source | Licence and limitations |
|---|---|
| [GSS Census Atlas](https://statsbank.statsghana.gov.gh/censusatlas/), [direct archive](https://statsbank.statsghana.gov.gh/assets/geofiles.zip) | Corroborated 261 districts, including Guan in Oti; geometry not imported/redistributed because an explicit licence was not found. |
| [GSS via OCHA/HDX](https://data.humdata.org/dataset/cod-ab-gha) | CC BY 3.0 IGO; 16 regions, 260 district polygons valid 8 March 2021, reviewed 30 October 2025. Publication date is not boundary vintage. |
| [GeoNames Ghana](https://download.geonames.org/export/dump/GH.zip), [fields](https://download.geonames.org/export/dump/readme.txt) | [CC BY 4.0](https://www.geonames.org/export/); populated places/aliases/points and point-only Guan supplement; excludes historical/abandoned/destroyed settlements. |
| [Geofabrik Ghana / OSM](https://download.geofabrik.de/africa/ghana.html) | [ODbL 1.0](https://www.openstreetmap.org/copyright); named place nodes/aliases/points, not area-only place features. |

The combined derived reference database is offered under ODbL 1.0 with original source licences retained. Preserve client credits and `/api/v1/geo/dataset/`, which excludes private addresses and user-entered text. The 28 October 2026 local import recorded **16 regions, 261 districts (260 polygons), 24,105 canonical localities, 9,876 aliases and 25,282 source locality identities**; not a fresh production count. It found no invalid coordinates/inconsistent parents/exact duplicate groups, but 49 localities had unknown parents and 699 same-name pairs within 1 km needed review. Those pairs are not proven duplicates. Guan has no imported polygon; most parents are inferred against 2021 boundaries. Coverage is not exhaustive/current administrative verification.

**Repeatable rollout/update.** Back up the target database; run normal migrations first. From the repository root with the local services available:

```sh
docker compose exec -T api python manage.py migrate --noinput
docker compose exec -T api python manage.py import_ghana_locations --dry-run
docker compose exec -T api python manage.py import_ghana_locations
docker compose exec -T api python manage.py audit_ghana_locations
docker compose exec -T api python manage.py refresh_listing_locations
```

Normal import/`seed_geo` uses the packaged snapshot offline. For a source refresh, stage a candidate with `import_ghana_locations --download --snapshot /app/data/geography/candidate.json.gz --dry-run`, review its licences/vintage/checksum/counts, then import with `--snapshot /app/data/geography/candidate.json.gz` and run `audit_ghana_locations --show-candidates`. Dry-run avoids DB writes but can download/build a candidate. `--build-snapshot` reuses cached raw archives; `--data-dir` changes that cache. Promote the reviewed snapshot and matching manifest together. Preserve old IDs/user-created records; set `import_locked=True` before manually curating imported parents/aliases.

`refresh_listing_locations` recomputes derived rental/sale points only, not private coordinates/addresses; repeat runs are safe. `--resolve-places` was removed. Saved Property pins take precedence; reference-locality fallback is explicitly approximate. Never move a verified Property pin automatically to fix a named-area mismatch; use the authorized review/support workflow. A location without usable coordinates stays unmapped and remains in unbounded list results.

## 9. Legal, tax and device release checks

**Financial reports.** PDF statements and CSV schedules support preparation, not filing or tax advice. Guidance preserved from the 29 October 2026 research: [GRA Returns](https://gra.gov.gh/domestic-tax/returns/), [Rent Tax](https://gra.gov.gh/portfolio/rent-tax/), and [Withholding Tax practice note §4.2.3](https://gra.gov.gh/wp-content/uploads/2020/09/Practice-Note-on-Withholding-of-Tax.pdf). Recheck before a tax-policy release. Individual investment rent and a letting business are not interchangeable; taxpayer type alone cannot establish liability. Reconcile actual receipts/refunds/expenses, ownership, residency, withholding certificates/payments, allowable deductions, capital allowances, reliefs and other income. No blanket tax rate, invented tax credits, official GRA upload/filing receipt or guaranteed compliance is supplied. Accounting boundaries are in [ADR §8](adr.md#8-additional-domain-contracts).

**Lease legal review.** The consolidated clause brief remains a product/legal draft (research checkpoint 27 August 2026), not approved contract wording. Preserve immutable template/legal-policy versions, structured terms, the document shown, content/hash scope, final PDF hash, acceptance evidence and supersession links. Production offers require `LeaseTemplate.review_status=approved_for_production`; development templates remain marked `requires_ghana_legal_review`. Ghana-qualified counsel must resolve:

| Review area | Questions/requirements retained |
|---|---|
| Parties, premises, term and money | Legal contracting landlord/agent capacity; exact Property/Unit/Bed/address/inventory; counsel-approved calendar end dates rather than approximate 30-day months; lawful rent/frequency, advance-rent decision table and block-versus-warning policy; receipt particulars/stamping; deposit custody, deductions and return timing. |
| Duties and use | Provider/tenant repair and safety duties, utilities/meters/shared charges, permitted occupants/use, guests, consent to alterations/assignment/subletting, fair wear, quiet enjoyment, entry notices/emergencies. Do not invent notice periods or permit unlawful disconnection/self-help. |
| Ending and disputes | Lawful renewal/termination/possession grounds and notices; Rent Control/court rights, mediation/forum, electronic-notice delivery/receipt. Ending an app record is not legal eviction. |
| Formalities and evidence | Whether Act 772 immovable-property exclusions affect tenancy; signature/witness/notarial sufficiency, stamping, registration and transaction certificates by term/party type. Describe in-app events as recorded acceptance unless counsel approves stronger claims. |
| Privacy and amendments | Minimum party/occupant data, minors, lawful retention/access/redaction, custom-clause prohibitions/precedence and severability; material changes create a new immutable version and renewed acceptance, never rewrite an offered/accepted agreement. |

Source map, to be reverified by counsel: [Rent Act 220 / Parliament](https://repository.parliament.gh/items/7ed7ce4b-e397-405a-892d-e9aa3a962195), [GhaLII version/amendment caveat](https://ghalii.org/akn/gh/act/1963/220/eng@1971-12-31), [November 2025 Rent Bill update](https://mwhwr.gov.gh/rent-dialogue-convened-to-address-emerging-issues-in-revised-bill/), [Electronic Transactions Act 772](https://ghalii.org/akn/gh/act/2008/772/eng@2020-12-29), [Stamp Duty Act 689](https://ghalii.org/akn/gh/act/2005/689/eng@2005-06-03), [Land Act 1036](https://ghalii.org/akn/gh/act/2020/1036/eng@2020-12-23), [Data Protection Act 843](https://ghalii.org/akn/gh/act/2012/843/eng@2012-05-18), [Real Estate Agency Act 1047](https://ghalii.org/akn/gh/act/2020/1047/eng@2020-12-29). The brief specifically flags Act 220 ss. 17, 22, 25(5), 27 and 33 and Act 772 record-integrity/retention/acceptance provisions; a proposed bill is never treated as enacted law.

**Verification limits.** Historical task test counts are not current release evidence; retain exact-commit CI and logs. Prior SDK 57 checks reported native-directory/app-config sync and Expo patch-version warnings; rerun Expo Doctor/dependency checks before a native release rather than assuming old recommendations still apply. An earlier Android assembly failed under local paging/memory pressure; JavaScript exports do not establish a working APK/IPA. Windows cannot verify native iOS assembly. Do not regenerate native directories over custom work.

On physical Android/iOS and an SDK-compatible Expo Go, check map pin/marker positioning through resize/reload/background resume, locality selection and ambiguous/missing-coordinate searches, map-area/reset/URL behavior, credits and offline tiles. Use a phone-reachable API, not computer `localhost`; native Google sign-in needs an installed build. Verify guest prompt dismissal, draft/create/edit/re-check/approval/explicit republish, verified-field locking, image/document selection and protected downloads, PDF save/share/temp cleanup, large text and safe-area/footer clearance. Full native builds and these device interactions remain release checks even where browser, API, type and bundle tests passed.
