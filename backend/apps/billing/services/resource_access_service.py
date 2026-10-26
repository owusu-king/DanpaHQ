"""Which of a Portfolio's properties and units its plan still runs in full.

`models.resource_access` describes the three states. This module is the only
writer of those rows, and everything that writes runs inside the caller's
transaction with the Portfolio row locked — the gate the limits already use
(ADR 0032 §6) — so a restriction, a reactivation and a creation for one
Portfolio are decided one after another, never side by side.

**Restriction follows the limits in force, and only ever restricts.** When the
enforced limits fall below the Portfolio's fully active resources — a downgrade,
a cancellation or scheduled change taking effect, a renewal left past due, an
override ending — `reconcile` keeps what the Portfolio chose to keep, fills any
allowance left over in the fallback order, and restricts the rest. It never
promotes anything: more allowance makes restricted resources *eligible*, and a
person reactivates them on purpose. Nothing changes under somebody by surprise.

**The fallback**, for whatever was not chosen before the change took effect, is
deterministic and keeps the busiest resources running:

1. the properties with the most spaces that have something running, first —
   they carry the day-to-day work, and restricting one would stop a renewal;
2. then the longest held, earliest created first;
3. then the id, so two equal properties can never swap places between runs.

Units inside the properties that stay fully active follow the same rule: a unit
with something running, then the earliest, then the id.

**Running** means a tenancy that is upcoming or active, or an agreement that has
been offered, accepted or is active. An offer already in a tenant's hands counts:
it was made while the space was fully active, and a tenant should not find it
withdrawn because of somebody else's plan.

**Capacity is counted in fully active resources.** A restricted property does
not use up the allowance, so archiving a fully active one frees a place — to
create something new, or to reactivate something restricted.
"""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import timedelta

from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import Conflict, DomainError, ValidationFailed

from .. import catalogue
from ..models import (
    AccessState,
    KeepActiveChoice,
    PortfolioPlanOverride,
    ResourceAccess,
    ResourceKind,
)
from ..policies import entitlement_policy
from . import entitlement_service


class ResourceRestricted(DomainError):
    """Refused because the property or unit is above the plan's allowance.

    409, like a limit: nothing is wrong with the request, the Portfolio's plan is
    what stands in its way. `details` names the resource and its state, so a
    client can offer the way through — reactivation, or an upgrade.
    """

    code = "resource_restricted"
    status_code = 409
    message = "This is above the plan's limit, so it cannot take on new rental activity."


#: How restrictive each state is, for a unit that inherits its property's.
_SEVERITY = {AccessState.FULL: 0, AccessState.WIND_DOWN: 1, AccessState.READ_ONLY: 2}

#: More than any Portfolio could choose from in one request.
_MAX_IDS = 1000


# --- the Portfolio gate --------------------------------------------------------


def lock_portfolio(organization):
    """Serialise every decision about one Portfolio's allowance.

    The Portfolio row is the natural gate: every counted resource belongs to
    exactly one, and taking it turns "check, then act" into one decision.
    """
    from apps.organization.models import Organization

    return Organization.all_objects.select_for_update().filter(pk=organization.pk).first()


def portfolio_for_property(prop):
    """The Portfolio holding this property now. `None` means there is nothing to enforce."""
    relationship = (
        prop.organization_relationships.filter(ended_at__isnull=True)
        .select_related("organization")
        .first()
    )
    return relationship.organization if relationship is not None else None


# --- what a Portfolio holds ------------------------------------------------------


def _live_properties(organization):
    from apps.property.models import Property

    return Property.objects.filter(
        organization_relationships__organization=organization,
        organization_relationships__ended_at__isnull=True,
    ).distinct()


def _running_unit_ids(unit_ids) -> set:
    """The spaces among these with a tenancy or an agreement still running."""
    from apps.lease.models import Lease, LeaseStatus
    from apps.tenancy.models import LIVE_STATUSES, Tenancy

    running = set(
        Tenancy.objects.filter(unit_id__in=unit_ids, status__in=LIVE_STATUSES).values_list(
            "unit_id", flat=True
        )
    )
    running.update(
        Lease.objects.filter(
            unit_id__in=unit_ids,
            status__in=(
                LeaseStatus.OFFERED,
                LeaseStatus.TENANT_ACCEPTED,
                LeaseStatus.AWAITING_ACTIVATION,
                LeaseStatus.ACTIVE,
            ),
        ).values_list("unit_id", flat=True)
    )
    return running


