# Where the build is

Phases are defined in `projectBible` (repository root). This file says how far
each one actually got, and is the first thing to read before planning work.

**Last updated:** 30 August 2026

## Phase status

| Phase | State | Notes |
|---|---|---|
| 0 — Development foundation | **Done** | Django, Postgres, Redis, Celery, Next.js, Expo, design tokens, CI, health checks |
| 1 — Identity & trust | **Done, then rebuilt** | Rebuilt around passwords and provider standing — see below |
| 2 — Property & listings | **Done** | Properties, buildings, units, beds, media, listings, search, moderation |
| 3 — Rental workflows | **Done** | Viewings, applications, leases, rent ledger, notifications |
| P1 — Rentable space & allocation integrity | **Done** | Temporal exclusion constraints; unit-vs-bed check; `SpaceType` |
| P2 — Evidence policy engine | **Done** | Requirements resolved at runtime; Unit review requires its overview plus each selected amenity photo (`2026.08.4`) |
| P3 — Space verification lifecycle | **Done** | Draft → ready → submitted → under review → verified, served not derived; editing follows the state |
| P4 — Publication & listing | **Done** | Three axes on the space; publication gate actually enforced; space photographs are its evidence |
| P5 — Discovery, viewing & applications | **Done** | Tenant/provider web and mobile parity; exact-location privacy; application/viewing lifecycle actions |
| P0.5 — Multi-tenancy + lifecycle policy | **Done** | Tenant portfolio; shared policy foundation (ADR 0021); archival over deletion |
| 4 — Property operations | **Mostly done** | Portfolio/Team lifecycle, private inventory, occupancies, provider-level Tenants and Account Archive are complete. Advanced dashboards outstanding |
| 5 — Payments | **Implementation in progress** | Core, Paystack adapter, payout routing, settlement/reconciliation, tenant/provider UI and recurring reminders exist; PSP remains disabled pending sandbox validation |
| 6 — Wallet | Not started | |
| 7 — Digital services | Not started | Mobile has a Services tab listing what is coming |
| 8 — Financial services | Not started | |
| 9 — AI & housing intelligence | Not started | |

## What was rebuilt after Phase 4

Phase 1 shipped OTP-only sign-in, self-grantable roles, and onboarding fused
with registration. That combination let anyone who could receive one SMS reach
the provider workspace, so identity and access were reworked. The current model:

- **A password authenticates; the phone number only identifies.** OTP now proves
  a number during registration and authorises password recovery, nothing else.
- **Registration is separate from onboarding**, and no account exists until the
  form is finished. Proving a number returns a ticket, not a row, so abandoning
  a sign-up leaves nothing behind.
- **Provider standing is an account-level verification**, distinct from the
  per-property authority check, and is the only thing that opens the provider
  workspace or permits creating a property.
- **Workspace is context, not capability.** Which experience someone is in never
  decides what they may do.

Decisions and their reasoning are in `architecture/adr/0016`–`0020`.

## Authentication and entry: complete

A person can register, sign in, recover a password, be routed to the right home
portal, and — as a provider — submit verification and see where it stands. This
works on Django, Next.js and Expo, driven from one backend contract.

Web sessions now carry a stable random browser-installation id and a readable
browser/OS label. Re-authenticating on the same installation supersedes its old
refresh family instead of adding another active “Unknown device” row; genuinely
different devices remain signed in independently, and revoked rows remain in
security history.

Native session renewal now bypasses bearer-token acquisition, preventing the
single-flight refresh promise from waiting on itself when an access token
expires. Temporary refresh/network failures retain the secure session snapshot;
only an explicit server refusal signs the mobile account out.

The remaining native expiry boundary is also closed: when a protected request
still receives a 401, mobile now forces one single-flight refresh and replays
the request with the replacement bearer token, matching web behavior. A 403
authorization decision or a 408/429 client condition no longer erases a valid
mobile session. Rotated refresh credentials are persisted before the new access
token is published to callers.

Account Verification is now a status overview on web and mobile rather than a
second onboarding form. Phone, identity and provider standing remain personal
Trust facts. Bank/Mobile Money readiness deliberately reads the active
Portfolio's `PayoutProfile`, because the Paystack subaccount belongs to the
organization rather than the signed-in person. Owners/admins can continue
straight to settlement setup or management; other members are told that the
destination is owner-managed. Identity evidence collection is a focused page,
and mobile now uses the same **Verification** name as web.

Most Phase 2–4 surfaces predate the current capability model. Provider entry,
Portfolio initialization, Properties → Property → Unit and Provider Home have
now passed the current refinement quality gate, including the approved native
Property Units/Details correction and provider Home/Payments navigation.
Provider Tenants → Tenancy, Provider Viewings and Provider Tenancy Requests are
complete. Provider Leases is complete and awaiting user testing; Provider Rent is next. Remaining
areas and exact evidence are tracked in `docs/design/UI_UX_PRODUCT_DESIGN.md`.

## Provider entry and Property-category consistency

The old workspace concept no longer leaks into tenant or ordinary individual
provider flows. The stale mobile provider-home action routed directly to full
Organization setup after a legitimate tenant → provider switch. Web also kept
related stale copy and a tenant empty-state shortcut. These now use the
canonical workspace switch and first-Property route. Full business/hostel/team
Portfolio setup remains available from Team and its API is provider-capability
protected.

Property activities were also being treated by both clients as a Property-type
allow-list. Because explicit Portfolio setup defaulted to Residential, the next
Property form showed only Residential even though backend metadata correctly
served Residential, Commercial and Hostel. Clients now render the complete
backend type contract, explicit setup starts with no assumed activity, and a
successful Property creation records its category as a Portfolio activity.
Activities remain useful descriptive/prioritization metadata, not authorization.

Regression coverage exercises tenant → provider switching, automatic personal
Portfolio initialization, continuing first-Property setup, an existing
Residential-configured Portfolio creating Commercial inventory, explicit hostel
business setup through room and Bed creation, and refusal of direct tenant-only
Organization creation. Targeted result: 25 backend integration tests, 77 web
tests and 14 mobile tests passing on 24 August 2026; the canonical core
lifecycle smoke also passes.

## What the space work changed

A rentable space now carries its own photographs, its own amenities and three
independent lifecycles, and both clients render all three rather than one pill
that answered one question and implied two more.

Two things were found on the way and fixed:

- **The publication gate was written down and not enforced.** An unchecked space
  could be advertised and was merely queued for moderation. `publish_listing`
  now calls `can_publish`, which had been refusing this all along with nobody
  asking.
- **Presigned download URLs had never worked in a browser.** They were signed
  against the internal storage endpoint and then rewritten to the public one;
  SigV4 signs the host, so MinIO answered `SignatureDoesNotMatch` and every
  listing photograph failed silently under a page returning 200. Downloads are
  signed against the public endpoint now, and marketing photos ask for `inline`
  so a browser will actually paint them.

## What the property lifecycle work changed

The property detail page now renders one provider-facing verification result.
Authority documents and condition photographs remain separate evidence checks,
but they belong to one explicitly linked submission package and Operations
decides them in one transaction. `verification.review_state` is the
authoritative `not_submitted → pending_verification → verified` lifecycle; the
more detailed setup state remains for routing and older clients. See ADR 0025.

