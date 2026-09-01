"""Freezing an agreement, and recording who accepted it.

The lease row is a live thing: it ends, it is superseded, later phases add
fields to it. None of that may change what the parties agreed. So at the moment
the offer is made, the terms are copied out whole, hashed, and never touched
again.

The hash is the part that earns its keep. Eight months later, "we agreed six
months, not twelve" is answerable not because a row says twelve but because two
people accepted the same hash of the same words, and the stored words still
hash to it. If they ever stop matching, the record says so rather than quietly
presenting today's terms as what was agreed.

**None of this claims to be a legally binding electronic signature.** See
``LeaseAgreement`` for what that means and what would have to happen for it to.
"""

from __future__ import annotations

import hashlib
import json

from django.utils import timezone

from . import advance_policy
from .models import (
    TERMS_SCHEMA_VERSION,
    AcceptanceMethod,
    AcceptanceParty,
    AgreementHashScope,
    Lease,
    LeaseAcceptance,
    LeaseAgreement,
    LeaseWorkflow,
)


def canonical_hash(terms: dict) -> str:
    """A stable SHA-256 of the terms.

    Canonical means the same terms always produce the same hash regardless of
    key order or whitespace - otherwise re-serialising the identical agreement
    would "prove" it had been altered. Keys sorted, no incidental spacing, and
    `ensure_ascii=False` so a name with a non-ASCII character hashes as the text
    it is rather than as its escape sequence.
    """
    encoded = json.dumps(
        terms, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def freeze_terms(lease: Lease) -> dict:
    """Everything a dispute could turn on, copied out of the lease.

    Values, not references. Identifiers are included so the agreement can be
    tied back to what it was about, but the *substance* - the rent, the dates,
    what was included - is stored as text and numbers that no later edit to a
    property, a listing or a user profile can reach.
    """
    prop = lease.unit.property
    return {
        "schema_version": TERMS_SCHEMA_VERSION,
        "lease_id": str(lease.id),
        "property": {
            "id": str(prop.id),
            "title": prop.title,
            "address": str(prop.address) if prop.address_id else "",
        },
        "space": {
            "unit_id": str(lease.unit_id),
            "unit_label": lease.unit.label,
            "space_type": lease.unit.space_type,
            "bed_id": str(lease.bed_id) if lease.bed_id else None,
            "bed_label": lease.bed.label if lease.bed_id else None,
        },
        "parties": {
            "landlord": {
                "id": str(lease.landlord_id),
                "name": lease.landlord.display_name,
            },
            "tenant": {"id": str(lease.tenant_id), "name": lease.tenant.display_name},
        },
        "money": {
            "rent_minor": lease.rent_minor,
            "rent_currency": lease.rent_currency,
            "rent_period": lease.rent_period,
            "advance_months": lease.advance_months,
            "deposit_months": lease.deposit_months,
            "agency_fee_months": lease.agency_fee_months,
            "move_in_total_minor": lease.move_in_total_minor,
        },
        "term": {
            "starts_on": str(lease.starts_on) if lease.starts_on else None,
            "ends_on": str(lease.ends_on) if lease.ends_on else None,
            "term_months": lease.term_months,
        },
        "conditions": lease.conditions,
        "negotiated": lease.structured_terms or {},
        "template": (
            {
                "code": lease.template.code,
                "version": lease.template.version,
                "review_status": lease.template.review_status,
            }
            if lease.template_id
            else None
        ),
    }


def evidence_from(request) -> dict:
    """The thin circumstances worth keeping about an acceptance.

    Enough to corroborate that a particular person did this from a particular
    place at a particular time. Not a device fingerprint: the purpose is a
    record that stands up in a disagreement, not surveillance of the parties.
    """
    if request is None:
        return {}
    meta = getattr(request, "META", {}) or {}
    forwarded = (meta.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
    return {
        "ip_address": forwarded or meta.get("REMOTE_ADDR") or None,
        "user_agent": (meta.get("HTTP_USER_AGENT") or "")[:300],
    }


def execute_offer(*, lease: Lease, actor, evidence: dict | None = None) -> LeaseAgreement:
    """Freeze the terms as the offer goes out, and record the offering party.

    Deliberately at offer time rather than at activation. The offer *is* the
    proposal - it is the text the tenant is shown and asked to agree to - so
    freezing it here means the tenant accepts a hash that already exists rather
    than one computed afterwards from a row that could have moved.
    """
    terms = freeze_terms(lease)
    assessment = advance_policy.assess(
        advance_months=lease.advance_months, rent_period=lease.rent_period
    )

    values = {
        "lease": lease,
        "terms": terms,
        "schema_version": TERMS_SCHEMA_VERSION,
        "advance_stance": assessment.stance,
        "advance_threshold_months": assessment.threshold_months,
    }
    if lease.workflow_version == LeaseWorkflow.CANONICAL:
        from .documents import render_agreement

        rendered, rendered_text = render_agreement(
            lease=lease, template=lease.template, terms=terms
        )
        values.update(
            {
                "content_hash": canonical_hash(rendered),
                "hash_scope": AgreementHashScope.RENDERED,
                "template_code": lease.template.code,
                "template_version": lease.template.version,
                "legal_review_status": lease.template.review_status,
                "reference_number": rendered["reference_number"],
                "rendered_document": rendered,
                "rendered_text": rendered_text,
            }
        )
    else:
        values.update(
            {
                "content_hash": canonical_hash(terms),
                "hash_scope": AgreementHashScope.TERMS,
            }
        )

    agreement = LeaseAgreement.objects.create(**values)
    # The legacy workflow treated sending as the provider's acceptance. New
    # canonical agreements separate the proposal from the provider's final
    # confirmation after the tenant has reviewed and accepted it.
    if lease.workflow_version == LeaseWorkflow.LEGACY:
        record_acceptance(
            agreement=agreement,
            party=AcceptanceParty.LANDLORD,
            user=actor,
            evidence=evidence,
        )
    return agreement


def record_acceptance(
    *,
    agreement: LeaseAgreement,
    party: str,
    user,
    evidence: dict | None = None,
    method: str = AcceptanceMethod.IN_APP,
) -> LeaseAcceptance:
    """One party's act of agreeing.

    The hash is copied from the agreement as it stands *now*, which is what this
    person is agreeing to. Stored on the acceptance rather than read through the
    relation later, so that if the two ever diverge the record shows a
    divergence instead of hiding one.
    """
    evidence = evidence or {}
    return LeaseAcceptance.objects.create(
        agreement=agreement,
        party=party,
        user=user,
        accepted_at=timezone.now(),
        method=method,
        content_hash=agreement.content_hash,
        ip_address=evidence.get("ip_address"),
        user_agent=evidence.get("user_agent", ""),
    )


def mark_executed(*, agreement: LeaseAgreement, acknowledged: bool = False) -> None:
    """Both parties have now accepted."""
    now = timezone.now()
    agreement.executed_at = now
    agreement.advance_acknowledged = acknowledged
    update_fields = ["executed_at", "advance_acknowledged", "updated_at"]
    if agreement.rendered_document:
        from .pdf import render_final_pdf

        pdf = render_final_pdf(agreement)
        agreement.final_pdf = pdf
        agreement.final_pdf_hash = hashlib.sha256(pdf).hexdigest()
        agreement.final_pdf_generated_at = now
        update_fields.extend(["final_pdf", "final_pdf_hash", "final_pdf_generated_at"])
    agreement.save(update_fields=update_fields)


def verify(agreement: LeaseAgreement) -> dict:
    """Whether the stored terms are still the ones that were accepted.

    Two separate questions, kept separate because they fail for different
    reasons. The terms could have been altered in the database, which
    `hash_matches` catches. Or a party could have accepted some other version,
    which only comparing each acceptance catches.
    """
    material = (
        agreement.rendered_document
        if agreement.hash_scope == AgreementHashScope.RENDERED
        else agreement.terms
    )
    recomputed = canonical_hash(material)
    acceptances = list(agreement.acceptances.all())
    return {
        "hash_matches": recomputed == agreement.content_hash,
        "stored_hash": agreement.content_hash,
        "recomputed_hash": recomputed,
        "accepted_by": [
            {
                "party": a.party,
                "accepted_at": a.accepted_at,
                "method": a.method,
                "matches": a.content_hash == agreement.content_hash,
            }
            for a in acceptances
        ],
        "fully_accepted": {a.party for a in acceptances}
        >= {AcceptanceParty.LANDLORD, AcceptanceParty.TENANT},
    }
