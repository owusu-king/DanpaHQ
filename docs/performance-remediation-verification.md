# Danpa HQ performance remediation verification

November 17, 2026. This report supplements the [post-optimization audit](post-optimization-performance.md) and [remediation measurements](performance-remediation.md). Local browser observations used real Django password authentication and disposable tenant and provider fixtures on PostGIS. The public staging API measurements used the live hostname.

## Findings

| Area | Status | Verified outcome |
|---|---|---|
| Staging geography receipt and importer | Already fixed and verified | The existing staging receipt matches the packaged snapshot and importer. The GitHub database release for `1dda01a` reported `skipped: true` with fingerprint `54e3f2bb…1cf7`. The release checks the receipt before loading stored district boundaries. |
| Local geography on API container startup | Fixed and verified locally | Compose forced the seed on every API restart. It now passes `--skip-if-current`, using the same receipt check as staging. The earlier paired importer benchmark recorded 1,964 statements and 29,690,266 bytes of database result values on a forced repeat versus two statements and one byte on reuse. The resolved Compose command was checked and all 21 geography integration tests passed on a disposable local PostGIS database, including equal fingerprints, manual imports and changed input. |
| Supabase Shared Pooler Egress | Blocked or awaiting evidence | The database counters establish query activity. An equivalent-window Supabase billing export is still needed to quantify network egress. The reported 0.07 GB and 5.54 GB cover different windows. |
| Outbox idle SQL | Fixed and verified locally | The candidate uses one existence query when idle. The due and stale predicates match the locking paths. Busy dispatch retains the locking, retries and abandoned-claim recovery. |
| Effective staging outbox cadence | Still outstanding | The locking outbox statements increased by 54 over 133.14 seconds with no rows returned. They increased by 5,892 over the subsequent 14,774.11 seconds, consistent with two queries per 5.01-second tick. PostgreSQL statistics had the same reset timestamp. Each observation showed one granted advisory lock and none waiting. The checked-in schedule is 15 seconds. Render process inventory and scheduler logs are required to identify the source of dispatches. |
| Provider Units | Fixed and verified locally | The three-unit paired run reduced 24 to 11 statements and 49.14/59.52 to 22.64/31.58 ms request p50/p95. The 1,640-byte JSON response was identical. The two- and seven-unit fixtures also used 11 statements. The staging authenticated run remains open. |
| Sales catalogue API | Fixed and verified locally | The one-sale paired run reduced 11 to four statements and 34.46/39.52 to 19.35/22.31 ms request p50/p95. The 858-byte JSON response was identical. Batching replaces repeated review and seller reads and keeps district polygons outside the card query. |
| Rentals and Sales on signed-in Explore reload | Fixed and verified on staging | Session restoration previously mounted the public catalogue and then remounted it under the portal shell. Six comparisons per build with real local sign-in recorded four catalogue requests before and two afterward. The live Cloudflare bundle contains the guard, and five staging browser visits with synthetic session restoration each issued exactly one Rentals and one Sales request to the live API. Real staging account timing remains open. |
| Guest Explore LCP and transport | Still outstanding | The original live LCP was 2.56 s. The current staging warm API sample is below. The first usable listings and sale cards still need comparable traces against the confirmed deployed candidate. |
| Documents, Tenants and Finance | Fixed and verified locally | Documents went from two granted-lease reads to one scoped read. Tenants went from two serial portfolio-related reads to one. The Finance projection reduced 64 to 21 statements, 122.28/171.27 to 54.16/65.17 ms request p50/p95, and 3,614 to 2,304 decoded JSON bytes on the same fixture. |
| Landing, role resolution and session restoration | Fixed and verified locally | The fixture browsers completed real password sign-in. With the local hint cleared, an existing cookie opened tenant Home and provider Properties in 115 and 148 ms on the follow-up run. Neither showed the public landing content. Removing that cookie returned both to the public entry after one 401. |
| Authenticated application audit | Blocked or awaiting evidence | Local visits cover Tenant Home, Provider Home, Properties, Units, Explore, Applications, Viewings, Documents, Tenants, Finance, Payments, Artisans, passports, Updates, Settings and settlement settings. These observations include empty tenant workloads and single warm visits. Populated financial and record details, administrative workflows, broad back/forward coverage, role restriction and expiry traces, and matched staging percentiles remain open. An existing desktop Chrome tenant session showed the live Explore workspace, but browser automation stopped when it could not verify the current browser URL. That view is not a staging performance sample. |
| Runtime, database connections and cold starts | Still outstanding | The checked-in Free staging profile specifies one Gunicorn request slot, one solo Celery worker and leased beat. Live readiness reports the staging environment. A single readiness request measured 54.27 ms on the PostgreSQL probe and 1.79 ms on the cache probe. The warm HTTP versus Django gap also appears on the database-free liveness endpoint. Render accept time, actual connection reuse and saturation, and controlled instance cold starts remain unmeasured. |

