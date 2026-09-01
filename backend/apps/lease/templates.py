"""Versioned Rooomly agreement releases.

The current release is intentionally marked as requiring Ghana-qualified legal
review. It exists so the lifecycle, rendering, evidence and clients can be
implemented and tested before counsel approves production wording. Production
offer gating lives in ``services.offer_lease``.
"""

from __future__ import annotations

from django.utils import timezone

from .models import LeaseTemplate, TemplateReviewStatus

CANONICAL_TEMPLATE_CODE = "rooomly.gh.residential"
CANONICAL_TEMPLATE_VERSION = "2026.08-draft.1"

SOURCE_MANIFEST = [
    {
        "instrument": "Rent Act, 1963 (Act 220), as amended",
        "url": "https://repository.parliament.gh/items/7ed7ce4b-e397-405a-892d-e9aa3a962195",
        "review_note": "Verify the current consolidated text and pending replacement bill.",
    },
    {
        "instrument": "Electronic Transactions Act, 2008 (Act 772), current version",
        "url": "https://ghalii.org/akn/gh/act/2008/772/eng@2020-12-29",
        "review_note": "Confirm residential-tenancy scope and signature formalities.",
    },
    {
        "instrument": "Stamp Duty Act, 2005 (Act 689)",
        "url": "https://ghalii.org/akn/gh/act/2005/689/eng@2005-06-03",
        "review_note": "Confirm stamping requirements for each agreement type and duration.",
    },
    {
        "instrument": "Land Act, 2020 (Act 1036)",
        "url": "https://ghalii.org/akn/gh/act/2020/1036/eng@2020-12-23",
        "review_note": "Confirm registration and land-interest implications.",
    },
]

# These are proposed controlled clauses, not a declaration of legal compliance.
# A provider may configure the values inserted into them, but may not rewrite
# their text. Any approved wording change creates a new template version.
CLAUSES = [
    {
        "id": "parties_and_premises",
        "title": "1. Parties and premises",
        "body": (
            "${provider_name} (the Provider) agrees to let ${premises} at ${address} to "
            "${tenant_name} (the Tenant) for residential use on the terms in this agreement. "
            "The parties and premises are identified from Rooomly records current when the "
            "offer is sent."
        ),
    },
    {
        "id": "term",
        "title": "2. Term and handover",
        "body": (
            "The agreed term begins on ${starts_on} and runs for ${term_description}. Any "
            "renewal or replacement arrangement must be recorded separately and does not "
            "rewrite this agreement."
        ),
    },
    {
        "id": "rent_and_payment",
        "title": "3. Rent and payment",
        "body": (
            "Rent is ${rent} per ${rent_period}. Payment is due ${payment_due}. The move-in "
            "amount recorded in this agreement is ${move_in_total}, including the stated "
            "advance, deposit and any agency fee."
        ),
    },
    {
        "id": "advance_and_receipts",
        "title": "4. Advance rent and receipts",
        "body": (
            "The agreed advance is ${advance_months} month(s). Rooomly records the legal-policy "
            "version considered when this offer was sent. A receipt for a rent payment should "
            "identify the premises, whether furnished, the amount, period covered and Tenant, "
            "together with any stamp required by law."
        ),
    },
    {
        "id": "deposit",
        "title": "5. Deposit",
        "body": (
            "The recorded deposit is ${deposit_months} month(s) of rent. Any deduction or "
            "return must be supported by the agreement, the condition record and payment "
            "evidence. This draft clause requires Ghana-qualified review before production."
        ),
    },
    {
        "id": "utilities",
        "title": "6. Utilities and services",
        "body": (
            "The parties record the following responsibility for utilities and services: "
            "${utilities}."
        ),
    },
    {
        "id": "occupants_and_use",
        "title": "7. Occupants and use",
        "body": (
            "The premises are for residential use. The permitted occupants recorded with this "
            "agreement are: ${occupants}. An occupant is not made a contracting Tenant merely "
            "by being listed here."
        ),
    },
    {
        "id": "responsibilities",
        "title": "8. Responsibilities",
        "body": (
            "Provider responsibilities: ${provider_responsibilities}. Tenant responsibilities: "
            "${tenant_responsibilities}. These structured responsibilities do not authorize "
            "either party to use unlawful self-help."
        ),
    },
    {
        "id": "repairs_access_condition",
        "title": "9. Condition, repairs and access",
        "body": (
            "The parties should use the recorded handover condition when deciding "
            "responsibility for damage or repair. Non-emergency access must follow the notice "
            "and purpose the parties lawfully agree; no notice period is invented by this draft "
            "template."
        ),
    },
    {
        "id": "ending_and_possession",
        "title": "10. Ending the arrangement",
        "body": (
            "Ending a Rooomly tenancy record does not itself recover possession or amount to an "
            "eviction. The parties must follow applicable Ghana law and any required notice or "
            "lawful process."
        ),
    },
    {
        "id": "records_notices_disputes",
        "title": "11. Records, notices and disputes",
        "body": (
            "Rooomly preserves the rendered agreement, its version and recorded acceptance "
            "evidence. The permitted notice channels are ${notice_channels}. Nothing here "
            "removes a party's right to use the Rent Control Department, a competent court or "
            "another lawful process."
        ),
    },
    {
        "id": "amendments",
        "title": "12. Amendments and additional terms",
        "body": (
            "Additional terms appear below and are identified as custom. They do not silently "
            "rewrite Rooomly's standard clauses. A material change after an offer or acceptance "
            "requires a new agreement version and renewed review and acceptance as appropriate."
        ),
    },
]


def canonical_template() -> LeaseTemplate:
    """Return the persisted release without mutating an existing version."""
    template, _ = LeaseTemplate.objects.get_or_create(
        code=CANONICAL_TEMPLATE_CODE,
        version=CANONICAL_TEMPLATE_VERSION,
        defaults={
            "jurisdiction": "GH",
            "agreement_type": "residential_tenancy",
            "title": "Rooomly Ghana Residential Tenancy Agreement",
            "review_status": TemplateReviewStatus.REQUIRES_REVIEW,
            "clauses": CLAUSES,
            "source_manifest": SOURCE_MANIFEST,
            "released_at": timezone.now(),
        },
    )
    return template
