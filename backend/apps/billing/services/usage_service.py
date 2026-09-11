"""How much of its allowance a Portfolio is actually using.

**Counted live, from the authoritative tables.** There is no `PortfolioUsage`
cache, and that is a decision rather than an omission: a stored count is a
second answer to "how many properties does this Portfolio have", and the first
time it drifts it either blocks a customer who is under their limit or lets one
past it. The spec that asked for this layer says the same thing — prefer
authoritative queries for the limits that matter — and these queries are cheap
and indexed.

If a display surface ever needs a cached figure, it should be added as an
explicit, named cache with a stated refresh, not by making the enforcement path
read something that might be stale.
"""

from __future__ import annotations

PROPERTY_COUNT = "PROPERTY_COUNT"
UNIT_COUNT = "UNIT_COUNT"
TEAM_MEMBER_COUNT = "TEAM_MEMBER_COUNT"


def property_count(*, organization) -> int:
    """Properties this Portfolio currently holds.

    Archived and soft-deleted properties do not count. A provider who tidied up
    last year should not be paying for it, and the limit is about what is being
    operated now.
    """
    from apps.property.models import Property

    return (
        Property.objects.filter(
            organization_relationships__organization=organization,
            organization_relationships__ended_at__isnull=True,
        )
        .distinct()
        .count()
    )


def unit_count(*, organization) -> int:
    from apps.property.models import Unit

    # An archived property's units are archived with it, even though each unit
    # keeps its own `is_active`: they are not operated, so they are not counted.
    return (
        Unit.objects.filter(
            property__organization_relationships__organization=organization,
            property__organization_relationships__ended_at__isnull=True,
            property__deleted_at__isnull=True,
            is_active=True,
        )
        .distinct()
        .count()
    )


def team_member_count(*, organization) -> int:
    """People currently inside the Portfolio, including its owner.

    The owner occupies a seat because they are a person using the product. A
    Free limit of 1 therefore means "you, on your own", which is what it says on
    the plan.
    """
    from apps.organization.models import OrganizationMembership

    return OrganizationMembership.objects.filter(
        organization=organization, ended_at__isnull=True
    ).count()


COUNTERS = {
    PROPERTY_COUNT: property_count,
    UNIT_COUNT: unit_count,
    TEAM_MEMBER_COUNT: team_member_count,
}


def current(*, organization, metric: str) -> int:
    counter = COUNTERS.get(metric)
    if counter is None:
        raise KeyError(f"Unknown usage metric {metric!r}")
    return counter(organization=organization)


def snapshot(*, organization) -> dict[str, int]:
    return {metric: counter(organization=organization) for metric, counter in COUNTERS.items()}
