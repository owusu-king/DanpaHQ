# ADR 0008 — One token source, generated for each platform

**Status:** accepted · 2026-08 · Phase 0

## Decision
`packages/design-tokens/tokens.json` is the only place a colour, space, radius,
duration or type step is defined. `build.mjs` generates CSS custom properties for
Next.js and a typed theme object for React Native. Generated files are committed;
`node packages/design-tokens/build.mjs --check` fails CI if they drift.

## Reasoning
Two hand-maintained palettes diverge within weeks, and the divergence shows up as
a product that feels like two products. Generating both from one file makes
drift a build failure rather than a design review finding.

Tokens carry a `use` string explaining what each value is for. A palette without
that becomes a bag of hex codes that engineers pick from by eye.

## Consequences
- Adding a token is a source edit plus a regenerate, never a local hex value.
- Platform differences (React Native has no CSS variables, no `em`) are handled
  in the generator, not by maintaining a second source.
- The concept and its constraints live in the token file's `$meta`, so the
  reasoning travels with the values.
