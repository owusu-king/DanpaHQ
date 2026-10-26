"""Domain error hierarchy and the single API error shape.

One error contract for every endpoint, so the web and mobile clients have one
piece of error-handling code instead of one per screen::

    {
      "error": {
        "code": "listing_not_available",
        "message": "This listing was taken down.",
        "details": {...},
        "request_id": "..."
      }
    }

``message`` is user-facing and must read like the interface talks: say what
happened and what to do next. ``code`` is stable and machine-readable; clients
branch on it, never on the message.
"""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    code = "domain_error"
    status_code = 400
    message = "That did not work."

    def __init__(self, message: str | None = None, *, details: dict[str, Any] | None = None):
        self.message = message or self.message
        self.details = details or {}
        super().__init__(self.message)

    def to_payload(self, request_id: str = "") -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
                "request_id": request_id,
            }
        }


class ValidationFailed(DomainError):
    code = "validation_failed"
    status_code = 422
    message = "Some of the details need fixing."


class NotFound(DomainError):
    code = "not_found"
    status_code = 404
    message = "We could not find that."


class Gone(DomainError):
    """A deliberately retired resource or workflow.

    Unlike ``NotFound``, this tells an installed older client that retrying the
    same route cannot work and that it must move to the replacement flow.
    """

    code = "gone"
    status_code = 410
    message = "That workflow is no longer available."


class PermissionDenied(DomainError):
    code = "permission_denied"
    status_code = 403
    message = "You do not have access to this."


class Conflict(DomainError):
    """The request is refused by the current state of things.

    Almost every raise passes its own message, and it should: a lease that is
    already live, an invitation already spent and a bed label already used are
    three different facts, and only the caller knows which one applies.

    The default used to be "Someone else changed this while you were working" —
    a *concurrency* message on the generic state-conflict class. Anything that
    reached a 409 without its own wording told the person their work had been
    overwritten by somebody else, which was almost never what had happened and
    sent them off reloading a page that was never stale. Concurrency now has its
    own class below, and this default says only what it can honestly claim.
    """

    code = "conflict"
    status_code = 409
    message = "That cannot be done right now."


class StaleWrite(Conflict):
    """Someone genuinely did change the thing underneath this request.

    Separate from `Conflict` so the concurrency wording is reachable only when
    concurrency is what happened. Reloading is useless advice otherwise.
    """

    code = "stale_write"
    message = "Someone else changed this while you were working. Reload and try again."


class RateLimited(DomainError):
    code = "rate_limited"
    status_code = 429
    message = "Too many attempts. Wait a moment and try again."


class ProviderUnavailable(DomainError):
    """An external dependency (mobile money, SMS, storage) failed.

    Distinct from a bug in our code: these are retryable and must never be
    presented to a user as their mistake.
    """

    code = "provider_unavailable"
    status_code = 503
    message = "That service is not responding right now. Try again shortly."
