# ADR 0006 — Money as integer minor units with an explicit currency

**Status:** accepted · 2026-08 · Phase 0

## Decision
Every amount is `(BIGINT minor_units, CHAR(3) currency)`. In Python, a frozen
`Money` value object; in TypeScript, `{ minor, currency }`. No floats anywhere,
including in the UI.

## Reasoning
- Floats lose pesewas, and a ledger that does not reconcile is a ledger nobody
  trusts.
- `Decimal` alone still permits an amount without a currency, which is a bug
  waiting for the first non-GHS transaction.
- Splitting is the operation that actually leaks money: pro-rated first-month
  rent, a commission split, an instalment plan. `Money.allocate()` distributes
  remainder units deterministically so parts always sum to the whole. It is the
  most heavily tested function in the codebase.
- `Money * float` raises. Anything wanting a fraction of an amount must say how
  the remainder is handled.

## Consequences
- Two representations of the same rule (Python and TypeScript) that must stay in
  step. Formatting parity is asserted by tests on both sides.
- The ledger in Phase 6 inherits this and adds double-entry on top; no
  conversion layer is needed.
- Currency conversion is deliberately absent. When it arrives it brings a rate
  table with timestamps and a source, not a constant.
