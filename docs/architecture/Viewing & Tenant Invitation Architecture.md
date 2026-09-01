# Rooomly Viewing & Tenant Invitation Architecture

> **Historical document — direct tenant invitations were retired by ADR 0029.**
> The only active private acquisition path is verified Unit access code →
> tenancy request → provider approval → lease offer → tenant acceptance →
> tenancy/occupancy. Invitation rows and applied migrations remain solely for
> history and referential integrity; none of the invitation endpoints below is
> an active product workflow.

## Current implementation note — secure physical viewing attendance

Physical Rooomly viewings are free. There is no active fee field, provider
disclosure, payment step or fee notification in the model, API, web or mobile
experience. A confirmed viewing releases exact directions to its authorized
participants and opens one short-lived check-in session near the appointment:

```text
REQUESTED → OFFERED → CONFIRMED → CHECKED_IN → COMPLETED
    │          │          ├────→ RESCHEDULE → OFFERED
    │          │          ├────→ CANCELLED
    │          │          └────→ NO CHECK-IN → ATTENDANCE_PENDING
    │          │                              ├─ confirmed → TENANT_NO_SHOW / HOST_NO_SHOW
    │          │                              └─ disputed → DISPUTED
    │          └─ tenant may WITHDRAW
    └─ provider may DECLINE
```

The tenant receives one credential pair: an opaque QR token and a six-digit
fallback code backed by the same `ViewingCheckInSession`. The backend stores
only hashes, rotates both values together, enforces the scheduled window,
single use, per-viewing/participant binding and failed-code attempt limits, and
audits issuance, success and security-relevant failures. Cancellation or a
material reschedule invalidates the pair. Every confirmed schedule is copied to
an immutable `ViewingAppointment`; rescheduling closes that appointment as
rescheduled and creates a new one only after the counterparty chooses a
replacement time.

Only `CHECKED_IN` can become `COMPLETED`; a completion button cannot manufacture
verified attendance. A missing check-in never establishes who was absent. One
party may create a `ViewingAttendanceResolution` allegation only after the
window closes; the reported party must confirm it before it becomes a verified
no-show, or dispute it so the outcome remains unresolved. Completion
opens the tenant's focused follow-up: request this home, save, report a problem,
or not interested. Requesting the home creates the canonical tenancy request;
it never creates a Tenancy.

## Status

**Implemented core with future extensions identified below**

This document defines how Rooomly should handle:

- Public tenant discovery
- Private tenant invitations
- Existing tenant onboarding
- Virtual viewings
- Physical viewings
- Viewing representatives
- Viewing check-in
- Viewing outcomes
- Conversion from viewing to tenancy
- Privacy and location disclosure
- Permissions and state transitions

The goal is to avoid assuming that landlords already know their future tenants.

Rooomly must support both:

1. **Rental discovery**
2. **Rental management**

---

# 1. Core Product Principle

A verified unit can enter different tenant-acquisition paths.

Rooomly must not assume every landlord already has a tenant.

A landlord may:

- Publish the unit publicly and allow tenants to discover it.
- Keep the unit private and invite a known prospective tenant.
- Add an existing tenant who already occupies the unit.
- Keep the unit private without taking any action yet.
- Share the unit privately using a secure link or code.

These are separate product flows and should remain separate in the domain model.

---

# 2. High-Level Unit Lifecycle

```text
PROPERTY CREATED
        ↓
PROPERTY VERIFIED
        ↓
UNIT CREATED
        ↓
UNIT SUBMITTED FOR REVIEW
        ↓
UNIT VERIFIED
        ↓
OWNER CHOOSES DISTRIBUTION MODE
```

Available modes:

```text
PUBLIC
PRIVATE
UNLISTED / LINK-ONLY
OCCUPIED
```

---

# 3. Unit Distribution Modes

## 3.1 Public

The unit is visible in the public marketplace.

Tenants can:

- Discover it through search
- View unit information
- Save it
- Ask questions
- Request a virtual viewing
- Request a physical viewing
- Request tenancy

