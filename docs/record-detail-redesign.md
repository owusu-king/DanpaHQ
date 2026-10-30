# Property and Unit detail redesign and mobile map correction

## Implemented

Property and Unit records now share a compact header, media/action composition,
section headings, metadata treatment, and related-unit rows on web and native.
The image sits beside the workflow on wider layouts and stacks above it when
space is limited. Web container queries use the width left after the sidebar;
viewport-only breakpoints had left tablet actions and addresses cramped.

The web gallery retains image enlargement and small thumbnail selection. Its
selected image, counter, and active thumbnail remain consistent if an image is
removed. Empty media has a compact fallback. Native Unit photos still open the
existing photo sheet. Specifications, descriptions, amenities, access controls,
verification, tenancy links, and permission-controlled destructive actions remain
available. Routine verification explanations use concise text instead of large
status banners. Verified Unit photos are shown in the gallery once; the separate
photo editor appears only when editing is permitted. Land sales omit the redundant
one-field overview and retain their location, description, verification and sale actions. Publication and re-check actions are visually separated;
withdrawal and re-check confirmations use the existing compact modal component.

Verification, publication, and availability are displayed separately. An inactive
or suspended advertisement does not qualify for a public label; expired offers
are not labelled available. The existing verification/publication backend rules
remain authoritative. Verified Property details and pins remain locked.

Signing back in from a record previously retained only its pathname, losing the
property/unit query identifiers. PortalGate now preserves those query parameters
and places the search-parameter reader inside a Suspense boundary. A regression
test exercises the actual component's return destination.

## Mobile map findings

1. Listing markers had an anchor translation on both the wrapper and its child.
   They now have one anchor transform. The property pin uses a fixed-size SVG,
   with a higher stacking offset so it remains visible above listing labels.
2. A ready Boolean alone did not replay current state reliably after a WebView
   reload. The initial HTML now contains the current markers/pin, and both ready
   messages and load completion replay the latest validated payload. Native URL
   normalization of the local document root is accepted; foreign documents and
   paths are rejected.
3. `invalidateSize({pan:false})` changed the geographic center when the map was
   resized. This was reproduced with the real bundled Leaflet document: a pin
   stayed at pixel (640,360) after resizing to a 390x844 viewport, putting it off
   screen. Center-preserving invalidation fixes both the native HTML and the web
   adapter. The corrected pin tip measured exactly (195,422) on phone and
   (384,512) on tablet, matching each map's geographic center.
4. Bounds fitting waits for nonzero layout and clamps overlay insets. Updating a
   pin retains its marker and respects disabled dragging. Temporary tile errors
   no longer fail the map before the existing timeout can allow recovery.

Property and Unit native details show a read-only map when saved Property
coordinates exist. Units inherit their parent's location. Creation retains its
existing automatic locality pin and optional pre-verification refinement.
Saved coordinates were not moved or backfilled by this task.

Maintainer references checked:

- [React Native WebView guide](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md)
- [React Native WebView reference](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md)

## Primary files

- Web: `src/components/property/RecordDetail.tsx`, `app/record/property/page.tsx`,
  `app/record/space/page.tsx`, `src/styles/property-detail.css`,
  `src/components/property/SpacePhotos.tsx`,
  `src/components/property/WorkspacePatterns.tsx`,
  `src/components/portal/PortalGate.tsx`, and `src/lib/maps/leaflet/map.ts`.
- Mobile: `src/components/property/RecordDetail.tsx`,
  `app/(app)/provider-property.tsx`, `app/(app)/space.tsx`,
  `src/components/property/LocationPicker.tsx`,
  `src/components/property/SpacePhotos.tsx`,
  `src/components/property/WorkspacePatterns.tsx`, `src/provider.ts`,
  `src/maps/LeafletView.tsx`, and `src/maps/leafletHtml.ts`.
- Regression coverage: `web/src/lib/recordDetail.test.mjs`,
  `mobile/src/mobileMapRendering.test.mjs`, and updated layout contract tests.

## Validation

Commands are run from the indicated client directory, or repository root for Docker.

| Check | Command | Result |
| --- | --- | --- |
| Web tests | `npm test` | 534 passed |
| Mobile tests | `npm test` | 461 passed |
| Web types | `npm run typecheck` | Passed |
| Mobile types | `npm run typecheck` | Passed |
| Web lint | `npm run lint` | Passed; 0 errors, 1 existing warning |
| Mobile lint | `npm run lint` | Passed; 0 errors, 226 existing warnings; changed implementation files also checked separately |
| Unit lifecycle integration | `docker compose exec -T api pytest -q tests/integration/test_unit_flow.py` | 79 passed; 30 existing staticfiles warnings |
| Web production build | See below | Passed |
| Android/iOS JavaScript export | See below | Passed |

```powershell
docker compose exec -T -e CIRCLE_NODE_TOTAL=2 -e NODE_OPTIONS=--max-old-space-size=1536 -e NEXT_PUBLIC_API_URL=https://api.danpahq.com/api/v1 web npm run build

# In mobile/, using the installed dependencies:
$env:EXPO_PUBLIC_API_URL='https://api.danpahq.com/api/v1'
$env:NODE_OPTIONS='--max-old-space-size=1536'
npx expo export --platform android --platform ios --max-workers 1 --output-dir ../tmp/record-redesign-mobile-export
```

The first sandboxed mobile export failed because Hermes could not write its
temporary bytecode file. Repeating it with filesystem access succeeded for both
platforms. Web builds also encountered transient TLS retries and then completed.
Detailed command logs are under ignored `tmp/record-redesign-*` files.

Browser inspection covered actual signed-in Property/Unit records, public and
private verified units, draft and sale properties, empty optional amenities,
one/three-photo galleries, and responsive phone/tablet/desktop layouts. The
withdrawal confirmation, image viewer, and publication composer were opened and
cancelled. No records were submitted, published, withdrawn, or deleted during
visual QA. Missing-media and long-title inputs also have component-level coverage.
Screenshots are saved as ignored `tmp/record-property-desktop.jpg` and
`tmp/record-unit-phone.jpg`. The real bundled mobile Leaflet HTML was checked in an isolated local browser
document, including resizing and clearing/restoring markers and the pin.

## Remaining device checks

JavaScript exports and browser rendering are not native APK/IPA builds or proof
of physical-device WebView behavior. Android/iOS/Expo Go device checks remain:

1. Create an unsaved Property, select a locality, and verify the approximate pin;
   refine it, rotate the device, and check that it stays at the selected point.
2. Reopen a saved Property and Unit, confirm the inherited location, and confirm
   verified pins cannot be moved.
3. Open Explore, check rental and sale markers, change map area/filters, clear
   filters, and test reload/background-resume behavior.
4. Check native detail layouts with long names and larger accessibility text.

Legacy records without coordinates still cannot have a geographic marker, and
incorrect stored coordinates cannot be corrected safely by moving a verified
pin automatically. No application dependencies, native configuration, or saved
Property/Unit data were changed for this redesign.
