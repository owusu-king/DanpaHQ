"""Brute-force bounds for temporary viewing check-in credentials.

A check-in code is a credential, so these fail closed when the cache is
unreachable; see `apps.core.throttling`.
"""

from apps.core.throttling import CacheAwareRateThrottle


class ViewingCheckInUserThrottle(CacheAwareRateThrottle):
    scope = "viewing_checkin_user"
    fail_open = False

    def get_cache_key(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": str(user.id)}


class ViewingCheckInIpThrottle(CacheAwareRateThrottle):
    scope = "viewing_checkin_ip"
    fail_open = False

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
