"""Bounds on opening share links.

A link token carries 256 bits, so guessing is not the threat; this keeps a
leaked link from being hammered and caps the audit volume one address can
generate. It guards a credential, so it fails closed; see `apps.core.throttling`.
"""

from apps.core.throttling import CacheAwareRateThrottle


class PassportViewIpThrottle(CacheAwareRateThrottle):
    scope = "passport_view_ip"
    fail_open = False

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
