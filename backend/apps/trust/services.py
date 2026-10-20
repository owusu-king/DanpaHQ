"""Verification service layer.

All state transitions live here rather than on the model, because each one has
to do several things atomically: write the decision, write the audit entry, emit
the event, and close the queue item. A model `save()` cannot be trusted to carry
that.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, ValidationFailed
from apps.outbox.services import emit

from .models import (
    VALIDITY_DAYS,
    EvidenceType,
    ReviewQueueEntry,
    SubjectType,
    Verification,
    VerificationEvidence,
    VerificationKind,
    VerificationMethod,
    VerificationStatus,
)

#: Agents and landlords are reviewed first: an unverified agent can take money
#: from many tenants, so the blast radius of a slow review is larger.
PRIORITY_BY_KIND = {
    VerificationKind.AGENCY: 10,
    VerificationKind.COMPANY: 20,
    VerificationKind.OWNERSHIP: 20,
    VerificationKind.PROPERTY_AUTHORITY: 10,
    #: Below authority: there is no point checking what a building looks
    #: like before establishing that this person may let it.
    VerificationKind.PROPERTY_CONDITION: 30,
    # A person waiting on this cannot use the product they signed up for at all,
    # so it outranks the per-property checks that only block one building.
    VerificationKind.PROVIDER: 5,
    # Waiting blocks nobody's home or money, only the applicant's new work.
    VerificationKind.ARTISAN: 30,
    VerificationKind.IDENTITY: 40,
    VerificationKind.SELFIE_MATCH: 40,
    VerificationKind.ADDRESS: 60,
    VerificationKind.BANK_ACCOUNT: 30,
    VerificationKind.PHONE: 90,
}


def current_for(subject_type: str, subject_id, kind: str) -> Verification | None:
    """The live check of one kind on one subject, if there is one.

    Asked per row on a listing, and two of the three asks are about the *actor*
    rather than the row — the same phone check and the same identity check,
    re-read once per property. Memoized only inside a declared read, so those
    collapse to one each for the whole page. See `apps.core.memo`.
    """
    from apps.core.memo import cached

    return cached(
        ("trust.current", subject_type, str(subject_id), kind),
        lambda: _current_for(subject_type, subject_id, kind),
    )


def _current_for(subject_type: str, subject_id, kind: str) -> Verification | None:
    return (
        Verification.objects.for_subject(subject_type, subject_id)
        .filter(kind=kind)
        .current()
        .first()
    )


def trust_summary(subject_type: str, subject_id) -> dict[str, dict]:
    """The stamps to show for a subject, including the ones that do not exist.

    Kinds with no record are returned as ``unverified`` rather than omitted. An
    absent stamp lets the interface imply a check happened; an explicit "not
    checked" does not.

    Reached several times per record on a listing — by the authority state, by
    the owner label that reads it, and by both halves of the verification
    lifecycle. Memoized only inside a declared read — see `apps.core.memo`.
    """
    from apps.core.memo import cached

    return cached(
        ("trust.summary", subject_type, str(subject_id)),
        lambda: _trust_summary(subject_type, subject_id),
    )


def _trust_summary(subject_type: str, subject_id) -> dict[str, dict]:
    rows = Verification.objects.for_subject(subject_type, subject_id).exclude(
        status=VerificationStatus.SUPERSEDED
    )
    return _summarize(rows)


def _summarize(rows) -> dict[str, dict]:
    latest: dict[str, Verification] = {}
    for row in rows:  # ordered newest first by Meta.ordering
        if row.status == VerificationStatus.SUPERSEDED:
            continue
        latest.setdefault(row.kind, row)

    summary = {}
    for kind in VerificationKind.values:
        record_ = latest.get(kind)
        summary[kind] = {
            "state": record_.display_state if record_ else "unverified",
            "decided_at": record_.decided_at if record_ else None,
            "expires_at": record_.expires_at if record_ else None,
            "method": record_.method if record_ else "",
        }
    return summary


def prime_subject_verifications(*, subject_type: str, subject_ids, rows) -> None:
    """Seed ``current_for`` and ``trust_summary`` from one batched read."""
    from apps.core.memo import prime

    grouped = {str(subject_id): [] for subject_id in subject_ids}
    for row in rows:
        grouped.setdefault(row.subject_id, []).append(row)

    for subject_id, subject_rows in grouped.items():
        prime(("trust.summary", subject_type, subject_id), _summarize(subject_rows))
        for kind in VerificationKind.values:
            current = next(
                (row for row in subject_rows if row.kind == kind and row.is_current),
                None,
            )
            prime(("trust.current", subject_type, subject_id, kind), current)


@transaction.atomic
def start_verification(
    *,
    subject_type: str,
    subject_id,
    kind: str,
    method: str,
    submitted_by=None,
    provider: str = "",
    queue: bool = True,
) -> Verification:
    """Open a verification. Refuses if a live one already exists for this kind.

    `queue=False` opens one without asking anyone to look at it yet. Condition
    reviews need that: their evidence arrives over several minutes and often
    several sittings, and a reviewer opening an empty submission learns nothing.
    See `trust.condition`, which owns the submission step that does queue it.
    """
    existing = (
        Verification.objects.for_subject(subject_type, subject_id)
        .filter(
            kind=kind,
            status__in=[
                VerificationStatus.PENDING,
                VerificationStatus.NEEDS_MORE,
                VerificationStatus.APPROVED,
            ],
        )
        .first()
    )
    if existing:
        if existing.status == VerificationStatus.APPROVED and existing.is_current:
            raise Conflict("This is already verified.")
        raise Conflict("A check is already in progress. We will let you know the outcome.")

    verification = Verification.objects.create(
        subject_type=subject_type,
        subject_id=str(subject_id),
        kind=kind,
        method=method,
        submitted_by=submitted_by,
        provider=provider,
        status=VerificationStatus.PENDING,
    )

    if queue and method in (VerificationMethod.DOCUMENT_REVIEW, VerificationMethod.SITE_VISIT):
        ReviewQueueEntry.objects.create(
            verification=verification, priority=PRIORITY_BY_KIND.get(kind, 50)
        )

    record(
        action=AuditAction.VERIFICATION_DECISION,
        aggregate_type="verification",
        aggregate_id=verification.id,
        actor=submitted_by,
        changes={"status": ["", VerificationStatus.PENDING]},
        metadata={"kind": kind, "subject": f"{subject_type}:{subject_id}"},
    )
    emit(
        DomainEvent(
            "trust.verification_started.v1",
            "verification",
            str(verification.id),
            {"kind": kind, "subject_type": subject_type, "subject_id": str(subject_id)},
        )
    )
    return verification


@transaction.atomic
def attach_evidence(
    verification: Verification,
    *,
    evidence_type: str,
    file=None,
    reference: str = "",
    collected_by=None,
    notes: str = "",
) -> VerificationEvidence:
    if verification.status not in (VerificationStatus.PENDING, VerificationStatus.NEEDS_MORE):
        raise Conflict("This check has already been decided. Start a new one.")

    if file is not None and not file.is_usable:
        raise ValidationFailed(
            "That file is still being checked for viruses. Try again in a moment."
        )

    evidence = VerificationEvidence.objects.create(
        verification=verification,
        evidence_type=evidence_type,
        file=file,
        reference=reference,
        checksum_at_attach=file.checksum_sha256 if file else "",
        collected_by=collected_by,
        notes=notes,
    )
    if verification.status == VerificationStatus.NEEDS_MORE:
        _return_to_queue(verification)
    return evidence


@transaction.atomic
def resubmit(verification: Verification) -> Verification:
    """Answer "more information needed" without a new document.

    Attaching evidence already does this. An answer can also be a correction to
    what the applicant told us — the wrong trade, the wrong area — which arrives
    through the subject's own domain and leaves nothing to attach.
    """
    if verification.status != VerificationStatus.NEEDS_MORE:
        raise Conflict("This check is not waiting for more information.")
    _return_to_queue(verification)
    return verification


def _return_to_queue(verification: Verification) -> None:
    verification.status = VerificationStatus.PENDING
    verification.decision_note = ""
    verification.save(update_fields=["status", "decision_note", "updated_at"])
    ReviewQueueEntry.objects.filter(verification=verification).update(
        claimed_by=None,
        claimed_by_management_id=None,
        claimed_at=None,
        claim_expires_at=None,
    )


@transaction.atomic
def decide(
    verification: Verification,
    *,
    approved: bool,
    decided_by=None,
    management_actor=None,
    note: str = "",
    internal_note: str = "",
    validity_days: int | None = None,
) -> Verification:
    """Approve or reject. Requires evidence for anything a human reviewed.

    The evidence requirement is not bureaucracy: a manual approval with nothing
    attached cannot be re-examined when the tenant it protected loses money.
    """
    if verification.status not in (VerificationStatus.PENDING, VerificationStatus.NEEDS_MORE):
        raise Conflict("This check has already been decided.")

    if (
        approved
        and verification.method != VerificationMethod.AUTOMATED_OTP
        and not verification.evidence.exists()
    ):
        raise ValidationFailed("Attach the evidence this decision is based on before approving.")

    if not approved and not note:
        raise ValidationFailed(
            "Say why this was rejected and what the person should do next. "
            "They will see this message."
        )

    previous = verification.status
    verification.status = VerificationStatus.APPROVED if approved else VerificationStatus.REJECTED
    verification.decided_by = decided_by
    verification.decided_by_management_id = getattr(management_actor, "id", None)
    verification.decided_at = timezone.now()
    verification.decision_note = note
    verification.internal_note = internal_note

    if approved:
        days = validity_days if validity_days is not None else VALIDITY_DAYS.get(verification.kind)
        verification.expires_at = verification.decided_at + timedelta(days=days) if days else None

    verification.save(
        update_fields=[
            "status",
            "decided_by",
            "decided_by_management_id",
            "decided_at",
            "decision_note",
            "internal_note",
            "expires_at",
            "updated_at",
        ]
    )

    # A provider application is deliberately an intake record, not a property.
    # Only an approved, evidenced authority decision materialises the property
    # and its usable relationship. The import stays function-scoped so the
    # trust and property domains do not acquire a module-level model cycle.
    if verification.subject_type == SubjectType.PROVIDER_APPLICATION:
        from apps.property.services import apply_provider_application_decision

        apply_provider_application_decision(
            verification=verification,
            approved=approved,
            reviewer=decided_by,
            management_actor=management_actor,
            note=note,
        )

    # A property's document and photo checks are internal parts of one
    # submission. Keep the package result current when the condition half is
    # decided through a non-management caller as well as through the atomic
    # operations endpoint.
    if (
        verification.subject_type == SubjectType.PROPERTY
        and verification.kind == VerificationKind.PROPERTY_CONDITION
    ):
        from apps.property.services import (
            property_submission_for_verification,
            sync_property_submission_status,
        )

        application = property_submission_for_verification(verification)
        if application is not None:
            sync_property_submission_status(application=application, note=note)

    if not approved:
        from apps.property.access_codes import revoke_for_verification_subject

        revoke_for_verification_subject(
            subject_type=verification.subject_type,
            subject_id=verification.subject_id,
            actor=decided_by,
            management_actor=management_actor,
            reason="verification_rejected",
        )

    # An account-level provider decision changes what the person can reach on
    # every property at once, so the coarse navigation role is kept in step with
    # it here rather than being set anywhere a client can reach.
    if (
        verification.subject_type == SubjectType.USER
        and verification.kind == VerificationKind.PROVIDER
    ):
        from apps.identity.services import apply_provider_decision

        apply_provider_decision(
            verification=verification,
            approved=approved,
            decided_by=decided_by,
            management_actor=management_actor,
        )

    # Approving an artisan also answers who they are, when they sent their ID
    # with the application. Nothing else follows: the experience is read live
    # from this row, so there is no role to keep in step.
    if (
        verification.subject_type == SubjectType.USER
        and verification.kind == VerificationKind.ARTISAN
        and approved
    ):
        from apps.artisan.services import apply_artisan_approval

        apply_artisan_approval(
            verification=verification,
            decided_by=decided_by,
            management_actor=management_actor,
        )

    ReviewQueueEntry.objects.filter(verification=verification, resolved_at__isnull=True).update(
        resolved_at=timezone.now()
    )

    record(
        action=AuditAction.VERIFICATION_DECISION,
        aggregate_type="verification",
        aggregate_id=verification.id,
        actor=decided_by,
        management_actor=management_actor,
        changes={"status": [previous, verification.status]},
        metadata={
            "kind": verification.kind,
            "subject": f"{verification.subject_type}:{verification.subject_id}",
            "expires_at": verification.expires_at.isoformat() if verification.expires_at else None,
        },
    )
    emit(
        DomainEvent(
            "trust.verification_decided.v1",
            "verification",
            str(verification.id),
            {
                "kind": verification.kind,
                "approved": approved,
                "subject_type": verification.subject_type,
                "subject_id": verification.subject_id,
                "expires_at": verification.expires_at.isoformat()
                if verification.expires_at
                else None,
            },
        )
    )
    return verification


@transaction.atomic
def request_more_information(
    verification: Verification, *, note: str, decided_by=None, management_actor=None
):
    if not note:
        raise ValidationFailed("Say exactly what is missing. The person will see this message.")

    verification.status = VerificationStatus.NEEDS_MORE
    verification.decision_note = note
    verification.save(update_fields=["status", "decision_note", "updated_at"])

    if verification.subject_type == SubjectType.PROVIDER_APPLICATION:
        from apps.property.services import mark_provider_application_needs_more

        mark_provider_application_needs_more(
            verification=verification,
            reviewer=decided_by,
            management_actor=management_actor,
            note=note,
        )

    if (
        verification.subject_type == SubjectType.PROPERTY
        and verification.kind == VerificationKind.PROPERTY_CONDITION
    ):
        from apps.property.services import (
            property_submission_for_verification,
            sync_property_submission_status,
        )

        application = property_submission_for_verification(verification)
        if application is not None:
            sync_property_submission_status(application=application, note=note)

    from apps.property.access_codes import revoke_for_verification_subject

    revoke_for_verification_subject(
        subject_type=verification.subject_type,
        subject_id=verification.subject_id,
        actor=decided_by,
        management_actor=management_actor,
        reason="verification_changes_requested",
    )

    record(
        action=AuditAction.VERIFICATION_DECISION,
        aggregate_type="verification",
        aggregate_id=verification.id,
        actor=decided_by,
        management_actor=management_actor,
        changes={"status": [VerificationStatus.PENDING, VerificationStatus.NEEDS_MORE]},
    )
    emit(
        DomainEvent(
            "trust.verification_needs_info.v1",
            "verification",
            str(verification.id),
            {"kind": verification.kind, "note": note},
        )
    )
    return verification


@transaction.atomic
def revoke(
    verification: Verification, *, reason: str, decided_by=None, management_actor=None
) -> Verification:
    """Withdraw a verification that should no longer stand.

    Used when evidence turns out to be forged, a licence lapses, or a person is
    found to be operating for someone else. The row stays; its status changes.
    """
    if verification.status != VerificationStatus.APPROVED:
        raise Conflict("Only an approved check can be revoked.")
    if not reason:
        raise ValidationFailed("Record why this verification is being revoked.")

    verification.status = VerificationStatus.REVOKED
    verification.decision_note = reason
    verification.save(update_fields=["status", "decision_note", "updated_at"])

    from apps.listing.services import suspend_for_verification

    suspend_for_verification(
        subject_type=verification.subject_type,
        subject_id=verification.subject_id,
        kind=verification.kind,
        reason=reason,
    )
    if (
        verification.subject_type == SubjectType.PROPERTY
        and verification.kind == VerificationKind.PROPERTY_AUTHORITY
    ):
        from apps.property.services import suspend_property_authority

        suspend_property_authority(verification=verification)

    if (
        verification.subject_type == SubjectType.USER
        and verification.kind == VerificationKind.PROVIDER
    ):
        from apps.identity.services import apply_provider_decision

        apply_provider_decision(verification=verification, approved=False)

    from apps.property.access_codes import revoke_for_verification_subject

    revoke_for_verification_subject(
        subject_type=verification.subject_type,
        subject_id=verification.subject_id,
        actor=decided_by,
        management_actor=management_actor,
        reason="verification_revoked",
    )

    record(
        action=AuditAction.VERIFICATION_DECISION,
        aggregate_type="verification",
        aggregate_id=verification.id,
        actor=decided_by,
        management_actor=management_actor,
        changes={"status": [VerificationStatus.APPROVED, VerificationStatus.REVOKED]},
        metadata={"reason": reason},
    )
    emit(
        DomainEvent(
            "trust.verification_revoked.v1",
            "verification",
            str(verification.id),
            {"kind": verification.kind, "subject_id": verification.subject_id},
        )
    )
    return verification


@transaction.atomic
def supersede_and_restart(
    verification: Verification, *, method: str, submitted_by=None
) -> Verification:
    """Re-check something already decided, keeping the old decision readable."""
    verification.status = VerificationStatus.SUPERSEDED
    verification.save(update_fields=["status", "updated_at"])

    replacement = Verification.objects.create(
        subject_type=verification.subject_type,
        subject_id=verification.subject_id,
        kind=verification.kind,
        method=method,
        submitted_by=submitted_by,
        supersedes=verification,
    )
    if method in (VerificationMethod.DOCUMENT_REVIEW, VerificationMethod.SITE_VISIT):
        ReviewQueueEntry.objects.create(
            verification=replacement, priority=PRIORITY_BY_KIND.get(verification.kind, 50)
        )
    return replacement


def record_phone_verification(user, *, challenge_id: str) -> Verification:
    """The automatic phone verification created when an OTP succeeds.

    Automated, so no reviewer and no document - but still a full record with a
    method, an evidence row pointing at the challenge, and an expiry, because
    numbers get reassigned and a five-year-old phone check is not a fact.
    """
    existing = current_for(SubjectType.USER, user.id, VerificationKind.PHONE)
    if existing:
        return existing

    verification = Verification.objects.create(
        subject_type=SubjectType.USER,
        subject_id=str(user.id),
        kind=VerificationKind.PHONE,
        method=VerificationMethod.AUTOMATED_OTP,
        status=VerificationStatus.APPROVED,
        submitted_by=user,
        decided_at=timezone.now(),
        expires_at=timezone.now() + timedelta(days=VALIDITY_DAYS[VerificationKind.PHONE]),
    )
    VerificationEvidence.objects.create(
        verification=verification,
        evidence_type=EvidenceType.OTP_CONFIRMATION,
        reference=str(challenge_id),
    )
    return verification
