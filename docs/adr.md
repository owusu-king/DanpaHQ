# ADR — DanpaHQ architecture and core data model

**Status:** Accepted · **Reviewed:** 23 October 2026  
**Scope:** The single architecture reference, replacing the numbered ADRs, API contract, ERD and property-to-tenancy guide. Model definitions and migrations remain the complete schema; this record covers the essential decisions, contracts and relationships.

## 1. Decision and boundaries

**One modular Django/DRF backend owns authorization and business state; PostgreSQL is the system of record.** Web and mobile render the same capabilities and call the same API. Leases, occupancy, rent and payment records need transactional consistency across retries and multiple actors. Separate services would add distributed coordination before there is evidence it is needed.

| Boundary | Current decision / consequence |
|---|---|
| Backend | Domain services own transitions; explicit `transaction.atomic()` encloses related changes. Do not hold locks across slow provider calls. |
| Modules | Platform primitives support domains; domains never depend on the HTTP edge. Import tests enforce module-level boundaries, the shared property/listing/organization/occupancy/sale context and allowed function-scoped imports. |
| Database | PostgreSQL + PostGIS, `pg_trgm`, `btree_gist`; constraints and row/advisory locks protect integrity. Redis is a cache/Celery broker, not rental or money truth. |
| Clients | Next.js static export and Expo/React Native Android/iOS share `/api/v1/`. Platform presentation can differ; preserve installed-client compatibility. |
| Design | `packages/design-tokens/tokens.json` generates web/native tokens; CI checks drift. |

## 2. Identity and authorization

One account can be a tenant, provider and approved artisan. Account type, onboarding intent, role labels and active workspace guide navigation; they never substitute for resource authorization. `/me/` supplies registration state, contexts, capabilities and entry routes. Policies re-check authority on execution and return permitted actions, blockers and required reasons/confirmations.

| Actor / action | Authority that matters |
|---|---|
| Anonymous visitor | Public advertisements or explicitly granted share views; no general access to private inventory, evidence or tenant records. |
| Tenant | Their own applications, requests, agreements and tenancy records. Knowing another record's UUID grants nothing. |
| Property provider / team | Current relationship, organization membership/property assignment and the action's policy. Private draft preparation is distinct from reviewed provider standing, publication and collection permissions. |
| Publication / collection | Relevant account/provider checks, property authority and space condition/availability; receiving-account and payout checks additionally govern collection. Rental approval alone never publishes; active sale Properties become public while their required reviews remain current. |
| Artisan | Reviewed verification grants the workspace; suspension blocks new work. Invitation/assignment and payer rules scope job access and spending. |
| Management / super admin | Separate privileged authentication and permissions; MFA required by default. Password-first QR enrollment, encrypted TOTP keys and one-use recovery codes. Operations Admin configures consumer/Management MFA in Configuration; changes are audited and revoke sessions. Support cannot configure MFA; Super Admin security remains separate. Google/recovery obey policy. Consumer roles do not grant admin access. |

Verified email or phone with a Danpa HQ password, and Google sign-in, converge on Danpa HQ sessions. Email lookup is case-insensitive; phone numbers are normalized. Ambiguous email matches are refused without merging accounts. Password attempts are limited by identifier and IP. Google assertions are verified by the backend; `(provider, subject)` identifies the external identity. A Google assertion does not set a Danpa HQ password. A Google account can add a verified phone later.

Settings uses `/me/`'s `has_password` flag. A first password requires a live session and an OTP sent to a verified contact on that account. The OTP is bound to the account, session family, contact and purpose. Changing an existing password requires the current Danpa HQ password. Recovery sends an OTP to a verified contact and exchanges it for a short-lived, single-use reset proof. It does not issue a session until after the password is set and any required login MFA succeeds. Both flows write the existing password hash and invalidate outstanding password proofs; recovery also revokes all prior sessions. SMS and email use the existing delivery providers.

Access tokens last 15 minutes. Refresh credentials are hashed, rotated and expire after 30 days; reuse revokes the family. Re-authentication replaces the same installation's older session. Sensitive operations re-check a live session; password recovery revokes previous sessions. Account identity, provider standing, property authority, condition and receiving-account verification remain separate evidenced decisions, with reviewer, dates and preserved history.

