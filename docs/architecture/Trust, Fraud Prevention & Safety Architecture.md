# Rooomly Trust, Fraud Prevention & Safety Architecture

## Status

**Planned / Core Platform Architecture**

This document defines the fraud-prevention, trust, verification, investigation, and enforcement architecture for Rooomly.

Rooomly is a **property management and rental SaaS platform** that supports:

- Property owners
- Landlords
- Property managers
- Caretakers
- Viewing representatives
- Agents
- Tenants
- Public rental listings
- Private tenant invitations
- Existing tenant onboarding
- Viewings
- Tenancy
- Leases
- Rent payments
- Maintenance
- Reviews
- Future digital financial services

Because Rooomly facilitates relationships between people who may never have met before, trust cannot be treated as a simple `verified = true` field.

Trust & Safety must be a shared platform domain.

---

# 1. Architecture Objective

The fraud architecture must answer four questions for every important action:

```text
IDENTITY
"Who is this person?"
        ↓
AUTHORITY
"Are they allowed to perform this action?"
        ↓
LEGITIMACY
"Does this action appear genuine?"
        ↓
EVIDENCE
"Can Rooomly prove what happened later?"
```

The system should:

- Prevent obvious fraud before it occurs.
- Detect suspicious behaviour.
- Increase verification when risk increases.
- Preserve evidence.
- Allow users to report suspicious activity.
- Give internal staff investigation tools.
- Prevent administrators from abusing privileged access.
- Keep important actions auditable.
- Avoid blocking legitimate users unnecessarily.

---

# 2. Core Principles

## 2.1 Verification Is Contextual

Never use:

```text
user.is_verified = true
```

as the universal definition of trust.

Instead maintain independent verification dimensions:

```text
Identity Verification
Phone Verification
Email Verification
Property Authority Verification
Property Verification
Unit Verification
Representative Authorization
Payment Destination Verification
Tenant History
Lease History
Payment History
```

A user can therefore be:

```text
Identity: VERIFIED
Property Authority: UNVERIFIED
Phone: VERIFIED
Payout Destination: PENDING
```

This is more accurate and safer than a single blue badge.

---

# 3. Trust & Safety Bounded Context

Create a dedicated shared domain:

```text
trust_safety/
├── identity/
├── verification/
├── property_authority/
├── risk/
├── reports/
├── fraud_cases/
├── evidence/
├── moderation/
├── restrictions/
├── appeals/
├── device_security/
├── audit/
└── services/
```

This domain should serve:

```text
Identity
Property
Units
Listings
Viewing
Tenant Invitation
Tenancy
Lease
Payments
Maintenance
Reviews
Admin
Future Wallet
Future Digital Services
```

Do not bury fraud logic independently inside each feature.

---

# 4. High-Level Architecture

```text
                           ROOOMLY
                              │
        ┌─────────────────────┼──────────────────────┐
        │                     │                      │
        ↓                     ↓                      ↓
    IDENTITY               PROPERTY              PAYMENTS
        │                     │                      │
 Phone / Email          Authority / Unit       PSP / Settlement
 MFA / Devices          Verification            Ledger / Refund
        │                     │                      │
        └─────────────────────┼──────────────────────┘
                              ↓
                       TRUST & SAFETY
                              │
              ┌───────────────┼────────────────┐
              ↓               ↓                ↓
         RISK SIGNALS      USER REPORTS    PLATFORM RULES
              │               │                │
              └───────────────┼────────────────┘
                              ↓
                          FRAUD CASE
                              ↓
                         INVESTIGATION
                              ↓
                          DECISION
                              ↓
                ┌─────────────┼─────────────┐
                ↓             ↓             ↓
              ALLOW        RESTRICT      SUSPEND
                              ↓
                           AUDIT LOG
```

---

# 5. Major Fraud Categories

Rooomly should explicitly model fraud scenarios.

## Identity Fraud

Examples:

- Fake identity
- Stolen identity
- Multiple deceptive accounts
- Account takeover
- Impersonation
- Fake landlord
- Fake tenant
- Fake agent

---

## Property Fraud

Examples:

- Listing someone else's property
- Fake property
- Fake unit
- Duplicate unit
- Stolen property photos
- Wrong property location
- False amenities
- False availability
- Listing an already occupied unit
- Unauthorized property management

---

## Rental Fraud

Examples:

- Renting the same unit to multiple tenants
- Fraudulent viewing fees
- Fake tenancy invitations
- Fake lease
- Lease terms changed after acceptance
- False deposits
- Fake tenant applications
- Fake rental history

---

## Payment Fraud

Examples:

