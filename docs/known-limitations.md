# Known limitations

Recorded honestly. Every limitation here was considered, not overlooked.
A document that only lists what was solved is marketing.

---

## A charge's paid total and its allocations are two records that must agree

`rent._resettle` computes `RentCharge.amount_paid_minor` from confirmed
`RentPayment` rows. `PaymentAllocation` separately records which obligation
provider-confirmed money answers for. A PSP payment writes both in one
transaction; an off-platform cash payment writes only the first, because there
is no provider transaction for an allocation to hang off.

They are expected to agree and `reconciliation.sweep_unallocated_transactions`
exists to notice when they do not, but "expected to agree" is weaker than one
source of truth. Making allocation the sole authority means giving external
payments a synthetic transaction, which is a deliberate design decision and not
a refactor.

---

## Reconciliation alerting needs one deployment decision

The application now escalates *and delivers*: an exception is posted to
`PAYMENT_ALERT_WEBHOOK_URL` when opened, re-alerted while unanswered, raised to
`critical` past the breach window, and quietened — not closed — once
acknowledged, speaking up again as `..._stalled` if an investigation stalls.
Every alert names `PAYMENT_ALERT_OWNER` and carries no tenant, amount or
provider payload.

What remains is configuration a person must make: set those two variables and
name a rota. An alert nobody receives is the same as no alert.

One thing this cannot do: alerting runs on the Celery worker, so a worker that
is down cannot report that it is down. External liveness monitoring covers that
and is listed separately.

---

## The part-payment floor is a guess until real traffic tests it

A part payment must be at least `PAYMENT_MINIMUM_PART_MINOR` (default GHS 50)
unless it clears the whole remaining balance. The floor exists because the
receiving Portfolio bears the processor's transaction fee, so several small
payments cost a landlord several fees to collect one rent.

GHS 50 is a reasoned default, not a measured one. Whether it is the right
threshold for this market — and whether providers would rather set it themselves
per Portfolio — is a commercial question the first live cohort will answer.

---

## Payment refunds are modeled but not operationally executable

`payments.Refund` is an additive record and the provider adapter has a refund
operation, but Rooomly does not expose a refund request or approval endpoint.
That is intentional. A completed refund must also reverse or offset the original
allocation and restore the correct rent obligation balance without altering the
immutable successful transaction or receipt. Those accounting and product rules
have not yet been decided.

Exposing the provider call first would allow money to leave while Rooomly still
described the rent as paid. The next refund slice must define full/partial refund
allocation semantics, settlement effects, replacement receipt or credit-note
evidence, permissions, failure recovery, and renewed collection behavior before
adding an operations action.

---

## Identity verification — no file upload before Phase 2

**Carried in from Phase 1, now resolved in Phase 2.**

The file upload endpoint, the presigned-URL flow and the three-step lifecycle
(reserve → upload → complete) are implemented. Identity verification can now
be completed end-to-end: a user starts a check, uploads a Ghana Card photo,
and the file becomes evidence. The magic-byte validation runs on the server
after upload; there is no ClamAV or cloud AV integration, so the scan gate
is set to `FILE_SCAN_MODE=permissive` in development.

What remains:
- No liveness check, no face match against the card, no NIA API lookup. A
  reviewer sees the uploaded image and makes a human decision. The product
  must not imply more.
- The file is released from its scan hold without a real scanner. This is
  honest in the configuration (`FILE_SCAN_MODE`) and in the code comments.

---

## Account recovery — no recovery mechanism

**Not resolved. Will not be addressed until it is needed in practice.**

If a user loses the phone number registered to their account, they lose
access. There is no recovery flow. This is recorded here and in
`docs/windows.md` so users are not surprised, and in `docs/security.md`
because the absence of recovery is a security consideration as much as a
UX one.

What a recovery mechanism would need:
- A step-up verification against identity, not just another OTP (because the
  old number is gone, and a new SIM on the old number is the SIM-swap attack).
- A human review step before a number change is granted.
- An alert to the old number's last-known contact details.
- A cooling-off period before any payout-related operations are unlocked.

Design is straightforward. It was not built because the higher-priority work
was the upload flow and property listings, and recovery can be retrofitted
without schema changes — the step-up and verification machinery it needs is
already there.

---

## SMS provider — console only

