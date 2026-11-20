# Danpa HQ post-optimization performance audit

November 17, 2026. Remote `staging` was at `afb6e0e`. The browser sweep used the live staging site and the running local development stack. The Units candidate was measured against the deployed handler on local PostGIS. It has not been deployed.

## Findings ranked by observed impact

| Rank | Route or operation | Evidence | Status |
|---|---|---|---|
| 1, high | Staging public /rentals and both catalogue reads | Median document load 1.00 s and LCP 2.56 s. The two catalogue reads start together. With warm direct requests, sales took 545 ms and rentals 410 ms end to end at p50. | Staging database attribution and catalogue optimization remain open. |
| 2, high for larger portfolios | Provider /units and GET /api/v1/organizations/:id/units/?view=cards | Three units needed 24 SQL statements. The two-unit assigned-manager fixture needed 18. Verification, occupancy and listings were read per card. | Batched those reads locally. The candidate needed 11 statements with two, three and seven units on the scoped fixtures. |
| 3, high in development | Local Next.js route startup, including /rentals, /payments and /record/property | In the local dev sweep, the median among route medians was 3.39 s TTFB, 5.38 s load and 7.61 MB of encoded route JavaScript. On staging the respective values were 348 ms, 955 ms and 272 KB. | The development compiler, JavaScript and fixture differences make these environments unsuitable for an infrastructure-only comparison. See the earlier native versus Docker comparison. |
| 4, moderate for public entry | Staging / and /sign-in | Median LCP was 1.92 s and 1.84 s. The first document includes the guest session probe. | The staging guest gate is covered. Signed-in cookie restoration and return-target behavior still need controlled staging journeys. |

The historical authenticated staging report measured provider Home data around 3.71–5.37 s and Finance around 4.35 s. Those values remain a pre-release reference. The previous changes reuse portfolio context and defer secondary finance data, and the earlier audit has the source and local fixture evidence. A current authenticated trace is needed to quantify the improvement for those routes. [Historical staging audit](staging-performance.md) · [Earlier local measurements](performance-audit.md) · [Navigation changes](navigation-audit.md)

## Geography, background work, and the pooler

- Staging PostgreSQL has a seed receipt whose fingerprint matches the checkout's packaged snapshot, importer, geography models, search code and crosswalk. The release command passes `--skip-if-current`. The importer takes a transaction-level advisory lock and checks the receipt before reconciling districts and localities. The earlier local paired test measured 1,964 statements and 29,690,266 bytes of result values for a forced repeat versus two statements and one byte for the receipt path. These are database result values before protocol overhead. No staging import was triggered for this audit.
- The user reported approximately **0.07 GB today** in Supabase. The earlier incident was approximately **5.54 GB**. These are different measurement windows. The staging receipt and lower reported usage are consistent with the intended behavior. An independent Supabase billing export and equivalent-duration post-release comparisons are still open.
- Staging config schedules outbox every 15 seconds. The two claim queries use row locks and `SKIP LOCKED`. Idle runs return early without fetching claimed-event payloads. The database showed one granted advisory lock and no waiting advisory lock in the sampled windows. That supports a single scheduler at those instants. The claim and stale-reclaim fingerprints give a better check of the effective rate than the config alone.
- The staging outbox had 149 published and six dead-letter rows. All six were older push-notification events, with the latest update on November 8. The samples showed no pending, processing or failed rows. No retry or state change was performed.
- Django defaults to 60-second persistent PostGIS connections with health checks and a 5-second connect timeout. Staging uses the Supabase session pooler, and the running local API uses the local database container. The repository's staging profile has one synchronous Gunicorn request slot, a solo Celery worker and leased beat. Public API timings leave meaningful time outside Django even on health checks. Render worker accept time, Supabase pool saturation, cross-region SQL latency and actual effective connection reuse were outside the available telemetry.

## Public API, warm sequential HTTP

Twenty requests per endpoint and environment after discarding the first. Values in milliseconds use the nearest-rank p95. Django is the `app` Server-Timing interval. JSON bytes are decoded. The local catalogue returned empty results, while staging returned live listings, so this is an environment comparison with different data.

| Endpoint | Local HTTP p50/p95 | Staging HTTP p50/p95 | Local Django p50/p95 | Staging Django p50/p95 | Local / staging JSON bytes |
|---|---:|---:|---:|---:|---:|
| /healthz | 4.97 / 46.31 | 197.46 / 301.58 | 0.25 / 0.30 | 0.38 / 0.49 | 36 / 36 |
| /api/v1/listings/ | 29.44 / 51.49 | 409.98 / 455.15 | 7.54 / 9.05 | 213.60 / 238.40 | 42 / 8,682 |
| /api/v1/sales/ | 27.93 / 52.27 | 544.72 / 586.91 | 6.91 / 8.31 | 350.27 / 370.10 | 42 / 1,306 |

