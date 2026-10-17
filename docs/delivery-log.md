# Delivery log

What each phase actually shipped. Replaces the six long per-phase reports; the
reasoning behind decisions lives in `architecture/adr/`, and current state is in
`status.md`.

## Phase 0 — Foundation (v0.1.0)

Platform primitives: `Money` as integer minor units with explicit currency,
UUIDv7 ids, Ghana phone normalisation, digital-address parsing, the audit and
outbox tables, health checks. Django + Postgres + Redis + Celery, Next.js, Expo,
shared design tokens, CI, linting.

## Phase 1 — Identity & trust (v0.2.0)

Phone-first accounts, OTP with peppered hashes and attempt caps, rotating
refresh sessions with reuse detection, devices, additive roles, profiles, and
the verification model — dated, evidenced, superseded rather than overwritten.

*Substantially rebuilt later; see "Identity rebuild" below.*

## Phase 2 — Property & listings (v0.3.0)

Properties, buildings, units, beds, addresses, amenities, media uploads with
virus scanning and presigned URLs, listing lifecycle with moderation, public
search that fails closed.

Workspace creation now exposes the same canonical residential, commercial and
hostel activity set on web and mobile. The organization API derives its request
choices from the domain enum, so commercial portfolios are stored and returned
instead of being rejected or omitted by a stale client/API contract.

## Phase 3 — Rental workflows

Viewing requests with fee disclosure and contact release on confirmation only;
rental applications; leases; the rent ledger, where a payment is two parties
agreeing rather than one asserting; notifications.

The P5 repair later completed tenant web slot selection and confirmation. Exact
street/GhanaPost/coordinate/entrance directions now travel on the participant-
scoped viewing response only for the lifetime of a confirmed appointment;
public listing location remains approximate. The provider inbox now uses the
same Property/organization authorization as viewing transitions; its former
owner-only query hid requests from legitimate managers and agents.

The next P5 repair connected public web discovery to the application domain
that mobile and the backend already used. An active listing now opens one
application form, carries the visitor through authentication when needed,
shows the advance mismatch before submission, confirms the result and links to
its tenant status. The provider sees that same row in the existing inbox; no
parallel model, tenancy side effect or client-derived eligibility rule was
added. The backend also fixed zero-month snapshot fidelity, validates the
income-band/guarantor claim at the API boundary, and scopes provider inboxes to
current authorized managers rather than owners alone.

A stabilization repair moved application uniqueness from Listing to Unit. A
tenant can no longer create another submitted application after provider
acceptance or by applying to a replacement listing for the same space. The
database serializes concurrent attempts, and the data migration preserves
accidental duplicates as superseded history while keeping a lease-linked
application authoritative.

The following P5 repair completed the tenant web and mobile lease decision
paths. Open offers now render the exact frozen agreement snapshot and give the
named tenant explicit accept or decline confirmations, visible errors and
retained decision history. The API exposes those immutable terms with their
content hash, hides unsent provider drafts from tenants, and verifies snapshot
and acceptance hash integrity before activation. Existing lease audit, outbox,
occupancy and rent side effects remain in the lease service rather than moving
into either client.

Tenant home now calls out offered agreements on web and mobile, with a direct
route to review and decide. Web navigation also exposes Agreements for tenants,
so a delayed notification cannot make an offer effectively undiscoverable. The
offer card keeps its explicit confirmation step but places the decision controls
directly under the heading rather than below the entire agreement.

Lease activation exposed and repaired a tenancy-home read-model fault: generated
rent charges were formatted through a nonexistent property. The portfolio now
uses the charge's authoritative minor units and currency, so an active tenancy
continues rendering immediately after acceptance.

The next P5 repair corrected tenant invitations on both clients. Resolving a
phone-bound token now stops at a review of the provider, Property, Unit/bed,
message, expiry and proposed terms; it cannot create tenancy as a hidden side
effect. Accept and decline are separate confirmed actions using the reviewed
token. The backend added an additive declined state and optional reason,
preserved recipient/expiry checks, and records both terminal decisions in the
audit chain and transactional outbox. Existing-tenant imports remain visibly
distinct from prospective offers; the latter converges into tenancy and lease
in the following repair.

Repair #7 made the two kinds of private onboarding explicit. A prospective
invitation acceptance now opens negotiation without creating occupancy or
accepting terms; the provider sends a linked immutable lease and only the
tenant's later lease acceptance activates tenancy. Existing-tenant import keeps
its separate occupancy-confirmation behavior. Web and mobile expose both the
purpose choice and the accepted-invitation lease action.

Repair #8 replaced persistent plaintext Unit join codes with an explicit
verified-space access credential. Providers create or rotate a 128-bit code and
see it once; the database retains only a peppered hash and lifecycle metadata.
Thirty-day expiry, immediate rotation/revocation, Property/Unit verification
loss, archive handling, generic failures, per-user/IP throttles and audit-chain
events close the former forever-secret and brute-force paths. Existing verified
codes were hashed in place with a bounded compatibility window. The reusable
share code still creates only a manager-approved access request and cannot be
resolved as the separate phone-bound invitation token.

