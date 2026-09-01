# Rooomly — A-to-Z Product Development Roadmap

> **Document type:** Master implementation roadmap  
> **Product:** Rooomly — Ghana Property Management & Rental Platform  
> **Architecture:** Django/DRF modular monolith + PostgreSQL + Redis/Celery + Next.js + Expo/React Native  
> **Purpose:** Define the complete phased path from the current rental foundation through payments, operations, trust, digital services, financial services, intelligence, scale, and long-term platform evolution.

---

## 0. How to Use This Roadmap

This roadmap does **not** replace the live codebase or current project status.

Before starting any phase:

1. Read `docs/phases.md`.
2. Read `docs/status.md`.
3. Read the relevant files under `docs/architecture/`.
4. Inspect the current Django, Next.js, Expo, database, tests, permissions, audit, and event/outbox implementations.
5. Treat existing working code as the source of truth for what already exists.
6. Preserve working architecture and extend it rather than rebuilding it.
7. Reconcile this roadmap with current implementation and mark items `DONE`, `PARTIAL`, `CURRENT`, `NEXT`, `FUTURE`, or `BLOCKED`.

The development loop remains:

```text
DISCOVER
→ PLAN
→ DESIGN
→ ARCHITECT
→ IMPLEMENT
→ TEST
→ VERIFY
→ DOCUMENT
→ PACKAGE
→ REVIEW
→ NEXT PHASE
```

Every capability should be delivered as a full-stack vertical slice where appropriate.

---

# PART I — PRODUCT FOUNDATION

## Phase A — Engineering & Platform Foundation

**Goal:** Establish a stable platform that can be developed for many years.

### Scope

- Django modular monolith
- Django REST Framework
- PostgreSQL
- Redis
- Celery
- Object storage abstraction
- Next.js + TypeScript
- Expo + React Native + TypeScript
- Shared design tokens
- Environment configuration
- Structured logging
- Error handling
- Health/readiness checks
- CI/CD foundation
- Formatting/linting
- Test infrastructure
- API conventions
- Local development
- Docker/deployment foundation
- Architecture Decision Records
- Documentation structure

### Platform requirements

- UUID/identifier conventions
- Created/updated timestamps
- Soft-delete/archive policy where appropriate
- Pagination
- API versioning
- standardized errors
- request correlation IDs
- transactional boundaries
- outbox/event foundation
- append-only audit foundation
- secure configuration/secrets

### Exit criteria

A clean installation can run backend, web, mobile, workers, database and cache with tests passing.

---

## Phase B — Identity, Accounts & Access Control

**Goal:** Establish who users are and exactly what they are allowed to do.

### Scope

- Registration
- Login/logout
- Phone verification
- Email verification
- Password recovery
- Session management
- User profiles
- Landlord/provider profiles
- Tenant profiles
- Agent/manager profiles
- Role/grant model
- Object-level permissions
- Organization membership where already implemented
- Account status
- Account recovery
- MFA/step-up authentication foundation
- Device/session history
- Security notifications

### Roles are not permissions

Do not rely on broad roles alone.

Use explicit capabilities for actions such as:

```text
property.create
property.update
unit.create
unit.submit
unit.publish
viewing.manage
tenant.invite
lease.create
lease.accept
payment.view
payout.manage
```

### Exit criteria

Authorization is enforced server-side and tested for cross-user/cross-property access.

---

## Phase C — Trust, Verification & Fraud Foundation

**Goal:** Make trust a platform capability before high-value rental and payment activity grows.

### Core concepts

Do not use one universal `verified = true`.

Maintain separate states for:

- Identity
- Contact information
- Property authority
- Property
- Unit
- Representative authority
- Payment destination
- Future financial/KYC requirements

### Scope

- Verification cases
- Evidence
- Review workflow
- Verification history
- Reverification
- Fraud reports
- Basic risk signals
- Restrictions
- Moderation actions
- Fraud case foundation
- Trust & Safety admin queue
- Admin audit
- Four-eyes approval foundation for high-risk actions

### Key invariant

```text
IDENTITY VERIFIED
≠
PROPERTY AUTHORITY VERIFIED
≠
PROPERTY VERIFIED
≠
UNIT VERIFIED
```

---

# PART II — RENTAL SUPPLY

## Phase D — Property Management

**Goal:** Give property providers a trustworthy digital representation of their properties.

### Scope

- Property creation
- Draft/save-for-later
- Property types
- Location
- Property media
- Property amenities
- Ownership/authority relationship
- Property status
- Verification submission
- Verification review
- Rejection/resubmission
- Property detail
- Provider property portfolio
- Archive rules
- Permission-safe editing

### Ghana-specific considerations

- Human-readable landmark/location information
- Mobile camera uploads
- Incomplete addressing
- Connectivity-aware upload behavior
- Authority may belong to owner, co-owner, manager or authorized representative

### Exit criteria

Property creation → verification → approved management works across backend and user interfaces.

---

## Phase E — Units & Private Inventory

**Goal:** Represent the actual rentable inventory inside a verified property.