- Fake Mobile Money confirmation
- Forged screenshots
- Payment diversion
- Payout account takeover
- Refund abuse
- Duplicate payment manipulation
- Chargeback abuse
- False offline payment claims
- Settlement manipulation

---

## Platform Abuse

Examples:

- Review manipulation
- Fake complaints
- Harassment
- Spam
- Invitation abuse
- Viewing no-show abuse
- Account farming
- Scraping private addresses
- Referral abuse
- Promo abuse

---

## Internal Fraud

Examples:

- Admin changing verification records
- Unauthorized refunds
- Admin payout changes
- Deleting evidence
- Manipulating fraud cases
- Changing lease/payment history
- Improper account recovery

---

# 6. User Identity Verification

Create:

```text
IdentityVerification
```

Suggested fields:

```text
id
user_id
verification_type
provider
status
risk_level
submitted_at
verified_at
expires_at nullable
failure_reason nullable
metadata
created_at
updated_at
```

Statuses:

```text
NOT_STARTED
PENDING
REVIEW_REQUIRED
VERIFIED
FAILED
EXPIRED
REVOKED
```

Never automatically treat identity verification as proof of property ownership.

---

# 7. Phone & Email Verification

Phone and email should have independent records.

```text
ContactVerification
```

Suggested:

```text
user_id
channel
destination_hash
verified_at
verification_method
risk_level
```

Phone verification is especially important for:

- Tenant invitations
- Landlord communication
- Payment alerts
- Account recovery
- Viewing codes

---

# 8. Account Security

Protect accounts from takeover.

Support:

- Secure sessions
- Session revocation
- Password reset controls
- Device history
- Login history
- MFA
- Step-up authentication
- Suspicious-login alerts

High-risk actions should require stronger authentication.

Examples:

```text
Change payout account
Change recovery phone
Property ownership transfer
Large refund
Add privileged representative
Change financial beneficiary
Disable MFA
```

---

# 9. Device & Session Risk

Create:

```text
DeviceSession
```

Track appropriate security metadata such as:

```text
device_id
user_id
first_seen_at
last_seen_at
approximate_location
ip_risk
trusted_device
session_risk
```

Potential signals:

```text
New device
Impossible travel pattern
Rapid country change
Many accounts using same device
Repeated failed logins
Unusual session activity
```

Do not use approximate location alone to make irreversible decisions.

---

# 10. Property Authority Verification

Property authority and identity must be separate.

Create:

```text
PropertyAuthorityClaim
```

Suggested roles:

```text
OWNER
CO_OWNER
PROPERTY_MANAGER
AUTHORIZED_REPRESENTATIVE
CARETAKER
VIEWING_REPRESENTATIVE
```

Suggested fields:

```text
id
property_id
user_id
authority_type
status
valid_from
valid_until nullable
verified_at nullable
verification_case_id
granted_by nullable
created_at
updated_at
```

States:

```text
PENDING
VERIFIED
LIMITED
DISPUTED
REVOKED
EXPIRED
REJECTED
```

---

# 11. Authority Is Permission-Specific

Do not assume that because someone manages a property, they can do everything.

Examples:

```text
PROPERTY OWNER
✓ Edit property
✓ Create units
✓ Create lease
✓ Manage financial destination
✓ Assign representative
```

```text
PROPERTY MANAGER
✓ Edit approved fields
✓ Manage units
✓ Handle tenancy
? Lease authority based on grant
✗ Ownership transfer
```

```text
VIEWING REPRESENTATIVE
✓ Manage viewing
✓ Check in tenant
✓ Complete viewing
✗ Change rent
✗ Create lease
✗ Receive rent
✗ Change payout details
```

Use explicit grants.

---

# 12. Property Verification

Suggested entity:

```text
PropertyVerification
```

Verification should potentially include:

```text
Identity of claimant
Authority evidence
Location evidence
Property media
Property details
Human review
Historical fraud signals
```

Statuses:

```text
NOT_SUBMITTED
PENDING
NEEDS_MORE_INFORMATION
UNDER_REVIEW
VERIFIED
REJECTED
SUSPENDED
REVOKED
```

Store:

```text
verified_at
verification_method
verification_version
verified_by
last_reviewed_at
risk_level
```

---

# 13. Property Reverification

Verification should not necessarily last forever.

Trigger reverification when:

```text
Authority changes
Ownership disputed
Major property data changes
Multiple fraud reports
Long period since verification
High-risk account activity
Suspicious media replacement
```

Risk engine event:

```text
PropertyReverificationRequired
```

---

# 14. Unit-Level Verification

A verified property does not automatically mean every unit is valid.

Flow:

