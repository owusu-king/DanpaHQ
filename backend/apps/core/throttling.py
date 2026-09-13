"""Rate limits that say what losing their cache means.

DRF reads and writes throttle history straight through Django's cache, so an
unreachable Redis raises out of `allow_request` and **every throttled endpoint
answers 500**. That is how one corrupt append-only file took out Plan & billing
and the payout screens together: not because either had a bug, but because the
limiter in front of them could not reach Redis and nobody had said what that
should mean.

There is no single right answer, so each limit states its own:

* A limit protecting a **credential** — an OTP, a Unit access code, a viewing
  check-in code — **fails closed**. Opening a brute-force window because a
  cache is down is worse than being briefly unavailable. The caller is told it
  is us and that it is temporary (503, retryable) rather than being told they
  did something wrong.
* A limit controlling **cost or throughput** — payment calls, provider webhooks
  — **fails open**. Nothing is protected by refusing, and refusing means a
  settlement callback is dropped or a provider cannot set up the account their
  rent arrives in.

Either way it is logged, because a limiter that has quietly stopped limiting is
a thing to know about.
"""

from __future__ import annotations

import logging

from django.core.cache import cache
from rest_framework.throttling import SimpleRateThrottle

from apps.core.exceptions import DomainError, ProviderUnavailable

logger = logging.getLogger("core.throttling")

#: One line per scope per process. A cache outage is thousands of failures a
#: minute and the log is no more useful for having all of them.
_reported: set[str] = set()


def _report(scope: str, cause: Exception, *, fail_open: bool) -> None:
    if scope in _reported:
        return
    _reported.add(scope)
    logger.warning(
        "rate limit cannot reach its cache",
        extra={"scope": scope, "fail_open": fail_open, "error": str(cause)},
    )


def _unavailable(scope: str, cause: Exception) -> ProviderUnavailable:
    return ProviderUnavailable(
        "We cannot check this right now. Try again shortly.",
        details={"reason": "rate_limit_unavailable", "scope": scope},
    )


def count_attempt(key: str, *, window: int, scope: str = "attempt") -> int:
    """Count one attempt against something worth guessing at, and say how many.

    For the limits DRF's throttles cannot express — the Management sign-in cap
    is twenty attempts in fifteen minutes, and `SimpleRateThrottle` only knows
    per second, minute, hour and day.

    Two things it does that a hand-rolled counter did not:

    * **It counts.** `cache.get` then `cache.set` is a read-modify-write, so
      twenty simultaneous attempts all read the same number before any of them
      writes it back and the cap never closes. `add` then `incr` is atomic in
      Redis, which is what makes this a limit rather than a suggestion.
    * **It refuses when it cannot count.** An unreachable cache raises rather
      than reporting zero attempts: a counter that answers "nobody has tried
      yet" while Redis is down is worse than no counter at all, because the
      surface it guards is a password form.

    The window slides while attempts keep arriving, which is deliberate — an
    attacker hammering the form never waits out a window that keeps moving.
    """
    try:
        cache.add(key, 0, window)
        attempts = cache.incr(key)
        cache.touch(key, window)
        return int(attempts)
    except ValueError:
        # The key expired between `add` and `incr`. This attempt opens a new
        # window, and is the first in it.
        return 1
    except Exception as cause:
        _report(scope, cause, fail_open=False)
        raise _unavailable(scope, cause) from cause


class CacheAwareRateThrottle(SimpleRateThrottle):
    """A `SimpleRateThrottle` that survives its cache being gone.

    Subclasses set `fail_open` deliberately; the default is the safe one.
    """

    #: True where the limit is a cost or throughput control, False where it
    #: stands in front of something worth brute-forcing.
    fail_open = False

    def allow_request(self, request, view) -> bool:
        try:
            return super().allow_request(request, view)
        except DomainError:
            # Ours, and already the answer we mean to give.
            raise
        except Exception as cause:
            _report(self.scope, cause, fail_open=self.fail_open)
            if self.fail_open:
                return True
            raise _unavailable(self.scope, cause) from cause
