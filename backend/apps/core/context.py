"""Request-scoped context propagated to logs, audit records and outbox events.

Held in ``contextvars`` so it survives async views and is not shared between
concurrent requests, unlike thread-locals under ASGI.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace


@dataclass(frozen=True, slots=True)
class RequestContext:
    request_id: str = ""
    actor_id: str | None = None
    #: The actor's role at the time of the request, or `""` for none.
    #:
    #: Empty string, never None, and the distinction matters downstream:
    #: `audit.AuditLog.actor_role` is a `CharField(blank=True)`, so its column is
    #: NOT NULL with `""` as the empty value — standard Django, and right, since
    #: a text column with two ways to be empty is a column that will be compared
    #: wrongly.
    #:
    #: `User.primary_role` returns None for somebody holding no role, which is
    #: deliberate — no grant means no role, and pretending it means "tenant"
    #: makes an interrupted onboarding indistinguishable from a completed one.
    #: That nullable domain value has to become a string somewhere, and here is
    #: that boundary. It was not, so a user with no role signing in produced a
    #: context carrying None, which reached the audit insert and raised a NOT
    #: NULL violation — surfacing to them as a 409 on login.
    actor_role: str = ""
    ip_address: str | None = None
    user_agent: str = ""
    source: str = "system"  # web | mobile | admin | worker | webhook | system
    #: The host this client reached the API on, e.g. "192.168.1.42:8000".
    #:
    #: Storage needs it. A presigned URL carries the host it was signed for, and
    #: "localhost" means the API machine to a browser and the handset itself to
    #: a phone — so one baked-in address cannot serve a laptop, an emulator and
    #: a real device at once. Whatever host reached us is, by construction, one
    #: this client can resolve. Empty outside a request: a worker or a shell has
    #: no client to follow, and falls back to the configured endpoint.
    client_host: str = ""

    def __post_init__(self) -> None:
        # Normalised on construction rather than trusted from callers: this is
        # the only place every context passes through, and a `str` field that
        # sometimes holds None is a bug waiting for its next call site.
        if self.actor_role is None:
            object.__setattr__(self, "actor_role", "")


# B039 warns that a mutable ContextVar default is shared across every
# context. True in general, and not here: `RequestContext` is frozen with
# slots, so the shared instance cannot be mutated by anyone who gets it.
_context: ContextVar[RequestContext] = ContextVar(
    "request_context",
    default=RequestContext(),  # noqa: B039 — frozen, so the shared default cannot be mutated
)


def get_context() -> RequestContext:
    return _context.get()


def set_context(ctx: RequestContext) -> None:
    _context.set(ctx)


@contextmanager
def use_context(**overrides):
    token = _context.set(replace(_context.get(), **overrides))
    try:
        yield _context.get()
    finally:
        _context.reset(token)