@dataclass
class _Inventory:
    """What a Portfolio holds, what is running in it, and what is restricted."""

    properties: list
    units: list
    running_units: set
    running_by_property: Counter
    property_rows: dict = field(default_factory=dict)
    unit_rows: dict = field(default_factory=dict)

    def full_properties(self) -> list:
        """Held and not restricted, in the order the fallback keeps them."""
        return sorted(
            (prop for prop in self.properties if prop.id not in self.property_rows),
            key=lambda prop: (-self.running_by_property[prop.id], prop.created_at, str(prop.id)),
        )

    def full_units(self) -> list:
        """Active and not restricted, inside a property that is not restricted either."""
        return self.ordered_units(
            unit
            for unit in self.units
            if unit.property_id not in self.property_rows and unit.id not in self.unit_rows
        )

    def ordered_units(self, units) -> list:
        return sorted(
            units,
            key=lambda unit: (unit.id not in self.running_units, unit.created_at, str(unit.id)),
        )


def _inventory(organization, *, lock: bool = False) -> _Inventory:
    from apps.property.models import Unit

    properties = list(_live_properties(organization).only("id", "title", "created_at"))
    property_ids = [prop.id for prop in properties]
    units = list(
        Unit.objects.filter(property_id__in=property_ids, is_active=True).only(
            "id", "property_id", "label", "created_at"
        )
    )
    running = _running_unit_ids(
        Unit.objects.filter(property_id__in=property_ids).values_list("id", flat=True)
    )
    inventory = _Inventory(
        properties=properties,
        units=units,
        running_units=running,
        running_by_property=Counter(
            Unit.objects.filter(id__in=running).values_list("property_id", flat=True)
        ),
    )
    rows = ResourceAccess.objects.filter(organization=organization)
    if lock:
        rows = rows.select_for_update()
    for row in rows:
        if row.kind == ResourceKind.PROPERTY:
            inventory.property_rows[row.property_id] = row
        else:
            inventory.unit_rows[row.unit_id] = row
    return inventory


def _limits(organization, plan=None) -> tuple[int | None, int | None]:
    if plan is None:
        return (
            entitlement_service.limit(organization=organization, key=catalogue.PROPERTY_LIMIT),
            entitlement_service.limit(organization=organization, key=catalogue.UNIT_LIMIT),
        )
    return (
        entitlement_service.limit_on_plan(
            organization=organization, plan=plan, key=catalogue.PROPERTY_LIMIT
        ),
        entitlement_service.limit_on_plan(
            organization=organization, plan=plan, key=catalogue.UNIT_LIMIT
        ),
    )


def _keep(candidates: list, *, limit: int | None, preferred) -> set:
    """Which candidates stay fully active: the chosen first, then in order, up to the limit."""
    if limit is None:
        return {candidate.id for candidate in candidates}
    available = {candidate.id for candidate in candidates}
    kept: list = []
    for identifier in preferred:
        if len(kept) >= limit:
            break
        if identifier in available and identifier not in kept:
            kept.append(identifier)
    for candidate in candidates:
        if len(kept) >= limit:
            break
        if candidate.id not in kept:
            kept.append(candidate.id)
    return set(kept)


@dataclass(frozen=True)
class _Choice:
    property_ids: list
    unit_ids: list


def _saved_choice(organization) -> _Choice:
    rows = list(
        KeepActiveChoice.objects.filter(organization=organization).values_list(
            "kind", "property_id", "unit_id"
        )
    )
    return _Choice(
        property_ids=[
            property_id for kind, property_id, _ in rows if kind == ResourceKind.PROPERTY
        ],
        unit_ids=[unit_id for kind, _, unit_id in rows if kind == ResourceKind.UNIT],
    )


# --- writing a state -------------------------------------------------------------


def _state_for(*, running: bool) -> str:
    return AccessState.WIND_DOWN if running else AccessState.READ_ONLY


