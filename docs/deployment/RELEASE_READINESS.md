# Release readiness and deployment sign-off

This is a gate, not a certificate issued by a third party. A green build proves
that the checked revision works in the checked environment; it does not prove
that Render, Supabase, R2, Google, Resend, Cloudmersive, SMS, backups, and the
mobile binaries are configured correctly. Do not label a release "production
certified" until the owner records the evidence below for the **deployed commit**.

## Current decision — 20 October 2026

**NO-GO for unrestricted real users or real money.** The repository's code
checks are substantially green, but the live-service, data-protection,
recovery, and mobile release gates below have not been signed off. An internal
pilot with synthetic data may proceed after its operators accept the free-tier
availability limits. These results are from a local working tree, not evidence
that the same revision is live at `app.oskec.com` or `api.oskec.com`.

The readiness fixes from 19 October were committed as `2bdf000` and merged to
`main` in `18b4f03`; this does **not** confirm that the hosts deployed that
commit. The current checkout is a later `passport` branch (`3234702`) with
additional uncommitted changes. The measurements below belong to the earlier
reviewed code, not a sign-off for this newer candidate. Repeat the gates after
the Passport work is complete and before deploying it.

| Gate | Local evidence | Release status |
| --- | --- | --- |
| Backend integration/unit suite on Python 3.12, Django 5.2.18 | Final regression: 1,734 passed; `makemigrations --check` found no missing migrations. The 3 later admin-login tests passed with their affected modules | Pass locally |
| Django admin login | Was password-only at the public default `/admin/` with no attempt limit. Now capped at 10 per email / 20 per address per 15 min, refused if the counter cache is down; path configurable via `ADMIN_URL`. No MFA yet | Fixed locally; MFA is an open gate |
| Django deployment checks | With complete representative production settings and a strong test secret, `check --deploy` found 0 issues (232 API-schema notices silenced by project settings) | Pass locally; rerun with live settings |
| Backend Ruff | `ruff check .` passed | Pass locally |
| Production backend image | `backend/Dockerfile` built successfully with `INSTALL_DEV=false` | Pass locally |
| Backend mypy | 382 errors in 78 files after checking 291 source files | Open backlog; not a release gate yet |
| Backend runtime dependency audit | `pip-audit -r requirements.txt` found 0 known advisories after patched pins | Pass at audit date |
| Backend static security scan | Bandit at medium-or-higher severity **and confidence** passed; one reviewed low-confidence dynamic-SQL warning remains outside that threshold | Pass at stated threshold |
| Web tests, typecheck, lint, production build | 444 passed; typecheck/lint passed; 79 routes built with the production API URL | Pass locally |
| Web production dependency audit | `npm audit --omit=dev` found 0 known advisories | Pass at audit date |
| Web build-tool dependency audit | Full `npm audit` still finds 5 high advisories through `eslint-config-next` → `fast-glob` → `micromatch` → `braces`; npm proposes an incompatible downgrade | Needs tooling exposure triage |
| Mobile tests and typecheck | 342 passed; typecheck passed | Pass locally |
| Mobile lint | Exit 0 with 230 warnings: 187 `react-hooks/refs`, 38 `set-state-in-effect`, 1 memoization, 4 unused variables. React Compiler is not enabled; the hooks warnings are advisory compiler rules hitting deliberate patterns (Animated values held in refs, latest-callback refs, render-time resets) and no defect was found on review | Triaged; not a release blocker |
| Mobile dependency audit | After safe lockfile updates, 30 advisories remain (12 moderate, 18 high), largely in Expo/Metro build tooling; no critical advisory remains | Needs triage before binary release |
| Android/iOS native builds and device tests | Not run; `expo-image-manipulator` was added since the previous native build | Not verified |
| Live domains | `app.oskec.com`, API `/healthz` and `/readyz` returned HTTP 200 on 19 October (the API took over 60 s to wake from Render Free sleep on one probe). `/readyz` said `environment: local` while sending production-like security headers. The source fix now pins that marker, but the live commit was not established. On 20 October, two `/readyz` requests timed out at 20 and 45 seconds, and `/healthz` timed out at 20 seconds; none returned bytes | Failed availability check; investigate Render before launch |
| Live Google OAuth/Resend/Cloudmersive/R2/SMS flows | Need real credentials and controlled test accounts | Not verified |
| Database least privilege, RLS and append-only triggers | Current free-tier Blueprint uses one database credential for migration and serving | Not satisfied by Blueprint |
| Backups and restore | No recorded successful restore rehearsal | Not verified |
| Privacy notice, provider processing terms and lease/legal approval | Identity documents leave the app for third-party scanning; draft lease is not approved | Human sign-off required |

