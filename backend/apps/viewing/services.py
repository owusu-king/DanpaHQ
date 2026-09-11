"""Viewing lifecycle.

Every transition here writes an audit entry, because every one of them is
something the two parties could later disagree about: who offered what time,
whether attendance was securely verified, and who failed to turn up.

Cross-domain imports (listing, identity) are function-scoped. viewing is a
domain module and the module graph stays acyclic - see ADR 0002.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.crypto import hash_secret, hash_token, random_code, random_token, verify_secret
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.outbox.services import emit

from .models import (
    OPEN_STATUSES,
    AttendanceParty,
    AttendanceResolutionStatus,
    AttendanceResponse,
    CancellationReason,
    CheckInMethod,
    ViewingAppointment,
    ViewingAppointmentStatus,
    ViewingAttendanceResolution,
    ViewingCheckInSession,
    ViewingFollowUp,
    ViewingRequest,
    ViewingSlot,
    ViewingStatus,
)

#: A slot in the past helps nobody, and a slot years out is a typo.
MIN_NOTICE = timedelta(minutes=30)
MAX_HORIZON = timedelta(days=60)
MAX_SLOTS = 5
CHECK_IN_OPENS_BEFORE = timedelta(minutes=30)
CHECK_IN_CLOSES_AFTER = timedelta(minutes=30)
CREDENTIAL_LIFETIME = timedelta(minutes=15)
MAX_CODE_ATTEMPTS = 5


def check_in_window(request: ViewingRequest) -> tuple[timezone.datetime, timezone.datetime]:
    if request.confirmed_slot is None:
        raise Conflict("Choose a viewing time before using check-in.")
    opens_at = request.confirmed_slot.starts_at - CHECK_IN_OPENS_BEFORE
    closes_at = (
        request.confirmed_slot.starts_at
        + timedelta(minutes=request.confirmed_slot.duration_minutes)
        + CHECK_IN_CLOSES_AFTER
    )
    return opens_at, closes_at


def _check_in_error() -> PermissionDenied:
    return PermissionDenied("That check-in credential is invalid or no longer available.")


def _code_salt(session: ViewingCheckInSession) -> str:
    return f"viewing-checkin:{session.id}:{session.credential_version}"


def get_request_or_404(pk) -> ViewingRequest:
    request = (
        ViewingRequest.objects.filter(id=pk)
        .select_related(
            "listing__unit__property__address__locality",
            "tenant",
            "confirmed_slot",
            "current_appointment",
        )
        .prefetch_related("slots", "appointments")
        .first()
    )
    if request is None:
        raise NotFound("We could not find that viewing.")
    return request


def is_host(request: ViewingRequest, user) -> bool:
    """Whoever may answer on the listing's behalf: owner, manager, agent, staff."""
    return request.listing.unit.property.is_managed_by(user)


def assert_host(request: ViewingRequest, user) -> None:
    if not is_host(request, user):
        raise PermissionDenied("Only the landlord or agent for this listing can do that.")


def assert_tenant(request: ViewingRequest, user) -> None:
    if str(request.tenant_id) != str(user.id):
        raise PermissionDenied("Only the person who asked for this viewing can do that.")


def assert_participant(request: ViewingRequest, user) -> None:
    if str(request.tenant_id) != str(user.id) and not is_host(request, user):
        raise PermissionDenied("You do not have access to that viewing.")


def _actor_role(request: ViewingRequest, user) -> str:
    if str(request.tenant_id) == str(user.id):
        return AttendanceParty.TENANT
    return AttendanceParty.HOST


def _next_appointment_sequence(request: ViewingRequest) -> int:
    latest = request.appointments.aggregate(latest=Max("sequence"))["latest"] or 0
    return latest + 1