## 3. API essentials

Base: `https://api.danpahq.com/api/v1/`. Authenticated consumer requests send `Authorization: Bearer <access_token>`. Domain/DRF errors use `{error:{code,message,details,request_id}}`; clients branch on stable `code`, not prose. `X-Request-ID` correlates requests and records. Selected high-impact writes accept `Idempotency-Key`; changed input with the same key conflicts. Coverage is selective.

| Contract | Implemented entry points / rule |
|---|---|
| Sign-in / session | `POST /auth/sign-in/` accepts `identifier` (email or phone) + `password`; legacy `phone` remains accepted, but not alongside `identifier`. `/auth/google/`, `/auth/refresh/`, `/auth/sign-out/` share sessions; `/me/` is canonical account context. |
| Password lifecycle | `POST /me/password/create/code/` chooses `sms` or `email`; `POST /me/password/create/` accepts the challenge ID, OTP and new password. `POST /me/password/` changes an existing password. Recovery starts at `POST /auth/password-reset/` with `identifier`, then uses `verify/` and `complete/`. Installed clients can still send the legacy `phone` payload. |
| Inventory / discovery | `/properties/`, `/units/{id}/`, `/listings/`, `/listings/map/`; object policies scope private reads/writes. |
| Rental record | `/me/tenancies/`, `/me/leases/`; tenant selection is request context, never one global current tenancy. |
| Exact API surface | [URL configuration](../backend/apps/api/urls.py), serializers and policy code define methods, payloads and validation; this table is not an exhaustive route catalog. |
| Public service identity | `GET /` returns `200` JSON: `name=DanpaHQ API`, `status=ok`, `version=1.0.0`. `/healthz` is liveness; `/readyz` checks dependencies. |

## 4. Core ERD — tables, columns and relationships

Selected implemented columns only. `PK` = primary key; `FK` = foreign key. Core IDs are UUIDv7; timestamps are UTC. Money is `BIGINT` minor units plus currency, never floats. Deletion/protection follows each model and domain policy, not a universal cascade/soft-delete rule. Generic trust subjects and verification UUID links are not ordinary database foreign keys.

### Identity, authority and inventory

| Table | Key columns / types | Relationships and constraints |
|---|---|---|
| `identity_user` | `id UUID PK`; `phone`, `email varchar nullable`; `password varchar` | Unique identifiers when present; phone is an identifier, not the credential. |
| `identity_external_identity` | `user_id UUID FK`; `provider`, `subject varchar` | User 1:N identities; unique `(provider, subject)`. |
| `identity_device` / `identity_session` | `user_id`, `device_id UUID FK`; session `family_id UUID`, `refresh_token_hash varchar` | User 1:N devices/sessions; device fingerprint unique per user; one unrevoked session per device. |
| `organization_membership` / `organization_property_assignment` | `organization_id`, `user_id`, `membership_id`, `property_id UUID FK` | Portfolio membership and property assignment scope team access. |
| `property_property` | `id UUID PK`; `address_id`, `created_by_id UUID FK` | Address/claim context; creator alone is not verified authority. |
| `property_unit` / `property_bed` | Unit `property_id UUID FK`, `space_type varchar`; Bed `unit_id UUID FK` | Property 1:N Units; Unit 1:N Beds, allowed only for hostel rooms. |
| `property_provider_application` | `property_id UUID FK`; `authority_verification_id`, `condition_verification_id UUID` | One property package links two evidence checks; one provider-facing review outcome. |
| `trust_verification` / `trust_verification_evidence` | `subject_type`, `subject_id`, `kind`, `status varchar`; evidence `verification_id`, `file_id UUID FK` | Claim-specific dated decisions; evidence preserves checksums; re-check supersedes history. |
| `listing_listing` / `sale_listing` | Rental `unit_id UUID FK`, `public_point Point`; sale `property_id UUID FK` | Rental advertises a Unit; sale advertises the Property. Public location is coarse. |

### Rental relationships and money

