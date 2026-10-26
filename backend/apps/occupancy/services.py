"""Invitation, join-request and occupancy workflows."""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, Gone, NotFound, PermissionDenied, ValidationFailed
from apps.outbox.services import emit

from .models import (
    JoinRequestStatus,
    Occupancy,
    OccupancyStatus,
    PropertyJoinRequest,
)


def _validate_space(*, prop, unit, bed=None) -> None:
    if unit.property_id != prop.id or not unit.is_active:
        raise ValidationFailed("Choose an active unit in this property.")
    if bed is not None and (bed.unit_id != unit.id or not bed.is_active):
        raise ValidationFailed("Choose an active bed in this unit.")
    if bed is not None:
        from apps.property.space_rules import assert_accepts_bed_spaces

        assert_accepts_bed_spaces(unit=unit)


def unit_is_occupied(unit) -> bool:
    """Return the authoritative whole-Unit availability boundary.

    Listings and access credentials belong to a Unit, not to an individual bed.
    Consequently any active allocation inside the Unit makes that Unit
    unavailable for public advertising or another possession credential.
    """
    return Occupancy.objects.filter(
        unit=unit,
        status__in=[OccupancyStatus.PENDING_LEASE, OccupancyStatus.ACTIVE],
        ended_at__isnull=True,
    ).exists()


def assert_space_is_free(*, unit, bed=None, starts_on=None, ends_on=None, exclude=None) -> None:
    """Refuse an allocation that would clash with one already recorded.

    Two exclusion constraints in the database already stop a unit overlapping a
    unit, and a bed overlapping a bed. They cannot express the third case: a
    whole-unit allocation conflicts with the beds *inside* that unit, while the
    beds do not conflict with each other. One exclusion constraint keyed on
    `unit` would have to say both things at once.

    So this holds the cross-level rule — and, because it runs first, it is also
    what turns every clash into a sentence naming the dates rather than a
    Postgres integrity error.

    Renting a room whole while its beds are let separately is a real
    arrangement in some hostels; if it is ever wanted it becomes an explicit
    flag on the space, not an accident of a missing check.
    """
    live = Occupancy.objects.filter(unit=unit, ended_at__isnull=True)
    if exclude is not None:
        live = live.exclude(pk=exclude.pk)

    # Only the other level: same-level clashes belong to the constraints, which
    # catch them even when this is bypassed.
    counterparts = (
        live.filter(bed__isnull=True) if bed is not None else live.filter(bed__isnull=False)
    )

    for other in counterparts:
        if _overlaps(starts_on, ends_on, other.starts_on, other.ends_on):
            if bed is not None:
                raise Conflict(
                    "The whole unit is already let for those dates, so its beds "
                    "cannot be let separately at the same time."
                )
            raise Conflict(
                "A bed in this unit is already let for those dates, so the unit "
                "cannot be let whole at the same time."
            )


def _overlaps(a_start, a_end, b_start, b_end) -> bool:
    """Half-open comparison, matching the `[)` bounds the constraints use.

    A tenancy ending on the 1st and another starting on the 1st is a handover,
    not a clash. Missing dates mean unbounded, which is what the domain means by
    an occupancy with no recorded start or no agreed end.
    """
    from datetime import date

    a_start = a_start or date.min
    b_start = b_start or date.min
    a_end = a_end or date.max
    b_end = b_end or date.max
    return a_start < b_end and b_start < a_end