## Additional measurements

The Explore comparison runs the same local browser probe and Django fixture against two static exports. The first member reload was excluded from the paint median because the baseline had an 8.5-second outlier. Across the remaining five warm reloads per build the observed median LCP was 328 to 184 ms. Guest LCP was 900 to 932 ms across three visits per build. The confirmed result is the elimination of the duplicate catalogue requests. Paint estimates are small-sample local observations.

The staging API sample used twenty warm sequential requests after one warm-up per endpoint. Every measured response was HTTP 200. Sizes are decoded JSON. These measurements were collected while the live API still lacked the candidate release diagnostics.

| Endpoint | HTTP p50/p95 ms | Django p50/p95 ms | Bytes |
|---|---:|---:|---:|
| `GET /healthz` | 199.58/395.86 | 0.43/0.65 | 36 |
| `GET /api/v1/listings/` | 411.14/431.76 | 218.93/231.73 | 8,682 |
| `GET /api/v1/sales/` | 535.69/582.14 | 322.36/353.05 | 1,306 |

The end-to-end HTTP intervals include the hosting edge, network and request queue as well as Django. The difference between these intervals does not identify Render queue time. The outbox snapshots contained 155 published and six dead-letter events with no pending, processing or failed events. Those snapshots do not measure event delivery latency under load.

A further 45.44-second PostgreSQL sample scoped to the runtime role recorded 18 outbox lock reads, 36 transaction-control statements, 46 simple SELECT probes, nine other reads, and zero geography reads. The lock reads returned zero rows. The normalized probe text is shared by several callers, so the telemetry does not attribute those 46 reads to a particular health check or process. These counts measure SQL and returned rows. Supabase-billed bandwidth was unavailable.

The resumed staging Explore browser run used five fresh guest contexts, five warm landing-to-Explore clicks, and five fresh contexts with synthetic workspace restoration. Every catalogue response returned HTTP 200 and no page reported an uncaught error. Fresh guest median document load was 881 ms and median LCP was 2.72 s, with one 13.22 s LCP observation. Warm clicks changed the URL in a median of 35 ms and finished both catalogue responses in 1.40 s, with no additional document loads. Synthetic restoration mounted the portal in all five runs before dispatching the two real catalogue requests. The auth response in those five runs was supplied by the fixture. These are browser-context measurements. The hosting instance's cold or warm state was not controlled.


## Signed-in local route trace

This table records one observation per role and action from the final local authenticated browser run. URL and settle are elapsed milliseconds. Settle is the end of the observed API activity after removing the probe's quiet window. HTTP and Django ranges describe the calls on that single visit. Empty collections are included and would cost more with larger records. LCP is available only on actions that loaded a document. The browser's resource-body counts exclude HTTP headers. The earlier Django fixture benchmark reports per-endpoint SQL counts and timing separately.