The mobile follow-up restored the management surface that Repair #8 had left
only on the Unit workspace. The provider Tenants tab now shows the selected
Unit's code state and permits secure create/rotate, one-time native sharing and
revocation. Property navigation preserves the chosen Property, and changing
Units clears any readable code held in component memory. A final mobile
discoverability correction moved those controls directly below the Unit
lifecycle summary and separated them from the invitation form.

Repair #9 activated the previously unused idempotency schema. Selected harmful
creates and transitions now claim by actor, endpoint, key and exact request
fingerprint under a PostgreSQL advisory lock. Domain work, audit/outbox effects
and cached response commit together; concurrent duplicates replay once, changed
payloads conflict, and failed 5xx attempts remain retryable. Web, Expo and the
isolated Management portal keep one key stable across bounded retries. The
additive Management actor scope preserves existing claims and gives Payment Core
one protocol it can later require rather than inventing a financial-only one.

Repair #10 replaced the stale live-data smoke script with a deterministic,
isolated current-contract journey. It now fails on regressions anywhere from
provider registration and Management verification through Organization,
unified Property verification, Unit verification, publication, discovery,
viewing, application approval, immutable lease acceptance, Tenancy/Occupancy
creation and the existing confirmed rent record. The original
`python ops/smoke_phases.py` command remains the stable entry point and now
delegates to that canonical integration test without polluting development data.

Repair #11 closed the implemented Discovery / Viewing / Application slice.
Mobile providers gained actionable viewing and application inboxes, role-aware
notification destinations and visible portfolio entry points. Mobile tenant
applications now send the same context as web; web gained application
withdrawal; both listing clients recognize open viewing requests; expired slot,
loading and mutation errors now leave a clear recovery path. A cross-client
contract regression test guards those parity seams while the existing backend
integration suite continues to enforce lifecycle and permission rules.

Repair #12 began Payment Core after the required architecture review. The
existing `RentCharge` schedule remains the obligation source. The new payments
context adds server-priced full-obligation intents with mandatory idempotency,
a provider adapter boundary, signed and replay-safe webhook processing,
immutable transactions, balanced non-custodial ledger lines, durable receipts,
pending settlement records, audit and outbox events. PSP-confirmed payments are
marked separately from the existing two-party external/offline claims and
cannot be rewritten through that claim-dispute workflow.

Payment continuation now lets a Portfolio owner/admin keep more than one bank
or Mobile Money receiving account. Exactly one verified profile can be selected
for new payment intents; selecting another does not alter any intent already in
flight. Removing an account disables future use rather than deleting the row,
so payment, settlement and audit evidence remain reproducible. Web and mobile
use an inline account list with add, verification, select and remove actions;
the API retains its original `profile` field as an active-profile compatibility
alias while exposing the full saved collection.

No production PSP is configured, so neither client exposes a fake checkout and
no money is claimed to move. Lease activation remains acceptance-driven until
a licensed provider, its sandbox behavior and a tokenized organization payout
destination are established. ADR 0028 records this deliberate boundary.

## Phase 3.5 — Stabilization

Tightened authorization to resource scope rather than global role names,
corrected property relationship boundaries, upgraded the Next runtime.

## Phase 4 — Property operations

Organizations with time-bounded memberships and property assignments; private
inventory before verification; phone-bound invitations and manager-approved join
requests; occupancies; portfolio read model; separate organization and property
authority verification.

## Identity rebuild (post Phase 4)

Phase 1's model had three faults that combined into one hole: sign-in was an OTP
to the registered number, roles were self-grantable, and the provider workspace
was offered on the strength of a role name. Anyone who could receive one SMS
reached the provider interface with no check made.

Rebuilt:

- passwords for sign-in, OTP demoted to registration and recovery (ADR 0019)
- registration separated from onboarding, and later moved behind a signed
  ticket so no account exists until the form is finished
- provider standing as an account-level verification, distinct from per-property
  authority (ADR 0018)
- workspace as context, never capability (ADR 0020)
- property creation gated on approved provider standing
- self-grant closed at three separate places: the roles endpoint, intent
  selection, and entry routing

Delivered across Django, Next.js and Expo against one backend contract.

## P2–P4 — The rentable space (post Phase 4)

The space became the thing the product is actually about: it carries its own
photographs, its own amenities, and three lifecycles that move independently.

- **Three axes, three fields.** `verification`, `publication`, `availability` on
  the space's read model, rendered as three marks on web and mobile. A verified,
  private, unoccupied space is now expressible; one pill could not say it.
- **A verification vocabulary a provider can act on.** Draft, ready to send,
  submitted, under review, verified — plus changes-requested, rejected,
  suspended, expired. Served, not derived.
- **Photographs are the space's and the review's.** `UnitMedia` plus
  `spaces.attach_photo`, which files the evidence in the same call. The space
  review dropped to one required photograph and two invited, because the
  property above it has already been reviewed.
