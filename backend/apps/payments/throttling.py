from rest_framework.throttling import SimpleRateThrottle


class PaymentUserThrottle(SimpleRateThrottle):
    scope = "payment"

    def get_cache_key(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": str(user.id)}


class PaymentWebhookIpThrottle(SimpleRateThrottle):
    scope = "payment_webhook"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