@transaction.atomic
def _create_occupancy(
    *, lease, user, prop, unit, bed=None, created_by=None, starts_on=None, ends_on=None
) -> Occupancy:
    from apps.property.models import Unit

    Unit.objects.select_for_update().get(id=unit.id)
    _validate_space(prop=prop, unit=unit, bed=bed)
    assert_space_is_free(unit=unit, bed=bed, starts_on=starts_on, ends_on=ends_on)

    # After validation, so a refused allocation does not leave a relationship
    # behind describing an arrangement that was never made.
    from apps.tenancy.services import ensure_tenancy

    tenancy = ensure_tenancy(
        tenant=user,
        prop=prop,
        unit=unit,
        bed=bed,
        activation_lease=lease,
        starts_on=starts_on,
        actor=created_by,
    )

    # A possession credential must stop working before the allocation becomes
    # visible to another transaction. Keep the hash and audit history; revoke
    # the credential rather than deleting it.
    from apps.property import access_codes

    access_codes.revoke(
        unit=unit,
        actor=created_by if created_by and prop.is_managed_by(created_by) else None,
        reason="unit_occupied",
    )
    try:
        occupancy = Occupancy.objects.create(
            user=user,
            property=prop,
            unit=unit,
            bed=bed,
            tenancy=tenancy,
            lease=lease,
            starts_on=starts_on,
            ends_on=ends_on,
            status=OccupancyStatus.ACTIVE,
            created_by=created_by,
        )
    except IntegrityError as exc:
        raise Conflict("This person already has an active occupancy for that space.") from exc

    # Occupancy is the availability truth. This handles public-market leases,
    # private invitations and approved join requests through the same path.
    from apps.listing.services import withdraw_for_occupancy

    withdraw_for_occupancy(unit=unit, actor=created_by or user, occupancy=occupancy)
    record(
        action=AuditAction.CREATE,
        aggregate_type="occupancy",
        aggregate_id=occupancy.id,
        actor=created_by or user,
        metadata={
            "user_id": str(user.id),
            "property_id": str(prop.id),
            "unit_id": str(unit.id),
            "bed_id": str(bed.id) if bed else None,
        },
    )
    emit(
        DomainEvent(
            "occupancy.created.v1",
            "occupancy",
            str(occupancy.id),
            {"user_id": str(user.id), "property_id": str(prop.id)},
        )
    )
    return occupancy


@transaction.atomic
def ensure_for_lease(*, lease, actor) -> Occupancy:
    """Link a trusted lease activation to the physical occupancy record.

    Matched and created on the lease's actual target, bed included. Before P8
    this ignored `bed` entirely, so accepting a lease for one bed allocated the
    whole room - which meant a four-bed hostel still held one tenant, and the
    remaining three beds read as conflicting with an allocation nobody had
    agreed to.
    """
    from apps.property.models import Unit

    Unit.objects.select_for_update().get(id=lease.unit_id)
    occupancy = Occupancy.objects.filter(
        user=lease.tenant,
        unit=lease.unit,
        bed=lease.bed,
        ended_at__isnull=True,
    ).first()
    if occupancy is None:
        # The lease already says when this runs; carrying its dates onto the
        # allocation is what lets the exclusion constraints see a real period
        # instead of two nulls that overlap everything.
        occupancy = _create_occupancy(
            lease=lease,
            user=lease.tenant,
            prop=lease.unit.property,
            unit=lease.unit,
            bed=lease.bed,
            created_by=actor,
            starts_on=lease.starts_on,
            ends_on=lease.ends_on,
        )
    else:
        # A pre-existing real-world context is deliberately inert. Upgrade it
        # only here, after the agreement has passed its activation gate.
        assert_space_is_free(
            unit=lease.unit,
            bed=lease.bed,
            starts_on=lease.starts_on,
            ends_on=lease.ends_on,
            exclude=occupancy,
        )
        from apps.tenancy.services import ensure_tenancy

        tenancy = ensure_tenancy(
            tenant=lease.tenant,
            prop=lease.unit.property,
            unit=lease.unit,
            bed=lease.bed,
            activation_lease=lease,
            starts_on=lease.starts_on,
            actor=actor,
        )
        occupancy.lease = lease
        occupancy.tenancy = tenancy
        occupancy.status = OccupancyStatus.ACTIVE
        occupancy.starts_on = occupancy.starts_on or lease.starts_on
        occupancy.ends_on = occupancy.ends_on or lease.ends_on
        occupancy.save(
            update_fields=[
                "lease",
                "tenancy",
                "status",
                "starts_on",
                "ends_on",
                "updated_at",
            ]
        )
        from apps.property import access_codes

        access_codes.revoke(
            unit=lease.unit,
            actor=actor if actor and lease.unit.property.is_managed_by(actor) else None,
            reason="unit_occupied",
        )
        from apps.listing.services import withdraw_for_occupancy

        withdraw_for_occupancy(unit=lease.unit, actor=actor, occupancy=occupancy)

    # The agreement joins the relationship the allocation already belongs to.
    # A renewal lands here too, and lands on the same tenancy - which is the
    # reason the tenancy is a separate record at all.
    if occupancy.tenancy_id and lease.tenancy_id != occupancy.tenancy_id:
        lease.tenancy_id = occupancy.tenancy_id
        lease.save(update_fields=["tenancy", "updated_at"])
    return occupancy