The landlord does not need to know the tenant beforehand.

Flow:

```text
Verified Unit
      ↓
Publish
      ↓
Public Marketplace
      ↓
Tenant Discovers
      ↓
Viewing / Questions
      ↓
Tenancy Request
      ↓
Landlord Review
      ↓
Approve / Decline
      ↓
Lease
```

---

## 3.2 Private

The unit is not discoverable publicly.

The landlord may invite a tenant directly.

Use this when:

- The landlord already knows the prospective tenant.
- The tenant was referred privately.
- The landlord found the tenant outside Rooomly.
- The unit should not appear in marketplace search.

Flow:

```text
Verified Unit
      ↓
Keep Private
      ↓
Invite Tenant
      ↓
Tenant Receives Invitation
      ↓
Tenant Reviews Invitation + Unit
      ↓
Accept / Decline Invitation
      ↓
Provider Creates + Sends Lease
      ↓
Tenant Reviews + Accepts / Declines Lease
      ↓
Tenancy + Occupancy (only after lease acceptance)
```

---

## 3.3 Unlisted / Link-Only

The unit is not discoverable through marketplace search but may be shared using:

- Secure URL
- Invitation link
- Unit code
- QR code

Useful for:

- WhatsApp sharing
- Private referrals
- Campus groups
- Employer housing
- Family referrals
- Agent-assisted discovery

Example:

```text
rooomly.com/u/ABC123
```

Anyone with permission to access the link may view the listing according to configured privacy rules.

---

## 3.4 Occupied

Use this when the landlord is onboarding a unit that already has a tenant.

This is not a prospective-tenant invitation.

It is an existing-tenancy onboarding flow.

```text
Verified Unit
      ↓
Mark as Currently Occupied
      ↓
Add Existing Tenant
      ↓
Tenant Receives Confirmation Request
      ↓
Tenant Reviews Imported Tenancy Data
      ↓
Confirm / Dispute
      ↓
Existing Tenancy Managed in Rooomly
```

---

# 4. Three Tenant Acquisition Paths

Rooomly should explicitly support three separate paths.

```text
                         VERIFIED UNIT
                              │
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
       PUBLIC MARKETPLACE  DIRECT INVITE  EXISTING TENANT
              │               │               │
       Tenant discovers   Landlord knows   Already occupied
              │            prospective        unit
              ↓               ↓               ↓
      Tenancy Request     Invitation      Migration/Confirmation
              │               │               │
              └───────────────┴───────┬───────┘
                                      ↓
                                   TENANCY
                                      ↓
                                    LEASE
                                      ↓
                                   PAYMENT
                                      ↓
                               ACTIVE TENANCY
```

These flows should converge at tenancy but remain independent before that point.

---

# 5. Tenant Invitation Domain

A tenant invitation is landlord-initiated.

It means:

> The provider is inviting this person to consider becoming the tenant of a specific unit.

It does **not** automatically create tenancy.

## Suggested Entity

```text
TenantInvitation
```

Suggested fields:

```text
id
unit_id
property_id
invited_by_user_id
invitee_user_id nullable
invitee_phone nullable
invitee_email nullable
invitation_code
token_hash
status
expires_at
accepted_at nullable
declined_at nullable
revoked_at nullable
created_at
updated_at
```

---

# 6. Tenant Invitation States

Recommended state machine:

```text
CREATED
   ↓
SENT
   ↓
VIEWED
   ↓
ACCEPTED
```

Alternative terminal states:

```text
DECLINED
EXPIRED
REVOKED
CANCELLED
```

The invitation should not become tenancy merely because the tenant opens it.

---

# 7. Invitation Acceptance Flow

```text
Landlord Selects Unit
        ↓
Invite Tenant
        ↓
Enter Phone / Email
        ↓
Invitation Created
        ↓
Tenant Receives Link / Code
        ↓
Tenant Logs In or Registers
        ↓
Invitation Bound to Verified Account
        ↓
Tenant Reviews:
    - Unit
    - Property
    - Rent
    - Proposed Terms
    - Amenities
    - Photos
        ↓
Accept / Decline
```