The cause was not the page. `Verification.display_state` has four values and the
flow has nine, so a refused claim and an unstarted one arrived identically. See
ADR 0023.

A submission can also be withdrawn now. The provider-facing state is
`withdrawn`; the same package and evidence are retained for correction and
resubmission.

## Unit verification gate and access-code boundary

Sequential repair #2 is complete. Units remain creatable and editable drafts
under any Property review state, but submission now requires the unified parent
Property result to be `verified`; authority approval alone no longer passes the
gate. Web and mobile display the backend's explicit blocker.

## Occupied Unit protection boundary

Repair batch FIX 3 is complete. `Occupancy` is the availability truth for both
active Rooomly tenancies and `pending_lease` physical-occupancy context. An
occupied Unit cannot be published, accept a viewing, public application or
private join request, reopen verification, change checked characteristics, amenities,
photographs or bed allocation, or be archived/deleted. Its private entrance
directions remain editable as harmless operational information.

The backend serializes Unit publication, application/join-request creation and
occupancy activation on the Unit row. Automatic listing withdrawal and access
code revocation remain normal cleanup, but neither is the only enforcement
boundary. Web and mobile render the same permitted actions and replace the
publication/recheck controls with a clear occupied-state explanation.

## Hostel-only bed boundary

Repair batch FIX 4 is complete. Bed allocation is now available only for a
`room` Unit under a Property whose canonical type is `hostel`. Residential
rooms no longer advertise bed support in the backend vocabulary, expose bed
management in web/mobile, load bed selectors, or accept bed-creation requests.

The same backend predicate protects service calls, HTTP creation, private
acquisition, lease drafting and occupancy. A Property with Bed history cannot
change out of the hostel category, and every category change validates its
existing Unit types. Pre-existing invalid non-hostel Bed rows are preserved for
history but hidden from active read models and refused by new lifecycle work.
No schema migration was required; this is a cross-table service invariant.

## Public Unit and Property gallery

Repair batch FIX 5 is complete. Public listing detail now exposes one ordered,
deduplicated gallery containing the Unit's checked photos, unique listing
campaign photos and appropriate photographs from the wider Property. The Unit
primary photo remains first, and Property entries are explicitly labelled as
wider context in web and mobile.

Property context is sourced from the current approved Property-condition
evidence, not arbitrary editable media. Sensitive files, non-photo purposes,
unusable uploads and evidence from revoked/expired/superseded reviews are
excluded. Reused files are deduplicated by file ID and remain referenced in
their original storage location. Existing nested photo arrays remain for
installed clients. No migration or file copy was required.

New Units have no access code. Unit approval makes a code eligible but does not
create one; a provider explicitly creates or rotates it only when private
sharing is needed. Draft, pending, rejected, unverified, suspended and archived
Units cannot create, expose or use one.

Sequential repair #8 completes the credential boundary. The raw 128-bit code
is returned once, while the Unit stores only a peppered HMAC, issue/expiry/
revocation timestamps and a monotonic version. Codes expire after 30 days by
default; rotation invalidates the old code immediately, and verification loss
or archive revokes it. Lookup and join-request attempts have per-account and
per-IP throttles and share a generic not-found response. Migration
`property.0013` converts existing verified Unit codes to hashes with a 30-day
compatibility window and preserves all audit, verification and tenancy history.

The private share/access code remains reusable because it only creates a
manager-approved tenancy request. Approval records the decision but does not
create an active tenancy. Direct phone-bound tenant invitations are retired;
see ADRs 0026 and 0029.

Private access duplicate protection now follows the rentable space rather than
its parent Property. A tenant already occupying one Unit may request and hold a
second Unit in that same Property. Exact Unit/Bed duplicates and overlapping
exclusive allocations remain blocked by the existing service checks and
PostgreSQL constraints.

Web and mobile keep **Join another tenancy** visible even when the tenant
already has one or more tenancies, so the action is not hidden behind an empty
state. The destination accepts only a **Unit access code**. It identifies one
verified private Unit, lets hostel tenants choose the exact Bed, and creates
the manager-approved tenancy request. There is no invitation tab or acceptance
route.

Mobile provider parity now includes code status, create/rotate, one-time share
and revocation directly in the Tenants tab for the selected Unit. Opening
“Manage tenants” carries the chosen Property into that tab; the same shared
component remains available on the Unit workspace, so the two entry points use
identical security behavior. On the Unit workspace it is a first-class panel
immediately below the lifecycle summary.

## Free viewings and verified attendance

Physical Rooomly viewings no longer carry an active fee field or fee experience.
Legacy fee input is rejected at the API boundary. A tenant and provider first
confirm a scheduled slot; near that time the tenant can display a locally
rendered QR and matching six-digit fallback code from one short-lived server
session. Only hashes are stored. The session is participant-bound,
single-use, attempt-limited and invalidated by cancellation or rescheduling.

Provider mobile scans the QR or enters the code; provider web supports the code
so camera access is never required. Both reach one validation service and move
the viewing from `confirmed` to `checked_in`. Only then may it be recorded as
`completed`; no-shows remain explicit outcomes. The tenant can subsequently
request the home through the existing tenancy-request workflow, save the
listing, create an operations report, or close the prompt as not interested.
None of these actions creates a Tenancy directly.

Confirmed schedules are now durable appointment history rather than disposable
timestamps. Either participant may propose replacement times; the counterparty
confirms the replacement, and every old appointment records who rescheduled it
and when. The old QR/code pair is invalid immediately. Before confirmation the
tenant withdraws and the provider declines; only a confirmed appointment can be
cancelled, with structured reason, optional note, actor, timestamp and computed
notice minutes. Web and mobile encourage rescheduling before cancellation.

An expired appointment with no check-in does not blame either party. A tenant
or authorized provider may report the other party absent after the check-in
window closes. That creates a pending factual allegation and notification. Only
the reported party can confirm or dispute it: confirmation derives the matching
verified no-show, while disagreement becomes `disputed` for support review.
Audit and outbox events retain every step; no trust score or penalty is applied.

## Request idempotency

Sequential repair #9 is complete. The existing `IdempotencyKey` table is now an
executed protocol rather than unused schema. Selected application, viewing,
tenancy-request, lease, verification and access-code revocation claim and replay
within the same PostgreSQL transaction as their domain, audit and outbox writes.
Concurrent duplicate requests execute once; a changed payload under the same
key returns 409; retryable 5xx work rolls back and may run again.

Web, mobile and Management send stable per-operation keys and only retry those
protected calls. Management claims are attributed to the dedicated reviewer
identity. Current non-payment endpoints keep keys optional for installed-client
compatibility; Payment Core can require the same protocol. Default replay TTL is
24 hours, and Celery removes expired claims hourly. See ADR 0027.

## Payment Core foundation

Sequential repair #12 has started Phase 5 without enabling a pretend payment
rail. `RentCharge` remains the authoritative obligation. A tenant can create a
provider-neutral, full-obligation `PaymentIntent` only through a configured
adapter, with amount and currency derived on the server and a mandatory
`Idempotency-Key`. Production has no configured adapter today, so it fails
before creating an intent and both clients continue to describe payments as
records rather than checkout.

