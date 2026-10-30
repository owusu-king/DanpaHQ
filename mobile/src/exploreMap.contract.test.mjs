/**
 * Explore on a phone, on a map (ADR 0034).
 *
 * Five promises are pinned here: only one file knows which company draws the
 * map; one search is one Places session; the list and the markers ask one
 * question; the map searches a new area only when asked; and a marker previews
 * its rental while the list waits in a sheet that reaches the whole screen.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

/** The text between two markers, so an assertion lands inside one function. */
function between(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `marker not found: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to >= 0, `end marker not found after ${start}: ${end}`);
  return source.slice(from, to);
}

/** Every TypeScript source under a folder, as [path, text]. */
function sources(folder) {
  const found = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const full = join(directory, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) found.push([relative(root, full).replaceAll("\\", "/"), readFileSync(full, "utf8")]);
    }
  };
  walk(join(root, folder));
  return found;
}

test("the mobile map uses the installed WebView without native Google Maps", () => {
  for (const [path, text] of [...sources("src"), ...sources("app")]) assert.doesNotMatch(text, /from "react-native-maps"/, path);
  assert.match(read("src/maps/DanpaHQMap.native.tsx"), /LeafletView as DanpaHQMap/);
  assert.match(read("src/maps/LeafletView.tsx"), /from "react-native-webview"/);
  assert.doesNotMatch(read("package.json"), /"react-native-maps"/);
  assert.doesNotMatch(read("app.config.js"), /GOOGLE_MAPS_ANDROID|withMapsKeyPlaceholder/);
});

test("mobile property search uses database text without geocoding", () => {
  const search = read("app/(app)/search.tsx");
  assert.doesNotMatch(search, /suggestPlaces|resolvePlace|newPlacesSession/);
  assert.match(search, /q: area \? undefined : place\.trim\(\) \|\| undefined/);
});

test("the list and the markers ask one question", () => {
  const search = read("app/(app)/search.tsx");
  const listings = read("src/listings.ts");
  const mapSearch = read("src/mapSearch.ts");

  assert.match(listings, /const query = listingQuery\(filters\);/);
  assert.match(mapSearch, /new URLSearchParams\(listingQuery\(filters\)\)/);
  // The box both search: one searched from the map, else the chosen place's.
  assert.match(search, /const box = bbox \?\? area\?\.bounds \?\? null;/);
  assert.match(search, /west: box\?\.west,/);
  assert.match(search, /searchListingMap\(filters, \{/);
  assert.match(search, /if \(id !== markerRequest\.current\) return;/);
  // The extent belongs to the search: a newer window's markers never throw it away.
  assert.match(search, /if \(withSummary && summaryId === summaryRequest\.current\) setExtent\(answer\.extent \?\? null\);/);
});

test("the map searches a new area only when asked, and offers it only over the map", () => {
  const search = read("app/(app)/search.tsx");
  const native = read("src/maps/leafletHtml.ts");

  // Moving is looking: it redraws markers for the window and never changes the search.
  const move = between(search, "function moveMap(move: MapMove) {", "\n  }");
  assert.doesNotMatch(move, /setBbox|setArea|searchListings/);
  assert.match(between(search, "function searchThisArea() {", "\n  }"), /setBbox\(nextBounds\)/);
  // Offered as soon as the native map has a visible window. Movement only
  // emphasizes it; no provider-specific movement threshold can disable it.
  assert.match(search, /const canSearchArea = Boolean\(showMap && view && !querying\);/);
  assert.match(move, /if \(move\.byUser\) \{[\s\S]*setMapFeedback\(null\);[\s\S]*setUserMoved\(true\);/);
  assert.doesNotMatch(search, /movedMeaningfully|setAnchor/);
  assert.match(native, /byUser:!ours/);
  assert.match(native, /const b=data\.fit\.bounds;ours=true/);

  // It occupies one stable place in the four-control glass rail, over the map
  // only. Moving the map enables it instead of adding another floating pill.
  assert.match(search, /accessibilityLabel="Map view controls"/);
  assert.match(search, /label="Search this area"/);
  assert.match(search, /emphasized=\{userMoved\}/);
  assert.match(search, /disabled=\{!canSearchArea\}/);
  assert.doesNotMatch(search, /\{showSearchArea && !listOpen \? \(/);

  // "This area" is what the tenant can see — the map between the controls and
  // the List button, measured on the screen — so every provider means the same by it.
  assert.match(search, /insets=\{mapInsets\}/);
  assert.match(search, /right: 76,/);
  assert.match(native, /map\.containerPointToLatLng\(\[Math\.min\(insets\.left,size\.x/);
  assert.match(native, /size\.x-Math\.min\(insets\.right/);
  assert.match(native, /paddingTopLeft:\[Math\.min\(insets\.left\+24/);

});

test("a marker previews its rental, and the map and the list are two views switched by a button", () => {
  const search = read("app/(app)/search.tsx");
  const native = read("src/maps/leafletHtml.ts");

  const press = between(search, "function pressMarker(key: string) {", "\n  }\n");
  assert.match(press, /setSelection\(\{ key, ids: \[feature\.id\] \}\);/);
  // A stack never separates by zooming, so it pages instead; a cluster zooms in.
  assert.match(press, /if \(feature\.stacked && feature\.ids\?\.length\) \{/);
  assert.match(press, /setFit\(\{ key: `\$\{key\}:\$\{Date\.now\(\)\}`, bounds: grow\(feature\.bounds, 0\.35\) \}\);/);
  assert.doesNotMatch(press, /router\.push/);
  // A tap on the ground closes the preview; on Android a marker tap also reaches the map.
  assert.match(search, /onBackgroundPress=\{pressBackground\}/);
  assert.match(between(search, "function pressBackground() {", "\n  }"), /setSelection\(null\);/);
  assert.match(native, /bubblingMouseEvents:false/);
  // Never the rent without the lump sum it takes to move in.
  const preview = between(search, "function MapPreview({", "\nfunction AreaChip(");
  assert.match(preview, /const advance = advanceTerm\(listing\.advance_label\);/);
  assert.match(preview, /\{advance\}<\/Type>/);

  // No sheet to drag (owner, 2026-10-06): List floats over the map, centred
  // over the Services tab and lifted above a preview; the list fades over the
  // map and its Map button, beside the count, brings the map back.
  assert.doesNotMatch(search, /PanResponder|SheetStop|FLICK_MS|FALLBACK_PEEK|setStop\(/);
  assert.match(search, /const \[listOpen, setListOpen\] = useState\(!showMap\);/);
  assert.match(search, /accessibilityLabel=\{.List\. \$\{resultLine\}.\}/);
  assert.match(search, /color: theme\.color\.field\["0"\] \}\}>List<\/Type>/);
  assert.match(search, /onPress=\{\(\) => \{ Keyboard\.dismiss\(\); setListOpen\(true\); \}\}/);
  // On iOS the glass tab bar floats over the map, so the button rides above it.
  assert.match(search, /bottom: \(previewing \? previewHeight \+ space\[3\] \* 2 : space\[5\]\) \+ barClearance,/);
  assert.match(search, /\{showMap && !listOpen \? \(/);
  assert.match(search, /accessibilityLabel="Show the map"[\s\S]{0,40}hitSlop=\{6\}\s*onPress=\{\(\) => setListOpen\(false\)\}/);
  assert.match(search, /pointerEvents=\{listOpen \? "auto" : "none"\}/);
  assert.match(search, /opacity: listFade,/);
  assert.match(search, /Animated\.timing\(listFade, \{ toValue, duration: 180, useNativeDriver: true \}\)/);
  // The list covers everything below the hero, and a preview only shows over the map.
  assert.match(search, /const listHeight = Math\.max\(0, screenHeight - controlsHeight\);/);
  assert.match(search, /const previewing = Boolean\(showMap && selection && previewListing && !listOpen\);/);
  // List view keeps the same header as map view: no fold, no one-row form.
  assert.doesNotMatch(search, /oneRow|collapsed=/);
  // Outside the tabs, the list keeps clear of the home indicator itself.
  assert.match(search, /paddingBottom: space\[8\] \+ \(inTabs \? barClearance : insets\.bottom\),/);
  // Without a map the screen is the whole list, and says why.
  assert.match(search, /const showMap = mapAvailable\(\);/);
  // Said once, quietly, under the count rather than as a sentence of its own.
  assert.match(search, /map not in this build/);
});

test("price markers use reusable DOM faces rather than native image snapshots", () => {
  const html = read("src/maps/leafletHtml.ts");
  const view = read("src/maps/LeafletView.tsx");
  assert.match(html, /element\.textContent=m\.label/);
  assert.match(html, /let marker=markers\.get\(m\.key\)/);
  assert.match(html, /marker\.setLatLng/);
  assert.match(html, /marker\.setIcon\(face\(m\)\)/);
  assert.match(html, /m\.selected\?' selected'/);
  assert.match(html, /m\.visited\?' visited'/);
  assert.match(view, /markers\.filter\(\(\{ position \}\) => validPoint/);
  assert.doesNotMatch(html + view, /captureRef|tracksViewChanges/);
});

test("the mobile map rail offers area search and recenter", () => {
  const search = read("app/(app)/search.tsx");
  const native = read("src/maps/leafletHtml.ts");
  const types = read("src/maps/types.ts");

  for (const label of ["Search this area", "Recenter map on these results"]) {
    assert.match(search, new RegExp(label));
  }
  assert.equal(search.match(/<MapTool/g)?.length, 2);
  assert.match(search, /<BlurView/);
  // Android draws no shared rail at all: no blur, background, border, or
  // elevation over the native map. Only the three clear circular buttons remain.
  assert.equal(search.match(/Platform\.OS === "android" \? null : \(/g)?.length, 2);
  assert.doesNotMatch(search, /dimezisBlurView/);
  assert.match(search, /\.\.\.\(Platform\.OS === "android" \? \{\} : FLOATING\)/);
  assert.match(search, /borderWidth: Platform\.OS === "android" \? 0 : 1/);
  assert.match(search, /backgroundColor: Platform\.OS === "android" \? "transparent" : "rgba\(255,255,255,0\.03\)"/);
  // Each circular control stays about 90% visible and easy to recognize.
  assert.match(search, /backgroundColor: "rgba\(255,255,255,0\.90\)"/);
  assert.doesNotMatch(search, /StreetView|streetViewAt|Linking\.openURL/);
  assert.match(search, /recordAreaResult\(boxRequestKey, "rent", page\.results\.length\)/);
  assert.match(search, /recordAreaResult\(boxRequestKey, "sale", page\.results\.length\)/);
  assert.match(search, /No properties found in this area\. Move the map or adjust your filters\./);
  assert.match(search, /Properties found in this area\. Tap a marker or open the list\./);
  assert.match(search, /accessibilityLiveRegion="polite"/);
  assert.match(search, /tone: "danger"/);
  assert.match(search, /mapBanner\.tone === "danger" \? theme\.color\.laterite\["100"\] : theme\.color\.kola\["50"\]/);
  assert.match(search, /alert-circle-outline/);
  assert.match(types, /export type BaseMapStyle = "standard" \| "hybrid";/);
  assert.match(native, /L\.tileLayer\(config\.url/);
});

test("the map opens without waiting on the server, and says when it cannot reach it", () => {
  const search = read("app/(app)/search.tsx");
  // On a phone that could not reach the API, three twenty-second tries left
  // Explore blank for over a minute (2026-10-16). Past a moment the built-in
  // view opens the map; the server's settings still arrive later.
  assert.match(search, /const MAP_CONFIG_WAIT_MS = 1500;/);
  assert.match(search, /if \(live\) setConfig\(\(current\) => current \?\? FALLBACK_MAP\);\s*\}, MAP_CONFIG_WAIT_MS\);/);
  // A failed load is said over the map, not only inside the closed list.
  assert.match(search, /const mapBanner: MapFeedback \| null = mapFeedback\s*\?\? \(resultError && resultError !== dismissedError \? \{ message: resultError, tone: "danger" \} : null\)\s*\?\?/);
  assert.match(search, /\{showMap && !listOpen && mapBanner \? \(/);
});

test("tile and WebView failures are reported without abandoning the map", () => {
  const html = read("src/maps/leafletHtml.ts");
  const view = read("src/maps/LeafletView.tsx");
  assert.match(html, /tileLayer\.on\('tileload'/);
  assert.doesNotMatch(html, /errors>=3/);
  assert.match(html, /if\(!loaded\)send\(\{type:'unavailable'\}\);\},12000/);
  assert.match(view, /data\.type === "unavailable"\) onUnavailable\?\.\(\)/);
  assert.match(view, /onError=\{\(\) => onUnavailable\?\.\(\)\}/);
  const search = read("app/(app)/search.tsx");
  assert.match(search, /onUnavailable=\{\(\) => setMapFailed\(true\)\}/);
  assert.match(search, /mapFailed \? \{ message: "Maps not loading"/);
});

test("the tab bar's icon fonts are ready before the app opens", () => {
  // Explore's globe is the only MaterialCommunityIcons glyph; loaded on first
  // use, its tab stood empty for a moment on a slower phone.
  const root = read("app/_layout.tsx");
  assert.match(root, /useFonts\(\{ \.\.\.Ionicons\.font, \.\.\.MaterialCommunityIcons\.font \}\)/);
  assert.match(root, /const settled = state\.status !== "loading" && redirect === null && iconsReady;/);
});
