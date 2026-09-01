"""High-consequence financial permissions for rent obligations."""

from __future__ import annotations

from enum import StrEnum

from apps.core.exceptions import Conflict, PermissionDenied


class ObligationCapability(StrEnum):
    WAIVE = "payments.obligation.waive"
    WRITE_OFF = "payments.obligation.write_off"


def _has_adjustment_authority(*, charge, user, capability: ObligationCapability) -> bool:
    """Whether this actor may make this kind of high-consequence decision."""
    del capability  # Both capabilities deliberately share the same narrow authority today.

    if not user or not user.is_authenticated:
        return False
    if user.is_staff:
        return True
    lease = charge.lease
    prop = lease.unit.property
    if str(lease.landlord_id) == str(user.id) or str(prop.owner_id) == str(user.id):
        return True

    from apps.organization.models import MembershipRole, OrganizationMembership

    return OrganizationMembership.objects.filter(
        user=user,
        ended_at__isnull=True,
        role__in=[MembershipRole.OWNER, MembershipRole.ADMIN],
        organization__is_active=True,
        organization__property_relationships__property=prop,
        organization__property_relationships__ended_at__isnull=True,
    ).exists()


def is_post_tenancy_obligation(*, charge) -> bool:
    """Waiver/write-off is a close-out decision, never active rent collection."""
    from apps.lease.models import LeaseStatus

    return charge.lease.status == LeaseStatus.ENDED


def can_adjust_obligation(*, charge, user, capability: ObligationCapability) -> bool:
    """Only an authorized creditor may adjust debt, and only after tenancy end.

    Property managers, accountants, staff, and property assignments deliberately
    do not inherit this authority from ordinary operational access. Even an
    owner cannot waive or write off an obligation while the tenancy is active.
    """
    return is_post_tenancy_obligation(charge=charge) and _has_adjustment_authority(
        charge=charge, user=user, capability=capability
    )


def assert_obligation_capability(*, charge, user, capability: ObligationCapability) -> None:
    # Check authority first so knowing a charge identifier never reveals its
    # lifecycle to somebody who has no access to make the decision at all.
    if not _has_adjustment_authority(charge=charge, user=user, capability=capability):
        raise PermissionDenied(
            "Only the creditor, property owner, or a Portfolio owner or administrator "
            "can perform this financial adjustment."
        )
    if not is_post_tenancy_obligation(charge=charge):
        raise Conflict("Waivers and write-offs are available only after the tenancy has ended.")
