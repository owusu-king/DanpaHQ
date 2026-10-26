"""What each party reads about artisan work. Privacy is decided here.

Three readers, three views of the same repair or direct job:

* **An invited artisan** reads what needs doing, the photograph and the area
  (locality, district, region). Never the address, a name or a phone number.
* **The assigned artisan** — and only once the payer approved their quote —
  also reads the address, the contact (on a repair, the tenant on site; on a
  direct job, the customer who posted it), who approved them, and the history.
* **The people who run or pay** read every invitation and quote. **The
  tenant** on a repair reads who is doing it, and never the price — the
  payer's money is the payer's business.

Once the artisan reports the work done, everybody on the job reads what they
said and the photographs; receipts are the payer's and the artisan's. Paid and
the review show once they exist. What each reader may do next is in
`permissions`, decided here, never by a client.
"""

from __future__ import annotations

from django.db.models import Q

from apps.core.money import Money
from apps.files.models import FilePurpose

from .models import (
    ArtisanReview,
    DirectJob,
    DirectJobStatus,
    Quote,
    QuoteInvitation,
    QuoteStatus,
    Trade,
    WorkFileKind,
)
from .quotes import MAX_OPEN_INVITATIONS, _Subject
from .serializers import inline_photo_url


def _media(file) -> dict | None:
    """The photograph of what needs doing, signed for an invited artisan to see."""
    if file is not None and file.purpose == FilePurpose.ARTISAN_JOB_PHOTO:
        url = inline_photo_url(file, purpose=FilePurpose.ARTISAN_JOB_PHOTO)
        return {"id": str(file.id), "url": url, "content_type": file.content_type} if url else None
    from apps.maintenance.serializers import _media as maintenance_media

    return maintenance_media(file)


def _quote(quote: Quote) -> dict:
    return {
        "id": str(quote.id),
        "status": quote.status,
        "status_display": quote.get_status_display(),
        "price_minor": quote.price_minor,
        "price_display": Money(quote.price_minor).format(),
        "scope": quote.scope,
        "materials": quote.materials,
        "revises": str(quote.revises_id) if quote.revises_id else None,
        "reason": quote.reason,
        "decision_note": quote.decision_note,
        "created_at": quote.created_at,
        "decided_at": quote.decided_at,
        "paid_at": quote.paid_at,
    }


def _signed(file) -> str | None:
    """A short-lived link to a finished-work photo or a receipt."""
    if file is None or not file.is_usable:
        return None
    from apps.files.storage import get_storage
    from apps.maintenance.serializers import INLINE_TTL_SECONDS

    return (
        get_storage()
        .presign_download(
            key=file.storage_key,
            expires_in=INLINE_TTL_SECONDS,
            filename=file.original_filename,
            disposition="inline",
        )
        .url
    )


def _work_reports(invitation: QuoteInvitation, *, receipts: bool) -> list[dict]:
    """Every time the artisan said "done", oldest first. Receipts only for the money's side."""
    rows = []
    for report in invitation.work_reports.all():
        files = list(report.files.all())
        rows.append(
            {
                "id": str(report.id),
                "note": report.note,
                "at": report.created_at,
                "photos": [
                    {"id": str(row.file_id), "url": _signed(row.file)}
                    for row in files
                    if row.kind == WorkFileKind.PHOTO
                ],
                "receipts": [
                    {
                        "id": str(row.file_id),
                        "name": row.file.original_filename,
                        "url": _signed(row.file),
                    }
                    for row in files
                    if row.kind == WorkFileKind.RECEIPT
                ]
                if receipts
                else [],
                "confirmed_at": report.confirmed_at,
                "reopened_at": report.reopened_at,
                "reopen_reason": report.reopen_reason,
            }
        )
    return rows


def _review(invitation: QuoteInvitation | None) -> dict | None:
    if invitation is None:
        return None
    try:
        written = invitation.review
    except ArtisanReview.DoesNotExist:
        return None
    return {
        "text": written.text,
        "would_hire_again": written.would_hire_again,
        "at": written.created_at,
        "author": written.author.first_name or written.author.display_name,
    }