- **Amenities are scoped.** `Amenity.scope` and `space_types` filter the picker
  server-side; `PropertyAmenity` gives the compound its own set;
  `unit_flag_field` keeps the legacy `Unit` booleans in step with the checklist.
- **Guided creation, and a workspace per space.** Details → Amenities → Photos →
  Review → Send, on both clients, writing to a real record at every step. The
  public listing page was rebuilt space-first, property second.

**2026-08-31 addendum:** policy `2026.08.4` supersedes the one-overview-only
amenity treatment. The overview remains required and two context views remain
optional, but every selected Unit amenity now contributes its own required,
named photo slot. The existing real-record draft is exposed as Save for later
throughout Unit creation, and Unit detail can reopen that same draft journey.

Three defects found on the way:

1. `publish_listing` never called `can_publish`, so the rule blocking
   publication on space verification was enforced nowhere.
2. `core.policy.enforce` discarded a decision's blockers, so refusals named
   nothing a person could act on.
3. Presigned downloads were signed against the internal storage endpoint and
   rewritten to the public one. SigV4 signs the host, so every listing
   photograph had been failing with `SignatureDoesNotMatch` under a page
   returning 200. Marketing photos also now ask for `inline`, without which a
   browser refuses to paint them at all.

Decisions and reasoning: ADR 0022.

## CI gates made real (alongside P2–P4)

Two of the three CI jobs had been red for long enough that nobody was reading
them, which makes a gate decoration rather than protection.

**`ruff check` — 469 findings, now zero.** Most were noise, but five were not:
a `... or True` in `test_audit.py` that made the assertion beside it
unfailable; `pytest.raises(Exception)` that passed whether the normaliser or
the unique index raised; a computed-and-unused `verified_account` left behind
in `property/capabilities.py` when private tenant access was tightened; a
`__str__` missing from four models, so the admin showed `TenantProfile object
(01a0…)` at exactly the moment somebody needed to know whose; and `backend/sw.py`,
a committed debug script referencing three attributes that no longer exist.

Two rules were switched off with the reasoning recorded in `pyproject.toml`
rather than obeyed: **N818** (our exceptions are named for the condition, as
Django's and DRF's are) and **RUF012**, scoped to the modules where Django's
declarative API mandates mutable class attributes — so it still fires in
service and domain code, where a shared mutable class attribute is a real bug.

**`ruff format` — 117 files.** Applied. The formatter changed no comment and no
behaviour; the 872-test suite is unchanged either side of it.

**The `tokens` job could never pass.** `--check` treated the absence of
`dist/theme.ts` as drift, and `dist/` is gitignored — so on any clean checkout
it failed on a file that is deliberately not committed. It now checks the two
generated files that *are* committed, and builds the artefact. Verified both
ways: clean checkout passes, a hand-edited `mobile/src/theme.ts` still fails.

## Property setup as a guided journey

Creating a property dropped somebody onto a management page carrying every
section it had — the review forms, the amenities, the spaces, tenant access —
with no hierarchy and no sense of what was left. The record existing is the
start of the job, not the end of it.

`/properties/:id/setup` walks Details → Documents → Photos → Amenities → Review,
and `/properties/:id` shows the journey while setup is outstanding and the
management view once it is not. `describePropertySetup` is the one reading both
pages use, so they cannot disagree about what is finished, and it derives every
step from data the domain already keeps — **no `setup_complete` column**, because
a fifth thing to keep in step with four that are already true would drift.

**The details step was missing entirely.** `PATCH /properties/:id/` has accepted
`water_source`, `power_meter_type` and `compound_type` since Phase 2 and no
screen ever sent them, so every property in the system carried `unknown` for the
two that `trust.evidence_policy` reads — and was therefore asked for the shortest
possible photo checklist whatever it actually was. Setting them is now the first
step, and it visibly changes the next one: a borehole and a family compound take
the property from three required views to five.

Also fixed on the way: the setup layout computed to `279px 0px` at phone width —
the step list took its minimum and the panel beside it collapsed to nothing — so
the flow was unusable on the device this product is built for first. Flex wrap
rather than a fixed two-column grid.

`PropertyReview` was deleted; its one-send logic lives in the flow's review step,
where it still sends whichever halves are outstanding together.

### And on mobile

The same five steps, `mobile/app/(app)/property-setup.tsx`, with the workspace
screen showing the journey while setup is outstanding and the management view
once it is not — the same split, so neither platform is the one that got the
guided version.

The mobile screen carried its own inline `PropertyReview` with a hand-numbered
"1 ·" and "2 ·"; that is gone, and creating a property now lands in the flow
rather than on the workspace. It had the missing-details bug too, so every
property built on a phone was also getting the guessed-short photo checklist.

`propertySetup.ts` is mirrored between the two clients — there is no shared
logic package, and `verification.ts` set that precedent — so
`propertySetup.mirror.test.mjs` compares the two function bodies and fails if
they drift. Verified by perturbing the mobile copy and watching it go red. It
skips where the mobile tree is not mounted, which is the web container, and runs
for real in CI.