def _audit(row: ResourceAccess, *, actor, previous: str, current: str, reason: str) -> None:
    unit_row = row.kind == ResourceKind.UNIT
    record(
        action=AuditAction.UPDATE,
        aggregate_type="unit" if unit_row else "property",
        aggregate_id=str(row.unit_id if unit_row else row.property_id),
        actor=actor,
        changes={"billing_access": [str(previous), str(current)]},
        metadata={
            "organization_id": str(row.organization_id),
            "plan_code": row.plan_code,
            "reason": reason,
        },
    )


def _restrict(
    *, organization, kind, property_id, unit_id=None, running: bool, plan_code: str, now, actor
) -> ResourceAccess:
    state = _state_for(running=running)
    row = ResourceAccess.objects.create(
        organization=organization,
        kind=kind,
        property_id=property_id,
        unit_id=unit_id,
        state=state,
        plan_code=plan_code,
        restricted_at=now,
        state_changed_at=now,
    )
    _audit(
        row, actor=actor, previous=AccessState.FULL, current=state, reason="above_plan_allowance"
    )
    return row


def _settle(row: ResourceAccess, *, running: bool, now, actor) -> bool:
    """Wind-down while something runs; read-only once nothing does."""
    target = _state_for(running=running)
    if row.state == target:
        return False
    previous = row.state
    row.state = target
    row.state_changed_at = now
    row.save(update_fields=["state", "state_changed_at", "updated_at"])
    _audit(
        row,
        actor=actor,
        previous=previous,
        current=target,
        reason=(
            "rental_activity_ended"
            if target == AccessState.READ_ONLY
            else "rental_activity_running"
        ),
    )
    return True


def _release(row: ResourceAccess, *, actor, reason: str) -> None:
    _audit(row, actor=actor, previous=row.state, current=AccessState.FULL, reason=reason)
    row.delete()


def _fit_units(
    inventory: _Inventory,
    *,
    organization,
    property_id,
    unit_limit,
    preferred,
    plan_code,
    now,
    actor,
) -> int:
    """Restrict one property's own units beyond the room left — never another property's."""
    if unit_limit is None:
        return 0
    full = inventory.full_units()
    mine = [unit for unit in full if unit.property_id == property_id]
    room = max(unit_limit - (len(full) - len(mine)), 0)
    keep = _keep(mine, limit=room, preferred=preferred)
    restricted = 0
    for unit in mine:
        if unit.id in keep:
            continue
        inventory.unit_rows[unit.id] = _restrict(
            organization=organization,
            kind=ResourceKind.UNIT,
            property_id=unit.property_id,
            unit_id=unit.id,
            running=unit.id in inventory.running_units,
            plan_code=plan_code,
            now=now,
            actor=actor,
        )
        restricted += 1
    return restricted


# --- when the limits change --------------------------------------------------------


@transaction.atomic
def reconcile(*, organization, actor=None, now=None) -> dict[str, int]:
    """Bring access states in line with the limits in force. Only ever restricts.

    Called wherever the enforced limits can fall — a plan change, a scheduled
    change or cancellation taking effect, grace running out — and by a sweep for
    what time alone changes, such as an override expiring. Idempotent: a second
    run over an unchanged Portfolio writes nothing.
    """
    lock_portfolio(organization)
    now = now or timezone.now()
    inventory = _inventory(organization, lock=True)
    property_limit, unit_limit = _limits(organization)
    plan_code = entitlement_service.current_plan(organization=organization).code
    outcome: Counter = Counter()

    # What is no longer held — archived, or moved out of this Portfolio — is not
    # restricted any more; it simply is not counted. Restoring it decides again.
    held = {prop.id for prop in inventory.properties}
    active = {unit.id for unit in inventory.units}
    for property_id, row in list(inventory.property_rows.items()):
        if property_id not in held:
            _release(row, actor=actor, reason="no_longer_held")
            del inventory.property_rows[property_id]
            outcome["released"] += 1
    for unit_id, row in list(inventory.unit_rows.items()):
        if unit_id not in active:
            _release(row, actor=actor, reason="no_longer_held")
            del inventory.unit_rows[unit_id]
            outcome["released"] += 1

    choice = _saved_choice(organization)

    full = inventory.full_properties()
    if property_limit is not None and len(full) > property_limit:
        keep = _keep(full, limit=property_limit, preferred=choice.property_ids)
        for prop in full:
            if prop.id in keep:
                continue
            inventory.property_rows[prop.id] = _restrict(
                organization=organization,
                kind=ResourceKind.PROPERTY,
                property_id=prop.id,
                running=inventory.running_by_property[prop.id] > 0,
                plan_code=plan_code,
                now=now,
                actor=actor,
            )
            outcome["restricted"] += 1

    units = inventory.full_units()
    if unit_limit is not None and len(units) > unit_limit:
        keep = _keep(units, limit=unit_limit, preferred=choice.unit_ids)
        for unit in units:
            if unit.id in keep:
                continue
            inventory.unit_rows[unit.id] = _restrict(
                organization=organization,
                kind=ResourceKind.UNIT,
                property_id=unit.property_id,
                unit_id=unit.id,
                running=unit.id in inventory.running_units,
                plan_code=plan_code,
                now=now,
                actor=actor,
            )
            outcome["restricted"] += 1

    for property_id, row in inventory.property_rows.items():
        if _settle(
            row, running=inventory.running_by_property[property_id] > 0, now=now, actor=actor
        ):
            outcome["settled"] += 1
    for unit_id, row in inventory.unit_rows.items():
        if _settle(row, running=unit_id in inventory.running_units, now=now, actor=actor):
            outcome["settled"] += 1
    return dict(outcome)


