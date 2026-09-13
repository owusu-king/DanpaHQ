"""What a rate limit does when it cannot reach its cache, and how it counts.

Both properties came from one outage: Redis died with a corrupt append-only
file, and every throttled endpoint answered 500 from inside DRF's
`allow_request`. Fixing that meant deciding, per limit, what losing the cache
means — and while rewriting the Management sign-in cap, that it should count
atomically rather than read a number and write it back.
"""

import pytest
from django.core.cache import cache

from apps.core.exceptions import ProviderUnavailable
from apps.core.throttling import CacheAwareRateThrottle, count_attempt

pytestmark = pytest.mark.django_db


def unreachable(*args, **kwargs):
    raise OSError("[Errno -2] Name or service not known")


class TestCountingAttempts:
    def test_it_never_reads_the_number_it_is_about_to_change(self, monkeypatch):
        """The atomicity, stated as the thing that makes it true.

        `cache.get` then `cache.set` leaves a window: twenty simultaneous
        attempts all read the same number, all write one more than it, and the
        cap never closes. `add` then `incr` has no such window — and the proof
        is that a counter which never calls `get` cannot have one.
        """
        monkeypatch.setattr(cache, "get", unreachable)
        cache.delete("test:counter")

        assert count_attempt("test:counter", window=60) == 1
        assert count_attempt("test:counter", window=60) == 2
        assert count_attempt("test:counter", window=60) == 3

    def test_a_counter_that_cannot_count_refuses(self, monkeypatch):
        """Answering "nobody has tried yet" would be the worst of both."""
        for method in ("add", "incr", "touch"):
            monkeypatch.setattr(cache, method, unreachable)

        with pytest.raises(ProviderUnavailable) as raised:
            count_attempt("test:counter", window=60, scope="management_login")

        assert raised.value.status_code == 503
        assert raised.value.details["reason"] == "rate_limit_unavailable"

    def test_each_window_starts_from_one(self, monkeypatch):
        """A key that expires between `add` and `incr` opens a new window."""
        monkeypatch.setattr(cache, "incr", lambda *a, **k: (_ for _ in ()).throw(ValueError()))

        assert count_attempt("test:counter", window=60) == 1


class TestWhatLosingTheCacheMeans:
    def _throttle(self, *, fail_open: bool):
        class Throttle(CacheAwareRateThrottle):
            scope = "payment" if fail_open else "otp"

        Throttle.fail_open = fail_open
        return Throttle()

    def test_a_cost_control_keeps_answering(self, monkeypatch):
        monkeypatch.setattr(cache, "get", unreachable)
        monkeypatch.setattr(cache, "set", unreachable)

        assert self._throttle(fail_open=True).allow_request(None, None) is True

    def test_a_credential_guard_refuses_rather_than_opening(self, monkeypatch):
        monkeypatch.setattr(cache, "get", unreachable)
        monkeypatch.setattr(cache, "set", unreachable)

        with pytest.raises(ProviderUnavailable):
            self._throttle(fail_open=False).allow_request(None, None)

    def test_every_throttle_in_the_product_has_made_the_choice(self):
        """A limit on `SimpleRateThrottle` is one that still answers 500."""
        from apps.identity.throttling import OtpVerifyThrottle, PhoneNumberThrottle
        from apps.occupancy.throttling import AccessCodeIpThrottle, AccessCodeUserThrottle
        from apps.payments.throttling import PaymentUserThrottle, PaymentWebhookIpThrottle
        from apps.viewing.throttling import ViewingCheckInIpThrottle, ViewingCheckInUserThrottle

        credential_guards = [
            PhoneNumberThrottle,
            OtpVerifyThrottle,
            AccessCodeUserThrottle,
            AccessCodeIpThrottle,
            ViewingCheckInUserThrottle,
            ViewingCheckInIpThrottle,
        ]
        cost_controls = [PaymentUserThrottle, PaymentWebhookIpThrottle]

        for throttle in [*credential_guards, *cost_controls]:
            assert issubclass(throttle, CacheAwareRateThrottle), throttle.__name__
        for throttle in credential_guards:
            assert throttle.fail_open is False, f"{throttle.__name__} would open under an outage"
        for throttle in cost_controls:
            assert throttle.fail_open is True, f"{throttle.__name__} would refuse under an outage"
