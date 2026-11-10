# Danpa HQ performance audit

Measured on November 9, 2026. The local baseline was staging branch commit `3b854c9`. Candidate measurements use the working tree. Public staging, a synthetic browser run, and local PostGIS are separate environments throughout this report.

## Findings in order of observed impact

1. **Sign-in made an account read before opening Home.** Successful password, Google and MFA responses already contain the server's account projection. Web sign-in waited for another `/me/` before it could land and start Home's data reads. Reusing the authenticated response removed one blocking round trip. A hard reload still restores the session through the existing refresh and account endpoints.
2. **Shared web JavaScript included screens outside the active route.** Auth flow implementations, the enquiries dialog and the artisan workspace entered shared chunks through the root providers or navigation imports. Auth and enquiries now load on first use. Artisan navigation events and link construction live separately from the workspace.
3. **Navigation fetched notification history to draw a count.** Web portal polling and mobile badge reads now request a count-only view. The endpoint still ages out old activity for the authenticated user. Existing history, cursor pagination, notification delivery and mark-read handling use their established paths. A delayed web poll cannot overwrite a newer count announced by Updates. A newer client can still read the count from an older server's full response during a staggered rollout.
4. **Account, dashboard and discovery reads spent avoidable database round trips.** The account serializer reuses its workspace list within one serialization. The portfolio lookup checks active membership in the same SQL statement as the organization read. The portfolio combines payment totals and counts and groups collection data by month in Postgres. Discovery joins file metadata into its two batched media reads. The synthetic portfolio and listing JSON matched the baseline.

## System and workflow review

- **Web and mobile.** Next.js statically exports the web application to Cloudflare Pages. A static HTML response can arrive before authentication, data fetching and React rendering complete. Portal navigation uses the account state to choose chrome and portfolio context. Expo uses native session storage, focus-based refreshes and the same versioned API. The dashboard and tenant Payments already use reduced read models from the recent performance work. Provider Home still requests the summary, properties, applications, viewings, leases and sometimes enquiries. These reads start independently after the account and scope are known.
- **API and identity.** Django REST Framework enforces session validity and resource permissions before business reads. API tokens and MFA remain under the existing server rules. The staging Pages function proxies only the Home projection and forwards authorization to Django. Its private, no-store policy keeps dashboard responses out of shared caches. The badge projection is also private and no-store.
- **Database.** The API uses PostgreSQL/PostGIS through Supabase's session pooler. Django reuses connections for 60 seconds by default and health-checks reused connections. Existing lease and date indexes support rent reads. Listing visibility still checks publication, occupancy and billing restrictions. Portfolio scope still uses organization roles and active assignments. The audit compared actual SQL statement counts and client-observed database execution time on PostGIS. Staging query plans, pool saturation, lock waits and production-sized cardinalities were unavailable, so this change adds no indexes or pool changes.
- **Assets and rendering.** The web build already self-hosts its fonts, uses hashed static assets and defers map code. The recent property-thumbnail path and signed media policies remain in place. The measured route payload changes come from JavaScript splitting. The public Rentals page still requests catalogue media and had the largest request count in the sample. No field interaction metric or standalone hydration duration was collected.
- **Jobs and external services.** Staging's repository configuration runs one synchronous API worker, a Celery solo worker and a leased scheduler on one free Render instance. Redis supplies task transport and cache services. Payment processing and reconciliation, notification delivery, file scanning and object storage have independent integrity and retry requirements. The change is confined to reads, account presentation and client module loading. Jobs, integrations and deployment configuration were outside the patch.

## Measurements

### Public staging baseline

The HTTP values are medians of five warm requests. The browser values are medians of three fresh desktop Chromium contexts from one workstation. Browser counts cover navigation through the sample window, including static assets and API fetches. On protected URLs these are **signed-out gate** measurements.