```text
PROPERTY VERIFIED
      ↓
UNIT CREATED
      ↓
UNIT INFORMATION
      ↓
UNIT PHOTOS
      ↓
AMENITIES
      ↓
SUBMITTED FOR REVIEW
      ↓
VERIFIED
```

Until verification:

```text
Cannot Publish
Cannot Invite Tenant
Cannot Accept Tenancy
```

---

# 15. Fake Unit Prevention

Potential controls:

- Unit photo requirements
- Unit media fingerprinting
- Duplicate-unit checks
- Comparison with existing property units
- Moderation review
- Property capacity anomaly detection

Example risk rule:

```text
Property has 4 known units
User creates 25 new units in one hour
        ↓
REVIEW REQUIRED
```

---

# 16. Media Fraud Prevention

Create:

```text
MediaFingerprint
```

Store:

```text
media_id
sha256_hash
perceptual_hash
property_id
unit_id
uploaded_by
uploaded_at
risk_state
```

Compare uploaded images against:

- Existing Rooomly properties
- Existing units
- Previously removed fraudulent content

Potential signals:

```text
Same image across unrelated properties
Same room claimed by different owners
Heavily reused media
Previously banned media
```

AI may later assist detection but should not be the sole decision-maker.

---

# 17. Listing Fraud

A listing should only be created from an eligible verified unit.

Required:

```text
Property verified
Unit verified
Authority active
Unit available
No conflicting tenancy
```

Listing publication should fail if any required invariant is missing.

---

# 18. Double-Rental Prevention

This is a critical invariant.

Suggested unit lifecycle:

```text
AVAILABLE
      ↓
TENANCY_APPROVED
      ↓
RESERVED
      ↓
LEASE_PENDING
      ↓
AWAITING_PAYMENT
      ↓
OCCUPIED
```

Prevent overlapping exclusive occupancies.

At database/service level ensure a unit cannot have:

```text
Two active leases
Two active occupancies
Conflicting reservation periods
```

for the same exclusive rental period.

Do not rely only on frontend controls.

---

# 19. Tenant Invitation Fraud

Invitation must be:

- Created by authorized user
- Bound to one unit
- Expiring
- Revocable
- Auditable
- Securely tokenized
- Rate limited

Potential fraud:

```text
Malicious landlord sends thousands of invitations.
```

Controls:

```text
Rate limits
Account reputation
Invitation quotas
Abuse monitoring
Recipient blocking
Report invitation
```

---

# 20. Existing Tenant Onboarding Fraud

A landlord might falsely claim:

> This person already rents from me.

Therefore:

```text
ExistingTenantOnboarding
```

should have states:

```text
LANDLORD_REPORTED
TENANT_NOTIFIED
TENANT_CONFIRMED
TENANT_DISPUTED
ADMIN_REVIEW_REQUIRED
```

Landlord claims must not automatically become mutually accepted facts.

---

# 21. Viewing Fraud

Potential scams:

- Fake property
- Fake viewing representative
- Fake viewing fees
- No-show fraud
- Exact-address harvesting
- Representative demanding cash

Use:

```text
ViewingAppointment
ViewingRepresentative
ViewingCode
ViewingCheckIn
ViewingOutcome
```

---

# 22. Viewing Representative Identity

Tenant should see:

```text
Ama Boateng

✓ Rooomly Viewing Representative

Authorized:
✓ Conduct viewing
✓ Confirm attendance

Not Authorized:
✗ Collect rent
✗ Change lease
✗ Receive security deposit
```

This should be visible inside the viewing UI.

---

# 23. Viewing Check-In

Confirmed viewing:

```text
Appointment
      ↓
Temporary Code
      ↓
Tenant Arrives
      ↓
Representative Enters Code
      ↓
CHECKED_IN
```

Code:

- Short-lived
- Single-use
- Appointment-bound
- Rate-limited
- Audited

Later add QR.

---

# 24. Exact Location Protection

Public users should not necessarily receive exact addresses.

Possible levels:

```text
APPROXIMATE_PUBLIC
CONFIRMED_VIEWING
APPROVED_TENANT
PRIVATE
```

Public:

```text
Ayeduase, Kumasi
Near KNUST
```

Confirmed viewing:

```text
Exact location unlocked
```

This reduces unauthorized visits, scraping, bypassing, and security risks.

---

# 25. Viewing Fee Abuse

Recommended initial policy:

```text
Platform Viewing Fee = FREE
```

Representatives should not arbitrarily collect undocumented fees.

If Rooomly ever supports paid viewing services:

- Fee created by platform
- Amount displayed beforehand
- Receipt generated
- Collection through official payment infrastructure
- Refund policy available
- Representative cannot modify amount

