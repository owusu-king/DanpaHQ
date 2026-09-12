# Identity, organization, occupancy and listing API contract

All paths below are under `/api/v1`. Authenticated errors use the shared
`{error:{code,message,details,request_id}}` envelope. Object authorization is
always enforced by Django.

## Identity and routing

- `GET /me/` returns profile, `registration_state`, `capabilities`, onboarding
  state, intents, detailed `contexts`, `default_context_id`, compatibility
  contexts, permissions, trust summary and canonical mobile/web entry routes.
  Clients render access from `capabilities` and never from `account_type` or a
  role name.
- `POST /me/registration/` completes account creation with
  `{account_type, first_name, last_name, date_of_birth, email?, password}`.
  Until it succeeds, `registration_state` is not `complete` and every other
  authenticated endpoint refuses the account.
- `POST /me/password/` changes a known password with
  `{current_password, new_password}`; other sessions are signed out.
- `GET|POST /me/workspace/` reports or changes the current experience with
  `{"workspace":"discovery|tenant|provider"}`. This is what the welcome screen's
  choice maps to after sign-in. It changes navigation only: verification in
  progress is untouched, no capability is revoked, the session continues, and no
  second account is created. Choosing `tenant` acquires tenant capability;
  choosing `provider` acquires nothing and routes to the verification screen.
- `GET|POST /me/provider-verification/` reports or starts the account-level
  provider check. POST takes `{documents:[{file_id, evidence_type}]}` and
  requires a current identity verification first.
- `POST /me/onboarding/` accepts basic name fields.
- `POST /me/onboarding/intent/` accepts
  `{"intent":"find_property|current_tenant|manage_property"}` and returns the
  full `/me/` shape. Intent records a journey and grants no provider access.
- `POST /me/onboarding/role/` is a compatibility mapping endpoint only.
- `POST /me/roles/` accepts `tenant` only. Provider standing comes from an
  approved provider verification.

## Authentication

- `POST /auth/sign-in/` takes `{phone, password}` and returns tokens plus the
  `/me/` shape. Failures are generic so the endpoint cannot be used to test
  which numbers hold accounts; the one exception names the case of an account
  created before passwords existed.
- `POST /auth/challenge/` and `POST /auth/verify/` prove a number during
  registration. They no longer sign an existing finished account in. For a
  number with no account, verify returns `{registration_required,
  registration_ticket, phone_display, expires_in}` and no session.
- `POST /me/registration/` spends that ticket: it creates the account and
  returns tokens plus the `/me/` shape. It is the only call that creates one.
- `POST /auth/password-reset/` issues a recovery code, and refuses a number with
  no account with `NO_ACCOUNT` (404) before anything is sent.
- `POST /auth/password-reset/verify/` exchanges the code for a short-lived
  `reset_token` authorising exactly one password change, and deliberately not a
  session.
- `POST /auth/password-reset/complete/` sets the new password, signs every
  existing session out, and returns a fresh session.
