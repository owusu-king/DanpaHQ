# AI Project Context

## Purpose

This is the compact, always-loaded context for AI coding agents working on this repository.

Before modifying code, read this file. Then read only the deeper documents relevant to the task:

- `README.md`
- `docs/status.md` — how far each phase got, and the known gaps
- `docs/ai-context/architecture/backend.md`
- `docs/ai-context/architecture/frontend.md`
- `docs/ai-context/architecture/mobile.md`
- `docs/ai-context/architecture/security.md`
- `docs/ai-context/architecture/payments-data.md`
- `docs/ai-context/agent-rules.md`
- relevant feature/API documentation
- existing tests for the area being modified

Preserve the existing architecture. Search before creating new patterns.

## Product Overview

This repository contains a multi-platform SaaS ecosystem centered around housing, rental management, payments, and future digital and financial services.

The product is one coherent system with multiple clients sharing a common backend platform.

Priorities, in order:

1. Correctness
2. Security
3. Data integrity
4. Architectural consistency
5. Maintainability
6. User experience
7. Performance
8. Development speed

## Core Stack

### Backend

- Python
- Django
- Django REST Framework
- PostgreSQL
- Redis
- Celery
- S3-compatible object storage

Django is the authoritative source of truth for:

- domain logic
- business rules
- authentication
- authorization
- validation
- persistence
- permissions
- API contracts
- auditing
- asynchronous workflows
- integrations
- payment orchestration

Frontend clients may perform validation for UX, but backend validation and authorization remain authoritative.

### Web

- Next.js
- React
- TypeScript

The web app is responsible for browser UX, authenticated dashboards, public listing experiences, forms, API consumption, accessibility, and responsive behavior.

### Mobile

- React Native
- TypeScript

The mobile app should consume the same backend domain/API contracts as the web app whenever practical.

## Repository Shape

Expected high-level structure:

```text
/
├── backend/
├── web/
├── mobile/
├── docs/
├── ops/
├── tests/
└── README.md
```

Inspect the real repository before assuming lower-level paths. Never create duplicate application structures simply because something is not immediately visible.

## Primary Architectural Rule

Django owns business logic.

```text
                 Django
                   │
          ┌────────┴────────┐
          │ Business Logic │
          │ Permissions    │
          │ Validation     │
          │ Persistence    │
          └────────┬────────┘
                   │
                 REST API
                   │
          ┌────────┴────────┐
          │                 │
       Next.js        React Native
```

Rules such as eligibility, ownership, role permissions, lease transitions, verification, payments, disputes, and account restrictions belong on the backend.

Do not duplicate authoritative business logic in Next.js or React Native.

## Shared API Contract

The Django API is shared by web and mobile wherever practical.

Before adding or changing an endpoint:

1. Search for an existing endpoint.
2. Search for serializers/schemas.
3. Search for services.
4. Search for existing API client functions.
5. Check API documentation.
6. Find all current consumers in web, mobile, tests, and docs.

Do not create separate `/api/web/...` and `/api/mobile/...` endpoints for the same capability without a documented reason.

API changes must not silently break clients.

## Development Strategy

Build features as vertical slices.

```text
Feature
  ├── Django domain/API
  ├── backend tests
  ├── Next.js integration
  ├── React Native integration
  ├── frontend/mobile checks
  └── documentation
```

Do not complete the whole backend first and postpone all client integration if the feature belongs across multiple surfaces.

## Domain Orientation

Organize logic around business capabilities such as:

- identity and roles
- properties and listings
- verification
- tenants and landlords
- leases and rent
- payments and wallets
- maintenance and inspections
- disputes and reviews
- files and notifications
- audit and geographic data

Future capabilities may include digital services, utilities, lending, insurance, credit assessment, financial analytics, and AI intelligence.

Do not introduce future complexity into current milestones unless an extension point is genuinely required.

## Security Invariants

Never weaken:

- authentication
- authorization
- CSRF/CORS protections
- secrets handling
- rate limiting
- session management
- validation
- webhook verification
- audit logging
- encryption

Never commit secrets, keys, tokens, passwords, or production credentials.

See `docs/ai-context/architecture/security.md` for detailed rules.

## Data and Payment Invariants

- Critical domain invariants should be enforced in the database where practical.
- Multi-write operations should use transactions when partial completion would create invalid state.
- Reuse the existing outbox pattern for reliable event delivery.
- Reuse existing idempotency infrastructure for sensitive operations.
- Never trust frontend-reported payment success.
- Preserve append-only audit behavior.

See `docs/ai-context/architecture/payments-data.md` for details.

## UI Quality

UI quality is a core product requirement.

Avoid generic AI-generated SaaS patterns such as excessive rounded cards, repetitive dashboard grids, arbitrary gradients/shadows, placeholder-looking screens, and unrefined default component-library styling.

Preserve the established design system. Do not redesign unrelated screens while implementing a feature.

See `docs/ai-context/architecture/frontend.md` and `docs/ai-context/architecture/mobile.md`.

## Testing and Verification

After changes, run the actual repository-defined checks for the affected surface, such as:

- Django system checks
- backend tests
- Ruff/linting
- TypeScript checks
- frontend/mobile linting
- relevant integration tests

Do not claim tests passed if they were not executed.

## Git Discipline

Before significant work:

- inspect `git status`
- preserve existing user changes
- avoid unrelated edits
- prefer focused commits
- never delete tests merely to make a build pass

## Agent Workflow

Before implementing:

1. Understand the relevant docs and code.
2. Search for existing patterns.
3. Plan backend/database/API/web/mobile/test/doc impact.
4. Implement the smallest coherent change.
5. Run relevant checks.
6. Review for regressions, duplicated logic, missing permissions, validation, or unrelated edits.
7. Report files changed, migrations, API changes, tests run, and remaining issues.

## Final Instruction

Before writing code: **understand the existing system**.

Before creating something: **search for an existing implementation**.

Before changing an API: **find every consumer**.

Before changing database structure: **understand migration and domain implications**.

Before completing a task: **run the relevant tests and checks**.

Do not treat this repository as greenfield unless explicitly instructed.
