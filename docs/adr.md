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
| Publication / collection | Relevant account/provider checks, property authority and space condition/availability; receiving-account and payout checks additionally govern collection. Approval never publishes automatically. |
| Artisan | Reviewed verification grants the workspace; suspension blocks new work. Invitation/assignment and payer rules scope job access and spending. |
| Management / super admin | Separate privileged authentication and permissions; MFA required by default. Password-first QR enrollment, encrypted TOTP keys and one-use recovery codes. Operations Admin configures consumer/Management MFA in Configuration; changes are audited and revoke sessions. Support cannot configure MFA; Super Admin security remains separate. Google/recovery obey policy. Consumer roles do not grant admin access. |

Email-or-phone/password and Google sign-in converge on DanpaHQ sessions. Email lookup is case-insensitive; phone numbers are normalized. Ambiguous email matches are refused without merging accounts. Password attempts are limited by identifier and IP. OTP proves possession for registration/recovery/step-up, not normal password sign-in. Google credentials are verified by the backend; `(provider, subject)` identifies the external identity. Email collisions never authorize merging accounts; a Google account can add a verified phone later.

Access tokens last 15 minutes. Refresh credentials are hashed, rotated and expire after 30 days; reuse revokes the family. Re-authentication replaces the same installation's older session. Sensitive operations re-check a live session; password recovery revokes previous sessions. Account identity, provider standing, property authority, condition and receiving-account verification remain separate evidenced decisions, with reviewer, dates and preserved history.

## 3. API essentials

Base: `https://api.danpahq.com/api/v1/`. Authenticated consumer requests send `Authorization: Bearer <access_token>`. Domain/DRF errors use `{error:{code,message,details,request_id}}`; clients branch on stable `code`, not prose. `X-Request-ID` correlates requests and records. Selected high-impact writes accept `Idempotency-Key`; changed input with the same key conflicts. Coverage is selective.

| Contract | Implemented entry points / rule |
|---|---|
| Sign-in / session | `POST /auth/sign-in/` accepts `identifier` (email or phone) + `password`; legacy `phone` remains accepted, but not alongside `identifier`. `/auth/google/`, `/auth/refresh/`, `/auth/sign-out/` share sessions; `/me/` is canonical account context. |
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

Private R2 uploads use signed PUT, size/checksum validation and production scanning; sensitive downloads re-check access. Property searches use the existing database. Web uses the Leaflet map adapter; mobile uses locally bundled Leaflet in the Expo Go-compatible WebView. Providers choose pins separately from written addresses. Public points retain the privacy grid; missing property coordinates produce no marker. Public tile URLs and attribution are configurable; community hosting has usage limits (see free-maps.md). Housing Passport reads authorized source facts, with scoped/revocable sharing and support-led corrections. Arkesel, Resend and Cloudmersive remain adapters. Artisan assignment controls private job details; only the payer approves spending, and recording payment does not move money.

## 7. Delivery, tradeoffs and evidence

The repository configures one supervised Render API/worker/scheduler service plus private Redis, Supabase PostgreSQL, Cloudflare Pages/R2 and EAS native builds. Child exit stops the service; a PostgreSQL scheduler lease limits deploy overlap. GitHub tests precede the isolated owner migration/grant/seed/first-admin job; Render waits for CI success. Any existing superuser skips bootstrap. Owner/bootstrap secrets stay outside runtime; remove bootstrap credentials after creation.

| Accepted cost | Revisit when |
|---|---|
| Combined runtime shares capacity and restarts | Queue latency, memory/CPU contention or availability evidence warrants separate workers; extract domains only with a demonstrated ownership/scaling boundary. |
| PostgreSQL-specific integrity; asynchronous delivery | A database change needs redesign. Monitor retries/dead letters and reconciliation; scheduling locks do not guarantee exactly-once work. |
| Short-lived claims; separate client releases | Sensitive actions need live checks; retain compatible APIs and verify signed native binaries on devices. |
| Migrations precede rollout | Keep changes compatible with running code, back up and plan recovery; rollback cannot undo arbitrary data changes. |

Sources: [models](../backend/apps), [routes](../backend/apps/api/urls.py), [policy](../backend/apps/core/policy.py), [boundary tests](../backend/tests/unit/test_module_boundaries.py), [CI](../.github/workflows/ci.yml), [Blueprint](../render.yaml). [DEPLOY.md](deployment.md) owns setup and unresolved launch gates: live integrations/devices, legal/privacy review, privileged access, backups/restore and dependency findings. Configuration is not proof of live readiness. Update this one record when decisions change; historical numbered ADRs remain in Git history.
