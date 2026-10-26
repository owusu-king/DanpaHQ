from __future__ import annotations

import logging
import time
import uuid

from .context import RequestContext, get_context, set_context

logger = logging.getLogger("api.request")

REQUEST_ID_HEADER = "X-Request-ID"


def _client_host(request) -> str:
    """The host this client used, or "" if Django will not vouch for it."""
    from django.core.exceptions import DisallowedHost

    try:
        return request.get_host()
    except DisallowedHost:
        return ""


def _client_ip(request) -> str | None:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


class RequestContextMiddleware:
    """Assigns a request id and populates the request-scoped context.

    Clients may supply their own ``X-Request-ID``. Mobile does, so a tenant on a
    flaky 3G connection who retries a payment can be traced across both attempts.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming if _is_safe_id(incoming) else str(uuid.uuid4())

        set_context(
            RequestContext(
                request_id=request_id,
                ip_address=_client_ip(request),
                user_agent=request.headers.get("User-Agent", "")[:300],
                source=request.headers.get("X-Client", "web").lower()[:20],
                # `get_host()` is already validated against ALLOWED_HOSTS, so
                # this is not a raw Host header.
                client_host=_client_host(request),
            )
        )
        request.request_id = request_id

        started = time.monotonic()
        response = self.get_response(request)
        duration_ms = round((time.monotonic() - started) * 1000, 2)

        response[REQUEST_ID_HEADER] = request_id
        response["Server-Timing"] = f"app;dur={duration_ms}"
        logger.info(
            "request host=%s path=%s",
            get_context().client_host or "-",
            request.path,
            extra={
                "event": "http_request",
                "method": request.method,
                "path": request.path,
                # Which address this client reached us on. Storage signs
                # presigned URLs for it, so when a photograph will not load the
                # first question is what host the request actually arrived with.
                "host": get_context().client_host,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response


class ActorContextMiddleware:
    """Adds the authenticated user to the context, after authentication has run."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        if user is not None and getattr(user, "is_authenticated", False):
            ctx = get_context()
            set_context(
                RequestContext(
                    request_id=ctx.request_id,
                    actor_id=str(user.pk),
                    # `or ""` rather than a getattr default: the attribute
                    # exists and legitimately holds None for somebody with
                    # no role, so the default never fires. `RequestContext`
                    # normalises too; stated here as well because this is
                    # where the nullable value is actually read.
                    actor_role=getattr(user, "primary_role", None) or "",
                    ip_address=ctx.ip_address,
                    user_agent=ctx.user_agent,
                    source=ctx.source,
                )
            )
        return self.get_response(request)


def _is_safe_id(value: str) -> bool:
    return bool(value) and len(value) <= 64 and all(c.isalnum() or c in "-_" for c in value)
