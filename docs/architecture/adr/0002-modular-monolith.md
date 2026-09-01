# ADR 0002 — Modular monolith, boundaries first

**Status:** accepted · 2026-08 · Phase 0

## Context
Greenfield product, small team, unproven domain boundaries, and a roadmap that
ends in payments and lending — where consistency matters more than independent
deployability.

## Decision
One deployable Django project with strictly enforced module boundaries under
`apps/`, a one-directional dependency rule, and cross-module communication
through service functions or domain events.

## Reasoning
Microservice boundaries drawn before the domain is understood become distributed
coupling: the same change touches four repositories and a queue. A lease, its
charges and its audit entries share a transaction; splitting them means a saga
and an entire class of partial-failure bugs, bought for scale we do not have.

## Consequences
- The boundary rule is only real if it is enforced. Today it is enforced in code
  review and by the import layering in `overview.md`; an import-linter rule in CI
  is a Phase 1 task.
- Extraction remains possible: a module that already talks in events and service
  calls can move behind a network hop without rewriting its callers.
- Scaling is horizontal replicas plus dedicated worker queues first. Service
  extraction needs a specific justification — a different scaling profile, a
  regulatory boundary, or a team boundary — recorded in its own ADR.
