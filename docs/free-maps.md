# Free-first maps: implementation and verification

> Current workflow update (28 October 2026): [Property and Unit workflow review](property-unit-flow-polish.md) supersedes the earlier creation-confirmation and manual-pin-only behavior below. Creation closes directly; explicit verification has a short confirmation; selecting a reference locality auto-places a marker before verification. Verified properties remain locked. Older records can use an explicitly approximate neighborhood marker without editing the property.

Updated 28 October 2026. This follow-up replaces the Google map/location work
described in `rental-issues-fixes.md`. Earlier unrelated rental fixes remain in
the working tree. Nothing has been committed, pushed, deployed, or subscribed to.

## Geography follow-up

Database-backed autocomplete and the full obtained reference import are now
implemented; see [Ghana locations](ghana-locations.md). That supersedes the
earlier limited-seed/plain-input notes below. Leaflet and manual property pins
remain unchanged.

## Management configuration follow-up

Management → System → Configuration → Maps now controls public tiles,
attribution and map rendering. See [verification and map fixes](verification-map-fixes.md)
for runtime refresh behaviour. The build-only configuration notes below describe
the original fallback; managed values now take precedence in updated clients.

## Implementation

- Web: Leaflet 1.9.4 behind the existing imperative map interface. Keeping that
  interface avoids replacing the existing React previews, filters, selection,
  navigation, clustering and pagination with React Leaflet components. Imports
  happen after client mount. Abandoned asynchronous imports are cancelled,
  including Next.js Strict Mode's development mount/cleanup/remount sequence.
- Mobile: the existing Expo Go-compatible `react-native-webview` 13.16.1 renders
  locally bundled Leaflet JS/CSS. No CDN executable code, native Google map SDK,
  location permission, or device GPS is needed. `postinstall` generates the
  ignored runtime from the pinned npm package, including its BSD licence.
- Both creation wizards accept a written town/neighbourhood and optional city,
  street, landmark and GhanaPost address independently of a manually selected pin.
  Existing property editing initializes the picker from saved coordinates. A
  neutral initial viewport creates no pin. Tapping/dragging updates six-decimal
  coordinate values; clearing removes both values. Drafts can still be saved
  without coordinates; no new publication requirement was introduced.
- Address creation accepts plain written location fields through the existing
  `/api/v1/geo/addresses/` endpoint. Property PATCH accepts
  `{"location":{"latitude":6.700123,"longitude":-1.620456}}`; two nulls clear it.
  Latitude must be within [-90,90], longitude within [-180,180], and both must be
  present or absent together. Existing management, billing and verification edit
  gates still apply. An in-review/verified property must follow the existing
  allowed editing/withdrawal/reverification workflow.
- A pin edit never rewrites written address fields or prices. If the address row
  is shared with another property, a personal profile or a verification
  application, its written values are copied before editing the property's pin.
  Other references and their coordinates remain unchanged. Manual pins are not
  labelled as surveyed/authoritatively confirmed coordinates.
- Rental and sale public map points refresh together when a pin changes. The
  existing approximately 300 m public privacy grid remains: public markers are
  intentionally approximate, while authorized provider forms use saved private
  coordinates. Neighbourhood centres are no longer used as invented property
  positions. Missing-coordinate listings remain in list results and are counted
  as unmapped. Invalid marker coordinates are ignored by the adapters.
- Property search uses the existing Django/PostgreSQL filters and APIs. Typing
  no longer requests autocomplete or geocoding. Existing locality endpoints
  remain database-only for older clients; obsolete Google provider choices are
  rejected. The Google provider implementation and geocoding repair option were
  removed. Map bounds, listing previews, list pagination, marker cap/clustering,
  clear-filter actions, and deliberate map-area URL state remain in place.
- Satellite/Street View are unavailable with this street-tile provider; their
  controls are hidden rather than offered as nonworking buttons. No replacement
  paid imagery service was enabled.

## Dependencies and changed files

The existing npm package managers and separate lockfiles were preserved.

| Application | Installed | Removed | Retained |
|---|---|---|---|
| Web | `leaflet@1.9.4`, development `@types/leaflet@1.9.22` | `@googlemaps/js-api-loader`, `@types/google.maps` | Existing Next.js/React versions and UI components |
| Mobile | `leaflet@1.9.4` | `react-native-maps` | Expo SDK 57, RN 0.86.3, WebView 13.16.1, unrelated Google Sign-In |

