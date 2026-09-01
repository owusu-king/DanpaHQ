"""Archiving and removing property and rentable space.

The policies in `policies.py` decide; this performs. Keeping them apart is what
lets the same answer serve both the action and the `permitted_actions` payload
a client renders from — a button that is shown and a call that is allowed can
never disagree, because they read the same function.

Nothing here destroys history. `SoftDeleteModel` already carries `deleted_at`
and `deleted_reason`, so archiving is a state the record enters rather than a
row that stops existing, and a former tenant can still read the property their
tenancy was attached to.
"""

from __future__ import annotations

from django.db import transaction

from apps.core.policy import enforce, record_transition

from .models import Property, Unit
from .policies import (
    can_archive_property,
    can_archive_space,
    can_delete_property,
    can_delete_space,
    can_restore_property,
    can_restore_space,
)


def _decision_payload(decision) -> dict:
    return {
        "allowed": decision.allowed,
        "code": decision.code,
        "message": decision.message,
        "blockers": [
            {"kind": blocker.kind, "count": blocker.count, "message": blocker.message}
            for blocker in decision.blockers
        ],
    }


def archived_resources_for(*, actor) -> dict:
    """Archived provider inventory this actor remains authorized to manage.

    Properties and spaces deliberately share one read boundary but not one
    model. A Property uses soft deletion; a Unit uses ``is_active`` because it
    remains a child in the property's historical inventory. The response makes
    that distinction explicit instead of inventing a generic Archive model.
    """
    from apps.audit.models import AuditLog
    from apps.organization.services import properties_for_user

    accessible = properties_for_user(actor, include_archived=True)
    property_rows = list(
        accessible.filter(deleted_at__isnull=False)
        .select_related("address__locality__district")
        .prefetch_related("units__beds")
        .order_by("-deleted_at", "title")
    )
    accessible_ids = accessible.values_list("id", flat=True)
    space_rows = list(
        Unit.objects.filter(property_id__in=accessible_ids, is_active=False)
        .select_related("property")
        .prefetch_related("beds")
        .order_by("-updated_at", "property__title", "label")
    )

    # Unit has no second archive timestamp column: the append-only transition
    # log already owns that fact and its reason. Read the newest archive entry
    # for every currently inactive Unit in one query.
    space_ids = [str(unit.id) for unit in space_rows]
    archive_entries: dict[str, object] = {}
    for entry in AuditLog.objects.filter(
        aggregate_type="space",
        aggregate_id__in=space_ids,
        metadata__action="archive",
    ).order_by("-created_at"):
        archive_entries.setdefault(entry.aggregate_id, entry)

    return {
        "properties": [
            {
                "resource_type": "property",
                "id": str(prop.id),
                "label": prop.title or "Untitled property",
                "property_type": prop.property_type,
                "property_type_label": prop.get_property_type_display(),
                "locality": prop.address.locality.name,
                "district": prop.address.locality.district.name,
                "unit_count": prop.units.count(),
                "bed_count": sum(unit.beds.count() for unit in prop.units.all()),
                "archived_at": prop.deleted_at.isoformat(),
                "archived_reason": prop.deleted_reason,
                "restore": _decision_payload(can_restore_property(actor=actor, target=prop)),
            }
            for prop in property_rows
        ],
        "spaces": [
            {
                "resource_type": "space",
                "id": str(unit.id),
                "label": unit.label or "Unit",
                "space_type": unit.space_type,
                "space_type_label": unit.get_space_type_display(),
                "property_id": str(unit.property_id),
                "property_title": unit.property.title,
                "property_archived": unit.property.deleted_at is not None,
                "bed_count": unit.beds.count(),
                "archived_at": (
                    archive_entries[str(unit.id)].created_at.isoformat()
                    if str(unit.id) in archive_entries
                    else unit.updated_at.isoformat()
                ),
                "archived_reason": (
                    archive_entries[str(unit.id)].metadata.get("reason", "")
                    if str(unit.id) in archive_entries
                    else ""
                ),
                "restore": _decision_payload(can_restore_space(actor=actor, target=unit)),
            }
            for unit in space_rows
        ],
    }