---

# 26. Lease Fraud Prevention

Accepted leases must become immutable versions.

Flow:

```text
LEASE VERSION 4
      ↓
Landlord Accepts
      ↓
Tenant Accepts
      ↓
Snapshot
      ↓
Immutable
```

Future changes:

```text
Lease Amendment #1
```

Do not update the accepted lease silently.

Record:

```text
version
accepted_by
accepted_at
document_hash
terms_snapshot
```

---

# 27. Financial-Term Manipulation

Once accepted, financial terms should not be editable without amendment.

Protect:

```text
rent
deposit
advance
fees
payment schedule
due dates
```

If terms change:

```text
Old terms preserved
       ↓
Amendment created
       ↓
Both parties review
       ↓
Both accept
```

---

# 28. Payment Fraud Prevention

Never trust:

```text
Screenshot
Frontend success message
Client transaction reference
SMS text
```

Payment success must come from authoritative server-side verification.

```text
PaymentIntent
      ↓
Licensed PSP
      ↓
Payment
      ↓
Verified Webhook
      ↓
Transaction
      ↓
Ledger
      ↓
PAID
```

---

# 29. External Payment Fraud

Offline/direct payment may be supported separately.

Example:

```text
Landlord reports:
Tenant paid GHS 1,500 cash
```

States:

```text
REPORTED
TENANT_CONFIRMED
TENANT_DISPUTED
ADMIN_REVIEWED
```

Never display an offline payment as:

```text
PSP VERIFIED
```

---

# 30. Payment Destination Fraud

Changing a landlord payout destination is high-risk.

Flow:

```text
Request Change
      ↓
Step-Up Authentication
      ↓
Verify New Destination
      ↓
Risk Assessment
      ↓
Notify Existing Contact
      ↓
Cooling Period if appropriate
      ↓
Activate
```

Store old destinations.

Never overwrite history.

---

# 31. Payment-Destination Change Alerts

Notify via existing trusted channels:

```text
Your Rooomly payout destination was changed.
```

Include:

- Date/time
- New destination masked
- Device information where appropriate
- "Secure my account" action

---

# 32. Deposit Fraud

Security deposits should be separate obligations.

Never:

```text
Payment = GHS 5,000
```

without breakdown.

Use:

```text
GHS 3,500 → RENT
GHS 1,500 → SECURITY_DEPOSIT
```

This improves:

- Refund handling
- Dispute handling
- Accounting
- Evidence

---

# 33. Move-In Inspection Fraud Prevention

Before occupancy:

```text
MOVE-IN INSPECTION
```

Capture:

- Rooms
- Doors
- Windows
- Walls
- Floors
- Bathroom
- Kitchen
- Meter state
- Utilities
- Existing damage
- Photos
- Timestamp
- Participant confirmation

---

# 34. Move-Out Comparison

```text
MOVE-IN CONDITION
        ↓
      COMPARE
        ↓
MOVE-OUT CONDITION
```

Use this for:

- Deposit disputes
- Damage claims
- Maintenance responsibility
- Evidence

---

# 35. Maintenance Fraud

Potential examples:

- Fake repair
- Inflated quote
- Fake invoice
- Contractor collusion
- Repair never performed

Flow:

```text
Maintenance Request
      ↓
Diagnosis
      ↓
Estimate
      ↓
Approval
      ↓
Work
      ↓
Completion Evidence
      ↓
Tenant / Manager Confirmation
      ↓
Invoice
      ↓
Payment
```

Higher-value repairs may later require:

```text
Multiple quotes
Additional approval
```

---

# 36. Review Fraud

Reviews should be tied to verified interactions.

Possible eligibility:

```text
Completed Viewing
→ Viewing Review

Completed Tenancy
→ Property / Landlord / Tenant Review

Completed Maintenance
→ Provider Review
```

Mark:

```text
✓ Verified Tenancy Review
```

Prevent:

- Anonymous review spam
- Duplicate reviews
- Review farming
- Users reviewing themselves
- Paid account overriding negative reviews

---

# 37. Fraud Reporting

Every major entity should support:

```text
Report
```

Possible targets:

```text
User
Property
Unit
Listing
Viewing
Representative
Invitation
Tenancy
Lease
Payment
Review
Maintenance Provider
```

---

# 38. Fraud Report Entity

Create:

```text
FraudReport
```

Suggested:

```text
id
reporter_user_id
target_type
target_id
reason_code
description
severity
status
created_at
updated_at
```

Reason codes:

