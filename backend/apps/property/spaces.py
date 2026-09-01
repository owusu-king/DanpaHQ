"""The rentable space: its details, its amenities, its photographs.

A `Unit` is the thing that is actually let — a flat, a room, a bed, a shop, a
plot. `services.add_unit` creates one; this module is everything that happens to
it afterwards, and it is separate from `services.py` for the same reason
`lifecycle.py` and `policies.py` are: that module is about the property, and a
space has its own rules, its own gates and its own lifecycle.

### What the space keeps, and what it reads from the property

Nothing here copies the address. Where a space *is* comes from
`unit.property.address` through the relationship, because a building whose flats
each carry their own copy of the address is a building whose flats can disagree
about where the building is. What a space carries is only what genuinely differs
inside one address: which building or block, which floor, which wing, which door,
and what to call it.

### Photographs are the space's photographs, and also its evidence

One upload, two consequences. `attach_photo` stores a `UnitMedia` row *and*
files the same file as evidence against the named verification slot. Asking a
provider to photograph a room once for a reviewer and again for a tenant is how
the reviewed room and the advertised room come to be different rooms.

### Editing stops when somebody is looking

`trust.condition.is_editable` is the gate: draft work is never blocked by a
review that has not started, and always blocked by one that has. After approval,
changing what was approved is a re-check rather than an edit — see
:func:`request_recheck`, which supersedes the approval and takes the space out of
public discovery, because a listing that stays up on a superseded check is
exactly the false confidence this product exists to remove.
"""

from __future__ import annotations

from django.db import transaction

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed

from .models import (
    Amenity,
    AmenityScope,
    Property,
    PropertyAmenity,
    Unit,
    UnitAmenity,
    UnitMedia,
)

#: What a provider may change about a space after it exists.
#:
#: `space_type` is deliberately absent and handled separately: it decides what
#: evidence is asked for, what may be let, and whether beds are possible, so
#: changing it is a different act from correcting a label.
EDITABLE_FIELDS = frozenset(
    {
        "label",
        "description",
        "building_id",
        "bedrooms",
        "bathrooms",
        "floor_area_sqm",
        "floor_level",
        "wing",
        "entrance_note",
        "has_private_bathroom",
        "has_private_toilet",
        "has_private_kitchen",
        "is_furnished",
        "has_air_conditioning",
    }
)

# These help a provider operate the home without changing the facts a tenant
# and reviewer relied on. Everything else above describes the rentable space
# itself and is therefore protected while somebody has possession of it.
OPERATIONAL_FIELDS = frozenset({"entrance_note"})
VERIFICATION_SENSITIVE_FIELDS = EDITABLE_FIELDS - OPERATIONAL_FIELDS


# --- lookup ------------------------------------------------------------------


def get_space_or_404(pk, user) -> Unit:
    """The space, if this person manages the property it belongs to.

    Not-found and not-yours answer identically at the boundary above this by
    raising the same 404 for a space that exists but is somebody else's, so the
    endpoint cannot be used to discover which unit ids are real.
    """
    unit = (
        Unit.objects.filter(pk=pk)
        .select_related("property__address__locality__district__region", "building")
        .first()
    )
    if unit is None:
        raise NotFound("We could not find that space.")
    if not unit.property.is_managed_by(user):
        raise NotFound("We could not find that space.")
    return unit


def assert_can_manage(unit: Unit, user) -> None:
    if not unit.property.is_managed_by(user):
        raise PermissionDenied("You do not have access to that space.")


def assert_editable(unit: Unit) -> None:
    """Refuse a change while a reviewer holds this, or after they decided."""
    from apps.trust import condition

    state = condition.lifecycle_state(unit)
    if state in condition.EDITABLE_STATES:
        return
    if state == condition.ConditionState.VERIFIED:
        raise Conflict(
            "This space has been checked, so its details are fixed as they were "
            "approved. Start a re-check to change them."
        )
    raise Conflict(
        "This space is with our review team. You can change it again once they "
        "have come back to you."
    )


def assert_not_occupied_for_sensitive_change(unit: Unit) -> None:
    """Protect the agreed and allocated shape of an occupied Unit.

    Occupancy is the authoritative boundary, including a bed allocation inside
    the Unit. A provider may still change operational labels and private door
    directions, but not the characteristics, amenities, photographs or
    allocation structure a tenant's lease rests on.
    """
    from apps.occupancy.services import unit_is_occupied

    if unit_is_occupied(unit):
        raise Conflict(
            "This space is currently occupied. Its checked characteristics cannot "
            "change until that occupancy has ended. You can still update its "
            "private entrance directions."
        )


