"""Liveness and readiness.

Kept separate on purpose. ``/healthz`` answers "is this process alive" and must
never touch a dependency - if it did, a slow database would cause the
orchestrator to kill healthy pods and turn a degradation into an outage.
``/readyz`` answers "should traffic be sent here" and does check dependencies.
"""

from __future__ import annotations

import time

from django.conf import settings
from django.db import connections
from django.http import JsonResponse


def _check(fn) -> dict:
    started = time.monotonic()
    try:
        fn()
        status, detail = "ok", None
    # Broad on purpose: a readiness probe reports whatever went wrong rather
    # than crashing on an error nobody predicted. It is surfaced in the payload.
    except Exception as exc:
        status, detail = "error", str(exc)[:200]
    return {
        "status": status,
        "latency_ms": round((time.monotonic() - started) * 1000, 2),
        "detail": detail,
    }


def _check_database() -> None:
    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()


def _check_cache() -> None:
    from django.core.cache import cache

    cache.set("healthcheck", "1", 5)
    if cache.get("healthcheck") != "1":
        raise RuntimeError("cache round-trip failed")


def healthz(request):
    return JsonResponse({"status": "ok", "version": settings.APP_VERSION})


def readyz(request):
    checks = {"database": _check(_check_database), "cache": _check(_check_cache)}
    healthy = all(c["status"] == "ok" for c in checks.values())
    return JsonResponse(
        {
            "status": "ok" if healthy else "degraded",
            "version": settings.APP_VERSION,
            "environment": settings.ENVIRONMENT,
            "checks": checks,
        },
        status=200 if healthy else 503,
    )