@transaction.atomic
def request_viewing(
    *, listing, tenant, message: str = "", availability_note: str = ""
) -> ViewingRequest:
    from apps.listing.models import Listing, ListingStatus
    from apps.occupancy.services import unit_is_occupied
    from apps.property.models import Unit

    Unit.objects.select_for_update().get(id=listing.unit_id)
    listing = (
        Listing.objects.select_for_update().select_related("unit__property").get(id=listing.id)
    )

    if listing.status != ListingStatus.ACTIVE:
        raise Conflict("That place is no longer being advertised.")
    if unit_is_occupied(listing.unit):
        raise Conflict("That place is now occupied and is not accepting viewing requests.")
    from apps.billing import enforcement as billing

    billing.assert_accepting_requests(unit=listing.unit)

    if listing.unit.property.is_managed_by(tenant):
        raise ValidationFailed("This is your own listing.")

    if ViewingRequest.objects.filter(
        listing=listing, tenant=tenant, status__in=OPEN_STATUSES
    ).exists():
        raise Conflict("You have already asked to see this place. Check your viewings.")

    # Asking to see a place is a tenant action, so it establishes the capability
    # rather than assuming it. See ensure_tenant_capability for why this side
    # acquires on demand while the provider side never does.
    from apps.identity.services import ensure_tenant_capability

    ensure_tenant_capability(tenant)

    viewing = ViewingRequest.objects.create(
        listing=listing,
        tenant=tenant,
        message=message[:600],
        availability_note=availability_note[:200],
    )

    record(
        action=AuditAction.CREATE,
        aggregate_type="viewing",
        aggregate_id=viewing.id,
        actor=tenant,
        metadata={"listing_id": str(listing.id)},
    )
    emit(
        DomainEvent(
            "viewing.requested.v1",
            "viewing",
            str(viewing.id),
            {"listing_id": str(listing.id), "tenant_id": str(tenant.id)},
        )
    )
    return viewing


@transaction.atomic
def offer_slots(
    *,
    request: ViewingRequest,
    user,
    slots: list[dict],
) -> ViewingRequest:
    """Offer free viewing times. Rooomly has no viewing-fee concept."""
    assert_host(request, user)
    from apps.billing import enforcement as billing

    billing.assert_open_for_new_activity(unit=request.listing.unit, action="offer_viewing")

    if (
        request.status
        not in (
            ViewingStatus.REQUESTED,
            ViewingStatus.OFFERED,
        )
        or request.appointments.exists()
    ):
        raise Conflict("That viewing is no longer waiting for times.")

    if not slots:
        raise ValidationFailed("Offer at least one time.")
    if len(slots) > MAX_SLOTS:
        raise ValidationFailed(f"Offer at most {MAX_SLOTS} times.")

    now = timezone.now()
    cleaned = _validated_slots(slots, now=now)

    # Re-offering replaces the previous times rather than adding to them, so the
    # tenant is never choosing from a list where half the entries are stale.
    request.slots.all().delete()
    for slot in cleaned:
        ViewingSlot.objects.create(
            request=request,
            starts_at=slot["starts_at"],
            duration_minutes=slot.get("duration_minutes", 30),
            note=(slot.get("note") or "")[:200],
            proposed_by=user,
        )

    previous = request.status
    request.status = ViewingStatus.OFFERED
    request.responded_by = user
    request.responded_at = now
    request.save(
        update_fields=[
            "status",
            "responded_by",
            "responded_at",
            "updated_at",
        ]
    )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        changes={"status": [previous, request.status]},
        metadata={"slots": len(cleaned), "viewing_is_free": True},
    )
    emit(
        DomainEvent(
            "viewing.slots_offered.v1",
            "viewing",
            str(request.id),
            {
                "tenant_id": str(request.tenant_id),
                "slots": len(cleaned),
                "viewing_is_free": True,
            },
        )
    )
    return request


def _validated_slots(slots: list[dict], *, now) -> list[dict]:
    if not slots:
        raise ValidationFailed("Offer at least one time.")
    if len(slots) > MAX_SLOTS:
        raise ValidationFailed(f"Offer at most {MAX_SLOTS} times.")
    cleaned = []
    for slot in slots:
        starts_at = slot.get("starts_at")
        if starts_at is None:
            raise ValidationFailed("Every time needs a date and a time.")
        if starts_at < now + MIN_NOTICE:
            raise ValidationFailed("Offer a time at least half an hour from now.")
        if starts_at > now + MAX_HORIZON:
            raise ValidationFailed("Offer a time within the next two months.")
        cleaned.append(slot)
    return cleaned