If a prospective invitation is accepted:

```text
InvitationAccepted
        ↓
Provider prepares immutable Lease offer
        ↓
Tenant accepts or declines Lease
        ↓
Accepted Lease activates Tenancy + Occupancy
```

Invitation acceptance does not accept a lease or create Tenancy/Occupancy.
Existing-tenant onboarding is a separate explicit purpose because it records a
real-world arrangement that already exists.

---

# 8. Public Tenancy Request Domain

A public tenancy request is tenant-initiated.

Suggested entity:

```text
TenancyRequest
```

Possible fields:

```text
id
unit_id
tenant_id
listing_id
status
message
requested_move_in_date
requested_term
created_at
updated_at
reviewed_at nullable
reviewed_by nullable
```

States:

```text
SUBMITTED
UNDER_REVIEW
APPROVED
DECLINED
WITHDRAWN
EXPIRED
```

Important:

```text
TenantInvitation != TenancyRequest
```

They have different:

- Initiators
- Permissions
- Notifications
- Expiry rules
- UX
- Business meaning

---

# 9. Existing Tenant Onboarding

Create a separate flow:

```text
ExistingTenantOnboarding
```

The landlord may enter:

- Tenant name
- Phone
- Email
- Current rent
- Lease start date
- Lease end date
- Deposit information
- Existing agreement details

However, Rooomly should distinguish:

```text
LANDLORD_REPORTED
TENANT_CONFIRMED
DISPUTED
ADMIN_REVIEWED
```

Do not treat landlord-entered historical terms as mutually verified facts until the tenant confirms where appropriate.

---

# 10. Unit Action Screen After Verification

After a unit is verified, show:

## What would you like to do with this unit?

### Publish Publicly

Find a tenant through Rooomly.

### Invite a Tenant

Invite someone you already know.

### Add Existing Tenant

Onboard someone who already occupies the unit.

### Share Privately

Generate a private link or code.

### Keep Private

Do nothing for now.

This should replace any design that assumes "Invite Tenant" is the only next step.

---

# 11. Viewing Architecture

Viewing should be optional.

The platform should reduce unnecessary travel.

Recommended model:

```text
DIGITAL DISCOVERY
      ↓
VIRTUAL VIEWING
      ↓
PHYSICAL VIEWING
      ↓
DECISION
```

A tenant should not have to physically travel before Rooomly provides enough information to decide whether the property is worth seeing.

---

# 12. Viewing Types

Suggested types:

```text
VIRTUAL_LIVE
VIRTUAL_RECORDED
PHYSICAL
```

Future:

```text
ROOOMLY_VERIFIED_TOUR
360_TOUR
```

---

# 13. Viewing Request Flow

```text
Tenant Views Unit
      ↓
Request Viewing
      ↓
Choose Type
```

Options:

```text
Virtual Viewing
Physical Viewing
Ask Question First
```

For the implemented physical viewing:

```text
Tenant requests viewing
      ↓
Provider offers available slots
      ↓
Tenant selects a slot
      ↓
CONFIRMED (directions released)
      ├─ reschedule (old appointment retained; old credential invalidated)
      ├─ cancel appointment (structured reason, actor, time and notice retained)
      ├─ CHECKED_IN (QR or fallback code) → COMPLETED
      └─ no check-in after window → attendance report → confirm or dispute
```

---

# 14. Viewing Availability

The landlord or authorized representative should define availability.

Example:

```text
Monday
10:00–12:00

Wednesday
14:00–17:00

Saturday
09:00–15:00
```

Model:

```text
ViewingAvailability
```

Suggested fields:

```text
id
unit_id
representative_id
day_of_week
start_time
end_time
timezone
is_active
valid_from nullable
valid_until nullable
```

---

# 15. Viewing Request Entity

Suggested entity:

```text
ViewingRequest
```

Fields:

```text
id
unit_id
listing_id
tenant_id
viewing_type
requested_start
requested_end
status
tenant_note
provider_note
created_at
updated_at
```

