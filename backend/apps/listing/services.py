"""Listing lifecycle services."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.core.money import Money
from apps.outbox.services import emit
from apps.property.models import Unit

from .models import (
    AvailabilityState,
    Listing,
    ListingMedia,
    ListingStatus,
    ModerationState,
    PublicationState,
)


def get_listing_or_404(pk) -> Listing:
    listing = (
        Listing.objects.filter(id=pk)
        .select_related("unit__property__address__locality", "created_by")
        .first()
    )
    if listing is None or listing.deleted_at is not None:
        raise NotFound("We could not find that listing.")
    return listing


def assert_can_manage(listing: Listing, user) -> None:
    if not (listing.unit.property.is_managed_by(user) or user.is_staff):
        raise PermissionDenied("You do not have access to that listing.")


def assert_verified_provider(*, prop, user) -> None:
    """Require a current identity and the reviewed authority for this property."""
    from apps.property.capabilities import PropertyCapability, assert_property_capability

    assert_property_capability(
        prop=prop,
        user=user,
        capability=PropertyCapability.PUBLICATION,
    )


@transaction.atomic
def withdraw_for_occupancy(*, unit: Unit, actor, occupancy) -> int:
    """Remove every public offer for a Unit when any occupancy starts.

    Listings have no bed target, so a bed allocation also closes the Unit-level
    advertisement. The moderation verdict is retained as history; publication
    and availability are the axes that changed.
    """
    rows = Listing.objects.select_for_update().filter(
        unit=unit,
        publication_state=PublicationState.PUBLISHED,
    )
    changed = 0
    for listing in rows:
        previous = listing.status
        listing.publication_state = PublicationState.WITHDRAWN
        listing.availability_state = AvailabilityState.TAKEN
        if listing.moderation_state == ModerationState.PENDING:
            listing.moderation_state = ModerationState.NOT_REVIEWED
        listing.review_note = "This space has an active tenancy."
        listing.save(
            update_fields=[
                "publication_state",
                "availability_state",
                "moderation_state",
                "review_note",
                "updated_at",
            ]
        )
        record(
            action=AuditAction.UPDATE,
            aggregate_type="listing",
            aggregate_id=listing.id,
            actor=actor,
            changes={"status": [previous, listing.status]},
            metadata={
                "reason": "unit_occupied",
                "occupancy_id": str(occupancy.id),
            },
        )
        emit(
            DomainEvent(
                "listing.withdrawn.v1",
                "listing",
                str(listing.id),
                {"reason": "unit_occupied", "occupancy_id": str(occupancy.id)},
            )
        )
        changed += 1
    return changed


@transaction.atomic
def suspend_for_verification(*, subject_type: str, subject_id, kind: str, reason: str) -> int:
    """Remove affected listings from discovery when a trust basis lapses.

    Three bases, because three different things can stop being true: who the
    provider is, whether they hold the address, and whether the space itself is
    still the space that was checked. The space case was missing, which meant a
    provider could reopen an approved room for changes and leave its
    advertisement live under a check that no longer applied.
    """
    from apps.trust.models import SubjectType, VerificationKind

    rows = Listing.objects.filter(status=ListingStatus.ACTIVE)
    if subject_type == SubjectType.USER and kind == VerificationKind.IDENTITY:
        rows = rows.filter(created_by_id=subject_id)
    elif subject_type == SubjectType.PROPERTY and kind == VerificationKind.PROPERTY_AUTHORITY:
        rows = rows.filter(unit__property_id=subject_id)
    elif subject_type == SubjectType.SPACE and kind == VerificationKind.SPACE_CONDITION:
        rows = rows.filter(unit_id=subject_id)
    else:
        return 0

    count = 0
    for listing in rows.select_for_update():
        listing.moderation_state = ModerationState.SUSPENDED
        listing.review_note = reason[:600]
        listing.save(update_fields=["moderation_state", "review_note", "updated_at"])
        record(
            action=AuditAction.UPDATE,
            aggregate_type="listing",
            aggregate_id=listing.id,
            changes={"status": [ListingStatus.ACTIVE, ListingStatus.SUSPENDED]},
            metadata={"reason": reason, "verification_kind": kind},
        )
        count += 1
    return count


@transaction.atomic
def create_listing(*, user, unit: Unit, data: dict) -> Listing:
    if not unit.property.is_managed_by(user):
        raise PermissionDenied("You cannot create a listing for a property you do not manage.")
    if Listing.objects.filter(unit=unit, status__in=["draft", "pending_review", "active"]).exists():
        raise Conflict("This unit already has an active or pending listing. Withdraw it first.")

    rent_minor = data.get("rent_minor")
    rent_currency = data.get("rent_currency", "GHS")
    if rent_minor is None:
        raise ValidationFailed("Set the rent amount.")

    try:
        Money(int(rent_minor), rent_currency)
    except Exception as exc:
        raise ValidationFailed("That rent amount is not valid.") from exc

    listing = Listing.objects.create(
        unit=unit,
        created_by=user,
        publication_state=PublicationState.DRAFT,
        moderation_state=ModerationState.NOT_REVIEWED,
        rent_minor=int(rent_minor),
        rent_currency=rent_currency,
        rent_period=data.get("rent_period", "monthly"),
        advance_months=data.get("advance_months", 1),
        caution_months=data.get("caution_months", 0),
        agency_fee_months=data.get("agency_fee_months", 0),
        headline=data.get("headline", ""),
        description=data.get("description", ""),
        available_from=data.get("available_from"),
        minimum_lease_months=data.get("minimum_lease_months", 6),
        # address is a non-null FK, so this always resolves.
        locality_id_cache=unit.property.address.locality_id,
        bedrooms_cache=unit.bedrooms,
    )

    record(
        action=AuditAction.CREATE,
        aggregate_type="listing",
        aggregate_id=listing.id,
        actor=user,
        metadata={"unit_id": str(unit.id), "rent_minor": rent_minor},
    )
    return listing


@transaction.atomic
def update_listing(*, listing: Listing, user, data: dict) -> Listing:
    """Correct a draft or a listing returned by Management for changes."""
    assert_can_manage(listing, user)
    if listing.status not in {
        ListingStatus.DRAFT,
        ListingStatus.REJECTED,
        ListingStatus.FLAGGED,
    }:
        raise Conflict("This listing cannot be edited while it is in its current state.")

    allowed = {
        "rent_minor",
        "rent_currency",
        "rent_period",
        "advance_months",
        "caution_months",
        "agency_fee_months",
        "headline",
        "description",
        "available_from",
        "minimum_lease_months",
    }
    before = {field: getattr(listing, field) for field in data if field in allowed}
    if "rent_minor" in data or "rent_currency" in data:
        try:
            Money(
                int(data.get("rent_minor", listing.rent_minor)),
                data.get("rent_currency", listing.rent_currency),
            )
        except Exception as exc:
            raise ValidationFailed("That rent amount is not valid.") from exc
    for field, value in data.items():
        if field in allowed:
            setattr(listing, field, value)
    previous_status = listing.status
    if previous_status in {ListingStatus.REJECTED, ListingStatus.FLAGGED}:
        listing.moderation_state = ModerationState.NOT_REVIEWED
        listing.publication_state = PublicationState.DRAFT
    elif listing.moderation_state == ModerationState.APPROVED:
        # The approval was for what the reviewer read. Changing the terms after
        # it means the next publish is a new claim, so it goes back for review.
        listing.moderation_state = ModerationState.NOT_REVIEWED
    listing.save(
        update_fields=[
            *before.keys(),
            "moderation_state",
            "publication_state",
            "updated_at",
        ]
    )

    changes = {
        field: [before[field], getattr(listing, field)]
        for field in before
        if before[field] != getattr(listing, field)
    }
    if previous_status != listing.status:
        changes["status"] = [previous_status, listing.status]
    if changes:
        record(
            action=AuditAction.UPDATE,
            aggregate_type="listing",
            aggregate_id=listing.id,
            actor=user,
            changes=changes,
            metadata={"reason": "provider_corrected_listing"},
        )
    return listing


@transaction.atomic
def publish_listing(*, listing: Listing, user) -> Listing:
    """Put it in front of strangers.

    Two checks, and they answer different questions.
    `assert_verified_provider` asks whether *this account* may advertise here —
    identity, provider standing, and a live authority relationship on this
    property, any of which may have been revoked since the draft was written.
    `can_publish` asks whether *this record* may be advertised: the property's
    authority is confirmed and the space itself has been checked.

    The second used to be advisory. An unchecked space could be published and
    merely went to a moderation queue instead, which meant the rule the
    architecture states — space verification blocks publishing that space — was
    written down in `trust.gates` and enforced nowhere. A room reached strangers
    on the strength of nobody having looked at it yet.
    """
    from apps.core.policy import enforce
    from apps.trust.gates import can_publish

    # Occupancy activation locks the Unit before withdrawing its Listing. Use
    # the same order so publish and move-in cannot pass each other in flight.
    Unit.objects.select_for_update().get(id=listing.unit_id)
    Listing.objects.select_for_update().get(id=listing.id)
    listing.refresh_from_db()
    assert_can_manage(listing, user)
    # Re-check at publication time. Identity, property authority, or the
    # relationship may have been revoked since this draft was created.
    assert_verified_provider(prop=listing.unit.property, user=user)
    enforce(
        can_publish(prop=listing.unit.property, unit=listing.unit),
        confirmed=True,
    )

    if listing.status not in (
        ListingStatus.DRAFT,
        ListingStatus.WITHDRAWN,
        ListingStatus.REJECTED,
    ):
        raise Conflict("This listing cannot be published from its current state.")

    if not listing.headline:
        raise ValidationFailed("Add a headline before publishing.")
    if not listing.description:
        raise ValidationFailed("Add a description before publishing.")
    if listing.rent_minor is None or listing.rent_minor <= 0:
        raise ValidationFailed("Set the rent before publishing.")

    previous = listing.status

    # An approval survives being taken down. Re-publishing something review has
    # already passed goes straight back up, rather than queueing unchanged work
    # behind listings nobody has looked at yet. Any edit that could invalidate
    # the approval clears it — see `update_listing`.
    already_approved = listing.moderation_state == ModerationState.APPROVED

    # The gate above has already established the space is checked, so there is
    # nothing further for a reviewer to add here: the property's authority was
    # reviewed, and the space's condition was reviewed against named photographs
    # of the room being let. A third queue asking somebody to look at the same
    # room once more added a wait without adding a judgement, and it is the wait
    # that pushes people to advertise somewhere else instead.
    #
    # So publishing is what the provider says it is: list it, or take it down.
    # Moderation keeps its teeth in the other direction — an active listing can
    # still be flagged or suspended.
    listing.publication_state = PublicationState.PUBLISHED
    listing.moderation_state = ModerationState.APPROVED
    listing.availability_state = AvailabilityState.AVAILABLE
    listing.review_note = ""
    listing.save(
        update_fields=[
            "publication_state",
            "moderation_state",
            "availability_state",
            "review_note",
            "updated_at",
        ]
    )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="listing",
        aggregate_id=listing.id,
        actor=user,
        changes={"status": [previous, listing.status]},
        metadata={
            "reason": "republished_without_review"
            if already_approved
            else "published_on_checked_space",
            "moderation_state": listing.moderation_state,
            "publication_state": listing.publication_state,
        },
    )
    return listing


@transaction.atomic
def moderate_listing(*, listing: Listing, management_actor, action: str, note: str = "") -> Listing:
    """Apply a Management decision. Consumer principals cannot call this service."""
    from apps.operations.models import ManagementRole, ManagementUser

    if not isinstance(management_actor, ManagementUser) or (
        management_actor.role != ManagementRole.OPERATIONS_ADMIN
    ):
        raise PermissionDenied("Only an Operations Admin can moderate listings.")

    transitions = {
        "approve": ({ListingStatus.PENDING_REVIEW, ListingStatus.FLAGGED}, ListingStatus.ACTIVE),
        "reject": ({ListingStatus.PENDING_REVIEW, ListingStatus.FLAGGED}, ListingStatus.REJECTED),
        "suspend": (
            {ListingStatus.ACTIVE, ListingStatus.PENDING_REVIEW, ListingStatus.FLAGGED},
            ListingStatus.SUSPENDED,
        ),
        "flag": (
            {ListingStatus.ACTIVE, ListingStatus.PENDING_REVIEW},
            ListingStatus.FLAGGED,
        ),
    }
    transition = transitions.get(action)
    if transition is None:
        raise ValidationFailed("Choose a valid moderation action.")
    allowed, target = transition
    if listing.status not in allowed:
        raise Conflict("This moderation action is not valid from the listing's current state.")
    if action != "approve" and not note.strip():
        raise ValidationFailed("Record a reason for this moderation action.")

    if action == "approve":
        assert_verified_provider(prop=listing.unit.property, user=listing.created_by)

    previous = listing.status
    # The verdict lands on the moderation axis; `status` follows from it. The
    # transition table above still reads `status`, which is the collapsed view
    # a reviewer sees, so the allowed-from sets stay exactly as they were.
    listing.moderation_state = {
        ListingStatus.ACTIVE: ModerationState.APPROVED,
        ListingStatus.REJECTED: ModerationState.REJECTED,
        ListingStatus.SUSPENDED: ModerationState.SUSPENDED,
        ListingStatus.FLAGGED: ModerationState.FLAGGED,
    }[target]
    listing.review_note = note.strip()
    listing.reviewed_by = None
    listing.reviewed_by_management_id = management_actor.id
    listing.reviewed_at = timezone.now()
    listing.save(
        update_fields=[
            "moderation_state",
            "review_note",
            "reviewed_by",
            "reviewed_by_management_id",
            "reviewed_at",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="listing",
        aggregate_id=listing.id,
        management_actor=management_actor,
        changes={"status": [previous, target]},
        metadata={"moderation_action": action, "note": note.strip()},
    )
    emit(
        DomainEvent(
            {
                "approve": "listing.approved.v1",
                "reject": "listing.rejected.v1",
                "suspend": "listing.suspended.v1",
                "flag": "listing.flagged.v1",
            }[action],
            "listing",
            str(listing.id),
            {"status": target, "note": note.strip()},
        )
    )
    return listing


@transaction.atomic
def withdraw_listing(*, listing: Listing, user, reason: str = "") -> Listing:
    assert_can_manage(listing, user)

    if listing.status not in (ListingStatus.ACTIVE, ListingStatus.PENDING_REVIEW):
        raise Conflict("This listing is not currently active.")

    # Only the publication axis moves. The moderation verdict is a fact about
    # what review decided, not about whether the provider is currently offering
    # it, and erasing it here is what forced a re-review on the way back.
    listing.publication_state = PublicationState.WITHDRAWN
    if listing.moderation_state == ModerationState.PENDING:
        # It leaves the queue. A pending review is a wait rather than a verdict,
        # and holding a withdrawn listing in it wastes a reviewer's turn on
        # something nobody is offering.
        listing.moderation_state = ModerationState.NOT_REVIEWED
    listing.review_note = reason
    listing.save(
        update_fields=["publication_state", "moderation_state", "review_note", "updated_at"]
    )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="listing",
        aggregate_id=listing.id,
        actor=user,
        changes={"status": [ListingStatus.ACTIVE, ListingStatus.WITHDRAWN]},
        metadata={"reason": reason},
    )
    emit(DomainEvent("listing.withdrawn.v1", "listing", str(listing.id), {"reason": reason}))
    return listing


@transaction.atomic
def attach_listing_media(
    *, listing: Listing, user, file, is_cover: bool = False, caption: str = "", sort_order: int = 0
) -> ListingMedia:
    from apps.files.models import FilePurpose

    assert_can_manage(listing, user)
    if not file.is_usable:
        raise ValidationFailed("That file is not ready yet.")
    if not file.is_owned_by(user):
        raise PermissionDenied("That file was not uploaded by you.")
    if file.purpose != FilePurpose.PROPERTY_PHOTO or file.is_sensitive:
        # Active listing media receives short-lived anonymous read URLs. Never
        # allow an identity/property document to cross that public boundary.
        raise ValidationFailed("Choose an uploaded property photo for this listing.")

    if is_cover:
        ListingMedia.objects.filter(listing=listing, is_cover=True).update(is_cover=False)

    return ListingMedia.objects.create(
        listing=listing,
        file=file,
        is_cover=is_cover,
        caption=caption,
        sort_order=sort_order,
    )