| Files | Purpose |
|---|---|
| `backend/apps/geo/serializers.py`, `views.py`, `providers/__init__.py`; removed `providers/google.py` | Manual written-address creation, paired coordinate validation, local-only legacy lookups |
| `backend/config/settings/base.py` | Remove unused Google Places configuration |
| `backend/apps/property/serializers.py`, `services.py` | Authorized coordinate serialization/editing, shared-address protection, marker refresh |
| `backend/apps/listing/location.py`, `management/commands/refresh_listing_locations.py` | Derive rental/sale markers only from real saved pins, preserve privacy, no external lookup |
| `backend/tests/integration/test_property_map_location.py`, `test_place_lookup.py`, `test_map_search.py` | Ownership, ranges/pairs, unchanged written fields/prices, legacy/unmapped results, no geocoding, rental/sale refresh |
| `web/src/lib/maps/{index,types,tiles,events}.ts`, `leaflet/map.ts`, `leaflet/map.css` | Configurable Leaflet adapter, draggable markers, failures, safe mount lifecycle |
| Removed `web/src/lib/maps/google/*`, `preview/*` | Remove Google and obsolete development-only adapter implementations |
| `web/src/components/property/LocationPicker.tsx`, `PropertyWizard.tsx`, `EditPropertyModal.tsx`; `web/src/lib/console.ts` | Provider create/edit pin UI and API types |
| `web/src/components/explore/PlaceSearch.tsx`, `ExploreMap.tsx`; `components/listings/ListingLocationMap.tsx` | Database text search, available map controls, cancellable initialization |
| `web/src/lib/freeMaps.test.mjs`, `exploreMap.contract.test.mjs`, `exploreWorkspace.contract.test.mjs` | Cancellation regression checks and updated search/adapter contracts |
| `mobile/src/maps/{DanpaHQMap.native,LeafletView,bridge,leafletHtml,index,types}.tsx/ts`; `mobile/scripts/prepare-map-assets.cjs` | Locally bundled WebView map, validated messages, reusable markers, visible attribution, tile errors |
| `mobile/src/components/property/{LocationPicker,PropertyWizard}.tsx`, `mobile/src/provider.ts` | Provider forms, saved pin initialization, API types |
| `mobile/app/(app)/search.tsx`, `mobile/app.config.js` | Database text search, remove maps-key plugin/configuration while preserving OAuth, FCM and signing |
| `mobile/src/freeMaps.test.mjs`, `exploreMap.contract.test.mjs`, `creationForms.contract.test.mjs` | Executable bridge validation and updated map/form contracts |
| Both `package.json`/`package-lock.json`, `.gitignore` | Reproducible dependency changes and generated-runtime exclusion |
| `.env.example`, `docker-compose.yml`, `render.yaml`, `render.staging.yaml` | Public tile settings and removal of obsolete map-key instructions |
| `web/public/leaflet-LICENSE.txt`, `README.md`, `docs/{adr,deployment,rental-issues-fixes,free-maps}.md` | Licence, current setup, policies and manual verification |

No custom native Android project files were rewritten. The ignored Android
checkout may still contain old generated Maps placeholders/metadata; no removed
native map component calls them. Review that generated material during your next
normal native build. Do not run `prebuild --clean` over custom native work.

## Tile service, commercial use and cost limits

Expected early traffic: **under 100 daily map views**. The keyless default is
`https://tile.openstreetmap.org/{z}/{x}/{y}.png`, credited with a visible link to
`https://www.openstreetmap.org/copyright` and “© OpenStreetMap contributors”.

OSM data licensing permits commercial use subject to its licence, but community
tile hosting has **no guaranteed free quota, capacity or SLA**. Under 100 views is
not a contractual allowance: panning, zooming and viewport size determine tile
requests. This is a light-development default, not a promise of unlimited free
production hosting. The [OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/)
requires attribution, appropriate client identification/referrers, respect for
HTTP caching, and no bulk downloading/prefetch/offline scraping. The adapters
retain normal caching, keep one extra tile buffer, update on settled movement,
and do not add prefetch/offline caching. Mobile supplies an identifying app user
agent and a base origin; web retains its normal origin referrer. See also the
[OSMF licence FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ).

