"""DRF authentication backend for our access tokens."""

from __future__ import annotations

from django.conf import settings
from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from apps.core.crypto import TokenError, TokenExpired, verify_payload

from .models import Session, User

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
    """Validates a bearer token without a database read on the happy path.

    The session is *not* loaded per request. That is the point of a short-lived
    signed token: 15 minutes of staleness in exchange for no round trip on every
    call, which matters on connections where the database is the cheap part and
    the network is not.

    The exception is revocation-sensitive requests. Anything that moves money or
    changes access re-checks the session explicitly through
    ``require_live_session`` below.
    """

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

        user = User.objects.filter(id=payload.get("sub"), is_active=True).first()
        if user is None:
            raise AuthenticationFailed("That account is no longer active.")

        # Account state, checked in the same place as is_active and for the same
        # reason: both answer whether this row is currently a usable identity,
        # and neither is a question any individual view should have to remember.
        if (
            not user.is_staff
            and not user.is_registration_complete
            and request.path not in REGISTRATION_EXEMPT_PATHS
        ):
            raise AuthenticationFailed("Finish setting up your account first.")

        request.session_id = payload.get("sid")
        request.token_roles = set(payload.get("roles", []))
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
    session = Session.objects.filter(id=session_id).select_related("user", "device").first()

    if session is None or not session.is_active:
        raise AuthenticationFailed("Your session has ended. Sign in again.")

    Session.objects.filter(id=session.id).update(last_used_at=timezone.now())
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