### Core rule

A unit may be created/drafted under an unverified property, but:

```text
PROPERTY NOT VERIFIED
        ↓
UNIT MAY BE SAVED
        ↓
UNIT CANNOT BE SUBMITTED FOR VERIFICATION
```

Once property verification succeeds:

```text
UNIT DRAFT
→ SUBMITTED
→ UNDER REVIEW
→ VERIFIED
```

### Scope

- Unit creation
- Draft/save-for-later
- Resume/edit draft
- Unit media
  - primary room image
  - optional additional images
- Unit amenities
  - self meter
  - bathroom
  - water availability
  - porch
  - kitchen
  - extensible amenity catalog
- Property-location inheritance
- Unit verification
- Unit availability
- Unit occupancy status
- Unit privacy/distribution settings
- Unit archive
- Unit audit history

### Critical UX

No silent failures.

Every failed submit must return and display an actionable validation/error message.

---

## Phase F — Unit Distribution & Listings

**Goal:** Separate inventory management from public marketplace publication.

A verified unit can be:

```text
PRIVATE
PUBLIC
UNLISTED / LINK-ONLY
OCCUPIED
```

### Public

- Marketplace discoverable
- Search/filter eligible
- Tenant can view details
- Tenant can request viewing
- Tenant can request tenancy

### Private

- Not searchable
- Provider can invite a known prospective tenant

### Link-only

- Not indexed in marketplace
- Secure link/code sharing
- Useful for WhatsApp/referrals/private groups

### Occupied

- Existing tenant management
- No public availability

### Listing scope

- Listing lifecycle
- Publication/withdrawal
- Pricing
- availability
- property + unit media composition
- approximate public location
- trust indicators
- listing freshness
- listing expiry/reconfirmation
- suspension/moderation
- share/deep links

### Important separation

Keep separate:

```text
Unit verification status
Unit availability status
Listing publication status
Occupancy status
```

Never overload one `status` field.

---

# PART III — DISCOVERY & TENANT ACQUISITION

## Phase G — Marketplace, Search & Discovery

**Goal:** Allow tenants to find legitimate rental inventory without making Rooomly merely another listing site.

### Scope

- Public marketplace
- Search
- Filters
- Sorting
- Price ranges
- Location/landmark search
- Amenities
- Unit/property type
- Verified inventory preference
- Saved/favorite units
- Recently viewed
- Sharing
- Search history where appropriate
- Pagination/infinite loading
- Low-bandwidth media strategy
- Map experience later where valuable
- Recommendation-ready event capture

### Property detail experience

Show:

- Unit photos
- Relevant property photos
- Rent
- advance/deposit breakdown
- amenities
- approximate location
- verification/trust information
- availability
- viewing actions
- tenancy request action

---

## Phase H — Viewing & Remote Rental Discovery

**Goal:** Reduce wasted travel and make long-distance rental discovery practical.

### Viewing types

- Physical
- Virtual live
- Recorded walkthrough
- Future 360°/verified tour

### Scope

- Viewing availability
- Viewing request
- Accept/decline
- Reschedule
- Cancel
- Reminders
- Viewing representatives
- Temporary viewing code
- Check-in
- Completion
- No-show
- Viewing outcome
- Report a problem
- Exact-location release rules

### Viewing representative roles

- Landlord
- Property manager
- Caretaker
- Verified agent
- Authorized representative
- Future Rooomly Viewing Partner

### Least privilege

A viewing representative may conduct a viewing without automatically receiving:

- lease authority
- property ownership rights
- rent collection authority
- payout access
- pricing authority

### Location privacy

Suggested visibility:

```text
PUBLIC_APPROXIMATE
CONFIRMED_VIEWING_ONLY
APPROVED_TENANT_ONLY
PRIVATE
```

### Post-viewing

```text
COMPLETED VIEWING
      ↓
Interested
Need more information
Not interested
Report problem
```

Interested tenants can continue into a tenancy request.

---

## Phase I — Tenant Invitation & Existing Tenant Onboarding

**Goal:** Support landlords who already know their tenant without assuming every landlord does.

### Acquisition paths

```text
                    VERIFIED UNIT
                         │
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
   MARKETPLACE       DIRECT INVITE    EXISTING TENANT
        │                │                │
Tenancy Request      Invitation       Confirmation
        └────────────────┼────────────────┘
                         ↓
                      TENANCY
```

### Direct invitation

- Phone/email invitation
- Secure token/code
- Expiration
- Revocation
- Recipient verification
- Review unit/terms
- Accept
- Decline

**Invitation does not equal tenancy.**

### Existing tenant onboarding

For already occupied units:

- Landlord/provider enters current tenancy information
- Tenant receives confirmation
- Tenant confirms or disputes
- Imported data distinguishes provider-reported vs mutually confirmed facts

### Future

- Bulk tenant migration for professional landlords
- CSV/import tools
- Assisted onboarding

---

## Phase J — Tenancy Requests & Applicant Workflow