## The property page knows what state it is in

The property detail page offered **"Continue with property details"** in every
state — to a provider whose property was with a reviewer, to one whose ownership
claim had been rejected, to one approved weeks earlier.

The page was not ignoring the state. It was rendering the only state it had.
`Verification.display_state` has four values; the flow has nine. `REJECTED`,
`REVOKED`, `EXPIRED` and never-started all arrive as `unverified`, so the field
could not tell a refused claim from an unstarted one. And a property has *two*
reviews — the ownership document and the photographs — with no field combining
them, so any screen asking "where does my property stand" had to pick one and be
wrong about the other.

`apps/property/verification.py` answers it: one state, worst half first
(suspended → rejected → changes requested → expired → draft → submitted → under
review → ready → verified), with both halves still named, because "changes
requested" without saying *which* review says almost nothing. It is a read model
over rows that already exist — no migration, no new column.

`PropertyLifecycle` on both clients dispatches on that state to five renderers.
With a reviewer there is no continue and no submit. Verified is a management
page, not a setup page. Suspended explains the restriction and offers support
rather than a resubmit button that would be refused. Every control is gated by
`permitted_actions`, so the page renders the backend's answer instead of its own.

**Submission stopped being a one-way door.** A provider who noticed the wrong
document attached had no move at all — not editing (correctly refused), not
replacing the evidence, not sending again. Only waiting for a rejection they
already knew was coming. `POST /properties/:id/verification/withdraw/` and the
space equivalent take it back out of the queue: the verification stays `PENDING`
and the `ReviewQueueEntry` is deleted, which is the whole mechanism, since
`lifecycle_state` reads the queue entry. Evidence stays attached — making
somebody re-upload five photographs to fix one is how withdrawal becomes worse
than waiting. The withdrawn submission stays in the audit record (ADR 0021).

`ProviderApplicationStatus.WITHDRAWN` had to be a new value rather than a return
to `DRAFT`: `DRAFT`, `PENDING_REVIEW` and `NEEDS_MORE` all count as an open
claim, so parking a withdrawn one in any of them would have refused the corrected
claim that withdrawal exists to enable — a trap instead of a way out.

A verified property is now *partly* editable. `title`, `has_security`,
`is_gated` and `notes` stay open; `property_type`, `water_source`,
`power_meter_type` and `compound_type` do not. The line is not importance — it is
whether `trust.evidence_policy` reads the field. Those four decide which
photographs are required, so changing one after approval would move the checklist
under a decision already made.

`tests/integration/test_property_lifecycle.py` puts a property into all nine
states and asserts both what `permitted_actions` offers and that the matching
API call is refused — 39 tests. A state machine whose wrong branches are only
unreachable through the interface is not enforced, and a missing button was the
entire fault being fixed. Verified by removing the enforcement and watching the
API-level tests go red.

Decisions and reasoning: ADR 0023.

## Creating a property stopped meaning submitting one

The complaint was two button labels. Step two of the property creation wizard
said **"Send this claim for review"**. The last step — the one that should have
finished creating a property — said **"Send photographs"**.

Both were accurate, which was the problem.

`submit_provider_application` created the ownership claim already at
`PENDING_REVIEW` and queued it, so **recording the document was submitting it**,
four steps before the provider had finished describing the property. By the last
step there was nothing left of the claim to send. The photographs already worked
the other way — `condition.attach` collects onto an unqueued review and
`submit_for_review` queues it — and that asymmetry produced everything: a
reviewer got a claim for a property with no photographs and later photographs of
a building whose claim they had already decided; the provider was asked to send
the same property twice; and creation had no ending, because `isSetupComplete`
was defined as *both halves submitted*.

Documents now behave like photographs. `submit_provider_application` takes a
`queue` flag, `record_property_claim` records a `DRAFT` with its evidence
attached, and `submit_property_for_verification` queues both halves together in
one transaction behind one policy check. `ProviderApplicationStatus.DRAFT` was
already in the enum and nothing had ever written it.

The state model needed one line: a draft claim reports `ready_for_submission` on
the authority half, so **created-but-not-submitted** became expressible with no
new column. The wizard ends with **Create property** and returns to the list; a
separate `/verify` route is the read-only submission flow.

**Three further defects fell out of the same confusion.**

`can_delete_property` and `can_archive_property` keyed on `_has_authority` — a
live `PropertyRelationship`, which only exists once a claim has been *approved*.
So a provider could not delete the draft they had just created, and **could
delete a verified property**. Neither consulted the verification state. Both now
use `_manages` and refuse while a reviewer holds it; deletion also refuses once
anything has been decided, archival being the ADR 0021 answer. This revises ADR
0022, which kept the narrower predicate deliberately — the distinction it drew
was right and the predicate was the wrong way to draw it.

