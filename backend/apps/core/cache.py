"""Reading a cache that is not there.

A cache is an optimisation. Losing it should cost a query, not a page — and on
this codebase it cost a page: `billing.entitlement_service` caches a plan's
packaging, Redis died with a corrupt append-only file after an unclean
shutdown, and every read of a Portfolio's plan raised `socket.gaierror` out of
`cache.get`. Plan & billing answered 500 while every screen that happened not
to touch the cache carried on as though nothing was wrong.

So: use these where the cached value is only a saved query — the caller must be
able to compute it again. Anywhere the cache is the *record* of something (a
rate limiter's count, the health check that exists to say whether the cache is
reachable), a failure is real and must not be swallowed here.
"""

from __future__ import annotations

import logging
from typing import Any

from django.core.cache import cache

logger = logging.getLogger("core.cache")

#: One line per process per key prefix, because a Redis outage is thousands of
#: failures a minute and the log is no more useful for having all of them.
_reported: set[str] = set()


def _report(action: str, key: str, cause: Exception) -> None:
    prefix = key.split(":", 1)[0]
    if prefix in _reported:
        return
    _reported.add(prefix)
    logger.warning(
        "cache unavailable, falling back to the source",
        extra={"action": action, "key_prefix": prefix, "error": str(cause)},
    )


def cache_get(key: str, default: Any = None) -> Any:
    """The cached value, or `default` — including when the cache is unreachable."""
    try:
        return cache.get(key, default)
    # Broad on purpose: every backend failure is a miss, and the caller has a
    # source of truth to fall back on.
    except Exception as cause:
        _report("get", key, cause)
        return default


def cache_set(key: str, value: Any, timeout: int | None = None) -> None:
    """Store a value if the cache will take it, and shrug if it will not."""
    try:
        cache.set(key, value, timeout)
    except Exception as cause:
        _report("set", key, cause)