- `GET /me/sessions/` lists the caller's live sessions. `DELETE
  /me/sessions/{id}/` revokes another session owned by that caller without
  blocking its device; the current session must use the normal sign-out action.
- `GET /me/devices/` lists only devices that are neither signed out nor blocked.
  `DELETE /me/devices/{id}/` **signs a non-current device out**: it revokes that
  device's sessions and sets `removed_at`, and the installation may sign in
  again — re-authentication is a one-time code to the account's own number, and
  its return raises the unfamiliar-device alert. `POST /me/devices/{id}/block/`
  is the lost-or-stolen report: same revocation, plus `blocked_at`, and sign-in
  is refused until Management lifts it. Both keep the row as security history
  rather than deleting it.

  These were one action until it became clear what that cost. `DELETE` set
  `blocked_at`, nothing anywhere cleared it, and so tidying a device list barred
  that handset from the account permanently, with "Contact support" resolving to
  a hand-edit in Django admin. A fingerprint ban is in any case a weak lock —
  an attacker holding the handset reinstalls and gets a new fingerprint — so it
  is kept for the case its owner actually declares and charged to no one else.
- `GET /management/users/{id}/devices/` (`view_users`) lists every device on an
  account including removed and blocked ones, with a `state` of `active`,
  `removed` or `blocked`. `POST /management/users/{id}/devices/{deviceId}/restore/`
  (`manage_users`) lifts a block, requires a `reason`, and leaves the device
  signed out rather than trusted, so it must sign in — and alert its owner —
  before it is usable again.

Challenge endpoints stay enumeration-resistant except at sign-up and recovery,
which answer at the number rather than after an SMS and a six-digit wait —
`ACCOUNT_EXISTS` (409) and `NO_ACCOUNT` (404), both before anything is sent, and
both bounded by the per-number and per-IP throttles. OTP proof during
registration creates nothing and hands back a ticket; for an account that is
already finished it returns a refusal pointing at the password. Browser refresh uses an httpOnly
cookie and native refresh uses secure storage. Management users authenticate
separately by email and password on their own surface.

## Request idempotency

High-impact create and transition endpoints accept `Idempotency-Key`, including
application submission/decision, viewing creation/decision, invitation and join
request decisions, lease creation/decision, verification submission/withdrawal,
Unit access-code revocation and Management verification decisions. Endpoints
that issue a raw invitation or access code are deliberately excluded: caching
their response would persist a possession secret that is otherwise shown once.

The key is 16–128 characters from letters, numbers, `.`, `_`, `:`, or `-` and
is scoped to the authenticated actor plus the exact method/path. Its fingerprint
also covers the full target (including query parameters) and raw body. Repeating
the same request returns the original status and JSON with
`X-Idempotent-Replay: true`; using the key with different request details returns
`idempotency_conflict` (409). A 5xx may be retried with the same key because its
domain savepoint was rolled back. Completed non-5xx responses replay for the
configured 24-hour window.

The web, mobile and Management clients keep one key stable across their bounded
network/transient retries. They do not retry arbitrary unsafe requests. The
header is optional on current non-payment endpoints for installed-client
compatibility; future Payment Core mutations will use the same contract with a
required key. Domain permissions, constraints and locks still apply when a key
is absent. See ADR 0027.

## Organizations and private inventory

- `GET /organizations/` — the Portfolios this account can work in. Read-only:
  a Portfolio is provisioned when provider access is approved and there is
  exactly one per provider, so nothing creates one. A `POST` is a 405.
- `GET|PATCH /organizations/:id/` — the owner renames their Portfolio and says
  what it does here; it is the only Portfolio write a provider makes.
- `GET|POST /organizations/:id/memberships/` (owner/admin for administration)
- `GET|POST /organizations/:id/properties/`
- `GET|POST /organizations/:id/property-assignments/`
- `GET|POST /properties/:id/buildings/`
- `GET|POST /units/:id/beds/`

Property creation is private and requires a verified phone, not identity or
property KYC. Non-owner organization members see only their assigned
properties. Legacy `/properties/` remains a dual-read compatibility endpoint
but applies the same backend scope.

Property responses include `capabilities`, with independent states for private
inventory, tenant access, leases, payment collection and publication. These are
actor-specific server decisions, not persistent trust flags.

They also carry `verification.review_state` — the sole provider-facing result
for the complete property package. Values are `not_submitted`,
`pending_verification`, `verified`, `withdrawn`, `changes_required`, `rejected`,
`suspended` and `expired`.

`verification.state` retains the detailed setup/router lifecycle for compatible
clients. Its nine values are `draft`, `ready_for_submission`, `submitted`,
`under_review`, `verified`, `changes_requested`, `rejected`, `suspended`,
`expired`, each with a `state_label`, an `editable` flag, `submitted_at`,
`decided_at`, `decision_note`, and an `authority` and `photos` block naming
where each internal evidence section stands. These sections support package
completeness and targeted feedback; they are not separate property approvals.

This exists because `Verification.display_state` has four values, and
`REJECTED`, `REVOKED` and never-started all arrive as `unverified`. A page given
that field cannot tell a provider whose claim was refused from one who has not
begun — which is why the property page offered "continue setup" in every state.
`verification.state` is what a state-aware screen reads;
`authority_state` remains for clients built before it.

- `POST /properties/:id/claim/` records the document that says this property is
  yours to let. It **saves; it does not send** — the claim sits as a `DRAFT`
  application with its evidence attached, exactly the way `condition.attach`
  holds photographs before they are queued. Distinct from
  `POST /provider/applications/`, which submits, and which remains the
  onboarding path where a claim genuinely is the thing being sent and there is
  often no property row yet.
- `POST /properties/:id/verification/` sends the **whole property**: the
  document and the photographs, explicitly linked and queued together in one
  act, because they receive one atomic property decision. Refused with 409
  unless both sections are complete, and the
  refusal names each one that is not — `document_missing` and
  `evidence_missing`, with counts. It also requires the account's identity and
  phone to be verified, which is where that check moved to when recording the
  document stopped being the same act as sending it.

  A property is *created* before this is called and stays that way if it never
  is. `verification.state` reads `ready_for_submission`, the provider can run it
  as private inventory indefinitely, and only advertising and inviting wait.
- `DELETE /properties/:id/verification/evidence/` and the space equivalent take
  one slot's photograph back down. Accepts `{"slot_key":"..."}`. `POST` to a
  slot that already holds one **replaces** it rather than stacking a second file
  behind it, and both are refused with 409 once a reviewer holds the submission
  (except under `changes_requested`, where the reviewer has asked for more and
  the answer has to reach the case they are holding).

  Each slot in the `slots` array reports `file_id`, `preview_url` (short-lived,
  `inline`) and `filename` alongside `provided`. A boolean could not support
  either control, which is why a filled slot used to render the word "Added"
  with nothing on it and a wrong photograph could never be corrected.

- `POST /properties/:id/verification/withdraw/` and
  `POST /units/:id/verification/withdraw/` take a submission back out of the
  queue. Accepts `{"reason":"..."}`. Refused with 409 unless a reviewer is
  actually holding it — there is nothing to withdraw from a draft, and an
  approved decision is undone by a re-check, not a withdrawal. The evidence
  stays attached and the subject returns to `ready_for_submission`, so the
  correction the provider withdrew to make is one edit away. The withdrawn
  submission stays in the audit record: a queue entry a reviewer may have
  already opened is history (ADR 0021).

  For a property the package is marked `WITHDRAWN`, while its detailed setup
  state remains ready because the document and photographs are still present.
  Resubmission reuses the same one-to-one row and evidence, avoiding the old
  database-level dead end without erasing the fact that review was withdrawn.

- `POST /management/property-verifications/:submission_id/decision/` records
  the one final property decision. Both internal checks, relationship changes,
  audit records and outbox events commit or roll back together. The individual
  verification decision endpoint returns 409 for a linked property package.
- `PATCH /properties/:id/` is refused with 409 while a reviewer holds the
  property, and **again once it is verified** — every field, including the name.
  So are `POST .../claim/`, archival and deletion while with the team: a property
  under review or under a live approval is locked, enforced by policy rather than
  by the page omitting a button.

  The four fields `trust.evidence_policy` reads (`property_type`,
  `water_source`, `power_meter_type`, `compound_type`) are the obvious ones —
  changing one after a decision moves the photo checklist under a decision
  already made, so a property approved on three views silently becomes one that
  should have shown five. The name is the less obvious one, and it is fixed for
  the same reason: a verification is a statement about a described thing, and the
  description a tenant reads includes the name, so a rename under a live approval
  makes the mark vouch for a property nobody looked at.

  Spaces have a way out of this (`POST /units/:id/verification/recheck/`, which
  supersedes the approval and returns the space to draft). Properties do not yet;
  when a property re-check exists it is what unlocks these.

- `GET /me/archive/` returns only archived Properties and Units the signed-in
  provider is still authorized to manage. Each resource includes its archive
  time/reason, inspection context and the backend `restore` decision with any
  current blockers. `POST /properties/:id/restore/` and
  `POST /spaces/:id/restore/` enforce that same decision server-side.
  Restoration never republishes a listing, regenerates an access code, changes
  verification, or removes archive/audit history.

- `GET /organizations/:id/portfolio/` returns the scoped daily owner/manager
  read model used by the provider web Tenants area and mobile operations:
  properties, occupancy/vacancy, tenants, leases, outstanding and overdue
  balances, recent payments, expenses and recent activity. `rent_collection`
  adds 12 monthly and 6 yearly buckets from the same authoritative records:
  confirmed payments grouped by `paid_on`, and the balance still outstanding
  now grouped by obligation `due_on`. It is not a reconstruction of a past
  month-end balance and clients must label it accordingly. Each active tenant
  row is one Occupancy and follows that Occupancy's exact `tenancy`, `lease` and
  optional `bed`; clients must not infer an agreement from the parent Unit.
  The row includes Property/Unit/bed identifiers, lease rent terms and the
  per-lease outstanding/overdue summary needed for portfolio navigation.
- `GET|POST /organizations/:id/expenses/` lists or records internal property
  expenses. It records money already spent and does not initiate a transfer.

## Private tenancy requests and historical invitations

- `GET /me/occupancies/`
- `GET /property-join-lookup/?code=<private-code>` returns only the safe Property,
  verified Unit and eligible hostel Beds named by a valid Unit access code.
- `GET|POST /properties/:id/join-requests/` lists manager-visible requests or
  lets an authenticated tenant request the exact Unit/Bed identified by that
  code.
- `POST /join-requests/:id/decision/` accepts
  `{"approved":true|false,"note":"..."}`. Approval creates no tenancy or
  occupancy; it authorizes the provider to prepare the request-linked lease.
- `GET /properties/:id/invitations/` remains manager-readable for historical
  records only.
- `POST /properties/:id/invitations/` and
  `POST /property-invitations/{resolve|accept|decline}/` return HTTP 410
  (`gone`) with the Unit access-code replacement path. They never mutate a
  historical invitation.

Pending-request and active-access duplicate protection is scoped to the exact
rentable target (`Unit`, or `Bed` within it), not to the parent Property. A
tenant may therefore hold valid tenancies for multiple Units in one Property;
the allocation and lease constraints still reject conflicts on the same
exclusive space.

`POST /me/leases/` accepts `join_request_id` for private acquisition and
requires an approved request bound to the named tenant and exact Unit/Bed.
Supplying the deprecated `invitation_id` returns HTTP 410; an accepted legacy
invitation cannot authorize a new lease. `POST /leases/:id/offer/` then freezes
and sends the agreement.

Sharing Unit access and approving tenancy requests require current identity and
Property authority. Lease activation rechecks those capabilities and links the
lease to occupancy. Ending the lease also ends the linked occupancy.

A provider recording or confirming an **off-platform** payment requires Property
`leases` authority and nothing more. It deliberately does **not** require a
Rooomly receiving account: cash or a direct bank/MoMo transfer has already
reached the provider outside Rooomly, and refusing to let them acknowledge money
they were actually paid would push the record off the platform entirely.
Tenant-authored payment claims need only that the tenant is a party to the
lease. The separate `payment_collection` capability, which does turn on a
verified receiving account, describes platform collection and is reported to
clients as such.

## The rentable space

- `GET|POST /properties/:id/units/` lists or creates the spaces in a property.
- `GET|PATCH /units/:id/` reads or corrects one space. `PATCH` is refused while
  a reviewer holds it, and after approval — where changing it is a re-check.
- `GET|PUT /units/:id/amenities/` returns `{options, chosen}` and replaces the
  whole set. `PUT` rather than POST/DELETE because the screen *is* the set, and
  an add-and-remove pair can half-land on a phone that loses signal. Every
  selected Unit amenity becomes a named, required photo slot in the Unit's
  condition evidence policy.
- `GET|POST /units/:id/photos/` and `PATCH|DELETE /units/:id/photos/:media_id/`
  manage a space's photographs. `PATCH` on an item makes it the first image —
  it sets a field on a row that already exists; `DELETE` removes it. Capacity is
  authoritative and dynamic: one required overview, one required photograph
  for every selected Unit amenity, and two invited context views.
- `GET|PUT /properties/:id/amenities/` — the same, for the compound. Its GET
  also returns `confirmed`; PUT sets that durable confirmation even when
  `chosen=[]`, so creation can distinguish “none” from “not answered yet”.
- `GET /amenity-options/?scope=unit|property&space_type=<type>` is the amenity
  vocabulary, filtered server-side. Public, like `/property-types/`: it
  describes the product rather than anybody's data.
- `GET /property-types/` also carries `water_sources`, `power_meter_types` and
  `compound_types`. Those three are not presentation: `trust.evidence_policy`
  reads the stored values to decide what a property must photograph, so a form
  offering a value the backend does not have would build a checklist nobody
  could finish.
- `PATCH /properties/:id/` accepts `title`, `water_source`, `power_meter_type`,
  `compound_type`, `has_security`, `is_gated` and `notes` — the details step of
  property setup. It has accepted them since Phase 2; nothing sent them until
  the setup flow existed, so every property carried `unknown` for the two the
  evidence policy reads.
- `POST /units/:id/verification/` submits the space for review. Refused with
  409 until the **parent property's complete verification package is verified**
  — authority approval alone is insufficient. A space can be drafted,
  described, photographed and saved under an unverified property, and only
  asking for a decision waits. The refusal names the property review as the
  blocker.
- `POST /units/:id/verification/recheck/` reopens an approved space. Separate
  from `POST /units/:id/verification/`, which submits — one asks for a decision
  and the other takes an existing one away, and sharing a verb is how somebody
  withdraws a listing meaning to send one.

A unit response carries three independent lifecycles — `verification`,
`publication` and `availability` — plus `amenities`, `primary_photo` and
`permitted_actions`. Clients render `permitted_actions`; they never derive it.
`condition_state` is retained alongside `verification.state` for clients built
before the fuller vocabulary existed.

The Unit response carries `access_code` metadata (`state`, issue/expiry time,
version and permitted actions), never a readable credential. The deprecated
`join_code` compatibility field is always `null`.

- `POST /units/:id/access-code/rotate/` creates or replaces a private share
  code for a currently verified Unit in a verified Property. The raw code is
  returned by this response exactly once.
- `POST /units/:id/access-code/revoke/` invalidates the active code while
  retaining its metadata and audit history.
- `GET /property-join-lookup/?code=...` resolves one verified Unit.
- `POST /properties/:id/join-requests/` accepts `access_code`; the deprecated
  write-only `join_code` key remains temporarily accepted for installed-client
  compatibility.

Expiry, rotation, revocation, Unit/Property verification loss and archive make
the code unusable. Lookup and request endpoints return the same not-found
response for invalid and unavailable values and enforce per-user and per-IP
throttles. A private share code may create more than one pending request because
each still requires manager approval. Direct invitation tokens are retired and
are not accepted by this endpoint.

Photographs attached to a space are also the evidence its check is decided on:
one upload files both. Adding one is refused unless the file is a scan-clean
property photo, because these are shown publicly.

## Provider verification and public listings

- `GET /provider/readiness/`
- `GET|POST /provider/applications/`
- `POST /provider/applications/:id/evidence/`

Provider submission may reference an existing `organization_id` and
`property_id`. Approval verifies that organization's authority for that exact
property; it does not create blanket authority or verify every listing.

A draft listing may be created for private inventory before KYC. **Publishing
requires the space itself to have been checked**, in addition to current phone,
identity and property authority; an unchecked space is refused with the
outstanding review named. A checked space publishes directly rather than
queueing — moderation keeps `flag` and `suspend` over live listings.

`GET /listings/:id/` returns a `space` block, a `property_context` block and an
ordered `gallery`: the Unit primary photo, remaining Unit photos, unique
campaign photos, then current approved Property-condition evidence. Each item
identifies its `source`, `source_label` and existing `file_id`; duplicate files
appear once and no storage copy is created. Only usable, non-sensitive Property
photos receive anonymous URLs. Property evidence disappears from the public
gallery if its approval is no longer current. The street, house number and
space entrance note are never returned — they are released when a viewing is
confirmed. Search results keep the lighter shape.

`GET /listings/:id/related/` returns at most four lightweight listing results.
It uses the same public-visibility read model as `GET /listings/`, so the
current listing, non-active listings and Units with an active Occupancy are
never returned. Ranking normalizes yearly rent to a monthly amount and orders
by locality, affordability bands, district, Property/space type, bedrooms,
furnishing, and active Unit- and Property-amenity overlap. Location and
affordability carry the dominant weights; physical similarity only refines
them. This is a capped continuation of discovery, not a paginated feed.

Viewing resources returned by `GET /me/viewings/`,
`GET /me/viewing-requests/`, `GET /viewings/:id/` and viewing transitions carry
`viewing_directions: null` until a slot is confirmed. During the confirmed
slot's location window, the requesting tenant and a current manager of that
Property receive:

```text
street, house_number, digital_address, latitude, longitude,
building, wing, entrance_note
```

`GET /me/viewing-requests/` scopes the provider inbox through the existing
Property/organization authorization query, not `Property.owner` alone. Current
owners, assigned managers and authorized representatives therefore see the
same requests they are permitted to offer, decline and complete.

Viewing responses also include immutable `appointments`, structured
cancellation metadata, a server-derived `actions` capability object, and an
`attendance` resolution object. Before confirmation, tenant `withdraw` and
provider `decline` are separate actions. After confirmation, either participant
may `reschedule` or submit a structured `cancel`; the counterparty selects a
replacement slot. `attendance-report` opens a pending allegation only after the
check-in window closes, and only the reported party may call
`attendance-response` with `confirm` or `dispute`. Direct no-show outcomes are
rejected; `outcome` accepts completion only after verified check-in.

The block returns to `null` after cancellation, a recorded outcome, or the end
of the confirmed slot. Serializer checks are participant-aware even when the
calling view has already scoped the resource. Approximate locality and landmark
remain the only location fields available before confirmation and on public
listing APIs.

## Rental applications

- `GET|POST /me/applications/` is the tenant's application list and submission
  endpoint. POST accepts the listing id, advance offer and optional move,
  household, work, income-band, guarantor and message fields. It returns 201
  with the authoritative application snapshot.
- `GET /me/received-applications/` is the provider inbox, scoped through the
  existing property and organization authorization model. `?open=true` limits
  it to submitted and under-review rows.
- `GET /applications/:id/` is participant-only.
- `POST /applications/:id/review|accept|reject|withdraw/` performs the existing
  lifecycle transitions through the application service.

Submission is allowed only for an `ACTIVE` listing. That state already carries
the listing's publication, availability and verification gates; the application
domain does not invent a second verification test. The backend also refuses an
application for one's own managed listing and more than one current application
by the same tenant for the same Unit. Submitted, under-review and accepted rows
hold that Unit-level gate; rejection or an explicit tenant withdrawal frees it.
The application retains its source listing snapshot, but withdrawing and
recreating the listing cannot bypass duplicate protection. Applying emits the existing audit record
and `application.submitted.v1` outbox event; it does not create a tenancy or
lease.

The public web listing links to `/apply/:listing_id`. Authentication carries
that same-origin path through sign-in or registration; external return URLs are
discarded. Mobile continues to consume the same endpoint and lifecycle.

## Lease offers and tenant decisions

- `GET /me/leases/` returns agreements sent to the authenticated tenant. An
  unsent provider `draft` is deliberately excluded.
- `GET /leases/:id/` is participant-only, except that the named tenant cannot
  retrieve a draft before the provider offers it.
- `POST /leases/:id/accept/` and `POST /leases/:id/decline/` are available only
  to the named tenant while the offer is `offered`. A repeat or late decision
  returns a conflict rather than replaying the transition.

### The guided workflow

`workflow_version` selects the lifecycle. `canonical_v1` leases are built from a
versioned template and carry two states the older `legacy` path does not.

```
draft → ready → offered → tenant_accepted → awaiting_activation → active
```

- `PATCH /leases/:id/` edits builder terms while a lease is `draft` or `ready`.
  It refuses once a tenant may be reading the offer, and points at amendment.
- `POST /leases/:id/ready/` marks the draft complete and renders the preview.
  Separate from sending, because sending is the provider's acceptance.
- `POST /leases/:id/offer/` freezes the rendered document and sends it. In
  production this **refuses an unapproved template version**
  (`LEASE_TEMPLATE_REQUIRE_APPROVAL`).
- `POST /leases/:id/review/` records the tenant's first deliberate opening of
  the complete frozen agreement. Idempotent and tenant-only.
- `POST /leases/:id/confirm/` is the provider's confirmation *after* the tenant
  has accepted. It re-verifies the snapshot against the recorded acceptances,
  writes the final PDF and activates. A `legacy` lease rejects this: it was
  confirmed when it was sent.
- `POST /leases/:id/amend/` opens a **replacement** lease that supersedes an
  `active` one, carrying its terms forward with the submitted changes applied.
  Answers `201` with the new agreement. The amendment travels the whole
  offer/accept/confirm path, so a material change needs the tenant's renewed
  acceptance; the original stays `active` until the amendment activates, and is
  then marked `superseded`. Only one amendment may be open per version, enforced
  by both a service check and a database constraint.
- `GET /leases/:id/document.pdf` returns the frozen final PDF to either
  participant, `attachment` by default and `inline` with `?disposition=inline`.
  It is `404` until both parties have bound themselves and the document exists.

An agreement records the `template_code` and `template_version` it was rendered
from, the complete `rendered_document`, its `rendered_text`, a canonical
`content_hash` with its `hash_scope`, and the `final_pdf_hash`. **The rendered
document is stored, not merely the fields that produced it**, so a lease
accepted under one template release still reproduces exactly that agreement
after the template changes. The PDF endpoint and any regeneration read the
stored snapshot, never today's template.

An offered lease includes `agreement.terms`, the frozen offer snapshot, beside
`agreement.content_hash`, version and acceptance evidence. Clients must render
those terms for review rather than recreate the agreement from mutable lease,
property or user rows. Acceptance verifies the stored terms and prior
acceptance hashes before recording the tenant's evidence; an integrity mismatch
fails closed and leaves the offer open for investigation or replacement.
Web and mobile both require a separate confirmation after review, forward the
advance-notice acknowledgement where applicable, and allow a decline without
inventing or requiring a reason.
An offered agreement is also surfaced as a pending action on both tenant home
screens. Web tenant navigation includes Agreements directly, so acceptance does
not depend on the notification worker delivering an update first.
Legacy offers created before agreement snapshots remain readable and actionable
for compatibility, but clients identify them as older records.

Public listing APIs return only explicitly public `ACTIVE` listings. Revocation,
rejection, suspension, or a provider reopening the space for a re-check removes
public visibility without deleting the private property, tenancy or operational
history.

## Provider plans and entitlements

- `GET /plans/` is public and returns the three plans with their prices and
  entitlement values, read from the database. There are exactly three:
  `FREE`, `PRO`, `BUSINESS`.
- `GET /organizations/:id/billing/` returns the Portfolio's plan, subscription
  state, live usage, resolved entitlements and anywhere it currently sits above
  its plan. Owner and Admin see everything; an Accountant may read it; nobody
  else may. It is `private, no-store`.
- **The snapshot is for rendering, never for deciding.** Every limit and
  capability is checked again on the server at the moment of the write, inside
  the transaction that takes the slot.
- A refused create returns `409 plan_limit_reached` with
  `details: {entitlement, current, limit, current_plan, recommended_plan}` —
  enough to build the upgrade prompt without a second request. A refused
  capability returns `403 plan_feature_unavailable` with `details:
  {entitlement, current_plan, recommended_plan}`. `recommended_plan` is the
  cheapest plan that actually clears the limit, or `null` when none does.
- `GET /plans/` also carries each entitlement's name, description, value type
  and display group, plus `groups`, `headline_limits` and `upgrade_order`. That
  is deliberate: a client that hardcoded "Properties" or its own plan ladder
  would need a release every time packaging changed.
- Management: `GET /management/billing/` lists Portfolios with plan, live usage
  and over-limit state (`view_billing`); `GET /management/billing/:id/` adds the
  entitlement snapshot and the plan history; `POST /management/billing/:id/plan/`
  moves a plan and needs `manage_billing` plus a non-empty `reason`. The change
  is attributed to the management actor, never to the customer.
- No endpoint activates a paid plan. Checkout is a later phase and goes through
  the Payments Core; a plan is never activated because a client came back from a
  checkout page. See ADR 0032.

## Payment Core foundation

- `GET|POST /payments/intents/` lists the authenticated tenant's attempts or
  creates one for an outstanding `RentCharge`. POST accepts `obligation_id`,
  `payment_method` and an optional `amount_minor`; currency, lease, tenant and
  provider are server-derived. `Idempotency-Key` is mandatory.

  `amount_minor` is a **request, not a price**. The server bounds it against the
  obligation's locked outstanding balance and refuses anything larger, so
  overpayment stays impossible. Omitting it means the whole outstanding balance.
  A part payment that does not clear the balance must be at least
  `PAYMENT_MINIMUM_PART_MINOR`; settling the entire remaining balance is always
  allowed however small it is. This is the same rule `POST /rent/payments/`
  applies to an off-platform payment — one policy, both rails.
- The lease ledger's `digital_payment` object carries `available`, `reason`,
  `methods`, `allows_partial`, `minimum_part_minor`, `outstanding_minor` and
  `currency`. Every refusal returns the same keys with `available: false`, so a
  client never has to feature-detect a "no".
- `GET /payments/intents/:id/` is available to the owing tenant and current
  authorized property managers.
- `POST /payments/intents/:id/refresh/` requires `Idempotency-Key` and is the
  browser/app return contract. The client supplies no amount, status or
  transaction data: Rooomly queries the intent's provider reference and runs
  the result through the same locked validation and posting path as a webhook.
- `POST /payments/intents/:id/retry/` requires `Idempotency-Key`. It may reopen
  only a failed or expired tenant-owned intent and records a distinct attempt;
  replaying the request cannot create another attempt.
- `GET /payments/receipts/:id/` has the same participant boundary and exists
  only after server-confirmed success.
- `POST /webhooks/payments/:provider/` is unauthenticated at the consumer-token
  layer but requires the configured provider adapter's signature. Event ids and
  payload hashes provide replay protection.
- `GET /organizations/:id/payout-destination/` returns the Portfolio's selected
  masked payout profile, all non-removed saved profiles, and any provisioning
  operation still being checked. `profile` remains a compatibility alias for
  `active_profile`. It is owner/admin only and never returns provider account
  ids or tokens.
- `POST /organizations/:id/payout-destination/` provisions a bank or Mobile
  Money destination as a new record and requires `Idempotency-Key`. It returns `201` for the
  first completed request, `200` for a completed replay, or `202` when a
  provider response is ambiguous and reconciliation is required. The account
  number is write-only and is not retained by Rooomly.
- `POST /organizations/:id/payout-destinations/:profile_id/refresh/` asks the
  PSP for the verification state of that exact saved destination.
- `POST /organizations/:id/payout-destinations/:profile_id/activate/` selects a
  verified destination for payment intents created after the change. It never
  rewrites an existing intent's routing snapshot.
- `DELETE /organizations/:id/payout-destinations/:profile_id/` disables the
  destination for future use. The row, audit evidence, payment intent snapshots
  and settlement references are retained.
- `GET /organizations/:id/payout-institutions/?method=bank|mobile_money`
  returns Paystack's active Ghana institutions through the provider adapter.
- `POST /organizations/:id/payout-destination/resolve/` confirms a bank account
  name and returns only that name and a masked account. It does not provision or
  store a payout destination.
- `POST /rent/payments/`, `POST /rent/payments/:id/confirm|dispute/`,
  `POST /rent/charges/:id/waive/`, `POST /rent/charges/:id/write-off/` and
  `POST /organizations/:id/expenses/` honour `Idempotency-Key`. The header stays
  optional for installed-client compatibility, but every current web and mobile
  client sends one, so a duplicate tap replays the first response instead of
  writing a second claim or a second waiver.
- `POST /webhooks/payments/:provider/` answers `200 {"received": true,
  "ignored": true}` for an authenticated provider event this payment flow does
  not act on — an account-level transfer, dispute or identification event. The
  event is recorded with status `ignored`. Refusing them would make the provider
  retry and eventually disable the endpoint real payments arrive on.
- `GET /management/payments/` is restricted to Management principals with
  `view_payments` (currently Operations Admin only). Optional `status`, `kind`
  and bounded `limit` filters return reconciliation exceptions, confirmed
  transaction context, refund-record counts and settlement state. Reading this
  financial workspace is audit-recorded.
- `POST /management/payments/reconciliation/:id/` is restricted to
  `reconcile_payments` and requires `Idempotency-Key`, a non-empty `note`, and
  `status=investigating|resolved|accepted`. It records an attributed operational
  decision only. It cannot rewrite financial records, and terminal exceptions
  cannot be reopened or reclassified by this endpoint.

Paystack is implemented but disabled by default. Without an explicitly
configured adapter, intent creation returns `provider_unavailable` before
creating a placeholder record and the rent-ledger response exposes
`digital_payment.available=false`, so clients draw no checkout action. A
provider webhook or direct provider query must match intent reference, amount,
currency and payment method before it can create a transaction, ledger entries,
receipt, settlement or confirmed rent record. A Paystack intent's `next_action`
may include the short-lived transaction `access_code` used by web InlineJS in
addition to its guarded hosted-checkout URL. Popup callbacks, browser redirects
and client-provided success never settle an obligation.
