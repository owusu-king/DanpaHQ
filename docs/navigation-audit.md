# Danpa HQ web navigation audit

Measured November 17, 2026, using local Chrome against two production-mode Next.js static exports. The baseline includes the performance work already present in the checkout. The candidate adds the changes below. [Earlier local and staging measurements](performance-audit.md) cover the native and Docker development paths, SQL and release traffic.

## Authentication and navigation

The browser previously relied on a local storage hint to attempt cookie restoration at the root and mounted the marketing page immediately. The API refresh cookie is HttpOnly and scoped to the API host and auth path. The static web export cannot inspect it. The root and legacy auth entries now classify the session via the API before mounting marketing or sending the user to their active workspace. An unknown guest makes one additional refresh request on those entry points. Ordinary public browsing can still start without the probe. If restoration is temporarily unavailable, the root offers retry and a public browse link.

Browser refresh opts into receiving the account projection with the rotated token. Older servers still work via the account endpoint. Fresh sign-in preserves the requested destination, and the landing page defers to the active auth flow. Sign-out, the legacy Tenants requests link, and successful unit lifecycle transitions use client navigation without a redundant route refresh.

| Chrome scenario with a stubbed auth API | Baseline | Candidate |
|---|---|---|
| Valid refresh response available, no local hint | Marketing shown, no restoration request | Properties on the initial document, marketing never shown |
| Returning provider with local hint | Marketing shown, refresh and account calls | Properties on the initial document, one restoration call |
| Provider pending workspace access | Marketing shown before Home | Home on the initial document, marketing never shown |
| New guest | Marketing shown, no restoration calls | Marketing shown after one rejected restoration call |
| Expired session with local hint | Marketing shown following one refresh rejection | Marketing shown following one refresh rejection |
| Older API, valid refresh available, no local hint | Marketing shown, no restoration request | Properties after refresh and account calls |
| Fresh sign-in from /sign-in?next=/updates | Properties | Updates on the initial document |
| Returning provider clicks Units from Properties | Initial session failed to restore without a hint | Units on the initial document, one portfolio Units call and no organization lookup |

These scenarios used simulated API responses. Browser cookie delivery, staging CORS, and live sign-in were outside this measurement. Django integration tests separately verify the cookie response, account projection, and API compatibility.

## Backend and page reads

- Units uses validated workspace context to fetch the portfolio's card projection. The existing full response remains available. The card response avoids detail-only policy, billing, join-code and boundary data. The integration fixture covers the portfolio owner and a manager restricted to assigned properties.
- Remaining Units reads still scale with the number of units. The card serializer checks publication, availability and verification per row. The endpoint returns a full scoped collection, so large portfolios need a representative authenticated benchmark before deciding how to batch or paginate it.
- Settlement retrieves bank and wallet institutions when the add-account form is visible. An existing account overview can render without that provider call.
- Implementation spans the [auth client](../web/src/lib/auth.ts), [session provider](../web/src/lib/session.tsx), [app shell](../web/src/components/AppShell.tsx), [root entry](../web/src/components/EntryRedirect.tsx), [auth dialog](../web/src/components/auth/AuthDialog.tsx), [Django refresh view](../backend/apps/identity/views.py), [session rotation](../backend/apps/identity/services.py), [organization views](../backend/apps/organization/views.py), [unit serializers](../backend/apps/property/serializers.py), [workspace client](../web/src/lib/console.ts), [Units](../web/app/units/page.tsx), [Settlement](../web/app/settings/settlement/page.tsx), [Tenants](../web/app/tenants/page.tsx), and [unit lifecycle actions](../web/src/components/property/UnitLifecycleActions.tsx).

Local PostGIS measurements compare the full and card projections on the same authenticated requests using the test database and an in-process DRF client. SQL statements include middleware and authorization. JSON sizes are uncompressed. Owner and manager visits have different scopes, so compare projections within each row.