**Withdrawal was a database-level dead end.**
`PropertyProviderApplication.property` is a `OneToOneField` — one claim per
property, permanently — and withdrawal marked the row `WITHDRAWN`, leaving it in
that one slot so the corrected claim it existed to enable could never be
inserted. The test covering it queried the open-claims set and never tried.
Withdrawal now returns the claim to `DRAFT` with its evidence, reusing the row,
which is the same mechanism the photographs already used.

**A property that had never been sent reported a submission date**, because
`lifecycle()` read the condition review's `created_at` and that review opens on
the first photograph. It now reads the queue entry.

Also fixed: the detail page carried a live amenities checkbox form, offered
whenever the page was "managing" — which includes a property under review, so it
invited a change the backend refused. Amenities are displayed now.

`test_property_creation.py` walks the journey over HTTP in 27 tests and asserts
the review queue is empty after every step of it. Verified by reverting the
split and watching ten go red.

**A verified property is fixed, with no half-door.** The first pass let labels
through — `title`, `notes`, the two security flags — on the reasoning that a
reviewer does not check what a property is called. They check the property, and
what a tenant reads includes its name, so a rename under a live approval makes
the mark vouch for something nobody looked at. `can_edit_property` now denies
outright and `update_property` has one gate instead of a field filter. Spaces
have a way back (`request_recheck`); properties do not yet, so the refusal names
support rather than offering a control the API refuses.

**The standalone claim wizard is gone, and taking it out found a dead end.**
`mobile/app/(app)/property-authority.tsx` and `web/app/provider/property/` — 1,091
lines between them — were the pre-ADR-0024 screens for claiming a property, and
nothing had linked to either since the claim moved into property creation. Both
deleted, with their stack registration, their two routing-table rows, and the
three client wrappers that only they used. `submitProviderApplication` going with
them matters most: it submits a claim on the spot, and having it to hand is how
the creation flow came to file a review from its second step.

Checking whether they were *needed* before deleting them turned up a real gap.
`submitProviderMoreInfo` — answering a reviewer who asked for a different
document — existed nowhere else, and the creation flow could not do it: the
open-claim guard added with the draft-claim split refused a property in
`NEEDS_MORE` with "There is already a review in progress for this property. We
will let you know the outcome", to the very provider being waited on. So a
queried document was unanswerable from any reachable screen.

`record_property_claim` now routes a `NEEDS_MORE` claim to
`submit_provider_application_more_info` — the evidence joins the case the
reviewer is holding rather than starting a fresh one beside it, which is the same
exception `condition.attach` makes for photographs. Three tests in
`TestAnsweringAQueriedDocument` cover it, and the fixture goes through
`trust_services.request_more_information` rather than the property-side hook it
fires: reaching past it produced a state the product cannot be in, with the claim
queried and the review still pending.

The `/provider/applications/` endpoints stay. ADR 0024 keeps them as the
onboarding path, where a claim genuinely is the thing being sent and there is
often no property row yet — but nothing reaches them today, and both clients now
say so where the wrapper used to be.

**Mobile's step one was a lone form claiming to be part of a journey.** The web
`/properties/new` was rebuilt as step one of six with the shared progress bar and
step list; mobile got the sentence "Six steps, and everything saves as you go"
and a caption reading "Step 1 of 6", and none of the chrome that would have made
it true. It now renders the same `SetupProgress` and `SetupSteps` from the same
`describePropertySetup` both platforms read, so the six steps are visible from
the first screen rather than asserted.

Around it: "Add a property" in the quick-actions sheet and "Add property" as the
screen title both still named the old model, `property-verify` was never
registered in the stack so it took a default title, and the create action sat
*below* every property card — a provider with six buildings scrolled past all six
to start a seventh. It is above the list now, where the web page header puts it.

One real bug underneath: `private-property` returned early from its workspace
effect whenever a workspace id was passed in, so `organizations` stayed empty and
the picker could never render — somebody who arrived from the wrong workspace had
no way to change it. The parameter says which one to preselect, not that there is
only one.

**Mobile had fallen behind the web, and one of the gaps was functional.** The
provider properties list still rendered the pre-rewrite vocabulary — two labels,
`condition_state` and `authority_state` side by side — under an action derived
from a lookup table, so a property whose photographs were *with our team* was
offered **"Finish the photos"**. Its comment claimed "same wording as the web
property list", which had stopped being true when the web list was rewritten.
It now renders `verification.state_label` and gates every control on
`permitted_actions`, the same rule the web list follows.

The functional one: the mobile Documents step still keyed on `authority_state`,
which stays `unverified` for a document recorded but not sent. So after saving a
document the sidebar ticked Documents while the panel below it still asked for
one. It reads `verification.authority.state` now, like the web step.

Also on mobile: the property header printed "AUTHORITY VERIFIED" above a card
that might be explaining a rejection — two answers to one question on one
screen — and the evidence panel said "Send it for review" even where something
above it owned the send.

Verified by comparing the two trees rather than by looking: `expo-secure-store`
is native-only, so the app will not boot under `expo start --web`, and the
obvious shim is a localStorage fallback for the tokens `secure.ts` deliberately
keeps out of AsyncStorage. The Metro web bundle does build all 930 modules with
no resolution errors, which covers imports and module-level evaluation but not
layout.