def _finished(subject) -> bool:
    if isinstance(subject, DirectJob):
        return subject.status == DirectJobStatus.COMPLETED
    from apps.maintenance.models import MaintenanceStatus

    return subject.status == MaintenanceStatus.COMPLETED


def _awaiting_work(subject) -> bool:
    """The assigned artisan may report it done now."""
    if isinstance(subject, DirectJob):
        return subject.status == DirectJobStatus.ASSIGNED
    from apps.maintenance.models import MaintenanceStatus

    return subject.status in (MaintenanceStatus.IN_PROGRESS, MaintenanceStatus.REOPENED)


def _finish_block(subject, invitation: QuoteInvitation | None, *, pays: bool, money: bool) -> dict:
    """The assigned job's finish: what the artisan reported, and the payer's next steps."""
    finished = _finished(subject)
    on_record = subject.assigned_quote
    review = _review(invitation)
    return {
        "invitation_id": str(invitation.id) if invitation else None,
        "reports": _work_reports(invitation, receipts=money) if invitation else [],
        "finished": finished,
        "paid_at": on_record.paid_at if money and on_record else None,
        "review": review,
        "may_record_paid": bool(
            pays and finished and on_record is not None and on_record.paid_at is None
        ),
        "may_review": bool(pays and finished and invitation is not None and review is None),
    }


def _assigned_invitation(invitations: list[QuoteInvitation], subject) -> QuoteInvitation | None:
    return next((row for row in invitations if row.artisan_id == subject.assigned_artisan_id), None)


def _area(request) -> dict:
    address = request.property.address
    return {
        "locality": address.locality_label,
        "district": address.district_label,
        "region": address.region_label,
    }


def _job_area(job: DirectJob) -> dict:
    locality = job.locality
    return {
        "locality": locality.name,
        "district": locality.district.name,
        "region": locality.district.region.name,
    }


def _trade_label(trade: str) -> str:
    return dict(Trade.choices).get(trade, trade)


def _invitation_state(invitation: QuoteInvitation, subject) -> str:
    if isinstance(subject, DirectJob) and subject.status == DirectJobStatus.CANCELLED:
        return "cancelled"
    if subject.assigned_artisan_id == invitation.artisan_id:
        # Their job either way; "completed" once the other side confirmed it.
        return "completed" if _finished(subject) else "assigned"
    if invitation.declined_at:
        return "declined"
    if invitation.closed_at or subject.assigned_artisan_id:
        return "closed"
    if invitation.invited_at is None:
        return "suggested"
    if any(quote.status == QuoteStatus.SUBMITTED for quote in invitation.quotes.all()):
        return "quoted"
    return "invited"


# --- the artisan's side ------------------------------------------------------------


def artisan_view(invitation: QuoteInvitation) -> dict:
    """One repair or job as an artisan reads it. Unlocked only on their own assignment."""
    if invitation.direct_job_id:
        return _artisan_job_view(invitation)
    request = invitation.maintenance_request
    state = _invitation_state(invitation, request)
    unlocked = state in ("assigned", "completed")
    view = {
        "id": str(invitation.id),
        "state": state,
        "invited_at": invitation.invited_at,
        "request": {
            "kind": "maintenance",
            "id": str(request.id),
            "category": request.category,
            "category_display": request.get_category_display(),
            "title": request.get_category_display(),
            "description": request.description,
            "photo": _media(request.photo),
            "reported_at": request.created_at,
            "status": request.status,
            "status_display": request.get_status_display(),
            "area": _area(request),
        },
        "quotes": [_quote(quote) for quote in invitation.quotes.all()],
        "unlocked": unlocked,
        "permissions": {"report_done": unlocked and _awaiting_work(request), "report": unlocked},
    }
    if not unlocked:
        return view

    from apps.core.phone import format_national

    view["work"] = _finish_block(request, invitation, pays=False, money=True)
    address = request.property.address
    approved = request.assigned_quote
    view["job"] = {
        "address": {
            "line": str(address),
            "street": address.street,
            "house_number": address.house_number,
            "digital_address": address.digital_address,
            "landmark": address.landmark,
        },
        "place": {"property_title": request.property.title, "unit_label": request.unit.label},
        "contact": {
            "name": request.tenant.display_name,
            "phone": format_national(request.tenant.phone) if request.tenant.phone else "",
            "role": "Tenant, on site",
        },
        "approved_by": approved.decided_by.display_name
        if approved and approved.decided_by_id
        else "",
        "approved_at": approved.decided_at if approved else None,
        "price_on_record": _quote(approved) if approved else None,
        "history": [
            {
                "kind": event.kind,
                "kind_display": event.get_kind_display(),
                "note": event.note,
                "at": event.created_at,
            }
            for event in request.events.all()
        ],
    }
    return view