def sweep(*, limit: int = 500, now=None) -> dict[str, int]:
    """What time alone changes: wind-downs that have ended, and overrides that lapsed."""
    from apps.organization.models import Organization

    now = now or timezone.now()
    since = now - timedelta(days=1)
    restricted = (
        ResourceAccess.objects.order_by()
        .values_list("organization_id", flat=True)
        .distinct()[:limit]
    )
    lapsed = (
        PortfolioPlanOverride.objects.filter(
            Q(expires_at__gt=since, expires_at__lte=now) | Q(revoked_at__gt=since)
        )
        .order_by()
        .values_list("organization_id", flat=True)
        .distinct()[:limit]
    )
    totals: Counter = Counter()
    for organization in Organization.all_objects.filter(id__in={*restricted, *lapsed}):
        totals.update(reconcile(organization=organization, now=now))
    return dict(totals)


# --- creating inside the allowance -------------------------------------------------


def _full_property_count(organization) -> int:
    return (
        _live_properties(organization).exclude(billing_access__kind=ResourceKind.PROPERTY).count()
    )


def _full_unit_count(organization) -> int:
    from apps.property.models import Unit

    return (
        Unit.objects.filter(
            is_active=True,
            property__deleted_at__isnull=True,
            property__organization_relationships__organization=organization,
            property__organization_relationships__ended_at__isnull=True,
        )
        .exclude(property__billing_access__kind=ResourceKind.PROPERTY)
        .exclude(billing_access__kind=ResourceKind.UNIT)
        .distinct()
        .count()
    )


def assert_capacity(*, organization, key: str, prop=None) -> int:
    """Refuse a new property or unit the plan has no room to run in full.

    Called inside the transaction that creates it, and takes the Portfolio lock
    first, so two concurrent creations cannot both take the last place.
    Restricted resources do not count: they are not being run.
    """
    lock_portfolio(organization)
    if prop is not None:
        assert_open_for_new_activity(prop=prop, action="add_unit")
    ceiling = entitlement_service.limit(organization=organization, key=key)
    current = (
        _full_property_count(organization)
        if key == catalogue.PROPERTY_LIMIT
        else _full_unit_count(organization)
    )
    if ceiling is None or current + 1 <= ceiling:
        return current + 1
    raise entitlement_service.limit_reached(
        organization=organization, key=key, current=current, ceiling=ceiling, needed=current + 1
    )


# --- asking about one resource -------------------------------------------------------


def effective_state(*, prop=None, unit=None) -> str:
    """The access state that applies: a unit's own, or its property's when that is stricter."""
    if unit is not None:
        condition = Q(kind=ResourceKind.UNIT, unit_id=unit.id) | Q(
            kind=ResourceKind.PROPERTY, property_id=unit.property_id
        )
    elif prop is not None:
        condition = Q(kind=ResourceKind.PROPERTY, property_id=prop.id)
    else:
        return AccessState.FULL
    states = list(ResourceAccess.objects.filter(condition).values_list("state", flat=True))
    return max(states, key=lambda state: _SEVERITY[state], default=AccessState.FULL)