---

# 16. Viewing State Machine

Implemented:

```text
REQUESTED ── tenant withdraws ──→ WITHDRAWN
    ↓
OFFERED ─── tenant withdraws ──→ WITHDRAWN
    │       provider declines ─→ DECLINED
    ↓
CONFIRMED ─ reschedule ────────→ OFFERED (new proposal; history retained)
    │       cancel ────────────→ CANCELLED
    │       no check-in ───────→ ATTENDANCE_PENDING
    │                              ├─ counterparty confirms → TENANT_NO_SHOW / HOST_NO_SHOW
    │                              └─ counterparty disputes → DISPUTED
    ↓
CHECKED_IN
    ↓
COMPLETED
```

`WITHDRAWN`, `DECLINED`, `CANCELLED`, verified no-show and `DISPUTED` are
distinct factual outcomes. None assigns trust points or credibility penalties.

`ViewingAppointment` stores each confirmed schedule and who rescheduled or
cancelled it. `ViewingAttendanceResolution` stores the allegation, reporter,
reported party, response and dispute state. The current `ViewingRequest` remains
the compact workflow aggregate.

---

# 17. Viewing Representatives

The landlord should not always need to be physically present.

Create:

```text
ViewingRepresentative
```

Possible representative types:

```text
LANDLORD
PROPERTY_MANAGER
CARETAKER
VERIFIED_AGENT
AUTHORIZED_REPRESENTATIVE
ROOOMLY_VIEWING_PARTNER
```

Example:

```text
Property Owner:
Kwame Mensah
Location: Accra

Property:
Kumasi

Viewing Representative:
Ama Boateng
Location: Kumasi
```

Ama may conduct viewings without receiving property ownership or financial authority.

---

# 18. Representative Permission Separation

Viewing permissions must be narrow.

Example:

```text
viewing.schedule.manage
viewing.request.accept
viewing.request.decline
viewing.request.reschedule
viewing.checkin
viewing.complete
```

A viewing representative should **not automatically receive**:

```text
property.delete
property.transfer
unit.delete
lease.accept
lease.modify
payments.manage
settlements.manage
banking.manage
```

Delegation must follow least privilege.

---

# 19. Viewing Check-In Code

For a confirmed in-person viewing, the tenant may issue one short-lived
credential pair only during the scheduled check-in window.

Example:

```text
VIEWING CODE
583921
```

Flow:

```text
Viewing Confirmed
      ↓
Opaque QR token + six-digit fallback generated together
      ↓
Tenant Receives Code
      ↓
Tenant Arrives
      ↓
Representative Enters Code
      ↓
CHECKED_IN
```

Credential requirements:

- Random
- Expiring
- Single-use
- Bound to viewing appointment
- Rate-limited
- Audited
- Stored as hashes rather than reusable plaintext
- Invalidated on cancellation or material reschedule
- Bound to the viewing and participants
- Incorrect fallback attempts capped and endpoint-throttled

---

# 20. QR Check-In

Implemented on tenant web/mobile and provider mobile:

```text
Tenant Opens Viewing Pass
      ↓
QR Displayed
      ↓
Representative Scans
      ↓
Appointment Validated
      ↓
Checked In
```

Fallback must remain available for devices that cannot use QR scanning.
Provider web therefore supports manual six-digit entry even without a camera.
Both inputs call the same server-authoritative validation service and create the
same `CHECKED_IN` state.

---

# 21. Exact Location Privacy

Do not necessarily expose exact property location publicly.

Public listing may show:

```text
Ayeduase, Kumasi
1.2 km from KNUST
```

instead of exact coordinates.

Suggested visibility levels:

```text
PUBLIC_APPROXIMATE
CONFIRMED_VIEWING_ONLY
APPROVED_TENANT_ONLY
PRIVATE
```

After physical viewing confirmation, Rooomly may reveal:

- Exact address
- GPS pin
- Directions
- Viewing contact

depending on landlord settings and platform policy.

---

# 22. Viewing Fee Policy

