"""Rate limits for the authentication surface.

Scoped by phone number and by IP, because either one alone is bypassable: an
attacker rotating IPs still hits the per-number limit, and one hitting many
numbers from one host still hits the per-IP limit.
"""

from __future__ import annotations

from rest_framework.throttling import SimpleRateThrottle

from apps.core.phone import normalise_ghana_msisdn


class PhoneNumberThrottle(SimpleRateThrottle):
    """Per-number limit on requesting codes."""

    scope = "otp"

    def get_cache_key(self, request, view):
        raw = (request.data or {}).get("phone")
        if not raw:
            return None
        try:
            phone = normalise_ghana_msisdn(str(raw))
        except Exception:
            return None
        return self.cache_format % {"scope": self.scope, "ident": phone}


class OtpVerifyThrottle(SimpleRateThrottle):
    """Per-IP limit on verification attempts, above the per-challenge cap."""

    scope = "otp_verify"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
