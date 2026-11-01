# DanpaHQ

Property management and tenancy software for Ghana, with a web app and Android/iOS apps.

Ghana reference locations, source licences, import/update commands and coverage
checks are documented in [Deployment: Ghana reference data](docs/deployment.md#8-maps-and-ghana-reference-data).

DanpaHQ covers rental/sale discovery, property and provider verification, viewings, applications, agreements, tenancy records, rent/payments, maintenance, artisans and Housing Passport sharing. One account supports multiple experiences; the backend controls access.

**Stack:** Django/DRF, PostgreSQL/PostGIS, Redis/Celery, Next.js and Expo. Docker runs local infrastructure, including MinIO for uploads. Dependency manifests and lockfiles define the versions.

## Local setup

Install Git and Docker Desktop, then open a terminal in this repository. Windows users should enable Docker’s WSL 2 backend.

**First run:** copy the example settings only if `.env` does not already exist, then start:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

On macOS/Linux, use `cp .env.example .env` for the copy. The development defaults work without additional configuration. Startup applies migrations, seeds geography/amenities and prepares uploads. Source changes reload automatically.

| Open | Address |
|---|---|
| Web app | http://localhost:3000 |
| API / development API docs | http://localhost:8000/ / http://localhost:8000/api/docs/ |
| Super Admin | http://localhost:8000/admin/ |
| Management Portal | http://localhost:3000/management |
| MinIO console | http://localhost:9001 — local credentials: `minioadmin` / `minioadmin` |

Create your first administrator:

```powershell
docker compose exec api python manage.py createsuperuser
```

Sign in to Super Admin, scan the authenticator QR code, confirm its code and save the recovery codes. Provision separate Management users there. Operations Admins manage tenant/provider and Management MFA in **Management → Configuration → Two-factor authentication**: choose Disabled, Optional or Required per account. Administrators require MFA by default; consumers do not. Super Admin’s own security stays in Super Admin.

Register tenant/provider accounts through the web app. Local SMS codes appear in `docker compose logs -f api`. Returning users sign in with email/phone and password, or linked Google. Provider and property approvals are separate reviews.

## Mobile

Install Node **22.13+ (22.x)** and keep Docker running. For an Expo Go preview:

```powershell
cd mobile
npm ci
npm start -- --go --lan
```

Use the same Wi-Fi network as your computer. The API address is normally inferred from Expo; override with `EXPO_PUBLIC_API_URL=http://YOUR-LAN-IP:8000/api/v1` if necessary. For phone uploads, set root `.env` `S3_PUBLIC_ENDPOINT_URL=http://YOUR-LAN-IP:9000`, then run `docker compose up -d --force-recreate api worker beat` from the repository root. Allow the local ports through your firewall.

**Google sign-in needs an installed native development build**, rather than Expo Go. Start it with `npm start -- --dev-client --lan`. Local Android builds use `npm run android` with Android SDK/JDK installed; local iOS builds need macOS/Xcode and `npm run ios`. See [Google setup](mobile/GOOGLE_SIGN_IN.md) and [release builds](docs/deployment.md).

For local Google authentication, set root `.env` `GOOGLE_OAUTH_CLIENT_ID`; iOS also needs `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Recreate `web` and `api` after changing their environment, and restart Metro. Google Cloud must allow the web origin. Maps use Leaflet with configurable public tiles; no Google Maps key is needed. See [map setup and usage limits](docs/deployment.md#8-maps-and-ghana-reference-data).

## Everyday commands

Run Docker commands from the repository root.

| Task | Command |
|---|---|
| Start / stop | `docker compose up -d` / `docker compose down` |
| Diagnose startup | `docker compose ps`; `docker compose logs api --tail 100` |
| Rebuild dependencies | `docker compose up -d --build` |
| Reload changed background tasks | `docker compose restart worker beat` |
| Backend tests / lint | `docker compose exec -T api pytest`; `docker compose exec -T api ruff check .` |
| Check migration drift | `docker compose exec -T api python manage.py makemigrations --check --dry-run` |
| Test the core rental journey | `docker compose exec -T api pytest -q tests/integration/test_core_lifecycle_smoke.py` |
| Web/mobile checks, from that directory | `npm ci`, `npm test`, `npm run typecheck`, `npm run lint` |
| Check shared design tokens | `node packages/design-tokens/build.mjs --check` |

For an intentional schema change, generate/review migrations with `python manage.py makemigrations` inside `api`, then apply with `python manage.py migrate`. Never edit applied migration history. Web production builds also run `npm run build` with the production API environment; CI checks both clients and the backend.

**Do not use `docker compose down -v` for routine troubleshooting:** it deletes local database, object and Redis volumes. Keep `.env` private. Local credentials, console messaging and permissive file scanning are for synthetic development data only.

## Project layout

| Directory | Contents |
|---|---|
| `backend/` | Domain models/services, API, background jobs and tests |
| `web/`, `mobile/` | Next.js and Expo clients |
| `packages/design-tokens/` | Shared visual tokens and generator |
| `ops/` | R2 CORS configuration and lifecycle smoke-test helper |
| `docs/` | Architecture, design, deployment and working guides |

## Known limitations and launch gates

The production domains are **danpahq.com** and **api.danpahq.com**. Repository features and passing local tests do not establish production readiness. Follow [deployment.md](docs/deployment.md) for services, environment variables, OAuth, releases, verification and rollback.

- Verify physical Android/iOS authentication, SMS/email, maps, uploads/scanner failures, tenancy journeys and database/object backup restoration. Keep live payments disabled until provider flows and reconciliation are verified. Review dependency advisories; do not force incompatible Expo upgrades/downgrades. Backend mypy and some OpenAPI request schemas have outstanding gaps.
- Production integrations need configured Google, Arkesel, Resend, Cloudmersive and Paystack credentials. SMS defaults to `null` until configured. Native enquiry message push uses Expo when explicitly enabled and provisioned; see [deployment §5.1](docs/deployment.md#51-native-property-interest-push--optional). Other notification kinds remain inbox/SMS. Scanning currently limits files to **3,500,000 bytes**.
- Legal approval is required for production agreements and rent/advance policies. Acceptance records are not certified legal e-signatures. Review amendment dates, replacement schedules and commercial part-payment rules.
- There is no integrated NIA lookup, biometric liveness or carrier SIM-swap feed. Property condition evidence does not automatically expire or prove authenticity. Lost-phone recovery, complete erasure, retention/processor terms and security-reporting ownership need operational decisions.
- Refund records are not a complete approval/reversal/accounting workflow. Artisan payment records are not escrow. Independent security sign-off, monitoring, access reviews and restore evidence remain operator responsibilities. Preserve encryption/signing keys and keep database-owner credentials out of runtime services.

## Operations and troubleshooting

- **Uploads/OTP/maps:** check API/worker logs, object URLs and provider configuration. Local bucket repair: `docker compose exec api python manage.py ensure_bucket`. Missing map configuration falls back to lists/localities.
- **Windows/reload:** rebuild `web` for dependency changes; restart `api` for missed reloads and `worker beat` after task changes. Check host port conflicts on 3000/5432/6379/8000/9000/9001. Keep shell scripts LF-encoded.
- **Payment incidents:** configure `PAYMENT_ALERT_OWNER` and `PAYMENT_ALERT_WEBHOOK_URL`, or monitor structured logs. Review reconciliation exceptions in Management; ageing/breach defaults are 4/24 hours (`PAYMENT_RECONCILIATION_AGEING_HOURS`, `PAYMENT_RECONCILIATION_BREACH_HOURS`). Escalate breached/stalled exceptions and provider/alert delivery failures.
- **Recovery:** preserve request/exception IDs, deployment SHA and sanitized evidence. A reconciliation decision records a note/status; it does not repair balances or settlements. Never edit financial/audit history to silence an alert. Investigate `outbox_dead` / `outbox_reclaimed` effects and confirm idempotency before replaying work. Database/object backups are separate; rollback must remain schema-compatible.

## Contributing

Inspect existing source and callers; preserve backend permissions, integer-money handling, audit history, migrations and installed-client compatibility. Reuse existing authentication/payment workflows and shared design tokens. Verify changed behavior and failure paths, then update the appropriate existing guide. Follow [web/AGENTS.md](web/AGENTS.md) before web changes. Report actual checks and unresolved gaps; avoid unrelated changes and duplicate documentation.

## Documentation

[Architecture and ERD](docs/adr.md) · [Design](docs/uxdesign.md) · [Deployment](docs/deployment.md) · [Agent context](docs/ai-context.md) · [Google sign-in](mobile/GOOGLE_SIGN_IN.md) · [Lease review](docs/deployment.md#9-legal-tax-and-device-release-checks) · [Investment terms](docs/investment_terms.md)

## Licence

Proprietary. All rights reserved.