```text
FAKE_PROPERTY
FAKE_OWNER
FAKE_UNIT
STOLEN_PHOTOS
PAYMENT_SCAM
FAKE_AGENT
VIEWING_FEE_ABUSE
HARASSMENT
DOUBLE_RENTING
FAKE_REVIEW
ACCOUNT_TAKEOVER
OTHER
```

---

# 39. Reports Should Not Automatically Convict

Flow:

```text
Report
   ↓
Risk Signal
   ↓
Fraud Case
   ↓
Investigation
   ↓
Decision
```

Multiple reports can increase priority, but reports alone should not automatically prove guilt.

---

# 40. Fraud Case Domain

Create:

```text
FraudCase
```

Suggested fields:

```text
id
case_number
primary_target_type
primary_target_id
case_type
severity
risk_score
status
assigned_to
opened_at
resolved_at nullable
resolution_code nullable
created_at
updated_at
```

Statuses:

```text
OPEN
TRIAGED
INVESTIGATING
WAITING_FOR_INFORMATION
ACTION_REQUIRED
RESOLVED
CLOSED
APPEALED
```

---

# 41. Evidence

Create:

```text
FraudEvidence
```

Possible evidence:

- Uploaded documents
- Property media
- Unit photos
- Payment records
- Provider references
- Lease versions
- Messages
- Viewing records
- Inspection records
- Device/security events
- User reports
- Admin notes

Store evidence integrity metadata where appropriate.

---

# 42. Evidence Must Be Immutable

Do not allow investigators to silently replace evidence.

Use:

```text
Evidence v1
Evidence v2
```

or append-only records.

Record:

```text
uploaded_by
created_at
hash
source
case_id
```

---

# 43. Risk Signals

Create:

```text
RiskSignal
```

Suggested fields:

```text
id
subject_type
subject_id
signal_type
severity
score
source
metadata
observed_at
expires_at nullable
resolved_at nullable
```

Examples:

```text
PROPERTY_MEDIA_DUPLICATE
HIGH_PROPERTY_CREATION_RATE
PAYOUT_DESTINATION_CHANGED
MULTIPLE_FRAUD_REPORTS
UNUSUAL_LOGIN
MULTIPLE_FAILED_PAYMENT_ATTEMPTS
MULTIPLE_ACCOUNTS_SAME_DEVICE
DOUBLE_LEASE_ATTEMPT
HIGH_INVITATION_VOLUME
```

---

# 44. Risk Engine

Create a risk-assessment service.

Concept:

```text
Risk Signals
      ↓
Risk Rules
      ↓
Risk Evaluation
      ↓
Decision Recommendation
```

Example:

```text
New landlord
+ newly verified account
+ creates 18 properties in 20 minutes
+ reused property photos
+ changes payout destination
+ receives 3 reports
--------------------------------
HIGH RISK
```

---

# 45. Risk Levels

Use understandable levels:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Do not expose internal risk scoring unnecessarily to end users.

---

# 46. Risk Actions

The risk engine should recommend actions such as:

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

Initially, humans should review high-impact decisions.

---

# 47. Avoid Fully Automated Permanent Bans Initially

Risk scoring can be wrong.

Do not automatically permanently ban a landlord simply because:

```text
risk_score > 80
```

Use human investigation for important enforcement decisions.

Automation may safely handle actions such as:

```text
Rate limiting
Temporary lock
Reauthentication
Requesting verification
Pausing publication
```

---

# 48. Moderation Actions

Create:

```text
ModerationAction
```

Possible actions:

```text
NO_ACTION
WARNING
CONTENT_REMOVAL
REVERIFY
LIMIT_INVITATIONS
PAUSE_LISTING
PAUSE_UNIT
PAUSE_PROPERTY
RESTRICT_PAYMENTS
RESTRICT_PAYOUTS
ACCOUNT_LIMITATION
TEMPORARY_SUSPENSION
PERMANENT_REMOVAL
```

---

# 49. Entity-Level Restrictions

Do not always suspend an entire user.

You may only need to restrict:

```text
One listing
One property
Payout changes
Tenant invitations
Payment collection
Messaging
```

Create:

```text
Restriction
```

with:

```text
subject_type
subject_id
restriction_type
reason
starts_at
ends_at nullable
case_id
```

---

# 50. Appeal Architecture

Users should have a way to challenge significant enforcement actions.

Create:

```text
Appeal
```

Flow:

```text
Action Taken
      ↓
User Notified
      ↓
Appeal Submitted
      ↓
Different Reviewer
      ↓
Decision
```

Keep the original decision history.

---

# 51. Admin Architecture

Do not use:

```text
ADMIN = unlimited authority
```

Separate internal roles.

Examples:

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

---

# 52. Least Privilege for Admins

Example:

