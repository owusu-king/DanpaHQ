# AI Agent Rules

## Purpose

This file contains detailed operating rules for AI coding agents. Read it when performing implementation, refactoring, dependency, Git, testing, or architecture-sensitive work.

## Existing Architecture Wins

Before creating any model, service, hook, utility, component, API client, middleware, worker, event bus, or abstraction, search the repository.

If an established pattern exists, extend it. Do not introduce competing architectures without explicit justification.

Never assume missing means unimplemented. Search backend, web, mobile, docs, tests, ops, configuration, migrations, feature flags, shared packages, and generated clients first.

## Scope Control

Large requests should be decomposed into bounded milestones.

Avoid:

```text
Build the entire platform.
```

Prefer:

```text
Implement property verification.

Scope:
- Django domain logic
- API
- permissions
- tests
- Next.js integration
- React Native integration
- documentation

Stop after this feature.
```

Local models perform more reliably with controlled scopes.

## Refactoring

Do not refactor unrelated code merely because another implementation seems cleaner.

Refactor only when:

- required by the feature
- required to fix a defect
- explicitly requested
- necessary to eliminate meaningful duplication
- necessary to preserve architectural consistency

Explain substantial refactors.

## Dependencies

Before adding a dependency:

1. Check whether existing dependencies already solve the problem.
2. Consider maintenance and security implications.
3. Prefer established libraries.
4. Avoid dependencies for trivial functionality.
5. Avoid introducing multiple libraries for the same job.

Never upgrade major framework versions as a side effect of unrelated work.

## Backward Compatibility

Preserve backward compatibility unless a breaking change is explicitly approved.

Be especially careful with:

- database migrations
- API contracts
- authentication
- public URLs
- mobile clients
- existing web clients

Remember that older mobile app versions may remain installed after backend deployment.

## Error Handling

Do not swallow errors.

Backend errors should produce predictable responses. Clients should distinguish validation, authentication, authorization, connectivity, server, and unexpected errors where appropriate.

Never expose raw backend stack traces to end users.

## Testing

Every meaningful feature should have appropriate tests.

Backend tests may include:

- service tests
- model tests
- permission tests
- API tests
- validation tests
- transaction tests

Frontend/mobile tests may include:

- component behavior
- API integration
- form validation
- state transitions
- critical workflows

Do not remove tests merely to make a build pass. If a test appears wrong, investigate the requirement before changing it.

## Linting and Type Checking

Run the actual commands defined by the repository. Examples may include:

```bash
python manage.py check
pytest
ruff check .
npm run lint
npm run typecheck
```

Do not assume these exact commands exist; inspect configuration first.

## Git Discipline

Before significant changes:

- inspect current Git status
- understand existing modifications
- avoid overwriting user work
- keep unrelated changes untouched

Prefer focused commits. Do not combine unrelated refactors with feature implementation.

## Documentation

Update documentation when changes affect:

- architecture
- API behavior
- configuration
- environment variables
- deployment
- integration requirements
- security behavior
- major domain workflows

Documentation should describe implemented behavior, not speculative future behavior.

## Agent Prohibitions

AI agents must not:

- rewrite architecture without approval
- replace frameworks without approval
- duplicate existing domain logic
- bypass backend permissions
- disable security controls to make tests pass
- hard-code secrets
- invent payment success
- modify audit history
- delete failing tests without investigation
- silently change API contracts
- add unnecessary dependencies
- perform unrelated refactors
- claim tests passed if they were not executed

## Required Workflow

### 1. Understand

Read relevant context, architecture docs, API docs, models, services, tests, and client implementations.

### 2. Search

Find existing patterns and dependencies.

### 3. Plan

Identify backend, database, API, web, mobile, test, and documentation impact.

### 4. Implement

Make the smallest coherent set of changes.

### 5. Verify

Run relevant backend tests, frontend checks, type checks, linting, and integration tests.

### 6. Review

Check for unintended API breakage, duplicated business logic, missing permissions, missing validation, security regressions, and unrelated modifications.

### 7. Report

Summarize files changed, architecture decisions, migrations, API changes, tests executed, and remaining issues.
