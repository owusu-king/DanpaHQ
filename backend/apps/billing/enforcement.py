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
"""

from __future__ import annotations

from django.db import transaction

from . import catalogue
from .services import entitlement_service, usage_service


def _lock_portfolio(organization):
    """Serialise limit decisions for one Portfolio.

    The Portfolio row is the natural gate: every counted resource belongs to
    exactly one, and locking it turns "check then create" into one decision.
    Cheap, because it is only ever taken on a create.
    """
    from apps.organization.models import Organization

    return Organization.all_objects.select_for_update().filter(pk=organization.pk).first()


def assert_can_add_property(*, organization) -> None:
    _lock_portfolio(organization)
    entitlement_service.assert_within_limit(
        organization=organization,
        key=catalogue.PROPERTY_LIMIT,
        metric=usage_service.PROPERTY_COUNT,
    )


def assert_can_add_unit(*, organization) -> None:
    _lock_portfolio(organization)
    entitlement_service.assert_within_limit(
        organization=organization,
        key=catalogue.UNIT_LIMIT,
        metric=usage_service.UNIT_COUNT,
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
    relationship = prop.organization_relationships.filter(ended_at__isnull=True).first()
    return relationship.organization if relationship is not None else None


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
