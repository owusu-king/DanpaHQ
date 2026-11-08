# DanpaHQ — AI working context

**Reviewed:** 23 October 2026. Single agent context/rules file. Read it before changes, then inspect only the source and guides relevant to the task. User instructions define scope; this guide does not authorize deployment or live infrastructure changes.

## 1. Read the right source

| Need | Reference |
|---|---|
| Current capabilities, local setup, security, incidents and unresolved risks | [README.md](../README.md) |
| Architecture, authorization, API essentials, tabular ERD and rental lifecycle | [ADR.md](adr.md) |
| Current UI patterns, tokens, accessibility and responsive behavior | [design.md](uxdesign.md) |
| Production configuration, credentials, release/bootstrap and verification | [DEPLOY.md](deployment.md) |
| Contribution requirements / task-specific web instructions | [contribution rules](../README.md#contributing), [web/AGENTS.md](../web/AGENTS.md) |

Code, migrations and tests establish implementation; documentation records decisions and known gaps. Reconcile contradictions against source instead of repeating old phase labels or test counts. Before web code changes, follow `web/AGENTS.md` and read the relevant installed Next.js guide in `web/node_modules/next/dist/docs/`. Do not assume framework APIs from memory.

## 2. Repository map

| Area | Start here |
|---|---|
| Backend | `backend/apps/` domain models/services/policies; `backend/apps/api/urls.py` shared consumer routes; `backend/apps/operations/` Management; `backend/config/` settings/routing. |
| Backend checks | `backend/tests/unit/`, `backend/tests/integration/`, `backend/pyproject.toml`; module-boundary tests define allowed imports. |
| Web | `web/app/` routes; `web/src/components/`, `web/src/lib/`, `web/src/styles/`; static export in `web/next.config.mjs`. |
| Native | `mobile/app/` Expo Router screens; `mobile/src/` services/auth/UI; `mobile/app.config.js`, `mobile/eas.json`, native/plugin configuration. |
| Shared / delivery | `packages/design-tokens/`, `docker-compose.yml`, `render.yaml`, `backend/scripts/`, `.github/workflows/ci.yml`, `ops/`. |

This is an existing Django/DRF modular monolith with PostgreSQL/PostGIS, Redis/Celery, Next.js and Expo clients. Search with `rg` before creating models, endpoints, providers, components or abstractions. Extend the established seam; do not introduce a parallel architecture, dependency or major upgrade as a side effect.

## 3. Invariants to preserve

- **Backend authority:** permissions, prices, verification, lifecycle transitions and entitlements are server decisions. Clients render `/me/` capabilities and resource actions; workspace, role label, hidden button or UUID knowledge grants no authority.
- **Identity:** one account supports multiple experiences. Email-or-phone/password and server-verified Google identity share session handling. Password login accepts `identifier` or legacy `phone`, never both; email is case-insensitive and ambiguous matches fail closed. OTP is purpose-bound registration/recovery/step-up proof. Do not merge identities by matching email or bypass refresh rotation, revocation, throttles or production checks.
- **Authenticator MFA:** Operations Admins configure consumer/Management policies in Management Configuration; Support is denied. Changes require an audited reason and revoke sessions; Super Admin security is outside this boundary. Default requires administrators; consumers stay disabled until configured. Login verifies the primary credential before QR enrollment/code confirmation; pending challenges never grant app access. Google/recovery obey policy. Preserve encrypted keys, one-use recovery proofs and session invalidation.
- **Rental meaning:** Property is private inventory, Unit/eligible hostel Bed is rentable space, Listing is an advertisement, Lease is an agreement, Tenancy is the relationship and Occupancy is temporal allocation. Keep verification, publication and availability separate. Preserve history and concurrent-allocation protections.
- **Integrity:** use explicit transactions, current policy functions, locks/constraints and existing audit/outbox/idempotency mechanisms. Coverage is selective; inspect the actual route. Repeated events and uncertain provider outcomes must not duplicate business effects.
- **Money and billing:** integer minor units plus currency; server-confirmed provider evidence, not client redirects. Reuse Payment Core. Portfolio entitlements are separate from payment movement; downgrade never erases existing records. Do not expose refunds or new financial promises without their accounting rules.
- **Private data:** signed/scoped files and share links, evidence retention, clean scan requirements and log redaction remain intact. Never expose credentials, disable security to pass a test or edit audit/financial history as a repair shortcut.
- **Client quality:** preserve installed mobile API compatibility, token-based styling, accessible states and native safe areas. Follow the design guide; avoid unrelated visual redesign and stacked modals. Native Google requires a native build, not Expo Go.

## 4. Working sequence

1. Inspect `git status`; identify and preserve existing user edits/deletions. Read the affected journey, models/services, callers, tests and configuration before proposing a change.
2. Search both clients and backend consumers before changing a contract. Identify database/API/security/UI impact; implement the smallest coherent slice across the surfaces it affects. Do not silently drop scope or useful capability.
3. Keep external calls outside long database transactions. Return the established error envelope; distinguish validation, authorization, connectivity and server failure. Do not swallow errors or expose stack traces.
4. Review migrations for old-client/running-version compatibility. Preserve applied history; stage destructive changes and backfills deliberately. Never use volume deletion or production data edits as routine troubleshooting.
5. Verify the changed behavior and failure path, then review the diff for regressions, duplication, permission gaps and unrelated changes. Do not remove failing tests to obtain a green result.
6. Keep `docs/` limited to `adr.md`, `ai-context.md`, `deployment.md`, `investment_terms.md` and `uxdesign.md`. Update the appropriate existing guide; do not create task reports, audits, handoff notes or new status/ADR/design collections unless explicitly requested. Keep durable decisions, source credits, commands and unresolved limitations concise; use Git history and CI for historical changes/results. Report executed checks honestly; distinguish not run, blocked, failed and passed.

## 5. Verification and release boundaries

| Surface | Repository-defined checks |
|---|---|
| Backend, from repository root | `docker compose exec -T api ruff check .`; relevant `pytest` tests; migration drift via `python manage.py makemigrations --check --dry-run` inside the container. |
| Web / mobile, from that directory | `npm test`, `npm run typecheck`, `npm run lint`; web production build with its API environment configured. Inspect package scripts before changing them. |
| Shared tokens | `node packages/design-tokens/build.mjs --check`; regenerate without `--check` after intentional source edits. |
| Docs / low-impact presentation | Check references, factual claims and affected rendering; use focused checks rather than unrelated full suites. |

CI is the exact-commit release record. Backend mypy/OpenAPI gaps and live/device/legal/security prerequisites remain in [README.md](../README.md); do not relabel them complete. Production owner/bootstrap credentials belong only in the isolated GitHub release environment, never the running Render application. Keep runtime checks and scheduler supervision/locking intact.

Act within the authorized task. Do not deploy, push, change live services, introduce paid resources or send external messages without authorization. Explain meaningful tradeoffs; routine reversible implementation work does not need repeated approval. Keep secrets out of source, terminal output, client bundles and documentation.