No SMS gateway is integrated. `SMS_BACKEND=console` prints one-time codes
to the API terminal window. In development that is useful; in production it
would print credentials to a log. `production.py` requires `SMS_BACKEND` to
be set, so a deploy without a real adapter fails to start rather than
silently logging codes. The adapter interface (ADR 0009) is defined; no
adapter is implemented.

---

## SIM-swap detection — the hold works, the trigger does not

The 72-hour security hold on money movement is implemented and enforced. The
trigger for a *carrier-reported* SIM swap is not: `hours_since_sim_change_reported`
is always `None` because no aggregator API is integrated. The hold fires on a
phone-number change the user initiates themselves, but not on a SIM swap the
carrier performs without the user's knowledge. Both the field type and its
documentation mark it as unpopulated rather than guessing at a value.

---

## Virus scanning — magic-byte validation only

Uploaded files pass magic-byte validation (executables, archives, scripts and
HTML are rejected regardless of the declared content type). They do not pass
a real virus scanner. `FILE_SCAN_MODE=permissive` releases files after the
magic-byte check; `FILE_SCAN_MODE=strict` holds them until a scanner marks
them, which currently means they would never be released. The interface for a
scanner result (`mark_scanned()`) exists.

---

## Windows — known working, not continuously tested

Everything runs in Docker, which removes most of what used to break on Windows.
`.gitattributes`, `tzdata` and the `ensure_bucket` command still address
specific failure modes that were reported. The remaining Windows notes — and
the `--pool=solo` Celery flag you need if you run the backend on the host
instead — are in `docs/windows.md`.

No automated CI runs on Windows. The GitHub Actions workflow uses Ubuntu. A
Windows-specific workflow is a future item.


---

## The Rent Act advance limit needs legal review

`apps/lease/advance_policy.py` states a threshold of six months, on the reading
that Ghana's Rent Act 1963 (Act 220) limits rent paid in advance on a monthly
tenancy to six months. Both the threshold and what the product does about it
are configurable — `allow`, `warn` or `block` — and the default is `warn`:
leases above the threshold are flagged to both parties, in the same words, and
are **not** blocked.

`warn` is the default deliberately. It is the only stance that is safe while
the legal position is unconfirmed, because it informs without refusing a lease
the law may well permit — and a refusal would fall on the party with less
power. `block` exists so an operator who *has* taken advice can act on it
without a code change.

This is an engineer's reading of the Act, not legal advice, and the interface
says so where it appears. **The wording of the notice is composed server-side
in `advance_policy.assess`** so there is exactly one text for a lawyer to
review; clients render it and do not compose their own.

Before launch a Ghanaian lawyer needs to confirm the limit, which tenancies it
applies to, whether `warn` is the right default, and the wording itself.

### What the policy declines to judge

A non-monthly rent returns `allow` and says nothing. "Six months of advance"
does not carry the same meaning on a yearly tenancy, and rather than invent a
conversion the product declines to make a claim it cannot support. If that case
matters commercially it needs its own reviewed position.

---

## The acceptance record is not an electronic signature

`apps/lease/execution.py` freezes the terms when an offer is made, hashes them,
and records each party's acceptance separately — who, when, from which address
and user agent, against which content hash. `LeaseAgreement.verify()` reports
whether the stored terms still hash to what was accepted.

That is an auditable record of **what happened in this product**. It is *not* a
claim that the acceptance constitutes a legally binding electronic signature.
Whether it does under Ghana's Electronic Transactions Act 2008 (Act 772) is a
question for a Ghanaian lawyer, and this codebase does not answer it. No screen
should describe it as a signature, and none currently does.

The design keeps that door open rather than closed: `LeaseAcceptance.method` is
a field with one value today, so a formal e-signature provider or a scanned
wet-ink copy can be added later as an *additional* acceptance record without
invalidating or reinterpreting anything already stored.

### What is deliberately not kept

Circumstances are thin on purpose — address and user agent, nothing more. The
purpose is a record that stands up in a disagreement between the two parties,
not a device fingerprint of either of them.

---

## Condition checks do not lapse on a timer

`PROPERTY_CONDITION` and `SPACE_CONDITION` have no entry in `VALIDITY_DAYS`, so
neither expires on its own. What a building looks like does change, but it
changes when something happens to it rather than on an anniversary, and expiring
the check would quietly pull a live listing while the property is exactly as it
was photographed.

