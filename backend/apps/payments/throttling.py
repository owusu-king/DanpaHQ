"""Cost and throughput bounds on the money surface.

Both fail open when the cache is unreachable: nothing is protected by refusing
a payout-account lookup or dropping a provider's settlement callback, and the
webhook's real gate is its signature. See `apps.core.throttling`.
"""

from apps.core.throttling import CacheAwareRateThrottle


class PaymentUserThrottle(CacheAwareRateThrottle):
    scope = "payment"
    fail_open = True

    def get_cache_key(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": str(user.id)}


class PaymentWebhookIpThrottle(CacheAwareRateThrottle):
    scope = "payment_webhook"
    fail_open = True

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