| Route | HTTP TTFB | HTML transferred | DOMContentLoaded | LCP | CLS | Browser requests / API resources |
|---|---:|---:|---:|---:|---:|---:|
| Home | 237 ms | 4,460 B | 414 ms | 1,424 ms | 0.028 | 37 / 1 |
| Properties | 181 ms | 4,490 B | 516 ms | 1,340 ms | 0.028 | 38 / 1 |
| Payments | 201 ms | 4,495 B | 590 ms | 1,512 ms | 0.028 | 38 / 1 |
| Updates | 183 ms | 4,435 B | 457 ms | 1,256 ms | 0.028 | 36 / 1 |
| Rentals | 210 ms | 5,545 B | 422 ms | 1,936 ms | 0.092 | 64 / 2 |

- Warm API health was about **350 ms** end to end. Readiness was about **417 ms**.
- Public rental search was **602 ms** end to end with **262 ms** in Django at the median of a second five-request batch. The first batch had a **790 ms** median and one **1.56 s** response. This shows meaningful time both inside the app and outside the reported Django interval. Network, edge routing and worker queueing cannot be apportioned from these timings alone.
- An unauthenticated `/me/` rejection took about **368 ms** at the median of the instrumented sample, with **0.83 ms** reported inside Django. This measures transport for a simple authenticated-route rejection. It provides no signed-in account-service timing.
- A separate cross-origin `/me/` preflight batch took **355 ms** at the median. Browser connection reuse and cached preflight responses affect how often this cost appears in a real session.

### Controlled sign-in and web assets

Five Chromium runs per static export, using a synthetic provider and the same fixed 300 ms API response delay. The timer starts at form submission on Home's sign-in gate and ends when the rendered portfolio empty state is visible. Both builds opened and closed Danpa Intel and returned focus to the opener.

| Metric | Before | After |
|---|---:|---:|
| Submit to rendered Home content, median | 1,362 ms | 851 ms |
| Account reads before Home summary starts | 1 | 0 |
| API requests through ready Home, including initial session check and badge | 10 | 9 |

JavaScript values sum the gzip size of the scripts referenced in each production HTML export. Deferred chunks are fetched on first use. These are build measurements and do not represent live CDN transfer times.

| Route | Initial scripts | Gzip bytes before | Gzip bytes after |
|---|---:|---:|---:|
| Home | 30 → 27 | 415,420 | 392,078 |
| Properties | 33 → 28 | 425,271 | 389,923 |
| Payments | 30 → 25 | 418,656 | 381,409 |
| Updates | 28 → 23 | 393,043 | 356,419 |
| Rentals | 30 → 24 | 414,778 | 374,638 |

### Local PostGIS paired reads

Twenty measured requests per version and route, after four warm-up pairs. The probe alternated which implementation ran first against the same fixture and dependency image. API time includes Django and DRF. SQL time sums client-observed cursor execution time, including local database transport. Response bytes are uncompressed.

| Request and fixture | SQL statements | SQL time, ms | API time, ms | Response bytes |
|---|---:|---:|---:|---:|
| Provider Home, hostel beds with rent and an archived tenancy | 19 → 17 | 9.81 → 9.35 | 22.76 → 21.91 | 3,378 → 3,378 |
| Full Portfolio, same fixture | 44 → 42 | 25.94 → 25.44 | 59.39 → 59.20 | 4,968 → 4,968 |
| Provider account | 32 → 30 | 13.59 → 15.08 | 37.22 → 40.07 | 3,402 → 3,402 |
| Notification badge, 100 synthetic records | 4 → 3 | 2.74 → 2.08 | 13.01 → 6.00 | 45,351 → 52 |
| Public rental list, unit and campaign photos | 8 → 6 | 6.11 → 5.91 | 17.64 → 16.88 | 2,093 → 2,093 |

The badge showed a clear payload and local latency reduction. The other API changes reduced database calls. The small local latency differences vary by endpoint, and the account request was slower in this sample despite two fewer calls. The data supports a round-trip reduction, with the size of any staging benefit still to be established.

## Changed components

