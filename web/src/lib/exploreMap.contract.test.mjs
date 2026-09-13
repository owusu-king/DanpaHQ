import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

/** The text between two markers, so an assertion lands inside one function or rule. */
function between(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `marker not found: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to >= 0, `end marker not found after ${start}: ${end}`);
  return source.slice(from, to);
}

test("the search lives in the address bar, and the list and the map ask it the same question", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const view = read("web/src/components/explore/ExploreMapView.tsx");

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

  // The map keeps no filter of its own to drift from the search.
  assert.doesNotMatch(view, /\bset(Rent|Property|Space|Bedroom|Furnish|Advance|Sort|Place|Bbox|Query)\w*/);
  assert.doesNotMatch(view, /useState[^;\n]*\bquery\./);
  // useSearchParams in a statically rendered page needs a Suspense boundary.
  const page = read("web/app/rentals/page.tsx");
  assert.equal(page.match(/<Suspense fallback=\{<ExploreFallback \/>\}>\s*<ListingBrowser \/>/g)?.length, 2);
});

test("the map is a view of the search: opening, closing and failing never clear it", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const places = read("web/src/components/explore/PlaceSearch.tsx");

  // Choosing a place opens the map on it, pushed so Back returns to the list.
  const choose = between(browser, "function choosePlace(row: Place) {", "\n  }");
  assert.match(choose, /update\(\{ \.\.\.NO_LOCATION, place: row\.slug, view: "map" \}, query\.view === "map" \? "replace" : "push"\);/);
  // Closing changes the view and nothing else.
  assert.match(browser, /onClose=\{\(\) => update\(\{ view: "list" \}\)\}/);
  // A failed request keeps the last results rather than emptying the page.
  const fetchResults = between(browser, "const page = await searchListingsFor(", "}, 250);");
  assert.match(fetchResults, /setListings\(\(current\) => current \?\? \[\]\);/);
  assert.doesNotMatch(fetchResults, /setListings\(\[\]\)/);
  // The field puts back what is actually searched when left without a choice.
  assert.match(places, /if \(editing\) setDraft\(committed\);/);
});

test("on a phone one switch moves between the list and the map, and nothing else does", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const mapCss = read("web/src/styles/explore-map.css");
  const phone = between(mapCss, "@media (max-width: 63.999rem) {", "\n}");

  // The map's switch leaves for the list page. There is no list inside the map
  // to switch to, and no second way out in the bar.
  assert.match(view, /<button type="button" className="explore-view-switch" onClick=\{onClose\}>/);
  assert.doesNotMatch(view, /setPane|is-list/);
  assert.match(phone, /\.explore-map-close \{ display: none; \}/);
  assert.match(phone, /\.explore-map-results \{ display: none; \}/);
  // The list page's switch returns, and the rail's Map pill steps aside for it.
  assert.match(browser, /className="explore-view-switch explore-map-float"\s+onClick=\{\(\) => update\(\{ view: "map" \}, "push"\)\}/);
  assert.match(phone, /\.explore-map-toggle \{ display: none; \}/);
  assert.match(phone, /\.explore-map-float \{ position: fixed;[^}]*display: inline-flex; \}/);
  assert.match(between(mapCss, "@media (min-width: 64rem) {", "\n}"), /\.explore-view-switch \{ display: none; \}/);
});

test("an area drawn on the map is shown, and removable, wherever it narrows the rentals", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const query = read("web/src/lib/exploreQuery.ts");

  // One chip, in the controls both views share, so the list page says so too.
  const controls = between(browser, 'function discovery(variant: "page" | "map"): ReactNode {', "\n  const notices");
  assert.match(controls, /\{variant === "page" \|\| query\.bbox \|\| unshown\.length \|\| filterCount \? \(/);
  assert.match(controls, /\{query\.bbox \? \(\s*<button\s+type="button"\s+className="explore-chip explore-area-chip"/);
  assert.match(controls, /onClick=\{\(\) => \{ update\(\{ bbox: null \}\); advancedTrigger\.current\?\.focus\(\); \}\}/);
  assert.doesNotMatch(view, /Map area|onClearArea/);
  // Where, not a filter: Clear all keeps it.
  assert.match(between(query, "export function withoutFilters(", "\n}"), /bbox: query\.bbox,/);
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
  assert.match(places, /searchPlaces\(typed, controller\.signal\)/);
  assert.match(places, /window\.clearTimeout\(timer\);\s*controller\.abort\(\);/);
});

test("a marker previews a rental; only the preview leaves the map", () => {
  const map = read("web/src/components/explore/ExploreMap.tsx");
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  const preview = read("web/src/components/explore/MapListingPreview.tsx");

  // Markers are buttons a keyboard can reach, with states as classes.
  assert.match(map, /const element = document\.createElement\("button"\);/);
  for (const state of ["is-selected", "is-hovered", "is-visited"]) {
    assert.match(map, new RegExp(`element\\.classList\\.toggle\\("${state}", `));
  }
  // Selecting sets a selection; it never navigates.
  const select = between(view, "function selectListing(feature: MapListingFeature) {", "\n  }");
  assert.match(select, /setSelection\(\{ key: `listing:\$\{feature\.id\}`, ids: \[feature\.id\]/);
  assert.doesNotMatch(view, /useRouter|router\.push|<Link\b/);
  // A stack of listings on one point pages in the preview instead of zooming.
  const cluster = between(view, "function selectCluster(feature: MapClusterFeature) {", "\n  }");
  assert.match(cluster, /if \(feature\.stacked && feature\.ids\?\.length\) \{/);
  // The preview is where the listing opens.
  assert.match(preview, /<Link href=\{href\} className="explore-preview-link" onClick=\{\(\) => onOpen\(listing\)\}>/);
});

test("the map searches a new area only when asked", () => {
  const view = read("web/src/components/explore/ExploreMapView.tsx");

  assert.equal(view.match(/onSearchArea\(/g)?.length, 1);
  assert.match(between(view, "function searchThisArea() {", "\n  }"), /onSearchArea\(bounds\);/);
  assert.match(view, /<button type="button" className="explore-search-area" onClick=\{searchThisArea\}>/);
  // Offered only once the tenant has moved the map beyond what was searched.
  assert.match(view, /const showSearchArea = Boolean\(userMoved && view && searched && outgrewSearch\(view\.bounds, searched\)\);/);
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
  // Uses, not mentions: the section's comment names the street it withholds.
  for (const source of [location, locationMap, map]) {
    assert.doesNotMatch(source, /map_latitude|map_longitude|\.address\b|\.street\b|house_number|digital_address/);
  }
});

test("the basemap is Rooomly's, credited, and its worker is served from an allow-list", () => {
  const map = read("web/src/components/explore/ExploreMap.tsx");
  const setup = read("web/src/components/explore/maplibreSetup.ts");
  const route = read("web/app/maplibre/[file]/route.ts");
  const settings = read("backend/config/settings/base.py");

  assert.match(setup, /setWorkerUrl\(new URL\("\/maplibre\/maplibre-gl-worker\.mjs", window\.location\.origin\)\.href\);/);
  assert.match(setup, /addProtocol\("pmtiles", new Protocol\(\)\.tile\);/);
  assert.match(map, /prepareMapLibre\(\);/);
  assert.match(route, /const FILES = new Set\(\["maplibre-gl-worker\.mjs", "maplibre-gl-shared\.mjs"\]\);/);
  assert.match(route, /if \(!FILES\.has\(file\)\) return new Response\("Not found", \{ status: 404 \}\);/);
  // OpenStreetMap's licence requires the credit on every map.
  assert.match(map, /new AttributionControl\(\{ compact: true, customAttribution: config\.attribution \}\)/);
  assert.match(settings, /MAP_ATTRIBUTION = env\("MAP_ATTRIBUTION", "© OpenStreetMap contributors · Protomaps"\)/);
});

test("markers and menus are drawn so MapLibre's positioning and the full-screen map both survive", () => {
  const mapCss = read("web/src/styles/explore-map.css");
  const exploreCss = read("web/src/styles/explore-workspace.css");

  // MapLibre positions a marker with an inline transform; emphasis must not replace it.
  const markerRules = between(mapCss, ".explore-price-marker {", ".explore-cluster-marker {");
  assert.doesNotMatch(markerRules, /\btransform:/);
  assert.match(between(mapCss, ".explore-price-marker.is-selected {", "}"), /scale: 1\.12;/);
  assert.match(mapCss, /\.explore-price-marker\.is-visited \{/);
  assert.match(mapCss, /\.explore-price-marker:hover,\s*\.explore-price-marker\.is-hovered \{/);

  // The full-screen view portals to the body. Rendered in place, the public
  // page's isolated wrapper kept it under the site's sticky header.
  const view = read("web/src/components/explore/ExploreMapView.tsx");
  assert.match(view, /return inBrowser \? createPortal\(content, document\.body\) : null;/);
  assert.match(view, /useSyncExternalStore\(noSubscription, \(\) => true, \(\) => false\)/);

  // The quick-filter menus portal to the body, so they must sit above the map view.
  const viewLayer = Number(between(mapCss, ".explore-map-view {", "}").match(/z-index: (\d+);/)?.[1]);
  const menuLayer = Number(between(exploreCss, ".explore-menu {", "}").match(/z-index: (\d+);/)?.[1]);
  assert.ok(Number.isFinite(viewLayer) && Number.isFinite(menuLayer), "z-index not found");
  assert.ok(menuLayer > viewLayer, `menus (${menuLayer}) must stack above the map view (${viewLayer})`);
});

test("the backend answers the list and the map from one filtered search", () => {
  const views = read("backend/apps/listing/views.py");
  const serializers = read("backend/apps/listing/serializers.py");

  assert.match(between(views, "class ListingSearchView(APIView):", "class ListingMapView(APIView):"), /search\.filtered_listings\(data, area\)/);
  assert.match(between(views, "class ListingMapView(APIView):", "class ListingDetailView(APIView):"), /search\.filtered_listings\(data, area\)/);
  // Cards publish the approximate point, never the address's coordinates.
  assert.match(between(serializers, "def get_public_location(self, obj)", "def _card_media_items"), /return public_location_payload\(obj\)/);
});