Re-checking is meant to be triggered by an edit or by a report, both of which
supersede the previous verification. **Neither trigger is built yet.** Until one
is, an approved condition check stands indefinitely, which is the weaker half of
this decision and worth revisiting before launch.

---

## Condition evidence is reviewed by a person, and nothing checks the photos

The gate added with the named slots is a *completeness* gate: it refuses a
submission until every required slot has a file against it. It does not, and
cannot, tell whether the photograph in the "side of the property" slot is
actually the side of that property — or a photograph of a building at all.

That judgement belongs to the reviewer. Worth stating because "verification
submitted" and "three photos present" are the same fact today, and a screen that
implied otherwise would be overclaiming.

## Space verification does not enumerate every room

A rentable space is asked for its main interior view (or the equivalent for a
space without an interior), **one photograph for every selected Unit amenity**,
and two optional context views. The property it sits in is still asked for its
front, side, surroundings and authority evidence, and is reviewed separately.

Until `POLICY_VERSION` `2026.08.3` the space review enumerated every bedroom and
every bathroom. That slot existed for a reason: *"each sleeping room, so nobody
arrives to fewer than they agreed."* It is gone, and what replaced it is the
declared counts, the provider's own photographs and the viewing.

The trade remains deliberate. A hostel with eight rooms was forty photographs
before anything could be let, most of them re-proving what the property review
had established. Policy `2026.08.4` restores evidence for features the provider
explicitly claims — kitchen, private bathroom, wardrobe and so on — without
returning to a photograph of every counted bedroom. A verified space therefore
means somebody saw its overview, each claimed amenity and the Property around
it; it still does not mean every room was independently counted.

Re-deepening it is a policy change, not a code change: the requirements are data
in `trust/evidence_policy.py` carrying a version, and a submission records the
version it was judged under, so raising the bar does not retroactively make an
existing approval look deficient.

## A space's photographs are frozen once it is checked

Adding, removing or reordering photographs after approval is refused. Changing
them is `request_recheck`, which supersedes the approval, returns the space to
draft and takes its live listings out of discovery until it passes again.

This is deliberately blunt. A provider who wants to add one more photograph of
an already-approved room pays for it with a re-check and time off the market,
where a finer rule might allow additions and refuse replacements. The blunt
version was chosen because the alternative puts an unreviewed image on a page
that says the space was checked, and that is the exact false confidence the
verification model exists to remove.

## The OpenAPI schema describes paths, not bodies

Most of this API is built on plain `APIView` with hand-written `Response(...)`,
so drf-spectacular cannot infer what any of them accept or return. The published
schema therefore lists every endpoint and its authentication correctly, and
describes 130 of them with no request or response body.

`drf_spectacular.W001`/`W002` are silenced for `manage.py check --deploy` — 136
identical notices were burying the one security warning that step exists to
surface — but `manage.py spectacular` still prints all of them, which is where
anyone working on this would look.

Fixing it means a `serializer_class` or an `@extend_schema` per view. That is
worth doing before anyone generates a client from this schema, and it is a piece
of work in its own right rather than something to fold into a feature.

## Dependencies carry known advisories

`pip-audit --strict` reports 27 across four packages, most of them against
**Django 5.1.5**. Clearing them needs Django 5.2.16 or later — a minor-version
bump of the framework, with its own regression surface across the suite, and so
a deliberate piece of work rather than a side effect of one. `pip`, `pytest` and
`sqlparse` also have fixes available.

## The type checker has never actually run

`mypy apps config` stops on a path-resolution error — `apps/` has no
`__init__.py`, so `apps/core/context.py` resolves as both `core.context` and
`apps.core.context` and mypy refuses to continue. It has therefore checked
nothing since the step was written.

Adding `explicit_package_bases = true` makes it run, and it then reports **154
errors across 40 files**. Those are the real state of the annotations, and
working through them is a piece of work in its own right — the config change on
its own would only swap a meaningless failure for an informative one.

Deliberately left as-is rather than changed to expose a list nobody has budgeted
for. `apps.core.money` is the one module already type-checked strictly, and it
passes.

## Which CI steps are red, checked rather than assumed

Verified 28 August 2026 by running each step the way `ci.yml` runs it. The
previous version of this section claimed everything but `pip-audit` and `mypy`
passed. That was wrong in both directions, and worth recording as a lesson: a
list of green steps written from memory is not evidence.

