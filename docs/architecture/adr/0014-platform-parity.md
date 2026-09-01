# ADR 0014 — Android and iOS as equal platforms, with different manners

**Status:** accepted · 2026-08 · Phase 1

## Context
The brief requires both platforms to be first-class and to diverge where the
platform conventions diverge, rather than shipping one behaviour twice.

## Decision
One codebase and one design system. Platform differences are isolated in
`mobile/src/platform.ts`, with the reason recorded next to each. A component
imports from there rather than branching on `Platform.OS` inline, so the set of
differences is enumerable and reviewable.

## The differences, and why each exists

| Concern | Android | iOS | Why |
|---|---|---|---|
| OTP autofill | `autoComplete="sms-otp"` | `textContentType="oneTimeCode"` | Genuinely different mechanisms. iOS parses the SMS itself; Android's SMS Retriever needs an app hash. Getting this wrong is where sign-ups are abandoned. |
| Stack transition | fade from bottom | slide from right | Each is the platform's own convention; the other reads as a port. |
| Back gesture | system back | interactive swipe-back edge | Removing iOS's edge swipe feels broken to an iOS user. |
| Destructive confirm | centred dialog | action sheet, red row | `Alert` maps to the right native presentation on each. |
| Elevation | hairline border only | very subtle shadow | Shadows smear on the low-cost LCD panels common on the Android base here. |
| Haptics | errors only | success, error, selection | Android motor quality varies enormously across the price range we target; a coarse buzz reads as a malfunction. |
| Font scaling cap | 1.6× | 2.0× (Dynamic Type) | Dynamic Type is a system-level accessibility promise on iOS. Android is honoured but capped so dense rows do not break on a 5-inch screen. |

## Consequences
- Every new component must consider both platforms at review, not just build on
  the reviewer's own device. The table above is the checklist.
- Some differences cannot be verified without both a physical Android device and
  an iPhone. Neither has been used yet; this is recorded as an untested area
  rather than an assumption.
- The shared design tokens keep colour, type and spacing identical, so
  divergence is confined to interaction, which is where it belongs.