def _noun(unit) -> str:
    return "unit" if unit is not None else "property"


def _restriction_message(state: str, noun: str) -> str:
    if state == AccessState.WIND_DOWN:
        return (
            f"This {noun} is above your plan's limit. Its current tenancies continue, but new "
            "rental activity needs plan capacity or an upgrade."
        )
    return (
        f"This {noun} is read-only on your current plan. Its records stay available, but new "
        "rental activity needs plan capacity or an upgrade."
    )


def assert_open_for_new_activity(*, prop=None, unit=None, action: str) -> None:
    state = effective_state(prop=prop, unit=unit)
    if state == AccessState.FULL:
        return
    noun = _noun(unit)
    subject = unit if unit is not None else prop
    raise ResourceRestricted(
        _restriction_message(state, noun),
        details={
            "resource": noun,
            "id": str(subject.id),
            "access_state": str(state),
            "action": action,
        },
    )


def assert_accepting_requests(*, unit) -> None:
    """The tenant-facing refusal: the place is not taking requests — never why.

    A provider's plan is not a stranger's business, so this names no plan, no
    limit and no state.
    """
    if effective_state(unit=unit) != AccessState.FULL:
        raise Conflict("That place is not accepting new requests right now.")


def assert_details_editable(*, prop=None, unit=None) -> None:
    state = effective_state(prop=prop, unit=unit)
    if state != AccessState.READ_ONLY:
        return
    noun = _noun(unit)
    subject = unit if unit is not None else prop
    raise ResourceRestricted(
        f"This {noun} is read-only on your current plan, so its details stay as they are. "
        "Its records remain available.",
        details={
            "resource": noun,
            "id": str(subject.id),
            "access_state": str(state),
            "action": "edit",
        },
    )


def restricted_unit_exists(unit_ref: str = "unit_id") -> Exists:
    """For a queryset: whether the unit at `unit_ref` is restricted, itself or by its property."""
    return Exists(
        ResourceAccess.objects.filter(
            Q(kind=ResourceKind.UNIT, unit_id=OuterRef(unit_ref))
            | Q(kind=ResourceKind.PROPERTY, property__units=OuterRef(unit_ref))
        )
    )


def access_states(*, property_ids) -> dict[str, dict[str, str]]:
    """Every restriction touching these properties, in one read, for rendering a list."""
    states: dict[str, dict[str, str]] = {"properties": {}, "units": {}}
    rows = ResourceAccess.objects.filter(property_id__in=list(property_ids)).values_list(
        "kind", "property_id", "unit_id", "state"
    )
    for kind, property_id, unit_id, state in rows:
        if kind == ResourceKind.PROPERTY:
            states["properties"][str(property_id)] = state
        else:
            states["units"][str(unit_id)] = state
    return states


def access_payload(state: str, *, noun: str) -> dict[str, str]:
    """What a client shows about one resource. Presentation only — the services decide."""
    return {
        "state": str(state),
        "label": AccessState(state).label,
        "message": "" if state == AccessState.FULL else _restriction_message(state, noun),
    }


# --- what already runs ----------------------------------------------------------------


def settle_after_rental_activity(*, unit, actor=None, now=None) -> None:
    """Something on this space ended or was withdrawn, so its wind-down may be over."""
    from apps.property.models import Unit

    rows = list(
        ResourceAccess.objects.select_for_update().filter(
            Q(kind=ResourceKind.UNIT, unit_id=unit.id)
            | Q(kind=ResourceKind.PROPERTY, property_id=unit.property_id)
        )
    )
    if not rows:
        return
    now = now or timezone.now()
    running = _running_unit_ids(
        Unit.objects.filter(property_id=unit.property_id).values_list("id", flat=True)
    )
    for row in rows:
        still_running = (
            bool(running) if row.kind == ResourceKind.PROPERTY else row.unit_id in running
        )
        _settle(row, running=still_running, now=now, actor=actor)


