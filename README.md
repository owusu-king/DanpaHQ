# Danpa HQ

Digital infrastructure for renting in Ghana. Mobile-first, built for Android and
iOS phones on metered connections, designed around the three failures that make
renting here hard: you cannot tell whether a listing is real, you cannot tell
whether the person collecting the money has the right to, and once you have paid
there is no record you can hold up later.

**Current state: consumer discovery, account and provider-onboarding stabilization complete; Phase 4 readiness remains subject to documented product decisions.** Visitors browse rentals without an account. An account action uses one
Continue with phone -> OTP flow; new accounts then complete name -> intent.
Returning accounts restore their rotating session and last valid context.
Providers must pass separate identity and property-authority reviews before a
listing can be created or published. No payments yet.

---

## Quick start

You need [Docker Desktop](https://docs.docker.com/get-started/get-docker/), and
nothing else. Two commands, the same on Windows, macOS and Linux:

```bash
cp .env.example .env
```

```bash
docker compose up
```

On Windows CMD or PowerShell use `copy .env.example .env` for the first one.

The first run builds the images and takes a few minutes. Web dependencies are
cached in the web image and a Linux-only named volume, so later starts do not
run `npm install` again. After that the API applies migrations and seeds
Ghanaian geography, amenities and the storage bucket on every start, so there
is no separate setup step.

| Service | URL |
|---|---|
| Web consumer product | http://localhost:3000 |
| API | http://localhost:8000/api/v1/meta/ |
| API docs | http://localhost:8000/api/docs/ |
| Django admin | http://localhost:8000/admin/ |
| MinIO console | http://localhost:9001 (minioadmin / minioadmin) |

OTP codes are printed to the API logs rather than sent by SMS — that is how you
sign in locally. `docker compose logs -f api` shows them.

### Walking the whole thing end to end

The verified provider loop, in the order you can click it:

1. **List a Property** at http://localhost:3000, verify the OTP from
   `docker compose logs api`, enter first and last name, then choose List a property.
2. **Verify identity** at `/provider` with Ghana Card evidence. A provisioned,
   email-verified staff reviewer signs in at `/admin/`; consumer phone sessions
   cannot access operations review.
3. **Submit the property relationship, address and authority evidence** at
   `/provider`, then complete its human review. Entering an address alone does
   not create a property.
4. **Add a unit** to the approved property, then create the listing with its
   headline, rent, advance, deposit and terms.
   The move-in total is calculated as you type, because that is the number that
   decides whether a tenant can take the place.
5. **Add a photo.** It goes straight from your browser to MinIO on a presigned
   URL and never passes through Django.
6. **Publish**, then open the listing to see what a tenant sees.
7. **Search as a tenant** — signed out, at
   http://localhost:3000/rentals, through the public listings API, or on the mobile app.

Mobile supports the same basic account, identity evidence, provider application,
human-review status, unit/listing creation and publication journey, as well as
tenant search and shortlists.

To check the whole loop without clicking, with the stack up, run the canonical
isolated lifecycle test (it uses a test database and does not add records to
your development workspace):

```bash
python ops/smoke_phases.py
```

The underlying target is
`backend/tests/integration/test_core_lifecycle_smoke.py::test_provider_to_tenant_core_lifecycle`.
It stops at the first broken contract from provider registration through the
confirmed rent record.

### The commands you will actually need

```bash
docker compose up -d                 # start in the background
docker compose down                  # stop
docker compose down -v               # stop and destroy the local data
docker compose logs -f api           # follow the API logs
docker compose exec api pytest       # run the test suite
docker compose exec api python manage.py createsuperuser
docker compose exec api python manage.py makemigrations
docker compose build                 # rebuild after changing dependencies
```

Source is bind-mounted, so Django and Next.js reload on save. After changing a
Python or web dependency, run `docker compose up --build` once. The web
entrypoint detects a changed `package-lock.json` and refreshes its dependency
volume before starting Next.js.

### Mobile

Expo does not run in a container. Run it on the host, with the stack up:

```bash
cd mobile && npm install && npx expo start
```

Then press `a` for an Android emulator or `i` for an iOS simulator — the API URL
is chosen for you. For a real phone over Expo Go, the phone needs your machine's
LAN address instead of localhost:

```bash
cd mobile && EXPO_PUBLIC_API_URL=http://YOUR-LAN-IP:8000/api/v1 npx expo start
```

---

## Layout

```text
backend/     Django + DRF. Modular monolith; module boundaries in docs/architecture/overview.md
  apps/core          base models, money, phone, ids, errors, logging, health
  apps/audit         append-only hash-chained audit log
  apps/outbox        transactional outbox for domain events
  apps/idempotency   replay-safe unsafe requests
  apps/geo           Ghana regions, districts, localities, addresses
  apps/files         upload metadata, scanning, retention
  apps/identity      phone-first accounts, OTP, sessions, devices, roles, profiles
  apps/trust         verifications, evidence, review queue
  apps/property      properties, units, amenities
  apps/listing       adverts, media, shortlists
  apps/viewing       viewing requests: times, fee disclosure, contact release
  apps/application   rental applications: advance shortfall, guarantor, decision
  apps/notifications in-app + SMS delivery, idempotent against outbox retries
  apps/lease         tenancy agreements: snapshotted terms, two-sided acceptance
  apps/rent          what is owed, what was paid, and who agrees it was
  apps/api           v1 router, one error envelope, health endpoints
web/         Next.js 16 consumer product: public discovery, account and provider workspace
mobile/      Expo + React Native. Android and iOS both first-class (ADR 0014)
packages/design-tokens   one token source, generated for both platforms
docs/        architecture, ADRs, data model, security, runbook, design system
ops/         packaging and database hardening SQL
```

## Stack

Python 3.12 · Django 5.1 · DRF · PostgreSQL 16 · Redis · Celery · S3-compatible
storage · Next.js 16 · React 19 · Expo 54 · React Native 0.81 · TypeScript 5.9

---

## What exists now

| Area | State |
|---|---|
| Money, phone (E.164), GhanaPost address, UUIDv7, OTP policy, risk rules, crypto | **Implemented, 141 unit cases passing** |
| Unified Continue with phone, rotating sessions, reuse detection and context restore | **Implemented and integration-tested** |
| Public web/mobile browse, search, listing detail and safe marketing photos | **Implemented and tested** |
| Devices, security status, sign-out everywhere | **Implemented and tested** |
| Roles a person can hold several of, with revocation | **Implemented and tested** |
| Tenant / landlord / agent profiles | **Implemented and tested** |
| Verifications with evidence, decider, date, expiry, supersession | **Implemented and tested** |
| Separate operations email/password session and review queue | **Implemented and tested**; production MFA pending |
| Step-up auth and the 72-hour SIM-swap hold | **Implemented and tested** |
| Mobile account, provider onboarding, trust, listing and tenant screens (Android + iOS) | **Implemented; local tests/typecheck pass**, native release builds and device QA still required |
| Landlord console: property, units, listing, photo upload, publish/withdraw | **Implemented and driven end to end** |
| Tenant search, listing detail, shortlist and viewings on mobile | **Implemented**, not yet run on a device |
| Viewing requests: ask, offer times, declare fee, confirm, record outcome | **Implemented, 25 cases passing, driven end to end** |
| Rental applications: apply, advance shortfall, guarantor, decide | **Implemented, 19 cases passing, driven end to end** |
| Notifications: in-app delivered, SMS via the console adapter, idempotent | **Implemented, 19 cases passing** |
| Leases: terms snapshotted, both parties accept, room comes off the market | **Implemented, 24 cases passing, driven end to end** |
| Rent: schedule, two-sided payment records, portable rental history | **Implemented, 21 cases passing, driven end to end** |
| Geography API — locality lookup and address creation | **Implemented, 11 cases passing** |
| Web public landing/catalogue, unified phone continuation, account and provider workspace | **Implemented, built and rendering** |
| Append-only audit, transactional outbox, idempotency table | **Implemented** in Phase 0 |
| Design tokens → web CSS + RN theme | **Implemented and verified** |
| Docker, linting, typing, security scanning | **Local release checks run**; no CI workflow or deployment sign-off yet |

**Not built, and not claimed:** admin MFA, Ghana Card/NIA provider integration
or liveness checks, carrier SIM-swap data, push transport, wallet, and free-form
tenant–landlord messaging. Cloudmersive malware scanning exists but requires
live provider configuration; payment integrations must remain off until their
separate launch gates pass. Database-level append-only enforcement is applied
but inert until the app connects as a least-privilege role — see
`docs/security.md`.

The local backend suite passed **1,734 tests** on 19 October 2026. That is not
evidence the same revision is live. See the [release-readiness decision](docs/deployment/RELEASE_READINESS.md)
before opening the deployment to real users.

## Documentation

Start with the first two.

- `projectBible` — the product brief and the phase definitions
- `docs/status.md` — how far each phase actually got, and the known gaps
- `docs/delivery-log.md` — what each phase shipped

**Architecture**

- `docs/architecture/overview.md` — the shape of the system and the module rules
- `docs/architecture/identity.md` — accounts, verification, what each state means
- `docs/architecture/onboarding.md` — the three journeys and how someone becomes a provider
- `docs/architecture/navigation.md` — who lands where, and why the backend decides it
- `docs/architecture/authorization.md` — what every capability permits
- `docs/architecture/api-contract.md` — the endpoints both clients consume
- `docs/architecture/domain-map.md` — bounded contexts and who owns what
- `docs/architecture/erd.md` — tables that exist, and the ones designed for later
- `docs/architecture/adr/` — the decisions, with their reasoning and their costs

**Working on it**

- `docs/ai-context/` — compact context and operating rules for AI agents
- `docs/design/design-system.md` — the visual system and why it looks like this
- `docs/security.md` — controls in place, designed, and absent
- `docs/runbook.md` — running it, and what to do when it breaks
- `docs/known-limitations.md` — what is knowingly unsolved
- `docs/windows.md` — setup troubleshooting, and running without Docker
- `docs/deployment/RELEASE_READINESS.md` — current go/no-go decision and release gates
- `docs/deployment/DEPLOY.md` — how to deploy web, API and mobile
- `CONTRIBUTING.md` — the rules that are not negotiable

## Licence

Proprietary. All rights reserved.
