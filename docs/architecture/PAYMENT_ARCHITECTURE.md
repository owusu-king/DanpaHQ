# Rooomly Payment Architecture

## Status

**Implementation started — provider-neutral core foundation complete; production PSP not connected**

Checkpoint (21 August 2026): existing `Lease` terms and `RentCharge` rows remain
the financial-terms/obligation source. Payment intents, immutable provider
transactions, signed idempotent webhook processing, balanced non-custodial
ledger lines, receipts, pending settlements, audit and outbox events now exist.
Production deliberately has no default PSP adapter, so no client is offered a
checkout that cannot move money. Lease activation remains acceptance-driven
until the first licensed PSP and tokenized payout-destination contract are
selected and sandbox-tested. See ADR 0028.

Checkpoint (28 August 2026) — **Implementation A and B complete.** The
foundation above was audited against the code and found accurate. The domain
pieces it was silent about now exist: `PaymentAttempt` (several tries at one
intent, at most one successful), `PaymentAllocation` (which obligation confirmed
money actually satisfies), `PayoutProfile` (a Portfolio-level tokenized
settlement destination, owner/admin only), `Refund`, and
`ReconciliationException` with an hourly sweep that records disagreements and
never repairs them. `PaymentTransaction.intent` became a foreign key so a failed
attempt no longer blocks a successful retry. The adapter contract is five
operations wide. **Still no production PSP, and lease activation is still
acceptance-driven.** See `PAYMENT_IMPLEMENTATION_STATUS.md` for the gap report,
the decisions still outstanding, and where to pick this up.

Checkpoint (28 August 2026) — **Paystack settlement reporting continued.**
Paystack uses organization-owned subaccounts and single-subaccount splits. The
receiving property owner bears Paystack's transaction fee; the tenant pays the
authoritative obligation without a surcharge. Each intent freezes that policy,
the receiving Portfolio, subaccount and configured platform charge. Successful
Paystack transactions and provider settlement are shown as separate facts:
tenant paid, payout processing, and settled to owner. The existing provider
Payments experience now exposes those figures and recent settlement history on
web and mobile. Production PSP access remains disabled and no sandbox request
has been made.

Checkpoint (28 August 2026) — **Payout provisioning made retry-safe.** Portfolio
owners/admins can configure the Paystack subaccount from dedicated web and
mobile screens. A durable operation is written before calling Paystack and its
reference is embedded in provider metadata. Lost or timed-out responses are
reconciled by exact metadata lookup; they are never answered with an untracked
second create. Raw destination numbers are transient, provider tokens remain
server-only, and only masked destination details reach clients.

Checkpoint (29 August 2026) — **Recurring obligation reminders implemented.**
The rent schedule now emits durable, idempotent checkpoints 7, 3 and 1 days
before a due date, on the due date, and 1, 3 and 7 days overdue. Charges sharing
one lease and due date are summarized into one reminder, so move-in rent,
deposit and fees do not arrive as notification spam. Delivery uses the
transactional outbox, rechecks the balance immediately before notifying, and
opens the tenant's Payments workspace on web and mobile. No reminder implies
that online checkout is available; the existing server capability remains the
only authority for that action.

Checkpoint (30 August 2026) — **Post-tenancy balances implemented.** Ending a
lease and resolving its money are independent. The end event cancels unpaid
obligations for periods that will not occur; incurred arrears, disputes, payment
history, live refund credits and receipts survive. Tenants may pay an ended
lease's surviving obligation through the same server-priced intent and receipt
path. Waivers and write-offs are immutable `ObligationAdjustment` records with
amount, reason, actor and timestamp; they never rewrite the original charge and
never appear as money paid. The closing financial summary is a read model over
charges, confirmed payments, adjustments and decided refund credits—not a
mutable balance column.

Checkpoint (31 August 2026) — **Payment integrity audit.** The domain was
traced end to end and audited against this document. Five financial-correctness
defects were fixed and are described in
`PAYMENT_IMPLEMENTATION_STATUS.md` §9: allocations and obligation adjustments
were immutable in Python but not in the database; a provider confirmation with
no completion time crashed mid-post and was retried for ever; a lost callback
was detected but never recovered, and no operator could recover it either;
authenticated provider evidence that could not be applied was recorded in a
table nothing read; and an outbox event whose worker died stayed claimed
permanently, which for `lease.activated.v1` means a live tenancy with no rent
schedule.

