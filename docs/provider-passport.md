# Provider Passport

Provider Passport is an additive Portfolio credential profile. Existing provider
account approval, Tenant Passport, property authority and property-condition
verification keep their existing models, records and access rules. No existing
provider is required to complete this Passport to keep using their workspace.

## Ownership and requirements

- Each existing `Organization` can have one `ProviderPassport`. Reading a Passport
  does not create a new identity, Portfolio or profile row.
- Active Portfolio owners and administrators manage it. Staff, accountants,
  delegated property managers, other providers, tenants and ended memberships
  cannot read or mutate its private endpoints.
- The representative must be an active Portfolio owner or administrator. Name,
  contact verification, identity-document review and profile photograph come from
  the existing person/profile records. Representatives edit their own identity;
  Portfolio administrators cannot rewrite someone else's identity here.
- Current provider account approval, verified personal phone and email, current
  identity review and an available profile photograph are required for submission.
  Document review is not electronic Ghana Card or biometric verification.
- All four existing categories are supported: individual owner, property company,
  property manager and hostel operator. Companies require a registration number
  and private business certificate. Other categories require them only when the
  provider declares a registered business. Individuals are not required to supply
  company documents by default.
- Non-individual categories also supply the representative's role and organization
  contacts. Organization contact details are recorded details, not claimed OTP
  verifications. Fixed lines are accepted for organization phones.
- Agency licences and representative-authorization letters are optional credentials.
  A representative's business authorization is not an owner's authorization to
  manage a property.

## Lifecycle and review

Draft completion is computed from the actual records. The owner sees Not started,
Incomplete, Ready to submit, Submitted, Under review, More information required,
Verified or Rejected. An expired, edited or otherwise invalid approval no longer
shows a verified stamp and can be submitted again. Reviews are valid for 365 days
under the existing trust expiry mechanism.

Submission atomically freezes credential fields and document references in a
`Verification` with subject `organisation`, kind `provider_credentials`, method
`document_review`. It enters the existing Management verification queue. Reviewers
claim, inspect the snapshot and evidence, request information, approve or reject
using the existing capability-protected actions. Decisions retain the reviewer,
timestamp, notes, audit record and evidence.

Matching pending submissions cannot be edited. More-information responses and
changes after a decision create a new submission envelope when resubmitted;
previous notes, evidence and decisions remain readable. Old queue entries close.
The owner's recent-history section shows the latest 30 submissions; older rows
remain retained in the verification store.
Changes to the organization name/category, credentials, representative eligibility
or required identity evidence prevent a stale submission from being approved.
Repeated submission of the same pending package is idempotent.

Credential edits immediately remove the public verified stamp until a fresh
review. Removing a draft document never deletes the immutable evidence retained
by a previous review or its StoredFile.

## Property authority and reputation

The property section reads the existing property lifecycle. Legacy personal
Portfolio authority records are recognized through their actual person/property
relationship and existing property approval. An owner's reviewed property does
not establish a different manager's authority. Passport decisions never approve
properties, publish listings, grant membership or enable provider account access.

Activity counts use actual accepted tenancies and completed maintenance records.
They are restricted to activity created during the Portfolio's current property
relationships. Previous owners' activity and unsupported/unaccepted tenancies
are not attributed to a new manager. These are scoped record counts, not lifetime
reputation or performance scores. Ratings, reviews and response-time aggregates
are not manufactured; the interface identifies unavailable metrics explicitly.

## Privacy

Private Passport responses and download responses use `no-store, private`,
`noindex, nofollow` and `no-referrer`. Contact details, registration numbers,
identity references, draft files, review notes and activity are never included in
public listing metadata. A former representative's current contacts and photo
are redacted once their eligible membership ends.

Uploads reuse the existing private, size/type-validated, scanned
`property_document` pipeline. Only the caller's own usable sensitive uploads can
be attached. Authorized Portfolio managers obtain audited 60-second document/photo
URLs through Passport endpoints. Management evidence reads retain the existing
verification capability checks. A legacy customer support/staff role alone cannot
open Passport credentials through the generic file endpoint, including after a
draft attachment has been removed but review evidence remains.

Rental and sale detail serializers expose an explicit allowlist for currently
verified, linked provider credentials: organization name, category, verification
date, expiry and verified state. Documents, private contacts, government IDs and
financial data are excluded. Public pages label these as Provider Passport checks
separately from property verification.

## Models, migrations and APIs

