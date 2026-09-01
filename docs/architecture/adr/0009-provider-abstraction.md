# ADR 0009 — Provider abstraction for every external dependency

**Status:** accepted · 2026-08 · Phase 0 (interfaces only)

## Context
Mobile money in Ghana means MTN MoMo, Telecel Cash and AirtelTigo Money, reached
either directly or through an aggregator, plus banks, cards and utility billers.
Their APIs, error taxonomies and settlement behaviour all differ, and commercial
relationships change.

## Decision
Business logic depends on a capability interface (`MobileMoneyProvider`,
`SmsProvider`, `IdentityVerificationProvider`, `StorageProvider`), never on a
vendor SDK. Each provider is an adapter that translates to and from a shared
domain vocabulary. Selection is configuration.

## Reasoning
The alternative — a `if provider == "mtn"` branch inside the payment service —
means every new provider edits the money path, which is the one file that should
change least.

Interfaces are defined in Phase 0 and implemented in Phase 5. Defining them now
shapes the payment tables: `provider`, `provider_reference` and a verbatim
`payment_event` payload exist because provider disputes are settled with the raw
callback, not with our interpretation of it.

## Consequences
- Every adapter must map to the same status vocabulary, including the awkward
  states (pending-with-no-callback, reversed-after-success).
- Adapters own retry and idempotency semantics; the domain sees one contract.
- No provider claim (uptime, settlement time, fee) is documented here until it
  has been observed in an integration test against a sandbox.
