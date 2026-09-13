"""Rate limits for the authentication surface.

Scoped by phone number and by IP, because either one alone is bypassable: an
attacker rotating IPs still hits the per-number limit, and one hitting many
numbers from one host still hits the per-IP limit.

Both fail closed when the cache is unreachable. A few minutes of "try again
shortly" on the sign-in surface is better than a few minutes of unlimited code
guessing; see `apps.core.throttling`.
"""

from __future__ import annotations

from apps.core.phone import normalise_ghana_msisdn
from apps.core.throttling import CacheAwareRateThrottle


class PhoneNumberThrottle(CacheAwareRateThrottle):
    """Per-number limit on requesting codes."""

    scope = "otp"
    fail_open = False

    def get_cache_key(self, request, view):
        raw = (request.data or {}).get("phone")
        if not raw:
            return None
        try:
            phone = normalise_ghana_msisdn(str(raw))
        except Exception:
            return None
        return self.cache_format % {"scope": self.scope, "ident": phone}


class OtpVerifyThrottle(CacheAwareRateThrottle):
    """Per-IP limit on verification attempts, above the per-challenge cap."""

    scope = "otp_verify"
    fail_open = False

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