def _job_history(job: DirectJob) -> list[dict]:
    """A direct job keeps no event log of its own; its quotes are its history."""
    rows = [{"kind": "posted", "kind_display": "Posted", "note": "", "at": job.created_at}]
    for quote in Quote.objects.filter(
        invitation__direct_job=job,
        status__in=[
            QuoteStatus.APPROVED,
            QuoteStatus.SUPERSEDED,
        ],
    ).order_by("decided_at"):
        rows.append(
            {
                "kind": "revision_approved" if quote.revises_id else "assigned",
                "kind_display": "Revised price approved" if quote.revises_id else "Artisan chosen",
                "note": Money(quote.price_minor).format(),
                "at": quote.decided_at,
            }
        )
    if job.cancelled_at:
        rows.append(
            {"kind": "cancelled", "kind_display": "Cancelled", "note": "", "at": job.cancelled_at}
        )
    return rows


def _artisan_job_view(invitation: QuoteInvitation) -> dict:
    job = invitation.direct_job
    state = _invitation_state(invitation, job)
    unlocked = state in ("assigned", "completed")
    view = {
        "id": str(invitation.id),
        "state": state,
        "invited_at": invitation.invited_at,
        "request": {
            "kind": "direct_job",
            "id": str(job.id),
            "category": job.trade,
            "category_display": _trade_label(job.trade),
            "title": job.title,
            "description": job.description,
            "photo": _media(job.photo),
            "reported_at": job.created_at,
            "status": job.status,
            "status_display": job.get_status_display(),
            "area": _job_area(job),
        },
        "quotes": [_quote(quote) for quote in invitation.quotes.all()],
        "unlocked": unlocked,
        "permissions": {"report_done": unlocked and _awaiting_work(job), "report": unlocked},
    }
    if not unlocked:
        return view

    from apps.core.phone import format_national

    view["work"] = _finish_block(job, invitation, pays=False, money=True)
    approved = job.assigned_quote
    view["job"] = {
        "address": {
            "line": job.address_line,
            "street": job.street,
            "house_number": job.house_number,
            "digital_address": "",
            "landmark": job.landmark,
        },
        "place": None,
        "contact": {
            "name": job.owner.display_name,
            "phone": format_national(job.owner.phone) if job.owner.phone else "",
            "role": "Customer",
        },
        "approved_by": job.owner.display_name,
        "approved_at": approved.decided_at if approved else None,
        "price_on_record": _quote(approved) if approved else None,
        "history": _job_history(job),
    }
    return view


def _artisan_rows(user, *, assigned: bool):
    rows = (
        QuoteInvitation.objects.filter(artisan__user=user, invited_at__isnull=False)
        .select_related(
            "maintenance_request__property__address__locality__district__region",
            "maintenance_request__tenant",
            "maintenance_request__unit",
            "maintenance_request__photo",
            "maintenance_request__assigned_quote__decided_by",
            "direct_job__owner",
            "direct_job__photo",
            "direct_job__locality__district__region",
            "direct_job__assigned_quote",
        )
        .prefetch_related(
            "quotes", "maintenance_request__events", "work_reports__files__file", "review__author"
        )
        .order_by("-invited_at")
    )
    held = Q(maintenance_request__assigned_artisan__user=user) | Q(
        direct_job__assigned_artisan__user=user
    )
    if assigned:
        return rows.filter(held)
    return rows.exclude(id__in=QuoteInvitation.objects.filter(held).values("id"))


