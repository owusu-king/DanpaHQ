# Danpa HQ post-optimization remediation

November 17, 2026. The starting staging branch was `afb6e0e`. The prior route inventory and its 522 signed-out visits are in the [performance audit](post-optimization-performance.md). The isolated release worktree contains backend performance changes and regression tests. The wizard work in the main checkout is separate.

| Finding | Status | Evidence |
|---|---|---|
| Geography release and importer | Already fixed and verified | The staging receipt still matches the packaged snapshot and importer. GitHub recorded a successful database release for `afb6e0e`. The receipt check precedes district reconciliation, and the release is the caller that supplies `--skip-if-current`. Tests exercise receipt reuse and changed input. |
| Shared Pooler Egress | Blocked or awaiting evidence | The prior 0.07 GB and 5.54 GB numbers are user-reported and cover different windows. Statement counts and bytes of local result values are separate measurements. Billing exports are unavailable. |
| Outbox idle work | Fixed and verified locally | Idle dispatch now needs one existence query and no lock transaction. The checks for due retries and abandoned claims use the same predicates as the locking queries. Busy delivery still uses `SKIP LOCKED`, preserves retries and can reclaim abandoned work. |
| Staging scheduling cadence | Blocked or awaiting evidence | Before release, both claim fingerprints rose by 255 over 1,280 seconds, consistent with the earlier five-second observation. The repository specifies 15 seconds, and one granted advisory lock was visible in the samples. Those measurements establish a cadence mismatch. They leave the deployed service revision and source of the extra dispatches unresolved. |
| Provider Units | Fixed and verified locally | The existing batched scope-preserving implementation is included in the release patch. Query count was 11 for two, three and seven units on local fixtures. |
| Sales catalogue | Fixed and verified locally | The paged read batches review and seller data, reuses approved evidence with file metadata, avoids fetching district polygons and stops once the cover has been chosen. Results and the full detail/gallery contract were preserved in tests. |
| Rentals Explore | Still outstanding | The All view issues Rentals and Sales in parallel and renders available list results as each settles. The backend Sales improvement removes one avoidable delay. Browser paint and real catalogue completion must be measured after the runtime deploy. The Rent and Buy views use their own respective endpoints. |
| Local authenticated navigation | Fixed and verified locally | Real local tenant and provider browser sessions exercised password sign-in, cookie-only restoration and 26 route observations on the final export. Documents and Tenants each dropped one API read. |
| Authenticated staging and administrative journeys | Blocked or awaiting evidence | The existing Chrome profile was unavailable to the browser control tool and no staging session could be established in the in-app browser. Populated payment, record-detail, admin and staging Units runs remain incomplete. |
| Finance portfolio projection | Fixed and verified locally | Finance preserves the money, payout, property capability and active tenant fields and omits unrelated archived tenancy and access work. It went from 64 to 21 statements on the matched fixture. |
| Local compiler overhead and infrastructure attribution | Still outstanding | The existing audit separates native development, Docker development, and staging export. This patch makes no hosting tier, connection pool, index or worker-count change. Render queue time and remote round-trip time still require independent telemetry. |

## Like-for-like local measurements

Both handlers ran alternately against the same PostGIS dataset. Values are in milliseconds from 20 warmed requests per handler. SQL timing is measured from Django through the database driver with results buffered. The route measurements include authentication middleware where applicable, API dispatch, serialization and response rendering.

| HTTP operation and fixture | SQL statements before → after | Request p50/p95 before → after | SQL p50/p95 before → after | JSON bytes |
|---|---:|---:|---:|---:|
| GET /api/v1/sales/, one verified land sale | 11 → 4 | 33.29/49.93 → 19.17/23.45 | 10.04/14.48 → 6.56/7.58 | 858, identical |
| GET /api/v1/organizations/:id/units/?view=cards, three units | 24 → 11 | 49.14/59.52 → 22.64/31.58 | 15.47/19.32 → 6.46/9.12 | 1,640, identical |

The Sales list uses the same evidence eligibility, publicly verified sale rules, redacted address, and seller-label precedence. The outbox regression checks idle polling with a future retry present. The separate existing recovery tests exercise normal dispatch, claim recovery, failed retries and dead-letter behavior. The extra startup headers identify the exact staging Render commit and configured interval without a database connection. Production responses keep their existing contract.