Two rules in this document are narrowed by that work, deliberately:

- **§31.8 and the reconciliation principle.** "The sweep never repairs" still
  holds for every genuine disagreement. It no longer covers the case where
  Rooomly holds *no* record and the provider is the sole authority on whether a
  payment happened: that evidence is now ingested through the same validated
  boundary a signed webhook uses.
- **§11 LedgerEntry / PaymentAllocation.** Allocation records which obligation
  confirmed money answers for; it is not the arithmetic that settles a charge.
  `rent._resettle` computes a charge's paid total from confirmed `RentPayment`
  rows, because an off-platform cash payment has no transaction to allocate
  from. Unifying the two is an open decision, not a refactor.

**`PAYMENT_IMPLEMENTATION_STATUS.md` is the authoritative current state.** This
document remains the design intent.

This document defines the payment architecture to implement **after the Property, Unit, Tenancy, and Lease foundations are complete**.

The purpose of this document is to preserve the intended payment design before implementation begins.

---

# 1. Purpose

Rooomly should not treat rent payment as a simple checkout button.

Payments must be designed as a dedicated bounded context that can later support:

- Rent payments
- Security deposits
- Service charges
- Utility payments
- Airtime purchases
- Data bundle purchases
- TV subscription payments
- Bank transfers
- Marketplace payments
- Rent financing
- Future wallet services

The payment architecture must therefore be reusable, auditable, secure, provider-agnostic, and capable of evolving without tightly coupling financial logic to the rental domain.

---

# 2. Implementation Prerequisites

Do not begin implementation of this payment module until the following foundations exist and are stable:

1. User and authentication system
2. Roles and permissions
3. Property management
4. Unit management
5. Property and unit verification workflow
6. Tenant invitations/applications
7. Tenancy lifecycle
8. Lease creation
9. Lease acceptance workflow
10. Audit logging
11. Notification infrastructure
12. Outbox/event infrastructure

Payment implementation should build on top of those foundations rather than modifying them unnecessarily.

---

# 3. Core Principle

A lease being accepted does **not** automatically mean it is financially active.

The lifecycle should distinguish legal/business acceptance from payment activation.

Recommended lease states:

```text
DRAFT
→ SENT
→ LANDLORD_ACCEPTED
→ TENANT_ACCEPTED
→ AWAITING_INITIAL_PAYMENT
→ ACTIVE
→ ENDED / TERMINATED / CANCELLED
```

After both parties accept the lease:

1. Financial obligations are generated.
2. A rent/payment schedule is created.
3. The lease enters `AWAITING_INITIAL_PAYMENT`.
4. The tenant completes the required initial payment.
5. The payment is independently confirmed by the payment provider.
6. Financial records and ledger entries are created.
7. The lease becomes `ACTIVE`.
8. Occupancy and post-payment workflows begin.

---

# 4. Payment Lifecycle

```text
PROPERTY VERIFIED
        ↓
UNIT VERIFIED
        ↓
TENANCY / APPLICATION APPROVED
        ↓
LEASE CREATED
        ↓
LANDLORD ACCEPTS
        ↓
TENANT ACCEPTS
        ↓
LEASE = AWAITING_INITIAL_PAYMENT
        ↓
RENT SCHEDULE GENERATED
        ↓
INITIAL PAYMENT OBLIGATION CREATED
        ↓
TENANT SELECTS PAYMENT METHOD
        ↓
PAYMENT INTENT CREATED
        ↓
LICENSED PAYMENT PROVIDER
        ↓
MOMO / CARD / BANK
        ↓
SERVER-SIDE WEBHOOK / CALLBACK
        ↓
WEBHOOK SIGNATURE VERIFIED
        ↓
TRANSACTION CONFIRMED
        ↓
LEDGER ENTRY CREATED
        ↓
RECEIPT GENERATED
        ↓
SETTLEMENT TRACKED
        ↓
LEASE = ACTIVE
        ↓
UNIT = OCCUPIED
        ↓
TENANT + LANDLORD NOTIFIED
```

---