def my_invitations(user) -> list[dict]:
    return [artisan_view(row) for row in _artisan_rows(user, assigned=False)[:100]]


def my_jobs(user) -> list[dict]:
    return [artisan_view(row) for row in _artisan_rows(user, assigned=True)[:100]]


def my_invitation(user, invitation_id) -> dict:
    row = (
        _artisan_rows(user, assigned=False).filter(id=invitation_id).first()
        or _artisan_rows(user, assigned=True).filter(id=invitation_id).first()
    )
    if row is None:
        from apps.core.exceptions import NotFound

        raise NotFound("We could not find that invitation.")
    return artisan_view(row)


# --- the customer's side -----------------------------------------------------------


def _artisan_card(profile) -> dict:
    photos = list(profile.portfolio.all())
    return {
        "id": str(profile.id),
        "name": profile.user.display_name,
        "trades": [{"value": trade, "label": _trade_label(trade)} for trade in profile.trades],
        "cover_url": inline_photo_url(photos[0].file) if photos else None,
    }


def _invitations(**link) -> list[QuoteInvitation]:
    return list(
        QuoteInvitation.objects.filter(**link)
        .select_related("artisan__user")
        .prefetch_related(
            "quotes", "artisan__portfolio__file", "work_reports__files__file", "review__author"
        )
        .order_by("created_at")
    )


def _assigned_block(subject, *, priced: bool) -> dict | None:
    if subject.assigned_artisan is None:
        return None
    return {
        "artisan": _artisan_card(subject.assigned_artisan),
        "assigned_at": subject.assigned_at,
        "price_on_record": _quote(subject.assigned_quote)
        if priced and subject.assigned_quote_id
        else None,
    }


def work_for(request, user) -> dict:
    """The artisan block of a maintenance request, for whoever is reading it."""
    subject = _Subject("maintenance", request)
    runs = subject.may_invite(user)
    pays = subject.may_pay(user)
    tenant = str(request.tenant_id) == str(user.id)
    invitations = _invitations(maintenance_request=request)
    open_now = request.is_open and not request.assigned_artisan_id
    open_invitations = sum(1 for row in invitations if row.is_open)

    if runs or pays:
        rows = [
            {
                "id": str(row.id),
                "state": _invitation_state(row, request),
                "artisan": _artisan_card(row.artisan),
                "suggested_by_tenant": bool(row.suggested_by_id),
                "quotes": [_quote(quote) for quote in row.quotes.all()],
            }
            for row in invitations
        ]
    else:
        # The tenant sees who they suggested and who is doing the work; prices
        # and other people's quotes are the payer's.
        rows = [
            {
                "id": str(row.id),
                "state": _invitation_state(row, request),
                "artisan": _artisan_card(row.artisan),
                "suggested_by_tenant": bool(row.suggested_by_id),
                "quotes": [],
            }
            for row in invitations
            if row.suggested_by_id == user.id or row.artisan_id == request.assigned_artisan_id
        ]

    held = _assigned_invitation(invitations, request)
    return {
        "assigned": _assigned_block(request, priced=runs or pays),
        "invitations": rows,
        # The tenant reads what was done and the photographs, never receipts or payment.
        "work": _finish_block(request, held, pays=pays, money=runs or pays) if held else None,
        "permissions": {
            "invite": runs and open_now and open_invitations < MAX_OPEN_INVITATIONS,
            "approve": pays,
            "suggest": tenant and open_now,
            "report": held is not None and (runs or pays or tenant),
        },
        "max_open_invitations": MAX_OPEN_INVITATIONS,
    }