def end_for_lease(*, lease, actor) -> int:
    """End linked occupancy when the contractual tenancy ends."""
    rows = Occupancy.objects.select_for_update().filter(
        lease=lease,
        ended_at__isnull=True,
    )
    ended = 0
    for occupancy in rows:
        occupancy.status = OccupancyStatus.ENDED
        occupancy.ends_on = timezone.localdate()
        occupancy.ended_at = timezone.now()
        occupancy.save(update_fields=["status", "ends_on", "ended_at", "updated_at"])

        # The allocation going means the arrangement is over. A renewal never
        # reaches here: it is a new lease over the same tenancy, and nothing
        # ends. If a renewal flow is ever built that does end the outgoing
        # lease, this is the line that would wrongly close the relationship.
        if occupancy.tenancy_id:
            from apps.tenancy.services import end_tenancy

            end_tenancy(
                tenancy=occupancy.tenancy,
                actor=actor,
                reason=f"The agreement ended ({lease.id}).",
                ended_on=occupancy.ends_on,
            )

        record(
            action=AuditAction.UPDATE,
            aggregate_type="occupancy",
            aggregate_id=occupancy.id,
            actor=actor,
            changes={"status": [OccupancyStatus.ACTIVE, OccupancyStatus.ENDED]},
            metadata={"lease_id": str(lease.id)},
        )
        ended += 1
    return ended


@transaction.atomic
def create_invitation(
    *,
    actor,
    prop,
    unit,
    bed=None,
    invitee_phone: str,
    purpose: str = "prospective_tenant",
    note: str = "",
):
    raise Gone(
        "Direct tenant invitations have been retired. Share the verified Unit "
        "access code so the tenant can send a tenancy request."
    )


def resolve_invitation(*, user, token: str) -> dict:
    raise Gone(
        "Invitation codes are no longer accepted. Ask the provider for the "
        "verified Unit access code and send a tenancy request instead."
    )


def accept_invitation(*, user, token: str, confirmed: bool = False, request=None):
    raise Gone(
        "Invitations can no longer be accepted. Use the Unit access code to "
        "send a tenancy request; approval then leads to a lease offer."
    )


def decline_invitation(*, user, token: str, confirmed: bool = False, reason: str = ""):
    raise Gone("This invitation workflow has been retired. No tenancy or access was created.")


@transaction.atomic
def create_join_request(*, user, prop, unit, bed=None, access_code: str, message: str = ""):
    from apps.property.models import Unit

    unit = Unit.objects.select_for_update().select_related("property").get(id=unit.id)
    _validate_space(prop=prop, unit=unit, bed=bed)
    from apps.property import access_codes

    if not access_codes.verify(unit, access_code):
        # Wrong, expired, revoked, archived and unverified credentials share one
        # answer so this endpoint cannot be used to enumerate Unit state.
        raise NotFound("We could not find a space with that access code.")
    if unit_is_occupied(unit):
        raise Conflict("This space is occupied and is not accepting requests.")
    from apps.billing import enforcement as billing

    billing.assert_accepting_requests(unit=unit)
    if Occupancy.objects.filter(
        user=user,
        unit=unit,
        bed=bed,
        ended_at__isnull=True,
    ).exists():
        raise Conflict("You already have active access to this space.")
    if PropertyJoinRequest.objects.filter(
        requester=user, unit=unit, bed=bed, status=JoinRequestStatus.PENDING
    ).exists():
        raise Conflict("You already have a pending request for this space.")
    request = PropertyJoinRequest.objects.create(
        requester=user,
        property=prop,
        unit=unit,
        bed=bed,
        message=message.strip(),
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="property_join_request",
        aggregate_id=request.id,
        actor=user,
        metadata={
            "property_id": str(prop.id),
            "unit_id": str(unit.id),
            "access_code_version": unit.access_code_version,
        },
    )
    return request


