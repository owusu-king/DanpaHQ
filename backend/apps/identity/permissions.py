"""Permissions.

Two layers, and both are needed:

* **Role permissions** answer "may this kind of user reach this endpoint".
* **Object permissions** answer "may *this* user touch *this* record". Role
  checks alone would let any landlord edit any other landlord's property, which
  is the classic broken-access-control failure and the one that actually gets
  exploited.

Everything defaults to denied. A view that forgets a permission class inherits
``IsAuthenticated`` from settings and fails closed.
"""

from __future__ import annotations

from rest_framework.permissions import SAFE_METHODS, BasePermission


class HasRole(BasePermission):
    """Require one of the listed roles. Set ``required_roles`` on the view."""

    message = "Your account does not have access to this."

    def has_permission(self, request, view):
        required = set(getattr(view, "required_roles", []))
        if not required:
            return bool(request.user and request.user.is_authenticated)
        if not (request.user and request.user.is_authenticated):
            return False
        if request.user.is_staff:
            return True
        # Prefer the token's roles: it is the snapshot this request was
        # authorised with, and reading it avoids a query per request.
        roles = getattr(request, "token_roles", None) or request.user.roles
        return bool(required & set(roles))


class IsPhoneVerified(BasePermission):
    """Gate actions that require a proven number.

    Browsing does not need this. Anything that creates an obligation - applying
    for a property, listing one, messaging a landlord - does.
    """

    message = "Confirm your phone number first."

    def has_permission(self, request, view):
        return bool(
            request.user and request.user.is_authenticated and request.user.is_phone_verified
        )


class IsRegistrationComplete(BasePermission):
    """Require a finished account.

    A proved number alone creates an account row so registration has somewhere
    to write, but that row is not yet an identity anyone should be able to act
    as. Without this, an abandoned sign-up would be a usable account with no
    name and no credential to sign back in with.
    """

    message = "Finish setting up your account first."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return bool(user.is_staff or user.is_registration_complete)


class HasProviderWorkspaceAccess(BasePermission):
    """Approved provider standing, read from the verification and not a role.

    A role name is a navigation hint that a client could once grant itself. This
    reads the account-level decision every time, so revoking it takes effect on
    the next request rather than when a token expires.
    """

    message = "Your provider verification has not been approved yet."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_staff:
            return True
        from .services import account_capabilities

        return account_capabilities(user)["provider"]["workspace_access"]


class IsSelf(BasePermission):
    """The object is the user, or belongs to them."""

    message = "You can only change your own details."

    def has_object_permission(self, request, view, obj):
        if request.user.is_staff:
            return True
        owner_id = getattr(obj, "user_id", None) or getattr(obj, "id", None)
        return str(owner_id) == str(request.user.id)


class IsStaffOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(request.user and request.user.is_authenticated)
        return bool(request.user and request.user.is_staff)


class CanReviewVerifications(BasePermission):
    """Staff principals on the separate operations surface only.

    A consumer role name is never enough to enter administration. This keeps a
    compromised phone-OTP consumer session outside the review boundary.
    """

    message = "Only the review team can decide verifications."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return bool(user.is_staff)

    def has_object_permission(self, request, view, obj):
        # A reviewer may not decide a check about themselves. Cheap to enforce,
        # and it removes an entire category of insider risk.
        deciding_about_themselves = obj.subject_type == "user" and str(obj.subject_id) == str(
            request.user.id
        )
        return not deciding_about_themselves
