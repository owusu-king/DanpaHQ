"""A read-only memo for work a listing repeats.

Serializing a list asks the same questions over and over. Every property policy
starts by asking whether this person manages this property; four of the six then
ask what state its verification is in; two count the same open tenancies,
leases and listings. None of that changes between one field and the next, but
each field asked the database again — 39 queries per row for
``permitted_actions`` alone.

**Off unless a caller asks for it.** Outside :func:`memoized` this module does
nothing at all: ``cached`` calls ``produce`` and returns it, so every existing
path behaves exactly as it did. A block is opened only around work that reads
and does not write, which is what makes the cache safe — nothing inside it can
invalidate what it holds.

That restriction is the whole design. A request-wide or instance-level cache
would also collapse these queries, and would hand back a stale answer the moment
a service changed a property and re-read it in the same breath. The window here
is one serialization, and the caller declares it.

Keys are chosen by the caller and must include everything the answer depends on
— the subject id *and* the actor, where both matter.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

#: `None` means "not inside a block", which is the default everywhere.
_store: ContextVar[dict[Any, Any] | None] = ContextVar("core_memo", default=None)


@contextmanager
def memoized():
    """Collapse repeated reads for the duration of this block.

    Nests safely: an inner block reuses the outer store rather than starting a
    second one, so wrapping a helper that already memoizes costs nothing.

    A `contextvar` rather than a thread local, so it holds under ASGI and does
    not leak between concurrent requests sharing a thread — the same reason
    `RequestContext` is one.
    """
    existing = _store.get()
    if existing is not None:
        yield existing
        return

    token = _store.set({})
    try:
        yield _store.get()
    finally:
        _store.reset(token)


def cached(key, produce: Callable[[], Any]):
    """``produce()``, once per key, for as long as a block is open.

    Outside a block this is a plain call — no storage, no lookup, no behaviour
    change. That is deliberate: a helper can adopt this without its other
    callers having to care.
    """
    store = _store.get()
    if store is None:
        return produce()
    if key not in store:
        store[key] = produce()
    return store[key]


def prime(key, value: Any) -> None:
    """Seed an answer that a batch read has already loaded.

    Batch readers use this after fetching many subjects in one query.  It is a
    no-op outside :func:`memoized`, preserving the same deliberately narrow
    cache lifetime as :func:`cached`.
    """
    store = _store.get()
    if store is not None:
        store[key] = value


def is_memoizing() -> bool:
    """Whether a block is currently open. For tests, not for branching logic."""
    return _store.get() is not None
