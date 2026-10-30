> The subsequent [free-first map migration](free-maps.md) supersedes this report’s Google/native-map and automatic locality-centre repair recommendations. Do not enable Google map keys or run `--resolve-places`; that option has been removed.

# Rental workflow fixes — 28 October 2026

## Changes and causes

| Area | Cause and change | Main files |
| --- | --- | --- |
| Withdrawal | Unit withdrawal sent immediately; property confirmation was inline. Added confirmation dialogs/sheets using existing UI components. | Web/mobile property lifecycle components and space screens |
| Creation dialogs | Shared dialog default allowed backdrop/Escape dismissal. Creation opts out, retains its X, and removes Cancel/Finish later dismissal buttons. Mobile creation routes disable swipe dismissal. | `web/src/components/workspace/ModalSheet.tsx`, property/unit wizards, mobile app layout |
| Validation | Clients displayed the API's generic summary despite structured field errors. Validation failures now name the affected fields while preserving structured details and explicit domain messages. | `backend/apps/core/exceptions.py` |
| Creation completion | Completing creation returned to Properties/property details. New-property entry points now open the existing submission page directly. | Web properties/new/setup routes; mobile private-property/setup routes |
| Unit submission | Backend already required the entire parent property to be verified and kept draft editing open. Wizards now require an explicit allowed capability; the parent-blocked UI no longer offers “Try sending anyway.” | Web/mobile unit wizards and space screens; existing backend gates retained |
| Review subject | Queue labels resolved properties but not spaces, causing a technical key to become the heading. Resolve unit label/type plus its parent property title. | `backend/apps/operations/views.py` |
| 36-month limit | Listing create/update serializers and the web advance stepper capped advances at 24, while agreement/application APIs already supported 36. Align listing APIs, inputs and search options to 36; keep deposit/agency limits separate. | Listing serializers; listing composer; mobile space/lease builder/search; web lease wizard/listing browser |
| Guest discovery | Two navigation guards allowed Explore but refused public listing/search routes. Both use one public-route policy. Protected tab presses and listing actions open a dismissible sign-in sheet before navigation. Dismissal leaves the browsing screen mounted. | Mobile navigation/root/tab layouts; `GuestSignIn.tsx`; listing/search/Saved controls |
| Missing markers | Address creation resolved a provider neighbourhood but discarded its centre. Persist its approximate centre separately from private property coordinates, and use it as a locality-precision public point. | Geo model/view/migration; listing location derivation |
| Map requests | A newer viewport response could discard the search summary needed to fit results; queued viewport requests could keep old filters. Preserve summary sequencing separately, refresh effect dependencies, and reset stale fit overrides. | Web `ExploreMapView.tsx`; mobile search |
| Empty/reset/URL | Empty map results did not always provide a clear action; clearing filters retained map narrowing. Add visible clearing and missing-location notices. `bbox` is retained only for explicit map URLs; stale/invalid boxes are removed from list URLs. | Web Explore/listing browsers/query helpers; mobile search |
| Android marker images | Android omitted every marker whose custom snapshot was not ready or failed. Keep a tappable platform pin at the same coordinate until its custom face is available; ignore snapshot callbacks after unmount. | `mobile/src/maps/DanpaHQMap.native.tsx` |

The former 24-month restriction was on **advance months**. Agreement term length already supports up to 120 months; that existing capability and the advance-policy warnings were preserved. No listing database constraint capped advances at 24, so that change needs no constraint migration.

No dependency manifests, lockfiles or native configuration were changed. The existing `.gitignore` edits were preserved. Changes are uncommitted.

## Validation

