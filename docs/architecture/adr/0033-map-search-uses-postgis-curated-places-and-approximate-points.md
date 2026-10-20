# ADR 0033 — Map search uses PostGIS, curated places and approximate public points

**Status:** accepted · 13 September 2026 · Location and map search, web phase ·
supersedes the "No PostGIS in Phase 0" section of ADR 0003 · sections 2 and 5
superseded by ADR 0034 (Google Maps Platform)

## Problem

Tenants look for rentals by place — "East Legon", "Airport", "Adenta" — and
compare them on a map. None of that could be built on what existed:

* **The location field was text.** It suggested Danpa HQ localities by substring
  and nothing else: no towns, regions or landmarks, no ranking, no geometry. A
  client given only a name has to guess where it is.
* **Nothing had a position.** Not one locality or address carried coordinates,
  and no query could be spatial. A map would have had to fetch listings and
  place them itself.
* **The exact address is protected.** ADR 0022 releases the street, house number
  and coordinates only through a confirmed viewing. A map marker is a
  coordinate, so a marker at the property's position would publish what that
  decision withholds.
* **A list and a map built separately drift.** If the cards and the markers are
  answered by different filters, they will describe different rentals on the
  first day one gains a filter the other lacks.

## Decision

### 1. PostgreSQL gains PostGIS and trigram search

The trigger ADR 0003 named has arrived: property search needs spatial queries.
The database runs `postgis/postgis:16-3.5-alpine` locally — the same Alpine base
as before, so existing volumes keep their collation — and production needs the
`postgis` and `pg_trgm` extensions allowed. Migration `geo.0002` creates both
explicitly, so a database that refuses them fails on a line naming them.

GeoDjango loads GDAL, GEOS and PROJ from the API image. They come from Debian
**bookworm** (GDAL 3.6, GEOS 3.11), versions Django 5.1 supports. The trixie
packages (GDAL 3.10, GEOS 3.13) are newer than Django 5.1 supports, and with
them the test process segfaulted while creating its database on one run in
two. Moving to trixie waits for Django 5.2.

### 2. A place is a curated table, imported from OpenStreetMap

`geo.Place` is what somebody types: a slug, a name, a kind (region, district,
city, town, suburb, neighbourhood, village, landmark), a context line ("Accra,
Greater Accra"), aliases, a centre, a bounding box and an importance.
`import_osm_places` builds it from an Overpass export: it merges a place mapped
as both point and outline, takes a mapped outline's box or estimates one from the
kind, reads each place against its region, district and nearest city, and links
Danpa HQ's localities by name — giving a locality without coordinates its
matched centre.

The places table is derived from OpenStreetMap, so it carries the ODbL, and
every map carries "© OpenStreetMap contributors". Suggestions rank the exact name
first, then a name starting with the typed text, then a later word; closeness of
spelling (a GIN trigram index), then importance, break ties.

A place links to a locality, and the link is load-bearing. Listings are *filed*
under localities, so a search for the place includes everything filed there
whether or not it has a point.

### 3. A listing publishes an approximate point, and the backend decides it

`Listing.public_point` is derived by `apps.listing.location` and indexed with a
partial GiST index on active listings:

* **area** — the property's own coordinates snapped to the centre of a fixed
  0.0027° grid cell, about 300 m. It is stable, so repeated reads cannot be
  averaged towards the door.
* **locality** — the neighbourhood's centre while the property has none, which
  the map draws as a stack.

Neither is the address, and no client ever receives the address's coordinates
from a public endpoint. The payload says which precision it is and gives the
radius to draw, so the detail page shows an area, never a pin on a door.

### 4. One search answers the list and the map

`apps.listing.search.filtered_listings` applies eligibility (`public_listings`),
every filter and the area for both `GET /listings/` and `GET /listings/map/`. The
area is an explicit box ("Search this area") or, failing that, a place's box
plus what is filed under its locality.

The map endpoint groups results on a grid of fixed cells about 88 screen pixels
wide at the requested zoom, so a cluster does not change members as the map pans.
It returns at most 400 features, densest first. A cell holding one listing is a
price marker; several listings on one point are a stack that carries their ids,
so a tap previews them instead of zooming into a point that never separates.
Markers are drawn for the window on screen, while the count and extent belong to
the search — a pan asks for markers with `summary=false`.

### 5. The basemap is self-hosted and reached through configuration

MapLibre GL renders Protomaps' OpenStreetMap basemap, cut to Ghana as one PMTiles
archive and read by range request. The archive and its label fonts live in a
separate public-read bucket, the only public bucket: basemap tiles are the same
public geography for every visitor, and the upload bucket stays private and
signed. Clients read `GET /map/config/` for the tile, font and attribution
addresses, so moving the basemap to a CDN or another source is a setting.
Danpa HQ's flavour of the style keeps the map quiet so markers carry the colour.

MapLibre 6 looks for its worker beside its own module, which webpack rewrites
into a `file://` path. The web app serves the two worker modules from
`node_modules` through an allow-listed route and names that URL.

### 6. On the web, the search lives in the address bar

`exploreQuery` is the whole search: place, box, filters, sort and view. The
location field, the pills, the panel, the cards, the map and the count all read
it, and `listingSearchParams` is the only thing that turns it into API
parameters. Choosing a place opens the map and pushes a history entry; closing
the map changes the view and nothing else. Refreshing, going Back or sharing the
link returns to the same search, and a failed request keeps the last results
rather than clearing them.

## Consequences

* The dev stack needs the PostGIS image and a GIS-capable API image; production
  needs the two extensions, the map bucket (or CDN) and its CORS rule for range
  requests. `docs/deployment/DEPLOY.md` lists them.
* Places and tiles are data to refresh, not code: re-running the import updates
  places in place (slugs are stable), and a newer extract replaces the archive.
  `docs/runbook.md` has the commands.
* Boxes approximate areas. A search for a place is its bounding box plus what is
  filed under its locality, not its polygon; polygons are a later refinement
  that needs no API change.
* Most listings will sit at their neighbourhood centre until properties carry
  coordinates. A pin-drop in property setup (stored unconfirmed and snapped
  before publication) is the next data step.
* Deliberately not yet: an external geocoder for street addresses, vector-tile
  markers for very large marker counts, a CDN in front of the map bucket, and
  the mobile map, which follows this web phase.