**Red, and each a scheduled piece of work:**

- `pip-audit --strict` — dependency advisories, above. Currently `pip` and
  `pytest` in the toolchain, not runtime dependencies.
- `mypy` — the section above; it has never actually run.
- `ruff format --check .` — **29 files**, all from work currently in flight.
  Mechanical to clear (`ruff format .`), deliberately not done in a change that
  was about something else, because a 29-file reformat buries the diff it
  travels with.

**Was red, silently, and is now fixed:**

- **Django deployment checks.** `production.py` marks ten settings
  `required=True`; the workflow supplied seven. The step had been dying on
  `ImproperlyConfigured` before checking anything since `UNIT_ACCESS_CODE_PEPPER`
  was introduced — a failure that looked like a failing check but was a missing
  variable. `MANAGEMENT_CSRF_KEY` and `STORAGE_SIGNING_KEY` were missing too.
  Any setting production requires has to be listed in that step.
- **`bandit`.** One High-confidence B406 on `apps/lease/pdf.py` importing
  `xml.sax.saxutils.escape`. The blacklist is about the `xml.sax` *parser*
  being unsafe on untrusted input; nothing in that file parses anything, and
  `html.escape(..., quote=False)` is identical for the three characters that
  matter. Replaced rather than suppressed.
- **Module boundaries.** Two module-level cross-domain model imports, both now
  function-scoped: `occupancy/tenancy_views.py` reading `LeaseStatus`, and
  `application/serializers.py` reading `IncomeBand`.

  The second needed more than moving a line. `IncomeBand.choices` was evaluated
  in a serializer's class body, which runs at import time, so the choices are
  now bound in `__init__` instead. The existing test only proved an *invalid*
  band was rejected — which an empty choice list also does — so a test that a
  valid one is accepted went in beside it.

**Green:** lint, migrations, tests (1159), boundaries, schema invariants,
bandit, deploy checks, design tokens, web and mobile.

## The lease template is not approved for production use

The Rooomly Ghana Residential Tenancy Agreement ships as
`rooomly.gh.residential` version `2026.08-draft.1`, marked
`requires_ghana_legal_review`. The lifecycle, rendering, evidence, PDF and both
clients are complete and tested against it; **the wording is not.**

`production.py` sets `LEASE_TEMPLATE_REQUIRE_APPROVAL = True`, so a production
deployment **refuses to send** an agreement built on an unapproved template, and
`tests/unit/test_schema_invariants.py` asserts that line still exists.
Development and test environments run the whole workflow with the draft, which
is what allows the architecture to be finished before counsel is engaged.

What must happen before the gate can be opened is written down in
`docs/legal/GHANA_RESIDENTIAL_LEASE_CLAUSE_REVIEW.md`: a clause-by-clause source
map and ten questions for Ghana-qualified counsel. Two are worth repeating here
because they are product decisions, not wording:

- **Advance rent.** Act 220 s. 25(5) distinguishes monthly and shorter tenancies
  from those exceeding six months. The current product rule applies one
  six-month threshold to monthly periods only, and warns rather than blocks.
  Counsel must supply the full decision table and decide whether Rooomly refuses
  non-permitted terms outright.
- **What acceptance is.** Rooomly records an acceptance with a hash, an account
  identity, a timestamp and request evidence. Until counsel says otherwise this
  is described as a *recorded acceptance* and never as a legal electronic
  signature.

Also outstanding: end dates are computed on approximate 30-day months and need
calendar rules; the clause set has no assignment/subletting, access-notice or
severability clause, left absent deliberately rather than invented.

## Closing a schedule leaves one question about past periods open

Ending a tenancy closes the charges for periods it will never run; superseding
an agreement closes the whole unpaid schedule, because the replacement bills the
same term afresh. That second rule has a consequence worth stating.

`build_schedule` bills from the lease's `starts_on`, and an amendment carries
that date forward. So an amendment made in month six re-bills months one to six
at the *new* rent, and the original's charges for those months — including any
genuine arrears — are closed. Where the rent went up, that silently increases
what is owed for months already lived through.

Nothing here decides that question; it is recorded so the next person meets it
deliberately. The likely answer is that an amendment should bill only from the
date it takes effect, which means an amendment needs an effective date distinct
from the tenancy's start. That is a product decision, not a refactor.
