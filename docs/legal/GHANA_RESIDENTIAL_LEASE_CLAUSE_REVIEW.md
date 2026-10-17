# Danpa HQ Ghana Residential Tenancy Agreement — clause and legal review brief

**Status:** product/legal design draft — not approved for production legal use  
**Research checkpoint:** 27 August 2026  
**Jurisdiction:** Ghana  
**Owner:** Danpa HQ product + Ghana-qualified external counsel

This document must be reviewed before the canonical Danpa HQ residential lease
template is approved for production. It is a requirements and source map, not a
legal opinion and not final contractual wording.

## Source position at this checkpoint

- The [Rent Act, 1963 (Act 220), as published by Parliament of Ghana](https://repository.parliament.gh/items/7ed7ce4b-e397-405a-892d-e9aa3a962195)
  remains the primary source used for this design. The available consolidated
  copies record amendments made by the Rent Control Law, 1986 (PNDCL 138).
- The [GhaLII Act 220 record](https://ghalii.org/akn/gh/act/1963/220/eng@1971-12-31)
  warns that outstanding amendments have not all been applied to its displayed
  version. Counsel must verify the current consolidated text before approval.
- The Ministry's [November 2025 Rent Bill update](https://mwhwr.gov.gh/rent-dialogue-convened-to-address-emerging-issues-in-revised-bill/)
  says a revised replacement bill was still being prepared for the 9th
  Parliament. Danpa HQ must re-check enactment status before every template or
  policy release; a bill is not treated as law.
- The current [Electronic Transactions Act, 2008 (Act 772)](https://ghalii.org/akn/gh/act/2008/772/eng@2020-12-29)
  is the source for electronic-record integrity, retention and digital-signature
  questions. Danpa HQ's in-app confirmations are evidence records and are not
  described as legal electronic signatures without counsel approval.
- The [Stamp Duty Act, 2005 (Act 689)](https://ghalii.org/akn/gh/act/2005/689/eng@2005-06-03),
  [Land Act, 2020 (Act 1036)](https://ghalii.org/akn/gh/act/2020/1036/eng@2020-12-23),
  [Data Protection Act, 2012 (Act 843)](https://ghalii.org/akn/gh/act/2012/843/eng@2012-05-18),
  and [Real Estate Agency Act, 2020 (Act 1047)](https://ghalii.org/akn/gh/act/2020/1047/eng@2020-12-29)
  may affect stamping, registration, identity/data handling, agency and
  transaction formalities. Their application to each Danpa HQ arrangement needs
  professional review.

## Proposed clause matrix

| Clause group | Proposed purpose | Structured/configurable fields | Current source or rationale | Ghana-qualified legal review required |
|---|---|---|---|---|
| Agreement identity | Name the document, reference, jurisdiction, template version and generation date. | `agreement_reference`, `template_code`, `template_version`, `generated_at` | Evidence and reproducibility architecture; Act 772 ss. 6–8. | Confirm whether any prescribed heading, form or registration reference is required. |
| Parties and capacity | Identify the provider/landlord, tenant and the provider's authority/capacity. | Party legal/display names, account IDs, organization, verified relationship type, contact/notices address. | Act 220 definitions of landlord and tenant; Danpa HQ property-authority records. | Decide what legal names/IDs must appear and when an organization, owner or authorized agent is the contracting landlord. |
| Premises | Identify the Property and exact Unit/Bed, address, furnishing and any included areas/items. | Property/Unit/Bed IDs and labels, address snapshot, furnished state, inventory reference, permitted common areas. | Act 220 definition of premises; s. 33 receipt particulars include premises and furnished/unfurnished status. | Confirm sufficiency of GhanaPost/digital address and when title/parcel details are required. |
| Term and possession | State commencement, agreed duration/end and handover. | `starts_on`, `ends_on`, `term_months`, handover condition/date. | Core agreement certainty; Act 220 possession provisions. | Replace the current approximate 30-day-month end-date calculation with counsel-approved calendar rules. |
| Rent and frequency | State rent amount, currency, payment period, due date and allowed payment channel. | Minor units/currency, `rent_period`, due day/date, payment method instructions. | Act 220 rent framework; Danpa HQ money ADR. | Confirm recoverable-rent implications and whether any Rent Officer assessment/reference must be disclosed. |
| Advance rent | State the advance requested and show the policy/source version used. | Advance periods, amount, policy version, legal-rule version, acknowledgement. | Act 220 s. 25(5), as amended, distinguishes monthly/shorter tenancies and tenancies exceeding six months. | Provide the exact decision table for all tenancy lengths/payment periods. The current six-month/monthly-only product rule is not sufficient. Decide whether Danpa HQ must block rather than warn. |
| Rent receipts | Require a receipt for each rent payment and connect it to Danpa HQ Payments. | Premises, furnished status, amount, period covered, tenant name, receipt number/date, stamp status. | Act 220 s. 33 expressly requires a written receipt containing these particulars and any otherwise-required stamp. | Confirm current stamping method and whether an electronic receipt satisfies all formalities in this context. |
| Deposit/security | State amount, purpose, custody, deductions, evidence and return process. | Deposit amount or months, allowed purposes, condition evidence, return trigger/timing, deductions/dispute state. | Contractual risk allocation; no statutory cap is asserted by Danpa HQ at this checkpoint. | Supply lawful wording, custody/interest rules if any, permissible deductions, return timing and dispute process. |
| Utilities and services | Allocate water, electricity, refuse, internet and shared-service responsibility. | Per-service payer (`provider`, `tenant`, `shared`, `included`), metering, billing basis, notes. | Common dispute area; Act 220 treatment of rent/furniture/fixtures may be relevant. | Confirm treatment of service charges, prepaid meters, arrears and disconnection; prohibit unlawful self-help. |
| Occupants and use | Record permitted residential use and named occupants without converting them into tenants. | Permitted use, occupant names/relationships, maximum occupants, home-business permission. | Agreement clarity; Act 220 nuisance/illegal-use and possession provisions. | Define occupant rights, guests, overcrowding, home business and non-discrimination constraints. |
| Assignment/subletting | State whether and how assignment or subletting requires consent. | Allowed/consent-required flag, request channel. | Act 220 s. 22 and Land Act lease provisions may be relevant. | Confirm application to residential Units/Beds and avoid an absolute restriction the law does not permit. |
| Provider responsibilities | State delivery of possession, agreed repairs/services and non-interference. | Responsibility codes selected from the template, response contacts and service schedule. | Contractual duties; Act 220 prohibits conduct intended to force a tenant to give up possession (s. 27). | Supply positive habitability/repair obligations and lawful access/emergency wording. |
| Tenant responsibilities | State payment, reasonable care, permitted use and reporting duties. | Responsibility codes selected from the template; reporting channel. | Act 220 s. 17 includes unpaid lawful rent, broken tenancy obligations, nuisance, illegal use and waste among possession considerations. | Ensure wording does not turn every breach into automatic eviction or waive statutory protections. |
| Repairs, alterations and condition | Separate routine care, structural repair, alterations and evidence at handover. | Responsibility allocation, approval-required alterations, inventory/condition references. | Dispute prevention and property evidence architecture. | Determine fair wear and tear, emergency repairs, reimbursement and unsafe-premises obligations. |
| Access and inspection | Describe entry purposes, notice and emergencies. | Notice period/policy version, permitted purposes, emergency exception. | Privacy and quiet-enjoyment risk. | Ghana-specific lawful-notice wording is required; no default notice period should be invented. |
| Renewal, ending and possession | Describe expiry/renewal and lawful process without self-help eviction. | Renewal intent, notice records, agreed end date, termination reason/event. | Act 220 s. 17 and related possession provisions. | Full wording and notice periods/grounds require review. Danpa HQ ending a record must not be represented as legal eviction or recovery of possession. |
| Disputes and governing law | Identify Ghana law and an escalation route while preserving statutory/court rights. | Support contact, Rent Control route, optional mediation choice. | Rent Control Department mandate under Act 220/PNDCL 138. | Confirm forum, mediation wording, jurisdiction and whether any clause could improperly restrict statutory remedies. |
| Notices | Define addresses/channels and when a notice is received. | Postal/digital address, email/phone where permitted, delivery evidence. | Agreement administration; Act 772 attribution/receipt provisions may be relevant. | Decide which tenancy/possession notices may legally be electronic and which require another form. |
| Electronic records and acceptance | Explain the exact record shown, hash, identity/session evidence and retention. | Hash scope, acceptance method, actor, timestamp, IP/user agent, template version. | Act 772 ss. 5–8, 11–15; electronic evidence and retention. | Determine whether residential tenancy falls outside any Act 772 exclusion involving interests in immovable property; specify signature/witness/notarisation requirements. |
| Stamping and registration | State that statutory stamping/registration is separate from Danpa HQ generation. | Stamp/registration status and references, without fabricated completion. | Act 689 and Act 1036. | Determine which residential tenancy instruments require stamp duty, registration, transaction certification or other formalities by term/type. |
| Data and privacy | Limit personal data shown in the agreement and explain retention/access. | Minimum party/occupant data, retention policy version, authorized viewers. | Act 843 data-protection principles; agreement evidence needs. | Confirm lawful basis, retention period, minor occupant data and subject-access/redaction rules. |
| Additional terms | Allow negotiated additions without rewriting standard clauses. | Ordered custom clauses with title/body and author; explicit `custom` label. | Product requirement and amendment evidence. | Define prohibited/conflicting content checks and precedence when a custom term conflicts with law or the standard template. |
| Entire agreement, severability and precedence | Explain how standard, negotiated and custom terms relate. | Template-controlled only. | Contract certainty. | Counsel must provide wording and decide precedence; Danpa HQ must not imply an unlawful term becomes valid through severability. |
| Amendments | Require a new immutable version and renewed review/acceptance for material changes. | `supersedes`, amendment reason, changed-section manifest, new hash/acceptances. | Existing Danpa HQ immutable/supersession architecture. | Define materiality and whether any changes need witnesses, stamping, registration or a distinct deed/addendum. |
| Acceptance record | Show both parties' recorded acts and the final provider confirmation. | Party, account identity, method, timestamp, hash, request evidence, confirmation event. | Evidence architecture; Act 772 evidential-weight factors. | Approve user-facing description; until then it must say “recorded acceptance,” not “legal electronic signature.” |

## Product decisions counsel must answer before production approval

1. What is the exact current advance-rent decision table under Act 220 s. 25(5)
   for monthly, shorter, fixed terms up to six months, and fixed terms exceeding
   six months? Must Danpa HQ block non-permitted terms?
2. Does Act 772's exclusion for a contract for sale or conveyance of immovable
   property or an interest in it affect a residential tenancy agreement, and
   what signature/witness process is sufficient for Danpa HQ's target leases?
3. Which agreements require stamping, registration, a Real Estate Transaction
   Certificate, witnessing, notarisation or another formality, by duration and
   contracting-party type?
4. Which provider identity is the legal landlord where a Property is managed by
   an organization, owner, manager or agent, and what evidence of authority must
   appear in the agreement?
5. What mandatory landlord/provider and tenant duties should appear, including
   repairs, condition, access, utilities, quiet enjoyment and safety?
6. What deposit purposes, custody, deduction evidence and return period are
   lawful and fair?
7. What notices can be electronic, what receipt rules apply, and when is each
   notice deemed received?
8. What lawful termination/possession wording and notice periods apply to each
   tenancy type? No self-help eviction mechanism will be built.
9. What retention period and disclosure/redaction rules apply to agreements,
   acceptance evidence, occupant data and generated PDFs?
10. Which custom terms must Danpa HQ prohibit or route to manual legal review?

## Versioning and release gate

Legal rules and clause text must be released as immutable versions. A new law,
interpretation or counsel-approved wording creates a new template/policy
version; it never rewrites an offered or accepted agreement. Every agreement
must retain:

- template code and version;
- legal-policy version and review status;
- complete structured terms;
- the complete rendered document shown to the parties;
- canonical content hash and hash scope;
- acceptance/confirmation evidence;
- any final PDF/document hash;
- supersession/amendment linkage.

Production must have an explicit configuration gate preventing an unreviewed
template version from being offered. Development and test environments may
exercise the complete lifecycle while the template remains visibly marked
`requires_ghana_legal_review`.
