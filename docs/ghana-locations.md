# Ghana location database: implementation and verification

Updated 28 October 2026. Implemented in the existing repository and imported into
its local database. No commit, push, production deployment, dependency upgrade,
or native configuration change was performed for this task. Earlier rental and
Leaflet changes remain in the working tree.

## Obtained sources and licensing

| Source actually downloaded | Obtained coverage and fields | Licence / treatment |
| --- | --- | --- |
| [GSS Census Atlas](https://statsbank.statsghana.gov.gh/censusatlas/), [direct archive](https://statsbank.statsghana.gov.gh/assets/geofiles.zip) | 27,390,495-byte archive; inspected Districts_261 DBF: 261 records, Label/Region/District. Confirms Guan in Oti and North East spelling. | No explicit geometry redistribution licence found in archive/XML. Used for corroboration only; direct geometries not imported or redistributed. |
| [GSS via OCHA/HDX](https://data.humdata.org/dataset/cod-ab-gha), [metadata API](https://data.humdata.org/api/3/action/package_show?id=cod-ab-gha) | 3,338,019-byte GeoJSON ZIP: 16 regions, 260 districts, stable PCodes, parent codes, names, centres, WGS84 polygons. Version v01 valid 2021-03-08; reviewed 2025-10-30. Resource publication is newer than the boundary vintage. | Explicit metadata licence CC BY 3.0 IGO. Imported licensed district boundaries and administrative records. |
| [GeoNames GH.zip](https://download.geonames.org/export/dump/GH.zip), [field specification](https://download.geonames.org/export/dump/readme.txt), [licence](https://www.geonames.org/export/) | 605,598-byte country extract, 23,675 total features; 15,964 populated records after excluding 33 historical/abandoned/destroyed populated places. Stable IDs, canonical/ASCII/alternate names, coordinates, feature and administrative codes, modification dates. One additional real ADM2 record supplies Guan District. | CC BY 4.0. Country dump, no external geocoding or account required. |
| [Geofabrik Ghana](https://download.geofabrik.de/africa/ghana.html), [PBF](https://download.geofabrik.de/africa/ghana-latest.osm.pbf), [OSM licence](https://www.openstreetmap.org/copyright) | 116,662,788-byte PBF, source page timestamp 2026-10-27 21:23:59 UTC. 12,400 place nodes extracted; 9,318 named nodes retained, 2,934 unnamed/overlong and 148 outside licensed national geometry excluded. Node IDs, place kinds, names, multilingual/alternate/old/local/official names, WGS84 points. | ODbL 1.0. Existing GDAL/ogr2ogr OSM driver; no new package. |

`backend/data/geography/manifest.json` records obtained archive SHA-256 values,
snapshot checksum and source counts. The complete normalized gzip snapshot is
included, so normal deployment imports work offline. The combined derived
reference database is offered under ODbL 1.0, with original contents' source
licences and attribution retained. Credits and a reference-data download appear
in both clients. See [OSMF guidance](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline)
and [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).

## Actual import and quality results

| Category | Local database after import |
| --- | ---: |
| Regions | 16 |
| Districts | 261 |
| Districts with licensed polygons | 260 |
| Canonical localities | 24,105 |
| Locality aliases | 9,876 |
| Source locality identities | 25,282 |
| All source records, including administrative identities | 25,559 |
| Unknown district / unknown region | 49 / 49 |
| Invalid locality coordinates | 0 |
| Inconsistent locality/district/region parents | 0 |
| Exact name + district + coordinate duplicate groups | 0 |
| Normalized administrative duplicate groups | 0 |
| Same-name pairs within 1 km, requiring review | 699 |

The database previously contained 16 regions, 8 districts, 25 localities. Initial
import created 24,080 localities, preserving the old IDs and merging 1,202 source
identities conservatively into canonical places. Imported source counts:
GeoNames 15,965 (15,964 settlements + Guan), GSS/HDX 276 (16 + 260), OSM 9,318.
Raw source aliases total 9,885 before canonical normalization/merging; the table
above reports aliases actually stored. These totals reflect this existing DB;
merges against a different installation's manually created references can differ.

Most parents are point-in-polygon matches against **2021** boundaries, explicitly
labelled `boundary_2021`; they are not asserted to be current verified districts.
Guan is a point-only supplemental district, corroborated by direct GSS and
[GeoNames 13609064](https://www.geonames.org/13609064/guan-district.html).
Its source-reported Oti parent is retained without inventing a polygon. The
crosswalk also corrects the HDX `Northern East` spelling and matches Adenta /
Adentan and Accra Metropolis / Metropolitan without replacing existing IDs.

## Changes and behaviour

- `backend/apps/geo/models.py`: nullable unknown parents, direct region, normalized
  search fields, kind/parent status, curator lock, district boundary, GeoDataset
  and LocationSourceRecord provenance models. Stable existing UUIDs survive;
  new imported UUIDs derive from source identities. Removed the locality-name
  uniqueness constraint because distinct communities can share a district/name.
- `backend/apps/geo/migrations/0003_ghana_reference_data.py`: additive reference
  schema and in-place legacy search/region backfill. Existing PostGIS/pg_trgm
  extensions are reused. GIN trigram indexes and existing parent indexes support
  lookup. Addresses and property coordinates are not rewritten.
- `backend/apps/geo/importing.py`, management commands
  `import_ghana_locations`, `audit_ghana_locations`, compatibility `seed_geo`:
  bounded HTTPS downloads; archive checksums; normalized source identities;
  coordinate/parent validation; conservative unique nearby name matching;
  transaction/advisory lock; safe repeat import. Source facts stay separate from
  canonical rows. Existing user-created rows retain their names/parents/points;
  aliases can be enriched unless locked. Curated imported names/points are detected
  and locked. Set `import_locked=True` before manual parent/alias curation.
  Missing upstream records are retained, not silently deleted or reactivated.
- `backend/apps/geo/search.py`, serializers/views, `apps/api/urls.py`:
  `/api/v1/geo/locations/?q=...&limit=12&page=1` returns ranked, paginated public
  suggestions, parent labels, source identities/licences and available coordinates.
  Exact names/aliases, prefixes, partial matches and trigram similarity work.
  Region/district UUID filters are optional; limit is 10–15, default 12; query
  length and page are bounded. No suggestion lookup downloads upstream data.
  `/geo/regions/`, `/geo/districts/` include provenance/available centres;
  `/geo/localities/` and `/geo/places/*` remain compatible bounded entry points.
  `/geo/dataset/` streams source facts and target IDs; private addresses excluded.
- `AddressSerializer.location_status` marks manually entered text `unverified`.
  A known reference means reference data, not a verified property address.
  Rental/sale text filters include aliases and region names. Related-object
  loading across property/listing/organization and other address consumers was
  extended to avoid N+1 queries for places with unknown districts.
- Web/mobile `locations.ts`, `components/property/LocationAutocomplete.tsx`,
  PropertyWizard, LocationPicker, web PlaceSearch and mobile ExploreHero:
  debounced cancellable database autocomplete, locality + district + region,
  bounded results, attribution, explicit manual unverified entry. Selecting a
  reference stores its ID; editing text clears it. Optional Show area on map
  changes only the viewport; the owner must still choose the actual property pin.
  Canonical text searches keep legacy listings usable without adding a bbox.
  Mobile API requests support cancellation while preserving existing defaults.
- Added importer/API preservation, homonym, unknown-parent, source update,
  curator-lock, alias/typo/ranking, pagination, invalid input, data-export privacy,
  and query-performance tests. Added both clients' reference/location tests and
  mobile cancellation tests; adjusted shared autocomplete contracts.

## Running and updating

From the repository root, with the existing database service running:

```powershell
docker compose run --rm --no-deps -T api python manage.py migrate
docker compose run --rm --no-deps -T api python manage.py import_ghana_locations --dry-run
docker compose run --rm --no-deps -T api python manage.py import_ghana_locations
docker compose run --rm --no-deps -T api python manage.py audit_ghana_locations
```

For an explicit source refresh, stage a candidate first. `--dry-run` prevents DB
writes but can download/build the chosen candidate snapshot:

```powershell
docker compose run --rm --no-deps -T api python manage.py import_ghana_locations --download --snapshot /app/data/geography/candidate.json.gz --dry-run
docker compose run --rm --no-deps -T api python manage.py import_ghana_locations --snapshot /app/data/geography/candidate.json.gz
docker compose run --rm --no-deps -T api python manage.py audit_ghana_locations --show-candidates
```

Review candidate source licences, vintage, checksum and counts before import.
Downloads use ignored `/app/data/geography/raw`; `--build-snapshot` reuses those
archives. `--data-dir` selects another cache. Each build writes a matching checksum manifest (a staged candidate gets its own
manifest without replacing the packaged one). Promote the reviewed snapshot and
its manifest together for future deployments.
Normal `seed_geo` now imports the packaged full snapshot; it makes no network
request. Production rollout must apply migrations and import reference data
before relying on the new client hierarchy. Back up the target DB first.

## Verification

| Check actually run | Result |
| --- | --- |
| `docker compose run --rm --no-deps -T api pytest -q` (final isolated run) | **2,176 passed**, 866 warnings; 345.02 seconds |
| `docker compose run --rm --no-deps -T api ruff check --no-cache .` | Passed |
| `docker compose run --rm --no-deps -T api python manage.py makemigrations --check --dry-run` | Passed; no changes detected |
| `import_ghana_locations --dry-run` | Full packaged snapshot validated |
| Repeat `import_ghana_locations` | 0 localities created/enriched; 0 source identities created/updated; counts unchanged |
| `audit_ghana_locations` | Counts/quality metrics shown above; 0 invalid coordinates or inconsistent parents |
| Web `npm test` | **527 passed**, 0 failed |
| Web `npm run typecheck` | Passed |
| Web `npm run lint` | Passed, 0 errors / 1 existing warning |
| Web Linux-container `npm run build` | Passed, production build and 89 static pages |
| Mobile `npm test` | **456 passed**, 0 failed |
| Mobile `npm run typecheck` | Passed |
| Mobile `npm run lint` | Passed, 0 errors / 227 existing warnings |
| Mobile Android and iOS Expo exports | Passed for both platforms |
| `git diff --check` | Passed |

Production build command used the existing Linux web container, one worker and
bounded heap to avoid Windows file-lock and memory issues:

```powershell
docker compose exec -T -e CIRCLE_NODE_TOTAL=2 -e NODE_OPTIONS=--max-old-space-size=1536 -e NEXT_PUBLIC_API_URL=https://api.danpahq.com/api/v1 web npm run build
```

Mobile export from `mobile/` (uses existing installed dependencies):

```powershell
$env:EXPO_PUBLIC_API_URL='https://api.danpahq.com/api/v1'
$env:NODE_OPTIONS='--max-old-space-size=1536'
npx expo export --platform android --platform ios --max-workers 1 --output-dir ../tmp/ghana-mobile-export
```

These exports compile JS/assets; Gradle/Xcode native assembly and physical
Expo Go rendering were **not** run for this geography change. Backend warnings
include existing missing-staticfiles and long cache-key warnings. Web lint's
remaining warning is an unused variable in an existing property creation test.

An early full backend run found extra property-list queries after adding nullable
parents. Related-object loading was fixed, with query-budget coverage for both
known and unknown districts. Another full run was invalidated by simultaneous
focused/full suites sharing Django's test database (1 failure/17 errors); the
final full suite above ran alone and passed. No application change was made to
hide those test-runner errors. Raw check logs are retained under ignored `tmp/`.

A final browser/API acceptance pass and authenticated owner forms should also
be checked in the intended deployment environment after its reference import.

Browser verification: public web search returned 12 district/region-labelled
suggestions for `Kumsi`, ranked Kumasi first, and selecting it navigated to
`/rentals?q=Kumasi` without introducing a bbox. No property record was modified.

## Coverage gaps and operational limits

This is a substantial national reference database, not proof of every Ghanaian
community or present-day district boundary. The explicitly licensed boundary
release has only 260 districts; Guan has no imported licensed polygon. The 49
unmatched source points keep unknown parents. GeoNames modification dates do not
prove administrative accuracy. OSM is community data: aliases, coordinates and
coverage vary. Only named place nodes are imported; area-only OSM place features
are a known gap. An area-extraction probe did not complete and was stopped;
no area-derived points were invented. Future boundary updates need source review.

The 699 nearby same-name candidate pairs may include true duplicates or distinct
communities; they are not all proven duplicates. The importer only auto-merges a
unique matching name within 200 metres (or a unique compatible legacy row).
Review ambiguous candidates before merging, especially when user records refer
to an ID. Private/free-text locations never become public reference records or
get exposed through the ODbL data offer. No Google service is used.

Physical Android/iOS/Expo Go and authenticated owner-form interaction still need
manual device acceptance; bundle/type/API tests do not establish native runtime
behaviour. The existing map provider and native configuration are preserved.
