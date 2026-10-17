import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

/** The text between two markers, so an assertion lands inside one function or rule. */
function between(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `marker not found: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to >= 0, `end marker not found after ${start}: ${end}`);
  return source.slice(from, to);
}

/** Every TypeScript and CSS source under a directory, as [repo-relative path, text]. */
function sources(directory) {
  const found = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|css)$/.test(name)) {
        found.push([relative(root, full).replaceAll("\\", "/"), readFileSync(full, "utf8")]);
      }
    }
  };
  walk(resolve(root, directory));
  return found;
}

test("the search lives in the address bar, and the list and the map ask it the same question", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const query = read("web/src/lib/exploreQuery.ts");

  // Read from the URL on every render, never copied into component state.
  assert.match(browser, /const params = useSearchParams\(\);/);
  assert.match(browser, /const query = useMemo\(\(\) => parseExploreQuery\(new URLSearchParams\(paramsKey\)\), \[paramsKey\]\);/);
  // One builder for the API parameters, handed to both views.
  assert.match(browser, /const search = useMemo\(\(\) => listingSearchParams\(query\)\.toString\(\), \[query\]\);/);
  assert.match(browser, /await searchListingsFor\(new URLSearchParams\(search\), controller\.signal\);/);
  assert.match(browser, /<ExploreMapView\s+query=\{query\}\s+search=\{search\}/);
  assert.match(view, /searchListingMap\(\s*new URLSearchParams\(search\),/);
  // Written back with the history API Next integrates with.
  const update = between(browser, "const update = useCallback(", "}, []);");
  assert.match(update, /parseExploreQuery\(new URLSearchParams\(window\.location\.search\)\)/);
  assert.match(update, /if \(mode === "push"\) window\.history\.pushState\(null, "", url\);/);
  assert.match(update, /else window\.history\.replaceState\(null, "", url\);/);
  // A copy of the entry's state carries Next's `__NA` mark, and Next lets a
  // marked write through without telling useSearchParams: the URL moved, the
  // page did not.
  assert.doesNotMatch(update, /history\.state/);

  // A chosen place travels whole — name, box and provenance — and its box is
  // what both views search, so restoring or sharing a search resolves nothing.
  assert.match(query, /params\.set\("area", formatBounds\(query\.area\.bounds\)\);/);
  assert.match(query, /const box = query\.bbox \?\? query\.area\?\.bounds \?\? null;/);
  assert.doesNotMatch(browser, /resolvePlace|getPlace/);

  // The map keeps no filter of its own to drift from the search.
  assert.doesNotMatch(view, /\bset(Rent|Property|Space|Bedroom|Furnish|Advance|Sort|Place|Area|Bbox|Query)\w*/);
  assert.doesNotMatch(view, /useState[^;\n]*\bquery\./);
  // useSearchParams in a statically rendered page needs a Suspense boundary.
  const page = read("web/app/rentals/page.tsx");
  // Both chromes host `Explore`, which reads `mode` and hands Rent to the
  // listing browser and Buy to the sale browser — inside that same boundary.
  assert.equal(page.match(/<Suspense fallback=\{<ExploreFallback \/>\}>\s*<Explore \/>/g)?.length, 2);
  // Explore opens on All; the console’s Show chip chooses Rent or Buy (owner, 2026-10-05).
  assert.match(page, /if \(asked === "buy"\) return <SaleBrowser \/>;/);
  assert.match(page, /if \(asked === "rent"\) return <ListingBrowser \/>;/);
  assert.match(page, /return <AllBrowser \/>;/);
});

test("the map is a view of the search: opening, closing and failing never clear it", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const places = read("web/src/components/explore/PlaceSearch.tsx");

  // Choosing a place opens the map on it, pushed so Back returns to the list.
  const choose = between(browser, "function choosePlace(place: ResolvedPlace) {", "\n  }");
  assert.match(choose, /const area = \{ name: place\.display_name, bounds: place\.bounds, ref: `\$\{place\.provider\}:\$\{place\.reference\}` \};/);
  assert.match(choose, /update\(\{ \.\.\.NO_LOCATION, area, view: "map" \}, query\.view === "map" \? "replace" : "push"\);/);
  // Opening the map is pushed; returning to the list changes the view and nothing else.
  assert.match(browser, /function showMap\(\) \{ update\(\{ view: "map" \}, "push"\); \}/);
  assert.match(browser, /function showList\(\) \{ update\(\{ view: "list" \}\); \}/);
  // A failed request keeps the last results rather than emptying the page.
  const fetchResults = between(browser, "const page = await searchListingsFor(", "}, 250);");
  assert.match(fetchResults, /setListings\(\(current\) => current \?\? \[\]\);/);
  assert.doesNotMatch(fetchResults, /setListings\(\[\]\)/);
  // The field puts back what is actually searched when left without a choice.
  assert.match(places, /if \(editing && !resolving\) setDraft\(committed\);/);
});

test("one control per width moves between the list and the map, and says where it goes", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const mapCss = read("web/src/styles/explore-map.css");
  const phone = between(mapCss, "@media (max-width: 63.999rem) {", "\n}");

  // Wide screens: Map ends the search pill (MapToggle). Phones: one floating
  // switch. Both are named for where they go, and the map keeps no way out of
  // its own.
  assert.match(browser, /map=\{<MapToggle mapView=\{mapView\} onToggle=\{mapView \? showList : showMap\} \/>\}/);
  // One row: search, chips, then Map (owner, 2026-10-05).
  assert.match(read("web/src/components/explore/ExploreConsole.tsx"), /<div className="explore-bar">\{search\}<\/div>\s*<div className="ec-chips">\{chips\}<\/div>\s*\{map\}/);
  assert.doesNotMatch(between(browser, 'className="explore-feedback"', "\n  const notices"), /className="explore-map-toggle"/);
  assert.equal(browser.match(/className="explore-view-switch"/g)?.length, 1);
  assert.match(browser, /<button type="button" className="explore-view-switch" onClick=\{mapView \? showList : showMap\}>/);
  // Its own prop, not the preview's `onClose`, which closes a preview.
  assert.doesNotMatch(view, /onClose: \(\) => void|explore-map-close|explore-view-switch|setPane/);
  assert.match(between(mapCss, ".explore-view-switch {", "}"), /display: none;/);
  assert.match(phone, /\.explore-view-switch \{ display: inline-flex; \}/);
  assert.match(phone, /\.explore-map-toggle \{ display: none; \}/);
  // A phone has no list beside the map to switch within.
  assert.match(phone, /\.explore-map-results \{ display: none; \}/);
});

test("an area drawn on the map is shown, and removable, wherever it narrows the rentals", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const query = read("web/src/lib/exploreQuery.ts");

  // One chip, in the controls both views share, so the list says so too.
  const controls = between(browser, "function discovery(): ReactNode {", "\n  const notices");
  assert.match(controls, /\{query\.bbox \? \(\s*<button\s+type="button"\s+className="explore-chip explore-area-chip"/);
  assert.match(controls, /onClick=\{\(\) => \{ update\(\{ bbox: null \}\); advancedTrigger\.current\?\.focus\(\); \}\}/);
  assert.doesNotMatch(view, /Map area|onClearArea/);
  // Where, not a filter: Clear all keeps the map area and the chosen place.
  const clear = between(query, "export function withoutFilters(", "\n}");
  assert.match(clear, /bbox: query\.bbox,/);
  assert.match(clear, /area: query\.area,/);
});

test("an older request can never overwrite a newer answer", () => {
  const api = read("web/src/lib/api.ts");
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const places = read("web/src/components/explore/PlaceSearch.tsx");

  // apiFetch follows the caller's signal, and an abort is final: no retry.
  assert.match(api, /caller\?\.addEventListener\("abort", follow, \{ once: true \}\);/);
  assert.match(api, /caller\?\.removeEventListener\("abort", follow\);/);
  const retryCatch = between(api, "} catch (cause) {", "if (!(cause instanceof ApiFailure)) {");
  assert.match(retryCatch, /if \(caller\?\.aborted\) throw aborted\(id\);/);

  // Markers: every response is checked against the newest request id.
  const markers = between(view, "const fetchMarkers = useCallback(", "}, [search]);");
  assert.match(markers, /if \(id !== markerRequest\.current\) return;/);
  assert.match(markers, /if \(isAborted\(cause\) \|\| id !== markerRequest\.current\) return;/);
  // A pan only redraws the window; the count belongs to the search.
  assert.match(view, /controller = fetchMarkers\(view, false\);/);
  assert.match(view, /const controller = fetchMarkers\(viewRef\.current, true\);/);
  // Suggestions: the next keystroke withdraws the last request.
  assert.match(places, /suggestPlaces\(typed, session\.current, controller\.signal\)/);
  assert.match(places, /window\.clearTimeout\(timer\);\s*controller\.abort\(\);/);
  // Choosing again withdraws a resolve still on its way.
  assert.match(places, /choosing\.current\?\.abort\(\);\s*const controller = new AbortController\(\);/);
});

test("one search is one Places session, spent by the place it chooses", () => {
  const places = read("web/src/components/explore/PlaceSearch.tsx");
  const lib = read("web/src/lib/places.ts");

  // Made with the first request and carried by every one after it.
  assert.match(places, /session\.current \?\?= newPlacesSession\(\);/);
  // Resolving the choice carries the same token, and spends it.
  const choose = between(places, "async function choose(row: PlaceSuggestion) {", "\n  }\n");
  assert.match(choose, /await resolvePlace\(row, session\.current, controller\.signal\);/);
  assert.match(choose, /session\.current = null;/);
  // Nothing is typed into the field on the way: new text would ask for suggestions again.
  assert.doesNotMatch(between(places, "function commit(place: ResolvedPlace) {", "\n  }\n"), /setDraft\(/);
  // Searching the text instead ends the session too.
  assert.match(between(places, "function submit() {", "\n  }\n"), /session\.current = null;/);
  // A recent place skips the provider, and keeps its coordinates thirty days at most.
  assert.match(places, /const RECENT_MAX_AGE_MS = 30 \* 24 \* 60 \* 60 \* 1000;/);
  assert.match(places, /choose: \(\) => commit\(place\),/);
  // The client asks Danpa HQ, never a Places endpoint, and holds no Places key.
  assert.match(lib, /`\/geo\/places\/suggest\/\?\$\{params\.toString\(\)\}`/);
  assert.match(lib, /`\/geo\/places\/resolve\/\?\$\{params\.toString\(\)\}`/);
  assert.doesNotMatch(lib + places, /places\.googleapis|X-Goog|GOOGLE_MAPS/);
  // Google's suggestions, shown where there may be no Google map, carry its name.
  assert.match(places, /attribution === "google"/);
});

test("a marker previews a rental; only the preview leaves the map", () => {
  const map = read("web/src/components/explore/ExploreMap.tsx");
  const google = read("web/src/lib/maps/google/map.ts");
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const preview = read("web/src/components/explore/MapListingPreview.tsx");

  // A marker with a click is named and keyboard-reachable; the provider decides how.
  assert.match(map, /title: describe\(feature\),\s*onClick: \(\) => \{/);
  assert.match(google, /gmpClickable: Boolean\(onClick\),/);
  assert.match(google, /collisionBehavior: marker\.CollisionBehavior\.REQUIRED,/);
  assert.match(google, /pin\.addEventListener\("gmp-click", \(\) => onClick\(\)\);/);
  for (const state of ["is-selected", "is-hovered", "is-visited"]) {
    assert.match(map, new RegExp(`element\\.classList\\.toggle\\("${state}", `));
  }
  assert.match(map, /entry\.marker\.setPressed\(selected\);/);
  // Selecting sets a selection; it never navigates.
  const select = between(view, "function selectListing(feature: MapListingFeature) {", "\n  }");
  assert.match(select, /setSelection\(\{ key: `listing:\$\{feature\.id\}`, ids: \[feature\.id\]/);
  assert.doesNotMatch(view, /useRouter|router\.push|<Link\b/);
  // A stack of listings on one point pages in the preview instead of zooming.
  const cluster = between(view, "function selectCluster(feature: MapClusterFeature) {", "\n  }");
  assert.match(cluster, /if \(feature\.stacked && feature\.ids\?\.length\) \{/);
  // The preview is where the listing opens.
  assert.match(preview, /<Link href=\{href\} className="explore-preview-link" onClick=\{\(\) => onOpen\(listing\)\}>/);
  // A tap on a marker, or on the preview drawn as one, is not a tap on the map.
  assert.match(google, /target\.closest\("gmp-advanced-marker"\)/);
});

test("the map searches a new area only when asked", () => {
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const map = read("web/src/components/explore/ExploreMap.tsx");

  assert.equal(view.match(/onSearchArea\(/g)?.length, 1);
  assert.match(between(view, "function searchThisArea() {", "\n  }"), /onSearchArea\(bounds\);/);
  assert.match(view, /onSearchArea=\{searchThisArea\}/);
  assert.match(map, /aria-label="Search this map area"/);
  assert.match(map, /disabled=\{!canSearchArea \|\| searchingArea\}/);
  // Offered only once the tenant has moved the map beyond what was searched.
  assert.match(view, /const showSearchArea = Boolean\(userMoved && view && \(!searched \|\| outgrewSearch\(view\.bounds, searched\)\)\);/);
});

test("the map's floating rail changes the view without obscuring the results", () => {
  const map = read("web/src/components/explore/ExploreMap.tsx");
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const types = read("web/src/lib/maps/types.ts");
  const google = read("web/src/lib/maps/google/map.ts");
  const css = read("web/src/styles/explore-map.css");

  assert.match(map, /role="toolbar" aria-label="Map view controls"/);
  assert.equal(map.match(/className="explore-map-tool"/g)?.length, 3);
  assert.match(map, /className=\{`explore-map-tool\$\{canSearchArea/);
  for (const label of ["Satellite view", "Street View", "Search this area", "Recenter results"]) {
    assert.match(map, new RegExp(label));
  }
  assert.match(types, /setBaseMap\(style: BaseMapStyle\): void;/);
  assert.match(types, /setStreetView\(visible: boolean\): void;/);
  assert.match(google, /maps\.MapTypeId\.HYBRID/);
  assert.match(google, /panorama\.setVisible\(visible\);/);
  assert.match(view, /padding=\{narrow \? \{ top: 64, right: 76,/);
  assert.match(between(css, ".explore-map-tool {", "}"), /backdrop-filter: blur\(12px\)/);
});

test("a card's address opens that rental's location, drawn only as the backend publishes it", () => {
  const card = read("web/src/components/listings/ListingCard.tsx");
  const location = read("web/src/components/listings/ListingLocation.tsx");
  const locationMap = read("web/src/components/listings/ListingLocationMap.tsx");
  const map = read("web/src/components/explore/ExploreMap.tsx");
  const detail = read("web/app/listings/[id]/page.tsx");

  assert.match(card, /const locationHref = `\/listings\/\$\{listing\.id\}#location` as never;/);
  assert.match(between(card, 'className="listing-card-where"', "</p>"), /href=\{locationHref\}/);
  // A real section identifier, reached again once the client-rendered page exists.
  assert.match(location, /id="location"/);
  // Instant: the site scrolls smoothly, and a smooth scroll does not move a tab
  // that is not being shown — a card opened in the background arrived at the top.
  assert.match(location, /if \(window\.location\.hash !== "#location"\) return;[\s\S]{0,240}section\.current\?\.scrollIntoView\(\{ block: "start", behavior: "instant" \}\);/);
  assert.match(detail, /<ListingLocation listing=\{listing\} where=\{where\} landmark=\{place\.landmark\} \/>/);
  // The approximate public point is the only coordinate a map draws.
  assert.match(location, /const location = listing\.public_location;/);
  // An area, in a page that scrolls: the map waits for a deliberate gesture.
  assert.match(locationMap, /gestures: "cooperative",/);
  assert.match(locationMap, /map\.addArea\(\{/);
  // Uses, not mentions: the section's comment names the street it withholds.
  for (const source of [location, locationMap, map]) {
    assert.doesNotMatch(source, /map_latitude|map_longitude|\.address\b|\.street\b|house_number|digital_address/);
  }
});

test("Google stays behind Danpa HQ's map interface while development has a keyless preview", () => {
  // Only the provider's folder knows Google exists; everything else draws through `@/lib/maps`.
  for (const [path, text] of [...sources("web/src"), ...sources("web/app")]) {
    assert.doesNotMatch(text, /maplibre|pmtiles|protomaps/i, `${path} still mentions the old basemap`);
    if (path.startsWith("web/src/lib/maps/google/")) continue;
    assert.doesNotMatch(
      text,
      /@googlemaps\/|google\.maps\b|gmp-advanced-marker|NEXT_PUBLIC_GOOGLE/,
      `${path} reaches past the map interface`,
    );
  }
  assert.doesNotMatch(read("web/package.json"), /maplibre|pmtiles|protomaps/);

  const config = read("web/src/lib/maps/google/config.ts");
  const loader = read("web/src/lib/maps/google/loader.ts");
  const google = read("web/src/lib/maps/google/map.ts");
  const facade = read("web/src/lib/maps/index.ts");
  const preview = read("web/src/lib/maps/preview/map.ts");
  // A browser key and a map ID from the build. Production without a map ID has
  // no map rather than an unstyled one; development borrows Google's demo ID.
  assert.match(config, /process\.env\.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/);
  assert.match(config, /process\.env\.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID \|\|\s*\(process\.env\.NODE_ENV === "production" \? "" : "DEMO_MAP_ID"\)/);
  assert.match(google, /mapId: GOOGLE_MAPS_MAP_ID,/);
  // No key: the Google loader makes no request. In development only, the map
  // facade selects the keyless preview; production still requires Google.
  assert.match(loader, /if \(!googleMapsConfigured\(\)\) return Promise\.reject\(new MapUnavailable\("not_configured"\)\);/);
  assert.match(loader, /setOptions\(\{ key: GOOGLE_MAPS_KEY, v: "weekly", language: "en", region: "GH" \}\);/);
  assert.match(facade, /process\.env\.NODE_ENV === "development" && !googleMapsConfigured\(\)/);
  assert.match(facade, /return googleMapsConfigured\(\) \|\| previewAvailable\(\);/);
  assert.match(facade, /previewAvailable\(\) \? createPreviewMap\(container, options\) : createGoogleMap\(container, options\)/);
  assert.match(preview, /https:\/\/tile\.openstreetmap\.org/);
  assert.match(preview, /OpenStreetMap contributors/);
  assert.match(preview, /const wanted = new Set<string>\(\);/);
  // A refused key is said in words, not left as a darkened map.
  assert.match(loader, /window\.gm_authFailure = \(\) => \{/);
  assert.match(read("web/src/components/explore/ExploreMap.tsx"), /unsubscribe\.push\(onMapRefused\(fail\)\);/);
  assert.match(read("web/src/components/explore/ExploreMapView.tsx"), /const mapAvailable = mapsConfigured\(\);/);
  // A developer is told which setting would draw the map, so a missing key never
  // passes for a map that stopped updating; production builds never say it.
  assert.match(config, /if \(process\.env\.NODE_ENV === "production" \|\| googleMapsConfigured\(\)\) return null;/);
  assert.match(read("web/src/components/explore/ExploreMapView.tsx"), /\{setupHint \? <span>\{setupHint\}<\/span> : null\}/);
  assert.match(read("web/src/components/listings/ListingLocationMap.tsx"), /const hint = state === "unavailable" \? mapSetupHint\(\) : null;/);
  // Points of interest would open Google's own cards; on Danpa HQ a tap means a rental.
  assert.match(google, /clickableIcons: false,/);
  // The browser key never meets Places: suggestions go through Danpa HQ's API.
  assert.doesNotMatch(loader + google, /importLibrary\("places"\)/);
});

test("markers keep their own styling, and the map stays inside the page", () => {
  const mapCss = read("web/src/styles/explore-map.css");
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const view = read("web/src/components/explore/ExploreMapView.tsx");

  // The provider positions a wrapper around each marker; emphasis never replaces a transform.
  const markerRules = between(mapCss, ".explore-price-marker {", ".explore-cluster-marker {");
  assert.doesNotMatch(markerRules, /\btransform:/);
  assert.match(between(mapCss, ".explore-price-marker.is-selected {", "}"), /scale: 1\.1;/);
  assert.match(mapCss, /\.explore-price-marker\.is-visited \{/);
  assert.match(mapCss, /\.explore-price-marker:hover,\s*\.explore-price-marker\.is-hovered \{/);

  // The map takes the list's place, under the site header and the search. It
  // first shipped as a layer over the whole page — portalled, fixed, and
  // locking the page's scroll — which read as leaving Explore.
  assert.match(browser, /\{mapView \? \(\s*<ExploreMapView/);
  assert.doesNotMatch(view, /createPortal|document\.body|documentElement\.style\.overflow/);
  assert.doesNotMatch(between(mapCss, ".explore-map-view {", "}"), /position: fixed/);
  // The search sticks under the site's header once scrolled past, on a band of
  // the page's ground; the map sticks beneath the search, whose height the page
  // measures. The portal's header is shorter than the public site's.
  const workspaceCss = read("web/src/styles/explore-workspace.css");
  const stick = between(workspaceCss, ".explore-stick {", "}");
  assert.match(stick, /position: sticky;/);
  assert.match(stick, /top: var\(--explore-stick-top\);/);
  assert.match(browser, /<div ref=\{stickRef\} className=\{`explore-stick\$\{stuck \? " is-stuck" : ""\}`\}>\s*\{discovery\(\)\}/);
  assert.match(workspaceCss, /\.explore-stick\.is-stuck::before,\s*\.explore-stick\.is-stuck::after \{ opacity: 1; \}/);
  // Filters opened from the stuck search stay pinned under it, so the panel is
  // sized to that room or its actions sit past the bottom of a short window.
  assert.match(between(workspaceCss, ".explore-advanced {", "}"), /max-height: min\(46rem, calc\(100dvh - var\(--explore-stick-top\) - var\(--space-4\) - var\(--explore-bar-height\) - var\(--space-2\) - var\(--space-4\)\)\);/);
  assert.match(browser, /explore\.style\.setProperty\("--explore-tray-height", `\$\{Math\.ceil\(stick\.getBoundingClientRect\(\)\.height\)\}px`\)/);
  assert.match(mapCss, /--explore-sticky-top: calc\(var\(--explore-stick-top\) \+ var\(--explore-tray-height, 9\.25rem\) \+ var\(--space-3\)\);/);
  assert.match(between(mapCss, ".portal .explore {", "}"), /--explore-stick-top: calc\(4rem \+ var\(--space-3\)\);/);
  // On Explore itself the page headers scroll away and the console pins at the
  // very top, overriding that offset (owner, 2026-09-29).
  const hero = read("web/src/styles/explore-hero.css");
  assert.match(hero, /\.portal:has\(\.explore-portal-masthead\) \.portal-header \{ position: relative; \}/);
  assert.match(hero, /\.portal \.explore \{ --explore-stick-top: 0px; \}/);
  const stage = between(mapCss, ".explore-map-stage {", "}");
  assert.match(stage, /position: sticky;/);
  assert.match(stage, /top: var\(--explore-sticky-top\);/);
  // The map's own layers stay inside it, beneath the stuck search.
  assert.match(stage, /isolation: isolate;/);
  // Opening the map brings the search to where it sticks, rather than leaving
  // the map below the page's introduction. Arrival jumps: a smooth scroll does
  // not move a hidden tab. A search already stuck stays where it is.
  assert.match(browser, /if \(distance <= 8\) return;\s*window\.scrollTo\(\{ top: window\.scrollY \+ distance, behavior: arriving \? "instant" : "smooth" \}\);/);
});

test("the backend answers the list and the map from one filtered search", () => {
  const views = read("backend/apps/listing/views.py");
  const serializers = read("backend/apps/listing/serializers.py");
  const search = read("backend/apps/listing/search.py");

  assert.match(between(views, "class ListingSearchView(APIView):", "class ListingMapView(APIView):"), /search\.filtered_listings\(data, area\)/);
  assert.match(between(views, "class ListingMapView(APIView):", "class ListingDetailView(APIView):"), /search\.filtered_listings\(data, area\)/);
  // The area is the box the client sends; the search never looks a place up.
  assert.doesNotMatch(search, /from apps\.geo|providers/);
  // Cards publish the approximate point, never the address's coordinates.
  assert.match(between(serializers, "def get_public_location(self, obj)", "def _card_media_items"), /return public_location_payload\(obj\)/);
});