# 5. Do Not Hold Customer Funds Initially

For the first production version, Rooomly should preferably **not independently custody tenant funds**.

Recommended model:

```text
Tenant
   ↓
Rooomly Checkout / Payment UI
   ↓
Licensed Payment Service Provider
   ↓
Landlord / Provider Settlement
```

Rooomly should:

- Initiate the payment
- Track its purpose
- Store provider references
- Receive verified callbacks/webhooks
- Reconcile payment results
- Generate platform records and receipts
- Track settlement status
- Maintain audit trails

Rooomly should **not** assume it can legally operate escrow, stored-value wallets, deposit custody, lending, or unrestricted money transfer services without the appropriate regulated structure.

Any true wallet, escrow, deposit holding, lending, or financial custody feature must undergo dedicated legal and regulatory review before implementation.

---

# 6. Payment Methods

Initial payment methods should support provider adapters so payment providers can be changed without changing rental business logic.

Priority:

## 6.1 Mobile Money

Primary Ghana payment method.

Potential channels:

- MTN MoMo
- Telecel Cash
- AT Money

## 6.2 Card

Support cards through the selected payment service provider.

## 6.3 Bank Transfer

Support bank-transfer payment flows where the provider supports reliable reconciliation.

## 6.4 External / Offline Payment

Allow landlords to record payments received outside Rooomly.

Examples:

- Cash
- Direct bank transfer
- Direct Mobile Money transfer

External payments must never be represented as equivalent to PSP-confirmed payments.

Suggested verification states:

```text
UNVERIFIED
LANDLORD_REPORTED
TENANT_CONFIRMED
DISPUTED
ADMIN_VERIFIED
```

Example:

```text
Payment Method: CASH
Amount: GHS 1,500
Platform Verified: NO
Landlord Confirmed: YES
Tenant Confirmed: YES
```

---

# 7. Lease Financial Terms

Lease financial terms should be structured data.

Do not hard-code assumptions such as:

- two years advance
- one year advance
- monthly rent only

Suggested fields:

```text
monthly_rent
billing_frequency
lease_start_date
lease_end_date
advance_months
advance_amount
security_deposit_amount
service_charge_amount
other_charge_amount
grace_period_days
payment_due_day
currency
```

Example:

```text
Monthly Rent:          GHS 1,500
Lease Duration:        12 months
Advance Required:      GHS 3,000
Security Deposit:      GHS 1,500
Service Charge:        GHS 0
Initial Amount Due:    GHS 4,500
Recurring Rent:        GHS 1,500
```

Legal rules governing advance rent, deposits, fees, refunds, and lease enforceability must remain configurable and should be reviewed before production deployment.

---

# 8. Financial Obligations

Do not store one unexplained total payment against a lease.

Every amount must have a purpose.

Recommended obligation types:

```text
RENT
RENT_ADVANCE
SECURITY_DEPOSIT
UTILITY
SERVICE_CHARGE
LATE_FEE
DAMAGE_CHARGE
REFUND
OTHER
```

Example:

```text
Total Payment = GHS 4,500

GHS 3,000 → RENT_ADVANCE
GHS 1,500 → SECURITY_DEPOSIT
```

This separation is necessary for:

- Accounting
- Refunds
- Disputes
- Reporting
- Legal records
- Future escrow
- Financial analytics

---

# 9. Rent Schedule

Once a lease is fully accepted, create a schedule of financial obligations.

Example:

```text
Lease #RM-10482

Initial Rent Advance     GHS 3,000     Due Sep 01
Security Deposit         GHS 1,500     Due Sep 01
October Rent             GHS 1,500     Due Oct 01
November Rent            GHS 1,500     Due Nov 01
December Rent            GHS 1,500     Due Dec 01
...
```

Each scheduled obligation should contain:

```text
id
lease_id
tenant_id
landlord_id
unit_id
obligation_type
amount
currency
due_date
status
amount_paid
amount_remaining
created_at
updated_at
```

Recommended statuses:

```text
PENDING
PARTIALLY_PAID
PAID
OVERDUE
WAIVED
CANCELLED
REFUNDED
DISPUTED
WRITTEN_OFF
```

If partial payments are not allowed in the MVP, enforce that in business rules while preserving a data model capable of supporting partial payments later.

