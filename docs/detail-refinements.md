# Detail-page refinements and mobile Explore location search

## Changes

- Web Unit details: removed the inline photo section and entrance-direction
  controls. The existing photo gallery and Unit setup wizard retain photo access.
  Entrance notes already stored in the database are preserved; saving a Unit's
  name/description does not send or clear that field.
- Unit information and access/verification now use equally sized columns.
  View listing, take down, and re-check share one wrapping action row, with
  consistent borders and restrained green/red backgrounds. Tenancy navigation
  sits directly beneath that row instead of below the entire page.
- Property details: Units are now below Overview in the left column; the
  redundant tenant-management link was removed. Location and verification remain
  on the right. Sale properties still have no rentable Units section.
- Sale editing: `SalePanel` now opens `PropertyWizardModal`, the creation sheet,
  with the same `SaleDetailsForm` used during creation. Existing values and
  `editable_fields` are passed through. Verified structural/tenure fields remain
  locked. The form scrolls inside the sheet and Save changes has a fixed footer.

## Mobile search root cause and fix

`HeroSearch` reduced a selected location suggestion to its name. The Explore
screen therefore never set its existing `area` state, so its geographic fit
effect was unreachable. In addition, the one-time extent-fit flag was not reset
when typing a different search, leaving new results outside the old viewport.

The complete selected location now reaches Explore. Valid reference coordinates
produce the existing approximate locality bounds and a map-fit request, even if
there are no listings in that area. Selecting a different location clears an old
map-area filter. New text searches reset the previous extent fit; clearing a
search or editing it cancels pending location lookups and invalidates stale map
summary responses.

Keyboard submission resolves a unique exact name or alias through the existing
Ghana reference API. Ambiguous names require selecting a suggestion; locations
without coordinates remain searchable by text and explain why the map cannot
focus them. No coordinates are invented. The local API was checked with Kumasi
and returned coordinates and multiple same-name locations, confirming why the
explicit district/region choice matters.

## Satellite imagery

OpenStreetMap's standard tile service supplies a drawn street map, not a general
satellite/aerial layer. Imagery displayed in OSM editors belongs to separate
providers and does not automatically carry permission for use in this app.
Satellite mode would require a suitable imagery source, coverage and attribution.
The current street-map provider and Management tile configuration were preserved.

Sources: [OSM maintainer explanation](https://help.openstreetmap.org/questions/42404/satellite-imagery-usage/),
[current OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Files

- `web/app/record/space/page.tsx`
- `web/app/record/property/page.tsx`
- `web/src/components/property/SalePanel.tsx`
- `web/src/components/property/PropertyWizard.tsx`
- `web/src/styles/property-detail.css`
- `web/src/styles/creation-wizard.css`
- `mobile/app/(app)/search.tsx`
- `mobile/src/components/explore/ExploreHero.tsx`
- `mobile/src/exploreLocation.ts`, `mobile/src/exploreLocation.test.mjs`
- `web/src/lib/recordDetail.test.mjs` and updated layout contract tests.

## Validation

- Web `npm test`: 535 passed.
- Mobile `npm test`: 464 passed.
- Both clients `npm run typecheck`: passed.
- Both clients `npm run lint`: no errors; existing warnings remain (web 1, mobile 226).
- Mobile `npx expo export --platform android --platform ios --max-workers 1 --output-dir ../tmp/detail-refinements-mobile-export`: passed for both platforms.
- Desktop browser review: all three Unit workflow buttons share the same row. The two information cards have equal widths. No inline photo editor or entrance-direction field is present.
- Property browser review: Units and Overview share the same left edge and width, with a 16px gap; the tenant-management link is absent.
- Sale modal browser review: existing values load, tenure/land details remain disabled, the body scrolls and the Save changes footer stays within the modal. The editor was closed without saving. No live record was changed during QA.
- Production web build: passed (89 static pages), using `docker compose exec -T -e CIRCLE_NODE_TOTAL=2 -e NODE_OPTIONS=--max-old-space-size=1536 -e NEXT_PUBLIC_API_URL=https://api.danpahq.com/api/v1 web npm run build`. Transient TLS retries occurred before successful compilation.
- `git diff --check`: passed.

On a native device, verify selecting a Ghana locality moves the camera, searching
an exact unique name/alias behaves the same way, ambiguous names offer an explicit
choice, and clearing/changing a search cannot allow an older lookup to move the
map back. The locality bounds are approximate point-based extents, not verified
administrative boundaries.

Native-device/Expo Go verification remains necessary for the full keyboard,
suggestion selection and camera interaction. JavaScript exports and component
tests do not establish physical-device behavior. No dependencies, native
configuration, backend models, or saved Property/Unit data were changed.

Screenshots: `tmp/detail-refinements-unit-desktop.jpg`,
`tmp/detail-refinements-property-desktop.jpg`, and
`tmp/detail-refinements-sale-edit.jpg`. Test/export/build logs are under
`tmp/detail-refinements-*` (ignored generated artifacts).

The preview encountered stale development chunks during review. Its generated
`/app/.next/dev` cache was moved aside inside the Docker cache volume and the web
service restarted. Source files and database contents were not reset.

After the final build, the web development service was restarted. Its Unit route
returned HTTP 200 after cold compilation; the service and API were healthy.