The counts above are point-in-time observations, not an evergreen promise.
Repeat every gate on the candidate commit. Preserve the command logs, commit
SHA, deployment IDs, tester and timestamp with the release record.

## Reproduce local gates

Use a disposable/test database, never the production database. The backend
suite creates `test_` databases. From the repository root, with the local
Docker stack running and `.env` configured:

```powershell
docker compose build api
docker compose run --rm --no-deps -T api pytest -q --disable-warnings
docker compose run --rm --no-deps -T api ruff check .
docker compose run --rm --no-deps -T api pip-audit -r requirements.txt
docker compose run --rm --no-deps -T api bandit -q -r apps config -x '*/migrations/*' -ll -ii
```

From `web/`:

```powershell
npm ci
npm run test
npm run typecheck
npm run lint
npm audit --omit=dev
$env:NEXT_PUBLIC_API_URL='https://api.oskec.com/api/v1'; npm run build
```

The web build fetches Google Fonts and requires outbound network access.
Record the configured `NEXT_PUBLIC_GOOGLE_CLIENT_ID` too; a successful build
without it does not enable Google sign-in.

From `mobile/`:

```powershell
npm ci
npm run test
npm run typecheck
npm run lint
npm audit --omit=dev
```

An `npm run lint` exit code of 0 is **not** a clean mobile result while warnings
remain. Do not run `npm audit fix --force`: it proposes an incompatible Expo
downgrade. Review each advisory against shipped native code versus local build
tooling, then update with Expo-compatible releases or record a time-limited,
owned exception.

## Production sign-off checklist

Record each item as pass/fail, with owner and evidence link. A failed item is
not waived by a green unit suite.

1. Pin one reviewed commit; deploy that same commit to API, web and mobile.
   Confirm runtime versions and environment values are the intended ones. In
   particular `/readyz` must report `environment: production`; the public API
   reported `local` during this review, so its deployed revision/settings need
   investigation before sign-off.
2. Run `python manage.py check --deploy --settings=config.settings.production`
   with the **real deployment environment**. Review all warnings; confirm
   HTTPS, HSTS, allowed hosts, CORS/CSRF and secure cookies at the live domains.
3. Use a separate least-privilege runtime database role. Migrate and run
   `harden_database` with the owner role, then switch API and worker to the
   runtime role. Verify the runtime role cannot mutate append-only audit rows
   or bypass RLS. The current `render-start.sh` runs migration and serving in
   one process with one credential, so it does **not** meet this gate; choose
   infrastructure that supports a separate migration job or revise startup
   before opening to real users.
4. Verify private R2 bucket permissions, short-lived signed URLs, Cloudmersive
   key and an explicit clean/infected/provider-failure upload on a test file.
   A failed or over-limit scan must never release a document. Confirm expected
   size and scan quotas for the actual account; never send real ID documents
   until privacy terms and data-processing geography are approved.
5. Verify one Google sign-in on web and a native mobile build, plus phone OTP
   and email verification, against the live API. Do not put secrets in a build
   or in this checklist. Check OAuth client ID/audience and authorized origins.
6. Prove a backup and **restore to a scratch instance**, including database
   constraints, audit triggers and file-to-database references. Define a
   recovery-time target and name the on-call owner.
7. Check worker and beat liveness independently of `/healthz`. The Render Free
   single-container layout sleeps and has no independent background-worker
   availability; it is a pilot topology, not an always-on production one.
8. Run the role-based end-to-end smoke test in
   [DEPLOY.md](DEPLOY.md#6-check-after-every-deploy-5-minutes)
   on the live candidate. Check an unrelated account cannot read another
   account's documents or agreement.
9. Obtain legal/privacy approval for the identity-document notice, deletion
   policy and lease template. Keep real payment processing disabled until the
   separate money gates in the production guide are complete.
10. Build Android and iOS from the candidate commit, test on physical devices,
    and verify photo compression keeps ID uploads within the scanner limit.
    A JavaScript test or Expo Go run does not validate the native binary.
11. Protect Django admin with a second factor (or put it behind an access
    proxy such as Cloudflare Access) before anyone but the owner holds a
    superuser account. Confirm the attempt cap on the live domain.

If any gate fails, keep the existing deployment, fix the issue, and rerun the
affected checks. For rollback, preserve the previous image/build and migration
compatibility; never assume a database migration is reversible. See
[runbook.md](../runbook.md) for incident and recovery procedures.
