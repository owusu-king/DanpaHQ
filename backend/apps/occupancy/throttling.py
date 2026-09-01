"""Brute-force bounds for private Unit access codes."""

from rest_framework.throttling import SimpleRateThrottle


class AccessCodeUserThrottle(SimpleRateThrottle):
    scope = "access_code_user"

    def get_cache_key(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": str(user.id)}


class AccessCodeIpThrottle(SimpleRateThrottle):
    scope = "access_code_ip"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
