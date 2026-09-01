# ADR 0013 — Verification as an evidenced, dated, expiring decision

**Status:** accepted · 2026-08 · Phase 1

## Context
Phase 0 required that verification never reduce to `verified = true`. This
records what that means as a schema and a workflow.

## Decision
A verification is a decision about **one claim, of one kind, about one subject,
made by someone, at a time, on the strength of evidence, valid until a date**.
Each of those is a column, and each of them is load-bearing:

| Missing | Consequence |
|---|---|
| kind | "verified" means nothing in particular |
| evidence | the decision cannot be re-examined during a dispute |
| decider | nobody is accountable for a wrong approval |
| expiry | a two-year-old check is presented as a fact about today |
| history | a revoked verification looks like one that never existed |

Supporting rules:

- **Re-checking supersedes, never overwrites.** What we believed in March and why
  must stay readable in December.
- **Evidence cannot be deleted** while its verification stands.
- **Approval requires evidence** for anything a human reviewed. A manual approval
  with nothing attached cannot be defended later.
- **Rejection requires a note** written to the applicant saying what to fix.
- **A reviewer cannot decide a check about themselves.** Cheap to enforce,
  removes a whole class of insider risk.
- **`display_state` is computed**, so a stamp never claims currency between
  hourly expiry sweeps.

## Deliberately not built: a trust score
A single number hides which check passed, invites false confidence, and would be
gamed the moment it mattered. The UI shows the stamps themselves, including
"Not checked".

## Consequences
- More rows and more joins than a boolean. Accepted: this is the product's
  core asset.
- Verification kinds each need a validity period, and those periods are judgement
  calls (phone 1 year, identity 2 years, licences 1 year) that should be revised
  against evidence rather than left permanent.
- Human review is a real operational cost and a real queue. The console is built
  for throughput because the alternative is a backlog that blocks people renting.
