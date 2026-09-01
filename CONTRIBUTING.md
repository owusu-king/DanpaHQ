# Contributing

## The rules that are not negotiable

1. **Module boundaries.** A domain module never imports another domain module's
   models. Cross-domain work goes through a service function or a domain event.
2. **Money is never a float.** Not in Python, not in TypeScript, not in a chart
   label. `Money` and `formatMoney` exist so there is no reason to.
3. **No design values outside the token file.** A hex code in a component is a
   review block.
4. **Every state change that a user could later dispute writes an audit entry.**
5. **Every unsafe endpoint accepts an idempotency key.**
6. **Nothing is described as production ready, secure, compliant or tested
   without evidence in the repository.**

## Before opening a pull request

```bash
docker compose exec api ruff check .
```

```bash
docker compose exec api pytest
```

```bash
node packages/design-tokens/build.mjs --check
```

## Definition of done for a feature

- [ ] Backend: models, service functions, API, permissions, validation
- [ ] Tests: unit for the logic, integration for the permission and the failure
      path — not only the happy one
- [ ] Web and/or mobile UI with loading, empty and error states all implemented
- [ ] Design reviewed against `docs/design/design-system.md`
- [ ] Accessibility: focus visible, targets 48dp, contrast checked, screen reader
      labels present
- [ ] Audit entry where a decision or a money movement happened
- [ ] Documentation updated, ADR added if a significant decision was made
- [ ] Known limitations stated plainly in the pull request

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`),
scoped by module where it helps: `feat(identity): ...`.