@transaction.atomic
def place_restored(*, prop=None, unit=None, actor=None, now=None) -> None:
    """A restored property or unit counts again, so it is fully active only if there is room."""
    held_property = prop if prop is not None else unit.property
    organization = portfolio_for_property(held_property)
    if organization is None:
        return
    lock_portfolio(organization)
    now = now or timezone.now()
    inventory = _inventory(organization, lock=True)
    property_limit, unit_limit = _limits(organization)
    plan_code = entitlement_service.current_plan(organization=organization).code

    if prop is not None:
        if prop.id in inventory.property_rows or prop.id not in {
            p.id for p in inventory.properties
        }:
            return
        others = [p for p in inventory.full_properties() if p.id != prop.id]
        if property_limit is not None and len(others) >= property_limit:
            inventory.property_rows[prop.id] = _restrict(
                organization=organization,
                kind=ResourceKind.PROPERTY,
                property_id=prop.id,
                running=inventory.running_by_property[prop.id] > 0,
                plan_code=plan_code,
                now=now,
                actor=actor,
            )
            return
        _fit_units(
            inventory,
            organization=organization,
            property_id=prop.id,
            unit_limit=unit_limit,
            preferred=[],
            plan_code=plan_code,
            now=now,
            actor=actor,
        )
        return

    if (
        unit_limit is None
        or unit.property_id in inventory.property_rows
        or unit.id in inventory.unit_rows
    ):
        return
    others = [u for u in inventory.full_units() if u.id != unit.id]
    if len(others) >= unit_limit:
        inventory.unit_rows[unit.id] = _restrict(
            organization=organization,
            kind=ResourceKind.UNIT,
            property_id=unit.property_id,
            unit_id=unit.id,
            running=unit.id in inventory.running_units,
            plan_code=plan_code,
            now=now,
            actor=actor,
        )


# --- a person deciding ----------------------------------------------------------------


def _identifiers(values, *, noun: str) -> list:
    if values in (None, ""):
        return []
    if not isinstance(values, list | tuple):
        raise ValidationFailed(f"Send the {noun} ids as a list.")
    if len(values) > _MAX_IDS:
        raise ValidationFailed(f"Choose at most {_MAX_IDS} at a time.")
    parsed: list = []
    for value in values:
        try:
            identifier = uuid.UUID(str(value))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValidationFailed(f"That {noun} could not be found.") from exc
        if identifier not in parsed:
            parsed.append(identifier)
    return parsed


def _count(number: int, singular: str, plural: str) -> str:
    return f"{number} {singular if number == 1 else plural}"


def _no_room(*, organization, key: str, current: int, ceiling: int):
    noun = "property" if key == catalogue.PROPERTY_LIMIT else "unit"
    return entitlement_service.limit_reached(
        organization=organization,
        key=key,
        current=current,
        ceiling=ceiling,
        needed=current + 1,
        message=(
            f"This plan has no room to reactivate another {noun}. Upgrade, or archive a {noun} "
            "that is fully active."
        ),
    )