| Request scope | SQL statements, full → cards | JSON bytes, full → cards |
|---|---:|---:|
| Owner, three units across two properties | 210 → 24 | 11,510 → 1,640 |
| Assigned manager, two units on one property | 221 → 18 | 7,673 → 1,091 |

## Shared Pooler Egress

The earlier investigation linked repeated release imports to district polygon transfers during low user activity. Local PostGIS returned 29,690,266 bytes over 1,964 SQL executions for a forced repeat versus one result byte and two statements for an unchanged import with a receipt. Result bytes exclude protocol overhead. The staging receipt table was still absent in the last inspection. The approximately 5.54 GB staging incident remains open until a release is deployed and Supabase pooler bytes are measured over equivalent post-release windows. See the [release and scheduler findings](performance-audit.md).

## Coverage and limits

The matrix has one signed-out document visit per route and build using fresh Chrome contexts, a local static server, four parallel browser pages, and a stub API. All 87 pages returned HTTP 200 with zero uncaught browser errors on both builds. The generated not-found page and icon are framework output outside this authored page inventory. For protected pages the sample usually ends at the guest gate. Each timing starts at document navigation and counts response start, DOMContentLoaded and window load in milliseconds. API calls exclude preflight and include a short observation window after load. A destination in the last column is the observed final path after a URL change. A zero means the final path matched the requested route. Source entries flag direct API calls, session reads and selected render delegates. Navigation calls are static references, including handlers that the guest smoke test did not exercise.

These single samples serve as smoke measurements. Rendering, hydration, warm navigation, API p50/p95, Django and SQL timings, and payload size for each authenticated route remain unmeasured here. Tenant and artisan work, property and unit editing, listings, viewings, applications, lease and tenancy, payment and rent accounts, and settings mutations still need full authenticated browser journeys. The production comparison also needs equivalent fixtures and the same workflow against local PostGIS, the deployed Django API, and staging Supabase. No hosting tier or concurrency change was made in this pass.

The final verification passed 596 web tests and 206 Django integration tests with explicit test settings. ESLint, type checking and the static export passed. The export completed on retry after a Next.js security advisory warning. The candidate has not been deployed to staging.

## Web routes

