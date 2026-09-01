"""Lifecycle policy: who may do what, when, and what it must record.

Every consequential action in the rental domain — archiving a property,
accepting a lease, revoking an access code — is a decision with four parts:

1. **who** may take it (authorization),
2. **when** it is allowed (state),
3. **what stands in the way** (dependent records),
4. **what must be recorded** (reason, confirmation, audit).

Answering those in a view, or worse in a button's `disabled` prop, is how a
codebase ends up with eight different opinions about whether a landlord may
delete a let property. This module gives the whole domain one vocabulary for
the answer, and one place to enforce it.

The rule this exists to hold, from ADR 0021: **anything a counterparty has seen
or relied on is preserved.** A draft nobody saw may be removed. Everything else
is ended or archived, with a date and a reason, and stays readable.

A policy returns a :class:`Decision` rather than a bool because the interesting
part is never the bool. A refusal has to say what is in the way so the person
can act on it, and an allowance has to say what it will cost them — a reason, a
confirmation, an admin.

Policies are plain functions living in the app that owns the record. They are
not registered by decorator magic: a reader following "may I archive this
property" should land in `property/policies.py` and find the answer, not a
lookup table. The registry below exists only so the API can enumerate decisions
for a client, which is the one case that genuinely needs to be generic.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from .exceptions import Conflict, PermissionDenied, ValidationFailed


@dataclass(frozen=True)
class Blocker:
    """One reason an action cannot proceed, stated so a person can act on it.

    ``count`` is carried separately from the message because interfaces want to
    say "3 active leases" in their own words, and because a count of zero is a
    bug worth catching rather than a sentence with a hole in it.
    """

    kind: str
    count: int
    message: str


@dataclass(frozen=True)
class Decision:
    """The answer, and its terms."""

    allowed: bool
    #: Machine-readable. Clients branch on this; copy may change freely.
    code: str
    #: Product voice: says what is true and what to do next, never an apology.
    message: str = ""
    #: The action changes something a counterparty relies on, so the person is
    #: asked to confirm rather than losing it to a mis-tap.
    requires_reason: bool = False
    requires_confirmation: bool = False
    #: Only an administrator may do this, and never silently.
    requires_elevated: bool = False
    blockers: tuple[Blocker, ...] = field(default_factory=tuple)

    def __bool__(self) -> bool:  # pragma: no cover - clarity at call sites
        return self.allowed


# --- the answers a policy can give ------------------------------------------


def allow(
    *,
    code: str = "ok",
    message: str = "",
    reason: bool = False,
    confirm: bool = False,
    elevated: bool = False,
) -> Decision:
    return Decision(
        allowed=True,
        code=code,
        message=message,
        requires_reason=reason,
        requires_confirmation=confirm,
        requires_elevated=elevated,
    )


def deny(code: str, message: str, *, blockers: tuple[Blocker, ...] = ()) -> Decision:
    return Decision(allowed=False, code=code, message=message, blockers=blockers)


def blocked_by(blockers: list[Blocker], *, message: str) -> Decision:
    """Refused because something depends on it. The commonest refusal here."""
    return Decision(
        allowed=False,
        code="has_dependents",
        message=message,
        blockers=tuple(blockers),
    )


NOT_AUTHORIZED = "not_authorized"
WRONG_STATE = "wrong_state"
HAS_DEPENDENTS = "has_dependents"
NEEDS_ELEVATED = "needs_elevated"
IMMUTABLE = "immutable"


# --- enforcement -------------------------------------------------------------


def enforce(
    decision: Decision,
    *,
    reason: str = "",
    confirmed: bool = True,
    elevated: bool = False,
) -> None:
    """Raise unless the action may proceed on the terms the policy set.

    Services call this; views do not decide. The exception type is chosen so the
    error envelope carries a status a client can branch on without reading
    English: 403 for authorization, 409 for state and dependents, 422 for a
    missing reason.
    """
    if not decision.allowed:
        # The blockers are the actionable half. Raising only `message` threw
        # them away, so a refusal arrived as "this cannot be advertised yet"
        # with no indication of which review was outstanding — and the person
        # reading it had nothing to do next. A `Decision` carries both because
        # both are needed; enforcement now says both.
        message = decision.message
        if decision.blockers:
            message = " ".join(
                [message, *(blocker.message for blocker in decision.blockers)]
            ).strip()
        if decision.code in (NOT_AUTHORIZED, NEEDS_ELEVATED):
            raise PermissionDenied(message)
        raise Conflict(message)

    if decision.requires_elevated and not elevated:
        raise PermissionDenied(
            "This needs an administrator. Contact support and they will look at it."
        )

    if decision.requires_reason and not reason.strip():
        # Not pedantry: the reason is what the other party reads later, and an
        # empty one turns an explained decision into an unexplained one.
        raise ValidationFailed(
            "Say why. Whoever this affects will see it.",
            details={"fields": {"reason": ["A reason is required for this action."]}},
        )

    if decision.requires_confirmation and not confirmed:
        raise ValidationFailed("Confirm this action to continue.")


# --- exposure ----------------------------------------------------------------

#: ``(target_type, action) -> policy``. Populated by each app's ``policies``
#: module at import time so the API can enumerate what a client may render.
#: Enforcement never goes through here — services call their policy directly,
#: which keeps the call graph readable.
REGISTRY: dict[tuple[str, str], Callable[..., Decision]] = {}


def register(target_type: str, action: str, policy: Callable[..., Decision]) -> None:
    REGISTRY[(target_type, action)] = policy


def permitted_actions(target_type: str, *, actor, target, elevated: bool = False) -> dict:
    """Every action on this record, and whether it may be taken.

    Serialized onto the record so a client renders what is permitted instead of
    deciding it. Hiding a control this says no to is a courtesy; the service
    refuses it regardless.
    """
    result = {}
    for (registered_type, action), policy in REGISTRY.items():
        if registered_type != target_type:
            continue
        decision = policy(actor=actor, target=target, elevated=elevated)
        result[action] = {
            "allowed": decision.allowed,
            "code": decision.code,
            "message": decision.message,
            "requires_reason": decision.requires_reason,
            "requires_confirmation": decision.requires_confirmation,
            "requires_elevated": decision.requires_elevated,
            "blockers": [
                {"kind": b.kind, "count": b.count, "message": b.message} for b in decision.blockers
            ],
        }
    return result


# --- recording ---------------------------------------------------------------


def record_transition(
    *,
    action: str,
    target_type: str,
    target,
    actor=None,
    decision: Decision | None = None,
    reason: str = "",
    previous: str = "",
    current: str = "",
    elevated: bool = False,
    extra: dict | None = None,
):
    """Write the audit entry a consequential action owes.

    Kept next to :func:`enforce` rather than left to each service, because an
    action that changes what a counterparty relies on and leaves no trace is the
    failure mode this whole module exists to prevent — and "remember to audit"
    is not a mechanism.

    The audit log is hash-chained (see `apps.audit.services.record`), so this is
    also what makes a later dispute answerable: who acted, under what authority,
    what changed, and why.
    """
    from apps.audit.services import record

    metadata = {
        "action": action,
        "target_type": target_type,
        # An administrator acting over a provider's records is the case most
        # worth being able to find later.
        "elevated": elevated,
    }
    if decision is not None:
        metadata["policy_code"] = decision.code
    if reason:
        metadata["reason"] = reason
    if extra:
        metadata.update(extra)

    changes = None
    if previous or current:
        changes = {"status": {"from": previous, "to": current}}

    return record(
        action=_audit_action(action),
        aggregate_type=target_type,
        aggregate_id=str(target.pk),
        actor=actor,
        changes=changes,
        metadata=metadata,
    )


def _audit_action(action: str) -> str:
    """Map a lifecycle action onto the audit vocabulary.

    Archiving is recorded as a delete because that is what it is from the
    record's point of view — it left the working set — while the metadata keeps
    the distinction that matters, which is that nothing was destroyed.

    The enum is imported here rather than passed in: `audit` imports `core`, so
    a module-level import would close the cycle, and threading a class through
    as an argument only moved the problem somewhere it read worse.
    """
    from apps.audit.models import AuditAction

    if action in {"delete", "archive"}:
        return AuditAction.DELETE
    if action in {"accept", "decline", "withdraw", "revoke", "publish", "end"}:
        return AuditAction.UPDATE
    return AuditAction.UPDATE