# --- details -----------------------------------------------------------------


@transaction.atomic
def update_space(*, unit: Unit, user, data: dict) -> Unit:
    """Correct the space's own details.

    Validates the interior counts through the same `space_rules` the creation
    path uses, so a plot cannot acquire two bathrooms by a second request that
    skipped the form.
    """
    from .models import Building
    from .space_rules import assert_interior_is_coherent

    unit = Unit.objects.select_for_update().select_related("property").get(id=unit.id)
    payload = {key: value for key, value in data.items() if key in EDITABLE_FIELDS}
    assert_can_manage(unit, user)
    from apps.core.policy import enforce

    from .policies import can_edit_operational_space, can_edit_space

    decision = (
        can_edit_space(actor=user, target=unit)
        if payload.keys() & VERIFICATION_SENSITIVE_FIELDS
        else can_edit_operational_space(actor=user, target=unit)
    )
    enforce(decision)
    if "building_id" in payload:
        building_id = payload["building_id"] or None
        if (
            building_id
            and not Building.objects.filter(
                id=building_id, property=unit.property, is_active=True
            ).exists()
        ):
            raise ValidationFailed("Choose an active building in this property.")
        payload["building_id"] = building_id

    if not payload:
        raise ValidationFailed("Change at least one detail.")

    assert_interior_is_coherent(
        space_type=unit.space_type,
        bedrooms=payload.get("bedrooms", unit.bedrooms),
        bathrooms=payload.get("bathrooms", unit.bathrooms),
    )

    before = {key: getattr(unit, key) for key in payload}
    for key, value in payload.items():
        setattr(unit, key, value)
    unit.save(update_fields=[*payload.keys(), "updated_at"])

    changes = {
        key: [before[key], getattr(unit, key)]
        for key in payload
        if before[key] != getattr(unit, key)
    }
    if changes:
        record(
            action=AuditAction.UPDATE,
            aggregate_type="unit",
            aggregate_id=unit.id,
            actor=user,
            changes={key: [str(a), str(b)] for key, (a, b) in changes.items()},
            metadata={"property_id": str(unit.property_id)},
        )
    return unit


@transaction.atomic
def change_space_type(*, unit: Unit, user, space_type: str) -> Unit:
    """Reclassify what is let here.

    Its own service because it is not a correction. The space type decides which
    photographs are asked for, whether beds may exist, and whether the interior
    counts mean anything — so changing it after a review would leave a space
    approved against a set of requirements it no longer has.

    Refused once anything has been let or listed here, for the same reason
    `policies._space_has_history` refuses deletion: a tenant who took a room
    should not find it reclassified as a shop.
    """
    from .policies import _space_has_history
    from .space_rules import assert_interior_is_coherent, assert_space_type_allowed

    unit = Unit.objects.select_for_update().select_related("property").get(id=unit.id)
    assert_can_manage(unit, user)
    assert_not_occupied_for_sensitive_change(unit)
    assert_editable(unit)

    if space_type == unit.space_type:
        return unit
    if _space_has_history(unit):
        raise Conflict(
            "This space has been let or advertised, so what it is cannot change. "
            "Add a new space instead."
        )
    if unit.beds.exists():
        raise Conflict("Remove the bed spaces in this room before changing what it is.")

    assert_space_type_allowed(property_type=unit.property.property_type, space_type=space_type)
    assert_interior_is_coherent(
        space_type=space_type, bedrooms=unit.bedrooms, bathrooms=unit.bathrooms
    )

    previous = unit.space_type
    unit.space_type = space_type
    unit.save(update_fields=["space_type", "updated_at"])

    record(
        action=AuditAction.UPDATE,
        aggregate_type="unit",
        aggregate_id=unit.id,
        actor=user,
        changes={"space_type": [previous, space_type]},
        metadata={"property_id": str(unit.property_id)},
    )
    return unit


# --- amenities ---------------------------------------------------------------