## Units candidate on the same dataset

The candidate loads the card's reviews, amenities, photos, latest listings and occupancy facts as collections. It still calls the same public-listing visibility queryset and uses the same scoped organization gate. The full endpoint keeps its existing response contract. The regression checks that the projected fields match, including verified, occupied, withdrawn and expired states, and that query count stays flat when four more units are added.

| Three-unit owner fixture, 20 paired warm requests | Deployed handler | Candidate |
|---|---:|---:|
| End-to-end in-process Django p50/p95 | 49.14 / 59.52 ms | 22.64 / 31.58 ms |
| SQL execute and result buffering p50/p95 | 15.47 / 19.32 ms | 6.46 / 9.12 ms |
| SQL statements | 24 | 11 |
| Uncompressed JSON bytes | 1,640 | 1,640, byte-for-byte identical |

The Django measurement uses the real DRF view, auth, middleware, renderer and local database. The SQL measurement includes client-observed execution and buffering. Larger portfolios and remote database transfers still need representative staging fixtures. [Organization endpoint](../backend/apps/organization/views.py) · [Unit read model](../backend/apps/property/read_models.py) · [Regression](../backend/tests/integration/test_organization_and_occupancy.py)

## Page-by-page browser measurements

Three fresh signed-out Chrome contexts per route per environment, with two browser pages active during each sweep. All 522 initial documents returned 200 with zero uncaught page errors. The authored pages include standalone protected entry points, management screens, and record route templates. Record routes were opened without data IDs, so these rows describe route entry and its guard or missing-record state. LCP can be a loading shell or a gate. The first React commit is measured from document navigation and used as a startup milestone. Separate hydration CPU is unavailable for the staging production build. API counts cover completed requests in the observation window, exclude preflights, and may omit traffic finishing later. Protected-route values are never used as authenticated business-path timings.