The signed callback path validates provider, event replay hash, intent
reference, amount, currency, payment method and provider transaction uniqueness.
Success atomically produces an immutable transaction, two balanced
non-custodial ledger lines, a durable receipt, a pending settlement, a
PSP-distinguished confirmed rent record, audit evidence, outbox events and
notifications. PostgreSQL blocks updates/deletes to transaction, ledger and
receipt tables. Forged or mismatched callbacks cannot settle an obligation, and
PSP-confirmed rows cannot be reopened through the offline two-party dispute
workflow.

New processor-confirmed receipts now freeze a versioned issued-time snapshot
and the exact printable PDF rather than relying on mutable tenant, provider or
premises records. Tenant and authorized provider access share one backend
boundary; web supports view/download/print and mobile uses native view/save and
print. The snapshot includes the factual particulars identified in Act 220
s. 33, while stamping and electronic-form sufficiency remain explicitly subject
to Ghana-qualified legal review rather than a Rooomly compliance claim.

Tenant checkout now exists behind a server-returned capability on the lease
ledger. Web and mobile always expose `Pay rent` for an outstanding tenant
charge, leading to a dedicated amount-and-readiness review. Payment methods and
the initiation control remain absent when the adapter or verified Portfolio
subaccount is unavailable. Browser/app return calls an idempotent refresh
endpoint which queries the PSP by the stored provider reference and accepts no
client-supplied payment facts. Failed/expired attempts can be retried idempotently. Successful
payment language remains distinct from provider settlement, and the clients
state the product rule that the property owner bears the processor fee.

Payment reconciliation now has a dedicated Management workspace restricted to
Operations Admins. It separates confirmed payments from provider settlement,
surfaces mismatched evidence and records investigating/resolved/accepted
decisions with a mandatory note, idempotency and Management-principal audit
attribution. Those decisions classify an exception only; they cannot alter the
immutable transaction, allocation, receipt, rent balance or settlement.

Recurring obligation reminders now run hourly against the authoritative rent
schedule and emit only the documented daily checkpoints: 7, 3 and 1 days before,
the due date, and 1, 3 and 7 days overdue. Obligations for one lease that share a
due date are grouped into one message. A durable uniqueness constraint prevents
repeat delivery, and the notification handler rechecks the current outstanding
balance so a payment completed before dispatch suppresses stale copy. Tapping a
reminder opens Payments on web or mobile; it never implies digital checkout is
available.

Tenant Payments is now a first-class role-aware destination on web and one of
the five primary tenant tabs on mobile. The unfinished Services hub is hidden
from the mobile tab bar rather than displacing the working money journey.
It keeps obligations separated by home, prioritizes overdue and resumable
payments, and retains completed receipts plus unsuccessful attempts. Provider
Payments now distinguishes rent paid online from awaiting settlement, settled
proceeds and deducted fees. Mobile off-platform payment recording moved from a
long modal to a dedicated screen; all payment and settlement authority remains
on the existing server boundaries.

Lease activation remains acceptance-driven. Moving it behind initial payment is
deferred until a licensed PSP, observed sandbox behavior, and a tokenized payout
destination for organization-managed properties exist. This preserves the
working tenancy flow rather than leaving accepted tenants waiting on a payment
method Rooomly cannot yet offer. See ADR 0028.

### Payment integrity audit — 31 August 2026

The whole payment domain was traced UI → API → service → database → PSP →
webhook → allocation → ledger → receipt → settlement and audited against its own
documentation. Five financial-correctness defects were found and fixed:
allocations and waivers were immutable in Python but not in the database; a
provider confirmation with no completion time crashed mid-post and was retried
for ever; a lost callback was detected but never recovered by anyone, tenant or
operator; authenticated provider evidence that could not be applied was recorded
where nothing read it; and an outbox event whose worker died stayed claimed
permanently — which for `lease.activated.v1` means a live tenancy with no rent
schedule at all. Rent's financial mutations now honour the `Idempotency-Key`
their clients were already sending, and two stale tests that pre-dated this
audit were corrected rather than left red.

The reconciliation rule was narrowed deliberately: a genuine disagreement is
still only ever recorded, but provider-confirmed success that Rooomly simply
never heard about is now ingested through the same validated boundary a signed
webhook uses.

The top remaining architectural risk is that provider HTTP calls run inside the
request's database transaction, against ADR 0027's own constraint. It is
documented with a recommended remediation rather than fixed, because the fix
changes the idempotency protocol.

`docs/architecture/PAYMENT_IMPLEMENTATION_STATUS.md` is now the authoritative
payment checkpoint: implemented architecture, supported paths, invariants and
where each is enforced, state machines, open decisions and remaining risks.

The three architectural blockers that audit surfaced are now resolved (ADR 0031
covers the first two):

- **Part payment is one rule for both rails.** An off-platform payment could
  always be part of a charge while checkout demanded the whole balance, so the
  same money was acceptable in cash and refused through the processor.
  `resolve_payable_amount` now bounds both, with a fee-driven floor that never
  traps a small final balance. Overpayment stays impossible.
- **Collection readiness has one authority.** `payment_collection` read a
  person's bank-account stamp while the payment path resolved a Portfolio's
  provider-verified destination. Both now read one queryset. Recording an
  off-platform payment was separated back out onto `leases`, where the server
  already enforced it, and the stale client copy describing the removed rule was
  corrected on both platforms.
- **The exception queue has an owner.** Exceptions are announced when opened and
  re-announced every 30 minutes, escalating to `critical` after a day; the
  Operations workspace reports how long the oldest has been ignored, and the
  runbook carries the routing table and triage procedure. Binding those events to
  a pager remains a deployment decision.

Checkout is still not exposed. Production has no configured adapter.

## Executable core lifecycle smoke

Sequential repair #10 is complete. `ops/smoke_phases.py` now runs one isolated
integration journey instead of mutating the development database through the
obsolete Phase 2/3 contracts. The test registers provider and tenant accounts,
completes provider review, creates an Organization, creates and verifies one
complete Property package, creates and verifies a Unit, publishes and discovers
the listing, confirms a viewing, submits and approves an application, offers
and accepts the immutable lease, proves Tenancy and Occupancy exist, dispatches
the activation event, and records and confirms the existing non-PSP rent claim.

Property and Unit review decisions use the Management APIs, and high-impact
mutations carry idempotency keys. File bytes and the currently unimplemented
payout-destination verification flow are explicit test prerequisites; the
rental lifecycle itself uses current HTTP contracts. The test database is
discarded after the run, so smoke validation no longer pollutes local product
data. Run it with `python ops/smoke_phases.py`.

## Web viewing confirmation and exact-location release

Sequential repair #3 is complete. The tenant web portal consumes the same slot
offer as mobile, requires the tenant to select a future slot, and confirms that
choice through the existing tenant-only transition. Viewings are free; fee
fields were subsequently removed from the active contract. The old web read
model expected a non-existent `scheduled_for` field and could only show a status
row, so an offered viewing was a dead end.

The viewing response now has a nullable `viewing_directions` block. Approximate
locality and landmark remain visible before confirmation; street, house number,
GhanaPost GPS, exact coordinates, building/wing and entrance instructions are
released only to the requesting tenant and current property managers after a
valid confirmation. Cancellation or an outcome revokes the block, and an
unresolved confirmed appointment stops exposing it when the slot duration ends.
The public listing contract remains unchanged.