## Staging before rollout

Twenty sequential requests per endpoint, excluding the first warm-up. Values are milliseconds. JSON lengths are decoded.

| Operation | End-to-end p50/p95 | Django p50/p95 | JSON bytes |
|---|---:|---:|---:|
| GET /healthz | 194.20/432.22 | 0.44/0.81 | 36 |
| GET /api/v1/listings/ | 407.62/439.74 | 207.38/235.47 | 8,682 |
| GET /api/v1/sales/ | 532.91/564.63 | 336.46/357.48 | 1,306 |

Five warm home-to-Rentals clicks had a 90 ms median URL change, no new document, two catalogue requests and a 1,068 ms median until both responses finished. The preceding three-visit signed-out staging sweep observed 2,556 ms median LCP. The warm click measurements do not measure paint. Differences in live local and staging catalogue data preclude a direct speedup estimate from those two environments alone.

## Changed code and validation

- [Sales view](../backend/apps/sale/views.py), [Sales read model](../backend/apps/sale/read_models.py), [Sales serializer](../backend/apps/sale/serializers.py), [photo eligibility](../backend/apps/listing/serializers.py) and [property read models](../backend/apps/property/read_models.py) implement batched catalogue reads.
- [Organization Units](../backend/apps/organization/views.py), [Unit serializers](../backend/apps/property/serializers.py), [occupancy service](../backend/apps/occupancy/services.py) and [condition reviews](../backend/apps/trust/condition.py) contain the existing Units remediation.
- [Outbox dispatch](../backend/apps/outbox/tasks.py) and [liveness](../backend/apps/core/health.py) reduce idle work and report staging release diagnostics.
- Local Ruff passed. The broad local run passed 216 tests covering Sales, media, outbox, Units, auth, workspace journeys, API contracts, geography and scheduler settings. The final targeted run passed 18 tests, including expanded Sales query-count and release diagnostics assertions. The paired benchmark passed its nine-test instrumented run after its request timing was separated from the regression query counter.

## Authenticated local browser findings

Chrome performed password sign-in and cookie restoration against a real, loopback-only Django service backed by an isolated PostGIS database. The two synthetic users had a tenant workspace and a provider portfolio with one property and three units. Tests used a locally served static export with the API origin pointed at the fixture service. These timings exclude staging transport and do not use production credentials. The fixture has no occupied tenancies, completed payments or live integrations.

- The two password submissions reached the intended portal route in 395 ms and 282 ms. With the local hint removed and the real refresh cookie retained, tenant and provider reopened their respective private routes in 111 and 117 ms. Each restoration used one document and one refresh with the account projection. The requests contained no separate account lookup.
- The 24 sign-in, entry and subsequent navigation observations covered Home, Rentals, Applications, Viewings, Payments, Artisans, passports, Updates and Settings on the tenant side, and Home, Properties, Units, Viewings, Applications, Documents via the legacy Leases route, Tenants, Finance, Provider Passport, Updates and Settings on the provider side. Some steps intentionally used a direct URL when the current page lacked the matching sidebar link.
- The initial provider Documents trace fetched granted leases twice. The first read mounted before portfolio scope resolved, then another read used the resolved portfolio. Tenants fetched the organization list and then the portfolio. The follow-up uses the validated session portfolio first and keeps the legacy lookup only for a missing scope. It does not change the provider passport selector or settlement permissions, which depend on the list of eligible portfolios.
- The full provider portfolio remained the heaviest observed internal endpoint. On the one-property, three-unit fixture it took 64 queries, 3,614 bytes and 152.45/188.85 ms in-process p50/p95. The Home projection used 11 queries, 1,978 bytes and 25.80/27.66 ms. Provider property collection measured 15 queries and 51.19/58.52 ms. The tenant passport used five queries and 13.51/16.24 ms. The remaining empty tenant collection reads typically used two queries. These percentile estimates use ten warmed repeats per endpoint and a small fixture. Broad Finance and Tenants portfolio projection cost is still outstanding.