| Area | Main files |
|---|---|
| Identity and web sign-in | [Identity serializer](../backend/apps/identity/serializers.py), [web session provider](../web/src/lib/session.tsx), [sign-in flow](../web/src/components/auth/flows/SignInFlow.tsx) |
| Portfolio and discovery | [Portfolio services](../backend/apps/organization/services.py), [listing read models](../backend/apps/listing/read_models.py), [listing views](../backend/apps/listing/views.py) |
| Notifications | [Notification view](../backend/apps/notifications/views.py), [web client](../web/src/lib/console.ts), [mobile client](../mobile/src/notifications.ts), [mobile badge hook](../mobile/src/components/nav/useUnreadUpdates.ts), [provider More tab](../mobile/app/(app)/(provider-tabs)/more.tsx) |
| Shared web modules | [Auth dialog](../web/src/components/auth/AuthDialog.tsx), [portal shell](../web/src/components/portal/PortalShell.tsx), [enquiry events](../web/src/components/enquiries/enquiryEvents.ts), [artisan navigation](../web/src/components/artisan/artisanNavigation.ts) and their Home, Provider, Passport, Sale, Updates and maintenance callers |
| Regression coverage | [Portfolio access and accuracy](../backend/tests/integration/test_organization_and_occupancy.py), [notification history and ageing](../backend/tests/integration/test_notifications.py), [discovery media and query budget](../backend/tests/integration/test_image_urls.py) |

## Verification

- **Backend.** The rebuilt image passed all **2,394** tests. A final focused run passed **167** tests covering MFA, rent, organization and tenancy access, notification history and listing photos. The tests include cross-account access, payment and webhook integrity, transaction rollback, audit records, file storage and outbox behavior. The first full run used a stale image with botocore 1.35.99 and failed five presigning tests. Rebuilding from the pinned dependencies resolved all five.
- **Clients.** Web passed **593** tests, type checking, lint and the production static export. Mobile passed **481** tests, type checking and lint. Shared design tokens were in sync.
- **Database and browser.** Ruff, migration drift and diff checks passed. The paired local reads matched dashboard and listing response contents. The controlled browser run checked sign-in through Home's gate and lazy dialog activation, close and focus return. A separate synthetic probe from the public landing page timed out during the redirect on both the baseline export and the deployed static site with intercepted API responses. Real landing-page sign-in, authenticated staging workflows and physical Expo devices remain release checks.

## Staging verification and infrastructure

- **Measure signed-in staging before promotion.** Repeat cold browser sign-in, hard reload and warm navigation using approved provider, assigned team member and tenant accounts. Include Home, Properties, Payments, Updates and Rentals. Pair browser request timelines with Django `Server-Timing` and request IDs. Record at least p50 and p95 under comparable network and data conditions. A representative Ghana connection and installed Expo builds are still needed. Verify rendered data readiness and report interaction latency separately from load and LCP.
- **Separate idle startup from warm queueing.** Render Free spins down after 15 minutes of inactivity. The measured sample used a responding service. The configured single synchronous API worker can serialize the dashboard's concurrent calls, with no spare HTTP slot during a long request. Use Render instance metrics and request logs to distinguish CPU, memory, queueing and cold starts before changing plans. If cold starts or queueing dominate, compare a paid always-on staging instance with the standard runtime profile and enough memory for the worker and scheduler. [Render Free instance behavior](https://render.com/docs/free)
- **Confirm database and asset delivery from staging.** Check slow statements, plans, index usage, pool connections and lock waits on representative data. The full portfolio still made 42 statements on the small fixture, with per-unit access and condition work remaining. That is the next candidate if signed-in traces show this read dominates. Inspect cache headers and transfer sizes for hashed scripts, fonts and public thumbnails separately from private media and account responses.
- **Release status.** Changes are local. No authenticated staging account or operator metrics were available for this audit, and the candidate was not deployed. The reported 2–3 second staging dashboard delay therefore has no verified staging after-measurement.