def job_for_owner(job: DirectJob) -> dict:
    """A direct job as the person who posted it — and pays for it — reads it."""
    invitations = _invitations(direct_job=job)
    held = _assigned_invitation(invitations, job)
    open_now = job.status == DirectJobStatus.OPEN and not job.assigned_artisan_id
    open_invitations = sum(1 for row in invitations if row.is_open)
    return {
        "job": {
            "kind": "direct_job",
            "id": str(job.id),
            "trade": job.trade,
            "trade_display": _trade_label(job.trade),
            "title": job.title,
            "description": job.description,
            "photo": _media(job.photo),
            "status": job.status,
            "status_display": job.get_status_display(),
            "area": _job_area(job),
            "address": {
                "line": job.address_line,
                "house_number": job.house_number,
                "street": job.street,
                "landmark": job.landmark,
            },
            "created_at": job.created_at,
            "cancelled_at": job.cancelled_at,
        },
        "assigned": _assigned_block(job, priced=True),
        "work": _finish_block(job, held, pays=True, money=True) if held else None,
        "invitations": [
            {
                "id": str(row.id),
                "state": _invitation_state(row, job),
                "artisan": _artisan_card(row.artisan),
                "suggested_by_tenant": False,
                "quotes": [_quote(quote) for quote in row.quotes.all()],
            }
            for row in invitations
        ],
        "permissions": {
            "invite": open_now and open_invitations < MAX_OPEN_INVITATIONS,
            "approve": job.is_open,
            "suggest": False,
            "cancel": job.status in (DirectJobStatus.OPEN, DirectJobStatus.ASSIGNED),
            "confirm": job.status == DirectJobStatus.DONE_REPORTED,
            "report": held is not None,
        },
        "max_open_invitations": MAX_OPEN_INVITATIONS,
    }


def customer_overview(user) -> dict:
    """Artisans' sheet: Requests (quotes asked for and waiting) and Records (jobs).

    A provider reads the repairs on properties they run; a tenant reads their
    own, without prices. Both read the direct jobs they posted themselves —
    open ones under Requests even before anybody is asked, so they can ask.
    """
    from apps.maintenance.models import MaintenanceRequest
    from apps.organization.services import properties_for_user

    from .jobs import own_jobs

    rows = (
        MaintenanceRequest.objects.filter(quote_invitations__isnull=False)
        .filter(Q(tenant=user) | Q(property__in=properties_for_user(user)))
        .select_related("property", "unit", "assigned_artisan__user", "assigned_quote")
        .distinct()
        .order_by("-status_changed_at")[:100]
    )
    requests, records = [], []
    for request in rows:
        summary = {
            "request": {
                "kind": "maintenance",
                "id": str(request.id),
                "category_display": request.get_category_display(),
                "title": request.get_category_display(),
                "status": request.status,
                "status_display": request.get_status_display(),
                "place": f"{request.unit.label} · {request.property.title}",
            },
            "at": request.status_changed_at,
            **work_for(request, user),
        }
        (records if request.assigned_artisan_id else requests).append(summary)

    for job in own_jobs(user).exclude(status=DirectJobStatus.CANCELLED)[:100]:
        block = job_for_owner(job)
        summary = {
            "request": {
                "kind": "direct_job",
                "id": str(job.id),
                "category_display": _trade_label(job.trade),
                "title": job.title,
                "status": job.status,
                "status_display": job.get_status_display(),
                "place": job.locality.name,
            },
            "at": job.assigned_at or job.created_at,
            **{key: block[key] for key in ("assigned", "invitations", "permissions", "work")},
            "max_open_invitations": MAX_OPEN_INVITATIONS,
        }
        (records if job.assigned_artisan_id else requests).append(summary)

    requests.sort(key=lambda row: row["at"], reverse=True)
    records.sort(key=lambda row: row["at"], reverse=True)
    return {"requests": requests, "records": records}