The provider viewing inbox is scoped through the same current Property and
organization authorization model used by viewing decisions. The earlier read
query filtered on `Property.owner` alone, so an authorized manager or agent
could receive and act on a viewing by id while their Viewings page incorrectly
looked empty.

## Public web rental applications

Sequential repair #4 is complete. An active public listing now offers two
separate tenant actions: request a viewing, or apply to rent. The application
path uses the existing `application` model and `POST /me/applications/`; it
does not create a tenancy or lease. A signed-out visitor returns to the same
listing application after either sign-in or registration.

The web form captures the existing application claim, shows any advance
shortfall before submission, maps backend validation to the relevant fields,
confirms the successful submission, and links to the tenant status view. The
provider inbox continues to use the same record and now includes every current
property manager allowed by the existing property/organization authorization
model, rather than the property owner alone.

Backend validation now rejects unknown income bands and malformed Ghana
guarantor numbers before model persistence, normalizes valid guarantor numbers,
and preserves an explicitly submitted zero-month offer instead of replacing it
with a profile default. Active listing, ownership and current-application-per-
Unit rules remain authoritative on direct API calls.

Application duplicate protection is now keyed to the underlying Unit rather
than a particular Listing campaign. Submitted, under-review and accepted
applications prevent another current application from the same tenant even if
the provider replaces the listing. A conditional database constraint closes
concurrent-request races. Existing accidental duplicates are retained with
their original statuses as superseded history; any record already linked to a
lease remains authoritative.

## Discovery, viewing and application phase completion

Sequential repair #11 is complete. The final gap was client parity, not a new
backend workflow. Mobile providers now have portfolio-wide viewing and rental-
application queues, can offer or replace viewing times, declare fees, record
outcomes, and review/accept/reject applications through the existing authorized
APIs. Provider notifications open those queues instead of incorrectly opening
the tenant pages, and the provider home and More tab make both queues visible.

Tenant applications now carry move-in date, occupation, employer and income
range on mobile as they do on web. Web tenants can withdraw submitted or under-
review applications. Both listing clients detect an existing open viewing and
take the tenant to it rather than attempting a duplicate request; signed-out
mobile discovery exposes separate viewing and tenancy/application actions.
Expired offered slots explain that the provider must offer a new time, and a
failed listing action no longer replaces the already-loaded listing.

The backend remains authoritative for listing availability, verification,
duplicate applications, participant scope, cancellations, withdrawals and
provider decisions. No payment rail, virtual-viewing subsystem, check-in code,
or messaging system was introduced to close this phase.

## Web and mobile lease review, acceptance and decline

Sequential repair #5 is complete. A tenant now sees every open lease offer on
web and mobile, including the frozen property, space, parties, financial terms,
dates and conditions whose canonical hash was created when the provider made
the offer. Both clients use an explicit confirmation step, record
acknowledgement of the advance-rent notice where applicable, and call the
existing tenant-only lease transition. Decline is equally explicit and permits,
but does not require, a reason. Closed agreements remain visible as history.

The API now returns the immutable `LeaseAgreement.terms` with its hash instead
of forcing clients to reconstruct an offer from the live `Lease` row. Before a
tenant acceptance is recorded, the service verifies both the frozen terms and
every existing acceptance against that hash and fails closed on mismatch.
Provider drafts are no longer visible in the tenant inbox or tenant detail API;
they become tenant-visible only when offered. Provider access, immutable
acceptance evidence, activation audit/outbox behavior and legacy offers without
an agreement record remain intact.

Offered agreements now appear as a pending action on the web and mobile tenant
home screens, and Agreements is a first-class item in the web tenant navigation.
The existing `/leases` decision screens and tenant-only backend actions remain
authoritative; notification delivery is an additional alert rather than the
only route to acceptance. Accept and decline controls now sit immediately below
each offered agreement's heading on both clients; they are no longer buried
after the full terms and agreement evidence below the initial viewport.

The tenant tenancy portfolio now formats an activated lease's next outstanding
rent charge from its stored minor units and currency. The previous read model
referenced a nonexistent money property, causing `/me/tenancies/` to return 500
as soon as lease activation generated a rent schedule and making tenant home
appear empty.

## Historical: tenant invitation review before acceptance

> Superseded by FIX 9 and ADR 0029. This section records the former behavior;
> these creation and decision surfaces are no longer active.

Sequential repair #6 is complete. Entering or opening a phone-bound invitation
on web or mobile now performs only the non-consuming resolve step. The verified
recipient sees the provider, approximate Property locality, Unit or bed, space
description, provider note, expiry and any attached proposed financial terms
before an explicit decision. Editing the token invalidates that review, so one
invitation cannot be reviewed and another submitted unseen.

Acceptance remains the existing confirmed backend transition. Invitations for
an existing real-world tenant clearly say that physical occupancy is context,
not permission to bypass an agreement. Acceptance never activates Tenancy or
Occupancy; the provider must prepare a lease next. A new phone-bound `declined` terminal state, optional reason and
decision endpoint close an invitation without creating occupancy, tenancy or
lease acceptance. Both accepted and declined decisions add append-only audit
entries and transactional outbox events. The migration is additive and retains
all existing invitation and occupancy history.

Only an authenticated account with the verified invited phone can resolve or
decide the token. The preview exposes approximate locality but not street,
GhanaPost GPS, coordinates or entrance directions. Prospective private
invitation convergence is delivered by Repair #7 below; accepting the
invitation itself still creates no tenancy or occupancy.

## Historical: prospective private invitation to tenancy and lease

> Superseded by FIX 9 and ADR 0029. Accepted historical invitations cannot
> authorize new leases.

Sequential repair #7 is complete. `PropertyInvitation.purpose` now explicitly
separates `prospective_tenant` from `existing_tenant`, but both converge on the
same agreement boundary. Acceptance binds the verified account to the accepted
invitation and notifies the provider that a lease is required; it creates no
Tenancy, Occupancy or lease acceptance.

Web and mobile providers choose the invitation purpose rather than relying on
ambiguous copy. Accepted prospective invitations become actionable provider
items on the space/tenant operations screens. The provider creates the lease
through the existing lease service, the accepted invitation is validated as
the source and linked to the draft, and the existing offer transition freezes
the immutable agreement. The tenant reviews and accepts or declines that offer
on the existing web/mobile lease screens. Only lease acceptance activates the
Tenancy and Occupancy.

Historical invitations and their purposes remain available as audit history,
but neither active purpose can create occupancy in the invitation decision.
Audit and outbox history is preserved, and new acceptance events identify the
acquisition purpose and the required next lease step.

## Legacy tenant invitation retirement

Repair batch FIX 9 retires direct prospective/existing-tenant invitations as
an active acquisition workflow. Web and mobile creation/review/accept/decline
surfaces and client helpers are removed. Compatibility mutation endpoints and
backend service calls return HTTP 410 with the Unit access-code replacement
path.

`PropertyInvitation` rows, applied migrations, linked historical leases and
audit/outbox records remain intact. Migration `occupancy.0011` revokes every
open pending invitation without deleting it. Authorized providers may still
read historical rows; they cannot create or decide one. Lease drafting rejects
deprecated `invitation_id`, including for an accepted historical row.

New private acquisition is exclusively:

`Verified Unit → access code → tenancy request → provider approval → lease
offer → tenant acceptance → tenancy/occupancy`.

Provider approval creates no Tenancy or Occupancy. Existing physical occupancy
may be represented as context, but it does not bypass the request or agreement
boundaries. See ADR 0029.

## Repair-batch lifecycle consistency review

The final cross-domain review is green. Property verification gates Unit
verification; verified Units gate public listings and private access codes;
rentable-space allocation remains Unit/Bed scoped; active Tenancy/Occupancy is
lease-backed; occupied Units cannot be advertised or structurally mutated;
Beds remain hostel-only; public Unit galleries include approved Property media;
provider Tenants and Archive remain permission-scoped; mobile Add Home reaches
the access-code request flow; and no invitation route can bypass request → lease
→ tenancy. The activation boundary still supports a future required-payment
pause after lease acceptance.

## Provider-level tenant portfolio

Repair batch FIX 6 is complete. The provider web rail now has a first-class
Tenants area for the active organization workspace. It lists every active
tenancy the member is authorized to manage across that scoped portfolio and
links through to the Property, Unit/bed and exact Lease while showing the
agreement rent and current outstanding/overdue position. One person renting
two spaces appears as two tenancy rows; no duplicate Tenant model was added.

The same area now owns private tenant acquisition across the scoped portfolio:
verified Unit access-code management, pending tenancy decisions and the required
lease preparation after approval. Property and Unit pages link to Tenants rather
than maintaining competing request/action panels.

The existing organization portfolio endpoint remains the authorization
boundary. Its tenant projection now follows each active Occupancy's own
Tenancy and Lease. Previously it indexed leases only by Unit, which could show
every tenant in a multi-bed hostel room against the same unrelated lease. The
payload is additive and is also consumed safely by the existing mobile provider
tenant operations screen.

## Provider Account & Settings archive

Repair batch FIX 7 is complete. Web Account & Settings and mobile provider
More → Account now expose Archive. The permission-scoped `/me/archive/` read
model lists archived Properties and Units with their parent context, archive
time/reason, inventory counts and the server's current Restore decision. It
reuses existing Property/Unit records and append-only audit history; there is
no generic or duplicate Archive entity.

Restore now uses explicit shared lifecycle policies instead of only clearing
`deleted_at` or `is_active`. It refuses an unauthorized actor, a child whose
parent Property is still archived, new active dependents, an open review
contradiction, a space that no longer fits the Property category, or active Bed
inventory under a non-hostel Property. A valid restore does not republish old
listings, regenerate revoked access codes, revive expired verification, or
erase the archive transition. Property-first restoration makes a nested
archived Unit eligible only after its parent is valid again.

## Lease-gated tenancy activation

Repair batch FIX 2 is complete. Provider approval of an access-code tenancy
request stops before tenancy. Providers can prepare a private-acquisition lease
only from an approved request. Only acceptance of that immutable lease may
activate the Rooomly Tenancy and Occupancy.

The invariant is database-backed: `Tenancy.active/upcoming` requires
`activation_lease`, while an active `Occupancy` requires both `lease` and
`tenancy`. Legacy active records with an active linked lease are backfilled;
records without one become `pending_lease` context instead of remaining falsely
active. Tenant clients describe that state as requiring a lease, never “No
lease yet” on an active tenancy.

Lease acceptance now passes through `awaiting_activation`. The current
`lease_accepted` requirement activates immediately. The reserved
`initial_payment` requirement deliberately remains paused until a future
trusted payment-confirmation event calls the same activation boundary; this
adds no payment collection behavior in this repair.

## Creating a property, and submitting it

Two separate acts, which they had not been. The creation wizard's Documents step
filed the ownership claim for review on the spot, so creation could not be
finished without submitting and the wizard's last button read "Send the
photographs". The document is now recorded as a draft alongside the photographs,
and one action sends both when the provider chooses.

This made **created but not submitted** an expressible state — a property can be
run as private inventory indefinitely; verification is what allows advertising.
See ADR 0024, which also covers three defects found underneath it: deletion
permissions that were exactly backwards, a withdrawal path that no corrected
claim could get past, and a submission date shown for properties never sent.

## Provider plans and entitlements — 31 August 2026

Rooomly now knows what a Portfolio is entitled to. Three plans exist — **FREE,
PRO, BUSINESS** — and nothing charges anybody yet, which is the point: the
monetization brief's own implementation order puts *Portfolio → plan →
entitlements → limits → upgrade-ready* before checkout, so that is the whole of
this slice.

**The Portfolio subscribes, not the User.** `BillingAccount` is one-to-one with
`organization.Organization`. Four people working in one paid workspace, a
Portfolio handed to a new owner, and one person helping with two businesses on
different plans all work without a migration, because the subscription was never
attached to a person.

**Plan codes appear nowhere outside `apps/billing`.** Domain modules ask
`billing.enforcement.assert_can_add_property(...)`, never
`if portfolio.plan == "PRO"`. A test walks every Python file outside the billing
app and fails on a literal plan code, so repackaging stays a data change.

What is actually enforced today, each inside the transaction that takes the
slot, with the Portfolio row locked first:

| Entitlement | Free | Pro | Business | Enforced at |
|---|---|---|---|---|
| `property_limit` | 1 | 10 | 100 | private property creation |
| `unit_limit` | 5 | 50 | 1000 | adding a Unit |
| `team_member_limit` | 1 | 3 | 25 | invitation created *and* accepted |
| `team_management` | — | ✓ | ✓ | inviting anybody at all |
| `automated_rent_reminders` | — | ✓ | ✓ | the scheduled reminder job |

Everything else in the catalogue resolves and is readable through the API but
does not gate a feature yet, because the features it would gate are later phases.

**The reminder gate covers the scheduled nudge and nothing else.** Receipts,
payment confirmations, lease notices and the rent ledger itself are
unconditional — a Free Portfolio's charges are still built, still owed, still
visible and still payable, and a tenant can always see what they owe. Billing
may withhold the reminder; it may not withhold the debt.

A skipped checkpoint writes no reminder row, so a Portfolio that upgrades starts
being reminded on the next beat run rather than at the next checkpoint. A
property held by no Portfolio has no subscriber and so gets none — the same
answer the entitlement service gives a Portfolio with no subscription, and a
behaviour change for landlords holding property outside a Portfolio.

Counting is **live**, not cached. The brief sketched a `PortfolioUsage` table;
it is deliberately not built, because a stored count is a second answer to "how
many properties does this Portfolio have" and the first time it drifts it either
blocks a customer who is under their limit or lets one past it.

Unlimited is `is_unlimited=True`, never `999999`. A sentinel eventually gets
compared, printed or summed, and somebody reads "999999 properties" on a billing
screen.

Refusals carry what the upgrade prompt needs: `409 plan_limit_reached` with
`{entitlement, current, limit, current_plan, recommended_plan}`, where the
recommendation is the cheapest plan that actually clears the limit, or `null`
when none does.

**A downgrade removes nothing.** A Business Portfolio with 24 properties that
drops to Free keeps all 24 — readable, editable, lettable — and simply cannot
create a 25th. There is no code path that deletes a provider's properties
because of a billing event, and there must never be one. `GRACE_PERIOD` still
grants entitlements; after grace, premium *creation* closes and leases, tenants,
rent history, receipts and audit records stay reachable, because people have
legal need of them and a billing dispute is not a reason to withhold them.