For a documented commercial free tier, an optional alternative is
[Geoapify free maps](https://www.geoapify.com/free-maps-api/) and its
[pricing details](https://www.geoapify.com/pricing-details/): currently 3,000
credits/day, with standard map tiles at 0.25 credits each (12,000 tiles/day if
used only for tiles). Its free offering permits commercial use with the required
Geoapify and OSM attribution and does not require a credit card. An account and
public, appropriately restricted tile token would be your manual choice. No
account was created, provider enabled, card supplied or subscription purchased.
Verify the current style/size credit cost, rate limit, attribution and quota
before selecting a plan. No provider can guarantee future hosting at zero cost.

Leaflet itself is free under its BSD licence. Existing database/API hosting,
uploads, authentication providers, SMS/email, payment integrations and any build
services retain their existing costs. This change adds no paid service.

## Configuration and rollout

The defaults work without map keys. To change the tile host, set these **public
build inputs**, with attribution matching that host:

```dotenv
NEXT_PUBLIC_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
NEXT_PUBLIC_MAP_TILE_ATTRIBUTION=© OpenStreetMap contributors
NEXT_PUBLIC_MAP_TILE_ATTRIBUTION_URL=https://www.openstreetmap.org/copyright
EXPO_PUBLIC_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
EXPO_PUBLIC_MAP_TILE_ATTRIBUTION=© OpenStreetMap contributors
EXPO_PUBLIC_MAP_TILE_ATTRIBUTION_URL=https://www.openstreetmap.org/copyright
```

The URL must be HTTPS and include `{z}`, `{x}`, `{y}`. Never place private keys
in public variables. Restart/rebuild clients after changing inputs; for Compose,
recreate the web container. Mobile also accepts these explicit public values
through the existing root-environment app-config convention. Real environment
files and credentials were not overwritten.

The old `LOCATION_PROVIDER`, `GOOGLE_MAPS_SERVER_API_KEY`, Google Places options,
`NEXT_PUBLIC_GOOGLE_MAPS_*` and `GOOGLE_MAPS_ANDROID_API_KEY` are unused by these
workflows. Existing Google **OAuth/Sign-In** and FCM settings remain separate and
must be retained if you use them. Disabling obsolete Google Maps APIs/keys in
your own Cloud project is an optional manual cleanup; no Cloud settings changed.
Roll out the API and updated clients together: older clients that submit a
Google Places choice must update; existing local-database locality IDs remain
supported. No external geocoder is retained for those old Google references.

Coordinates already existed as nullable six-decimal fields, so this map change
needs no new coordinate migration or database extension. The working tree also
contains earlier `geo.0002_address_place_coordinates`; it is preserved because
it was already applied locally. Its optional legacy area metadata is no longer
used to manufacture property markers.

Run the normal rollout commands from the repository root:

```powershell
docker compose run --rm --no-deps -T api python manage.py migrate --noinput
docker compose run --rm --no-deps -T api python manage.py refresh_listing_locations
```

The second command recomputes derived rental/sale points only; it never geocodes
or changes private coordinates/written addresses. `--resolve-places` no longer
exists. Locally migrations reported no pending work, the migration drift check
reported no changes, and the repair command updated zero records and reported
six rental records with no point. No coordinates were invented for them.

For legacy listings, an authorized provider should open the existing property's
setup/edit form, place the actual pin, and save. A verified property must first
use the existing permitted edit/reverification workflow. Its listing remains
in unbounded list search while unmapped; geographic bbox searches naturally
cannot include a record whose location is unknown.

## Verification results

Logs are in ignored `tmp/free-maps-*.log` files. Passed means the command was run.

| Check | Result |
|---|---|
| Full backend `docker compose run --rm --no-deps -T api pytest -q` | **2,157 passed**, 859 warnings |
| Final focused property-map/map-search/sale suite | **58 passed**, 53 warnings |
| Backend `ruff check --no-cache .` | Passed |
| Django `migrate --noinput` | No migrations to apply |
| Django `makemigrations --check --dry-run` | No changes detected |
| Web `npm test` | **524 passed** |
| Web `npm run lint` | Passed with 1 existing unused-variable warning |
| Web TypeScript / production build | Production build passed on final code, including its TypeScript check; separate typecheck also run |
| Mobile `npm test` | **452 passed**, including executable malformed/oversized/unknown-marker/invalid-pin/viewport/escaping bridge tests |
| Mobile `npm run typecheck` | Passed |
| Mobile `npm run lint` | Passed with 227 warnings in the existing app |
| Android/iOS `expo export` | Passed for both platforms on the final code, one Metro worker and a bounded Node heap |
| `npx expo-doctor --verbose` | **19/21 passed**; native-directory/app-config sync warning and three Expo patch mismatches |
| `npx expo install --check` | Reported `expo-camera` 57.0.5 → ~57.0.6, `expo-crypto` 57.0.3 → ~57.0.4, `expo-sharing` 57.0.23 → ~57.0.24; no unrelated updates applied |
| Remaining billable map calls | Scoped runtime-source search found no Google Maps/Places URLs, loaders, native map imports or map-key use in the changed application workflows |

Expo compatibility was checked against the installed versions and official
[SDK 57 WebView documentation](https://docs.expo.dev/versions/v57.0.0/sdk/webview/),
which includes WebView 13.16.1 in Expo Go. Leaflet is the stable 1.9.4 release
listed on its [official download page](https://leafletjs.com/download.html).
This establishes the supported implementation choice; it is not a claim that
a physical device was tested. The three unrelated patch recommendations and the
native-directory warning remain visible rather than suppressed.

The final mobile command, from `mobile`, was:

```powershell
$env:EXPO_PUBLIC_API_URL='https://api.danpahq.com/api/v1'
$env:NODE_OPTIONS='--max-old-space-size=1536'
npx expo export --platform android --platform ios --max-workers 1 --output-dir ../tmp/free-maps-mobile-export
```

An initial sandboxed export failed when Hermes could not write its temporary
output; the permitted retry succeeded. A later parallel build attempt hit host
resource problems (Node allocation failure and a stopped Docker web container).
The final mobile export ran by itself successfully; the existing web service
was restored. No dependency upgrade or source workaround was used for those
environment failures.

The final production web build passed, including TypeScript and static export:

```powershell
docker compose exec -T -e CIRCLE_NODE_TOTAL=2 -e NODE_OPTIONS=--max-old-space-size=1536 -e NEXT_PUBLIC_API_URL=https://api.danpahq.com/api/v1 web npm run build
```

One build worker avoided resource contention. External font downloads retried
and then completed. The initial Windows build had failed with an `EPERM` error
in the shared `.next` cache; the Linux container build completed successfully.

Browser checks actually performed: live Next.js rental list/map loaded OSM
tiles while reporting the unmapped listings; an isolated fixture using the exact
bundled mobile HTML rendered a price marker, pin and OSM attribution, sent the
selected marker key on click, and sent valid six-decimal pin coordinates on a
map tap. The fixture never modified application data. It exposed and verified
the corrected marker click target. Live development also exposed and verified
the Strict Mode cancellation fix. No physical Android/iOS device was attached;
authenticated provider UI saving, touch dragging and native WebView attribution
link handling still require the device/manual checks below. API tests cover
persistence, authorization and unchanged written address/price fields.
The final live browser check also submitted a deliberately unmatched keyword,
showed the map's Clear Filters action, cleared the query, and refreshed at
`/rentals?view=map` with the query still cleared. Attribution was present in the
live map's accessible UI. No provider account or real listing was changed for
these checks.

## Manual acceptance checks

1. Web: install from the lockfile with `npm ci` in `web`, start the existing
   Compose app, and visit `http://localhost:3000/rentals`. Switch List/Map; search
   written towns/keywords and change price/bedroom/type filters. Confirm no
   autocomplete/geocoder requests occur and attribution stays visible.
2. As an authorized provider, create a draft with a written address and no pin:
   the neutral map centre must not save coordinates. Select a point, save, reopen
   setup/edit, move the pin, save and reload. Check written address, city and
   price remain unchanged. Clear the pin and verify both values become null.
3. With an eligible published listing that has saved coordinates, select its
   marker and open the existing listing detail screen. Check the established
   privacy rounding rather than expecting a door-exact public marker. Check
   rental and sale listings; clusters/stacks and the existing marker cap still
   mean a zoomed-out map is not a literal one-marker-per-database-row view.
4. Search an empty area/filter combination; use Clear Filters, confirm the
   results return, and refresh. Explicitly search a visible map area, clear it,
   and confirm its `bbox` does not reappear after refreshing. Check Back/Forward
   and intended URL search state. Legacy listings without pins remain in the
   ordinary list and are described as unmapped.
5. Mobile: `cd mobile; npm ci; npx expo start --go --lan`. Use an Expo Go version
   supporting SDK 57; point the existing API configuration to an HTTPS service
   or a development LAN address reachable from the phone. `localhost` on the
   phone is not your computer. Phone authentication can be used in Expo Go;
   existing native Google Sign-In still requires an installed build.
6. Repeat create/edit, pin tap/drag/clear/reload, listing marker preview/details,
   guest browsing, sign-in prompt dismissal, filters, map-area search, no-result
   clearing, slow/offline tile behavior and visible attribution on Android and
   iOS. Confirm map overlays do not cover the credits. Test touch scrolling in
   the wizard and WebView link handling. No device-location permission should
   be requested by the map.
7. Before production traffic, select a tile host whose actual commercial quota
   covers measured tile requests, and verify current terms/attribution. Do not
   enable paid capacity or a billing account automatically.