**Delete was a link that navigated and removed nothing.** The properties list
rendered `<Link href={`/properties/${id}`}>Delete</Link>` — a control that looked
like an action and was a page change — and the property page had no delete or
archive control at all. The backend had been complete since P0.5:
`DELETE /properties/{id}/archive/` with a reason and a confirmation, refused the
moment our team has seen the property, and covered by
`test_lifecycle_actions.py`. Only the clients were missing.

Both platforms now carry a `DangerZone` under whichever lifecycle card the state
chose. It asks for the reason the policy requires, offers delete or archive
according to `permitted_actions` rather than its own list of states, and renders
nothing when neither is allowed. The list rows point at it with an ellipsis —
"Delete…" — because a row cannot carry a confirmation and a written reason.

**A photograph could never be corrected.** A filled evidence slot rendered the
word "Added" and nothing else — no preview, no replace, no remove, in any state —
so a provider who photographed the wrong side of a building was stuck with it
permanently. `condition.detach` had existed since P3 and no endpoint exposed it,
and attaching again would have left two files in a slot the policy describes as
one. Slots now report `file_id`, a short-lived `inline` preview and `filename`;
`attach` replaces what is in the slot; `DELETE .../verification/evidence/` takes
it down. Both refuse once a reviewer holds it.

Found on the way: `attach` would happily add evidence to a **queued** review,
because `open_review` is idempotent and a queued review is still the current
one. The reviewer's case could change under them mid-decision. `detach` had
guarded against exactly that since P3; its twin never did.

Also fixed from the same report: "Edit" on a finished property opened *What the
compound has* — `resumeAt` returned the first row that was not done, which was
the one optional step the provider had deliberately left alone. And the Review
row ticked as soon as the photographs landed, showing step 6 finished above an
untouched step 5. Review is now `terminal`: it keeps its number, never a tick,
and is excluded from both the completeness rule and the progress count.

**The first attempt fixed the wrong layer.** The split above was implemented
and tested before anyone walked the flow, and it behaved the same and read
worse: the entry point still said "Create private property", created the record,
and handed over to a setup flow that now ended in a *second* button called
Create property. `/properties/new` is now step one of six — same step list, same
progress bar, "Save and continue" — and the checklist gained a `basics` step for
the property's name, kind and address, which is what had been sitting outside
the journey all along.

Decisions and reasoning: ADR 0024.

## Repair batch — Lease-gated tenancy activation

Every active/upcoming Tenancy now has a database-backed `activation_lease`, and
every active Occupancy has both its Tenancy and Lease. Existing invalid rows are
preserved as `pending_lease` context rather than presented as active.

Invitation acceptance and access-code request approval no longer create an
active relationship. Both provider clients can prepare the source-linked lease;
tenant acceptance activates it through the new `awaiting_activation` boundary.
The current requirement is lease acceptance. A reserved initial-payment gate
can pause there later without changing the request, offer or acceptance flow.

## Repair batch — Occupied Unit restrictions

FIX 3 closes the mutation and acquisition paths around an occupied Unit. The
root escape was `request_recheck`: it could supersede an approved check while a
tenant occupied the Unit, reopening details, amenities and photographs for
editing. Bed creation also had no occupancy policy, while applications and join
requests depended on listing withdrawal or credential revocation rather than
checking the allocation at the moment of submission.

The server now exposes and enforces separate decisions for sensitive editing,
private entrance directions, re-checking and bed allocation. Publication,
viewing requests, applications and access-code requests check the same `unit_is_occupied`
boundary, and Unit-row locks serialize those checks with occupancy activation.
The Unit read model now reports `pending_lease` physical occupancy as occupied,
matching the policy and preserving the lease-gated tenancy invariant.

Both provider clients remove publish, re-check and bed-creation controls while
occupied, explain why, and retain the private entrance-direction edit. Seven
focused regression tests cover the server rules, stale public/private paths,
destructive actions and the serialized `permitted_actions` contract. No schema
migration was required.

## Repair batch — Beds are hostel-only

FIX 4 removes the assumption that every `room` can be divided into Beds. The
root cause was a shared `ACCEPTS_BED_SPACES = {room}` check that ignored the
parent Property category; it drove the API vocabulary, backend validation and
both provider clients, so residential rooms inherited hostel allocation UI and
accepted direct Bed creation.

`space_rules.is_hostel_room` now supplies the complete predicate. Bed policy and
creation enforce it, non-hostel Unit/property serializers suppress legacy Bed
rows and counts, access-code lookup omits them, and private acquisition,
occupancy and lease drafting refuse to use them. Property category updates lock
and validate existing Units and cannot move a Property with Bed history away
from `hostel`.

Web and mobile render Bed management and selectors only for hostel rooms and do
not fetch bed data for other space types. The server vocabulary likewise marks
only a hostel room as accepting Beds. Existing invalid rows are preserved for
history rather than deleted. No schema migration was required because a
PostgreSQL check constraint cannot validate a field through the Unit → Property
foreign-key boundary.

