# Danpa HQ production deployment

Use an approved release on `main`. Production serves the website at `https://danpahq.com` and the API at `https://api.danpahq.com/api/v1`. Use production resources and credentials throughout. For a release to an existing production system, verify the database restore point and private R2 backup before merging. [Backup and rollback procedure](deployment.md#7-roll-back-or-diagnose)

## 1. Prepare production credentials

1. In **Supabase**, create the production project in Frankfurt. Enable `postgis`, `pg_trgm`, and `btree_gist`. Keep Django tables out of the Supabase Data API. From **Connect → Session pooler**, save the host and project reference. Use database `postgres`, port `5432`, and SSL mode `require`. Save the database owner password and choose a separate password for `grp_app`. The release job creates this runtime role. [Supabase connection settings](https://supabase.com/docs/guides/database/connecting-to-postgres)
2. In **Cloudflare R2**, create the private bucket `danpahq-media`. Create an Object Read & Write token scoped to that bucket. Save the access key, secret key, and account endpoint `https://<account-id>.r2.cloudflarestorage.com`. Paste [the production CORS policy](../ops/r2-cors.json) into the bucket's **Settings → CORS Policy**.
3. Get a **Cloudmersive** API key. The current scanner path accepts files up to 3,500,000 bytes. Property and unit walkthrough videos use a separate validation path.
4. In **Google Cloud**, authorize `https://danpahq.com` as a JavaScript origin for the Web OAuth client. Use this same Web client ID in the API, Pages, and mobile build.

## 2. Create the production API in Render

In the DanpaHQ **Production** environment, use **New → Blueprint**. Connect the GitHub repository on `main` and use [render.yaml](../render.yaml). Review the paid API and Key Value resources before applying. The Blueprint creates `danpahq-api` and `danpahq-redis`, wires the private Redis URL, and configures the API, worker, and scheduler to run together. [Render Blueprints](https://render.com/docs/infrastructure-as-code)

| Render setting | Value |
|---|---|
| `POSTGRES_HOST` | Production Supabase Session pooler host |
| `POSTGRES_USER` | `grp_app.<project-ref>` |
| `POSTGRES_PASSWORD` | Password chosen for `grp_app` |
| `DJANGO_SECRET_KEY` | Independent random secret, at least 50 characters |
| `S3_ENDPOINT_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Production R2 endpoint and bucket-scoped credentials |
| `CLOUDMERSIVE_API_KEY` | Production scanner key |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Web OAuth client ID |

Keep **After CI Checks Pass** selected. Preserve the generated application secrets across releases. Keep database owner and bootstrap credentials in GitHub only. The initial Render startup can fail until the database release creates the schema and runtime role. [Render deploy controls](https://render.com/docs/deploys)

## 3. Run the production database release

1. Copy the [production owner template](../backend/production-owner.env.example) to an ignored `.env.production.owner` file. Fill in the production host and provider settings. Copy the matching application secrets from Render, including `RUNTIME_CONFIG_ENCRYPTION_KEY`.
2. In that file, set `POSTGRES_USER=postgres.<project-ref>` and `POSTGRES_PASSWORD` to the Supabase owner password. Set `DATABASE_RUNTIME_PASSWORD` to the exact password used by Render's `grp_app` login.
3. For the first Super Admin only, fill in `DJANGO_SUPERUSER_PHONE` with a valid Ghana number, plus `DJANGO_SUPERUSER_EMAIL` and `DJANGO_SUPERUSER_PASSWORD`.
4. In **GitHub → Settings → Environments → production → Environment secrets**, create `PRODUCTION_OWNER_ENV`. Paste the entire filled file as its value.
5. Merge the approved release into `main`. If that exact release is already on `main` and its run failed because the secret was missing, rerun **Release checks** for that commit. Wait for **Production database release** to pass and verify the same commit is live in Render. If Render did not roll it out automatically, check its deploy settings and verify the green database job for that SHA before triggering a deploy.
6. After successful provisioning and bootstrap, remove `DATABASE_RUNTIME_PASSWORD` and the three `DJANGO_SUPERUSER_*` values from the GitHub secret. Keep the owner and application values for subsequent releases.

In **Render → danpahq-api → Settings → Custom Domains**, add `api.danpahq.com`. Add Render's supplied DNS record in Cloudflare as DNS-only while Render verifies the domain and issues HTTPS. Open the readiness endpoint and confirm HTTP 200, `environment=production`, `status=ok`, and healthy database and cache checks. [Render DNS instructions](https://render.com/docs/configure-cloudflare-dns) · [API readiness endpoint](https://api.danpahq.com/readyz)

## 4. Publish the production website

In **Cloudflare → Workers & Pages**, connect or reuse a dedicated **production** Pages project for the repository. The staging Pages project uses a different domain and build settings.

| Pages setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `web` |
| Build command | `npm ci && npm run build` |
| Build output directory | `out` |
| `NODE_VERSION` | `22.13.0` |
| `NEXT_PUBLIC_API_URL` | `https://api.danpahq.com/api/v1` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same Web OAuth client ID as Render |

Keep `packages/design-tokens` available to the build. Under the production project's **Custom domains**, add `danpahq.com` and wait for HTTPS. Verify the deployed commit matches Render and sign-in reaches the production API. Rebuild Pages after changing a `NEXT_PUBLIC_*` value. [Cloudflare static Next.js builds](https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/) · [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)

## 5. Configure and test the live services

- **Admin and verification.** Sign in at `https://api.danpahq.com/admin/` with the Super Admin email, enroll in MFA, and save recovery codes. Create the Operations Admin account. In **Management → Configuration → Email delivery**, select Brevo or Resend and enter its transactional key and verified sender. If phone verification is enabled, configure Arkesel with an approved sender and `ARKESEL_SANDBOX=false`. Test actual email and SMS delivery.
- **Storage.** Upload a harmless file and wait for a clean scan. Verify the owner can download it and an unauthorized account cannot. Check Render logs for worker and scheduler startup and verify a background job completes.
- **Paystack.** Start with live mode off. In **Management → Configuration → Payments**, enter the test keys and approved platform charge, then select Paystack for controlled testing. Set the return URL to `https://danpahq.com/record/payment-return` and configure `https://api.danpahq.com/api/v1/webhooks/payments/paystack/` in the Paystack dashboard for the mode being tested. Verify success, decline, signature rejection, and that webhook replay does not duplicate a payment or lease activation. Enable the live keys and **Use live Paystack credentials** only after approval. If online payments are outside the launch scope, leave the provider disabled.
- **Firebase push.** Enable Cloud Messaging in the production Firebase project. In Render, add the JSON key for a production service account with `cloudmessaging.messages.create` permission under **Secret Files** as `firebase-admin.json`. Set `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-admin.json`. After the database release passes, set `FCM_PUSH_ENABLED=true` and redeploy the approved commit. Keep the Admin key on the backend. [Firebase Admin setup](https://firebase.google.com/docs/admin/setup)
- **Leases and Google sign-in.** Use lease templates marked `approved_for_production`. Verify Google sign-in and existing-account linking. If upfront payment is required, verify that a pending payment cannot activate the lease and a verified payment activates it once.

## 6. Build mobile for the stores

For each platform you plan to ship, use the existing EAS project and the `production` profile in [mobile/eas.json](../mobile/eas.json). It targets the production API. Confirm its Web OAuth client ID matches Render. Register Android package `com.danpahq.app` with the signing SHA-1 used for each test or store build. For iOS, confirm the iOS OAuth client ID and bundle ID `com.danpahq.app`.

For push, register the shipped apps as `com.danpahq.app` in the production Firebase project. Add their client files to the EAS **production** environment as file variables `GOOGLE_SERVICES_JSON` (Android) and `GOOGLE_SERVICES_PLIST` (iOS). For iOS push, configure APNs in Firebase and confirm the signed build has the push entitlement. [EAS environment variables](https://docs.expo.dev/eas/environment-variables/manage/) · [Firebase Apple push setup](https://firebase.google.com/docs/cloud-messaging/ios/client)

From `mobile/` on the approved release commit, run `npm ci` and build for each platform you plan to ship.

| Platform | Build | Test distribution |
|---|---|---|
| Android | `npx eas-cli build --platform android --profile production` | Upload the resulting signed AAB to **Play Console → Internal testing**. |
| iOS | `npx eas-cli build --platform ios --profile production` | Send the verified build to TestFlight with `npx eas-cli submit --platform ios --profile production --id <build-id>`. |

Install from the store testing track. On a physical device, verify the app reaches the production API, can sign in, and receives push if enabled. [Google Play testing tracks](https://support.google.com/googleplay/android-developer/answer/9845334) · [EAS Submit for iOS](https://docs.expo.dev/submit/ios/)

Record the release SHA, Render and Pages deployment IDs, and mobile build IDs. Open traffic once the API, website, and enabled production flows pass. If a release regresses, use a schema-compatible previous Render deployment or the previous Pages deployment. Database recovery follows the [backup and rollback procedure](deployment.md#7-roll-back-or-diagnose).