**Goal:** Convert public interest into a controlled tenant-selection workflow.

### Scope

- Tenant-initiated tenancy request
- Requested move-in date
- Proposed term
- Optional message
- Applicant profile
- Provider review
- Approve/decline
- Withdraw
- Expire
- Request additional information
- Waitlist future option
- Reservation/hold policy
- anti-discrimination/fairness review where applicable

### Unit concurrency

When a tenant reaches an exclusive reservation stage:

```text
AVAILABLE
→ RESERVED
→ TENANCY_PENDING
```

Prevent conflicting exclusive workflows.

---

# PART IV — TENANCY, LEASE & OCCUPANCY

## Phase K — Tenancy Lifecycle

**Goal:** Create the durable relationship connecting tenant, unit and provider.

### Entry sources

- Approved public tenancy request
- Accepted direct invitation
- Confirmed existing tenancy

### Scope

- Tenancy aggregate
- Parties
- Unit
- start/end dates
- state machine
- historical tenancy
- termination/cancellation rules
- renewal
- tenant move-out
- provider changes
- authorized participants
- tenancy audit history

### Suggested lifecycle

```text
PROPOSED
→ PENDING_LEASE
→ AWAITING_PAYMENT
→ ACTIVE
→ NOTICE_GIVEN
→ ENDED
```

With explicit cancelled/terminated/disputed states.

---

## Phase L — Lease & Agreement Management

**Goal:** Replace informal, mutable agreements with traceable digital records.

### Scope

- Lease creation
- Lease terms
- Structured financial terms
- Document generation
- Versioning
- Provider acceptance
- Tenant acceptance
- Acceptance evidence
- Immutable accepted snapshot
- Amendments
- Renewal
- cancellation/termination documentation
- document download
- legal-review placeholders

### Critical invariant

Accepted leases cannot be silently edited.

```text
LEASE v3
→ BOTH ACCEPT
→ IMMUTABLE

Change needed
→ AMENDMENT v1
→ REVIEW
→ ACCEPT
```

### Future

- Legally reviewed e-signature integration if required
- advanced templates
- institutional landlord templates

---

## Phase M — Occupancy & Move-In

**Goal:** Turn an accepted/paid tenancy into actual occupancy safely.

### Scope

- Occupancy record
- Unit occupied transition
- Listing withdrawal/pause
- Move-in date
- Key/handover acknowledgement
- Move-in inspection
- utility/meter readings
- condition media
- tenant/provider confirmation
- inventory where relevant
- emergency/property contacts

### Inspection evidence

Capture condition of:

- bedroom
- bathroom
- kitchen
- walls
- floors
- windows
- doors
- meters
- utilities
- existing damage

This becomes important for later disputes and deposits.

---

# PART V — RENT & PAYMENTS

## Phase N — Rent Obligations & Payment Scheduling

**Goal:** Model money owed before integrating payment providers.

### Scope

- Lease financial terms
- Rent obligations
- Rent schedule
- advance rent
- security deposit
- service charges
- other charges
- due dates
- grace periods
- overdue status
- amount allocation
- future partial-payment support

### Obligation types

```text
RENT
RENT_ADVANCE
SECURITY_DEPOSIT
SERVICE_CHARGE
UTILITY
LATE_FEE
DAMAGE_CHARGE
OTHER
```

### Important

Do not store one unexplained payment total.

---

## Phase O — Payment Core & Ghana Payment Integration

**Goal:** Safely collect/track rent through regulated payment infrastructure.

### Scope

- PaymentIntent
- PaymentTransaction
- provider abstraction
- Mobile Money
- cards
- bank transfer where supported
- signed webhooks
- idempotency
- payment confirmation
- receipts
- failures/retries
- settlement tracking
- reconciliation
- refunds
- reversals
- external/offline payment reporting

### Provider abstraction

```text
PaymentProvider
├── create_payment()
├── verify_payment()
├── get_transaction()
├── refund()
├── get_settlement()
└── verify_webhook()
```

### Critical invariant

Never mark payment successful from:

- screenshot
- browser redirect
- frontend callback
- SMS
- client-provided status

Use authoritative server-side provider confirmation.

### Initial custody principle

Rooomly should initially avoid independently holding customer funds unless the required legal/regulatory model is established.

---

## Phase P — Rent Operations & Collections

**Goal:** Make rent management useful every month, not only at lease signing.

### Scope

- Upcoming rent
- reminders
- due
- overdue
- payment history
- landlord expected-vs-collected view
- tenant balance
- receipts
- external payment confirmation
- payment disputes
- arrears workflow
- statements
- exports
- configurable reminders
- settlement visibility

### Future

- autopay where provider supports it
- standing instructions
- partial payments
- payment plans
- automated arrears workflows

---

# PART VI — PROPERTY OPERATIONS

## Phase Q — Maintenance & Repairs

**Goal:** Create an accountable maintenance workflow between tenant and provider.

### Scope

