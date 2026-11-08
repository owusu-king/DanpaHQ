"""DRF authentication backend for our access tokens."""

from __future__ import annotations

from uuid import UUID

from django.conf import settings
from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from apps.core.crypto import TokenError, TokenExpired, verify_payload

from .models import Device, Session, User

#: The only endpoints a half-finished account may reach: read its own state,
#: finish itself, refresh, or leave. Enforced here rather than view by view
#: because the failure mode of missing one view is an account with no name and
#: no credential acting as if it were a person, and an allowlist that forgets an
#: entry merely inconveniences someone mid-registration.
REGISTRATION_EXEMPT_PATHS = frozenset(
    {
        "/api/v1/me/",
        "/api/v1/me/registration/",
        "/api/v1/auth/refresh/",
        "/api/v1/auth/sign-out/",
    }
)


class AccessTokenAuthentication(BaseAuthentication):
    """Validate the signed token and its live session on every request."""

    keyword = "Bearer"

    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        if not header.startswith(f"{self.keyword} "):
            return None

        token = header[len(self.keyword) + 1 :].strip()
        key = getattr(settings, "ACCESS_TOKEN_KEY", None) or settings.SECRET_KEY

        try:
            payload = verify_payload(token, key=key)
        except TokenExpired as exc:
            raise AuthenticationFailed("Your session expired. Refreshing.") from exc
        except TokenError as exc:
            raise AuthenticationFailed("That sign-in is not valid.") from exc

        try:
            subject = UUID(payload["sub"])
            session_id = UUID(payload["sid"])
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise AuthenticationFailed("That sign-in is not valid.") from exc
        roles = payload.get("roles", [])
        if not isinstance(roles, list) or any(not isinstance(role, str) for role in roles):
            raise AuthenticationFailed("That sign-in is not valid.")

        user = User.objects.filter(
            id=subject,
            is_active=True,
            sessions__id=session_id,
            sessions__revoked_at__isnull=True,
            sessions__expires_at__gt=timezone.now(),
        ).first()
        if user is None:
            raise AuthenticationFailed("Your session has ended. Sign in again.")

        from apps.operations.mfa import session_valid

        if (payload.get("mfa_policy", "default") != user.mfa_policy
                or not session_valid(user, payload.get("mfa_device"))):
            raise AuthenticationFailed("Sign in again with your authenticator.")

        # Account state, checked in the same place as is_active and for the same
        # reason: both answer whether this row is currently a usable identity,
        # and neither is a question any individual view should have to remember.
        if (
            not user.is_staff
            and not user.is_registration_complete
            and request.path not in REGISTRATION_EXEMPT_PATHS
        ):
            raise AuthenticationFailed("Finish setting up your account first.")

        request.session_id = session_id
        request.token_roles = set(roles)
        return (user, token)

    def authenticate_header(self, request):
        return self.keyword


def require_live_session(request) -> Session:
    """Load and check the session behind this request.

    Used by endpoints where 15 minutes of stale authorisation is not acceptable:
    role changes, payout details, sign-out-everywhere, and anything in Phase 5
    that touches money.
    """
    session_id = getattr(request, "session_id", None)
    if not isinstance(session_id, str | UUID):
        raise AuthenticationFailed("Your session has ended. Sign in again.")
    session = (
        Session.objects.filter(id=session_id, user=request.user)
        .select_related("user", "device")
        .first()
    )

    if session is None or not session.is_active:
        raise AuthenticationFailed("Your session has ended. Sign in again.")

    now = timezone.now()
    Session.objects.filter(id=session.id).update(last_used_at=now)
    if session.device_id:
        Device.objects.filter(id=session.device_id).update(last_seen_at=now)
    return session


class AccessTokenScheme(OpenApiAuthenticationExtension):
    """Describe our bearer token to the OpenAPI generator.

    Without this, `drf_spectacular` cannot resolve `AccessTokenAuthentication`
    and says so once per view — 136 identical warnings that drowned the
    deployment check, and a published schema that documented no authentication
    at all. A client generated from that schema would have sent every request
    unauthenticated.

    The token is a signed payload rather than an opaque handle, but `bearerFormat`
    is descriptive only: nothing consumes it, and naming the real format would
    tell a reader more about our signing than they need.
    """

    target_class = AccessTokenAuthentication
    name = "accessToken"

    def get_security_definition(self, auto_schema):
        return {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "opaque",
            "description": (
                "Short-lived access token from `/auth/sign-in/` or `/auth/refresh/`. "
                "Sent as `Authorization: Bearer <token>`."
            ),
        }
