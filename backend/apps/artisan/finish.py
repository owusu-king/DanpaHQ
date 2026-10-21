"""Finishing work: the artisan reports it done, it is confirmed, paid, reviewed.

The same four steps on a repair and on a direct job, with the confirmation in
the place each already keeps it:

* **Done.** Only the artisan the payer approved reports the work done, with
  photographs of it and any receipts. On a repair that is the same move as the
  provider's "fixed" (``maintenance.services.artisan_reported_fixed``), so the
  tenant confirms or reopens it exactly as before. On a direct job the person
  who posted it confirms or reopens it here.
* **Paid.** Once the work is confirmed, the payer records that they paid the
  price on record. Nothing moves — Danpa HQ holds no money. On a repair the
  payment is mirrored into the property's books as a maintenance expense.
* **Reviewed.** Once confirmed, the payer may write one review: a few words and
  whether they would hire the artisan again. No score.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.files.models import FilePurpose
from apps.outbox.services import emit

from .models import (
    ArtisanReview,
    DirectJobStatus,
    QuoteInvitation,
    QuoteStatus,
    WorkFileKind,
    WorkReport,
    WorkReportFile,
)
from .quotes import _Subject, _subject_of
from .services import _ready_file

MAX_DONE_PHOTOS = 6
MAX_RECEIPTS = 6


def _held_invitation(*, user, invitation_id, lock: bool = False) -> QuoteInvitation:
    rows = QuoteInvitation.objects.select_related("artisan__user")
    if lock:
        rows = rows.select_for_update(of=("self",))
    invitation = rows.filter(id=invitation_id, artisan__user=user).first()
    if invitation is None:
        raise NotFound("We could not find that job.")
    return invitation


def is_finished(subject: _Subject) -> bool:
    """Confirmed done by whoever confirms this kind of work."""
    if subject.kind == "maintenance":
        from apps.maintenance.models import MaintenanceStatus

        return subject.record.status == MaintenanceStatus.COMPLETED
    return subject.record.status == DirectJobStatus.COMPLETED


def _files(*, user, ids, purpose: str, what: str, limit: int) -> list:
    ids = list(dict.fromkeys(str(value) for value in (ids or [])))
    if len(ids) > limit:
        raise ValidationFailed(f"Add up to {limit} {what}s.")
    return [_ready_file(user=user, file_id=file_id, purpose=purpose, what=what) for file_id in ids]


# --- done ---------------------------------------------------------------------------


@transaction.atomic
def report_done(*, user, invitation_id, note="", photo_file_ids=None, receipt_file_ids=None):
    """The assigned artisan says the work is finished. The other side confirms it."""
    invitation = _held_invitation(user=user, invitation_id=invitation_id, lock=True)
    subject = _subject_of(invitation, lock=True)
    if subject.record.assigned_artisan_id != invitation.artisan_id:
        raise NotFound("We could not find that job.")
    photos = _files(
        user=user,
        ids=photo_file_ids,
        purpose=FilePurpose.ARTISAN_WORK_DONE_PHOTO,
        what="photo of the finished work",
        limit=MAX_DONE_PHOTOS,
    )
    if not photos:
        raise ValidationFailed("Add at least one photo of the finished work.")
    receipts = _files(
        user=user,
        ids=receipt_file_ids,
        purpose=FilePurpose.ARTISAN_RECEIPT,
        what="receipt",
        limit=MAX_RECEIPTS,
    )
    note = (note or "").strip()[:500]

    if subject.kind == "maintenance":
        from apps.maintenance import services as maintenance_services

        maintenance_services.artisan_reported_fixed(request=subject.record, user=user, note=note)
    else:
        job = subject.record
        if job.status != DirectJobStatus.ASSIGNED:
            raise Conflict("This job is not waiting on the work.")
        job.status = DirectJobStatus.DONE_REPORTED
        job.save(update_fields=["status", "updated_at"])

    report = WorkReport.objects.create(invitation=invitation, note=note, submitted_by=user)
    WorkReportFile.objects.bulk_create(
        [WorkReportFile(report=report, file=file, kind=WorkFileKind.PHOTO) for file in photos]
        + [WorkReportFile(report=report, file=file, kind=WorkFileKind.RECEIPT) for file in receipts]
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="artisan_work_report",
        aggregate_id=report.id,
        actor=user,
        metadata={**subject.payload, "photos": len(photos), "receipts": len(receipts)},
    )
    emit(
        DomainEvent(
            "artisan.work_reported.v1",
            "artisan_work_report",
            str(report.id),
            dict(subject.payload),
        )
    )
    return report


# --- a direct job's answer ------------------------------------------------------------


def _own_job_awaiting(*, user, job_id):
    from .jobs import own_job

    job = own_job(user=user, job_id=job_id, lock=True)
    if job.status != DirectJobStatus.DONE_REPORTED:
        raise Conflict("There is no finished work waiting for your answer.")
    report = (
        WorkReport.objects.select_for_update()
        .filter(invitation__direct_job=job, confirmed_at__isnull=True, reopened_at__isnull=True)
        .order_by("-created_at")
        .first()
    )
    return job, report


@transaction.atomic
def confirm_job(*, user, job_id):
    job, report = _own_job_awaiting(user=user, job_id=job_id)
    now = timezone.now()
    job.status = DirectJobStatus.COMPLETED
    job.completed_at = now
    job.save(update_fields=["status", "completed_at", "updated_at"])
    if report is not None:
        report.confirmed_at = now
        report.save(update_fields=["confirmed_at", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="artisan_direct_job",
        aggregate_id=job.id,
        actor=user,
        changes={"status": [DirectJobStatus.DONE_REPORTED, DirectJobStatus.COMPLETED]},
    )
    emit(
        DomainEvent(
            "artisan.work_confirmed.v1",
            "artisan_direct_job",
            str(job.id),
            {"user_id": str(job.assigned_artisan.user_id)},
        )
    )
    return job


@transaction.atomic
def reopen_job(*, user, job_id, reason):
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise ValidationFailed("Say what is still not right, so it can be put right.")
    job, report = _own_job_awaiting(user=user, job_id=job_id)
    job.status = DirectJobStatus.ASSIGNED
    job.save(update_fields=["status", "updated_at"])
    if report is not None:
        report.reopened_at = timezone.now()
        report.reopen_reason = reason[:500]
        report.save(update_fields=["reopened_at", "reopen_reason", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="artisan_direct_job",
        aggregate_id=job.id,
        actor=user,
        changes={"status": [DirectJobStatus.DONE_REPORTED, DirectJobStatus.ASSIGNED]},
        metadata={"reason": reason[:200]},
    )
    emit(
        DomainEvent(
            "artisan.work_reopened.v1",
            "artisan_direct_job",
            str(job.id),
            {"user_id": str(job.assigned_artisan.user_id), "reason": reason[:200]},
        )
    )
    return job


# --- paid and reviewed --------------------------------------------------------------


def _finished_for_payer(*, user, invitation_id) -> tuple[QuoteInvitation, _Subject]:
    """The assigned invitation of finished work, for its payer — or a 404 / 403."""
    invitation = (
        QuoteInvitation.objects.select_for_update(of=("self",))
        .select_related("artisan__user")
        .filter(id=invitation_id)
        .first()
    )
    if invitation is None:
        raise NotFound("We could not find that job.")
    subject = _subject_of(invitation, lock=True)
    if not subject.may_invite(user) and not subject.may_pay(user):
        raise NotFound("We could not find that job.")
    if not subject.may_pay(user):
        raise PermissionDenied(
            "Only the owner, a Portfolio owner or administrator, or the Property Manager "
            "assigned to this property can do this."
        )
    if subject.record.assigned_artisan_id != invitation.artisan_id:
        raise NotFound("We could not find that job.")
    if not is_finished(subject):
        raise Conflict("Wait until the work is confirmed done.")
    return invitation, subject


@transaction.atomic
def record_paid(*, user, invitation_id):
    """The payer says they paid the price on record. Recorded, not moved."""
    invitation, subject = _finished_for_payer(user=user, invitation_id=invitation_id)
    quote = subject.record.assigned_quote
    if quote is None or quote.status != QuoteStatus.APPROVED:
        raise Conflict("There is no approved price on record.")
    if quote.paid_at:
        raise Conflict("Payment is already recorded.")
    quote.paid_at = timezone.now()
    quote.paid_recorded_by = user
    fields = ["paid_at", "paid_recorded_by", "updated_at"]

    if subject.kind == "maintenance":
        from apps.rent.services import record_artisan_payment

        request = subject.record
        expense = record_artisan_payment(
            prop=request.property,
            user=user,
            amount_minor=quote.price_minor,
            note=(
                f"Artisan: {invitation.artisan.user.display_name}, "
                f"{request.get_category_display().lower()} repair"
            ),
        )
        if expense is not None:
            quote.expense_id = expense.id
            fields.append("expense_id")
    quote.save(update_fields=fields)
    record(
        action=AuditAction.UPDATE,
        aggregate_type="artisan_quote",
        aggregate_id=quote.id,
        actor=user,
        metadata={**subject.payload, "paid_minor": quote.price_minor},
    )
    emit(
        DomainEvent(
            "artisan.paid_recorded.v1",
            "artisan_quote",
            str(quote.id),
            {"user_id": str(invitation.artisan.user_id), "invitation_id": str(invitation.id)},
        )
    )
    return quote


@transaction.atomic
def review(*, user, invitation_id, text, would_hire_again: bool) -> ArtisanReview:
    invitation, subject = _finished_for_payer(user=user, invitation_id=invitation_id)
    text = (text or "").strip()
    if len(text) < 10:
        raise ValidationFailed("Say in a sentence or two how the work went.")
    if ArtisanReview.objects.filter(invitation=invitation).exists():
        raise Conflict("This job already has a review.")
    written = ArtisanReview.objects.create(
        invitation=invitation,
        artisan=invitation.artisan,
        author=user,
        text=text[:1000],
        would_hire_again=bool(would_hire_again),
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="artisan_review",
        aggregate_id=written.id,
        actor=user,
        metadata=dict(subject.payload),
    )
    emit(
        DomainEvent(
            "artisan.reviewed.v1",
            "artisan_review",
            str(written.id),
            {"user_id": str(invitation.artisan.user_id), "invitation_id": str(invitation.id)},
        )
    )
    return written