## 9.1 Post-tenancy and closing financial position

The lease lifecycle and financial-obligation lifecycle are independent:

```text
Lease:       ACTIVE → ENDED
Obligation:  DUE → OVERDUE → PAID
                            → DISPUTED
                            → WAIVED
                            → WRITTEN_OFF
```

`ENDED` stops the creation of new recurring rent and closes unpaid future
schedule rows as `CANCELLED`. It does not forgive an incurred debt. Existing
open obligations remain payable, including through digital checkout, and a
confirmed post-end payment is allocated and receipted exactly as an in-term
payment.

`OVERDUE` is an effective state derived from an open balance and the due date,
never a stale stored flag. `DISPUTED` is derived from the preserved linked
payment-dispute record. The API exposes this as `effective_status` while the
charge's stored settlement state remains the authoritative accounting state.

Forgiveness and collectability decisions are non-cash adjustments:

- `WAIVER` releases the tenant from a stated amount.
- `WRITE_OFF` records that collection of a stated amount is no longer expected.
- Partial adjustments leave the obligation partly resolved.
- A fully adjusted obligation is `WAIVED`, `WRITTEN_OFF`, or `ADJUSTED`
  depending on its adjustment/payment mix. It is never `PAID` unless money
  settled the entire obligation.
- Each adjustment is immutable and records the original obligation, amount,
  currency, reason, actor and effective timestamp. Corrections require another
  explicit record; neither the charge nor financial history is deleted.

The server derives the closing summary as:

```text
unpaid incurred rent
+ other valid incurred charges
- approved/processing tenant credits
- waivers
- write-offs
= net closing position
```

A negative net position is exposed separately as credit owed to the tenant.
Completed refunds remain in historical payment/refund records and are not
subtracted twice. `payments.obligation.waive` and
`payments.obligation.write_off` are restricted to the creditor/property owner
or an owning Portfolio's owner/admin; ordinary property managers, accountants,
staff and property assignees do not inherit them.
Both capabilities are also lifecycle-gated: waiver and write-off are closing
decisions available only after the lease/tenancy is `ENDED`. They are never a
way to alter rent collection while a tenancy is active. Active obligations may
still be paid, become overdue, or enter dispute through their normal lifecycle.

Security deposits are never applied automatically. A future deduction must be
an explicit, itemized, authorized and auditable workflow governed by the lease
and applicable rules.

---

# 10. Payment Bounded Context

Create a dedicated Payments domain.

Suggested internal structure:

```text
payments/
├── obligations/
├── intents/
├── transactions/
├── ledger/
├── settlements/
├── refunds/
├── reconciliation/
├── providers/
├── webhooks/
├── receipts/
├── disputes/
└── services/
```

The rental/lease domain should request financial operations through the Payments domain rather than implementing payment logic itself.

---

# 11. Core Payment Entities

## PaymentObligation

Represents money owed.

Examples:

- Monthly rent
- Advance rent
- Deposit
- Utility charge

---

## PaymentIntent

Represents an attempt to pay one or more obligations.

Suggested fields:

```text
id
user_id
lease_id
amount
currency
status
provider
provider_reference
idempotency_key
expires_at
metadata
created_at
updated_at
```

Suggested statuses:

```text
CREATED
PENDING
PROCESSING
SUCCEEDED
FAILED
EXPIRED
CANCELLED
```

---

## PaymentTransaction

Represents the actual provider-side financial transaction.

Suggested fields:

```text
id
payment_intent_id
provider
provider_transaction_id
provider_reference
amount
currency
payment_method
status
paid_at
failure_code
failure_message
raw_provider_status
created_at
updated_at
```

---

## LedgerEntry

Represents the internal accounting movement.

Never rely on `payment.status = paid` as the only financial record.

The ledger should provide an immutable, auditable record of value movement.

Suggested fields:

```text
id
transaction_id
account_reference
entry_type
amount
currency
description
occurred_at
metadata
```

Future implementation should strongly consider double-entry accounting when Rooomly begins handling wallet balances, settlement balances, escrow, refunds, commissions, or other custodial financial flows.

---

## Settlement

Tracks movement of funds to the landlord or beneficiary.