@transaction.atomic
def decline(*, request: ViewingRequest, user, note: str = "") -> ViewingRequest:
    assert_host(request, user)
    if (
        request.status
        not in (
            ViewingStatus.REQUESTED,
            ViewingStatus.OFFERED,
        )
        or request.appointments.exists()
    ):
        raise Conflict("That viewing cannot be declined from its current state.")

    previous = request.status
    request.status = ViewingStatus.DECLINED
    request.responded_by = user
    request.responded_at = timezone.now()
    request.response_note = note[:300]
    request.save(
        update_fields=[
            "status",
            "responded_by",
            "responded_at",
            "response_note",
            "updated_at",
        ]
    )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        changes={"status": [previous, request.status]},
    )
    emit(
        DomainEvent(
            "viewing.declined.v1",
            "viewing",
            str(request.id),
            {"tenant_id": str(request.tenant_id)},
        )
    )
    return request


@transaction.atomic
def withdraw(*, request: ViewingRequest, user, note: str = "") -> ViewingRequest:
    """The tenant withdraws an unconfirmed request; this is not a cancellation."""
    assert_tenant(request, user)
    if (
        request.status
        not in (
            ViewingStatus.REQUESTED,
            ViewingStatus.OFFERED,
        )
        or request.appointments.exists()
    ):
        raise Conflict("Only an unconfirmed viewing request can be withdrawn.")

    previous = request.status
    request.status = ViewingStatus.WITHDRAWN
    request.response_note = note[:300]
    request.save(update_fields=["status", "response_note", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        changes={"status": [previous, request.status]},
        metadata={"action": "withdrawn"},
    )
    emit(
        DomainEvent(
            "viewing.withdrawn.v1",
            "viewing",
            str(request.id),
            {"listing_id": str(request.listing_id), "tenant_id": str(request.tenant_id)},
        )
    )
    return request


@transaction.atomic
def confirm_slot(*, request: ViewingRequest, user, slot_id) -> ViewingRequest:
    """The counterparty accepts an offered time and creates an immutable appointment."""
    if request.status != ViewingStatus.OFFERED:
        raise Conflict("There are no times to choose from yet.")
    from apps.billing import enforcement as billing

    billing.assert_accepting_requests(unit=request.listing.unit)

    slot = request.slots.filter(id=slot_id).first()
    if slot is None:
        raise NotFound("We could not find that time.")
    if slot.is_past:
        raise Conflict("That time has already passed. Ask for new times.")

    # Initial slots are host proposals and the tenant accepts them. During a
    # tenant-initiated reschedule the direction reverses: an authorized host
    # accepts the tenant's proposed time. Nobody confirms their own proposal.
    if slot.proposed_by_id == request.tenant_id:
        assert_host(request, user)
    else:
        assert_tenant(request, user)

    now = timezone.now()
    previous = request.status
    request.status = ViewingStatus.CONFIRMED
    request.confirmed_slot = slot
    request.confirmed_at = now
    # Numbers are exchanged here and nowhere earlier.
    request.contact_released_at = now
    if is_host(request, user):
        request.responded_by = user
        request.responded_at = now
    appointment = ViewingAppointment.objects.create(
        viewing=request,
        sequence=_next_appointment_sequence(request),
        scheduled_at=slot.starts_at,
        duration_minutes=slot.duration_minutes,
        note=slot.note,
        confirmed_at=now,
        confirmed_by=user,
    )
    request.current_appointment = appointment
    request.save(
        update_fields=[
            "status",
            "confirmed_slot",
            "confirmed_at",
            "contact_released_at",
            "responded_by",
            "responded_at",
            "current_appointment",
            "updated_at",
        ]
    )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        changes={"status": [previous, request.status]},
        metadata={
            "starts_at": slot.starts_at.isoformat(),
            "contacts_released": True,
            "appointment_id": str(appointment.id),
            "appointment_sequence": appointment.sequence,
        },
    )
    emit(
        DomainEvent(
            "viewing.confirmed.v1",
            "viewing",
            str(request.id),
            {
                "listing_id": str(request.listing_id),
                "starts_at": slot.starts_at.isoformat(),
                "appointment_id": str(appointment.id),
            },
        )
    )
    return request


