"""The server-side Management role matrix. Missing capabilities deny access."""

from __future__ import annotations

from enum import StrEnum

from rest_framework.permissions import BasePermission

from .models import ManagementRole, ManagementUser


class Capability(StrEnum):
    VIEW_DASHBOARD = "view_dashboard"
    VIEW_USERS = "view_users"
    MANAGE_USERS = "manage_users"
    VIEW_VERIFICATIONS = "view_verifications"
    DECIDE_VERIFICATIONS = "decide_verifications"
    VIEW_PROPERTIES = "view_properties"
    MODERATE_LISTINGS = "moderate_listings"
    VIEW_REPORTS = "view_reports"
    MANAGE_REPORTS = "manage_reports"
    VIEW_SUPPORT = "view_support"
    MANAGE_SUPPORT = "manage_support"
    VIEW_RENTALS = "view_rentals"
    VIEW_PAYMENTS = "view_payments"
    RECONCILE_PAYMENTS = "reconcile_payments"
    VIEW_BILLING = "view_billing"
    MANAGE_BILLING = "manage_billing"
    VIEW_AUDIT_LOGS = "view_audit_logs"
    VIEW_CONFIGURATION = "view_configuration"
    MANAGE_CONFIGURATION = "manage_configuration"
    MANAGE_PROFILE = "manage_profile"


COMMON = {
    Capability.VIEW_DASHBOARD,
    Capability.VIEW_USERS,
    Capability.VIEW_PROPERTIES,
    Capability.VIEW_REPORTS,
    Capability.MANAGE_REPORTS,
    Capability.VIEW_SUPPORT,
    Capability.MANAGE_SUPPORT,
    Capability.VIEW_RENTALS,
    # Support answers "what plan am I on and why can't I add a property", which
    # needs the reading. Changing what somebody pays for is a separate grant.
    Capability.VIEW_BILLING,
    Capability.MANAGE_PROFILE,
}

ROLE_CAPABILITIES: dict[str, frozenset[Capability]] = {
    ManagementRole.OPERATIONS_ADMIN: frozenset(
        COMMON
        | {
            Capability.MANAGE_USERS,
            Capability.VIEW_VERIFICATIONS,
            Capability.DECIDE_VERIFICATIONS,
            Capability.MODERATE_LISTINGS,
            Capability.VIEW_AUDIT_LOGS,
            Capability.VIEW_PAYMENTS,
            Capability.RECONCILE_PAYMENTS,
            Capability.MANAGE_BILLING,
            Capability.VIEW_CONFIGURATION,
            Capability.MANAGE_CONFIGURATION,
        }
    ),
    ManagementRole.SUPPORT_ADMIN: frozenset(COMMON),
}


def capabilities_for(role: str) -> list[str]:
    return sorted(str(capability) for capability in ROLE_CAPABILITIES.get(role, frozenset()))


class HasManagementCapability(BasePermission):
    message = "Your Management role does not allow this action."

    def has_permission(self, request, view):
        user = request.user
        if not isinstance(user, ManagementUser) or not user.is_active:
            return False
        required = getattr(view, "required_capability", None)
        if required is None:
            return False
        return Capability(required) in ROLE_CAPABILITIES.get(user.role, frozenset())