| Role | Action | URL / settle (ms) | Documents | LCP (ms) | Calls | HTTP min–max (ms) | Django min–max (ms) | Body bytes |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Tenant | password sign-in | 434 / 858 | 0 | — | 7 | 19–192 | 11–134 | 3,358 |
| Tenant | cookie-only entry | 150 / 356 | 1 | 180 | 7 | 44–73 | 7–59 | 3,358 |
| Tenant | `/rentals` | 70 / 606 | 0 | — | 2 | 43–73 | 33–65 | 84 |
| Tenant | `/applications` | 47 / 469 | 0 | — | 2 | 14–21 | 11–16 | 4 |
| Tenant | `/viewings` | 37 / 545 | 0 | — | 1 | 13–13 | 10–10 | 2 |
| Tenant | `/payments` | 29 / 561 | 0 | — | 2 | 21–25 | 14–16 | 4 |
| Tenant | `/artisans` | 31 / 544 | 0 | — | 2 | 13–19 | 6–14 | 58 |
| Tenant | `/passport` | 41 / 563 | 0 | — | 2 | 17–27 | 9–20 | 995 |
| Tenant | `/updates` | 23 / 548 | 0 | — | 1 | 11–11 | 6–6 | 50 |
| Tenant | `/settings` | 92 / 389 | 1 | 372 | 4 | 21–63 | 11–48 | 3,555 |
| Tenant | missing refresh cookie | 135 / 230 | 1 | 132 | 1 | 4–4 | 1–1 | 150 |
| Provider | password sign-in | 279 / 696 | 0 | — | 8 | 54–202 | 6–182 | 9,371 |
| Provider | cookie-only entry | 149 / 456 | 1 | 208 | 3 | 53–90 | 6–82 | 7,353 |
| Provider | `/home` | 43 / 558 | 0 | — | 6 | 38–96 | 26–84 | 5,464 |
| Provider | `/properties` | 47 / 253 | 0 | — | 1 | 78–78 | 72–72 | 3,446 |
| Provider | `/units` | 26 / 546 | 0 | — | 1 | 27–27 | 22–22 | 1,645 |
| Provider | `/viewings` | 33 / 560 | 0 | — | 1 | 21–21 | 16–16 | 2 |
| Provider | `/applications` | 40 / 677 | 0 | — | 4 | 13–176 | 7–168 | 3,857 |
| Provider | `/leases` | 86 / 396 | 1 | 192 | 3 | 42–65 | 4–39 | 3,909 |
| Provider | `/tenants` | 52 / 588 | 0 | — | 1 | 127–127 | 122–122 | 3,614 |
| Provider | `/payments` | 32 / 564 | 0 | — | 3 | 34–102 | 23–92 | 5,752 |
| Provider | `/provider-passport` | 48 / 561 | 0 | — | 2 | 10–71 | 8–66 | 1,840 |
| Provider | `/updates` | 27 / 450 | 0 | — | 1 | 14–14 | 7–7 | 50 |
| Provider | `/settings` | 73 / 362 | 1 | 188 | 3 | 18–54 | 6–44 | 3,909 |
| Provider | `/settings/settlement` | 74 / 392 | 0 | — | 3 | 11–61 | 7–12 | 467 |
| Provider | missing refresh cookie | 156 / 251 | 1 | 160 | 1 | 7–7 | 2–2 | 150 |

The run observed zero uncaught page errors across 26 observations. The missing-cookie checks intentionally received a 401.

## Changes and next verification

- `1dda01a` contains the Units and Sales read models, outbox idle query and release diagnostics. Its [GitHub staging database release](https://github.com/owusu-king/DanpaHQ/actions/runs/44134764087) passed.
- `b5327e4` contains the scoped Documents and Tenants reads and the smaller Finance projection.
- `5460536` contains the Explore change in [the Rentals page](../web/app/rentals/page.tsx) and its [Explore contract test](../web/src/lib/exploreMap.contract.test.mjs). It was pushed to staging and passed [all applicable GitHub release checks and the database release](https://github.com/owusu-king/DanpaHQ/actions/runs/44139733316). The isolated branch passed 597 web tests and the main working checkout passed 598. The local production export generated its assets, then exited with a Next.js 16.4.2 security advisory. The GitHub web build passed, and a separate worktree contains the proposed framework upgrade.
- [Local Docker Compose](../docker-compose.yml) uses the receipt guard at startup. The hosted release script already uses the same flag.
- Cloudflare served the new session-restoration branch in the public `/rentals` JavaScript. The exact Cloudflare Pages SHA remains unconfirmed. The [Render staging deployment history](https://dashboard.render.com/web/srv-dbjsf7s9v7es73b1a2ag/deploys) identifies `9621c085c4224bdf0548ef32604fb32c5a56bbc2` as live and shows auto-deploy disabled after a specific-commit deployment. GitHub's successful staging deployment record covers the database release. The verified candidate `5460536909a127415be233c32c57b7c52cd16c03` was available in Render's commit picker. Automatic approval review blocked the final deployment action pending explicit approval, so no new deployment was started.
- The immediate priority is to verify and, if needed, trigger the approved Render release, then repeat the same public and authenticated traces on the deployed revisions. Sample PostgreSQL counters again across the deployment boundary, and use tenant, provider and administrator staging fixtures with populated records for the route matrix. Obtain a matched Supabase billing window before attributing bandwidth savings.
