"""Reporting, working on and closing a maintenance request.

Who may do what is decided here and nowhere else:

* **The tenant** of an *active* tenancy reports a problem, and later says
  whether the provider's fix worked.
* **Anyone who manages the property** (``Property.is_managed_by`` — owner,
  manager, agent, or a Portfolio member with access) starts the work and
  reports it fixed. No verification or collection capability is asked for: a
  repair is operational, and a burst pipe must not wait on paperwork.

Every move happens under a row lock, writes a ``MaintenanceEvent``, an audit
entry, and an outbox event the notification handlers turn into messages.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.files.models import FilePurpose, StoredFile
from apps.outbox.services import emit

from .models import (
    MAX_CLIP_MS,
    WAITING_ON_PROVIDER,
    MaintenanceEvent,
    MaintenanceEventKind,
    MaintenanceRequest,
    MaintenanceStatus,
)


def _attached_file(*, user, file_id, purpose: str, what: str) -> StoredFile:
    """A file this person uploaded, for this purpose, that has passed its checks.

    Ownership is checked even though the id came from their own upload: knowing
    somebody else's file id must not let a person attach that file to a report.
    """
    stored = StoredFile.objects.filter(id=file_id).first()
    if stored is None or not stored.is_owned_by(user):
        raise NotFound(f"We could not find that {what}.")
    if stored.purpose != purpose:
        raise ValidationFailed(f"Choose a file uploaded as a maintenance {what}.")
    if not stored.is_usable:
        raise ValidationFailed(f"That {what} is still being checked. Wait a moment and try again.")
    if MaintenanceRequest.objects.filter(Q(photo=stored) | Q(video=stored)).exists():
        raise ValidationFailed(f"That {what} is already part of another request.")
    return stored


def _clip_window(*, video, duration_ms, start_ms, end_ms) -> tuple[int | None, int | None]:
    """Where the five seconds are, when the device could not cut the file.

    A file the device has already cut needs no window. A longer one must say
    which five seconds to play; nothing else about a long video is kept.
    """
    if video is None:
        if start_ms is not None or end_ms is not None:
            raise ValidationFailed("A clip needs a video.")
        return None, None
    if start_ms is None and end_ms is None:
        if duration_ms is not None and duration_ms > MAX_CLIP_MS:
            raise ValidationFailed("Choose up to five seconds of the video to send.")
        return None, None
    if start_ms is None or end_ms is None:
        raise ValidationFailed("Give both the start and the end of the clip.")
    if start_ms < 0 or end_ms <= start_ms:
        raise ValidationFailed("The clip must end after it starts.")
    if end_ms - start_ms > MAX_CLIP_MS:
        raise ValidationFailed("A clip can be at most five seconds long.")
    if duration_ms is not None and end_ms > duration_ms:
        raise ValidationFailed("The clip runs past the end of the video.")
    return start_ms, end_ms


@transaction.atomic
def submit_request(
    *,
    user,
    tenancy_id,
    category: str,
    description: str,
    photo_file_id,
    video_file_id=None,
    video_duration_ms: int | None = None,
    video_clip_start_ms: int | None = None,
    video_clip_end_ms: int | None = None,
) -> MaintenanceRequest:
    from apps.tenancy.models import Tenancy, TenancyStatus

    tenancy = (
        Tenancy.objects.select_related("property", "unit")
        .filter(id=tenancy_id, tenant=user)
        .first()
    )
    if tenancy is None:
        raise NotFound("We could not find that tenancy.")
    if tenancy.status != TenancyStatus.ACTIVE:
        raise Conflict("Maintenance can be reported once your tenancy has started.")

    description = (description or "").strip()
    if len(description) < 10:
        raise ValidationFailed("Describe the problem in a sentence or two.")

    photo = _attached_file(
        user=user, file_id=photo_file_id, purpose=FilePurpose.MAINTENANCE_PHOTO, what="photo"
    )
    video = (
        _attached_file(
            user=user, file_id=video_file_id, purpose=FilePurpose.MAINTENANCE_VIDEO, what="video"
        )
        if video_file_id
        else None
    )
    start_ms, end_ms = _clip_window(
        video=video,
        duration_ms=video_duration_ms,
        start_ms=video_clip_start_ms,
        end_ms=video_clip_end_ms,
    )

    now = timezone.now()
    request = MaintenanceRequest.objects.create(
        tenancy=tenancy,
        tenant=user,
        property=tenancy.property,
        unit=tenancy.unit,
        bed_id=tenancy.bed_id,
        category=category,
        description=description,
        photo=photo,
        video=video,
        video_clip_start_ms=start_ms,
        video_clip_end_ms=end_ms,
        status=MaintenanceStatus.SUBMITTED,
        status_changed_at=now,
    )
    MaintenanceEvent.objects.create(
        request=request,
        kind=MaintenanceEventKind.SUBMITTED,
        actor=user,
        to_status=MaintenanceStatus.SUBMITTED,
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="maintenance_request",
        aggregate_id=request.id,
        actor=user,
        metadata={
            "tenancy_id": str(tenancy.id),
            "category": category,
            "has_video": video is not None,
        },
    )
    emit(
        DomainEvent(
            "maintenance.submitted.v1",
            "maintenance_request",
            str(request.id),
            {"tenancy_id": str(tenancy.id), "property_id": str(tenancy.property_id)},
        )
    )
    return request


# --- reading -------------------------------------------------------------------


def is_provider_for(*, request: MaintenanceRequest, user) -> bool:
    return request.property.is_managed_by(user)


def can_view(*, request: MaintenanceRequest, user) -> bool:
    if not user or not user.is_authenticated:
        return False
    return str(request.tenant_id) == str(user.id) or is_provider_for(request=request, user=user)


def get_visible(*, request_id, user) -> MaintenanceRequest:
    """The request, or the same not-found a stranger gets for a missing one."""
    request = (
        MaintenanceRequest.objects.select_related(
            "tenant", "property", "unit", "bed", "photo", "video"
        )
        .prefetch_related("events__actor")
        .filter(id=request_id)
        .first()
    )
    if request is None or not can_view(request=request, user=user):
        raise NotFound("We could not find that maintenance request.")
    return request


def for_tenant(*, user):
    return MaintenanceRequest.objects.filter(tenant=user)


def for_properties(*, properties):
    return MaintenanceRequest.objects.filter(property__in=properties)


# --- moving it on ---------------------------------------------------------------


def _locked(request: MaintenanceRequest) -> MaintenanceRequest:
    return (
        MaintenanceRequest.objects.select_for_update().select_related("property").get(id=request.id)
    )


def _move(
    *,
    request: MaintenanceRequest,
    user,
    to: str,
    kind: str,
    note: str = "",
    stamp: dict | None = None,
) -> MaintenanceRequest:
    previous = request.status
    now = timezone.now()
    request.status = to
    request.status_changed_at = now
    fields = ["status", "status_changed_at", "updated_at"]
    for field, value in (stamp or {}).items():
        setattr(request, field, now if value is None else value)
        fields.append(field)
    request.save(update_fields=fields)

    MaintenanceEvent.objects.create(
        request=request,
        kind=kind,
        actor=user,
        from_status=previous,
        to_status=to,
        note=note[:500],
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="maintenance_request",
        aggregate_id=request.id,
        actor=user,
        changes={"status": [previous, to]},
        metadata={"note": note[:200]} if note else None,
    )
    emit(
        DomainEvent(
            f"maintenance.{kind}.v1",
            "maintenance_request",
            str(request.id),
            {"from": previous, "to": to},
        )
    )
    return request


def _assert_provider(request: MaintenanceRequest, user) -> None:
    if not is_provider_for(request=request, user=user):
        raise PermissionDenied("Only the people who manage this property can update this request.")


def _assert_tenant(request: MaintenanceRequest, user) -> None:
    if str(request.tenant_id) != str(user.id):
        raise PermissionDenied("Only the tenant who reported this can answer for it.")


@transaction.atomic
def start_work(*, request: MaintenanceRequest, user, note: str = "") -> MaintenanceRequest:
    request = _locked(request)
    _assert_provider(request, user)
    if request.status not in WAITING_ON_PROVIDER:
        raise Conflict("Work on this request has already started.")
    return _move(
        request=request,
        user=user,
        to=MaintenanceStatus.IN_PROGRESS,
        kind=MaintenanceEventKind.STARTED,
        note=note.strip(),
        stamp={"started_at": None},
    )


@transaction.atomic
def report_fixed(*, request: MaintenanceRequest, user, note: str = "") -> MaintenanceRequest:
    request = _locked(request)
    _assert_provider(request, user)
    if request.status != MaintenanceStatus.IN_PROGRESS:
        raise Conflict("Start the work before reporting it fixed.")
    return _move(
        request=request,
        user=user,
        to=MaintenanceStatus.AWAITING_TENANT_CONFIRMATION,
        kind=MaintenanceEventKind.FIXED_REPORTED,
        note=note.strip(),
        stamp={"fixed_reported_at": None},
    )


@transaction.atomic
def confirm_fixed(*, request: MaintenanceRequest, user) -> MaintenanceRequest:
    request = _locked(request)
    _assert_tenant(request, user)
    if request.status != MaintenanceStatus.AWAITING_TENANT_CONFIRMATION:
        raise Conflict("There is no fix waiting for your confirmation.")
    return _move(
        request=request,
        user=user,
        to=MaintenanceStatus.COMPLETED,
        kind=MaintenanceEventKind.CONFIRMED,
        stamp={"completed_at": None},
    )


@transaction.atomic
def reopen(*, request: MaintenanceRequest, user, reason: str) -> MaintenanceRequest:
    request = _locked(request)
    _assert_tenant(request, user)
    if request.status != MaintenanceStatus.AWAITING_TENANT_CONFIRMATION:
        raise Conflict("Only a fix waiting for your confirmation can be reopened.")
    reason = (reason or "").strip()
    if not reason:
        raise ValidationFailed("Say what is still wrong, so it can be put right.")
    return _move(
        request=request,
        user=user,
        to=MaintenanceStatus.REOPENED,
        kind=MaintenanceEventKind.REOPENED,
        note=reason,
        stamp={"reopened_at": None, "reopen_count": request.reopen_count + 1},
    )


# --- artisans -------------------------------------------------------------------
#
# Called by `apps.artisan` once a payer approves a quote. Status stays this
# module's: an assignment is one more event, and work waiting to start moves to
# in progress the way it would if the provider had started it themselves.


def assign_artisan(
    *, request: MaintenanceRequest, quote, approver, note: str
) -> MaintenanceRequest:
    """Put an approved quote's artisan on the request. The caller holds the lock."""
    now = timezone.now()
    stamp = {
        "assigned_artisan": quote.invitation.artisan,
        "assigned_quote": quote,
        "assigned_at": now,
    }
    if request.status in WAITING_ON_PROVIDER:
        return _move(
            request=request,
            user=approver,
            to=MaintenanceStatus.IN_PROGRESS,
            kind=MaintenanceEventKind.ASSIGNED,
            note=note,
            stamp={**stamp, "started_at": None},
        )
    return _record_without_moving(
        request=request, user=approver, kind=MaintenanceEventKind.ASSIGNED, note=note, fields=stamp
    )


def record_revision(
    *, request: MaintenanceRequest, quote, approver, note: str
) -> MaintenanceRequest:
    """An approved revised quote becomes the price on record. Status is unchanged."""
    return _record_without_moving(
        request=request,
        user=approver,
        kind=MaintenanceEventKind.REVISION_APPROVED,
        note=note,
        fields={"assigned_quote": quote},
    )


def _record_without_moving(
    *, request: MaintenanceRequest, user, kind: str, note: str, fields: dict
) -> MaintenanceRequest:
    for field, value in fields.items():
        setattr(request, field, value)
    request.save(update_fields=[*fields.keys(), "updated_at"])
    MaintenanceEvent.objects.create(
        request=request,
        kind=kind,
        actor=user,
        from_status=request.status,
        to_status=request.status,
        note=note[:500],
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="maintenance_request",
        aggregate_id=request.id,
        actor=user,
        metadata={"event": kind, "note": note[:200]},
    )
    emit(
        DomainEvent(
            f"maintenance.{kind}.v1",
            "maintenance_request",
            str(request.id),
            {"from": request.status, "to": request.status},
        )
    )
    return request