def available_amenities(*, scope: str, space_type: str = "") -> list[Amenity]:
    """The amenities worth offering for this scope, and this kind of space.

    Filtering happens here rather than in each client so a hostel bed is not
    offered a porch and a shop is not offered a wardrobe. `space_types` empty
    means "every type", which is why the filter cannot be a plain `contains`.
    """
    rows = Amenity.objects.filter(is_active=True)
    if scope == AmenityScope.UNIT:
        rows = rows.filter(scope__in=[AmenityScope.UNIT, AmenityScope.BOTH])
    elif scope == AmenityScope.PROPERTY:
        rows = rows.filter(scope__in=[AmenityScope.PROPERTY, AmenityScope.BOTH])

    rows = list(rows)
    if scope == AmenityScope.UNIT and space_type:
        rows = [row for row in rows if row.applies_to_space_type(space_type)]
    return rows


@transaction.atomic
def set_space_amenities(*, unit: Unit, user, amenity_ids: list, notes: dict | None = None) -> list:
    """Replace what this space says it has.

    A replacement rather than an add/remove pair, because the interface is a
    checklist and two endpoints for one screen means a half-saved state whenever
    a phone loses signal between them.

    Removed amenities are marked `removed_at`, never deleted: "the generator was
    working when I signed" has to stay answerable after the generator is gone.

    Amenities that mirror a `Unit` flag write the flag too — see
    `Amenity.unit_flag_field`. Without that, a provider ticking "Kitchen" here
    and the evidence policy reading `has_private_kitchen` would be two answers to
    one question.
    """
    unit = Unit.objects.select_for_update().select_related("property").get(id=unit.id)
    assert_can_manage(unit, user)
    assert_not_occupied_for_sensitive_change(unit)
    assert_editable(unit)

    notes = notes or {}
    wanted = {str(value) for value in amenity_ids}
    offered = {
        str(amenity.id): amenity
        for amenity in available_amenities(scope=AmenityScope.UNIT, space_type=unit.space_type)
    }

    unknown = wanted - set(offered)
    if unknown:
        raise ValidationFailed("One of those is not something this kind of space can have.")

    live = {
        str(row.amenity_id): row
        for row in UnitAmenity.objects.filter(unit=unit, removed_at__isnull=True)
    }

    from django.utils import timezone

    now = timezone.now()
    for amenity_id, row in live.items():
        if amenity_id not in wanted:
            row.removed_at = now
            row.save(update_fields=["removed_at", "updated_at"])

    for amenity_id in wanted:
        note = str(notes.get(amenity_id, ""))[:200]
        existing = live.get(amenity_id)
        if existing is not None:
            if existing.notes != note:
                existing.notes = note
                existing.save(update_fields=["notes", "updated_at"])
            continue
        UnitAmenity.objects.create(unit=unit, amenity_id=amenity_id, notes=note)

    _sync_declared_flags(unit=unit, chosen=wanted, offered=offered)

    record(
        action=AuditAction.UPDATE,
        aggregate_type="unit",
        aggregate_id=unit.id,
        actor=user,
        changes={"amenities": [sorted(live), sorted(wanted)]},
        metadata={"property_id": str(unit.property_id)},
    )
    return list(
        UnitAmenity.objects.filter(unit=unit, removed_at__isnull=True).select_related("amenity")
    )


def _sync_declared_flags(*, unit: Unit, chosen: set[str], offered: dict[str, Amenity]) -> None:
    """Keep the legacy `Unit` booleans in step with the amenity checklist.

    Only flags that some *offered* amenity claims. A flag whose amenity is not
    applicable to this space type is left exactly as it is rather than being
    cleared — a bed space is never offered "Kitchen", and reading that absence as
    "no kitchen" would erase an answer nobody was asked for.
    """
    updates: dict[str, bool] = {}
    for amenity_id, amenity in offered.items():
        field = amenity.unit_flag_field
        if not field or not hasattr(unit, field):
            continue
        updates[field] = amenity_id in chosen

    changed = [field for field, value in updates.items() if getattr(unit, field) != value]
    if not changed:
        return
    for field in changed:
        setattr(unit, field, updates[field])
    unit.save(update_fields=[*changed, "updated_at"])


