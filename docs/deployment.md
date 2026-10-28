# Deploy Danpa HQ

Use this order: **create services → add secrets → deploy API → deploy web → build mobile → test**.

## Environment values

Use one column throughout setup. Create separate databases, Redis, buckets and application secrets.

| Setting | Staging | Production |
|---|---|---|
| Git branch | `staging` | `main` |
| Website | `https://staging.danpahq.com` | `https://danpahq.com` |
| API | `https://api-staging.danpahq.com` | `https://api.danpahq.com` |
| Render Blueprint | [`render.staging.yaml`](../render.staging.yaml) | [`render.yaml`](../render.yaml) |
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

### Email and file scanning

1. In **Resend**, verify the sender domain and create an API key. Save `RESEND_API_KEY`.
2. In **Cloudmersive**, create an API key. Save `CLOUDMERSIVE_API_KEY`. Current upload limit: **3,500,000 bytes**.

### Google login and optional Maps

1. In Google Cloud, configure the following OAuth registrations. Reuse existing registrations where they match.

| Registration | Configure |
|---|---|
| Web OAuth client | Authorize the website origin from the environment table; no Web redirect URI is needed for this login flow |
| iOS OAuth client | Bundle ID `com.danpahq.app`, in the same Google Cloud project |
| Android OAuth clients | Package `com.danpahq.app` plus each internal/upload/Play app-signing SHA-1 |

2. Use the **Web** client ID for API `GOOGLE_OAUTH_CLIENT_ID`, Pages `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and mobile `GOOGLE_OAUTH_CLIENT_ID`.
3. Use the **iOS** client ID for mobile `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Do not substitute it for the Web ID.
4. If using Maps, enable billing/APIs and restrict these keys:

| Variable | Restriction |
|---|---|
| `GOOGLE_MAPS_SERVER_API_KEY` | Places API (New), server use |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Maps JavaScript API, selected website origin |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | Your browser map ID |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Android Maps SDK, package and signing SHA-1 |

Keep Android OAuth client IDs in Google Cloud. iOS uses Apple Maps.

## 2. Deploy the API — repeat for staging and production

### A. Create Render services

1. Commit/push the selected environment's configuration before connecting Render.
2. Open **Render → New → Blueprint → this repository**.
3. Select the branch and Blueprint path from the environment table. Review the price before applying: the Blueprint creates a paid API service and Redis.
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
| `RESEND_API_KEY`, `CLOUDMERSIVE_API_KEY` | Selected provider credentials |
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

### Optional Brevo email alerts

1. In Brevo, authenticate the sender domain/address, enable transactional sending, and create an **API key**, not an SMTP key.
2. Open **Management → Configuration → Email delivery**. Enter `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`; select **Brevo**.
3. Keep Resend configured: current deployment templates still require `RESEND_API_KEY`. For Brevo-only deployment, set `EMAIL_BACKEND=apps.identity.email_backend.BrevoEmailBackend` in both owner/runtime environments and configure Brevo before opening verification workflows.
4. Verify an account email. Enable **Email alerts** and its topic switches. Trigger an eligible reminder; confirm delivery in Brevo and the inbox.
5. Disable alerts and repeat: no alert email. Account-verification email must still work. Keep workers/scheduler running; Brevo failures do not automatically fall back to Resend.

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
5. Add optional browser Maps variables from §1. Keep staging previews pointed at staging.
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
| `GOOGLE_MAPS_ANDROID_API_KEY` | Optional Android Maps key restricted to package/signing SHA-1 | Production-restricted key | Plain text or sensitive |
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
| Mobile reaches wrong API | Confirm profile and embedded API; build/install the correct artifact |
| Web release fails | Cloudflare Pages → previous deployment → **Rollback** |
| API release fails | Disable auto-deploy; Render → schema-compatible previous deployment → **Rollback**; migrations are not reverted |
| Mobile release fails | Issue a corrective build; current apps do not support OTA rollback |