The staging account traces depend on access to a signed-in test tab for each role. The desktop Chrome profile and the in-app browser use separate sessions. These local results establish real authentication and scoped navigation for the fixtures, with timing coverage still open for populated payments, rich record details, administrative workflows, session expiry and matched staging runs.


## Follow-up checks

- On the real local browser rerun, the Documents Leases view went from two granted-lease requests to one scoped request. Tenants went from an organization lookup followed by a portfolio read to one portfolio read. Both versions used one document for the directly opened legacy Leases URL, including its client-side replacement. The warm Tenants click used zero new documents.
- In the rerun with cookie-only entry, the tenant reached Home in 115 ms and the provider reached Properties in 148 ms. Neither showed the public landing content during restoration. After the fixture browser's refresh cookie was removed, the root showed the public entry following one 401 in each role. These are single local observations.
- Finance now requests a read projection that omits archived tenancies, tenancy requests and access-code preparation. The same scoped fixture measured 64 → 21 SQL statements, 122.28/171.27 → 54.16/65.17 ms request p50/p95, 53.12/74.30 → 21.53/24.17 ms SQL p50/p95, and 3,614 → 2,304 JSON bytes. The exercised money, settlement, payment, portfolio scope and active tenant fields match the full response. Older servers can still return the full payload to the new client. The Finance, rent and money lifecycle regression run passed 87 tests.
- GitHub passed client and backend checks and the staging database release for `1dda01a`. A later public request still used the old geometry-bearing Sales statement. Both locking outbox fingerprints continued rising about every five seconds. The staging health endpoint had no new release header at that sample. GitHub deployment preparation and the live Render runtime are independently verified. [Staging release run](https://github.com/owusu-king/DanpaHQ/actions/runs/44134764087)

## Release checkpoints

The first backend remediation is `1dda01a`. GitHub passed all applicable release gates. The navigation and Finance follow-up is `b5327e4`, pushed as a fast-forward to staging. Release commands ran in a separate worktree based on the staging branch. The final local export, lint, type check and 597 web tests passed. Chrome’s final signed-in run captured 26 observations and zero uncaught page errors. It confirmed the new Finance view returned 2,304 bytes, the Units card read used one request, Documents used one scoped lease read, and Tenants used one portfolio read. The temporary Django service was stopped after verification.

The final web export succeeded on retry following the existing framework advisory warning. Staging still pins Next.js 16.4.2. The separate previously verified Next.js 16.4.6 security update is on its own local branch.

[First staging release](https://github.com/owusu-king/DanpaHQ/actions/runs/44134764087) · [Follow-up staging release](https://github.com/owusu-king/DanpaHQ/actions/runs/44139094269)


## Live staging recheck

Both GitHub Actions runs passed their backend, web, mobile and staging database release jobs. At 3:45 p.m. Chicago time on November 17, the live staging API still lacked the release marker. A new Sales request continued to use the district-boundary query. Each old locking outbox fingerprint gained 2,996 calls in about 4 hours 10 minutes, still roughly one dispatch every five seconds. The nonlocking idle fingerprint was absent. The geography receipt still matched. One staging Sales request spent 549 ms in Django. This single observation is not a percentile. The evidence shows the backend candidate was not serving those requests, and the exact running Render commit remains unknown.

The signed-in Chrome handoff succeeded on the recheck. An approved provider's Home, Units, Finance and Documents Leases deep link rendered. A separate in-review provider session showed its limited portal. Units and Finance displayed loading states during direct entry. The browser check established route behavior without a reliable network waterfall or browser-native timing series. Approved tenant, admin, record-detail and post-release authenticated timing remain outside the completed coverage.

The next deployment step is to inspect the staging service's deployment history and deploy the current staging tip `5460536` if Render has not picked it up. This tip contains both remediation commits plus the subsequent Explore duplicate-read fix. Its backend, web, mobile, and staging database release jobs passed. Then verify `X-Danpa-Release` and `X-Danpa-Outbox-Interval` via `/healthz`, repeat the Sales and Rentals samples, and confirm the idle fingerprint and cadence in PostgreSQL. [Current staging CI run](https://github.com/owusu-king/DanpaHQ/actions/runs/44139733316)