- Maintenance request
- category
- severity
- description
- media
- assignment
- landlord/provider response
- caretaker/contractor
- estimates
- approval
- status
- completion evidence
- tenant confirmation
- costs
- invoice/reference
- notifications
- maintenance history

### Suggested lifecycle

```text
REPORTED
→ ACKNOWLEDGED
→ DIAGNOSING
→ ESTIMATE_REQUIRED
→ APPROVED
→ IN_PROGRESS
→ COMPLETED
→ CONFIRMED
→ CLOSED
```

Emergency path should be explicit.

### Future

- vendor marketplace
- multiple quotes
- service-level targets
- predictive maintenance

---

## Phase R — Inspections, Condition & Property Records

**Goal:** Maintain a reliable historical record of the physical rental.

### Scope

- Move-in inspection
- periodic inspection
- move-out inspection
- condition comparison
- photo evidence
- meter readings
- inspection scheduling
- acknowledgement
- damage attribution workflow
- property/unit history

### Future

- AI-assisted damage comparison
- automated media quality checks

---

## Phase S — Communication & Notifications

**Goal:** Keep rental communication structured without turning Rooomly into an uncontrolled chat app.

### Scope

- In-app notifications
- email
- SMS
- push notifications
- notification preferences
- tenancy conversation context
- viewing notifications
- payment notifications
- maintenance notifications
- lease notifications
- system/security notifications
- deep links
- delivery tracking where available

### Future

- approved WhatsApp integration
- communication summaries
- translation/local-language assistance

Security messages must clearly warn users never to share passwords, MoMo PINs or OTPs.

---

## Phase T — Reviews, Reputation & Rental History

**Goal:** Build useful trust history from verified interactions.

### Scope

- Verified viewing reviews
- Verified tenancy reviews
- property reviews
- landlord/provider reviews
- tenant factual rental history
- maintenance/provider reviews
- moderation
- response rights
- review disputes

### Principle

Do not create an opaque "bad tenant score."

Prefer factual signals:

```text
Identity verified
Completed tenancies
Verified platform payments
Unresolved disputes
Verified reviews
```

### Future

- portable rental history
- landlord performance indicators
- property reliability indicators

---

## Phase U — Disputes & Resolution

**Goal:** Give both parties a structured alternative to fragmented calls, chats and unsupported claims.

### Scope

- Dispute creation
- dispute categories
- tenancy/payment/maintenance/deposit linking
- evidence
- timeline
- responses
- resolution status
- internal moderation
- audit
- escalation
- outcome
- appeals where appropriate

### Possible disputes

- Payment
- deposit
- property condition
- maintenance
- lease terms
- viewing
- landlord conduct
- tenant conduct
- unauthorized fees
- property information

Rooomly should not claim to replace courts or regulators.

---

# PART VII — TRUST & SAFETY MATURITY

## Phase V — Advanced Fraud Prevention & Trust Operations

**Goal:** Mature the earlier trust foundation into a cross-platform fraud system.

### Domains

- TrustProfile
- RiskSignal
- RiskEvaluation
- FraudReport
- FraudCase
- FraudEvidence
- ModerationAction
- Restriction
- Appeal

### Fraud scenarios

- fake landlord
- fake tenant
- stolen identity
- fake property
- fake unit
- stolen media
- double renting
- fake agent
- unauthorized representative
- viewing-fee abuse
- fake payment
- payment diversion
- payout takeover
- refund abuse
- lease manipulation
- maintenance fraud
- review manipulation
- admin abuse

### Risk actions

```text
ALLOW
ALLOW_AND_MONITOR
STEP_UP_AUTHENTICATION
REQUEST_REVERIFICATION
MANUAL_REVIEW
LIMIT_ACTION
TEMPORARY_HOLD
SUSPEND_ENTITY
```

Avoid fully automated irreversible enforcement initially.

### Internal operations

- Fraud queue
- evidence management
- case assignment
- reason codes
- restrictions
- appeals
- four-eyes approvals
- immutable admin audit

---

# PART VIII — MANAGEMENT & BUSINESS PLATFORM

## Phase W — Professional Landlord & Property Management Suite

**Goal:** Expand from individual landlords into professional property operations.

### Scope

- Organizations
- team members
- portfolio management
- granular delegated permissions
- multiple properties
- bulk unit management
- tenant directory
- portfolio occupancy
- rent roll
- arrears
- maintenance operations
- statements
- exports
- operational dashboards
- accountant/manager access
- organization audit history

### Future

- bulk imports
- property-owner reporting
- management contracts
- owner statements
- commission configuration
- multi-branch organizations

---

## Phase X — Platform Administration & Operations

**Goal:** Give Rooomly staff safe operational tools.

### Scope

- Admin portal
- user support
- verification queue
- property/unit moderation
- listing moderation
- fraud cases
- disputes
- payment operations
- reconciliation
- refunds
- system configuration
- feature flags
- audit explorer
- support impersonation alternatives with strict controls
- data export/privacy requests
- operational analytics

### Internal roles