| Route and source | Direct data calls or render delegates | Direct navigation calls | TTFB/DCL/load ms before → after | Guest API calls before → after | Guest destination before → after |
|---|---|---|---|---|---|
| [/](../web/app/page.tsx) | `EntryRedirect`, `FrontDoor` | — | 31/140/252 → 25/114/200 | 0 → 1 | 0 → 0 |
| [/applications](../web/app/applications/page.tsx) | `useSession`, `listMyApplications`, `listMyLeases` | `router.replace`, `router.push` | 26/113/231 → 21/119/227 | 1 → 1 | 0 → 0 |
| [/artisan/jobs](../web/app/artisan/jobs/page.tsx) | `ArtisanJobsPage` | — | 16/112/247 → 14/110/218 | 1 → 1 | 0 → 0 |
| [/artisan](../web/app/artisan/page.tsx) | `useSession`, `getMyArtisanApplication` | `router.push` | 20/109/229 → 17/114/220 | 1 → 1 | 0 → 0 |
| [/artisan/profile](../web/app/artisan/profile/page.tsx) | `ArtisanProfilePage` | — | 85/170/271 → 51/136/244 | 1 → 1 | 0 → 0 |
| [/artisan/requests](../web/app/artisan/requests/page.tsx) | `ArtisanRequestsPage` | — | 44/130/235 → 34/114/229 | 1 → 1 | 0 → 0 |
| [/artisans](../web/app/artisans/page.tsx) | `ArtisansWorkspace` | — | 29/117/226 → 28/106/231 | 1 → 1 | 0 → 0 |
| [/choose-role](../web/app/choose-role/page.tsx) | `useSession`, `authedFetch` | `router.replace` | 27/106/220 → 22/100/221 | 1 → 1 | 0 → 0 |
| [/documents](../web/app/documents/page.tsx) | `useSession`, `listOrganizations` | `router.replace` | 120/213/312 → 120/200/294 | 1 → 1 | 0 → 0 |
| [/enquiries](../web/app/enquiries/page.tsx) | — | — | 33/131/237 → 38/130/231 | 1 → 1 | 0 → 0 |
| [/forgot-password](../web/app/forgot-password/page.tsx) | `AuthEntry` | — | 28/99/215 → 27/112/213 | 0 → 1 | / → / |
| [/home](../web/app/home/page.tsx) | `useSession`, `listMyTenancies`, `listMyApplications`, `listMyViewings`, `listMyLeases`, `listMyJoinRequests`, `listOrganizations`, `getOrganizationHome`, `listOrganizationProperties`, `getHostViewingAgenda`, `listGrantedLeases`, `listEnquiries` | — | 21/101/216 → 23/110/217 | 1 → 1 | 0 → 0 |
| [/how-it-works](../web/app/how-it-works/page.tsx) | — | — | 105/218/319 → 47/149/259 | 1 → 1 | 0 → 0 |
| [/leases](../web/app/leases/page.tsx) | `useSession`, `listMyLeases` | `window.location.hash.startsWith`, `router.replace`, `window.location.hash.slice` | 45/159/306 → 29/117/235 | 1 → 1 | 0 → 0 |
| [/maintenance](../web/app/maintenance/page.tsx) | `useSession`, `listMyMaintenance`, `listMyTenancies`, `listOrganizations`, `listOrganizationMaintenance`<br>`MaintenanceWorkspace` | `router.replace` | 38/160/333 → 25/112/239 | 1 → 1 | 0 → 0 |
| [/management/account-deletions](../web/app/management/account-deletions/page.tsx) | — | — | 245/373/491 → 89/209/364 | 1 → 1 | /management/login → /management/login |
| [/management/artisans](../web/app/management/artisans/page.tsx) | — | — | 54/154/291 → 47/158/303 | 1 → 1 | /management/login → /management/login |
| [/management/audit-logs](../web/app/management/audit-logs/page.tsx) | — | — | 25/134/253 → 36/146/296 | 1 → 1 | /management/login → /management/login |
| [/management/billing](../web/app/management/billing/page.tsx) | — | — | 14/124/250 → 29/139/294 | 1 → 1 | /management/login → /management/login |
| [/management/configuration](../web/app/management/configuration/page.tsx) | — | — | 213/337/530 → 213/337/463 | 1 → 1 | /management/login → /management/login |
| [/management/how-it-works](../web/app/management/how-it-works/page.tsx) | — | — | 43/151/350 → 53/151/275 | 1 → 1 | /management/login → /management/login |
| [/management/listings](../web/app/management/listings/page.tsx) | — | — | 36/143/343 → 41/173/314 | 1 → 1 | /management/login → /management/login |
| [/management/login](../web/app/management/login/page.tsx) | — | — | 30/145/331 → 35/177/310 | 1 → 1 | 0 → 0 |
| [/management](../web/app/management/page.tsx) | — | — | 16/146/295 → 19/114/229 | 1 → 1 | /management/login → /management/login |
| [/management/payments](../web/app/management/payments/page.tsx) | — | — | 80/184/312 → 191/321/437 | 1 → 1 | /management/login → /management/login |
| [/management/profile](../web/app/management/profile/page.tsx) | — | — | 44/164/315 → 57/159/271 | 1 → 1 | /management/login → /management/login |
| [/management/properties](../web/app/management/properties/page.tsx) | — | — | 37/155/306 → 42/190/321 | 1 → 1 | /management/login → /management/login |
| [/management/providers](../web/app/management/providers/page.tsx) | — | — | 31/149/299 → 42/183/310 | 1 → 1 | /management/login → /management/login |
| [/management/rentals](../web/app/management/rentals/page.tsx) | — | — | 78/217/379 → 188/302/434 | 1 → 1 | /management/login → /management/login |
| [/management/reports](../web/app/management/reports/page.tsx) | — | — | 52/160/320 → 155/263/388 | 1 → 1 | /management/login → /management/login |
| [/management/support](../web/app/management/support/page.tsx) | — | — | 49/152/304 → 38/150/276 | 1 → 1 | /management/login → /management/login |
| [/management/users](../web/app/management/users/page.tsx) | — | — | 41/144/300 → 29/146/271 | 1 → 1 | /management/login → /management/login |
| [/management/verifications](../web/app/management/verifications/page.tsx) | — | — | 83/215/405 → 219/345/494 | 1 → 1 | /management/login → /management/login |
| [/onboarding](../web/app/onboarding/page.tsx) | `useSession`, `authedFetch` | `router.replace` | 33/160/334 → 54/176/306 | 1 → 1 | 0 → 0 |
| [/passport](../web/app/passport/page.tsx) | `useSession`, `getMyPassport`, `listPassportShares` | — | 41/147/333 → 51/176/313 | 1 → 1 | 0 → 0 |
| [/payments](../web/app/payments/page.tsx) | `useSession`, `listOrganizations`, `getOrganizationPortfolio`, `listOrganizationProperties`, `listPropertyExpenses`, `getLeaseLedger`<br>`PaymentsWorkspace`, `TenantPaymentsWorkspace` | `router.replace` | 33/142/329 → 39/161/297 | 1 → 1 | 0 → 0 |
| [/portfolio-invitations](../web/app/portfolio-invitations/page.tsx) | `useSession`, `listMyPortfolioInvitations`, `getPortfolioInvitation` | `router.push` | 130/243/348 → 171/277/388 | 1 → 1 | 0 → 0 |
| [/properties](../web/app/properties/page.tsx) | `useSession`, `listOrganizations`, `listProperties` | — | 48/166/294 → 56/171/296 | 1 → 1 | 0 → 0 |
| [/provider-passport](../web/app/provider-passport/page.tsx) | `useSession`, `listOrganizations`, `getProviderPassport`, `submitProviderPassport` | — | 29/140/278 → 30/134/266 | 1 → 1 | 0 → 0 |
| [/provider](../web/app/provider/page.tsx) | `useSession`, `getProviderStanding`, `authedFetch` | `router.replace` | 39/150/286 → 38/142/273 | 1 → 1 | 0 → 0 |
| [/record/application](../web/app/record/application/page.tsx) | `useSession`, `listMyApplications`, `listMyLeases` | `router.push` | 80/198/367 → 157/284/413 | 1 → 1 | 0 → 0 |
| [/record/apply](../web/app/record/apply/page.tsx) | `useSession`, `getPublicListing`, `submitRentalApplication` | `router.replace` | 44/142/311 → 40/149/278 | 1 → 1 | 0 → 0 |
| [/record/enquiry](../web/app/record/enquiry/page.tsx) | — | — | 38/139/311 → 38/171/303 | 1 → 1 | 0 → 0 |
| [/record/lease-new](../web/app/record/lease-new/page.tsx) | — | `router.push` | 70/202/360 → 158/279/393 | 1 → 1 | 0 → 0 |
| [/record/lease](../web/app/record/lease/page.tsx) | `useSession`, `listGrantedLeases`, `listMyLeases`, `getLeaseLedger` | `router.push` | 33/132/305 → 44/150/295 | 1 → 1 | 0 → 0 |
| [/record/listing](../web/app/record/listing/page.tsx) | `useSession`, `getPublicListing`, `getRelatedListings`, `listMyApplications`, `listMyViewings`, `listSavedListings` | `router.push` | 47/154/314 → 155/281/413 | 0 → 0 | 0 → 0 |
| [/record/payment-checkout](../web/app/record/payment-checkout/page.tsx) | `getLeaseLedger`, `listPaymentIntents`, `createPaymentIntent` | `router.push`, `window.location.assign` | 29/130/285 → 40/151/268 | 1 → 1 | 0 → 0 |
| [/record/payment-return](../web/app/record/payment-return/page.tsx) | `getPaymentIntent`, `listPaymentIntents` | `window.location.assign` | 90/217/385 → 76/227/377 | 1 → 1 | 0 → 0 |
| [/record/payment](../web/app/record/payment/page.tsx) | `useSession`, `getLeaseLedger`, `listOrganizations`, `getOrganizationPortfolio`<br>`RentAccountDetail` | — | 39/138/305 → 47/158/277 | 1 → 1 | 0 → 0 |
| [/record/payout-account](../web/app/record/payout-account/page.tsx) | — | `router.replace` | 33/155/319 → 47/149/304 | 1 → 1 | 0 → 0 |
| [/record/property-new](../web/app/record/property-new/page.tsx) | — | `router.push`, `router.replace` | 31/136/313 → 30/131/296 | 1 → 1 | 0 → 0 |
| [/record/property-setup](../web/app/record/property-setup/page.tsx) | — | `router.push` | 124/253/413 → 80/194/357 | 1 → 1 | 0 → 0 |
| [/record/property-spaces](../web/app/record/property-spaces/page.tsx) | — | `router.replace` | 48/147/293 → 29/139/286 | 1 → 1 | 0 → 0 |
| [/record/property-verify](../web/app/record/property-verify/page.tsx) | — | `router.replace` | 39/141/288 → 34/129/276 | 1 → 1 | 0 → 0 |
| [/record/property](../web/app/record/property/page.tsx) | `getProperty`, `listUnits`, `getVerification`, `getPropertyAmenities`, `getSellerSale` | `router.push` | 35/140/308 → 38/140/308 | 1 → 1 | 0 → 0 |
| [/record/receipt](../web/app/record/receipt/page.tsx) | — | `router.replace` | 31/131/282 → 29/124/275 | 1 → 1 | 0 → 0 |
| [/record/sale](../web/app/record/sale/page.tsx) | `useSession`, `getSale`, `listSavedSales` | `router.push` | 68/194/373 → 38/160/315 | 0 → 0 | 0 → 0 |
| [/record/space-listing](../web/app/record/space-listing/page.tsx) | `getUnit`, `listMyListings` | `router.replace` | 53/139/309 → 23/138/295 | 1 → 1 | 0 → 0 |
| [/record/space-new](../web/app/record/space-new/page.tsx) | — | `router.replace` | 44/134/305 → 16/130/291 | 1 → 1 | 0 → 0 |
| [/record/space](../web/app/record/space/page.tsx) | `getUnit`, `listMyListings`, `submitForReview`, `listingAction`, `createBed` | `router.push` | 62/182/360 → 31/146/297 | 1 → 1 | 0 → 0 |
| [/record/tenancy](../web/app/record/tenancy/page.tsx) | `listMyTenancies` | — | 68/187/341 → 38/150/290 | 1 → 1 | 0 → 0 |
| [/record/tenant](../web/app/record/tenant/page.tsx) | `useSession`, `listOrganizations`, `getOrganizationPortfolio` | — | 61/180/334 → 33/145/298 | 1 → 1 | 0 → 0 |
| [/record/viewing](../web/app/record/viewing/page.tsx) | `useSession`, `listHostViewings`, `listMyViewings` | `router.push` | 47/140/284 → 22/134/287 | 1 → 1 | 0 → 0 |
| [/register](../web/app/register/page.tsx) | `AuthEntry` | — | 42/129/337 → 16/136/277 | 0 → 1 | / → / |
| [/rentals](../web/app/rentals/page.tsx) | `useSession` | — | 118/230/390 → 76/204/334 | 2 → 2 | 0 → 0 |
| [/restricted](../web/app/restricted/page.tsx) | — | — | 92/195/332 → 44/168/303 | 0 → 0 | 0 → 0 |
| [/review](../web/app/review/page.tsx) | — | — | 39/137/253 → 37/154/284 | 1 → 1 | 0 → 0 |
| [/saved](../web/app/saved/page.tsx) | `listSavedListings` | — | 48/139/227 → 29/145/281 | 1 → 1 | 0 → 0 |
| [/settings/archive](../web/app/settings/archive/page.tsx) | `listMyArchive` | — | 98/199/329 → 49/150/291 | 1 → 1 | 0 → 0 |
| [/settings/billing](../web/app/settings/billing/page.tsx) | `useSession`, `listOrganizations`, `getPlanCatalogue`, `getPortfolioBilling` | — | 59/135/273 → 41/143/294 | 1 → 1 | 0 → 0 |
| [/settings/notifications](../web/app/settings/notifications/page.tsx) | — | — | 20/149/256 → 34/138/290 | 1 → 1 | 0 → 0 |
| [/settings](../web/app/settings/page.tsx) | `useSession`, `listMyPortfolioInvitations` | — | 115/246/369 → 81/208/352 | 1 → 1 | 0 → 0 |
| [/settings/preferences](../web/app/settings/preferences/page.tsx) | `getNotificationPreferences`, `updateNotificationPreferences` | — | 162/277/400 → 77/195/341 | 1 → 1 | 0 → 0 |
| [/settings/security](../web/app/settings/security/page.tsx) | `useSession`, `listSignedInDevices`, `getAccountDeletion`, `authedFetch` | `router.replace` | 108/226/365 → 40/148/288 | 1 → 1 | 0 → 0 |
| [/settings/settlement](../web/app/settings/settlement/page.tsx) | `useSession`, `listOrganizations`, `getPayoutDestination`, `listPayoutInstitutions` | — | 51/168/307 → 38/137/281 | 1 → 1 | 0 → 0 |
| [/settings/team](../web/app/settings/team/page.tsx) | `useSession`, `listOrganizations`, `getOrganization`, `listOrganizationProperties`, `listPortfolioMembers`, `listPortfolioInvitations`, `listPortfolioAssignments`, `updateOrganization` | — | 41/154/293 → 32/149/283 | 1 → 1 | 0 → 0 |
| [/settings/verification/identity](../web/app/settings/verification/identity/page.tsx) | — | — | 55/182/332 → 51/162/272 | 1 → 1 | 0 → 0 |
| [/settings/verification](../web/app/settings/verification/page.tsx) | `useSession`, `authedFetch`, `listOrganizations`, `getPayoutDestination` | — | 166/302/404 → 149/276/387 | 1 → 1 | 0 → 0 |
| [/shared-passport](../web/app/shared-passport/page.tsx) | — | `window.location.hash.replace` | 36/167/313 → 36/188/304 | 0 → 0 | 0 → 0 |
| [/sign-in](../web/app/sign-in/page.tsx) | `AuthEntry` | — | 27/147/346 → 31/168/291 | 0 → 1 | / → / |
| [/tenant/setup](../web/app/tenant/setup/page.tsx) | — | — | 146/333/473 → 174/295/408 | 1 → 1 | 0 → 0 |
| [/tenants](../web/app/tenants/page.tsx) | `useSession`, `listOrganizations`, `getOrganizationPortfolio` | `window.location.hash.slice`, `router.replace` | 110/213/348 → 54/175/319 | 1 → 1 | 0 → 0 |
| [/units/new](../web/app/units/new/page.tsx) | — | `router.replace` | 46/176/311 → 33/146/284 | 1 → 1 | 0 → 0 |
| [/units](../web/app/units/page.tsx) | `useSession`, `listOrganizations`, `listPortfolioUnits` | — | 53/152/294 → 39/157/309 | 1 → 1 | 0 → 0 |
| [/updates](../web/app/updates/page.tsx) | `listNotificationHistory` | `router.push` | 74/180/315 → 59/169/284 | 1 → 1 | 0 → 0 |
| [/viewings](../web/app/viewings/page.tsx) | `useSession`, `listMyViewings`, `listHostViewings` | `window.location.hash.startsWith`, `router.replace`, `window.location.hash.slice`, `router.push` | 43/125/250 → 39/124/241 | 1 → 1 | 0 → 0 |
| [/welcome](../web/app/welcome/page.tsx) | `AuthEntry` | — | 36/116/294 → 27/112/232 | 0 → 1 | / → / |