## Repair batch — Public Unit gallery includes verified Property context

FIX 5 repairs a presentation split and its underlying source mistake. Listing
detail already returned Unit and Property photo arrays, but web and mobile
rendered them as separate galleries. More importantly, the Property array read
editable `PropertyMedia` rows rather than the immutable photographs a reviewer
actually approved, so the public page could show unreviewed context while the
verified Property evidence remained absent.

`ListingDetailSerializer.gallery` now composes existing files in this order:
Unit primary, other Unit photos, unique campaign photos, then current approved
Property-condition evidence. File IDs deduplicate reuse across media roles.
Property evidence types receive semantic ordering—front, side, compound and
surroundings before optional water/interior context—and source labels make
the wider Property distinct from the rentable Unit.

The public URL boundary accepts only usable, non-sensitive `property_photo`
files. Wrong-purpose files, arbitrary Property media and evidence whose review
is revoked, expired or superseded are omitted. Existing nested response arrays
remain compatible, while both current clients render the combined gallery and
remove the duplicate Property strip. No schema migration or storage copy was
required.

Meter close-ups and location-context evidence remain reviewer-only even when
they are ordinary photo files: an electricity account identifier or a street
marker is not necessary to explain the compound and may reveal information the
public listing deliberately withholds.

## Portfolio / Team management experience

The existing Organization boundary is now presented to providers as a Portfolio
or property business. An individual provider's first Property atomically creates
a personal Portfolio, makes the creator its owner and records the matching
activity, so a separate setup screen is no longer a prerequisite. Explicit setup
remains for companies, hostel operators, professional managers and teams.

Immediate membership creation has been removed from the public API. Owners and
administrators create signed, seven-day, revocable phone-bound invitations;
acceptance by the matching Danpa HQ account is the only path that activates a
membership. Decline, revoke and expiry leave no authority. Scoped Property
selections are staged on the invitation and become assignments only at
acceptance. Role changes, member removal and assign/unassign operations preserve
the last owner and write both audit and outbox records.

Web and mobile now include Team, Portfolio Settings and invitation-inbox
surfaces, plus a visible current-Portfolio switcher. Activities describe and may
prioritize the Portfolio's work; the canonical backend Property-type list stays
available during creation. Owner/admin, assigned manager/staff and assigned
accountant behavior remains backend-defined; membership does not bypass the
actor's verification or the Property lifecycle and authority gates.

The follow-up consistency repair removed the last tenant/provider “Create
workspace” shortcuts and routed approved individuals into Add first Property,
where personal Portfolio initialization already happens atomically. Full
business setup remains a deliberate Team path and now requires approved-provider
creation capability at the API boundary. Explicit setup no longer assumes a
Residential activity, both clients stopped treating activities as an allow-list,
and creating a valid Property synchronizes its missing activity. Integration
tests cover personal, existing multi-category and explicit hostel/team paths.

The first deliberate UI/UX refinement journey then reorganized Properties →
Property → Unit on web and mobile. Repeated cards became scan-oriented rows;
Property became inventory-first; Unit now owns media and detailed operations;
verification/configuration/destructive detail is progressively disclosed; and
tenant work links to the canonical Tenants area. Responsive review covered
desktop, tablet and phone-width web, including keyboard-correct modal navigation.
Physical native-device and remaining lifecycle-state visual checks stay open in
`docs/design/UI_UX_PRODUCT_DESIGN.md`.

## Free viewing attendance check-in

Viewing fees have been removed from the active model contract, provider offer
forms, tenant disclosures and notifications; legacy fee input is explicitly
rejected. Confirmed appointments now open one temporary check-in session around
the scheduled time. Its opaque QR token and six-digit fallback are generated
together with `secrets`, stored only as SHA-256/peppered HMAC verification
material, rotate together, expire after at most fifteen minutes, and are
single-use. Five incorrect codes lock that session and DRF adds per-user and
per-IP request throttles. Cancellation and material rescheduling invalidate it.

Tenant web/mobile locally render the QR and code. Provider mobile scans with
Expo Camera or accepts manual entry; provider web keeps manual entry available.
Both call one validation service and create the same audited `checked_in`
transition. A confirmed appointment can no longer be marked completed without
that transition, while tenant/host no-show outcomes remain explicit.

After completion, the tenant can create the canonical PropertyJoinRequest,
reuse SavedListing, open a viewing-scoped operations report, or record that they
are not interested. Completion itself creates neither Tenancy nor Occupancy.
Migrations add the credential session, attendance/follow-up fields, viewing
report subject and optional source-viewing link on the existing tenancy request.

## Mobile session expiry follow-up

Server session history showed healthy mobile refresh rotation and no recent
token-reuse revocations, so the remaining failure was in the native request
client rather than the session model. Unlike web, mobile surfaced an expired
bearer-token 401 without forcing a refresh/replay; screens then appeared stuck
on authorization or treated the response as a logout. It also classified every
4xx refresh/profile response—including throttling and ordinary authorization—as
proof that the session had ended.

