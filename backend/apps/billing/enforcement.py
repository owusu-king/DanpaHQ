"""The seam the rest of the application calls, and the only one it may.

Domain services import *this*, never the models and never a plan code. Two
reasons, and the second is the one that bites:

**Packaging must be changeable.** `if plan == "PRO"` in a property service is a
commercial decision welded into domain logic, and it is wrong the day an
override, a grace period or a fourth plan exists.

**A limit check has to be inside the write's transaction.** Counting properties
and then creating one, in two separate transactions, is how two concurrent
requests both see one slot free and both take it. Every function here is meant
to be called inside the caller's `@transaction.atomic`, and each one locks the
Portfolio row first so concurrent creations serialise behind each other rather
than racing.

**Above the allowance, nothing new starts.** A Portfolio can hold more than its
plan runs in full — a downgrade deletes nothing — and what is above the
allowance is restricted rather than lost (`models.resource_access`). Domain
services ask here before starting anything new on a property or a unit: a
listing, a viewing, a tenancy request, a lease, another unit. What already runs
never asks — rent, payments, receipts, documents and ending a tenancy go through
exactly as before — so a restriction can stop growth without stranding a tenant.
"""

from __future__ import annotations

from django.db import transaction

from . import catalogue
from .models import AccessState
from .services import entitlement_service, resource_access_service, usage_service

#: Raised when a property or unit above the allowance is asked to take on something new.
ResourceRestricted = resource_access_service.ResourceRestricted


def _lock_portfolio(organization):
    """Serialise limit decisions for one Portfolio.

    The Portfolio row is the natural gate: every counted resource belongs to
    exactly one, and locking it turns "check then create" into one decision.
    Cheap, because it is only ever taken on a create.
    """
    return resource_access_service.lock_portfolio(organization)


def assert_can_add_property(*, organization) -> None:
    """Room for another fully active property.

    Counted in fully active properties: one restricted after a downgrade is not
    being run, so it does not use up the allowance.
    """
    resource_access_service.assert_capacity(organization=organization, key=catalogue.PROPERTY_LIMIT)


def assert_can_add_unit(*, organization, prop=None) -> None:
    """Room for another fully active unit — in a property that may take one at all."""
    resource_access_service.assert_capacity(
        organization=organization, key=catalogue.UNIT_LIMIT, prop=prop
    )


def assert_can_add_team_member(*, organization) -> None:
    """A seat is taken when somebody joins, and checked when they are invited.

    Both, deliberately. Checking only at acceptance means inviting somebody who
    is then turned away at the door, which is a worse experience for two people
    instead of one.
    """
    _lock_portfolio(organization)
    entitlement_service.assert_within_limit(
        organization=organization,
        key=catalogue.TEAM_MEMBER_LIMIT,
        metric=usage_service.TEAM_MEMBER_COUNT,
    )


def assert_feature(*, organization, key: str) -> None:
    """A boolean capability gate. No lock: nothing is being counted."""
    entitlement_service.assert_can(organization=organization, key=key)


def has_feature(*, organization, key: str) -> bool:
    """The silent form, for a scheduled job that must not raise into a worker."""
    return entitlement_service.can(organization=organization, key=key)


def portfolio_for_property(prop):
    """The Portfolio that currently holds this property, if any.

    Returns `None` for a property with no live Portfolio relationship, and every
    caller treats that as "no limit to enforce" rather than as a refusal — an
    unattached property is a data state that predates billing, and billing must
    not be the thing that makes it unusable.
    """
    return resource_access_service.portfolio_for_property(prop)


# --- properties and units above the allowance --------------------------------------


def access_state(*, prop=None, unit=None) -> str:
    """`full`, `wind_down` or `read_only` — a unit's own, or its property's if stricter."""
    return resource_access_service.effective_state(prop=prop, unit=unit)


def accepts_new_activity(*, prop=None, unit=None) -> bool:
    return access_state(prop=prop, unit=unit) == AccessState.FULL


def assert_open_for_new_activity(*, prop=None, unit=None, action: str) -> None:
    """Refuse anything new on a restricted property or unit, in the provider's words.

    `action` names what was attempted, for the error's details and the client's
    way through. What already runs is never refused here.
    """
    resource_access_service.assert_open_for_new_activity(prop=prop, unit=unit, action=action)


def assert_accepting_requests(*, unit) -> None:
    """Refuse a tenant's new request on a restricted unit, without saying why."""
    resource_access_service.assert_accepting_requests(unit=unit)


def assert_details_editable(*, prop=None, unit=None) -> None:
    """Refuse changing the details of something read-only. Wind-down stays editable."""
    resource_access_service.assert_details_editable(prop=prop, unit=unit)


def restricted_unit_exists(unit_ref: str = "unit_id"):
    """A queryset expression: whether the referenced unit is restricted."""
    return resource_access_service.restricted_unit_exists(unit_ref)


def access_states(*, property_ids) -> dict:
    """Every restriction touching these properties, in one read."""
    return resource_access_service.access_states(property_ids=property_ids)


def access_payload(state: str, *, noun: str) -> dict:
    """How one resource's access reads to its provider. Presentation, not permission."""
    return resource_access_service.access_payload(state, noun=noun)


def rental_activity_ended(*, unit, actor=None) -> None:
    """A tenancy or agreement on this space ended or was withdrawn."""
    resource_access_service.settle_after_rental_activity(unit=unit, actor=actor)


def property_restored(*, prop, actor=None) -> None:
    """An archived property is back, and counts again — fully active only if there is room."""
    resource_access_service.place_restored(prop=prop, actor=actor)


def unit_restored(*, unit, actor=None) -> None:
    """An archived unit is back, and counts again — fully active only if there is room."""
    resource_access_service.place_restored(unit=unit, actor=actor)


@transaction.atomic
def on_portfolio_created(*, organization, actor=None) -> None:
    """Give a brand-new Portfolio its billing account and Free subscription.

    Called from `organization.create_organization`, inside its transaction, so a
    Portfolio and its billing state commit together. A Portfolio that existed
    without a subscription would fall back to Free anyway, but only by accident
    rather than by record.
    """
    from .services import subscription_service

    subscription_service.ensure_free_subscription(organization=organization, actor=actor)
