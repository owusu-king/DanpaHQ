from __future__ import annotations

from typing import Any

from django.db import connection, transaction

from apps.core.context import get_context

from .models import AuditLog

SENSITIVE_KEYS = {"password", "otp", "token", "secret", "pin", "id_number", "account_number"}


def _scrub(changes: dict[str, Any]) -> dict[str, Any]:
    """Record that a sensitive field changed, never what it changed to."""
    return {
        key: ("[redacted]", "[redacted]") if key.lower() in SENSITIVE_KEYS else value
        for key, value in changes.items()
    }


def _resolve_actor_role(*, actor_role, management_actor, actor, ctx) -> str:
    """What role the actor held when this happened.

    Four sources, most specific first, and always a string — `AuditLog`'s column
    is NOT NULL with `""` as its empty value, so a None reaching it raised an
    integrity error that surfaced to people as a 409 on sign-in and on property
    creation.

    1. What the caller said. A service that knows better than anything here.
    2. A management principal's role. They are not `identity.User` at all.
    3. The request context — whoever made the request, which for almost every
       action is the actor themselves, and is already loaded.
    4. The actor's own role, read only when the context has nothing.

    The order of the last two is about cost, not correctness: `primary_role` is a
    query, `record` runs on every domain action, and during an ordinary request
    the context already holds the same answer. The context is empty in exactly
    two situations — signing in, where the middleware has authenticated nobody
    yet, and background work, where there is no request — and those are precisely
    the cases where reading the actor is worth a query.

    Empty is a true statement, not a missing one: it says the actor held no role
    at the time. Registration completes on phone, account type, name and password
    — a role grant is a separate step — so an account can sign in perfectly
    legitimately while holding none, and recording that is more honest than
    inventing "tenant" for them.
    """
    if actor_role:
        return actor_role

    management_role = getattr(management_actor, "role", "") if management_actor else ""
    if management_role:
        return management_role

    if ctx.actor_role:
        return ctx.actor_role

    return (getattr(actor, "primary_role", None) or "") if actor else ""


@transaction.atomic
def record(
    *,
    action: str,
    aggregate_type: str,
    aggregate_id: str,
    actor=None,
    actor_role: str = "",
    management_actor=None,
    actor_label: str = "",
    changes: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    on_behalf_of=None,
) -> AuditLog:
    """Write one audit entry, chained to the previous entry for this aggregate.

    A transaction-scoped advisory lock on the aggregate serialises concurrent
    writers so the chain cannot fork. Locking the previous *row* would not:
    the first two entries for an aggregate have no previous row to lock, so
    both writers would read nothing and both chain from the empty hash.

    Ordering is by id, not created_at. Ids are UUIDv7, so they are time-ordered
    and, unlike a timestamp, unique - two entries written in the same
    microsecond still have one unambiguous predecessor.
    """
    ctx = get_context()

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
            [f"audit:{aggregate_type}:{aggregate_id}"],
        )

    previous = (
        AuditLog.objects.filter(aggregate_type=aggregate_type, aggregate_id=str(aggregate_id))
        .order_by("-id")
        .first()
    )

    entry = AuditLog(
        action=action,
        aggregate_type=aggregate_type,
        aggregate_id=str(aggregate_id),
        actor=actor,
        management_actor_id=getattr(management_actor, "id", None),
        actor_label=(
            actor_label
            or (getattr(management_actor, "display_name", "") if management_actor else "")
            or (str(actor) if actor else "")
        ),
        actor_role=_resolve_actor_role(
            actor_role=actor_role,
            management_actor=management_actor,
            actor=actor,
            ctx=ctx,
        ),
        on_behalf_of=on_behalf_of,
        changes=_scrub(changes or {}),
        metadata=metadata or {},
        request_id=ctx.request_id,
        ip_address=ctx.ip_address,
        user_agent=ctx.user_agent,
        source=ctx.source,
        previous_hash=previous.entry_hash if previous else "",
    )
    # Hashed before the insert, so the row is written once and never updated.
    # An UPDATE here would be refused by the append-only database rules, and
    # under row-level security it would fail silently, leaving every entry_hash
    # empty and the chain unverifiable.
    entry.entry_hash = entry.compute_hash()
    entry.save()
    return entry


def verify_chain(aggregate_type: str, aggregate_id: str) -> tuple[bool, list[str]]:
    """Re-walk one aggregate's history and report entries that do not verify."""
    broken: list[str] = []
    previous_hash = ""
    entries = AuditLog.objects.filter(
        aggregate_type=aggregate_type, aggregate_id=str(aggregate_id)
    ).order_by("id")
    for entry in entries:
        entry.previous_hash = previous_hash
        expected = entry.compute_hash()
        if entry.entry_hash != expected:
            broken.append(str(entry.id))
        previous_hash = entry.entry_hash
    return not broken, broken