Suggested fields:

```text
id
transaction_id
beneficiary_id
provider
provider_settlement_reference
gross_amount
fee_amount
net_amount
currency
status
expected_at
settled_at
created_at
updated_at
```

Suggested statuses:

```text
PENDING
PROCESSING
SETTLED
FAILED
REVERSED
```

---

## Receipt

A receipt is generated only after processor-confirmed payment. At that boundary
Rooomly stores both a versioned factual snapshot and the final rendered PDF;
the PDF is not regenerated from mutable account, Property, Unit or template
state later. This gives a 2026 payment the same reproducibility guarantee as a
frozen agreement even if names, premises labels or Rooomly's renderer change.

Include:

- Rooomly receipt number
- Provider transaction reference
- Tenant
- Landlord/provider
- Property
- Unit
- Bed, where applicable
- Premises address and furnished/unfurnished state
- Lease
- Amount
- Breakdown
- Obligation and period covered
- Payment method
- Payment date
- Payment status
- Currency

`rooomly.payment_receipt.v1` is the current snapshot schema. The PDF hash and
bytes are stored on the immutable Receipt record and served only through the
same tenant/provider authorization boundary as the receipt metadata. Act 220
s. 33 informed the factual fields, but Rooomly does not certify that an
electronic receipt satisfies every Ghanaian formality. Stamping and electronic
sufficiency remain questions for Ghana-qualified counsel in
`docs/legal/GHANA_RESIDENTIAL_LEASE_CLAUSE_REVIEW.md`.

---

## Refund

Store refunds independently.

Suggested statuses:

```text
REQUESTED
APPROVED
PROCESSING
COMPLETED
FAILED
REJECTED
```

Never overwrite the original successful payment to make it appear as though it never happened.

---

## ReconciliationRecord

Used to compare Rooomly's records with payment-provider records.

The reconciliation process should detect:

- Provider success but Rooomly pending
- Rooomly success but provider missing
- Amount mismatch
- Duplicate payment
- Duplicate webhook
- Failed settlement
- Reversal
- Refund discrepancy

---

## ProviderWebhook

Store webhook processing metadata.

Suggested fields:

```text
provider
event_id
event_type
payload_hash
signature_valid
received_at
processed_at
processing_status
error_message
```

Sensitive provider payload data should be handled according to security and retention policy.

---

# 12. Provider Adapter Architecture

Do not tightly couple payment logic to one PSP.

Create a provider interface.

Conceptually:

```text
PaymentProvider
├── create_payment()
├── verify_payment()
├── get_transaction()
├── refund()
├── get_settlement()
└── verify_webhook()
```

Then implementations can exist independently:

```text
PaystackProvider
FlutterwaveProvider
HubtelProvider
FutureProvider
```

The core domain should not know provider-specific API details.

---

# 13. Webhook Security

Never trust frontend payment success.

Payment confirmation must occur server-side.

Required webhook flow:

```text
Provider sends webhook
        ↓
Receive raw request
        ↓
Verify provider signature
        ↓
Check event idempotency
        ↓
Persist webhook event
        ↓
Validate transaction reference
        ↓
Validate expected amount
        ↓
Validate currency
        ↓
Validate internal payment intent
        ↓
Update transaction atomically
        ↓
Create ledger records
        ↓
Publish domain event through outbox
```

Never activate a lease based solely on:

- Redirect URL
- Browser callback
- JavaScript success state
- Client-provided transaction reference

---

# 14. Idempotency

Payment APIs must support idempotency.

Example:

```text
POST /payments/intents
Idempotency-Key: unique-key
```

Repeated requests using the same key must not create duplicate charges or duplicate financial records.

Webhook handlers must also be idempotent.

---

# 15. Post-Payment Events

After initial payment succeeds:

```text
InitialLeasePaymentCompleted
```

Downstream actions:

```text
InitialLeasePaymentCompleted
        ↓
ActivateLease
        ↓
CreateOccupancy
        ↓
MarkUnitOccupied
        ↓
WithdrawPublicListingIfRequired
        ↓
UpdateRentSchedule
        ↓
GenerateReceipt
        ↓
ScheduleFutureRentReminders
        ↓
NotifyTenant
        ↓
NotifyLandlord
        ↓
CreateAuditEvent
```