@transaction.atomic
def set_property_amenities(*, prop: Property, user, amenity_ids: list, notes: dict | None = None):
    """The same, one level up: what the compound has."""
    from django.utils import timezone

    if not prop.is_managed_by(user):
        raise PermissionDenied("You do not have access to that property.")

    notes = notes or {}
    wanted = {str(value) for value in amenity_ids}
    offered = {
        str(amenity.id): amenity for amenity in available_amenities(scope=AmenityScope.PROPERTY)
    }
    if wanted - set(offered):
        raise ValidationFailed("One of those is not a property amenity.")

    live = {
        str(row.amenity_id): row
        for row in PropertyAmenity.objects.filter(property=prop, removed_at__isnull=True)
    }
    now = timezone.now()
    for amenity_id, row in live.items():
        if amenity_id not in wanted:
            row.removed_at = now
            row.save(update_fields=["removed_at", "updated_at"])
    for amenity_id in wanted:
        note = str(notes.get(amenity_id, ""))[:200]
        existing = live.get(amenity_id)
        if existing is not None:
            if existing.notes != note:
                existing.notes = note
                existing.save(update_fields=["notes", "updated_at"])
            continue
        PropertyAmenity.objects.create(property=prop, amenity_id=amenity_id, notes=note)

    # An empty chosen set is still an answer. Without a durable confirmation,
    # clients cannot distinguish "this compound has no shared amenities" from
    # "the provider has not reached this creation checkpoint yet".
    if prop.amenities_confirmed_at is None:
        prop.amenities_confirmed_at = now
        prop.save(update_fields=["amenities_confirmed_at", "updated_at"])

    record(
        action=AuditAction.UPDATE,
        aggregate_type="property",
        aggregate_id=prop.id,
        actor=user,
        changes={"amenities": [sorted(live), sorted(wanted)]},
    )
    return list(
        PropertyAmenity.objects.filter(property=prop, removed_at__isnull=True).select_related(
            "amenity"
        )
    )


# --- photographs -------------------------------------------------------------


def photo_capacity(unit: Unit) -> int:
    """How many photographs a space may carry.

    Every current evidence slot may carry one photo. Photos whose amenity was
    later deselected remain useful Unit history/presentation and therefore do
    not make the remaining slots impossible to fill; they add to capacity but
    cannot satisfy a current requirement.
    """
    from apps.trust import evidence_policy

    slots = evidence_policy.space_requirements(unit)
    valid_keys = [slot.key for slot in slots]
    orphaned = UnitMedia.objects.filter(unit=unit).exclude(slot_key__in=valid_keys).count()
    return len(slots) + orphaned


@transaction.atomic
def attach_photo(
    *,
    unit: Unit,
    user,
    file,
    slot_key: str = "",
    caption: str = "",
    make_primary: bool | None = None,
) -> UnitMedia:
    """Store a photograph of this space, and file it as evidence.

    ``slot_key`` names which of the space's evidence slots this answers. Omitted,
    the first outstanding slot is used, so a client that simply uploads three
    photographs in order fills the required one first — which is what a phone
    camera flow actually looks like.

    The first photograph becomes the primary one unless told otherwise. There is
    always exactly one primary while any photograph exists, enforced by the
    database rather than by whichever screen wrote last.
    """
    from apps.files.models import FilePurpose
    from apps.trust import condition

    unit = Unit.objects.select_for_update().select_related("property").get(id=unit.id)
    assert_can_manage(unit, user)
    assert_not_occupied_for_sensitive_change(unit)
    assert_editable(unit)

    if not file.is_usable:
        raise ValidationFailed("That photo is still being checked. Try again in a moment.")
    if not file.is_owned_by(user):
        raise PermissionDenied("That upload belongs to another account.")
    if file.purpose != FilePurpose.PROPERTY_PHOTO or file.is_sensitive:
        # These photographs are shown publicly on a listing. An identity or
        # ownership document must never cross that boundary, and the check is
        # here rather than at the edge because every caller goes through this.
        raise ValidationFailed("Choose an uploaded property photo for this space.")

    existing = list(UnitMedia.objects.filter(unit=unit).order_by("-is_primary", "sort_order"))
    capacity = photo_capacity(unit)
    if len(existing) >= capacity:
        raise Conflict(f"A space carries {capacity} photographs. Remove one before adding another.")

    slot_key = slot_key or _first_open_slot(unit=unit, taken={row.slot_key for row in existing})

    # Evidence first: it validates the slot against the policy, and a photo
    # stored for a slot the policy does not have would be a photo nobody asked
    # for sitting in a checklist that cannot show it.
    condition.attach(subject=unit, actor=user, slot_key=slot_key, file=file)

    is_primary = make_primary if make_primary is not None else not existing
    if is_primary and existing:
        UnitMedia.objects.filter(unit=unit, is_primary=True).update(is_primary=False)

    media = UnitMedia.objects.create(
        unit=unit,
        file=file,
        caption=caption[:120],
        slot_key=slot_key,
        is_primary=is_primary,
        sort_order=len(existing),
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="unit_media",
        aggregate_id=media.id,
        actor=user,
        metadata={
            "unit_id": str(unit.id),
            "property_id": str(unit.property_id),
            "slot_key": slot_key,
            "is_primary": is_primary,
        },
    )
    return media