```text
SUPPORT_AGENT
CONTENT_MODERATOR
PROPERTY_VERIFIER
TRUST_SAFETY_ANALYST
FRAUD_INVESTIGATOR
PAYMENT_OPERATIONS
FINANCE_ADMIN
SECURITY_ADMIN
SUPER_ADMIN
```

No `ADMIN = GOD` architecture.

---

# PART IX — WALLET & DIGITAL COMMERCE

## Phase Y — Wallet & Ledger Ecosystem

**Goal:** Introduce stored-value capabilities only when legally and operationally justified.

### Prerequisites

Before implementation:

- regulatory analysis
- licensed partner model
- custody model
- KYC/AML requirements
- settlement design
- consumer-protection rules
- ledger review
- reconciliation design
- fraud controls

### Potential scope

- Wallet accounts
- double-entry ledger
- wallet funding
- balances
- withdrawals
- internal transfers
- transaction history
- refunds to wallet
- cashback
- rewards
- settlement accounts
- reconciliation

### Critical rule

Never implement:

```text
user.balance = 500
```

as the wallet architecture.

Use a proper ledger.

---

## Phase Z — Digital Services Marketplace

**Goal:** Make Rooomly useful beyond monthly rent while reusing the payment infrastructure.

### Airtime

- MTN
- Telecel
- AT

### Data

- daily
- weekly
- monthly
- supported corporate/data products

### TV

- DStv
- GOtv
- StarTimes

### Utilities

- ECG
- Ghana Water
- supported local levies/property-related bills

### Education vouchers

- WASSCE
- BECE
- NOVDEC
- other approved products

### Transfers

- bank transfers
- Mobile Money transfers
- future wallet transfers

### Architecture

Each service is a separate business domain using:

```text
Digital Service
      ↓
Order
      ↓
Provider Adapter
      ↓
Payment Core
      ↓
Fulfilment
      ↓
Confirmation
      ↓
Receipt
```

Provider-specific logic must remain behind adapters.

---

# PART X — FINANCIAL SERVICES

## Phase AA — Rent Financing

**Goal:** Address Ghana's upfront-rent burden without prematurely turning Rooomly into an unlicensed lender.

Potential model:

```text
Tenant
   ↓
Rooomly
   ↓
Licensed Financing Partner
   ↓
Underwriting
   ↓
Landlord receives agreed payment
   ↓
Tenant repays financing provider
```

### Potential products

- Rent Now, Pay Monthly
- rent advance financing
- emergency rent support
- salary-linked financing

### Requirements

- explicit consent
- affordability assessment
- transparent pricing
- regulated lending partner
- repayment tracking
- adverse-action/fairness considerations
- separate financing agreements
- strong fraud controls

Do not implement until legal/regulatory review is complete.

---

## Phase AB — Landlord Financial Products

Potential future capabilities:

- Property improvement financing
- maintenance financing
- rental-income advances
- insurance
- property protection products

Use regulated partners where required.

---

## Phase AC — Insurance

Potential products:

- renter protection
- landlord/property protection
- contents insurance
- rent protection
- maintenance-related cover

Architecture should use insurer/provider integrations rather than assuming Rooomly is the insurer.

---

## Phase AD — Savings & Investment Products

Long-term only.

Potential:

- tenant rent-saving goals
- deposit saving
- landlord reserve accounts
- approved investment products

Requires substantial regulatory and partner review.

---

# PART XI — DATA, ANALYTICS & INTELLIGENCE

## Phase AE — Product Analytics & Data Platform

**Goal:** Make decisions from reliable platform data.

### Scope

- Event taxonomy
- product analytics
- funnel analytics
- listing conversion
- viewing conversion
- tenancy conversion
- payment success
- retention
- maintenance response
- landlord performance
- fraud metrics
- operational metrics
- privacy-safe analytics pipeline
- warehouse/lake decision when justified

### Core funnel

```text
Search
→ Listing View
→ Viewing
→ Tenancy Request
→ Approval
→ Lease
→ Payment
→ Occupancy
→ Renewal
```

---

## Phase AF — Ghana Housing Market Intelligence

Potential capabilities:

- area rent trends
- property/unit availability
- demand by neighborhood
- vacancy patterns
- amenity premiums
- rental affordability indicators
- landlord portfolio intelligence

Data products must avoid exposing private individual information.

---

## Phase AG — Search & Recommendation Intelligence

Only after enough behavioral/inventory data exists.

Potential:

- semantic search
- personalized recommendations
- similar units
- location/landmark intelligence
- preference learning
- availability-aware ranking
- fraud/trust-aware ranking

Do not allow paid promotion to masquerade as organic recommendation.

---

## Phase AH — AI-Assisted Trust & Fraud Detection

Potential:

- duplicate property/media detection
- suspicious listing detection
- abnormal account behavior
- fraud-network analysis
- document-assistance
- risk prioritization

AI should assist investigation rather than become an unquestionable judge.

High-impact decisions require explainability and appropriate human review.

---

## Phase AI — Price & Rental Intelligence

Potential:

- comparable-rent ranges
- landlord pricing assistance
- tenant affordability context
- unusual-price detection
- market trend reporting

Avoid presenting estimates as guaranteed market value.

---

## Phase AJ — Predictive Property Operations

Potential:

- maintenance pattern detection
- likely recurring issues
- preventive maintenance reminders
- equipment/service schedules
- portfolio risk indicators

Only build where data quality supports useful predictions.

---

## Phase AK — AI Support & Rental Assistant

Potential:

- guided property search
- explanation of listing/lease information
- maintenance triage
- support assistant
- landlord workflow assistance
- document summarization
- multilingual/local-language support

AI must not fabricate legal, payment, property-verification, or contractual facts.

---

# PART XII — ECOSYSTEM EXPANSION

## Phase AL — Verified Agents & Service Marketplace

Potential:

- verified rental agents
- viewing representatives
- maintenance providers
- cleaners
- movers
- inspectors
- photographers
- property managers

Each provider needs:

- identity
- authority/qualification where applicable
- service history
- verified reviews
- dispute handling
- payments
- platform permissions

---

## Phase AM — Rooomly Viewing Partner Network

For landlords who are remote or abroad.

Partners may:

- conduct physical viewings
- verify current unit condition
- upload fresh media
- check availability
- complete standardized reports

They must not automatically gain:

- ownership rights
- rent collection authority
- lease acceptance authority
- payout access

---

## Phase AN — Developer & Institutional Inventory

Future expansion:

- apartment developers
- student housing
- large landlords
- housing organizations
- managed communities

Potential:

- bulk inventory
- availability feeds
- portfolio APIs
- organization workflows
- advanced reporting
- institutional permissions

---

## Phase AO — Partner & Public APIs

Only when internal contracts are mature.

Potential:

- property feeds
- payment integrations
- verification integrations
- partner webhooks
- service-provider APIs
- developer portal
- API keys/OAuth
- quotas/rate limits
- audit
- versioning

---

# PART XIII — SCALE, RELIABILITY & SECURITY

## Phase AP — Reliability & Observability Maturity

### Scope

- Metrics
- traces
- structured logs
- alerting
- SLOs/SLIs
- queue monitoring
- payment monitoring
- webhook monitoring
- database health
- error budgets
- incident response
- runbooks
- status page
- postmortems

---

## Phase AQ — Performance & Scale

Evolve only when evidence requires it.

```text
Modular Monolith
→ Horizontally Scaled Monolith
→ Dedicated Workers
→ Read replicas/caching where justified
→ Specialized Services
→ Selective Service Extraction
```

Potential work:

- query optimization
- caching
- CDN/media optimization
- background processing
- partitioning
- search infrastructure
- rate limiting
- autoscaling
- queue isolation
- workload separation

Do not introduce microservices merely to appear scalable.

---

## Phase AR — Disaster Recovery & Business Continuity

### Scope

- automated backups
- restore testing
- point-in-time recovery
- object storage durability
- secrets recovery
- RPO/RTO targets
- disaster runbooks
- failover strategy
- incident communications
- dependency failure plans

Payment and lease records require particularly strong recovery guarantees.

---

## Phase AS — Security Maturity

### Scope

- Threat modeling
- secure SDLC
- dependency scanning
- secret scanning
- SAST/DAST where appropriate
- penetration testing
- vulnerability management
- security headers
- API hardening
- file scanning
- encryption/key management
- privileged-access review
- security incident response
- bug-bounty/security disclosure program later

---

## Phase AT — Privacy & Data Governance

### Scope

- Ghana Data Protection Act-oriented controls
- GDPR readiness
- consent
- data minimization
- retention schedules
- deletion/anonymization
- subject access/export
- purpose limitation
- internal access controls
- sensitive-data classification
- vendor/data-processing inventory

Never claim legal compliance solely because technical controls exist.

---

# PART XIV — COMMERCIALIZATION

## Phase AU — Subscription & Monetization

Rooomly should remain useful before forcing payment.

Potential monetization:

### Free

- Basic property/unit management
- Limited listings
- Tenant management
- Basic lease/rent records
- Basic maintenance
- Core tenant experience

### Paid landlord tiers

Potential:

- More properties/units
- advanced reporting
- team members
- automation
- bulk operations
- premium listing tools
- advanced analytics
- exports
- branded documents
- priority support

### Transaction revenue

Potential:

- payment processing revenue share
- digital-service commissions
- partner-service commissions
- marketplace services

### Future financial revenue

Only where legally permitted:

- financing referral/revenue share
- insurance commissions
- financial-product partnerships

Avoid paywalls that weaken core trust or safety.

Never sell verification credibility.

---

## Phase AV — Rewards & Referrals

Potential:

- tenant referrals
- landlord referrals
- legitimate promotional credits
- cashback through approved structures
- loyalty benefits

Requires:

- anti-abuse rules
- referral attribution
- caps
- fraud detection
- transparent expiry/terms

---

# PART XV — GROWTH & MARKET EXPANSION

## Phase AW — Ghana Market Expansion

