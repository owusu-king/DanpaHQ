"""Who may see and who may change what a Portfolio pays for.

Deliberately narrower than the capability to *use* the Portfolio. A property
manager runs the buildings; changing the plan the business is on is not part of
running the buildings, and a manager who could upgrade could also commit the
owner to a bill. Owner and Admin only, which is the same boundary that already
guards the payout destination — the two most consequential Portfolio settings
answer to the same people.
"""

from __future__ import annotations

from apps.core.exceptions import PermissionDenied

VIEW = "billing.view"
MANAGE_SUBSCRIPTION = "billing.manage_subscription"
CHANGE_PLAN = "billing.change_plan"
MANAGE_PAYMENT_METHOD = "billing.manage_payment_method"
VIEW_INVOICES = "billing.view_invoices"

#: Everything about money in and out of this Portfolio.
_MANAGE = frozenset({MANAGE_SUBSCRIPTION, CHANGE_PLAN, MANAGE_PAYMENT_METHOD})


def _membership(*, organization, user):
    from apps.organization.models import OrganizationMembership

    if not user or not getattr(user, "is_authenticated", False):
        return None
    return OrganizationMembership.objects.filter(
        organization=organization, user=user, ended_at__isnull=True
    ).first()


def can(*, organization, user, permission: str) -> bool:
    from apps.organization.models import MembershipRole

    membership = _membership(organization=organization, user=user)
    if membership is None:
        return False

    if membership.role in (MembershipRole.OWNER, MembershipRole.ADMIN):
        return True

    # An accountant sees the bills and the invoices — that is the job — and
    # changes nothing. Everybody else sees neither: a Portfolio's commercial
    # terms are not operational information.
    if membership.role == MembershipRole.ACCOUNTANT:
        return permission in {VIEW, VIEW_INVOICES}
    return False


def assert_can(*, organization, user, permission: str) -> None:
    if can(organization=organization, user=user, permission=permission):
        return
    if _membership(organization=organization, user=user) is None:
        # Same answer as a Portfolio that does not exist. Knowing an id must not
        # reveal that somebody else's Portfolio is real, still less what it pays.
        raise PermissionDenied("You do not have access to that Portfolio.")
    if permission in _MANAGE:
        raise PermissionDenied("Only a Portfolio owner or administrator can change the plan.")
    raise PermissionDenied("You do not have access to this Portfolio's billing.")