Billing is now visible on all three surfaces. **Provider web** at
`/settings/billing`, beside Team: current plan, live usage against each limit,
the three-plan comparison, and an upgrade call-to-action. **Provider mobile**
under More → Plan, the same content in one scroll. **Management console** at
`/management/billing`: every Portfolio with its plan and live usage, where each
one sits over limit, a plan change that requires a reason, and the plan history
with who did it.

**No surface has a checkout.** Choosing a paid plan says it is not available to
buy yet; nothing is charged and no plan changes. Activating a plan without
confirmed payment is exactly the mistake the payment architecture spent its
effort preventing, so the button that would do it does not exist.

Reading billing in the console is a support capability (`view_billing`, on both
roles); changing a plan is a separate one (`manage_billing`, Operations Admin
only). A console plan change is an administrative grant, not a sale: it writes
the same `BillingEvent` and audit record as any other change, stamped with the
staff member rather than with the customer whose plan moved.

The CLI remains for scripting and for environments without a console session:
`python manage.py set_plan` — — `--list` to see every Portfolio with its plan and
live usage, `--portfolio <name|uuid>` or `--phone <msisdn>` with `--plan` to
change one. It goes through the same service, so a grant made from a terminal is
as traceable as one made from the console; a grant that skipped the trail would
be invisible, and "it was only for testing" is what every untraceable change was
for.

Portfolios created before billing existed had no subscription at all. They
resolved to Free by fallback, which was right by accident rather than by record,
so migration `0003_backfill_existing_portfolios` gives each one its billing
account and a Free subscription. It skips any Portfolio that already has a live
one, so it is safe to re-run.

Every screen reads entitlement names, descriptions and grouping from
`GET /plans/` rather than carrying its own copy, so renaming a capability or
moving it between plans stays a backend change instead of a release of three
frontends. Contract tests on both clients fail if a plan ladder is hardcoded.

Reads: `GET /plans/` (public) and `GET /organizations/:id/billing/` (Owner and
Admin manage, Accountant reads). **No endpoint activates a paid plan.** Checkout
is the next phase and settles through the existing Payments Core — a
server-priced invoice paid by a `PaymentIntent`, activated on confirmed payment,
never because a client came back from a checkout page. Reasoning in ADR 0032.

## Provider subscription checkout and the Plan & billing redesign — 11 September 2026

Superseding the "no checkout" statements above: a Portfolio owner or
administrator can now upgrade, renew and downgrade from **Settings → Plan &
billing** on the web. The plan still moves only on a server-confirmed payment.

**Backend.** `BillingInvoice` (server-priced, credit for unused paid time, one
open per account, paid/void final at the engine); `PaymentIntent.purpose` so the
existing Payments Core settles an invoice as well as a `RentCharge`; settlement
inside the one confirmation transaction with an allocation, ledger lines and a
subscription receipt, and no beneficiary settlement; a period-end sweep for
prepaid periods (grace, past due, scheduled downgrades, cancellation to Free);
customer quote, checkout, refresh, retry, cancel, downgrade and keep-plan
endpoints; payer notifications for subscription payment success and failure;
the operations workspace shows subscription payments by Portfolio. Held by
`tests/integration/test_billing_checkout.py` (45 tests) and the unchanged rent
payment suites. See ADR 0032's amendment.

**Web.** The page was rebuilt from Codex's draft, which had fabricated a
`suspended` account status the model does not have, used an undefined spacing
token, repeated plan, price and status three times, showed empty billing rows
for Free, exposed staff-written event reasons, decided permission from a visible
role, and ended every plan change in a "not connected" dead end. It is now one
plan surface with usage and a single attention strip, quiet billing terms and
invoice rows only where real, and a Change plan dialog — bottom sheet on small
screens — that reviews, pays through the shared Paystack popup and waits for the
server. Rules in `docs/design/UI_UX_PRODUCT_DESIGN.md` → Plan and billing.

**Seen, not only asserted.** Every subscription state and each step of the
dialog — upgrade with credit, pending, confirmed and failed payments, a
downgrade above the lower plan's limits — was walked through in a temporary
mocked-data route at 1440, 768, 430, 375 and 320px, then the route was removed.
The phone pass changed three things: the full comparison and the downgrade
review no longer squeeze three columns (each capability or limit takes its own
line), a plan with nothing to do no longer leaves an empty button slot, and the
sheet's two actions share a line when they fit. Escape now takes the same guard
as the close button from anywhere in the dialog. **Not yet seen against the real
API in a browser:** the in-app browser was signed out, so the page after a
genuine confirmation and reload is held by the integration tests, which assert
the billing read after the provider's webhook, rather than by a screenshot.

**Not yet:** automatic recurring charges, grace reminders, refunds, native mobile
checkout (mobile still reads plan and usage only).

## Safe downgrade restrictions, mobile Plan & billing, and a steadier dialog — 11 September 2026

**A downgrade still deletes nothing, and a paid plan's capacity no longer
outlives it.** Superseding "stay readable, editable and lettable" (ADR 0032 §8,
amended): what sits above the new plan's allowance is restricted, never removed.
A property or unit with a tenancy or agreement still running is `WIND_DOWN` —
tenants, rent obligations, payments and receipts carry on to the tenancy's end,
and nothing new starts. One with nothing running is `READ_ONLY` — every record
stays, and nothing new starts. Access is its own `billing.ResourceAccess` state;
no property, tenancy or lease status is ever written because of a plan.

**Backend.** `resource_access_service` restricts wherever the enforced limits
fall (immediate and scheduled downgrades, grace ending in past due, lapsed or
revoked overrides), keeps the provider's `KeepActiveChoice` or a documented
fallback (most running units, then oldest), settles wind-down to read-only when
the last tenancy or agreement ends (in that transaction, with a 15-minute sweep
behind it), and never lifts a restriction by itself. Reactivation is a
deliberate, capacity-checked endpoint, and restoring an archived property or
unit is capacity-checked too. Enforcement sits behind `billing.enforcement` in
the property, unit, building, bed, listing, discovery, application, viewing,
join-request, access-code, lease and tenancy services; the API refuses with
`409 resource_restricted`. The quote carries `resource_choice`, the billing read
`active_usage` and `resource_access`, and property and unit reads
`billing_access`. Held by `tests/integration/test_billing_resource_access.py`
(37 tests) and a two-connection reactivation race.

**Web.** The downgrade review asks what stays fully active in the approved words
(*You're using 8 properties* / *Free includes 1* / *Choose the property you want
to keep fully active.*), opens on the server's own selection, waits for a whole
choice, and closes with *Your records stay safe*. Meters count what runs in full
and name what is restricted; *Above your plan's limits* lists restricted
resources and offers *Reactivate* only where the server reports room; property
and unit pages say when they are restricted and stop offering *Add Unit*.

**The plan dialog no longer shakes.** Measured cause: neither the page nor the
dialog body reserved a scrollbar gutter, the dialog re-centred whenever its
content changed height, and plan cards dropped their second price line in one
billing cycle. The page and dialog body now reserve their gutters, the dialog is
anchored to the top, and every card keeps its price note. Re-measured at
1440×900 and 1366×768: switching monthly ↔ annual and opening the full comparison
move the dialog's top, left and width by 0px and every plan card by 0px, and
opening the dialog leaves the page where it was.

