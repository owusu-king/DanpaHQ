"""Report a problem: on an artisan's profile, or on one job.

A report goes to Management's existing reports queue (``apps.operations``); this
module only decides who may report what, and keeps the evidence. Evidence is
the files the reporter attached and a snapshot of the record as it stood — the
prices, who approved them, every "done" the artisan reported and its photos —
so what Management reviews cannot change after the report is made.

Danpa HQ reviews reports and can suspend an artisan; it does not arbitrate
disputes or decide who owes whom.
"""

from __future__ import annotations

from django.db import transaction

from apps.core.exceptions import NotFound, ValidationFailed
from apps.files.models import FilePurpose

from .models import ArtisanProfile, QuoteInvitation, WorkFileKind
from .services import _ready_file

MAX_EVIDENCE_FILES = 5

#: What a customer may report about an artisan, on a profile or a job.
ABOUT_ARTISAN = {
    "poor_work": "Poor or unfinished work",
    "no_show": "Did not turn up",
    "overcharging": "Asked for more than the agreed price",
    "conduct": "Rude or inappropriate behaviour",
    "safety": "Unsafe work or a safety concern",
    "fake_profile": "Not who they say they are",
    "other": "Something else",
}
#: What an artisan may report about the customer on a job.
ABOUT_CUSTOMER = {
    "not_paid": "Not paid as agreed",
    "conduct": "Rude or inappropriate behaviour",
    "safety": "A safety concern on site",
    "other": "Something else",
}


def _evidence_files(*, user, ids) -> list[str]:
    ids = list(dict.fromkeys(str(value) for value in (ids or [])))
    if len(ids) > MAX_EVIDENCE_FILES:
        raise ValidationFailed(f"Attach up to {MAX_EVIDENCE_FILES} files.")
    return [
        str(
            _ready_file(
                user=user, file_id=file_id, purpose=FilePurpose.REPORT_EVIDENCE, what="evidence"
            ).id
        )
        for file_id in ids
    ]


def _clean(*, category, summary, choices) -> tuple[str, str]:
    if category not in choices:
        raise ValidationFailed("Choose what went wrong.")
    summary = (summary or "").strip()
    if len(summary) < 5:
        raise ValidationFailed("Say in a few words what happened.")
    return category, summary


@transaction.atomic
def report_artisan(*, user, artisan_id, category, summary, details="", file_ids=None):
    from apps.operations.services import create_consumer_report

    profile = ArtisanProfile.objects.select_related("user").filter(id=artisan_id).first()
    if profile is None or profile.user_id == user.id:
        raise NotFound("We could not find that artisan.")
    category, summary = _clean(category=category, summary=summary, choices=ABOUT_ARTISAN)
    return create_consumer_report(
        user=user,
        subject_type="artisan",
        subject_id=profile.id,
        category=category,
        summary=summary,
        details=details or "",
        evidence={
            "files": _evidence_files(user=user, ids=file_ids),
            "snapshot": {"artisan": profile.user.display_name, "trades": list(profile.trades)},
        },
    )


def _job_parties(invitation: QuoteInvitation, subject, user) -> str | None:
    """Who this reader is to the job: "customer", "artisan", or nobody."""
    if invitation.artisan.user_id == user.id:
        return "artisan"
    if subject.may_pay(user) or subject.may_invite(user):
        return "customer"
    if subject.kind == "maintenance" and str(subject.record.tenant_id) == str(user.id):
        return "customer"
    return None


def _snapshot(invitation: QuoteInvitation, subject) -> dict:
    record = subject.record
    return {
        "kind": subject.kind,
        "title": record.get_category_display() if subject.kind == "maintenance" else record.title,
        "status": record.status,
        "artisan": invitation.artisan.user.display_name,
        "quotes": [
            {
                "price_minor": quote.price_minor,
                "status": quote.status,
                "scope": quote.scope,
                "reason": quote.reason,
                "decided_at": quote.decided_at.isoformat() if quote.decided_at else None,
                "paid_at": quote.paid_at.isoformat() if quote.paid_at else None,
            }
            for quote in invitation.quotes.all()
        ],
        "work_reports": [
            {
                "note": report.note,
                "at": report.created_at.isoformat(),
                "photos": [
                    str(row.file_id) for row in report.files.all() if row.kind == WorkFileKind.PHOTO
                ],
                "receipts": [
                    str(row.file_id)
                    for row in report.files.all()
                    if row.kind == WorkFileKind.RECEIPT
                ],
                "reopen_reason": report.reopen_reason,
            }
            for report in invitation.work_reports.all()
        ],
    }


@transaction.atomic
def report_job(*, user, invitation_id, category, summary, details="", file_ids=None):
    """Either side of a job reports a problem with it, with the record as it stands."""
    from apps.operations.services import create_consumer_report

    from .quotes import _subject_of

    invitation = (
        QuoteInvitation.objects.select_related("artisan__user")
        .prefetch_related("quotes", "work_reports__files")
        .filter(id=invitation_id)
        .first()
    )
    if invitation is None:
        raise NotFound("We could not find that job.")
    subject = _subject_of(invitation)
    side = _job_parties(invitation, subject, user)
    # Only work an artisan was given can be reported as a job: before that it
    # is a quote, and a quote has nothing to dispute.
    if side is None or subject.record.assigned_artisan_id != invitation.artisan_id:
        raise NotFound("We could not find that job.")
    choices = ABOUT_CUSTOMER if side == "artisan" else ABOUT_ARTISAN
    category, summary = _clean(category=category, summary=summary, choices=choices)
    return create_consumer_report(
        user=user,
        subject_type="artisan_job",
        subject_id=invitation.id,
        category=category,
        summary=summary,
        details=details or "",
        evidence={
            "files": _evidence_files(user=user, ids=file_ids),
            "reported_by_side": side,
            "snapshot": _snapshot(invitation, subject),
        },
    )