Rooomly viewings are free:

```text
Viewing Fee = Free
```

Tenants must not pay Rooomly, a provider, landlord, agent or representative
simply to attend. Direct API attempts to add legacy fee fields are rejected.

---

# 23. Post-Viewing Outcome

After viewing completion, ask the tenant:

## How did your viewing go?

Implemented options:

```text
REQUEST_THIS_HOME
SAVE_FOR_LATER
REPORT_A_PROBLEM
NOT_INTERESTED
```

---

# 24. Interested Flow

If tenant selects:

```text
REQUEST_THIS_HOME
```

then:

```text
Viewing Completed
      ↓
Tenant Selects "Request this home"
      ↓
TenancyRequest Created
      ↓
Landlord Reviews
      ↓
Approve / Decline
```

Viewing should not automatically create tenancy.

---

# 25. Proceed Without Physical Viewing

Allow remote tenants to proceed without an in-person visit.

Example:

```text
Proceed Without Physical Viewing
```

Require acknowledgement.

Store:

```text
physical_viewing_waived_at
physical_viewing_waiver_version
```

Flow:

```text
Listing
      ↓
Review Digital Information
      ↓
Waive Physical Viewing
      ↓
Tenancy Request
```

This supports tenants living abroad or in another city.

---

# 26. Virtual Viewing Flow

Virtual viewing should reduce physical travel.

MVP may support:

- Scheduled video call
- External meeting link
- Live WhatsApp/video call
- Uploaded walkthrough video

Flow:

```text
Request Virtual Viewing
      ↓
Choose Slot
      ↓
Provider Confirms
      ↓
Virtual Session
      ↓
Viewing Completed
      ↓
Interested?
```

Do not build custom video infrastructure in the earliest version unless clearly required.

---

# 27. Rooomly Viewing Partners

Future service:

```text
Rooomly Viewing Partner
```

Used when:

- Landlord is abroad
- Property manager is unavailable
- No caretaker exists
- Multiple viewings need local handling

Partners may:

- Conduct viewings
- Confirm unit condition
- Check availability
- Upload updated media
- Complete viewing reports

They must not automatically have:

- Lease authority
- Pricing authority
- Payment collection authority
- Property ownership rights

---

# 28. Viewing Domain Entities

Recommended entities:

```text
ViewingAvailability
ViewingRequest
ViewingAppointment
ViewingRepresentative
ViewingCheckIn
ViewingOutcome
ViewingIssueReport
```

Relationships:

```text
Property
    ↓
Unit
    ↓
Listing
    ↓
ViewingRequest
    ↓
ViewingAppointment
    ↓
ViewingCheckIn
    ↓
ViewingOutcome
    ↓
TenancyRequest
```

---

# 29. Tenant Invitation Domain Entities

Recommended:

```text
TenantInvitation
InvitationRecipient
InvitationAuditEvent
ExistingTenantOnboarding
TenancyRequest
```

Possible relationship:

```text
Unit
 ├── TenantInvitation
 ├── ExistingTenantOnboarding
 └── Listing
       └── TenancyRequest
```

---

# 30. Convergence Into Tenancy

All acquisition paths should eventually converge.

```text
PUBLIC MARKETPLACE
      ↓
TenancyRequest
      │
      │
DIRECT INVITATION
      ↓
InvitationAccepted
      │
      │
EXISTING TENANT
      ↓
ExistingTenancyConfirmed
      │
      └──────────────┐
                     ↓
                  TENANCY
                     ↓
                   LEASE
                     ↓
                  PAYMENT
                     ↓
               ACTIVE TENANCY
```

Do not duplicate the tenancy system for each acquisition method.

---

# 31. Conflict Prevention

A unit should not accidentally have multiple active tenant-acquisition outcomes.

For example:

If a tenancy request is approved:

```text
Unit status → RESERVED / TENANCY_PENDING
```

Then:

- Stop new invitations if policy requires.
- Prevent multiple active lease negotiations for the same unit.
- Pause or hide public listing.
- Reject new tenancy requests or place them in a waitlist.