Use the existing transactional outbox/event infrastructure.

Do not execute all downstream business effects directly inside the payment webhook request.

---

# 16. Unit and Listing Behaviour

When the initial payment has succeeded and the lease becomes active:

- Unit occupancy status becomes occupied
- Tenant occupancy record is created
- Public listing should be withdrawn where appropriate
- Private access/invitation rules should follow the existing unit workflow
- Unit/property records should not be deleted
- Historical listing and tenancy data must remain auditable

---

# 17. Failed Payments

If payment fails:

- Lease remains `AWAITING_INITIAL_PAYMENT`
- Unit should not be treated as occupied based on payment
- Obligation remains unpaid
- Payment attempt is retained
- Failure reason is recorded safely
- Tenant may retry through a new payment intent
- Duplicate charges must be prevented
- Landlord may be notified depending on business rules

---

# 18. Payment Reminders

The system should support automatic reminders.

Example:

```text
7 days before due date
3 days before
1 day before
Due date
1 day overdue
3 days overdue
7 days overdue
```

Reminder policy must be configurable.

Communication channels can include:

- In-app notifications
- Email
- SMS
- Push notifications

Future WhatsApp messaging should use an approved provider/integration.

---

# 19. Payment Dashboard

## Tenant

Show:

- Amount due
- Next payment date
- Rent schedule
- Payment history
- Receipts
- Failed payments
- Outstanding balance
- Payment method
- Lease financial breakdown

---

## Landlord / Provider

Show:

- Expected rent
- Collected amount
- Outstanding amount
- Upcoming payments
- Overdue payments
- Settlement status
- Property/unit breakdown
- Tenant payment history
- Exportable statements

---

## Admin

Show:

- Payment volume
- Payment failures
- Provider performance
- Webhook failures
- Settlement failures
- Refunds
- Reconciliation exceptions
- Suspicious transactions
- Manual review cases

Admin actions involving financial state changes must be strongly permissioned and fully audited.

---

# 20. Permissions

Examples:

## Tenant

Can:

- View own obligations
- Initiate own payments
- View own receipts
- Confirm reported external payments
- Dispute eligible payment records

Cannot:

- Mark PSP payments successful
- Alter amounts owed
- Modify provider references
- Alter ledger records

---

## Landlord / Property Provider

Can:

- View payments related to their leases
- Record permitted external payments
- View settlement information
- Download reports

Cannot:

- Fabricate PSP confirmation
- Modify immutable provider transactions
- Alter ledger records
- Delete historical financial records

---

## Admin

Financial administration should use explicit permissions such as:

```text
payments.view
payments.review
payments.refund.request
payments.refund.approve
payments.reconcile
payments.external.verify
settlements.view
settlements.manage
```

High-risk actions should require stronger authorization and audit logging.

---

# 21. Audit Requirements

Every meaningful payment action should create an audit record.

Examples:

- Financial terms created
- Financial terms modified before acceptance
- Lease accepted
- Obligation generated
- Payment intent created
- Provider request initiated
- Webhook received
- Payment confirmed
- Payment failed
- Payment disputed
- Offline payment reported
- Offline payment confirmed
- Refund requested
- Refund approved
- Refund completed
- Settlement completed
- Admin override attempted/performed

Audit history must not be casually editable or deletable.

---

# 22. Security Requirements

Minimum requirements:

- HTTPS only
- Secure secret management
- PSP keys never exposed to frontend
- Signed webhook verification
- Idempotent financial APIs
- Strong authorization checks
- Input validation
- Server-side amount calculation
- Immutable financial history
- Rate limiting
- Fraud monitoring hooks
- Sensitive-log redaction
- Database transaction boundaries
- Replay-attack protection where applicable
- Reconciliation jobs
- Alerting for payment anomalies

Never trust a tenant-provided payment amount.

The backend must derive payable amounts from authoritative obligations.

---

# 23. Currency

Initial currency:

```text
GHS
```

Do not use floating-point values for money.

Store money using:

- Integer minor units where appropriate, or
- Proper fixed-precision decimal fields

Example:

```text
GHS 1,500.25
```

should never be represented using an imprecise binary floating point type.