@transaction.atomic
def reschedule(*, request: ViewingRequest, user, slots: list[dict]) -> ViewingRequest:
    """Replace a confirmed appointment with new free times.

    Any attendance credential for the old appointment is invalidated before
    the selected slot is cleared.
    """
    assert_participant(request, user)
    if request.status != ViewingStatus.CONFIRMED:
        raise Conflict("Only a confirmed viewing can be rescheduled.")
    from apps.billing import enforcement as billing

    billing.assert_accepting_requests(unit=request.listing.unit)
    now = timezone.now()
    cleaned = _validated_slots(slots, now=now)
    old_slot = request.confirmed_slot
    old_appointment = request.current_appointment
    if old_appointment is None:
        raise Conflict("That confirmed schedule has no appointment record.")
    invalidate_check_in(request=request, reason="rescheduled")
    old_appointment.status = ViewingAppointmentStatus.RESCHEDULED
    old_appointment.rescheduled_at = now
    old_appointment.rescheduled_by = user
    old_appointment.save(update_fields=["status", "rescheduled_at", "rescheduled_by", "updated_at"])
    request.confirmed_slot = None
    request.confirmed_at = None
    request.current_appointment = None
    request.status = ViewingStatus.OFFERED
    if _actor_role(request, user) == AttendanceParty.HOST:
        request.responded_by = user
        request.responded_at = now
    request.approaching_notified_at = None
    request.check_in_notified_at = None
    request.save(
        update_fields=[
            "status",
            "confirmed_slot",
            "confirmed_at",
            "current_appointment",
            "responded_by",
            "responded_at",
            "approaching_notified_at",
            "check_in_notified_at",
            "updated_at",
        ]
    )
    request.slots.all().delete()
    for slot in cleaned:
        ViewingSlot.objects.create(
            request=request,
            starts_at=slot["starts_at"],
            duration_minutes=slot.get("duration_minutes", 30),
            note=(slot.get("note") or "")[:200],
            proposed_by=user,
        )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        changes={"status": [ViewingStatus.CONFIRMED, ViewingStatus.OFFERED]},
        metadata={
            "action": "rescheduled",
            "old_starts_at": old_slot.starts_at.isoformat() if old_slot else None,
            "appointment_id": str(old_appointment.id),
            "initiated_by": _actor_role(request, user),
            "slots": len(cleaned),
        },
    )
    emit(
        DomainEvent(
            "viewing.rescheduled.v1",
            "viewing",
            str(request.id),
            {
                "tenant_id": str(request.tenant_id),
                "slots": len(cleaned),
                "initiated_by_tenant": str(request.tenant_id) == str(user.id),
            },
        )
    )
    return request


def invalidate_check_in(*, request: ViewingRequest, reason: str) -> None:
    ViewingCheckInSession.objects.filter(
        viewing=request, used_at__isnull=True, invalidated_at__isnull=True
    ).update(invalidated_at=timezone.now(), invalidated_reason=reason)


