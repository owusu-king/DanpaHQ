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

test("only the map folder knows which company draws the map", () => {
  for (const [path, text] of [...sources("src"), ...sources("app")]) {
    // A comment may name the library; an import may not, outside the one file.
    if (path !== "src/maps/DanpaHQMap.native.tsx") {
      assert.doesNotMatch(text, /from "react-native-maps"/, `${path} imports the map library`);
    }
    // No client talks to Places or holds a key: the API does both.
    assert.doesNotMatch(text, /googleapis|X-Goog|GOOGLE_MAPS_/, `${path} reaches past Danpa HQ's API`);
  }

  const native = read("src/maps/DanpaHQMap.native.tsx");
  // Apple Maps is used on iOS in both Expo Go and release builds.
  assert.match(native, /const PROVIDER = Platform\.OS === "ios" \? PROVIDER_DEFAULT : PROVIDER_GOOGLE;/);
  assert.match(native, /provider=\{PROVIDER\}/);
  assert.doesNotMatch(native, /loadingEnabled=/);
  // iOS always has Apple Maps; an Android build without its key shows the list.
  assert.match(between(native, "export function mapAvailable(): boolean {", "\n}"), /if \(Platform\.OS === "ios" \|\| inExpoGo\) return true;/);
  assert.match(between(native, "export function mapAvailable(): boolean {", "\n}"), /return Boolean\(keys\?\.android\);/);
  assert.match(between(read("src/maps/DanpaHQMap.tsx"), "export function mapAvailable(): boolean {", "\n}"), /return false;/);

  // Android's key comes from the environment into native config; JavaScript learns only whether it exists.
  const config = read("app.config.js");
  assert.match(config, /process\.env\.GOOGLE_MAPS_ANDROID_API_KEY/);
  assert.doesNotMatch(config, /GOOGLE_MAPS_IOS_API_KEY/);
  assert.match(config, /androidGoogleMapsApiKey: "\$\{GOOGLE_MAPS_ANDROID_API_KEY\}"/);
  assert.match(config, /parseEnv\(readFileSync\(resolve\(__dirname, "\.\.\/\.env"\)/);
  assert.match(config, /googleMaps: \{ android: Boolean\(android\) \}/);
  assert.equal(JSON.parse(read("app.json")).expo.ios.bundleIdentifier, "com.danpahq.app");
  assert.match(read("package.json"), /"react-native-maps"/);
});

test("one search is one Places session, spent by the place it chooses", () => {
  const search = read("app/(app)/search.tsx");
  const places = read("src/places.ts");

  // Made with the first request and carried by every one after it.
  assert.match(search, /session\.current \?\?= newPlacesSession\(\);/);
  assert.match(search, /suggestPlaces\(typed, session\.current\)/);
  // An older answer never replaces a newer one, and choosing withdraws the rest.
  assert.match(search, /if \(id !== suggestionRequest\.current\) return;/);
  const choose = between(search, "async function choosePlace(row: PlaceSuggestion) {", "\n  }\n");
  assert.match(choose, /const chosen = await resolvePlace\(row, session\.current\);/);
  assert.match(choose, /session\.current = null;/);
  assert.match(choose, /suggestionRequest\.current \+= 1;/);
  // Typing over a place while it resolves means the tenant moved on: it never lands.
  assert.match(choose, /if \(id !== resolveRequest\.current\) return;/);
  assert.match(between(search, "function editPlace(text: string) {", "\n  }"), /resolveRequest\.current \+= 1;/);
  // A version 4 UUID from the platform, and Danpa HQ's endpoints only.
  assert.match(places, /return randomUUID\(\);/);
  assert.match(places, /\/geo\/places\/suggest\//);
  assert.match(places, /\/geo\/places\/resolve\//);
  // Google's suggestions, shown with no Google map beneath them, carry its name.
  assert.match(search, /attribution === "google"/);
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
  const native = read("src/maps/DanpaHQMap.native.tsx");

  // Moving is looking: it redraws markers for the window and never changes the search.
  const move = between(search, "function moveMap(move: MapMove) {", "\n  }");
  assert.doesNotMatch(move, /setBbox|setArea|searchListings/);
  assert.match(between(search, "function searchThisArea() {", "\n  }"), /setBbox\(nextBounds\)/);
  // Offered as soon as the native map has a visible window. Movement only
  // emphasizes it; no provider-specific movement threshold can disable it.
  assert.match(search, /const canSearchArea = Boolean\(showMap && view && !querying\);/);
  assert.match(move, /if \(move\.byUser\) \{[\s\S]*setMapFeedback\(null\);[\s\S]*setUserMoved\(true\);/);
  assert.doesNotMatch(search, /movedMeaningfully|setAnchor/);
  // A gesture is the tenant's; a fit is ours.
  assert.match(native, /const byUser = details\?\.isGesture \?\? !ours\.current;/);

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
  assert.match(native, /mapPadding=\{insets\}/);
  assert.match(native, /view\.coordinateForPoint\(\{ x: covered\.left, y: covered\.top \}\),/);
  assert.match(native, /view\.coordinateForPoint\(\{ x: width - covered\.right, y: height - covered\.bottom \}\),/);
  assert.match(native, /if \(settle === settles\.current\) onMove\(\{ bounds, zoom, byUser \}\);/);
  // Google's fit already keeps inside its padding; Apple's is told the insets.
  assert.match(native, /const edge = \(inset: number\) => FIT_MARGIN \+ \(PROVIDER === PROVIDER_GOOGLE \? 0 : inset\);/);
});

test("a marker previews its rental, and the map and the list are two views switched by a button", () => {
  const search = read("app/(app)/search.tsx");
  const native = read("src/maps/DanpaHQMap.native.tsx");

  const press = between(search, "function pressMarker(key: string) {", "\n  }\n");
  assert.match(press, /setSelection\(\{ key, ids: \[feature\.id\] \}\);/);
  // A stack never separates by zooming, so it pages instead; a cluster zooms in.
  assert.match(press, /if \(feature\.stacked && feature\.ids\?\.length\) \{/);
  assert.match(press, /setFit\(\{ key: `\$\{key\}:\$\{Date\.now\(\)\}`, bounds: grow\(feature\.bounds, 0\.35\) \}\);/);
  assert.doesNotMatch(press, /router\.push/);
  // A tap on the ground closes the preview; on Android a marker tap also reaches the map.
  assert.match(search, /onBackgroundPress=\{pressBackground\}/);
  assert.match(between(search, "function pressBackground() {", "\n  }"), /setSelection\(null\);/);
  assert.match(native, /if \(event\.nativeEvent\.action === "marker-press"\) return;/);
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

test("a price marker is reliable, branded, and drawn the same on every density", () => {
  const native = read("src/maps/DanpaHQMap.native.tsx");

  // Android places an image of each face, drawn offscreen at its natural size:
  // the library snapshots live views into a fixed 100-pixel square under the
  // New Architecture. iOS draws the live face.
  assert.match(native, /const DRAWS_IMAGES = Platform\.OS === "android";/);
  // react-native-maps supports local marker images, not data URIs. Android
  // draws those images after capture, keeping live views off the map renderer.
  assert.match(native, /captureRef\(frame, \{ format: "png", quality: 1, result: "tmpfile" \}\)/);
  assert.match(native, /image=\{\{ uri: image \}\}/);
  assert.match(native, /if \(!image\) return null;/);
  assert.doesNotMatch(native, /result: "data-uri"/);
  assert.match(native, /<View\s+ref=\{frame\}\s+collapsable=\{false\}/);
  // A face is drawn again whenever what it says, its state or the font size changes.
  assert.match(native, /return \[marker\.kind, marker\.label, marker\.count \?\? "", state, fontScale\.toFixed\(2\)\]\.join\("\|"\);/);
  // While a new state's face is drawn, the marker keeps its plain one instead of vanishing.
  assert.match(native, /\?\? images\.get\(faceKey\(\{ \.\.\.marker, selected: false, visited: false \}, fontScale\)\);/);

  // Sized by its text, and holding everything it draws: no hand-set width or
  // height, no rotated tail, no shadow outside the frame.
  const face = between(native, "function MarkerFace(", "\nfunction ");
  assert.doesNotMatch(face, /rotate|width: \d|height: \d|elevation|shadow/);
  assert.match(face, /<Text maxFontSizeMultiplier=\{MARKER_FONT_SCALE\} numberOfLines=\{1\} style=\{\[styles\.priceLabel, \{ color: palette\.text \}\]\}>/);
  assert.match(face, /const round = LABEL_LINE \* scale \+ room \* 2 \+ CLUSTER_BORDER \* 2;/);
  // Android pads text for accents it never draws, which sets a price off centre in its image.
  assert.match(between(native, "  priceLabel: {", "\n  },"), /includeFontPadding: false,/);

  // A live face is redrawn only when the map is told, so a new state is a new marker.
  assert.match(native, /key=\{`\$\{marker\.key\}:\$\{marker\.selected \? "selected" : marker\.visited \? "visited" : "idle"\}`\}/);
  assert.match(native, /tracksViewChanges=\{tracking\}/);
  assert.match(native, /const drawableMarkers = useMemo\(\(\) => markers\.filter/);
  assert.match(native, /styles\.markerDot/);
  assert.match(native, /const tailed = \(kind: MapMarker\["kind"\]\) => kind !== "cluster";/);
  assert.match(read("package.json"), /"react-native-view-shot"/);
});

test("the mobile map rail offers satellite, area search and recenter", () => {
  const search = read("app/(app)/search.tsx");
  const native = read("src/maps/DanpaHQMap.native.tsx");
  const types = read("src/maps/types.ts");

  for (const label of ["Show satellite map", "Search this area", "Recenter map on these results"]) {
    assert.match(search, new RegExp(label));
  }
  assert.equal(search.match(/<MapTool/g)?.length, 3);
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
  assert.match(native, /mapType=\{baseMap\}/);
});

test("the map opens without waiting on the server, and says when it cannot reach it", () => {
  const search = read("app/(app)/search.tsx");
  // On a phone that could not reach the API, three twenty-second tries left
  // Explore blank for over a minute (2026-10-16). Past a moment the built-in
  // view opens the map; the server's settings still arrive later.
  assert.match(search, /const MAP_CONFIG_WAIT_MS = 1500;/);
  assert.match(search, /if \(live\) setConfig\(\(current\) => current \?\? FALLBACK_MAP\);\s*\}, MAP_CONFIG_WAIT_MS\);/);
  // A failed load is said over the map, not only inside the closed list.
  assert.match(search, /const mapBanner: MapFeedback \| null = mapFeedback\s*\?\? \(error && error !== dismissedError \? \{ message: error, tone: "danger" \} : null\)\s*\?\?/);
  assert.match(search, /\{showMap && !listOpen && mapBanner \? \(/);
});

test("a map Google never draws says so briefly, on the map itself", () => {
  // On one owner's Android phone the logo and controls drew over an empty map,
  // forever (2026-10-16): the native view was up, the tiles never came.
  const native = read("src/maps/DanpaHQMap.native.tsx");
  assert.match(native, /const MAP_LOAD_WAIT_MS = 12_000;/);
  assert.match(native, /onMapLoaded=\{\(\) => \{ drawn\.current = true; \}\}/);
  assert.match(native, /if \(!drawn\.current\) unavailable\.current\?\.\(\);/);
  const search = read("app/(app)/search.tsx");
  // The person stays on the map; the list is not opened for them (owner, 2026-10-16).
  assert.match(search, /onUnavailable=\{\(\) => setMapFailed\(true\)\}/);
  assert.match(search, /\?\? \(mapFailed \? \{ message: "Maps not loading", tone: "danger" \} : null\);/);
  assert.doesNotMatch(search, /The map could not load on this phone/);
});

test("the tab bar's icon fonts are ready before the app opens", () => {
  // Explore's globe is the only MaterialCommunityIcons glyph; loaded on first
  // use, its tab stood empty for a moment on a slower phone.
  const root = read("app/_layout.tsx");
  assert.match(root, /useFonts\(\{ \.\.\.Ionicons\.font, \.\.\.MaterialCommunityIcons\.font \}\)/);
  assert.match(root, /const settled = state\.status !== "loading" && redirect === null && iconsReady;/);
});