Keep currency explicit on financial records to support future multi-country expansion.

---

# 24. Future Wallet

Do not implement a stored-value wallet merely because future product plans include one.

The future Wallet domain may eventually support:

- Wallet funding
- Balance
- Transfers
- Withdrawals
- Cashback
- Rewards
- Refund balances
- Rental payments
- Bill payments

But the wallet must be introduced only after:

- Regulatory analysis
- PSP/bank partnership model is defined
- Ledger architecture supports it
- AML/KYC requirements are understood
- Consumer protection rules are designed
- Settlement/custody architecture is approved

---

# 25. Future Digital Services

The same Payments infrastructure should later support:

## Airtime

- MTN
- Telecel
- AT

## Data Bundles

- Daily
- Weekly
- Monthly
- Corporate

## TV

- DStv
- GOtv
- StarTimes

## Utilities

- ECG
- Ghana Water
- Local levies
- Property rates
- Other supported billers

## Education

- WASSCE checker
- BECE checker
- NOVDEC checker
- Other approved vouchers/services

## Transfers

- Bank transfers
- Mobile Money transfers
- Future internal transfers

These should be separate business domains using the same payment infrastructure.

---

# 26. Future Rent Financing

Do not tightly couple lending to normal rent collection.

Future model:

```text
Tenant
   ↓
Rooomly
   ↓
Licensed Lending Partner
   ↓
Underwriting / Approval
   ↓
Landlord receives agreed amount
   ↓
Tenant repays financing provider
```

Possible future products:

- Rent Now, Pay Monthly
- Emergency rent support
- Salary-linked financing
- Landlord improvement financing

Rooomly should initially act as platform/integration infrastructure rather than assuming the role of lender without the necessary regulatory structure.

---

# 27. Future Escrow

Escrow should remain a future feature.

Potential use cases:

- Security deposits
- Booking deposits
- Property reservations
- Marketplace transactions
- Disputed payments

Do not implement actual custodial escrow until the legal, regulatory, banking, and PSP model is explicitly approved.

---

# 28. Suggested API Surface

Illustrative API design:

```text
POST   /api/v1/leases/{lease_id}/payment-schedule
GET    /api/v1/leases/{lease_id}/obligations

POST   /api/v1/payments/intents
GET    /api/v1/payments/intents/{id}

GET    /api/v1/payments/transactions/{id}
GET    /api/v1/payments/history

POST   /api/v1/payments/external
POST   /api/v1/payments/external/{id}/confirm

GET    /api/v1/payments/receipts/{id}
GET    /api/v1/payments/receipts/{id}/document.pdf

POST   /api/v1/refunds
GET    /api/v1/refunds/{id}

POST   /api/v1/webhooks/payments/{provider}

GET    /api/v1/landlord/payments
GET    /api/v1/landlord/settlements

GET    /api/v1/admin/payments
GET    /api/v1/admin/reconciliation
```

Exact endpoints should be finalized during API design.

---

# 29. Suggested Build Order

Implement in this order:

## Payment Phase P1 — Financial Terms

- Lease financial structure
- Obligation model
- Rent schedule generation
- Permission rules

## Payment Phase P2 — Payment Core

- Payment intents
- Payment transactions
- Provider interface
- Idempotency
- Payment state machine

## Payment Phase P3 — First PSP Integration

- Mobile Money
- Card
- Webhooks
- Verification
- Failure handling

## Payment Phase P4 — Accounting Foundation

- Ledger
- Receipts
- Reconciliation
- Settlement tracking

## Payment Phase P5 — Lease Activation

- Initial-payment event
- Lease activation
- Occupancy activation
- Unit status transition
- Listing transition
- Notifications

## Payment Phase P6 — Recurring Rent Operations

- Upcoming rent
- Reminders
- Overdue state
- Landlord reporting
- Tenant history

## Payment Phase P7 — External Payments

- Cash/direct payment records
- Tenant confirmation
- Dispute workflow
- Admin verification

## Payment Phase P8 — Refunds & Reconciliation

- Refund workflow
- Reversals
- Provider reconciliation jobs
- Exception management

Do not proceed to Wallet, Airtime, Data, Utilities, Transfers, Financing, or Escrow until the core payment system is reliable and thoroughly tested.