```text
PROPERTY_VERIFIER
✓ Review property evidence
✓ Approve/reject verification
✗ Refund payment
✗ Change payout destination
```

```text
PAYMENT_OPERATIONS
✓ Investigate transaction
✓ Reconcile payment
✗ Verify ownership
✗ Delete property
```

---

# 53. Four-Eyes Approval

Critical actions should require two people.

Examples:

```text
Large refund
Payout override
Ownership transfer override
Manual ledger adjustment
High-value settlement change
Permanent account restoration
High-risk fraud-case closure
```

Flow:

```text
Admin A → Requests
Admin B → Approves
```

Admin A cannot approve their own request.

---

# 54. Admin Audit Log

Every privileged action should record:

```text
actor
role
action
target
before_state
after_state
reason
case_reference
timestamp
```

Admin audit events must be difficult to alter or delete.

---

# 55. Audit Architecture

Use the existing append-only audit architecture.

Important fraud-related events:

```text
IdentityVerified
PropertyAuthorityGranted
PropertyVerificationApproved
UnitVerificationApproved
RepresentativeAssigned
PayoutDestinationChanged
LeaseAccepted
LeaseAmended
PaymentConfirmed
RefundRequested
RefundApproved
FraudReportCreated
FraudCaseOpened
RestrictionApplied
RestrictionRemoved
AdminOverridePerformed
```

---

# 56. Fraud Event Bus

Trust & Safety should consume relevant domain events.

Examples:

```text
UserRegistered
LoginSucceeded
LoginFailed
PropertyCreated
PropertyVerificationSubmitted
UnitCreated
UnitPublished
ViewingRepresentativeAssigned
InvitationSent
TenancyApproved
LeaseAccepted
PaymentIntentCreated
PaymentSucceeded
PayoutChanged
RefundRequested
ReviewSubmitted
```

These events become inputs for risk evaluation.

---

# 57. Example Event Flow

```text
PayoutDestinationChanged
       ↓
Outbox
       ↓
Risk Engine
       ↓
Risk Signal Created
       ↓
Step-Up Authentication Required
       ↓
Notification Sent
       ↓
Monitoring Period
```

---

# 58. Trust Profile

Create an internal aggregate:

```text
TrustProfile
```

This should not necessarily be one public numeric score.

It aggregates:

```text
Identity state
Property authority
Property verification
Unit verification
Account history
Fraud history
Payment history
Tenancy history
Risk signals
Restrictions
```

---

# 59. Public Trust Center

Instead of:

```text
✓ Verified
```

show meaningful verification.

Example:

## Trust & Verification

```text
✓ Provider identity verified
✓ Property authority verified
✓ Property reviewed
✓ Unit reviewed
✓ Payment through Rooomly supported
✓ 6 verified tenancies

Last property review:
July 2026
```

This is more transparent and useful.

---

# 60. Trust Badge Rules

Do not manually allow marketing/admin teams to assign trust badges.

Badges should come from verified platform states.

Example:

```text
PROPERTY_VERIFIED
```

badge requires:

```text
PropertyVerification.status == VERIFIED
```

not:

```text
admin clicks blue badge
```

---

# 61. Messaging Safety

Potential scams occur through messaging.

Consider:

- Rate limits
- Report conversation
- Block user
- Suspicious link detection
- Warnings around payments
- Attachment scanning

Prominent message:

> Never share your MoMo PIN, OTP, password, or account recovery code with another Rooomly user.

---

# 62. Payment Messaging Warnings

If users discuss external payment instructions, consider contextual warnings.

Example:

> Only payments confirmed through Rooomly appear as platform-verified payments.

Do not automatically read or classify sensitive conversations without an explicit privacy and governance policy.

---

# 63. Data Protection

Fraud prevention does not mean collecting unlimited personal data.

Principles:

```text
Collect only necessary data
Restrict access
Encrypt sensitive data
Define retention periods
Log administrative access
Separate operational and analytics access
Redact secrets from logs
```

---

# 64. Fraud Analytics Dashboard

Internal dashboard should show:

```text
Open Fraud Cases
High-Risk Accounts
Suspicious Properties
Duplicate Media
Payment Alerts
Payout Changes
Listing Reports
Viewing Abuse
Invitation Abuse
Admin Alerts
```

---

# 65. Case Queue

Prioritize:

```text
CRITICAL
HIGH
MEDIUM
LOW
```

Example:

```text
CRITICAL:
Potential active payment diversion

HIGH:
Potential fake landlord collecting rent

MEDIUM:
Duplicate property media

LOW:
Single suspicious review
```

---

# 66. Suggested Database Entities

Core entities:

```text
identity_verification
contact_verification
device_session

property_authority_claim
property_verification
unit_verification
media_fingerprint

trust_profile
risk_signal
risk_evaluation
risk_rule

fraud_report
fraud_case
fraud_case_subject
fraud_evidence

moderation_action
restriction
appeal

admin_approval_request
security_event
```

Reuse existing:

```text
audit_event
outbox_event
user
property
unit
listing
viewing
tenancy
lease
payment_transaction
ledger_entry
```

---

# 67. Suggested API Surface

Illustrative only.

## Reporting

```text
POST /api/v1/reports
GET  /api/v1/reports/{id}
```

## Verification

```text
POST /api/v1/verification/identity
POST /api/v1/properties/{id}/verification
POST /api/v1/units/{id}/verification
GET  /api/v1/properties/{id}/trust
```

## Fraud Admin

```text
GET  /api/v1/admin/fraud/cases
GET  /api/v1/admin/fraud/cases/{id}
POST /api/v1/admin/fraud/cases/{id}/assign
POST /api/v1/admin/fraud/cases/{id}/evidence
POST /api/v1/admin/fraud/cases/{id}/action
POST /api/v1/admin/fraud/cases/{id}/resolve
```

## Restrictions

```text
POST /api/v1/admin/restrictions
DELETE /api/v1/admin/restrictions/{id}
```

## Appeals

```text
POST /api/v1/appeals
GET  /api/v1/appeals/{id}
```

---

# 68. Fraud Prevention by Product Flow

## Property Creation

```text
Identity
→ Authority Claim
→ Property Evidence
→ Verification
→ Approval
```

---

## Unit Creation

```text
Verified Property
→ Unit Data
→ Photos
→ Review
→ Verification
→ Publish/Invite Allowed
```

---

## Public Listing

```text
Verified Unit
→ Listing
→ Risk Check
→ Publish
```

---

## Viewing

```text
Verified Listing
→ Appointment
→ Authorized Representative
→ Code
→ Check-In
→ Completion
```

---

## Invitation

```text
Verified Unit
→ Authorized Provider
→ Secure Invitation
→ Verified Recipient
→ Accept / Decline
```

---

## Tenancy

```text
Approved Request / Invitation
→ Tenant Identity
→ Tenancy
→ Lease
```

---

## Lease

```text
Terms
→ Version
→ Acceptance
→ Immutable Snapshot
```

---

## Payment

```text
Obligation
→ Payment Intent
→ PSP
→ Verified Webhook
→ Ledger
→ Receipt
```

---

## Occupancy

```text
Payment Complete
→ Lease Active
→ Unit Occupied
→ Move-In Inspection
```

---

# 69. Build Phases

## F1 — Foundation

Implement:

- Trust & Safety domain
- Verification abstractions
- Fraud reports
- Basic restrictions
- Audit integration

---

## F2 — Property Fraud Protection

Implement:

- Property authority
- Property verification
- Unit verification
- Media fingerprinting
- Reverification triggers

---

## F3 — Rental Fraud Protection

Implement:

- Double-rental protection
- Invitation controls
- Existing tenant confirmation
- Viewing representative authorization
- Viewing check-in

---

## F4 — Lease Protection

Implement:

- Immutable lease versions
- Amendments
- Financial-term locking
- Acceptance audit records

---

## F5 — Payment Protection

Implement with Payment Architecture:

- PSP verification
- Webhook integrity
- Offline payment distinction
- Payout protection
- Refund controls

---

## F6 — Risk Engine

Implement:

- Risk signals
- Risk rules
- Risk evaluations
- Step-up actions
- Manual review queue

---

## F7 — Fraud Operations

Implement:

- Fraud case management
- Evidence
- Assignment
- Investigation
- Enforcement
- Appeals

---

## F8 — Internal Security

Implement:

- Admin role separation
- Four-eyes approval
- Admin audit
- High-risk operation controls

---

## F9 — Advanced Detection

Later:

- Graph fraud detection
- Device intelligence
- Behaviour anomaly detection
- AI-assisted duplicate detection
- Fraud-network analysis
- Automated risk models

---

# 70. Testing Requirements

## Identity

Test:

- Fake verification attempts
- Expired verification
- Revoked verification
- Duplicate identity policy

---

## Property

Test:

- Unverified owner attempts publish
- Unauthorized manager changes property
- Duplicate media
- Suspended property attempts listing

---

## Unit

Test:

- Unverified unit attempts invitation
- Fake/duplicate unit flow
- Unit capacity anomalies

---

## Viewing

Test:

- Expired viewing code
- Reused code
- Wrong representative
- Exact-location access control