| Table | Key columns / types | Relationships and constraints |
|---|---|---|
| `viewing_request` / `application_rental` | `listing_id UUID FK`; `status varchar` | Viewing and rental application are independent workflows, not tenancies. |
| `occupancy_property_join_request` | `requester_id`, `unit_id`, `bed_id UUID FK`; `status varchar` | Private request names the exact space; approval alone creates no active tenancy. |
| `lease_lease` | `unit_id`, `bed_id`, `tenant_id`, `tenancy_id UUID FK`; `structured_terms JSONB` | Agreement workflow, dates and prices; `supersedes_id` links renegotiation history. |
| `lease_agreement` / `lease_acceptance` | `lease_id` / `agreement_id UUID FK`; `content_hash varchar`; `accepted_at timestamptz` | One agreement snapshot per lease; acceptances bind parties to its content hash. |
| `tenancy_tenancy` / `occupancy_occupancy` | `unit_id`, `bed_id UUID FK`; tenancy `tenant_id`; occupancy `user_id`, `starts_on/ends_on date` | Tenancy is the relationship; Occupancy is temporal allocation. Exclusion constraints plus locked service checks prevent conflicting allocation. |
| `rent_charge` / `rent_payment` | `lease_id`, payment `charge_id UUID FK`; `amount_minor BIGINT`, `amount_currency varchar` | Due obligations versus recorded/confirmed/disputed payments; partial payment is explicit. |
| `payments_intent` / `payments_transaction` / `payments_allocation` | `intent_id`, `transaction_id`, `obligation_id` or `billing_invoice_id UUID FK` | Intent, confirmed movement and allocation are separate; rent and subscription obligations share Payment Core. |
| `payments_ledger_entry` | `transaction_id UUID FK`; `direction varchar`; `amount_minor BIGINT` | Transaction 1:N ledger lines; receipts/reconciliation retain provider outcomes. No wallet is implied. |
| `billing_account` / `billing_subscription` / `billing_resource_access` | Account `organization_id UUID FK`; subscription `billing_account_id`, `plan_id UUID FK`; access `state varchar` | Portfolio subscribes; entitlements govern capacity; downgrade restricts new work without deleting records. |

### Evidence, services and sharing

| Table | Key columns / types | Relationships and constraints |
|---|---|---|
| `file_stored` | `uploaded_by_id UUID FK`; `storage_key varchar`, `checksum_sha256 varchar`, `scan_status varchar` | Metadata and retention; bytes are private objects. Only accepted clean uploads become usable. |
| `maintenance_request` / `artisan_profile` | Request `tenancy_id`, `assigned_artisan_id UUID FK`; profile `user_id UUID FK` | Maintenance remains the repair record; one artisan profile per account. |
| `artisan_direct_job` / `artisan_quote_invitation` / `artisan_quote` | `owner_id`, `maintenance_request_id` or `direct_job_id`, `invitation_id UUID FK` | Invitation has exactly one job subject; payer approves quotes/revisions. Recorded artisan payment is not escrow. |
| `passport_share` | `owner_id UUID FK`; `tenancy_ids JSONB`, `token_digest varchar`, `expires_at/revoked_at timestamptz` | Stores share scope, not copied housing facts. Every open re-checks expiry/revocation. |
| `audit_log` / `outbox_event` / `idempotency_key` | UUID keys; audit hashes; event payload; idempotency actor/endpoint/key | Append-only audit, transactional events and replay protection; not an exactly-once delivery guarantee. |

## 5. Property-to-tenancy invariants

`private draft → evidence → explicit package submission → review → eligible Unit/publication actions`

Verification, publication and availability are independent. Occupancy is availability truth, including private possession. Account/provider standing and property review are different gates; a property submission decides authority and condition together while retaining separate evidence. Checked data is protected by lifecycle policy.

`verified Unit → expiring access code → tenancy request → provider approval → lease offer → acceptance/required confirmation → tenancy + occupancy`

Access codes are hashed, explicitly issued, rotated/revoked and expiring; they are not readable permanent attributes. Historical invitation rows remain history, not the active acquisition route. Public applications/viewings use their own availability checks. Locking and temporal constraints protect Unit/Bed allocation. Beds never subdivide ordinary residential rooms.

