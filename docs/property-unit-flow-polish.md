# Property and Unit workflow review — 28 October 2026

## Decisions and changes

- Creating or finishing setup of a Property closes the wizard and returns to the inventory. It does not open a confirmation, submit for verification, or publish anything. Explicit verification submission remains a separate action.
- The Add Property card precedes property records, including filtered results. Existing creation permissions remain in force.
- Web and mobile property inventories offer Newest, using the API's `created_at`. Sorting follows the existing filters; invalid/missing timestamps have a deterministic fallback. Existing sorting choices remain available.
- Unit photo rows reuse the Property evidence tile: 64 × 64 thumbnails, a title/reason beside each tile, and quiet gallery actions. The existing gallery/evidence APIs, required slots, and primary-image behavior remain intact.
- Explicit Property submission uses a short confirmation, with cancellation and an explicit confirmation action. It does not repeat the full property record. Web details keep this interaction in place; mobile details use the existing native confirmation convention. Legacy submission links also show a compact confirmation.
- Publishing a Unit opens a focused modal/sheet using the existing composer. Previously saved publication terms remain visible on republish. Pending operations are guarded, and a draft ID is retained when a publish attempt fails so retrying does not create another draft. The existing listing named by the Unit API is used rather than an arbitrary matching historical listing.
- Property Details now places its photograph and lifecycle/actions in the same responsive composition as Unit Details. Action groups and form surfaces reuse the existing design tokens. Verified property details and coordinates remain locked. No separate location-adjustment section was added to Property Details.

## Verification/publication root cause

`spaces.request_recheck()` previously called `suspend_for_verification()`. That changed listing moderation to suspended but retained `publication_state=published`. The resulting listing was excluded from Explore and could not be taken down through the active-listing endpoint, while some detail controls rendered Public from the publication flag alone. Approving the new Unit review did not undo the listing suspension.

The corrected transitions are:

1. A deliberate provider re-check withdraws an active advertisement through the existing listing withdrawal service. The previous Unit review remains superseded history; the current gallery is retained as evidence for the new review.
2. Editing and pending review stay private.
3. Approval verifies the Unit and leaves the advertisement withdrawn.
4. The provider explicitly republishes. The existing permission, identity, property, Unit-review, billing, and occupancy gates still apply.
5. A later takedown changes publication without undoing verification.

The Unit publication serializer now checks effective listing status and public-search eligibility. Public search checks its publication, moderation, and availability axes as well as status, occupancy and billing restrictions. Client controls and badges use the same active/published meaning of Public.

Historical suspensions caused by the old provider re-check path can be recovered on an explicit publish action only when the latest listing audit entry and the corresponding provider Unit re-check entry prove that cause, including the same nonempty request ID, matching reason and recorded re-check metadata. Missing/ambiguous provenance fails closed. Genuine management suspensions remain blocked. No records were automatically republished or bulk-unsuspended.

## Location behavior

Selecting a reference town/neighborhood during creation now immediately places the map marker, moves the map, and fills district context. The creator may refine the marker before verification. Changing the selected locality or its city/district context clears the old marker; editing unrelated fields does not move it. A reference without valid coordinates clears the previous marker and remains a valid unlocated draft. A typed name is not silently geocoded or assigned invented coordinates.

The web form groups name, locality and district beside the map on desktop, stacking them at smaller widths. It uses the existing database autocomplete and Leaflet map; no Google service or new dependency was introduced.

Published rentals inherit their parent Property's location. Direct-sale Properties use the same location derivation. A saved Property pin takes precedence and keeps the existing snapped public precision. Older Properties with no pin may use their recorded reference locality (or previously resolved place) coordinates, marked as `locality` precision with the existing neighborhood-level radius. This fallback changes derived public listing coordinates only; it does not edit a verified Property or claim a neighborhood centroid is an exact building position. Locations with no usable coordinates remain unmapped.

Refresh derived coordinates on deployment with:

```sh
docker compose exec -T api python manage.py refresh_listing_locations
```

This repeatable command was run locally. It reported zero additional updates because the cached coordinates were already current at that point. The local rental map API returned HTTP 200, total 8 and unmapped 0, grouped into four marker features at zoom 18. All three local sale records also had public map coordinates. Browser inspection confirmed four rental marker groups and three sale markers in Explore's All map view.

Some existing saved pins are geographically far from their named locality. These were not overwritten: verified records remain locked and manually saved pins remain authoritative. The creation changes prevent omission of an available reference marker for new records; correcting old inaccurate verified coordinates requires a separately authorized review/support process.

