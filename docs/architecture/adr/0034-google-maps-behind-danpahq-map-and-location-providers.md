# ADR 0034 — Google Maps behind Danpa HQ's map and location providers

**Status:** accepted · 14 September 2026 · Location and map search, web and
mobile · supersedes sections 2 ("A place is a curated table") and 5 ("The
basemap is self-hosted") of ADR 0033

## Problem

ADR 0033 gave Danpa HQ a map and place search built on OpenStreetMap. Three
things about it did not hold up:

* **The data was manual work.** Places came from an Overpass export imported by
  hand, and the basemap from a PMTiles extract and a font folder republished to
  a public bucket with its own CORS rule. A fresh environment had no map at all
  until someone repeated both.
* **Search knew only what the import knew.** It had no street addresses, and
  landmarks only as current as the last export. Property location capture — the
  next step, and the one that gives listings real positions — needs addresses a
  person recognises.
* **The phone had no map.** Drawing the same self-hosted basemap natively would
  have meant a second renderer and a second style to maintain.

Danpa HQ chose Google Maps Platform for maps, place suggestions and, later,
address capture. Its terms shape the code: every request is billed; Places
sessions are billed as sessions only when their tokens are used correctly; the
response fields requested decide the price tier; Google data shown without a
Google map must be attributed; coordinates from Places may be cached for at
most 30 days; and a key inside a browser bundle or an app is public, protected
only by its restrictions.

## Decision

### 1. Google is a provider behind Danpa HQ's interfaces, never part of the domain

Each layer talks to an interface of Danpa HQ's, and one folder per layer knows
the implementation:

* **API** — `apps.geo.providers.LocationProvider` has two operations, `suggest`
  and `resolve`, returning neutral `PlaceSuggestion` and `ResolvedPlace` values:
  provider, reference, display name, kind (area, landmark or address), centre
  and bounds. `GooglePlacesProvider` implements it with Places API (New), and
  `LocalityProvider` with Danpa HQ's own localities.
* **Web** — `web/src/lib/maps` defines `DanpaHQMap`: fit, markers, areas, moves
  and a background click. Only `lib/maps/google/` loads the Maps JavaScript API.
* **Phone** — `mobile/src/maps` defines the `DanpaHQMap` component. Only
  `DanpaHQMap.native.tsx` imports `react-native-maps`.

No Property, Unit or Listing field names Google. Contract tests on both clients
fail when Google code appears outside its folder.

### 2. Places are asked through Danpa HQ's API, never by a client

* `GET /geo/places/suggest/?q=…&session=…` calls Autocomplete (New) with
  `includedRegionCodes` (`GOOGLE_PLACES_REGION_CODES`, default `gh`),
  `regionCode`, `languageCode` and a field mask of each prediction's place ID,
  structured format and types.
* `GET /geo/places/resolve/?provider=…&reference=…&session=…&name=…` calls Place
  Details (New) with the field mask `id,location,viewport,formattedAddress,types`,
  all from the Essentials tier. `displayName` would move every resolve to Pro,
  and the chosen suggestion already carries the name.
* The Geocoding API is not used: a chosen suggestion's details carry its
  coordinates and viewport. Reverse-geocoding a confirmed pin is the one later
  use in view.

The proxy keeps the Places key on the server, restricted by IP address. It lets
a throttle (`places`, 240 requests a minute per person or address) bound what
one client can spend, lets a failure fall back instead of breaking the field,
and lets the provider change without a client release.

**Session tokens.** A client makes a version 4 UUID with its first suggestion
request, sends it with every later suggestion and with the resolve, and drops it
once the resolve is made or the field is cleared. The next search starts a new
session. Suggestions are answered with `Cache-Control: no-store`.

**Without Google.** `LOCATION_PROVIDER=google` without `GOOGLE_MAPS_SERVER_API_KEY`
answers from the localities. A Google error while suggesting falls back to them
as well, logged as `place_suggestions_fell_back`. Resolving a Google reference
while Google is unavailable is a 503, never a guess.

**Attribution.** Google's suggestions appear without a Google map beneath them,
so the web and the phone print "Google Maps" under them.

### 3. What Danpa HQ keeps is neutral

* **Explore's address** carries `area_name`, `area` (west, south, east, north)
  and `area_ref` (`provider:reference`). A reload or a shared link rebuilds the
  search with no lookup. The `place=<slug>` parameter of ADR 0033 is no longer
  read.
* **Storage follows Google's terms.** A selected Property location keeps the
  provider name, Place ID and display label on its private Address. Coordinates
  from a suggestion are not persisted as Property coordinates. Explore itself
  stores neither; the web remembers recent search places in the browser and
  forgets each after 30 days.
* **Public listing points stay Danpa HQ's own** (ADR 0033 §3): snapped from the
  property's coordinates or taken from the locality's centre, never copied from
  Google.
* **Property location capture** uses the same provider with `scope=areas`, so
  the creation field finds Ghanaian towns and neighbourhoods beyond the starter
  Locality seed without offering businesses or street addresses. A Danpa HQ
  fallback choice keeps its controlled Locality FK. An external choice keeps
  its display name, context, `provider` and `provider_reference` on Address;
  it does not create a fake Locality row. Pin confirmation will later add the
  Property's own point and bounds. The suggestion centre is never stored as
  though the provider confirmed the front door.

### 4. The web draws Google Maps with Danpa HQ's markers

`@googlemaps/js-api-loader` loads the weekly Maps JavaScript API in English for
Ghana, and the map is restricted to Ghana's bounds. Price pills, clusters and
stacks stay Danpa HQ's own HTML inside Advanced Markers, which need a Map ID:
`NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`, falling back to Google's `DEMO_MAP_ID` in
development and to nothing in production.

A build without a key or a Map ID never loads Google: the map says it is not
available and the list stays. A key Google refuses (`gm_authFailure`) ends the
same way, rather than as Google's darkened map. Points of interest are not
clickable, so Google's place cards never open over a rental search. Clustering
stays on the server (ADR 0033 §4); a client-side clusterer remains possible and
is not needed.

### 5. The phone draws native maps through react-native-maps

* **Provider.** `PROVIDER_GOOGLE` on Android; Apple's default provider on iOS
  in both Expo Go and release builds.
* **Keys.** `mobile/app.config.js` writes `GOOGLE_MAPS_ANDROID_API_KEY` into
  native configuration. JavaScript learns only whether the Android key exists
  (`extra.googleMaps`). An Android build without it shows Explore as a list;
  Apple Maps on iOS needs no Google key.
* **Explore is map-first.** One search bar and one Filters button sit over the
  map; the rentals rise in a sheet that collapses to its count, opens halfway,
  or covers the map under the controls. A marker opens a preview, a stack pages
  through its rentals, a cluster zooms in, and "Search this area" appears once
  the tenant has moved well away from where the results were shown, riding just
  above the sheet and never over it.
* **Markers on Android are images.** react-native-maps snapshots a custom
  marker's views into a bitmap it sizes from a layout hook the New Architecture
  never calls, so every snapshot was a 100×100-pixel square and a price pill was
  cropped on dense screens. Android draws each marker face once, offscreen, with
  `react-native-view-shot`, and places that image at its pixel size; iOS places
  the live face.
* **"This area" is what the tenant can see.** The map measures the rectangle
  between the header and the sheet on screen (`coordinateForPoint`), because
  providers differ on whether a reported region leaves out the map's padding.
  `mapPadding` keeps Google's logo above the sheet.

### 6. OpenStreetMap is removed

Gone: `geo.Place` (migration `geo.0003`), `import_osm_places`,
`publish_map_assets`, `ops/fetch-osm-places.mjs`, the MapLibre worker route; the
MapLibre, PMTiles and Protomaps packages; the `MAP_ASSETS_*`, `MAP_TILES_*` and
`MAP_ATTRIBUTION` settings; and the public map bucket. `GET /map/config/` now
answers only the bounds, the opening view and the zoom limits. PostGIS, the
approximate public point and the one filtered search of ADR 0033 stay.

## Consequences

* **Three keys and a Map ID to operate** — server, web and Android, each
  restricted to its surface and its one API — plus a billing budget and quotas.
  `docs/deployment/DEPLOY.md` §1 has the keys, and
  `docs/runbook.md` the local steps.
* **Cost now follows use.** Google bills suggestions and resolves under its
  session rules, and web map loads per load. The throttle bounds one client; the
  budget and quotas bound the whole.
* **No Google keys is a supported state.** Android Explore is a list while iOS
  still draws Apple Maps; suggestions come from
  localities that have a centre. `seed_geo` seeds names without centres, so a
  fresh database suggests nothing until centres exist.
* **Locality centres copied from OpenStreetMap stay where that import ran.**
  Databases that ran it keep deriving public points from those centres. A
  production database never ran it.
* **Changing provider later** means another `LocationProvider` and another
  `DanpaHQMap`. Stored references stay readable, because every reference travels
  with the name of its provider.
* **Deliberately not yet:** the pin-confirmed Property point and bounds,
  reverse geocoding, a client-side clusterer, cloud-based styling on the
  Map ID, and Places photos, ratings or opening hours.