New models in `backend/apps/passport/models.py`:

- `ProviderPassport`: OneToOne Organization, representative FK, business/role/contact
  fields, draft revision and current verification FK.
- `ProviderPassportDocument`: Passport, existing StoredFile and credential category,
  with unique Passport/file binding.

Additive migrations:

- `trust/0002_alter_verification_kind.py`
- `passport/0002_providerpassport_providerpassportdocument.py`

Private routes under `/api/v1/organizations/<organization-id>/provider-passport/`:

| Route | Method | Purpose |
| --- | --- | --- |
| root | GET, PATCH | Read or save authorized credentials |
| `submit/` | POST | Validate and submit credentials for review |
| `documents/` | POST | Attach an owned, scanned private upload |
| `documents/<document-id>/` | DELETE | Detach from the editable draft |
| `documents/<document-id>/download/` | GET | Issue a scoped short-lived download |
| `photo/` | GET | Issue the eligible representative's private photo URL |

Management's existing verification endpoints handle claim, decision, more-info and
evidence reads. The existing Verification records page now also includes Passport
review history, with distinct subject/review labels.

## Client changes

Web: `/provider-passport`, with an authorized Portfolio selector, overview,
requirements, identity/contact section, credential form, document controls,
property-authority links, actual activity and review history. Navigation and page
title use Provider Passport under the sidebar's You section; Tenant Passport
remains `/passport`. A compact cover and next steps lead into one credential and
document surface, with identity and activity alongside it. Property authority and
review history remain distinct. The layout adapts to the available content width.

Mobile: `/(app)/provider-passport`, available from the provider More section for
eligible Portfolio managers. It uses existing inputs, dropdowns, record panels,
photo-document uploads and protected downloads. Returning to the screen refreshes
the Passport. Both clients offer Refresh status while a review is pending. Web
accepts PDF/JPEG/PNG documents; mobile currently uses the existing
photo picker for document images. A native PDF file picker was not added.

Primary implementation files: `backend/apps/passport/provider.py` and
`provider_views.py`, existing trust services/serializers, API URLs, file permissions,
Management history, rental/sale detail serializers, the new web/mobile
`providerPassport.ts` clients and Passport screens, and their navigation/listing
integrations. No application dependencies were added or updated.

## Validation and rollout

The additive migrations were applied successfully to the local development DB.
Existing records were not backfilled with approvals, credentials or reputation.
Deployment must run the normal Django migrations before serving the new code:

```powershell
docker compose exec -T api python manage.py migrate
```

Checks executed:

```powershell
# Web
npm.cmd test
npx.cmd tsc --noEmit
# Mobile
npm.cmd test
npm.cmd run typecheck
# Backend, inside the api container
pytest -q tests/integration/test_provider_passport.py tests/integration/test_passport.py tests/integration/test_management_portal.py tests/integration/test_property_portfolio_scope.py tests/integration/test_rent_tax_report.py
pytest -q tests/integration/test_provider_passport.py tests/integration/test_trust.py tests/integration/test_listing.py tests/integration/test_sale.py tests/integration/test_provider_management_approval.py tests/unit/test_module_boundaries.py
pytest -q tests/integration/test_upload.py tests/integration/test_upload_flow.py tests/unit/test_file_validation.py
python manage.py check
python manage.py makemigrations --check --dry-run
```

Results: 566 web tests and 468 mobile tests passed. The two overlapping backend
runs passed 90 and 111 tests respectively, including all 19 Provider Passport
cases and Tenant Passport regressions. Architecture checks passed. An additional
64 upload and file-validation regression tests passed. Django system checks and
migration drift checks passed. Backend Ruff and targeted client lint
were run. The backend emitted existing missing-staticfiles warnings; lint on the
existing mobile listing/sale screens also reported pre-existing ref warnings.
Generated migrations follow the repository's existing Ruff exclusion and were
verified by successful migration application and Django's no-drift check.

Signed-in browser inspection verified the real incomplete Passport, existing
property verification labels, document controls and the responsive 390-pixel
layout. Toggling the business declaration showed the registration requirement;
the toggle was restored without saving. No real Passport was fabricated or
approved for visual testing. Lifecycle, document permissions, exact activity
counts and review decisions were tested in the isolated test database.

Physical-device photo selection/opening and full native iOS/Android builds were
not run. They remain manual release checks; browser responsiveness is not a claim
that a native device was tested.