@transaction.atomic
def create_join_request_from_viewing(*, user, viewing, message: str = ""):
    """Create the canonical tenancy request after verified public attendance."""
    from apps.listing.models import Listing, ListingStatus
    from apps.property.models import Unit
    from apps.viewing.models import ViewingStatus

    viewing = (
        type(viewing)
        .objects.select_for_update()
        .select_related("listing__unit__property", "tenant")
        .get(id=viewing.id)
    )
    if viewing.tenant_id != user.id:
        raise PermissionDenied("Only the tenant who attended can request this home.")
    if viewing.status != ViewingStatus.COMPLETED:
        raise Conflict("Complete the checked-in viewing before requesting this home.")
    listing = Listing.objects.select_for_update().get(id=viewing.listing_id)
    if listing.status != ListingStatus.ACTIVE:
        raise Conflict("That home is no longer accepting tenancy requests.")
    unit = Unit.objects.select_for_update().select_related("property").get(id=listing.unit_id)
    prop = unit.property
    _validate_space(prop=prop, unit=unit)
    from apps.billing import enforcement as billing

    billing.assert_accepting_requests(unit=unit)
    if unit_is_occupied(unit):
        raise Conflict("This space is occupied and is not accepting requests.")
    if PropertyJoinRequest.objects.filter(
        requester=user, unit=unit, bed__isnull=True, status=JoinRequestStatus.PENDING
    ).exists():
        raise Conflict("You already have a pending request for this space.")
    if PropertyJoinRequest.objects.filter(source_viewing=viewing).exists():
        raise Conflict("You already requested this home after the viewing.")

    request = PropertyJoinRequest.objects.create(
        requester=user,
        property=prop,
        unit=unit,
        source_viewing=viewing,
        message=message.strip()[:400],
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="property_join_request",
        aggregate_id=request.id,
        actor=user,
        metadata={
            "property_id": str(prop.id),
            "unit_id": str(unit.id),
            "source_viewing_id": str(viewing.id),
            "acquisition": "completed_viewing",
        },
    )
    emit(
        DomainEvent(
            "tenancy_request.created.v1",
            "property_join_request",
            str(request.id),
            {
                "property_id": str(prop.id),
                "unit_id": str(unit.id),
                "tenant_id": str(user.id),
                "source_viewing_id": str(viewing.id),
            },
        )
    )
    return request


@transaction.atomic
def decide_join_request(*, join_request, actor, approved: bool, note: str = ""):
    join_request = PropertyJoinRequest.objects.select_for_update().get(id=join_request.id)
    from apps.organization.services import can_manage_property

    if not can_manage_property(prop=join_request.property, user=actor):
        raise PermissionDenied("You cannot decide tenant access for this property.")
    if join_request.status != JoinRequestStatus.PENDING:
        raise Conflict("This join request has already been decided.")
    occupancy = None
    if approved:
        from apps.property.capabilities import PropertyCapability, assert_property_capability

        _validate_space(
            prop=join_request.property,
            unit=join_request.unit,
            bed=join_request.bed,
        )
        assert_property_capability(
            prop=join_request.property,
            user=actor,
            capability=PropertyCapability.TENANT_ACCESS,
        )
        # Approving is how a new tenant starts. Declining stays open, so a
        # restricted space's waiting requests can still be answered.
        from apps.billing import enforcement as billing

        billing.assert_open_for_new_activity(
            unit=join_request.unit, action="approve_tenancy_request"
        )
        join_request.status = JoinRequestStatus.APPROVED
    else:
        if not note.strip():
            raise ValidationFailed("Record a reason for rejecting this request.")
        join_request.status = JoinRequestStatus.REJECTED
    join_request.decided_by = actor
    join_request.decided_at = timezone.now()
    join_request.decision_note = note.strip()
    join_request.save(
        update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"]
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="property_join_request",
        aggregate_id=join_request.id,
        actor=actor,
        changes={"status": [JoinRequestStatus.PENDING, join_request.status]},
        metadata={
            "note": note.strip(),
            "next_step": "provider_prepares_lease" if approved else None,
        },
    )
    return join_request, occupancy


def occupancy_contexts_for_user(user) -> list[dict]:
    rows = Occupancy.objects.filter(
        user=user, ended_at__isnull=True, status=OccupancyStatus.ACTIVE
    ).select_related("property", "unit", "bed")
    return [
        {
            "id": f"occupancy:{row.id}",
            "type": "occupancy",
            "label": row.property.title,
            "subtitle": row.bed.label if row.bed else (row.unit.label or "My home"),
            "occupancy_id": str(row.id),
            "property_id": str(row.property_id),
            "unit_id": str(row.unit_id),
            "bed_id": str(row.bed_id) if row.bed_id else None,
            "mobile_route": "/(app)/(tabs)",
            "web_route": "/rentals",
        }
        for row in rows
    ]