def _first_open_slot(*, unit: Unit, taken: set[str]) -> str:
    from apps.trust import evidence_policy

    for slot in evidence_policy.space_requirements(unit):
        if slot.key not in taken:
            return slot.key
    raise Conflict("Every photograph this space needs has already been provided.")


@transaction.atomic
def remove_photo(*, unit: Unit, user, media_id) -> None:
    """Take a photograph off the space, and out of the open review with it.

    Leaving the evidence behind would let a submission pass on a photograph the
    provider had already withdrawn, which is the one way this could produce a
    review of something nobody can see.
    """
    from apps.trust import condition

    unit = Unit.objects.select_for_update().select_related("property").get(id=unit.id)
    assert_can_manage(unit, user)
    assert_not_occupied_for_sensitive_change(unit)
    assert_editable(unit)

    media = UnitMedia.objects.filter(unit=unit, id=media_id).first()
    if media is None:
        raise NotFound("We could not find that photo.")

    condition.detach(subject=unit, actor=user, file_id=media.file_id)

    was_primary = media.is_primary
    media.delete()

    if was_primary:
        # Something has to be the primary photograph while any exist, or the
        # listing has no cover and the card renders a grey box.
        successor = UnitMedia.objects.filter(unit=unit).order_by("sort_order").first()
        if successor is not None:
            successor.is_primary = True
            successor.save(update_fields=["is_primary", "updated_at"])

    record(
        action=AuditAction.DELETE,
        aggregate_type="unit_media",
        aggregate_id=media_id,
        actor=user,
        metadata={"unit_id": str(unit.id), "property_id": str(unit.property_id)},
    )


@transaction.atomic
def set_primary_photo(*, unit: Unit, user, media_id) -> UnitMedia:
    """Choose the first image. Allowed after verification: it reorders what was
    already approved rather than changing it."""
    assert_can_manage(unit, user)

    media = UnitMedia.objects.filter(unit=unit, id=media_id).first()
    if media is None:
        raise NotFound("We could not find that photo.")
    if media.is_primary:
        return media

    UnitMedia.objects.filter(unit=unit, is_primary=True).update(is_primary=False)
    media.is_primary = True
    media.save(update_fields=["is_primary", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="unit_media",
        aggregate_id=media.id,
        actor=user,
        changes={"is_primary": [False, True]},
        metadata={"unit_id": str(unit.id)},
    )
    return media


# --- re-checking -------------------------------------------------------------


@transaction.atomic
def request_recheck(*, unit: Unit, user, reason: str = "") -> Unit:
    """Reopen an approved space so its details and photographs can change.

    The approval is superseded rather than deleted — what was decided, and on
    what evidence, stays readable — and the space's live listings come down with
    it. A listing that stayed up would be advertising an unchecked room under a
    check that no longer applies, and that is precisely the false confidence the
    verification model exists to prevent.
    """
    from apps.core.policy import enforce
    from apps.listing.services import suspend_for_verification
    from apps.trust import condition
    from apps.trust.models import SubjectType, VerificationKind, VerificationStatus

    from .policies import can_recheck_space

    unit = Unit.objects.select_for_update().select_related("property").get(id=unit.id)
    assert_can_manage(unit, user)
    enforce(can_recheck_space(actor=user, target=unit), confirmed=True)

    settled = condition.settled_review(unit)
    if settled is None or settled.status != VerificationStatus.APPROVED:
        raise Conflict("This space has no approved check to reopen.")

    settled.status = VerificationStatus.SUPERSEDED
    settled.save(update_fields=["status", "updated_at"])
    from .access_codes import revoke

    revoke(unit=unit, actor=user, reason="space_recheck_started")

    withdrawn = suspend_for_verification(
        subject_type=SubjectType.SPACE,
        subject_id=unit.id,
        kind=VerificationKind.SPACE_CONDITION,
        reason=(
            reason.strip()
            or "The provider reopened this space for changes, so its check no longer applies."
        ),
    )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="unit",
        aggregate_id=unit.id,
        actor=user,
        changes={"condition": ["verified", "draft"]},
        metadata={
            "reason": reason.strip(),
            "listings_suspended": withdrawn,
            "superseded_verification_id": str(settled.id),
        },
    )
    return unit