@transaction.atomic
def issue_check_in_credential(*, request: ViewingRequest, user) -> dict:
    """Rotate and return one QR/code pair to the viewing tenant.

    Reissuing is intentional: plaintext credentials are never stored, so a
    client that loses its displayed value receives a fresh pair and the old
    pair immediately stops working.
    """
    assert_tenant(request, user)
    if not user.is_phone_verified:
        raise PermissionDenied("Confirm your phone number before using viewing check-in.")
    request = (
        ViewingRequest.objects.select_for_update(of=("self",))
        .select_related("confirmed_slot")
        .get(id=request.id)
    )
    if request.status != ViewingStatus.CONFIRMED:
        raise Conflict("Check-in is available only for a confirmed viewing.")
    now = timezone.now()
    opens_at, closes_at = check_in_window(request)
    if now < opens_at:
        raise Conflict("Check-in is not open yet.", details={"opens_at": opens_at.isoformat()})
    if now >= closes_at:
        raise Conflict("The check-in window has closed.")

    session, _ = ViewingCheckInSession.objects.select_for_update().get_or_create(
        viewing=request,
        defaults={"not_before": opens_at, "expires_at": closes_at},
    )
    if session.used_at is not None:
        raise Conflict("This viewing has already been checked in.")
    token = f"rvci_{random_token()}"
    code = random_code(6)
    session.credential_version += 1
    session.qr_token_hash = hash_token(token)
    session.code_hash = hash_secret(code, pepper=settings.SECRET_KEY, salt=_code_salt(session))
    session.not_before = now
    session.expires_at = min(now + CREDENTIAL_LIFETIME, closes_at)
    session.failed_code_attempts = 0
    session.last_failed_at = None
    session.invalidated_at = None
    session.invalidated_reason = ""
    session.save(
        update_fields=[
            "credential_version",
            "qr_token_hash",
            "code_hash",
            "not_before",
            "expires_at",
            "failed_code_attempts",
            "last_failed_at",
            "invalidated_at",
            "invalidated_reason",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        metadata={
            "action": "check_in_credential_issued",
            "credential_version": session.credential_version,
            "expires_at": session.expires_at.isoformat(),
        },
    )
    return {
        "qr_payload": token,
        "code": code,
        "expires_at": session.expires_at,
        "opens_at": opens_at,
    }


def validate_check_in(
    *, request: ViewingRequest, user, credential: str = "", code: str = ""
) -> ViewingRequest:
    """Validate QR or fallback code through one state transition."""
    try:
        assert_host(request, user)
    except PermissionDenied:
        record(
            action=AuditAction.UPDATE,
            aggregate_type="viewing",
            aggregate_id=request.id,
            actor=user,
            metadata={"action": "check_in_failed", "reason": "unauthorized"},
        )
        raise
    if not user.is_phone_verified:
        raise PermissionDenied("Confirm your phone number before checking in a viewing.")

    method = CheckInMethod.QR if credential else CheckInMethod.CODE
    error: PermissionDenied | Conflict | None = None
    checked_in = None
    with transaction.atomic():
        locked = (
            ViewingRequest.objects.select_for_update(of=("self",))
            .select_related("confirmed_slot", "listing__unit__property")
            .get(id=request.id)
        )
        session = ViewingCheckInSession.objects.select_for_update().filter(viewing=locked).first()
        now = timezone.now()
        reason = ""
        if locked.status != ViewingStatus.CONFIRMED or session is None:
            reason = "not_confirmed_or_missing"
        elif session.used_at is not None:
            reason = "already_used"
        elif session.invalidated_at is not None:
            reason = "invalidated"
        elif now < session.not_before:
            reason = "before_window"
        elif now >= session.expires_at:
            reason = "expired"
        elif method == CheckInMethod.QR:
            if not credential or hash_token(credential) != session.qr_token_hash:
                reason = "incorrect_qr"
        else:
            normalized = "".join(character for character in code if character.isdigit())
            if session.failed_code_attempts >= MAX_CODE_ATTEMPTS:
                reason = "code_attempt_limit"
            elif len(normalized) != 6 or not verify_secret(
                normalized,
                session.code_hash,
                pepper=settings.SECRET_KEY,
                salt=_code_salt(session),
            ):
                session.failed_code_attempts += 1
                session.last_failed_at = now
                session.save(update_fields=["failed_code_attempts", "last_failed_at", "updated_at"])
                reason = "incorrect_code"

        if reason:
            record(
                action=AuditAction.UPDATE,
                aggregate_type="viewing",
                aggregate_id=locked.id,
                actor=user,
                metadata={
                    "action": "check_in_failed",
                    "method": method,
                    "reason": reason,
                    "failed_code_attempts": (
                        session.failed_code_attempts if session is not None else 0
                    ),
                },
            )
            error = _check_in_error()
        else:
            session.used_at = now
            session.used_by = user
            session.save(update_fields=["used_at", "used_by", "updated_at"])
            locked.status = ViewingStatus.CHECKED_IN
            locked.checked_in_at = now
            locked.checked_in_by = user
            locked.check_in_method = method
            locked.save(
                update_fields=[
                    "status",
                    "checked_in_at",
                    "checked_in_by",
                    "check_in_method",
                    "updated_at",
                ]
            )
            if locked.current_appointment_id:
                ViewingAppointment.objects.filter(id=locked.current_appointment_id).update(
                    status=ViewingAppointmentStatus.CHECKED_IN,
                    updated_at=now,
                )
            record(
                action=AuditAction.UPDATE,
                aggregate_type="viewing",
                aggregate_id=locked.id,
                actor=user,
                changes={"status": [ViewingStatus.CONFIRMED, ViewingStatus.CHECKED_IN]},
                metadata={"action": "checked_in", "method": method},
            )
            emit(
                DomainEvent(
                    "viewing.checked_in.v1",
                    "viewing",
                    str(locked.id),
                    {
                        "tenant_id": str(locked.tenant_id),
                        "host_id": str(user.id),
                        "method": method,
                    },
                )
            )
            checked_in = locked
    if error is not None:
        raise error
    return checked_in


@transaction.atomic
def cancel(
    *,
    request: ViewingRequest,
    user,
    reason: str = "",
    note: str = "",
) -> ViewingRequest:
    """Cancel a confirmed appointment with factual, structured metadata."""
    assert_participant(request, user)
    replacing_a_confirmed_schedule = (
        request.status == ViewingStatus.OFFERED and request.appointments.exists()
    )
    if request.status != ViewingStatus.CONFIRMED and not replacing_a_confirmed_schedule:
        raise Conflict(
            "Only a confirmed appointment can be cancelled. "
            "Withdraw or decline before confirmation."
        )
    if reason not in CancellationReason.values:
        raise ValidationFailed("Choose a reason for cancelling the appointment.")
    appointment = request.current_appointment
    if appointment is None and replacing_a_confirmed_schedule:
        appointment = request.appointments.order_by("-sequence").first()
    if appointment is None:
        raise Conflict("That confirmed schedule has no appointment record.")

    now = timezone.now()
    scheduled_at = (
        request.confirmed_slot.starts_at
        if request.confirmed_slot is not None
        else appointment.scheduled_at
    )
    notice_minutes = max(0, int((scheduled_at - now).total_seconds() // 60))
    previous = request.status
    invalidate_check_in(request=request, reason="cancelled")
    request.status = ViewingStatus.CANCELLED
    request.cancelled_by = user
    request.cancelled_at = now
    request.cancellation_reason = reason
    request.cancellation_note = note[:300]
    request.cancellation_notice_minutes = notice_minutes
    request.save(
        update_fields=[
            "status",
            "cancelled_by",
            "cancelled_at",
            "cancellation_reason",
            "cancellation_note",
            "cancellation_notice_minutes",
            "updated_at",
        ]
    )
    if request.current_appointment_id:
        appointment.status = ViewingAppointmentStatus.CANCELLED
        appointment.cancelled_by = user
        appointment.cancelled_at = now
        appointment.cancellation_reason = reason
        appointment.cancellation_note = note[:300]
        appointment.cancellation_notice_minutes = notice_minutes
        appointment.save(
            update_fields=[
                "status",
                "cancelled_by",
                "cancelled_at",
                "cancellation_reason",
                "cancellation_note",
                "cancellation_notice_minutes",
                "updated_at",
            ]
        )

    actor_role = _actor_role(request, user)
    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        changes={"status": [previous, request.status]},
        metadata={
            "action": "appointment_cancelled",
            "appointment_id": str(appointment.id),
            "cancelled_by": actor_role,
            "reason": reason,
            "notice_minutes": notice_minutes,
        },
    )
    emit(
        DomainEvent(
            "viewing.cancelled.v1",
            "viewing",
            str(request.id),
            {
                "cancelled_by_tenant": actor_role == AttendanceParty.TENANT,
                "reason": reason,
                "notice_minutes": notice_minutes,
            },
        )
    )
    return request


@transaction.atomic
def record_outcome(
    *, request: ViewingRequest, user, outcome: str, note: str = ""
) -> ViewingRequest:
    """Say what actually happened.

    Completion is strong only after check-in. No-shows use the separate,
    symmetric allegation/response flow below and cannot be manufactured here.
    """
    if outcome != ViewingStatus.COMPLETED:
        raise ValidationFailed("Report attendance separately so the other party can respond.")

    assert_participant(request, user)
    if request.status != ViewingStatus.CHECKED_IN:
        raise Conflict("Check in before recording that the viewing was completed.")

    previous = request.status
    request.status = outcome
    request.outcome_note = note[:300]
    request.outcome_recorded_at = timezone.now()
    request.save(
        update_fields=[
            "status",
            "outcome_note",
            "outcome_recorded_at",
            "updated_at",
        ]
    )
    if request.current_appointment_id:
        ViewingAppointment.objects.filter(id=request.current_appointment_id).update(
            status=ViewingAppointmentStatus.COMPLETED,
            updated_at=request.outcome_recorded_at,
        )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        changes={"status": [previous, outcome]},
        metadata={"recorded_by": _actor_role(request, user)},
    )
    emit(
        DomainEvent(
            "viewing.outcome_recorded.v1",
            "viewing",
            str(request.id),
            {"outcome": outcome, "listing_id": str(request.listing_id)},
        )
    )
    return request


@transaction.atomic
def report_no_show(*, request: ViewingRequest, user, note: str = "") -> ViewingRequest:
    """Record one party's allegation without treating it as a verified outcome."""
    assert_participant(request, user)
    request = (
        ViewingRequest.objects.select_for_update(of=("self",))
        .select_related("confirmed_slot", "current_appointment", "tenant")
        .get(id=request.id)
    )
    if request.status != ViewingStatus.CONFIRMED:
        raise Conflict("Attendance can be reported only for an unchecked confirmed viewing.")
    if request.current_appointment is None:
        raise Conflict("That confirmed schedule has no appointment record.")
    _, closes_at = check_in_window(request)
    if timezone.now() < closes_at:
        raise Conflict(
            "Wait until the check-in window closes before reporting attendance.",
            details={"closes_at": closes_at.isoformat()},
        )
    if hasattr(request.current_appointment, "attendance_resolution"):
        raise Conflict("Attendance has already been reported for this appointment.")

    reporter_role = _actor_role(request, user)
    alleged = (
        AttendanceParty.HOST if reporter_role == AttendanceParty.TENANT else AttendanceParty.TENANT
    )
    now = timezone.now()
    resolution = ViewingAttendanceResolution.objects.create(
        appointment=request.current_appointment,
        reported_by=user,
        alleged_absent_party=alleged,
        reported_at=now,
        report_note=note[:300],
    )
    request.status = ViewingStatus.ATTENDANCE_PENDING
    request.outcome_note = note[:300]
    request.outcome_recorded_at = now
    request.save(update_fields=["status", "outcome_note", "outcome_recorded_at", "updated_at"])
    request.current_appointment.status = ViewingAppointmentStatus.ATTENDANCE_PENDING
    request.current_appointment.save(update_fields=["status", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        changes={"status": [ViewingStatus.CONFIRMED, ViewingStatus.ATTENDANCE_PENDING]},
        metadata={
            "action": "no_show_reported",
            "appointment_id": str(request.current_appointment_id),
            "resolution_id": str(resolution.id),
            "reported_by": reporter_role,
            "alleged_absent_party": alleged,
        },
    )
    emit(
        DomainEvent(
            "viewing.attendance_reported.v1",
            "viewing",
            str(request.id),
            {
                "reported_by": reporter_role,
                "alleged_absent_party": alleged,
                "resolution_id": str(resolution.id),
            },
        )
    )
    return request


@transaction.atomic
def respond_to_attendance(
    *, request: ViewingRequest, user, response: str, note: str = ""
) -> ViewingRequest:
    """The alleged absent party confirms the fact or disputes the allegation."""
    assert_participant(request, user)
    if response not in AttendanceResponse.values:
        raise ValidationFailed("Confirm or dispute the attendance report.")
    request = (
        ViewingRequest.objects.select_for_update(of=("self",))
        .select_related("current_appointment", "tenant")
        .get(id=request.id)
    )
    if request.status != ViewingStatus.ATTENDANCE_PENDING or request.current_appointment is None:
        raise Conflict("There is no attendance report waiting for a response.")
    resolution = (
        ViewingAttendanceResolution.objects.select_for_update()
        .filter(appointment=request.current_appointment)
        .first()
    )
    if resolution is None or resolution.dispute_status != AttendanceResolutionStatus.PENDING:
        raise Conflict("There is no attendance report waiting for a response.")
    actor_role = _actor_role(request, user)
    if actor_role != resolution.alleged_absent_party:
        raise PermissionDenied("Only the person named in the attendance report can respond.")

    now = timezone.now()
    resolution.response = response
    resolution.responded_by = user
    resolution.responded_at = now
    resolution.response_note = note[:300]
    if response == AttendanceResponse.CONFIRM:
        resolution.dispute_status = AttendanceResolutionStatus.VERIFIED
        final_status = (
            ViewingStatus.TENANT_NO_SHOW
            if resolution.alleged_absent_party == AttendanceParty.TENANT
            else ViewingStatus.HOST_NO_SHOW
        )
        appointment_status = (
            ViewingAppointmentStatus.TENANT_NO_SHOW
            if resolution.alleged_absent_party == AttendanceParty.TENANT
            else ViewingAppointmentStatus.HOST_NO_SHOW
        )
    else:
        resolution.dispute_status = AttendanceResolutionStatus.DISPUTED
        final_status = ViewingStatus.DISPUTED
        appointment_status = ViewingAppointmentStatus.DISPUTED
    resolution.save(
        update_fields=[
            "response",
            "responded_by",
            "responded_at",
            "response_note",
            "dispute_status",
            "updated_at",
        ]
    )
    request.status = final_status
    request.outcome_note = note[:300] or request.outcome_note
    request.outcome_recorded_at = now
    request.save(update_fields=["status", "outcome_note", "outcome_recorded_at", "updated_at"])
    request.current_appointment.status = appointment_status
    request.current_appointment.save(update_fields=["status", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        changes={"status": [ViewingStatus.ATTENDANCE_PENDING, final_status]},
        metadata={
            "action": "attendance_response",
            "resolution_id": str(resolution.id),
            "response": response,
            "dispute_status": resolution.dispute_status,
        },
    )
    emit(
        DomainEvent(
            "viewing.attendance_responded.v1",
            "viewing",
            str(request.id),
            {
                "response": response,
                "outcome": final_status,
                "reported_by_id": str(resolution.reported_by_id or ""),
            },
        )
    )
    return request


@transaction.atomic
def record_tenant_follow_up(
    *,
    request: ViewingRequest,
    user,
    action: str,
    report_category: str = "",
    details: str = "",
) -> dict:
    """Close the tenant's post-viewing prompt without inventing a tenancy."""
    assert_tenant(request, user)
    request = (
        ViewingRequest.objects.select_for_update()
        .select_related("listing__unit__property", "tenant")
        .get(id=request.id)
    )
    if request.status not in (ViewingStatus.COMPLETED, ViewingStatus.HOST_NO_SHOW):
        raise Conflict("Post-viewing actions open after the viewing is concluded.")
    if action not in ViewingFollowUp.values:
        raise ValidationFailed("Choose what you want to do after the viewing.")
    if request.tenant_follow_up:
        raise Conflict("You already chose a post-viewing action.")
    if action == ViewingFollowUp.REQUEST_HOME and request.status != ViewingStatus.COMPLETED:
        raise Conflict("Request this home after a completed viewing.")

    result = {
        "action": action,
        "tenancy_request_id": None,
        "saved_listing_id": None,
        "report_id": None,
    }
    if action == ViewingFollowUp.REQUEST_HOME:
        from apps.occupancy.services import create_join_request_from_viewing

        tenancy_request = create_join_request_from_viewing(
            user=user,
            viewing=request,
            message="Requested after a checked-in Rooomly viewing.",
        )
        result["tenancy_request_id"] = str(tenancy_request.id)
    elif action == ViewingFollowUp.SAVE:
        from apps.listing.models import SavedListing

        saved, _ = SavedListing.objects.get_or_create(
            user=user,
            listing=request.listing,
            defaults={"note": "Saved after viewing"},
        )
        result["saved_listing_id"] = str(saved.id)
    elif action == ViewingFollowUp.REPORT:
        allowed_categories = {
            "misleading_listing",
            "wrong_unit_or_property",
            "host_no_show",
            "inappropriate_conduct",
            "other",
        }
        if report_category not in allowed_categories:
            raise ValidationFailed("Choose what went wrong at the viewing.")
        from apps.operations.models import ReportSubject
        from apps.operations.services import create_consumer_report

        report = create_consumer_report(
            user=user,
            subject_type=ReportSubject.VIEWING,
            subject_id=request.id,
            category=report_category,
            summary=f"Viewing issue: {request.listing.headline}",
            details=details,
        )
        result["report_id"] = str(report.id)

    request.tenant_follow_up = action
    request.tenant_follow_up_at = timezone.now()
    request.save(update_fields=["tenant_follow_up", "tenant_follow_up_at", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="viewing",
        aggregate_id=request.id,
        actor=user,
        metadata={"action": "tenant_follow_up", "follow_up": action},
    )
    return result
