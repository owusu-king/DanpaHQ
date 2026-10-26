"""Direct jobs: work a tenant or provider hires an artisan for themselves.

No property and no repair stand behind one, so nothing here touches
maintenance. Whoever posts the job is its payer. Quoting, approval and revised
quotes are the same rules as on a repair (``quotes``); this module only posts
and cancels the job itself.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, ValidationFailed
from apps.files.models import FilePurpose
from apps.outbox.services import emit

from .models import DirectJob, DirectJobStatus, Quote, QuoteStatus, Trade
from .services import _ready_file


def _locality(locality_id):
    from apps.geo.models import Locality

    found = (
        Locality.objects.select_related("district__region")
        .filter(id=locality_id, is_active=True)
        .first()
    )
    if found is None:
        raise ValidationFailed("Choose the area from the list.")
    return found


@transaction.atomic
def create_job(
    *,
    user,
    trade,
    title,
    description,
    locality_id,
    photo_file_id=None,
    house_number="",
    street="",
    landmark="",
    invite_artisan_id=None,
) -> DirectJob:
    """Post a job. Posted from an artisan's profile, that artisan is asked at once."""
    if trade not in Trade.values:
        raise ValidationFailed("Choose the trade from the list.")
    title = (title or "").strip()
    if len(title) < 3:
        raise ValidationFailed("Give the job a short title.")
    description = (description or "").strip()
    if len(description) < 10:
        raise ValidationFailed("Say in a sentence or two what needs doing.")
    photo = None
    if photo_file_id:
        photo = _ready_file(
            user=user,
            file_id=photo_file_id,
            purpose=FilePurpose.ARTISAN_JOB_PHOTO,
            what="a photo of the job",
        )
    job = DirectJob.objects.create(
        owner=user,
        trade=trade,
        title=title[:120],
        description=description[:2000],
        photo=photo,
        locality=_locality(locality_id),
        house_number=(house_number or "").strip()[:32],
        street=(street or "").strip()[:160],
        landmark=(landmark or "").strip()[:200],
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="artisan_direct_job",
        aggregate_id=job.id,
        actor=user,
        metadata={"trade": trade},
    )
    if invite_artisan_id:
        from .quotes import invite_to_job

        # Same transaction: a job posted "for" an artisan who cannot be asked
        # (suspended, or yourself) is not left behind half-done.
        invite_to_job(user=user, job_id=job.id, artisan_id=invite_artisan_id)
    return job


def own_job(*, user, job_id, lock: bool = False) -> DirectJob:
    rows = DirectJob.objects.select_related(
        "owner",
        "photo",
        "locality__district__region",
        "assigned_artisan__user",
        "assigned_quote__decided_by",
    )
    if lock:
        rows = rows.select_for_update(of=("self",))
    job = rows.filter(id=job_id, owner=user).first()
    if job is None:
        raise NotFound("We could not find that job.")
    return job


def own_jobs(user):
    return (
        DirectJob.objects.filter(owner=user)
        .select_related(
            "owner",
            "photo",
            "locality__district__region",
            "assigned_artisan__user",
            "assigned_quote",
        )
        .order_by("-created_at")
    )


@transaction.atomic
def cancel_job(*, user, job_id) -> DirectJob:
    """The payer calls it off. Everybody asked is told; any waiting price lapses."""
    job = own_job(user=user, job_id=job_id, lock=True)
    if job.status == DirectJobStatus.CANCELLED:
        raise Conflict("This job is already cancelled.")
    if job.status not in (DirectJobStatus.OPEN, DirectJobStatus.ASSIGNED):
        # Finished work is confirmed or reopened, never called off.
        raise Conflict("The artisan has reported this work done. Confirm it or reopen it.")
    before, now = job.status, timezone.now()
    job.status = DirectJobStatus.CANCELLED
    job.cancelled_at = now
    job.save(update_fields=["status", "cancelled_at", "updated_at"])
    Quote.objects.filter(invitation__direct_job=job, status=QuoteStatus.SUBMITTED).update(
        status=QuoteStatus.DECLINED, decided_at=now, decision_note="The job was cancelled."
    )
    job.quote_invitations.filter(closed_at__isnull=True).update(closed_at=now)
    record(
        action=AuditAction.UPDATE,
        aggregate_type="artisan_direct_job",
        aggregate_id=job.id,
        actor=user,
        changes={"status": [before, DirectJobStatus.CANCELLED]},
    )
    held = job.quote_invitations.filter(artisan_id=job.assigned_artisan_id).first()
    if held is not None:
        emit(
            DomainEvent(
                "artisan.job_cancelled.v1",
                "artisan_direct_job",
                str(job.id),
                {"user_id": str(job.assigned_artisan.user_id), "invitation_id": str(held.id)},
            )
        )
    return job