**Mobile caught up with the redesign.** Plan & billing is the web page stacked —
plan surface, restrictions with *Reactivate*, quiet records — and changing plan
is a short journey of screens: plans, a review (paid, or the downgrade chooser),
and a payment screen that follows a server-priced checkout in the shared secure
sheet and waits for the server. The rules deciding what a downgrade keeps are the
same text in both clients, held by a contract test. Property and unit screens
carry the restriction notice. This supersedes the "mobile still reads plan and
usage only" line above.

**Checked.** Backend: the full suite and ruff. Web: tsc, eslint, 16 contract
tests, 25 of 25 mutations caught. Mobile: tsc, eslint, 122 contract tests, 17 of
17 mutations caught. Walked through in temporary mocked-data routes, since
removed: the web chooser for one property, for ten of 38 properties and for units
only, a swap in progress, the restricted section with and without room and a
reactivation; the mobile screens at 390 and 320px, with no horizontal overflow or
clipped text and plan cards keeping their heights across a cycle switch. **Not
seen against the real API in a browser:** the in-app browser is signed out, so
the real flows are held by the integration tests.

**Not yet:** reactivation is one property or unit at a time; team members above a
lower plan's limit are not chosen on downgrade (they keep access, and adding more
waits); automatic recurring charges, grace reminders and refunds.

## Subscription checkout failed every payment — fixed 11 September 2026

**What happened.** Upgrading against Paystack's test mode ended in *You're still
on Free — the payment was not completed* on the web, and on mobile the checkout
never opened, although Paystack took the payment. Seven test payments that day
succeeded at Paystack; Rooomly recorded every one as failed, and nothing told
anybody.

**Why.** The Paystack adapter mapped `abandoned` to `failed`. Paystack reports
`abandoned` for a checkout that is open and not yet paid, and both clients ask
for a payment's status as its checkout opens — so every checkout was marked
failed within a second, before the payer could approve it. The failure was
written as an immutable transaction under Paystack's transaction id; when the
payment then succeeded under the same id it could not be posted, and refresh
had stopped asking about a failed payment. On mobile the payment screen opens
the checkout sheet only for a payment still pending, so it never opened. "Try
again" made it worse: it re-initialized Paystack with the reference it already
held, which Paystack refuses (the 422s), and the client then priced the change
again, inviting a second payment.

**Fixed.**
- `abandoned` maps to `pending`; Rooomly's intent window closes an unpaid
  checkout.
- A retry asks the provider first: a success is applied instead of retried, and
  a payment still being confirmed refuses (`payment_confirming`). The Paystack
  adapter resumes the checkout already open for an intent instead of sending a
  duplicate reference. When a retry is refused because money may already have
  been taken, web and mobile keep the payer on the failed step with the reason
  rather than offering the price again.
- Reconciliation also asks about payments that failed in the last day. Money the
  provider took is posted when it can be, and otherwise opened as
  `provider_succeeded_internal_failed` for a person (migration `payments.0017`).

Held by new tests in `test_paystack_adapter.py`, `test_paystack_lifecycle.py` (an
`abandoned` checkout then paid under the same transaction id; a retry resuming
the open checkout; a retry after Paystack took the money; a retry while it is
still confirming) and `test_billing_checkout.py`, and by contract tests on both
clients. Details in `docs/architecture/PAYSTACK_INTEGRATION.md`.

**The test payments already taken** stay recorded as failed, and none of them
upgraded the Portfolio. Rooomly cannot post them — their failure records hold the
same Paystack transaction ids. Once the Celery worker runs this code, the hourly
reconciliation opens a `provider_succeeded_internal_failed` exception for each
payment Paystack took within the last day; in test mode nothing needs refunding.

**Still open.** A reservation whose initialize response was lost cannot be
resumed against Paystack until its window closes, and whether Paystack's hosted
checkout accepts another attempt after it has marked a transaction `failed` has
not been exercised.

## Team invitations open a workspace — 11 September 2026

Accepting a Portfolio invitation always created the membership; nothing
downstream read it. The provider workspace opened on the *member's own* provider
verification — which an invited person does not have and is never asked for — so
somebody accepted an invitation and was returned to the tenant tabs, or sent to
provider onboarding for an account they had no reason to open.

- **Membership is the second door into the workspace.**
  `organization.operates_through_membership` answers it for every role except
  owner, whose own verification *is* the Portfolio's standing. Capabilities,
  entry routing and `POST /me/workspace/` all read it, so an invited manager
  enters with their ordinary account.
- **Standing belongs to the Portfolio** (`has_portfolio_standing`: an active
  owner whose provider verification is current). A member's tenant-facing work
  rests on that plus their own phone and identity, and the refusal names
  `portfolio_standing` for a member, `provider_standing` for somebody whose own
  review is the thing to finish.
- **Ownership left the Team.** `OWNER` cannot be invited, granted from the
  roster, or accepted from an invitation written before the rule.
- **Elevated roles are checked live, not at the door.** Accepting or being
  promoted to `ADMIN` requires a current identity verification; if it later
  lapses the membership reads `pending_verification`, granting access stops, and
  *ending* access deliberately does not.
- **Every membership answers for itself.** `membership_access` returns the state
  (`active`, `limited`, `pending_verification`, `revoked`), the outstanding
  requirements, the Property scope and the abilities both clients build
  navigation from — one answer, instead of role names matched in a browser.
- **A link can be read in any state.** `GET /portfolio-invitations/<id>/?token=…`
  resolves one that expired, was withdrawn, was already used, or belongs to
  another number; `/me/portfolio-invitations/?include=history` says what became
  of the rest. Accepting twice returns the membership the first press created.
- **After accepting**, both clients switch the workspace, re-read the account,
  select the Portfolio, and confirm the join with the role's reach and anything
  still waiting on verification — then open it.

Held by `TestTeamMemberWorkspace` in `test_portfolio_team.py` (a tenant joining,
a number invited before it had an account, duplicate acceptance, the
administrator verification gate, ownership refused on both paths, a lapsed
administrator, a member's tenant work on the Portfolio's standing,
cross-Portfolio denial, revocation, and a used-up link) and by contract tests on
both clients. Details in `architecture/organizations.md`.

**Still open.** Billing administration and payout-destination changes read
`role in {owner, admin}` inside `apps.billing` and `apps.payments`, so a *lapsed*
identity verification does not suspend them — nobody can obtain the role
unverified, since acceptance and promotion both refuse. Those modules should
adopt `organization.services.elevated_authority_missing` when they are next open
for change.

## Provider Properties belong to one Portfolio — 11 September 2026

The Properties page read the account-wide list (`GET /properties/`, every
Property the account can reach) while its header claimed to be about "this
Portfolio", so a provider's personal houses and a company's blocks arrived in one
roster and switching Portfolio changed nothing.

- **The scope is a request, decided on the backend.**
  `GET /properties/?organization=<id>` requires membership — a non-member, or a
  malformed id, gets the same 404 a stranger gets — and returns the Portfolio's
  Properties for an owner or administrator and only the assigned ones for a
  property manager or staff member. The unscoped list stays what it always was
  and is documented as *not* a Portfolio view.