## Principal files

- Backend: `apps/property/spaces.py`, `apps/property/serializers.py`, `apps/listing/services.py`, `apps/listing/read_models.py`, `apps/listing/location.py`, and `apps/listing/management/commands/refresh_listing_locations.py`.
- Web: Properties inventory; Property and Unit details; direct Property creation/publishing routes; `PropertyWizard`, `PropertyLifecycle`, `PropertyVerification`, `SpacePhotos`, `VerificationPanel`, `LocationPicker`, `ListingComposer`; creation/detail styles.
- Mobile: Properties inventory; Property creation/setup/submission routes; Unit details/composer; `PropertyWizard`, `PropertyLifecycle`, `SpacePhotos`, `VerificationPanel`, `LocationPicker`; API types for the existing creation timestamp.
- Regression tests: backend Unit lifecycle/map/property-location tests; web creation/sorting tests; web/mobile location-selection tests.

No application dependencies, lockfiles, native configuration or geographic source data were changed for this task. Earlier uncommitted work was retained.

## Validation

Commands run from the repository root unless a client directory is specified:

```sh
docker compose exec -T api ruff check apps/listing/location.py apps/listing/read_models.py apps/listing/services.py apps/property/spaces.py apps/property/serializers.py tests/integration/test_unit_flow.py tests/integration/test_map_search.py tests/integration/test_property_map_location.py
docker compose exec -T api pytest -q tests/integration/test_unit_flow.py tests/integration/test_map_search.py tests/integration/test_property_map_location.py tests/integration/test_property_list_queries.py tests/integration/test_listing.py tests/integration/test_listing_axes.py tests/integration/test_listing_flow.py tests/integration/test_discovery.py tests/integration/test_related_listings.py tests/integration/test_sale.py tests/integration/test_condition_evidence.py
```

- Backend Ruff passed. Backend integration suite: **270 passed**, 136 warnings about the absent local staticfiles directory. Includes repeated re-check/approval/republish/takedown cycles, legacy recovery, a genuine suspension staying blocked, inherited map precision, unknown locations, verified-property locking and existing query-budget tests.
- `cd web && npm test`: **531 passed**. Includes automatic locality selection and invalid-coordinate clearing, creation completion without a submission dialog, and Newest timestamp fallback.
- `cd mobile && npm test`: **457 passed**. Includes automatic locality selection and clearing.
- Both `npm run typecheck` commands passed.
- Web lint: zero errors, one existing warning. Mobile lint: zero errors, 226 existing warnings.
- Final production web build passed: `docker compose exec -T -e CIRCLE_NODE_TOTAL=2 -e NODE_OPTIONS=--max-old-space-size=1536 -e NEXT_PUBLIC_API_URL=https://api.danpahq.com/api/v1 web npm run build`.
- Final Android/iOS JavaScript exports passed from `mobile`: `npx expo export --platform android --platform ios --max-workers 1 --output-dir ../tmp/creation-polish-mobile-export`, with `EXPO_PUBLIC_API_URL=https://api.danpahq.com/api/v1` and `NODE_OPTIONS=--max-old-space-size=1536`.
- `git diff --check` passed.

The first validation run found an obsolete no-locality-marker expectation and a suspended-state test setup issue; both were corrected and the broader suite passed. Client lint initially found unescaped apostrophes in the new confirmation copy; they were corrected and lint rerun. A route-ID guard was restored after an existing contract test flagged its absence.

Logs are retained under ignored `tmp/creation-polish-*` paths. The backend suite above is a focused regression suite, not a run of every backend test. JavaScript exports are not native Gradle/Xcode builds or physical-device tests.

## Manual acceptance limits

The available preview browser is signed out; Property Details, Unit Details and creation forms cannot be visually inspected in that session. No session was fabricated, and no credentials, verification decisions or publication state were changed for browser testing. Authenticated desktop/tablet/phone layout acceptance, keyboard/focus behavior in the new confirmations, actual image-picker uploads, and physical Expo Go interaction still need a signed-in session/device. Public web map tiles and markers were visually inspected.

Suggested signed-in smoke check: create a Property by selecting a town, refine its pin if desired, finish without a confirmation, choose Newest, submit explicitly, approve through the normal management workflow, create/verify/publish a Unit, take it down, reopen/edit/resubmit/approve it, confirm it stays Private, explicitly republish, refresh and confirm that both status and actions agree. Verify that the Property's coordinates remain locked throughout.
