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
  assert.match(places, /setDraft\(committed\)/);
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
  assert.match(read("web/src/components/explore/ExploreConsole.tsx"), /ec-chip-options/);
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
  assert.match(clear, /bbox: null,/);
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
  assert.doesNotMatch(places, /suggestPlaces|resolvePlace|newPlacesSession/);
});

test("property searches submit text to our database without place lookups", () => {
  const places = read("web/src/components/explore/PlaceSearch.tsx");
  assert.match(places, /onSubmitText\(row\.name\)/);
  assert.match(read("web/src/components/property/LocationAutocomplete.tsx"), /event\.key === "Enter"/);
  assert.doesNotMatch(places, /suggestPlaces|resolvePlace|newPlacesSession|googleapis/);
});

test("a marker previews a rental; only the preview leaves the map", () => {
  const map = read("web/src/components/explore/ExploreMap.tsx");
  const google = read("web/src/lib/maps/leaflet/map.ts");
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const preview = read("web/src/components/explore/MapListingPreview.tsx");

  // A marker with a click is named and keyboard-reachable; the provider decides how.
  assert.match(map, /title: describe\(feature\),\s*onClick: \(\) => \{/);
  assert.match(google, /keyboard: Boolean\(onClick\)/);
  assert.match(google, /marker\.on\("click", onClick\)/);
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
  assert.match(google, /bubblingMouseEvents: false/);
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
  const google = read("web/src/lib/maps/leaflet/map.ts");
  const css = read("web/src/styles/explore-map.css");

  assert.match(map, /role="toolbar" aria-label="Map view controls"/);
  assert.equal(map.match(/className="explore-map-tool"/g)?.length, 3);
  assert.match(map, /className=\{`explore-map-tool\$\{canSearchArea/);
  for (const label of ["Satellite view", "Street View", "Search this area", "Recenter results"]) {
    assert.match(map, new RegExp(label));
  }
  assert.match(types, /setBaseMap\(style: BaseMapStyle\): void;/);
  assert.match(types, /setStreetView\(visible: boolean\): void;/);
  assert.match(google, /capabilities: \{ satellite: false, streetView: false \}/);
  assert.match(view, /padding=\{narrow \? \{ top: 64, right: 76,/);
  assert.match(between(css, ".explore-map-tool {", "}"), /backdrop-filter: blur\(12px\)/);
});

test("a card's address opens that rental's location, drawn only as the backend publishes it", () => {
  const card = read("web/src/components/listings/ListingCard.tsx");
  const location = read("web/src/components/listings/ListingLocation.tsx");
  const locationMap = read("web/src/components/listings/ListingLocationMap.tsx");
  const map = read("web/src/components/explore/ExploreMap.tsx");
  const detail = read("web/app/record/listing/page.tsx");

  assert.match(card, /const locationHref = `\/record\/listing\?id=\$\{listing\.id\}#location` as never;/);
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

test("Leaflet is a configurable browser-only adapter without Google map dependencies", () => {
  for (const [path, text] of [...sources("web/src"), ...sources("web/app")]) {
    if (path === "web/src/components/auth/GoogleIdentityButton.tsx") continue;
    assert.doesNotMatch(text, /@googlemaps\/|google\.maps\b|gmp-advanced-marker|NEXT_PUBLIC_GOOGLE_MAPS/, path);
  }
  const facade = read("web/src/lib/maps/index.ts");
  const leaflet = read("web/src/lib/maps/leaflet/map.ts");
  const tiles = read("web/src/lib/maps/tiles.ts");
  assert.match(facade, /await import\("\.\/leaflet\/map"\)/);
  assert.match(leaflet, /await import\("leaflet"\)/);
  assert.match(leaflet, /updateWhenIdle: true/);
  assert.match(leaflet, /keepBuffer: 1/);
  assert.match(leaflet, /credit\.textContent = tileConfig\.attribution/);
  assert.match(tiles, /NEXT_PUBLIC_MAP_TILE_URL/);
  assert.doesNotMatch(read("web/package.json"), /@googlemaps|@types\/google/);
});
