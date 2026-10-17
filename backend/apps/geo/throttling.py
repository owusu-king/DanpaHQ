"""Limits on place lookups, which Danpa HQ pays a provider for."""

from __future__ import annotations

from apps.core.throttling import CacheAwareRateThrottle


class PlaceLookupThrottle(CacheAwareRateThrottle):
    """Per person, or per address when signed out, across suggestions and resolves.

    A cost control rather than a guard, so it fails open: when the cache is
    unavailable a lookup is allowed instead of the location field going dark.
    Generous, because a phone network puts many tenants behind one address.
    """

    scope = "places"
    fail_open = True

    def get_cache_key(self, request, view):
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            ident = f"user:{user.pk}"
        else:
            ident = self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}