| Check | Command / result |
| --- | --- |
| Full backend suite | `docker compose exec -T api pytest -q` — **2152 passed**, 856 warnings; final log `tmp/rental-full-backend-tests.log` |
| Focused backend suite | Validation, Places, map search, management portal, property lifecycle/creation — 132 passed before adding the repair-command test; final full suite includes that test |
| Backend lint | `docker compose exec -T api ruff check --no-cache .` — passed |
| Migration drift | `docker compose exec -T api python manage.py makemigrations --check --dry-run` — no changes detected |
| Local migration | `docker compose exec -T api python manage.py migrate --noinput` — applied `geo.0002_address_place_coordinates` |
| Web tests | `npm test` in `web` — **524 passed** |
| Mobile tests | `npm test` in `mobile` — **447 passed** |
| Web TypeScript/lint | `npm run typecheck`; `npm run lint` — passed; lint has 1 warning |
| Mobile TypeScript/lint | `npm run typecheck`; `npm run lint` — passed; lint has 229 warnings |
| Web production export | `npm run build` with `NEXT_PUBLIC_API_URL=https://api.danpahq.com/api/v1` and `CIRCLE_NODE_TOTAL=3` — passed, 89 static pages; the worker setting limits Next to two workers |
| Android/iOS JS bundles | `npx expo export --platform android --platform ios --max-workers 1 --output-dir ../tmp/rental-mobile-export` with the CI `EXPO_PUBLIC_API_URL` — both exported; see `tmp/rental-mobile-export.log` |
| Android assembly | Attempted `:app:assembleDebug`. The capped JDK 17 run reached NitroModules C++ compilation, then Ninja failed: “The paging file is too small for this operation to complete.” **Not passed**. Log: `tmp/rental-android-assemble.log` |
| Physical Android / Expo Go | `adb devices` returned no connected devices. **Not run** |
| Native iOS | **Not run** on this Windows host |
| Browser | Public list loaded. An explicit empty map-area URL showed Clear Filters; clicking it removed `bbox`, displayed missing-location feedback, and refreshing retained the cleared URL. Automated query tests also cover stale list boxes and copied map URLs. |

New runtime tests exercise dialog Escape/backdrop/X behavior, guest sheet dismissal without navigation or losing the mounted listing, protected tab interception, query round trips/reset, field-specific messages, 36/37-month boundaries, unit labels, public neighbourhood points and idempotent repair. Existing source contracts were updated where requested behavior intentionally changed. Authenticated creation and withdrawal were covered by backend regression tests and component contracts, not a complete interactive browser journey.

Initial checks caught and corrected a unit-manager lookup mistake and a missing `session=None` argument in the new repair path. Earlier unrestricted builds exhausted memory; the web build also initially lacked its CI public API setting. The successful checks above use the stated settings. Existing warning totals were not suppressed.

## Existing data and deployment steps

1. Deploy the additive geo migration with the normal owner release (`python manage.py migrate --noinput`). It adds two nullable approximate-place fields and does not overwrite private coordinates.
2. For older addresses that saved a provider reference, run `python manage.py refresh_listing_locations --resolve-places`. This explicitly opts into provider lookups, accepts only areas inside configured coverage, and fills missing approximate centres. Existing centres are preserved. A repeated successful run makes no new lookup for those rows.
3. For older addresses with no provider reference and no coordinates, enter an authoritative locality centre or a real property location through existing administration, then run `python manage.py refresh_listing_locations`. Do not invent a marker position or substitute a district centre for a neighbourhood.
4. The local database currently has **six active rentals with no map point**. Their five addresses have no saved provider references; their locality centres are also missing. The repair command ran and updated zero rows. Those listings remain available in List, and the map now explains their missing location. Their individual marker locations remain unresolved until step 3 is completed.
5. Retry Android assembly after resolving local memory/paging pressure. The attempted capped command from `mobile/android` was `gradlew.bat :app:assembleDebug --no-daemon --max-workers=2 "-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m -XX:ActiveProcessorCount=2" --console=plain`, with `JAVA_HOME=C:\Program Files\Java\jdk-17`. No system settings were altered.
6. On a connected Android device and iPhone, test guest Explore → listing → Apply/View → dismiss/sign in; protected tabs; create property → submission; unit edits before parent approval; withdrawal confirm/cancel; 36 accepted/37 rejected; map tiles, custom/fallback pins, marker positions, pan/search/reset, and empty results. Repeat in an SDK-compatible Expo Go and an installed development/release build. JS export does not prove native runtime behavior.

## Official compatibility references

- [Expo SDK 57 react-native-maps documentation](https://docs.expo.dev/versions/v57.0.0/sdk/map-view/) recommends the installed **1.27.2**, includes it in Expo Go, and states that Expo Go testing needs no additional map setup. Installed Google Maps builds still require their native API-key setup. No package or native-key change was needed from this audit.
- [react-native-maps marker API](https://github.com/react-native-maps/react-native-maps/blob/master/docs/marker.md) documents local marker image resources and the default platform pin when no custom image/view is supplied. The fallback follows that contract; physical-device rendering remains unverified.
