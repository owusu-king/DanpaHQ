"""Brute-force bounds for temporary viewing check-in credentials."""

from rest_framework.throttling import SimpleRateThrottle


class ViewingCheckInUserThrottle(SimpleRateThrottle):
    scope = "viewing_checkin_user"

    def get_cache_key(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": str(user.id)}


class ViewingCheckInIpThrottle(SimpleRateThrottle):
    scope = "viewing_checkin_ip"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