Once lease/payment completes:

```text
Unit status → OCCUPIED
Listing → WITHDRAWN
```

---

# 32. Unit Availability States

Suggested unit states:

```text
DRAFT
PENDING_REVIEW
VERIFIED
AVAILABLE_PRIVATE
AVAILABLE_PUBLIC
RESERVED
TENANCY_PENDING
OCCUPIED
MAINTENANCE
UNAVAILABLE
ARCHIVED
```

Listing state should remain separate:

```text
DRAFT
PUBLISHED
PAUSED
WITHDRAWN
EXPIRED
SUSPENDED
```

Verification state should also remain separate.

Avoid one overloaded `status` field attempting to represent everything.

---

# 33. Invitation Security

Invitation links must:

- Use random cryptographically secure tokens
- Store hashes instead of plaintext tokens where appropriate
- Expire
- Be revocable
- Be single-purpose
- Bind to a verified account after acceptance
- Prevent account takeover
- Prevent reuse after acceptance

Phone/email recipients should be verified before sensitive tenancy information becomes accessible.

---

# 34. Abuse Prevention

Protect against:

- Invitation spam
- Fake landlords
- Fake viewing requests
- Viewing no-shows
- Stalking
- Exact-address scraping
- Agent fee abuse
- Repeated appointment abuse
- Fake tenant profiles
- Harassment
- Unauthorized representative assignment

Potential controls:

```text
Rate limits
Account verification
Block/report tools
Risk scoring
Appointment limits
Representative verification
Audit logging
Admin moderation
```

---

# 35. Notifications

Events should generate notifications.

Examples:

```text
TenantInvitationSent
TenantInvitationViewed
TenantInvitationAccepted
TenantInvitationDeclined

ViewingRequested
ViewingConfirmed
ViewingRescheduled
ViewingCancelled
ViewingReminder
ViewingCheckedIn
ViewingCompleted
ViewingNoShow

TenancyRequestSubmitted
TenancyRequestApproved
TenancyRequestDeclined
```

Channels:

- In-app
- Email
- SMS
- Push

Future:

- WhatsApp

---

# 36. Audit Requirements

Audit:

- Unit published
- Unit withdrawn
- Unit made private
- Invitation created
- Invitation revoked
- Invitation accepted
- Viewing requested
- Viewing confirmed
- Representative assigned
- Location revealed
- Check-in completed
- Viewing outcome recorded
- Tenancy request submitted
- Tenancy request approved
- Existing tenant imported
- Existing tenant disputed imported data

High-value workflow history should not be silently overwritten.

---

# 37. Recommended APIs

Illustrative only.

## Invitations

```text
POST   /api/v1/units/{unit_id}/invitations
GET    /api/v1/invitations/{id}
POST   /api/v1/invitations/{id}/accept
POST   /api/v1/invitations/{id}/decline
POST   /api/v1/invitations/{id}/revoke
```

## Existing Tenant

```text
POST   /api/v1/units/{unit_id}/existing-tenant
POST   /api/v1/existing-tenancies/{id}/confirm
POST   /api/v1/existing-tenancies/{id}/dispute
```

## Viewing

```text
GET    /api/v1/units/{unit_id}/viewing-availability
POST   /api/v1/units/{unit_id}/viewings
GET    /api/v1/viewings/{id}
POST   /api/v1/viewings/{id}/confirm
POST   /api/v1/viewings/{id}/withdraw
POST   /api/v1/viewings/{id}/decline
POST   /api/v1/viewings/{id}/reschedule
POST   /api/v1/viewings/{id}/cancel
POST   /api/v1/viewings/{id}/check-in-credential
POST   /api/v1/viewings/{id}/check-in
POST   /api/v1/viewings/{id}/outcome
POST   /api/v1/viewings/{id}/attendance-report
POST   /api/v1/viewings/{id}/attendance-response
POST   /api/v1/viewings/{id}/post-viewing
```

## Tenancy Requests