Initial focus should prove product-market fit before nationwide expansion.

Potential rollout:

```text
Kumasi
→ Accra
→ other major Ghanaian markets
→ nationwide
```

Actual rollout should follow evidence, not this sequence blindly.

Localize:

- supply acquisition
- verification operations
- support
- viewing partners
- payment behavior
- neighborhood/landmark data

---

## Phase AX — International Readiness

Do not treat international expansion as an early product phase.

Prepare architecture through:

- explicit currency
- timezone handling
- locale
- provider abstractions
- configurable legal/business rules
- data residency awareness
- country-specific verification
- feature flags

Expansion occurs only after Ghana is working exceptionally well.

---

# PART XVI — CONTINUOUS PRODUCT QUALITY

## Phase AY — Design System & Experience Maturity

This is continuous, but receives dedicated investment.

### Scope

- shared design language
- web/mobile tokens
- typography
- color
- spacing
- icons
- motion
- forms
- navigation
- property media
- maps
- status patterns
- payment patterns
- verification patterns
- accessibility
- responsive behavior
- dark/light support only if product strategy supports it

### Quality principle

Premium means:

> Intentionality, clarity, restraint, consistency, speed and exceptional interaction quality.

Not excessive gradients/cards/animation.

---

## Phase AZ — Long-Term Platform Evolution

This phase never truly ends.

Potential future evolution:

- selective service extraction
- dedicated payments infrastructure
- dedicated search infrastructure
- dedicated fraud/risk infrastructure
- ML inference services
- event streaming when justified
- advanced data platform
- institutional APIs
- partner ecosystem
- new regulated products
- additional markets

Every extraction or major architecture change must be justified by measurable needs such as:

- scale
- security
- regulation
- independent deployment
- workload isolation
- team ownership

---

# Cross-Cutting Workstreams

These are not "later phases." They apply throughout the roadmap.

## Security

Every phase must consider:

- authentication
- authorization
- object permissions
- PII
- secrets
- rate limiting
- secure uploads
- audit
- abuse
- fraud
- dependency security

## Design

Every user-facing phase must include:

- UX flow
- mobile-first design
- responsive web
- loading
- empty
- success
- error
- accessibility
- perceived performance
- interaction polish

## Testing

Every phase must add appropriate:

- unit tests
- service/domain tests
- API tests
- permission tests
- integration tests
- frontend tests
- mobile tests
- end-to-end tests
- security/adversarial tests

## Audit

High-value state changes must record:

```text
who
what
when
target
before/after where appropriate
reason
request/session context where appropriate
```

## Events

Use the existing transactional outbox for reliable domain events.

## Documentation

Update:

- `docs/phases.md`
- `docs/status.md`
- architecture docs
- ADRs
- API documentation
- data model documentation
- README where appropriate

---

# Recommended Product Dependency Chain

The platform should broadly evolve through this dependency chain:

```text
FOUNDATION
   ↓
IDENTITY + PERMISSIONS
   ↓
TRUST FOUNDATION
   ↓
PROPERTY
   ↓
UNIT
   ↓
DISTRIBUTION / LISTING
   ↓
DISCOVERY
   ↓
VIEWING / INVITATION
   ↓
TENANCY REQUEST
   ↓
TENANCY
   ↓
LEASE
   ↓
RENT OBLIGATIONS
   ↓
PAYMENT
   ↓
OCCUPANCY
   ↓
MAINTENANCE / INSPECTION
   ↓
REVIEWS / DISPUTES
   ↓
PROFESSIONAL MANAGEMENT
   ↓
ADVANCED TRUST & FRAUD
   ↓
WALLET
   ↓
DIGITAL SERVICES
   ↓
FINANCIAL SERVICES
   ↓
DATA / AI INTELLIGENCE
   ↓
ECOSYSTEM / PARTNERS
   ↓
SCALE / EXPANSION
```

Some workstreams can proceed in parallel, but later domains must not bypass required foundations.

---

# Major Domain Map

```text
Identity & Access
├── Users
├── Profiles
├── Authentication
├── Permissions
└── Organizations

Trust & Safety
├── Identity Verification
├── Property Authority
├── Property Verification
├── Unit Verification
├── Risk
├── Fraud
├── Moderation
└── Appeals

Rental Supply
├── Properties
├── Units
├── Amenities
├── Media
├── Locations
└── Listings

Tenant Acquisition
├── Search
├── Discovery
├── Viewings
├── Invitations
├── Existing Tenant Onboarding
└── Tenancy Requests

Rental Relationship
├── Tenancy
├── Lease
├── Occupancy
├── Inspections
├── Maintenance
├── Reviews
└── Disputes

Financial Core
├── Obligations
├── Payments
├── Transactions
├── Ledger
├── Settlements
├── Refunds
└── Reconciliation

Digital Ecosystem
├── Wallet
├── Airtime
├── Data
├── TV
├── Utilities
├── Vouchers
└── Transfers

Financial Services
├── Rent Financing
├── Landlord Financing
├── Credit
├── Insurance
├── Savings
└── Investments

Intelligence
├── Analytics
├── Search Intelligence
├── Recommendations
├── Fraud Intelligence
├── Price Intelligence
└── AI Assistance
```