@transaction.atomic
def reactivate(*, organization, user, property_ids=(), unit_ids=(), now=None) -> dict[str, list]:
    """Bring restricted properties or units back into full use, as far as the plan has room.

    Deliberate by design: the only way anything restricted becomes fully active
    again. A reactivated property brings its units back as far as the unit
    allowance allows — the ones named in `unit_ids` first, then in fallback
    order — and never takes a place from a unit that is already fully active.
    """
    entitlement_policy.assert_can(
        organization=organization, user=user, permission=entitlement_policy.CHANGE_PLAN
    )
    properties = _identifiers(property_ids, noun="property")
    units = _identifiers(unit_ids, noun="unit")
    if not properties and not units:
        raise ValidationFailed("Choose a property or unit to reactivate.")

    lock_portfolio(organization)
    now = now or timezone.now()
    inventory = _inventory(organization, lock=True)
    property_limit, unit_limit = _limits(organization)
    plan_code = entitlement_service.current_plan(organization=organization).code
    held = {prop.id for prop in inventory.properties}
    active = {unit.id for unit in inventory.units}
    done: dict[str, list] = {"properties": [], "units": []}

    for property_id in properties:
        row = inventory.property_rows.get(property_id)
        if row is None or property_id not in held:
            raise ValidationFailed("That property is not restricted.")
        in_use = len(inventory.full_properties())
        if property_limit is not None and in_use >= property_limit:
            raise _no_room(
                organization=organization,
                key=catalogue.PROPERTY_LIMIT,
                current=in_use,
                ceiling=property_limit,
            )
        _release(row, actor=user, reason="reactivated")
        del inventory.property_rows[property_id]
        _fit_units(
            inventory,
            organization=organization,
            property_id=property_id,
            unit_limit=unit_limit,
            preferred=units,
            plan_code=plan_code,
            now=now,
            actor=user,
        )
        done["properties"].append(str(property_id))

    for unit_id in units:
        row = inventory.unit_rows.get(unit_id)
        if row is None:
            if unit_id in {unit.id for unit in inventory.full_units()}:
                continue  # already back, with its property
            raise ValidationFailed("That unit is not restricted.")
        if unit_id not in active:
            raise ValidationFailed("That unit is archived. Restore it first.")
        if row.property_id in inventory.property_rows:
            raise Conflict("Reactivate the property this unit is in first.")
        in_use = len(inventory.full_units())
        if unit_limit is not None and in_use >= unit_limit:
            raise _no_room(
                organization=organization,
                key=catalogue.UNIT_LIMIT,
                current=in_use,
                ceiling=unit_limit,
            )
        _release(row, actor=user, reason="reactivated")
        del inventory.unit_rows[unit_id]
        done["units"].append(str(unit_id))
    return done


def downgrade_choice(*, organization, plan) -> dict:
    """What a move to `plan` would leave fully active, and what the Portfolio may choose.

    Only fully active resources are candidates — anything already restricted
    stays restricted either way. `selected` is the saved choice where there is
    one and the fallback otherwise, so the review opens on exactly what would
    happen if nobody touched it.
    """
    inventory = _inventory(organization)
    property_limit, unit_limit = _limits(organization, plan)
    full = inventory.full_properties()
    units = inventory.full_units()
    required = (property_limit is not None and len(full) > property_limit) or (
        unit_limit is not None and len(units) > unit_limit
    )
    saved = _saved_choice(organization)
    kept_properties = _keep(full, limit=property_limit, preferred=saved.property_ids)
    candidates = [unit for unit in units if unit.property_id in kept_properties]
    kept_units = _keep(candidates, limit=unit_limit, preferred=saved.unit_ids)

    by_property = defaultdict(list)
    for unit in units:
        by_property[unit.property_id].append(unit)

    return {
        "required": required,
        # The limits this choice settles. Any other limit the Portfolio would sit
        # above is not chosen here: what exists stays, and adding more waits.
        "covers": [catalogue.PROPERTY_LIMIT, catalogue.UNIT_LIMIT],
        "limits": {"properties": property_limit, "units": unit_limit},
        "active": {"properties": len(full), "units": len(units)},
        "properties": (
            [
                {
                    "id": str(prop.id),
                    "title": prop.title or "Untitled property",
                    "running_units": inventory.running_by_property[prop.id],
                    "units": [
                        {
                            "id": str(unit.id),
                            "label": unit.label or "Unit",
                            "running": unit.id in inventory.running_units,
                        }
                        for unit in by_property[prop.id]
                    ],
                }
                for prop in full
            ]
            if required
            else []
        ),
        "selected": {
            "property_ids": [str(prop.id) for prop in full if prop.id in kept_properties]
            if required
            else [],
            "unit_ids": [str(unit.id) for unit in candidates if unit.id in kept_units]
            if required
            else [],
        },
    }