- **Both clients hold the Portfolio in one place.** Web reads the session's
  active context, sends it with the request, and blanks the list while the next
  Portfolio loads; the mobile tab's own picker now moves that shared context
  instead of only its own list, so Home, Payments and Team follow the switch
  rather than staying on the Portfolio the person thought they had left.
- **Adding a Property files it into the Portfolio being operated**, not into
  whichever Portfolio the API listed first.

Held by `test_property_portfolio_scope.py` (switching between two Portfolios,
personal versus company isolation, owner/admin visibility, an assigned manager's
visibility, cross-Portfolio refusal, and a revoked member losing the list) and by
contract tests on both clients.

**The same rule, the rest of the provider surface.** Agreements, viewing
requests and tenancy requests hung off Properties and each asked for everything
the account could reach, so one Portfolio's records sat on screen while another
was selected — and Home counted all of them against one Portfolio's Properties.
They now scope through one service, `organization.services.properties_in_scope`,
which `GET /me/granted-leases/`, `GET /me/viewing-requests/`,
`GET /me/received-applications/` and `GET /properties/` all use. Web's tenancy
requests hook read every Portfolio and flattened them; it reads the one being
operated. Home stopped fetching every Unit to sift three account-wide lists by
hand — it had been matching viewings by Property *title*, which two Properties
can share.

## One icon for the Portfolio you are in — 11 September 2026

Switching Portfolio had grown several answers: a select above the Team roster,
another above Tenants, and a picker on the mobile Properties tab — persistent
controls asking a question most sessions never ask, and able to disagree with
each other, since Tenants remembered a Portfolio of its own. The switch is now
one icon in the workspace chrome and nothing else.

- **Web.** A header icon sharing one bordered control with Updates: two
  utilities of the workspace, one container, a hairline between them, the same
  40px target and the same hover, press and focus on both — and each still its
  own button or link. Tooltip "Switch portfolio", and a small mark — never a
  count, which would read as unread work — when there is more than one Portfolio
  to be in. The glyph is a stack of workspaces rather than a building, which is
  already what Properties means. The control borrows the search field's surface
  and height so the right of the header sits on one band; Search is what gives
  way first when the width runs out, and the avatar stays at the foot of the
  rail, because identity is an anchor rather than a utility. It opens a popover titled *Your
  Portfolios*: each row carries the name, the Portfolio's type and the role held
  in it, the active one is marked and checked, arrow keys and Escape work, and
  Portfolio settings and Create Portfolio sit below a line rather than in the
  list being scanned. A search box appears once there are seven Portfolios.
- **Mobile.** The same content as a bottom sheet, from an icon at the head of the
  provider tabs.
- **Nothing of the last Portfolio during the switch.** Web remounts the
  workspace beneath the header, keyed by the active context. A tab navigator
  cannot remount without discarding which tab somebody is on, so mobile Home,
  Properties and tenancy requests blank their Portfolio-scoped state through
  `useBlankOnPortfolioSwitch` and reload. Returning to a tab is not a switch and
  refreshes in place.
- **Removed.** The Team and Tenants selects, the mobile Properties picker, and
  the dead CSS behind the first.

Plan & billing keeps a Portfolio select of its own, and it moves that page only.
It belongs to the billing work and was left alone.

## One Portfolio per provider, provisioned by Rooomly — 12 September 2026

A Portfolio was something a provider set up, so an account could accumulate
them — and two Portfolios one person owns is two of everything: two
subscriptions, two Teams, two places a Property could have been filed with one
of them wrong, and a switcher offering a choice nobody meant to make.

- **Approval provisions it.** A reviewer's decision on provider access now
  calls `organization.services.provision_provider_portfolio`, which is the only
  place in the product a Portfolio comes into existence. It is idempotent —
  standing lapses and is reviewed again — and locks the account row, so two
  decisions arriving together resolve to one Portfolio.
- **Named from what the account already says**: a company's or agency's
  registered name for a business, `{First name}'s Portfolio` otherwise, typed to
  match. Nobody is asked for a name, because the owner edits it afterwards.
- **Nothing creates one.** `POST /organizations/` is gone (405), the service
  itself refuses a second for an account that owns one (409), and the
  `/organization/setup` route, the mobile `organization-setup` screen, both
  `createOrganization` wrappers and every "Create Portfolio" control were
  removed. Billing never had a multi-Portfolio entitlement; its limits are
  Properties, Units and seats *inside* one Portfolio.
- **Editing replaced creating.** Team on both clients now carries the Portfolio's
  own details — name, type, activities — because a provisioned name that nobody
  can change would be worse than the form it replaced. It is the only Portfolio
  write a provider makes.
- **The Property flows stopped making a second one.** `ensure_personal_organization`
  matched only `individual_owner`, so an owner whose Portfolio is a company got
  a personal one beside it the first time they added a Property of their own. It
  defers to provisioning now.
- **Membership is untouched.** Being in several Portfolios is normal and stays
  normal: Kwame owns one and is a manager in one and an accountant in another,
  all three on his switcher, exactly one of them his.

Held by `test_portfolio_provisioning.py` — provisioning on a real reviewed
approval, business and agency naming, a second decision after a lapse, the
service refusing a second Portfolio, the endpoint answering 405, an owner
renaming and retyping theirs, a member refused that, and one account owning one
Portfolio while working in two more — plus contract tests on both clients
asserting nothing offers to create one. Accounts that already owned more than
one keep them; this stops new ones and deletes nothing.

## CI

Three of the four jobs pass. `backend` is the exception, on its type-check and
security steps — both covered below.

Earlier, two more had been red: `ruff check` carried 469 findings and
`ruff format --check` 117 files, and the `tokens` job checked a gitignored file
so it could never pass on a clean checkout. Fixed rather than muted, except for
two rules switched off with the reasoning in `backend/pyproject.toml`. See the
delivery log for what the lint pass actually found.

**`mypy` had never actually run.** It stopped on
`Source file found twice under different module names` — `apps/` is a namespace
package, so without an anchor mypy computed two names for every file and gave up
before checking anything. Anchoring it at the repository root (`mypy_path`,
`explicit_package_bases`) makes it check all 195 files, which reports **154
findings across 40 modules**: mostly `arg-type` and `attr-defined`, the shape of
a codebase that has never been type-checked rather than a recent regression.
Fixing them is its own piece of work and is not in this change; the gate now
reports something actionable instead of one line about a stubs file.

**`pip-audit --strict` is red too, and every finding has a fixed release.** Two
advisories against **Django 5.1.5** (fixed in 5.2.16), four against `pip`, one
against `pytest` and four against `sqlparse`. These are dependency upgrades, not
findings in our code, and the Django one is a minor-version bump that wants its
own change with the suite run against it.

## Known gaps

- **Tenant to provider is a one-way street.** Provider accounts are created at
  sign-up; a tenant account cannot become one. Someone who rents and later lets
  a room out needs a second number.
- **The rent ledger requires an approved provider and a receiving account.**
  Recording an off-platform cash payment is gated behind checks meant for a
  payment rail that does not exist yet.
- **A provider with no property claim is invisible** on the Management
  Providers page, which lists property applications rather than people.
- Longer-standing constraints are in `known-limitations.md`.