Mobile now retries one server 401 through the existing single-flight refresh
and replays the original request with the new access token. Only explicit
refresh-credential refusals clear secure session state, while `/me/` clears it
only after a remaining 401. The rotated refresh token is written to SecureStore
before the replacement bearer is released to concurrent requests.

## Recurring rent reminder checkpoints

The next payment slice completed the scheduled reminder requirement without
enabling Paystack or inventing refund policy. Active leases now emit reminders
7, 3 and 1 days before an obligation date, on the due date, and 1, 3 and 7 days
overdue. Move-in obligations sharing one lease/date are grouped into a single
message rather than sending separate rent, deposit and fee notifications.

`RentReminder` is immutable delivery evidence and its database uniqueness
constraint makes hourly task retries harmless. Each checkpoint and its outbox
event commit together; notification delivery rechecks the live balance and
silently suppresses a reminder paid or closed in the meantime. Due-now and
overdue messages respect important-notification delivery preferences, and both
clients route the record directly to the role-appropriate Payments workspace.

## Frozen payment receipts

Processor confirmation now issues `danpahq.payment_receipt.v1`: an immutable
snapshot of the tenant, receiving provider/Portfolio, exact Property/Unit/Bed,
address, furnished state, amount, covered obligation/period, method and
processor evidence. Danpa HQ renders and stores the final PDF at the same moment,
including its SHA-256 hash, so later account or premises edits and future
renderer changes cannot rewrite the receipt that was issued.

The tenant/provider-authorized API serves that stored document directly. Web
offers View PDF, Download and Print; Expo offers the native View or save sheet
and Print on Android and iOS. Existing receipts without a v1 snapshot retain
their earlier basic presentation and do not claim a document exists. The
factual field set reflects Act 220 s. 33, but the interface explicitly avoids a
legal-compliance claim: Ghana-qualified review of electronic and stamping
formalities remains open.

## Verification overview and Portfolio settlement truth

Web Settings and the mobile account surfaces now use one **Verification**
destination. The overview is a restrained list of current facts and next
actions; identity document submission moved to a dedicated resumable page on
each client instead of crowding the status summary.

The receiving-account row no longer reads the person's legacy
`bank_account` Trust stamp. It reads the active organization's Paystack-backed
`PayoutProfile`, shows its masked verified destination, and links an owner or
admin to settlement setup/management when work remains. This matches tenant
checkout routing, which already treats the exact organization subaccount as the
financial source of truth.
## 30 August 2026 — Post-tenancy financial close-out

- Preserved incurred obligations after lease/tenancy end while blocking new
  schedule generation and cancelling only untouched future periods.
- Added immutable partial/full waiver and write-off evidence with narrow
  owner/admin authorization, audit/outbox events and explicit confirmation;
  these close-out actions are available only after tenancy end.
- Enabled post-end digital and recorded payments through existing allocation
  and receipt paths.
- Added a derived closing financial summary and access to ended rent accounts
  on tenant web/mobile Payments and provider Agreement history.
- Added focused backend and client contract coverage; security deposits remain
  outside automatic settlement.

## 30 August 2026 — Mobile Explore quick filters

- Replaced the dense small-screen Explore filter form with a horizontally
  scrollable quick-filter rail on mobile web and Expo.
- Kept high-use filters within one-handed reach and expanded only the selected
  lightweight control; price uses an inline editor rather than a full-screen
  modal.
- Preserved the full desktop filter workspace and existing listing-query
  semantics.

## Provider plans and entitlements

Three plans — Free, Pro, Business — and a `billing` bounded context that decides
what a Portfolio may do. The Portfolio subscribes, not the User. Property, Unit
and team-seat limits are enforced inside the transaction that takes the slot,
counted live rather than from a cache, with the Portfolio row locked first so
two concurrent creates cannot both take the last one.

Plan codes exist nowhere outside `apps/billing`, held by a test that walks every
other Python file. Prices and limits are database rows. Unlimited is a flag, not
a large number. A downgrade removes nothing.

Nothing charges anybody: there is no endpoint that activates a paid plan.
Checkout is the next phase and settles through the existing Payments Core. See
ADR 0032.

## 31 August 2026 — Provider Dashboard web visual architecture

- Rebuilt only the Provider Home content around Portfolio search, greeting,
  occupancy, actionable attention, rent collection, leasing, schedule, recent
  activity and a real Property highlight; the provider sidebar is unchanged.
- Extended the existing Portfolio read model with 12 monthly and 6 yearly
  collection buckets from confirmed payments and current obligation balances.
  No second balance or client-side accounting logic was introduced.
- Added a lightweight accessible SVG chart with Monthly/Yearly switching,
  keyboard/pointer period inspection, crosshair, tooltip and reduced-motion
  behavior, without a chart dependency.
- Verified the signed-in live dashboard at wide and tablet widths, including
  scoped search and chart switching, plus focused backend/web contracts.
