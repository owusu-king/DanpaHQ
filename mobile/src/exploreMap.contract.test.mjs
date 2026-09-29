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
    if (path !== "src/maps/RooomlyMap.native.tsx") {
      assert.doesNotMatch(text, /from "react-native-maps"/, `${path} imports the map library`);
    }
    // No client talks to Places or holds a key: the API does both.
    assert.doesNotMatch(text, /googleapis|X-Goog|GOOGLE_MAPS_/, `${path} reaches past Rooomly's API`);
  }

  const native = read("src/maps/RooomlyMap.native.tsx");
  // Expo Go on an iPhone cannot load Google's SDK; every build Rooomly ships draws Google.
  assert.match(native, /const PROVIDER = Platform\.OS === "ios" && inExpoGo \? PROVIDER_DEFAULT : PROVIDER_GOOGLE;/);
  assert.match(native, /provider=\{PROVIDER\}/);
  // A build without its platform's key has no map, and the screen is the list instead.
  assert.match(between(native, "export function mapAvailable(): boolean {", "\n}"), /if \(inExpoGo\) return true;/);
  assert.match(between(read("src/maps/RooomlyMap.tsx"), "export function mapAvailable(): boolean {", "\n}"), /return false;/);

  // Keys come from the environment into native config; JavaScript learns only whether they exist.
  const config = read("app.config.js");
  assert.match(config, /process\.env\.GOOGLE_MAPS_ANDROID_API_KEY/);
  assert.match(config, /process\.env\.GOOGLE_MAPS_IOS_API_KEY/);
  assert.match(config, /googleMaps: \{ apiKey: android \}/);
  assert.match(config, /googleMapsApiKey: ios/);
  assert.match(config, /googleMaps: \{ android: Boolean\(android\), ios: Boolean\(ios\) \}/);
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
  // A version 4 UUID from the platform, and Rooomly's endpoints only.
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
  const native = read("src/maps/RooomlyMap.native.tsx");

  // Moving is looking: it redraws markers for the window and never changes the search.
  const move = between(search, "function moveMap(move: MapMove) {", "\n  }");
  assert.doesNotMatch(move, /setBbox|setArea|searchListings/);
  assert.match(between(search, "function searchThisArea() {", "\n  }"), /setBbox\(\{/);
  // Offered once the tenant has moved well away from where the results were shown:
  // wherever Rooomly puts the map is the anchor, and only a gesture moves past it.
  assert.match(search, /const showSearchArea = Boolean\(showMap && userMoved && view && anchor && movedMeaningfully\(view, anchor\)\);/);
  assert.match(move, /if \(move\.byUser\) \{/);
  assert.match(move, /\} else if \(!movedRef\.current\) \{[\s\S]*setAnchor\(move\);/);
  assert.match(search, /return across > 0\.25 \|\| along > 0\.25 \|\| Math\.abs\(view\.zoom - anchor\.zoom\) >= 0\.8;/);
  // A gesture is the tenant's; a fit is ours.
  assert.match(native, /const byUser = details\?\.isGesture \?\? !ours\.current;/);

  // It rides a step above the sheet and fades before the sheet can crowd it:
  // gone at full, gone behind a preview, and never over the rentals.
  assert.match(search, /\{showSearchArea && stop !== "full" && !previewing \? \(/);
  assert.match(search, /opacity: areaPillOpacity,\s+transform: \[\{ translateY: offset \}\],/);
  assert.match(search, /inputRange: \[pillHeight \+ space\[6\], pillHeight \+ space\[12\]\],/);

  // "This area" is what the tenant can see — the map between the controls and
  // the sheet, measured on the screen — so every provider means the same by it.
  assert.match(search, /insets=\{mapInsets\}/);
  assert.match(native, /mapPadding=\{insets\}/);
  assert.match(native, /view\.coordinateForPoint\(\{ x: covered\.left, y: covered\.top \}\),/);
  assert.match(native, /view\.coordinateForPoint\(\{ x: width - covered\.right, y: height - covered\.bottom \}\),/);
  assert.match(native, /if \(settle === settles\.current\) onMove\(\{ bounds, zoom, byUser \}\);/);
  // Google's fit already keeps inside its padding; Apple's is told the insets.
  assert.match(native, /const edge = \(inset: number\) => FIT_MARGIN \+ \(PROVIDER === PROVIDER_GOOGLE \? 0 : inset\);/);
});

test("a marker previews its rental while the list waits in a sheet that reaches the whole screen", () => {
  const search = read("app/(app)/search.tsx");
  const native = read("src/maps/RooomlyMap.native.tsx");

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

  // Full is the whole content area below the hero; collapsed is exactly the
  // sheet's measured header.
  assert.match(search, /const sheetHeight = Math\.max\(0, screenHeight - controlsHeight\);/);
  // List view keeps the same header as map view: no fold, no one-row form.
  assert.doesNotMatch(search, /oneRow|collapsed=/);
  assert.match(search, /const peek = sheetHeaderHeight > 0 \? Math\.ceil\(sheetHeaderHeight\) : FALLBACK_PEEK;/);
  assert.match(search, /return \{ full: 0, half: Math\.min\(Math\.round\(sheetHeight \* 0\.45\), collapsed\), peek: collapsed \};/);
  // It snaps to where the release is heading, and a deliberate flick always
  // moves at least one stop, without bouncing past it.
  assert.match(search, /PanResponder\.create\(\{/);
  assert.match(search, /let target = nearest\(dragStart\.current \+ gesture\.dy \+ gesture\.vy \* FLICK_MS\);/);
  assert.match(search, /if \(target === from && Math\.abs\(gesture\.vy\) > 0\.3\) \{/);
  assert.match(search, /overshootClamping: true,/);
  assert.match(search, /onPanResponderTerminationRequest: \(\) => false,/);
  // The rentals drag the sheet until it is full and only then scroll — photo
  // swipes and Android's pull-to-refresh included, which would take the drag.
  assert.match(search, /return \[drag\(\(\) => true\), drag\(\(\) => stopRef\.current !== "full"\)\] as const;/);
  assert.match(search, /const listScrolls = !showMap \|\| stop === "full";/);
  assert.match(search, /scrollEnabled=\{listScrolls\}/);
  assert.match(search, /enabled=\{listScrolls\}/);
  assert.match(search, /photoSwipe=\{listScrolls\}/);
  // Outside the tabs, the list keeps clear of the home indicator itself.
  assert.match(search, /paddingBottom: space\[8\] \+ \(inTabs \? 0 : insets\.bottom\),/);
  // Without a map the screen is the whole list, and says why.
  assert.match(search, /const showMap = mapAvailable\(\);/);
  // Said once, quietly, under the count rather than as a sentence of its own.
  assert.match(search, /map not in this build/);
});

test("a price marker is its own face, drawn the same on every density", () => {
  const native = read("src/maps/RooomlyMap.native.tsx");

  // Android places an image of each face, drawn offscreen at its natural size:
  // the library snapshots live views into a fixed 100-pixel square under the
  // New Architecture. iOS draws the live face.
  assert.match(native, /const DRAWS_IMAGES = Platform\.OS === "android";/);
  assert.match(native, /captureRef\(frame, \{ format: "png", quality: 1, result: "data-uri" \}\)/);
  assert.match(native, /image=\{\{ uri: image \}\}/);
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
  assert.match(read("package.json"), /"react-native-view-shot"/);
});
