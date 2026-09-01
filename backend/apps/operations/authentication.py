"""Authentication that accepts only dedicated Management session cookies."""

from __future__ import annotations

import hmac

from django.conf import settings
from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied

from apps.core.context import get_context, set_context
from apps.core.crypto import hash_secret, hash_token

from .models import ManagementSession

SESSION_COOKIE = "grp_management_session"
CSRF_COOKIE = "grp_management_csrf"
CSRF_HEADER = "X-Management-CSRF"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def csrf_token_for(session_token: str) -> str:
    pepper = getattr(settings, "MANAGEMENT_CSRF_KEY", "") or settings.SECRET_KEY
    return hash_secret(session_token, pepper=pepper, salt="management-csrf")


class ManagementSessionAuthentication(BaseAuthentication):
    def authenticate(self, request):
        raw_token = request.COOKIES.get(SESSION_COOKIE, "")
        if not raw_token:
            return None

        session = (
            ManagementSession.objects.select_related("user")
            .filter(token_hash=hash_token(raw_token))
            .first()
        )
        if session is None or not session.is_active:
            raise AuthenticationFailed("Your Management session has ended. Sign in again.")

        if request.method in UNSAFE_METHODS:
            header_token = request.headers.get(CSRF_HEADER, "")
            if not header_token or not hmac.compare_digest(
                hash_token(header_token), session.csrf_hash
            ):
                raise PermissionDenied("Management security check failed. Refresh and try again.")

        now = timezone.now()
        if (now - session.last_used_at).total_seconds() > 300:
            ManagementSession.objects.filter(id=session.id).update(last_used_at=now)
        request.management_session = session

        ctx = get_context()
        set_context(
            type(ctx)(
                request_id=ctx.request_id,
                actor_id=str(session.user_id),
                actor_role=session.user.role,
                ip_address=ctx.ip_address,
                user_agent=ctx.user_agent,
                source="management",
            )
        )
        return session.user, raw_token

    def authenticate_header(self, request):
        return "ManagementSession"


def set_management_cookies(response, *, session_token: str, csrf_token: str) -> None:
    secure = not settings.DEBUG
    max_age = int(getattr(settings, "MANAGEMENT_SESSION_TTL_SECONDS", 12 * 60 * 60))
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite="Strict",
        path="/api/v1/management/",
    )


def clear_management_cookies(response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/api/v1/management/", samesite="Strict")
    # Remove the earlier double-submit cookie if a browser still has one. New
    # clients receive the CSRF proof in the authenticated JSON response so the
    # portal also works when the API and web app use different subdomains.
    response.delete_cookie(CSRF_COOKIE, path="/", samesite="Strict")


class ManagementSessionScheme(OpenApiAuthenticationExtension):
    """Describe the reviewer console's cookie session to the OpenAPI generator.

    Management authenticates by httpOnly cookie rather than a bearer token, and
    on its own surface — see ADR 0012. Saying so in the schema keeps the two
    audiences distinguishable: a generated client for the public API should not
    offer these endpoints a token, and vice versa.
    """

    target_class = ManagementSessionAuthentication
    name = "managementSession"

    def get_security_definition(self, auto_schema):
        return {
            "type": "apiKey",
            "in": "cookie",
            "name": SESSION_COOKIE,
            "description": (
                "httpOnly session cookie issued by `/management/auth/login/`. "
                "Paired with the `X-Management-CSRF` header on unsafe methods."
            ),
        }