| Route | Local TTFB/load/LCP ms | Staging TTFB/load/LCP ms | First React commit local/staging ms | Script CPU local/staging ms | Completed API calls local/staging |
|---|---:|---:|---:|---:|---:|
| [/](../web/app/page.tsx) | 3216/5246/5464 | 201/905/1916 | 5251 / 928 | 388 / 61 | 1 / 1 |
| [/applications](../web/app/applications/page.tsx) | 3174/5209/5344 | 240/783/512 | 5214 / 793 | 351 / 36 | 1 / 0–1 |
| [/artisan](../web/app/artisan/page.tsx) | 2216/4118/4236 | 331/959/632 | 4122 / 887 | 360 / 36 | 1 / 0 |
| [/artisan/jobs](../web/app/artisan/jobs/page.tsx) | 2994/5045/5168 | 324/969/616 | 5049 / 910 | 334 / 43 | 1 / 0 |
| [/artisan/profile](../web/app/artisan/profile/page.tsx) | 2987/5058/5168 | 366/908/644 | 5061 / 909 | 336 / 37 | 1 / 0–1 |
| [/artisan/requests](../web/app/artisan/requests/page.tsx) | 3385/5377/5528 | 288/934/700 | 5384 / 964 | 320 / 41 | 1 / 0 |
| [/artisans](../web/app/artisans/page.tsx) | 4316/5294/5452 | 312/790/596 | 5300 / 825 | 300 / 50 | 1 / 0 |
| [/choose-role](../web/app/choose-role/page.tsx) | 3804/5260/5432 | 399/873/648 | 5267 / 879 | 300 / 38 | 1 / 0 |
| [/documents](../web/app/documents/page.tsx) | 3796/5468/5612 | 240/802/564 | 5472 / 830 | 309 / 40 | 1 / 0–1 |
| [/enquiries](../web/app/enquiries/page.tsx) | 3136/5041/5164 | 330/906/656 | 5050 / 910 | 298 / 42 | 1 / 0–1 |
| [/forgot-password](../web/app/forgot-password/page.tsx) | 3064/4773/4916 | 348/868/916 | 4778 / 898 | 382 / 48 | 1 / 0–1 |
| [/home](../web/app/home/page.tsx) | 190/3431/3600 | 339/896/1976 | 3438 / 921 | 369 / 50 | 1 / 1 |
| [/how-it-works](../web/app/how-it-works/page.tsx) | 2666/3990/4572 | 334/849/628 | 3994 / 860 | 338 / 67 | 1 / 0 |
| [/leases](../web/app/leases/page.tsx) | 3167/4752/4924 | 218/878/516 | 4759 / 810 | 271 / 39 | 1 / 0 |
| [/maintenance](../web/app/maintenance/page.tsx) | 3634/5400/5520 | 475/1206/928 | 5406 / 1240 | 278 / 47 | 1 / 0 |
| [/management](../web/app/management/page.tsx) | 3555/5391/3644 | 360/1083/728 | 5394 / 982 | 319 / 41 | 2 / 0 |
| [/management/account-deletions](../web/app/management/account-deletions/page.tsx) | 3228/5405/3612 | 414/984/732 | 5409 / 980 | 345 / 40 | 2 / 0 |
| [/management/artisans](../web/app/management/artisans/page.tsx) | 3642/5615/5880 | 258/807/540 | 5619 / 843 | 341 / 55 | 2 / 0 |
| [/management/audit-logs](../web/app/management/audit-logs/page.tsx) | 3813/5607/5868 | 467/990/728 | 5611 / 1014 | 348 / 47 | 2 / 0 |
| [/management/billing](../web/app/management/billing/page.tsx) | 3607/5399/5680 | 201/744/488 | 5403 / 769 | 334 / 41 | 2 / 0 |
| [/management/configuration](../web/app/management/configuration/page.tsx) | 3601/5380/5676 | 380/929/664 | 5384 / 933 | 368 / 37 | 2 / 0–1 |
| [/management/how-it-works](../web/app/management/how-it-works/page.tsx) | 4264/5943/6208 | 236/717/488 | 5946 / 737 | 324 / 40 | 2 / 0 |
| [/management/listings](../web/app/management/listings/page.tsx) | 4239/5917/6184 | 319/939/600 | 5920 / 853 | 328 / 37 | 2 / 0 |
| [/management/login](../web/app/management/login/page.tsx) | 3017/4878/3120 | 409/947/716 | 4882 / 971 | 278 / 44 | 2 / 0 |
| [/management/payments](../web/app/management/payments/page.tsx) | 2995/4848/5060 | 452/1002/760 | 4851 / 982 | 312 / 50 | 2 / 0 |
| [/management/profile](../web/app/management/profile/page.tsx) | 4028/5742/6012 | 319/843/588 | 5746 / 866 | 351 / 42 | 2 / 0–1 |
| [/management/properties](../web/app/management/properties/page.tsx) | 3994/5691/5976 | 353/913/620 | 5694 / 902 | 344 / 37 | 2 / 0 |
| [/management/providers](../web/app/management/providers/page.tsx) | 3051/4901/5152 | 349/976/660 | 4905 / 927 | 322 / 38 | 2 / 0 |
| [/management/rentals](../web/app/management/rentals/page.tsx) | 3026/4889/5148 | 461/966/720 | 4894 / 970 | 325 / 34 | 2 / 0 |
| [/management/reports](../web/app/management/reports/page.tsx) | 3187/5086/5336 | 423/910/680 | 5089 / 938 | 326 / 38 | 2 / 0 |
| [/management/support](../web/app/management/support/page.tsx) | 3180/5059/5328 | 349/845/632 | 5062 / 873 | 312 / 39 | 2 / 0 |
| [/management/users](../web/app/management/users/page.tsx) | 3216/5069/5348 | 400/1085/848 | 5075 / 1106 | 312 / 40 | 2 / 0 |
| [/management/verifications](../web/app/management/verifications/page.tsx) | 3194/5058/5324 | 420/986/700 | 5064 / 996 | 311 / 41 | 2 / 0 |
| [/onboarding](../web/app/onboarding/page.tsx) | 3735/5591/5716 | 273/868/560 | 5596 / 841 | 307 / 45 | 1 / 0 |
| [/passport](../web/app/passport/page.tsx) | 3729/5602/5732 | 411/990/704 | 5606 / 990 | 324 / 44 | 1 / 0 |
| [/payments](../web/app/payments/page.tsx) | 3840/5603/5744 | 347/1082/2052 | 5607 / 1110 | 363 / 49 | 1 / 1 |
| [/portfolio-invitations](../web/app/portfolio-invitations/page.tsx) | 3822/5563/5708 | 385/998/1484 | 5569 / 1028 | 337 / 44 | 1 / 0–1 |
| [/properties](../web/app/properties/page.tsx) | 188/1124/1236 | 316/1082/2136 | 1133 / 962 | 267 / 58 | 1 / 1 |
| [/provider](../web/app/provider/page.tsx) | 4124/6049/6172 | 497/1266/1116 | 6053 / 1298 | 387 / 48 | 1 / 0–1 |
| [/provider-passport](../web/app/provider-passport/page.tsx) | 2507/4904/5080 | 238/802/524 | 4908 / 794 | 287 / 45 | 1 / 0 |
| [/record/application](../web/app/record/application/page.tsx) | 3534/5263/5372 | 346/897/656 | 5267 / 921 | 275 / 44 | 1 / 0 |
| [/record/apply](../web/app/record/apply/page.tsx) | 3505/5249/5360 | 411/908/696 | 5253 / 939 | 273 / 48 | 1 / 0–1 |
| [/record/enquiry](../web/app/record/enquiry/page.tsx) | 3229/4929/5060 | 332/846/620 | 4932 / 819 | 291 / 39 | 1 / 0 |
| [/record/lease](../web/app/record/lease/page.tsx) | 3214/4908/5036 | 309/831/580 | 4912 / 861 | 294 / 40 | 1 / 0 |
| [/record/lease-new](../web/app/record/lease-new/page.tsx) | 3324/5154/5260 | 391/955/712 | 5158 / 982 | 264 / 49 | 1 / 0 |
| [/record/listing](../web/app/record/listing/page.tsx) | 3319/5524/3408 | 412/921/716 | 5529 / 956 | 408 / 53 | 0 / 0 |
| [/record/payment](../web/app/record/payment/page.tsx) | 3949/5829/5952 | 291/1087/876 | 5833 / 865 | 319 / 43 | 1 / 0–1 |
| [/record/payment-checkout](../web/app/record/payment-checkout/page.tsx) | 3930/5813/5932 | 340/913/600 | 5817 / 875 | 300 / 47 | 1 / 0 |
| [/record/payment-return](../web/app/record/payment-return/page.tsx) | 3453/5650/5768 | 401/965/680 | 5655 / 971 | 314 / 41 | 1 / 0 |
| [/record/payout-account](../web/app/record/payout-account/page.tsx) | 3447/5785/5944 | 294/787/584 | 5793 / 825 | 353 / 45 | 1 / 0 |
| [/record/property](../web/app/record/property/page.tsx) | 4335/6083/6192 | 355/897/644 | 6087 / 925 | 377 / 47 | 1 / 0 |
| [/record/property-new](../web/app/record/property-new/page.tsx) | 4310/6043/6156 | 374/877/696 | 6049 / 901 | 299 / 41 | 1 / 0–1 |
| [/record/property-setup](../web/app/record/property-setup/page.tsx) | 2708/4403/4524 | 275/814/536 | 4406 / 818 | 288 / 44 | 1 / 0 |
| [/record/property-spaces](../web/app/record/property-spaces/page.tsx) | 3214/5281/5396 | 307/806/580 | 5285 / 810 | 272 / 35 | 1 / 0 |
| [/record/property-verify](../web/app/record/property-verify/page.tsx) | 3516/5280/5392 | 321/883/624 | 5284 / 913 | 332 / 42 | 1 / 0 |
| [/record/receipt](../web/app/record/receipt/page.tsx) | 3509/5138/5268 | 704/1206/980 | 5142 / 1217 | 333 / 37 | 1 / 0 |
| [/record/sale](../web/app/record/sale/page.tsx) | 4124/5788/4220 | 800/1791/1428 | 5792 / 1837 | 400 / 54 | 0 / 0 |
| [/record/space](../web/app/record/space/page.tsx) | 4113/5766/5896 | 408/1162/688 | 5770 / 1187 | 284 / 45 | 1 / 0 |
| [/record/space-listing](../web/app/record/space-listing/page.tsx) | 2873/4749/4860 | 450/991/748 | 4753 / 996 | 294 / 46 | 1 / 0–1 |
| [/record/space-new](../web/app/record/space-new/page.tsx) | 2920/5022/5132 | 378/921/668 | 5026 / 944 | 276 / 42 | 1 / 0 |
| [/record/tenancy](../web/app/record/tenancy/page.tsx) | 2914/5045/5156 | 306/1215/592 | 5052 / 1220 | 302 / 39 | 1 / 0 |
| [/record/tenant](../web/app/record/tenant/page.tsx) | 3064/4972/5080 | 382/980/692 | 4975 / 1004 | 262 / 43 | 1 / 0 |
| [/record/viewing](../web/app/record/viewing/page.tsx) | 3591/5330/5476 | 272/851/548 | 5336 / 855 | 329 / 36 | 1 / 0 |
| [/register](../web/app/register/page.tsx) | 3583/5399/5548 | 601/1133/1148 | 5404 / 1129 | 356 / 42 | 1 / 0 |
| [/rentals](../web/app/rentals/page.tsx) | 3378/5421/6200 | 458/1001/2556 | 5425 / 1014 | 403 / 85 | 2 / 0–2 |
| [/restricted](../web/app/restricted/page.tsx) | 3595/5676/3684 | 538/1090/864 | 5683 / 1112 | 355 / 43 | 0 / 0 |
| [/review](../web/app/review/page.tsx) | 3195/4977/5092 | 323/1071/664 | 4983 / 1103 | 310 / 51 | 1 / 0–1 |
| [/saved](../web/app/saved/page.tsx) | 3575/5735/5852 | 527/1229/992 | 5739 / 1255 | 302 / 48 | 1 / 0 |
| [/settings](../web/app/settings/page.tsx) | 3549/5702/5824 | 330/1083/928 | 5707 / 1077 | 284 / 36 | 1 / 0–1 |
| [/settings/archive](../web/app/settings/archive/page.tsx) | 3504/5739/5884 | 371/1094/784 | 5744 / 1080 | 334 / 35 | 1 / 0–1 |
| [/settings/billing](../web/app/settings/billing/page.tsx) | 3493/5703/5852 | 302/1078/864 | 5709 / 1101 | 380 / 40 | 1 / 0–1 |
| [/settings/notifications](../web/app/settings/notifications/page.tsx) | 3622/5983/6116 | 314/1104/1488 | 5989 / 1049 | 362 / 42 | 1 / 0–1 |
| [/settings/preferences](../web/app/settings/preferences/page.tsx) | 3451/5492/5648 | 513/1117/820 | 5499 / 1139 | 328 / 39 | 1 / 0–1 |
| [/settings/security](../web/app/settings/security/page.tsx) | 3427/5523/5692 | 554/1239/864 | 5529 / 1243 | 330 / 36 | 1 / 0 |
| [/settings/settlement](../web/app/settings/settlement/page.tsx) | 3769/5992/6120 | 315/975/760 | 5995 / 996 | 320 / 47 | 1 / 0–1 |
| [/settings/team](../web/app/settings/team/page.tsx) | 3852/6030/6164 | 283/1000/764 | 6033 / 1005 | 350 / 47 | 1 / 0–1 |
| [/settings/verification](../web/app/settings/verification/page.tsx) | 3830/6008/6132 | 292/923/600 | 6011 / 917 | 301 / 33 | 1 / 0–1 |
| [/settings/verification/identity](../web/app/settings/verification/identity/page.tsx) | 3177/5429/5576 | 377/1114/876 | 5434 / 1118 | 310 / 36 | 1 / 0 |
| [/shared-passport](../web/app/shared-passport/page.tsx) | 3119/5395/3240 | 364/959/804 | 5403 / 947 | 410 / 55 | 0 / 0 |
| [/sign-in](../web/app/sign-in/page.tsx) | 3140/5392/5612 | 413/945/1844 | 5398 / 943 | 576 / 93 | 1 / 1 |
| [/tenant/setup](../web/app/tenant/setup/page.tsx) | 3287/5334/5484 | 354/880/652 | 5339 / 873 | 329 / 42 | 1 / 0–1 |
| [/tenants](../web/app/tenants/page.tsx) | 2192/4049/4196 | 266/1199/1272 | 4053 / 1190 | 341 / 60 | 1 / 0–1 |
| [/units](../web/app/units/page.tsx) | 152/4982/5096 | 301/1240/2068 | 4986 / 1279 | 340 / 55 | 1 / 1 |
| [/units/new](../web/app/units/new/page.tsx) | 3121/4656/5100 | 289/801/560 | 4664 / 804 | 285 / 35 | 1 / 0–1 |
| [/updates](../web/app/updates/page.tsx) | 3099/5538/5660 | 289/1206/1112 | 5543 / 1238 | 305 / 43 | 1 / 0 |
| [/viewings](../web/app/viewings/page.tsx) | 2448/4895/5016 | 359/1061/1556 | 4899 / 1089 | 284 / 51 | 1 / 0–1 |
| [/welcome](../web/app/welcome/page.tsx) | 3229/5242/5464 | 254/767/808 | 5249 / 790 | 476 / 41 | 1 / 0–1 |