Lease terms, rendered agreement and acceptance hashes preserve what parties agreed; revisions create history. Activation follows the agreement workflow, not a checkout redirect. A person can have several tenancies; renewal can preserve the relationship across successive agreements. Pending real-world possession blocks incompatible letting without claiming an executed agreement exists. Counterparty-dependent records are ended, superseded or archived according to policy. Legal template approval is required for production; uncertain legal rights are not invented in code.

## 6. Integrity, privacy and external systems

Disputable changes write audit/context and outbox events with their database transaction. Transactional idempotency commits state and replay together; external-provider paths use durable claims without holding database transactions across network calls. Workers retry; consumers must tolerate repeated delivery. Audit chaining is tamper evidence, and runtime database grants restrict mutation; an owner credential remains privileged.

Payment Core prices from locked server obligations, supports bounded part payments and verifies provider outcomes. Signed/duplicate/out-of-order callbacks, unknown outcomes and settlement exceptions require reconciliation; client returns never mark obligations paid. Paystack is implemented behind an adapter and a separate live-mode guard. Portfolio billing uses `billing.enforcement`; locked capacity checks and downgrade restrictions preserve existing tenants, agreements and receipts. Server-confirmed payment activates a subscription.

Private R2 uploads use signed PUT, size/checksum validation and production scanning; sensitive downloads re-check access. Property searches use the existing database. Web uses Leaflet; mobile uses locally bundled Leaflet in the Expo Go-compatible WebView. Selecting a reference locality can initialize a pin before verification; providers may refine it then. Public rental Units inherit their Property's location; direct sales use the same privacy-grid derivation. A missing pin may use an explicitly approximate reference-locality point; no usable coordinates means no marker. Verified Property details and pins remain locked. Tile configuration and hosting limits are in [Deployment](deployment.md#8-maps-and-ghana-reference-data). Housing Passport reads authorized source facts, with scoped/revocable sharing and support-led corrections. Arkesel, Resend and Cloudmersive remain adapters. Artisan assignment controls private job details; only the payer approves spending, and recording payment does not move money.

## 7. Delivery, tradeoffs and evidence

The repository configures one supervised Render API/worker/scheduler service plus private Redis, Supabase PostgreSQL, Cloudflare Pages/R2 and EAS native builds. Child exit stops the service; a PostgreSQL scheduler lease limits deploy overlap. GitHub tests precede the isolated owner migration/grant/seed/first-admin job; Render waits for CI success. Any existing superuser skips bootstrap. Owner/bootstrap secrets stay outside runtime; remove bootstrap credentials after creation.

| Accepted cost | Revisit when |
|---|---|
| Combined runtime shares capacity and restarts | Queue latency, memory/CPU contention or availability evidence warrants separate workers; extract domains only with a demonstrated ownership/scaling boundary. |
| PostgreSQL-specific integrity; asynchronous delivery | A database change needs redesign. Monitor retries/dead letters and reconciliation; scheduling locks do not guarantee exactly-once work. |
| Short-lived claims; separate client releases | Sensitive actions need live checks; retain compatible APIs and verify signed native binaries on devices. |
| Migrations precede rollout | Keep changes compatible with running code, back up and plan recovery; rollback cannot undo arbitrary data changes. |

Sources: [models](../backend/apps), [routes](../backend/apps/api/urls.py), [policy](../backend/apps/core/policy.py), [boundary tests](../backend/tests/unit/test_module_boundaries.py), [CI](../.github/workflows/ci.yml), [Blueprint](../render.yaml). [DEPLOY.md](deployment.md) owns setup and unresolved launch gates: live integrations/devices, legal/privacy review, privileged access, backups/restore and dependency findings. Configuration is not proof of live readiness. Update this one record when decisions change; historical numbered ADRs remain in Git history.

## 8. Additional domain contracts

Consolidated 31 October 2026 from implementation notes; code and current CI remain authoritative.

### Locations and verification