---

# 30. Testing Requirements

At minimum test:

### Unit Tests

- Obligation generation
- Rent schedule generation
- Amount calculations
- State transitions
- Permissions
- Idempotency
- Payment allocation

### Integration Tests

- PSP payment initiation
- Webhook validation
- Transaction confirmation
- Ledger creation
- Receipt creation
- Settlement updates
- Refund flow

### Security Tests

- Forged webhook
- Replay webhook
- Incorrect amount
- Incorrect currency
- Cross-tenant access
- Cross-landlord access
- Privilege escalation
- Duplicate payment request

### Failure Tests

- PSP timeout
- Provider reports success after timeout
- Duplicate webhook
- Database failure during confirmation
- Notification failure after payment
- Settlement failure
- Refund failure

### End-to-End Tests

```text
Create Lease
→ Accept Lease
→ Generate Schedule
→ Pay Initial Obligation
→ Confirm Webhook
→ Create Ledger
→ Generate Receipt
→ Activate Lease
→ Mark Unit Occupied
→ Notify Parties
```

---

# 31. Critical Invariants

The implementation must preserve these rules:

1. A frontend response can never independently mark a payment successful.
2. A successful financial transaction must never disappear from history.
3. Refunds must not overwrite original transactions.
4. Ledger history must be immutable.
5. Payment obligations must have explicit purposes.
6. A payment must belong to the correct tenant, lease, unit, and landlord/provider.
7. Money must never be represented with imprecise floating point storage.
8. Provider webhooks must be authenticated and idempotent.
9. Lease activation must be safe against duplicate events.
10. Payment provider integration must remain replaceable.
11. Financial state-changing admin actions must be audited.
12. Offline payments must be distinguishable from PSP-confirmed payments.
13. Wallet/escrow/lending must not be introduced implicitly through ordinary rent collection.
14. The payment domain must remain reusable by future Rooomly digital services.

---

# 32. Definition of Done

The initial rental payment system is considered complete only when:

- Accepted leases generate correct obligations
- Tenants can see exactly what they owe
- Tenants can initiate digital payment
- Server verifies payment independently
- Duplicate charges/events are prevented
- Transactions are auditable
- Receipts are generated
- Landlords can see expected and collected rent
- Settlement can be tracked
- Failed payments can be retried safely
- External payments can be recorded separately
- Initial payment activates the lease exactly once
- Unit occupancy updates correctly
- Listings update correctly
- Notifications are event-driven
- Financial records cannot be casually modified/deleted
- Reconciliation detects inconsistencies
- Tests cover success, failure, duplicate, and security scenarios

---

# 33. Instruction to AI Coding Agent

Before implementing this payment architecture:

1. Read the Project Bible.
2. Read the PRD, BRD, SRS, architecture, data model, API specification, security documentation, and current implementation.
3. Inspect the existing codebase thoroughly.
4. Understand the current Property, Unit, Tenancy, Lease, Audit, Permission, Notification, and Outbox implementations.
5. Do not duplicate existing abstractions.
6. Do not rewrite stable domains simply to fit this document.
7. Identify conflicts between this document and existing architecture before modifying code.
8. Preserve existing architectural conventions unless there is a documented reason to change them.
9. Produce an implementation plan before coding.
10. Implement the payment phases incrementally.
11. Add tests with every phase.
12. Update documentation as implementation decisions are finalized.

The goal is to **build on top of the existing Rooomly architecture**, not start a parallel payment application.

---

# Final Architectural Direction

The intended progression is:

```text
Property
   ↓
Unit
   ↓
Tenancy
   ↓
Lease
   ↓
Financial Obligations
   ↓
Payment Intent
   ↓
Licensed PSP
   ↓
Verified Transaction
   ↓
Ledger
   ↓
Receipt
   ↓
Settlement
   ↓
Lease Activation
   ↓
Recurring Rent Management
```

Later:

```text
                 ┌─ Airtime
                 ├─ Data
                 ├─ Utilities
Payments Core ───├─ TV
                 ├─ Marketplace
                 ├─ Transfers
                 ├─ Wallet
                 └─ Rent Financing
```

The Payments domain should become reusable infrastructure for the wider Rooomly ecosystem.
