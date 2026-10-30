# Verification, confirmation modal and managed maps

> Current workflow update (28 October 2026): [Property and Unit workflow review](property-unit-flow-polish.md) supersedes the earlier creation-confirmation and manual-pin-only behavior below. Creation closes directly; explicit verification has a short confirmation; selecting a reference locality auto-places a marker before verification. Verified properties remain locked. Older records can use an explicitly approximate neighborhood marker without editing the property.

28 October 2026. Implemented locally; not committed, pushed or deployed.

## Why the unit photos behaved inconsistently

`property.spaces.request_recheck` superseded the approved review and suspended
its public listing, but kept UnitMedia while leaving no replacement condition
review. The gallery displayed the saved photos; the evidence checklist read the
new/open review and found nothing. Removing gallery photos could not fill that
missing review, so the warning remained.

Rechecking now starts a fresh, unqueued review and copies only still-attached,
usable, non-sensitive property photographs with valid named slots. The original
approval and its evidence remain immutable. Removing a photo updates the new
review only. Rechecking still takes listings down and does not approve or
republish anything.

A second inconsistency was `condition.snapshot` counting evidence by type while
`progress` and submission matched named slots. The summary now uses the same
slot-aware matcher. An optional context photo cannot stand in for a required
amenity photo merely because both have the same evidence type.

The existing policy is **one required main view plus one required photo per
selected unit amenity**. The other two context views are optional. This was not
changed to a three-photo requirement. Both clients now explain this beside the
photo checklist; required/optional slot labels still come from the backend.

Read-only local inspection corroborated an older superseded review containing
three evidence files and a current approved review containing one. The original
slots were `space.overview` (required), `space.entrance` (optional), and
`space.additional` (optional), matching the current policy. No local
photo, review, approval or publication data was rewritten. No currently affected
unsubmitted unit with retained photos and no replacement review was found.

## Verification history

The screen queried only PropertyProviderApplication records, which units never
create. `/api/v1/management/providers/` now also returns submitted/decided unit
condition checks, including superseded approvals. Unqueued pending drafts are excluded. Unit names include their parent property; internal IDs are
not used as display names. The existing Management read permission remains.
The history table now labels both property and unit submissions.

## Property confirmation

The property list opens the shared PropertyVerificationModal after creation,
keeping the list underneath it. The direct creation route also opens that modal;
existing verification links render the same modal rather than a dedicated
confirmation page. The confirmation retains the details, blockers, explicit
submit action and success state. It closes explicitly and does not submit on
creation. Mobile's existing confirmation screen is presented as a native modal
with the shared close control.

## Management maps

Open **Management → System → Configuration → Maps**, or
`/management/configuration?section=maps`.

The existing permission-controlled, audited configuration editor now offers:

- Enable/disable map rendering on web and mobile.
- A public HTTPS XYZ tile template with `{z}`, `{x}`, `{y}` validation.
- Provider attribution text and its HTTPS copyright/licence link.

`/api/v1/map/config/` exposes only those public map values along with the existing
Ghana bounds/default view. Shared Leaflet adapters consume them, including pin
pickers and listing maps. Empty managed tile URL preserves the existing client
provider. The resolved provider is validated at mount, so a Management override
can replace an invalid build-time tile setting. No Google dependency was added.

Configuration is cached for at most one minute for newly opened map instances;
currently mounted maps are not replaced mid-gesture. Reload web or restart the
updated mobile app after saving for immediate application. Previously shipped
mobile binaries need this JS update before they can consume managed settings.
Use only public tile URLs/tokens, retain correct attribution, and follow the
provider's hosting policy. Existing low-volume OSM defaults are unchanged.
Optional deployment fallbacks are documented in `.env.example`; no real secret
or saved Management setting was changed.

## Verification actually run

- Full backend `docker compose run --rm --no-deps -T api pytest -q`: 2,179 passed,
  868 warnings. This run preceded the final extra named-slot test.
- Final focused suite for units, condition evidence, runtime configuration,
  map search and Management: 186 passed, 89 warnings, including that extra test.
- Backend Ruff passed. Migration drift check: no changes detected.
- Web tests: 529 passed. TypeScript and production build passed. Lint: no errors,
  one existing warning.
- Mobile tests: 456 passed. TypeScript passed. Lint: no errors, 227 existing warnings.
- Android/iOS JS bundle exports passed for both platforms.

Relevant logs are under ignored `tmp/verification-*`. Native Gradle/Xcode builds,
physical-device/Expo Go interaction and authenticated browser acceptance of the
new modal/configuration tab were not run. API permission/configuration/history
and workflow regressions were exercised with isolated test data. No live
property submission, expense, approval or publication action was performed.