---

## Lease

Test:

- Terms modified after acceptance
- Concurrent acceptance
- Invalid amendment
- Historical version preserved

---

## Payments

Test:

- Fake webhook
- Duplicate webhook
- Amount mismatch
- Currency mismatch
- Screenshot-only evidence
- Payout takeover attempt

---

## Admin

Test:

- Unauthorized refund
- Self-approval
- Audit deletion attempt
- Privilege escalation
- Unauthorized verification override

---

# 71. Critical Invariants

These rules must never be violated.

1. Identity verification does not equal property ownership verification.
2. Property verification does not automatically verify every unit.
3. A representative receives only explicitly granted permissions.
4. A viewing representative does not automatically receive payment authority.
5. Unverified units cannot be publicly listed or used for tenant invitation.
6. Accepted leases cannot be silently modified.
7. One exclusive unit cannot have conflicting active tenancies for the same period.
8. Payment screenshots do not establish successful payment.
9. PSP-confirmed and external payments remain distinguishable.
10. Payout destination changes are treated as high-risk.
11. Security deposits remain distinguishable from rent.
12. Fraud reports do not automatically prove wrongdoing.
13. Significant enforcement actions are auditable.
14. High-risk administrator actions require explicit permissions.
15. Critical financial/admin actions may require dual authorization.
16. Historical fraud evidence must not be silently overwritten.
17. Risk scores should not initially make irreversible decisions without appropriate review.
18. Trust badges must represent specific verified facts.
19. Fraud detection must respect privacy and data-minimization requirements.
20. Trust & Safety remains a shared platform capability rather than feature-specific duplicated logic.

---

# 72. Definition of Done

The first production fraud-prevention architecture is complete when:

- Identity and property authority are independent concepts.
- Properties and units have separate verification.
- Public listings require appropriate verification.
- Tenant invitations require authorized users.
- Viewing representatives have restricted permissions.
- Viewing attendance can be verified.
- Existing tenants must confirm appropriate imported information.
- Conflicting active tenancy is prevented.
- Accepted leases are immutable.
- Payments require authoritative confirmation.
- Payout destination changes are protected.
- Fraud can be reported from relevant product areas.
- Reports can generate investigation cases.
- Investigators can collect evidence.
- Restrictions can target users or individual resources.
- Administrative actions are audited.
- High-risk internal actions are permission-controlled.
- Risk signals can be created from domain events.
- Fraud tests cover both happy paths and adversarial scenarios.

---

# 73. Instruction to AI Coding Agent

Before implementing fraud-prevention features:

1. Read the Project Bible.
2. Read the Property and Unit architecture.
3. Read the Viewing & Tenant Invitation architecture.
4. Read the Tenancy and Lease architecture.
5. Read the Payment architecture.
6. Read the security architecture.
7. Inspect the existing repository.
8. Understand existing RBAC/grants.
9. Understand audit logging.
10. Understand transactional outbox/events.
11. Reuse existing abstractions.
12. Do not create a second authorization system.
13. Do not create duplicate verification mechanisms where existing models can be extended.
14. Do not rewrite stable domains without a documented architectural reason.
15. Identify gaps and conflicts before coding.
16. Produce an implementation plan.
17. Implement incrementally.
18. Write tests with every phase.
19. Update documentation after decisions change.
20. Preserve backward compatibility unless an explicit migration is required.

The goal is to **build fraud prevention into Rooomly's existing architecture**, not bolt on an isolated fraud application afterward.

---

# 74. Final Trust Architecture

```text
                         USER
                          │
                  Identity / Security
                          │
                          ↓
                       AUTHORITY
                          │
          ┌───────────────┼───────────────┐
          ↓               ↓               ↓
      PROPERTY           UNIT         REPRESENTATION
          │               │               │
     Verification    Verification      Grants
          │               │               │
          └───────────────┼───────────────┘
                          ↓
                       LISTING
                          ↓
                 VIEWING / INVITATION
                          ↓
                       TENANCY
                          ↓
                        LEASE
                          ↓
                       PAYMENT
                          ↓
                      OCCUPANCY
                          ↓
                    MAINTENANCE
                          ↓
                       REVIEWS

Every domain event
        ↓
   TRUST & SAFETY
        ↓
     Risk Signals
        ↓
   Fraud Detection
        ↓
     Fraud Cases
        ↓
   Investigation
        ↓
    Enforcement
        ↓
      Appeals
        ↓
     Audit Trail
```

Rooomly should aim to become a platform where users do not have to blindly trust strangers.

They should be able to trust the **verification, permissions, evidence, payment records, workflows, and audit history provided by the platform**.