@transaction.atomic
def archive_property(
    *, prop: Property, actor, reason: str, confirmed: bool = True, elevated: bool = False
) -> Property:
    """Take a property out of the workspace, keeping everything attached to it."""
    decision = can_archive_property(actor=actor, target=prop, elevated=elevated)
    enforce(decision, reason=reason, confirmed=confirmed, elevated=elevated)

    from . import access_codes

    for unit in prop.units.filter(access_code_hash__isnull=False):
        access_codes.revoke(
            unit=unit,
            actor=None if elevated else actor,
            management_actor=actor if elevated else None,
            reason="property_archived",
        )

    prop.delete(reason=reason)  # SoftDeleteModel: sets deleted_at, keeps the row

    record_transition(
        action="archive",
        target_type="property",
        target=prop,
        actor=actor,
        decision=decision,
        reason=reason,
        previous="active",
        current="archived",
        elevated=elevated,
    )
    return prop


@transaction.atomic
def restore_property(*, prop: Property, actor, elevated: bool = False) -> Property:
    """Undo an archive.

    Deliberately available: archiving is reversible by design, and a provider
    who archived the wrong building should not need support to put it back.
    """
    decision = can_restore_property(actor=actor, target=prop, elevated=elevated)
    enforce(decision, elevated=elevated)

    prop.deleted_at = None
    prop.deleted_reason = ""
    prop.save(update_fields=["deleted_at", "deleted_reason", "updated_at"])

    record_transition(
        action="restore",
        target_type="property",
        target=prop,
        actor=actor,
        decision=decision,
        previous="archived",
        current="active",
        elevated=elevated,
    )
    return prop


@transaction.atomic
def delete_property(
    *, prop: Property, actor, reason: str, confirmed: bool = True, elevated: bool = False
) -> None:
    """Remove a property nobody outside the workspace has ever seen.

    The policy refuses this the moment any lease, occupancy or published listing
    has existed, so reaching here means there is genuinely no counterparty
    history to protect.
    """
    decision = can_delete_property(actor=actor, target=prop, elevated=elevated)
    enforce(decision, reason=reason, confirmed=confirmed, elevated=elevated)

    # Recorded before the row goes, so the audit entry can still name it.
    record_transition(
        action="delete",
        target_type="property",
        target=prop,
        actor=actor,
        decision=decision,
        reason=reason,
        previous="active",
        current="deleted",
        elevated=elevated,
        extra={"title": prop.title},
    )
    # `hard_delete`, not `delete`: on a SoftDeleteQuerySet the latter sets
    # `deleted_at` and returns happily, so this endpoint would have reported a
    # removal it never performed. The policy above has already established
    # there is no history to protect.
    Property.all_objects.filter(pk=prop.pk).hard_delete()


@transaction.atomic
def archive_space(
    *, unit: Unit, actor, reason: str, confirmed: bool = True, elevated: bool = False
) -> Unit:
    """Take a rentable space out of inventory, keeping its history."""
    decision = can_archive_space(actor=actor, target=unit, elevated=elevated)
    enforce(decision, reason=reason, confirmed=confirmed, elevated=elevated)

    from . import access_codes

    access_codes.revoke(
        unit=unit,
        actor=None if elevated else actor,
        management_actor=actor if elevated else None,
        reason="space_archived",
    )

    unit.is_active = False
    unit.save(update_fields=["is_active", "updated_at"])

    record_transition(
        action="archive",
        target_type="space",
        target=unit,
        actor=actor,
        decision=decision,
        reason=reason,
        previous="active",
        current="archived",
        elevated=elevated,
    )
    return unit


@transaction.atomic
def restore_space(*, unit: Unit, actor, elevated: bool = False) -> Unit:
    decision = can_restore_space(actor=actor, target=unit, elevated=elevated)
    enforce(decision, elevated=elevated)

    unit.is_active = True
    unit.save(update_fields=["is_active", "updated_at"])

    record_transition(
        action="restore",
        target_type="space",
        target=unit,
        actor=actor,
        decision=decision,
        previous="archived",
        current="active",
        elevated=elevated,
    )
    return unit


@transaction.atomic
def delete_space(
    *, unit: Unit, actor, reason: str = "", confirmed: bool = True, elevated: bool = False
) -> None:
    decision = can_delete_space(actor=actor, target=unit, elevated=elevated)
    enforce(decision, reason=reason, confirmed=confirmed, elevated=elevated)

    record_transition(
        action="delete",
        target_type="space",
        target=unit,
        actor=actor,
        decision=decision,
        reason=reason,
        previous="active",
        current="deleted",
        elevated=elevated,
        extra={"label": unit.label, "property_id": str(unit.property_id)},
    )
    Unit.objects.filter(pk=unit.pk).delete()