@transaction.atomic
def save_choice(*, organization, user, plan, keep_active) -> None:
    """Record what to keep fully active when `plan`'s limits take effect.

    `None` records nothing and leaves the fallback in charge. A choice replaces
    the previous one whole: it is one decision about one change.
    """
    if keep_active is None:
        return
    if not isinstance(keep_active, dict):
        raise ValidationFailed("Say which properties and units to keep fully active.")
    properties = _identifiers(keep_active.get("property_ids"), noun="property")
    units = _identifiers(keep_active.get("unit_ids"), noun="unit")

    lock_portfolio(organization)
    inventory = _inventory(organization)
    property_limit, unit_limit = _limits(organization, plan)

    full = {prop.id for prop in inventory.full_properties()}
    if any(property_id not in full for property_id in properties):
        raise ValidationFailed("Choose from the properties that are fully active now.")
    if property_limit is not None and len(properties) > property_limit:
        raise ValidationFailed(
            f"{plan.name} includes {_count(property_limit, 'property', 'properties')}. "
            "Choose up to that many."
        )
    full_units = {unit.id: unit for unit in inventory.full_units()}
    if any(unit_id not in full_units for unit_id in units):
        raise ValidationFailed("Choose from the units that are fully active now.")
    if properties and any(full_units[unit_id].property_id not in properties for unit_id in units):
        raise ValidationFailed("Choose units inside the properties you are keeping.")
    if unit_limit is not None and len(units) > unit_limit:
        raise ValidationFailed(
            f"{plan.name} includes {_count(unit_limit, 'unit', 'units')}. Choose up to that many."
        )

    KeepActiveChoice.objects.filter(organization=organization).delete()
    KeepActiveChoice.objects.bulk_create(
        [
            *(
                KeepActiveChoice(
                    organization=organization,
                    kind=ResourceKind.PROPERTY,
                    property_id=property_id,
                    position=position,
                    chosen_by=user,
                )
                for position, property_id in enumerate(properties)
            ),
            *(
                KeepActiveChoice(
                    organization=organization,
                    kind=ResourceKind.UNIT,
                    property_id=full_units[unit_id].property_id,
                    unit_id=unit_id,
                    position=position,
                    chosen_by=user,
                )
                for position, unit_id in enumerate(units)
            ),
        ]
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="organization",
        aggregate_id=str(organization.id),
        actor=user,
        metadata={
            "action": "keep_active_chosen",
            "plan_code": plan.code,
            "property_ids": [str(value) for value in properties],
            "unit_ids": [str(value) for value in units],
        },
    )


def clear_choice(*, organization) -> None:
    """The change it was made for is off, so the choice goes with it."""
    KeepActiveChoice.objects.filter(organization=organization).delete()


def summary(*, organization) -> dict:
    """Plan & billing's view: what is fully active against the allowance, and what is not."""
    inventory = _inventory(organization)
    property_limit, unit_limit = _limits(organization)
    full = inventory.full_properties()
    units = inventory.full_units()
    titles = {prop.id: prop.title or "Untitled property" for prop in inventory.properties}
    labels = {unit.id: unit.label or "Unit" for unit in inventory.units}

    property_rows = [row for key, row in inventory.property_rows.items() if key in titles]
    unit_rows = [
        row
        for key, row in inventory.unit_rows.items()
        if key in labels and row.property_id not in inventory.property_rows
    ]

    unit_states: Counter = Counter()
    for unit in inventory.units:
        states = [
            row.state
            for row in (
                inventory.property_rows.get(unit.property_id),
                inventory.unit_rows.get(unit.id),
            )
            if row is not None
        ]
        if states:
            unit_states[max(states, key=lambda state: _SEVERITY[state])] += 1

    def allowance(active: int, restricted: Counter, limit: int | None) -> dict:
        return {
            "active": active,
            "wind_down": restricted[AccessState.WIND_DOWN],
            "read_only": restricted[AccessState.READ_ONLY],
            "limit": limit,
            "available": None if limit is None else max(limit - active, 0),
        }

    return {
        "properties": allowance(
            len(full), Counter(row.state for row in property_rows), property_limit
        ),
        "units": allowance(len(units), unit_states, unit_limit),
        "restricted": [
            *(
                {
                    "kind": ResourceKind.PROPERTY.value,
                    "id": str(row.property_id),
                    "property_id": str(row.property_id),
                    "name": titles[row.property_id],
                    "property_name": titles[row.property_id],
                    "state": row.state,
                    "restricted_at": row.restricted_at.isoformat(),
                }
                for row in property_rows
            ),
            *(
                {
                    "kind": ResourceKind.UNIT.value,
                    "id": str(row.unit_id),
                    "property_id": str(row.property_id),
                    "name": labels[row.unit_id],
                    "property_name": titles.get(row.property_id, ""),
                    "state": row.state,
                    "restricted_at": row.restricted_at.isoformat(),
                }
                for row in unit_rows
            ),
        ][:200],
    }
