# ADR 0007 — Expo, and Android as the reference device

**Status:** accepted · 2026-08 · Phase 0

## Decision
Expo (managed workflow) with React Native and TypeScript. Android is the
reference platform: the device the product is designed on and the one CI targets
first.

## Reasoning
Expo gives OTA updates, a maintained native module set (secure store, camera,
location, notifications) and a build service, without a native toolchain per
engineer. OTA matters more here than usual — pushing a fix to users who ration
data and rarely update apps from the store is a real advantage.

Android first is not a courtesy. The target user is on a mid-range or older
Android device with limited storage on a metered connection, and designing for
that changes decisions: hairline borders instead of shadows, 48dp touch targets,
transform-and-opacity animation only, and a `data_saver` flag on the user record.

## Consequences
- Native modules outside Expo's set require a config plugin or a development
  build. The trigger for leaving managed Expo will be a specific requirement,
  recorded in its own ADR.
- Bundle size and cold start are tracked from Phase 1, not discovered at launch.
- iOS is supported and tested, but is not where a trade-off gets resolved.