```text
POST   /api/v1/units/{unit_id}/tenancy-requests
GET    /api/v1/tenancy-requests/{id}
POST   /api/v1/tenancy-requests/{id}/approve
POST   /api/v1/tenancy-requests/{id}/decline
POST   /api/v1/tenancy-requests/{id}/withdraw
```

---

# 38. Recommended Build Order

## Phase V1 — Unit Distribution

Implement:

- Public/private/unlisted modes
- Unit availability
- Listing relationship
- Publish/withdraw actions

## Phase V2 — Direct Invitation

Implement:

- TenantInvitation
- Phone/email invite
- Secure tokens
- Accept/decline
- Expiration
- Audit trail

## Phase V3 — Public Tenancy Request

Implement:

- Tenant-initiated requests
- Landlord review
- Approve/decline
- Unit reservation rules

## Phase V4 — Viewing Availability

Implement:

- Availability calendar
- Viewing representatives
- Appointment slots

## Phase V5 — Viewing Workflow

Implement:

- Request
- Confirm
- Reschedule
- Cancel
- Check-in
- Complete
- No-show

## Phase V6 — Viewing Outcome

Implement:

- Interested
- Need more information
- Not interested
- Report problem
- Conversion to tenancy request

## Phase V7 — Existing Tenant Onboarding

Implement:

- Imported tenancy
- Tenant confirmation
- Dispute workflow
- Audit trail

## Phase V8 — Virtual Viewing

Implement:

- Scheduled virtual viewing
- Meeting links
- Walkthrough media

## Phase V9 — Advanced Features

Future:

- QR check-in
- Rooomly Viewing Partners
- Waitlists
- Automated scheduling
- 360 tours
- AI listing verification
- Fraud/risk scoring

---

# 39. Critical Invariants

The following rules should be treated as architectural constraints.

1. Invitation does not equal tenancy.
2. Viewing does not equal tenancy.
3. Public tenancy requests are tenant-initiated.
4. Direct invitations are landlord/provider-initiated.
5. Existing tenant onboarding is separate from prospective tenant invitation.
6. A landlord cannot silently declare someone a tenant without appropriate confirmation.
7. A viewing representative must not inherit ownership, lease, or financial authority automatically.
8. Exact property location should follow explicit disclosure policy.
9. Offline viewing actions must remain auditable.
10. Unit verification, availability, listing, and tenancy status must remain separate concepts.
11. One unit must not accidentally enter conflicting active tenancy workflows.
12. Public listing must not be required for private tenant management.
13. Rooomly must remain useful to landlords even when tenants are sourced outside Rooomly.
14. Acquisition flows must converge into one shared tenancy/lease architecture rather than creating separate tenancy systems.

---

# 40. Product Philosophy

Rooomly is two products working together:

## Rental Discovery

Helps strangers find each other safely.

```text
Marketplace
→ Discovery
→ Viewing
→ Tenancy Request
```

## Rental Management

Helps people who already know each other manage their relationship.

```text
Private Unit
→ Invitation / Existing Tenant
→ Tenancy
→ Lease
→ Payment
→ Maintenance
```

The landlord should receive value from Rooomly whether or not Rooomly originally found the tenant.

---

# 41. Final Architecture

```text
                         PROPERTY
                            ↓
                           UNIT
                            ↓
                        VERIFIED
                            │
         ┌──────────────────┼────────────────────┐
         │                  │                    │
         ↓                  ↓                    ↓
      PUBLIC             PRIVATE              OCCUPIED
         │                  │                    │
      LISTING          INVITATION          EXISTING TENANT
         │                  │                    │
      VIEWING          ACCEPT/DECLINE       CONFIRMATION
         │                  │                    │
 TENANCY REQUEST             │                    │
         │                  │                    │
         └──────────────────┴────────────┬───────┘
                                        ↓
                                     TENANCY
                                        ↓
                                      LEASE
                                        ↓
                                     PAYMENT
                                        ↓
                                  ACTIVE TENANCY
```

The architecture should preserve this distinction throughout backend services, APIs, permissions, events, database models, and frontend flows.