- `Region`, `District`, `Locality`, `GeoDataset` and `LocationSourceRecord` retain stable IDs, aliases, available coordinates, provenance and explicit unknown/inferred parents. Imports preserve existing addresses, user-created references and curator locks; absent upstream rows are retained. Geographic reference data is not verified property evidence.
- `/geo/locations/?q=...&limit=12&page=1` provides ranked name/alias/prefix/partial/trigram suggestions (10–15 per request), optional administrative filters and bounded pagination. `/geo/dataset/` exposes licensed reference facts, never private addresses. Legacy locality endpoints remain supported. Sources, import commands and coverage gaps are in [Deployment](deployment.md#8-maps-and-ghana-reference-data).
- Unit review requires a verified parent Property; draft editing remains available before that. Evidence completeness is matched by named slots: one required main view plus required photographs for selected amenities; context views are optional. Re-check copies only attached usable evidence into a fresh review and preserves the former approval. Removing a draft photo does not erase historical evidence.
- Provider re-check withdraws the advertisement; approval leaves it private until explicit republication. Genuine Management suspensions remain blocked. Recovery of legacy re-check suspensions requires matching audit provenance, never a bulk unsuspend. Verification records distinguish review type, claimed role, applicant/review author and actual recorded dates; bounded recent records are not a complete event archive.
- The supported advance-rent input ceiling is 36 months, separate from the existing agreement-term ceiling of 120 months and from legal advance-rent policy. Product limits do not establish legality.

### Provider Passport

- One Passport per Organization; active owners/admins manage it and choose an eligible owner/admin representative. It is additive: it does not grant provider access, property authority, listing publication or membership. Tenant Passport remains separate.
- Submission requires current provider standing, verified representative phone/email, identity review and a profile photo. Companies (and others declaring a registered business) require registration number/certificate; non-individual providers supply representative role and organization contacts. Agency licences and representative authorization are optional; organization contacts are recorded, not OTP-verified.
- `ProviderPassport`/`ProviderPassportDocument` use existing private scanned uploads. Submission freezes a snapshot in trust subject `organisation`, kind `provider_credentials`; pending packages are locked, decisions expire after 365 days, and edits remove the public verified stamp until re-review. Evidence/history remain retained; the client shows the latest 30 submissions.
- Private API: `/organizations/<id>/provider-passport/` GET/PATCH, `submit/` POST, `documents/` POST, `documents/<id>/` DELETE, plus scoped document downloads and `photo/`. Eligible downloads are audited, short-lived (60 seconds), private/no-store; ended representatives are redacted. Public listing credentials allow only name/category/verification dates/state, excluding contacts, IDs, documents and private review notes.
- Activity counts use accepted tenancies/completed maintenance during current property relationships. They are not ratings, lifetime reputation or response-time scores. Mobile supports document images; a native PDF picker is not implemented.

### Financial reports and listing assistance

- Finance → Profit & Loss generates PDF statements by default, with CSV as the raw-data option, for an individual landlord or registered business and one/all authorized properties over up to 366 days. `/organizations/<id>/finance/rent-tax-report/` requires verified-phone finance access and existing property scope; archived properties/inactive Units remain included. POST metadata is not persisted; responses are private/no-store. Explicit `format: "pdf"` returns `pdf_base64`; CSV returns `csv`. Omitted format retains installed-client CSV compatibility.
- Actual confirmed rent/advance receipts minus completed refunds, recorded expenses and settled fees drive the figures. Deposits/agency/unallocated receipts are separate; pending/disputed receipts and duplicate payout income are excluded. Currencies stay separate. Advance receipts use receipt dates; refunds restate their original receipt period because completion timestamps are unavailable; expenses use incurred dates. These are not automatically tax deductions or tax-purpose gross rent.
- Outstanding balances are current at generation for charges due in the selected period, excluding future/cancelled/settled charges; they do not enter received income/net income. The report is not a historical receivables reconstruction, tax assessment or GRA filing. Reconcile withholding certificates, tax payments and external records; [legal/tax release checks](deployment.md#9-legal-tax-and-device-release-checks) retain the source guidance and review requirements.
- Listing chat uses allowlisted public facts only. History is per browser tab/account/listing kind/ID, bounded to 40 messages; unavailable storage falls back to memory. **Live AI replies are not configured**, and history is not server-side or cross-device. The UI must state this limitation. Rental and sale shortlists are separate account-backed records; sale saves use `/me/saved-sales/` and expose only currently public sales.