---

# Phase Completion Gate

A phase is not complete merely because code exists.

Before marking a phase complete:

## Product

- User problem is clearly solved.
- Flow works end-to-end.
- No major dead ends.

## Architecture

- Domain boundaries respected.
- No unnecessary coupling.
- New decisions documented.

## Backend

- Validation works.
- permissions work.
- transactions are safe.
- errors are explicit.
- APIs are documented.

## Web

- Integrated.
- responsive.
- accessible.
- loading/error/empty/success states implemented.

## Mobile

- Integrated where phase requires mobile.
- Android tested.
- low-bandwidth behavior considered.
- navigation and deep links work.

## Security

- Threats reviewed.
- object permissions tested.
- rate limits considered.
- audit exists.
- sensitive information protected.

## Testing

- Relevant unit/integration/API/permission/E2E tests pass.
- Regression tests added for discovered bugs.

## Operations

- Logging exists.
- important failures observable.
- migrations safe.
- rollback/recovery considered.

## Documentation

- Roadmap/status updated.
- architecture docs updated.
- known limitations documented.

---

# Release Packaging

When milestone packaging is required:

```text
rooomly-phase-XX-name-vX.Y.Z.zip
```

The package should contain the complete project at that point, not only changed files.

Each completion report should state:

- Implemented
- Tested
- Partially implemented
- Mocked/stubbed
- Externally dependent
- Deferred
- Known limitations
- Regulatory/legal dependencies
- How to run
- Migration instructions
- Next recommended phase

Never claim production readiness without evidence.

---

# Non-Negotiable Architectural Invariants

1. Inspect existing code and documentation before modifying the system.
2. Property authority is separate from identity verification.
3. A property must be verified before its units can be submitted for verification.
4. A unit must be verified before public listing or prospective-tenant invitation.
5. Unit verification, listing state, availability and occupancy remain separate.
6. Direct invitation does not equal tenancy.
7. Public tenancy request and landlord invitation are separate workflows.
8. Existing tenant onboarding is separate from prospective tenant acquisition.
9. Viewing representatives receive least-privilege permissions.
10. Accepted leases are immutable; changes use amendments.
11. Conflicting exclusive occupancies/leases must be prevented.
12. Money uses precise monetary types, never binary floating point.
13. Payment success requires authoritative server-side confirmation.
14. Offline payments remain distinguishable from PSP-confirmed payments.
15. Financial history is append-oriented and auditable.
16. Wallets require a proper ledger, not a balance field.
17. High-risk admin actions are explicitly permissioned and audited.
18. Fraud reports do not automatically prove wrongdoing.
19. AI does not make unexplained irreversible high-impact decisions.
20. Regulated financial capabilities are not launched without appropriate legal/regulatory/partner validation.
21. Mobile is a first-class product surface.
22. UX, accessibility, security, performance and testing are part of every phase.
23. Microservices are introduced only when justified.
24. Ghana remains the primary product context until expansion is strategically justified.
25. Rooomly must remain useful both as a **rental marketplace** and as a **property/rental management platform**.

---

# North-Star Product Journey

## Tenant sourced through Rooomly

```text
Discover Unit
→ Review Trust Information
→ Virtual/Physical Viewing
→ Request Tenancy
→ Provider Approval
→ Lease
→ Payment
→ Move-In
→ Rent Management
→ Maintenance
→ Renewal / Move-Out
→ Verified Rental History
```

## Tenant already known to landlord

```text
Private Verified Unit
→ Invite Tenant
→ Tenant Reviews
→ Accept
→ Tenancy
→ Lease
→ Payment
→ Occupancy
→ Ongoing Management
```

## Existing tenant

```text
Occupied Unit
→ Add Existing Tenant
→ Tenant Confirms
→ Existing Tenancy Imported
→ Lease/Terms Recorded
→ Rent Management
→ Maintenance
→ Renewal / Move-Out
```

## Long-term ecosystem

```text
Rental Relationship
      ↓
Trusted Payments
      ↓
Wallet / Digital Services
      ↓
Rent Financing / Insurance
      ↓
Housing Intelligence
      ↓
Ghana Digital Housing Infrastructure
```

---

# Final Product Direction

Rooomly is not merely:

> a website where landlords post houses.

It should mature into:

> **A trusted digital operating system for renting, managing housing, and accessing housing-related services in Ghana.**

The development priority remains:

```text
Solve Rental Trust
      ↓
Solve Rental Workflow
      ↓
Solve Property Operations
      ↓
Solve Rent & Payments
      ↓
Build Reliable Financial Infrastructure
      ↓
Add Useful Digital Services
      ↓
Add Regulated Financial Products
      ↓
Use Data & AI to Improve the Ecosystem
```

Future capabilities should never distract from making the core rental experience trustworthy, simple, transparent, and exceptionally well designed.
