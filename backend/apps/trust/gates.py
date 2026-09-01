"""Trust gates: which real-world actions a verification state permits.

The rule this file exists to hold, from the architecture record: **draft work is
never blocked by a review in progress.** A provider whose property is under
review can still add spaces, enter details, upload evidence and correct
mistakes. What is gated is the small set of actions with a counterparty on the
other end — publishing to strangers, taking applications, inviting a tenant,
issuing an offer, starting a tenancy.

Getting that the wrong way round is the commonest failure in a verification
product: everything is disabled while a review sits in a queue, the provider
cannot prepare, and the review has nothing to look at when it is finally
reached.

Gates return the same :class:`Decision` the lifecycle policies use, so a client
reads one shape for "may I" whether it is asking about archiving a property or
publishing a listing. One vocabulary, one enforcement helper, one payload —
which is the whole reason P1.5 came before this phase.

Nothing here asserts a legal requirement. A gate says what the *platform* will
permit, and every gate is deliberately conservative where the law is unsettled.
"""

from __future__ import annotations

from apps.core.policy import Blocker, Decision, allow, blocked_by, deny

from .models import SubjectType, VerificationKind, VerificationStatus

# --- reading the current state ------------------------------------------------


def _current(subject_type: str, subject_id, kind: str):
    """The verification that counts right now, if any.

    Approved and unexpired. `Verification.objects.current()` already encodes
    that, and going through it keeps one definition of "verified" rather than
    letting each caller decide whether an expired approval still counts.
    """
    from .models import Verification

    return (
        Verification.objects.current()
        .for_subject(subject_type, subject_id)
        .filter(kind=kind)
        .order_by("-decided_at", "-created_at")
        .first()
    )


def _latest(subject_type: str, subject_id, kind: str):
    """The most recent verification of this kind whatever its state."""
    from .models import Verification

    return (
        Verification.objects.for_subject(subject_type, subject_id)
        .filter(kind=kind)
        .order_by("-created_at")
        .first()
    )


def _state_blocker(latest, what: str) -> Blocker:
    """Turn a verification state into something a person can act on."""
    if latest is None:
        return Blocker(
            kind="verification_missing",
            count=1,
            message=f"{what} has not been submitted for review yet.",
        )

    messages = {
        VerificationStatus.PENDING: f"{what} is with our review team.",
        VerificationStatus.NEEDS_MORE: f"{what} needs something else before it can continue.",
        VerificationStatus.REJECTED: f"{what} was not approved. Read the note and send it again.",
        VerificationStatus.REVOKED: f"{what} was withdrawn.",
        VerificationStatus.EXPIRED: f"{what} has expired and needs renewing.",
    }
    return Blocker(
        kind=f"verification_{latest.status}",
        count=1,
        message=messages.get(latest.status, f"{what} is not approved."),
    )


def property_authority_ok(prop) -> bool:
    return _current(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY) is not None


def property_verification_ok(prop) -> bool:
    """Whether the property's complete submission has the successful outcome.

    Authority documents and property photographs remain distinct evidence
    checks, but Repair #1 made their package result authoritative. Space review
    must wait for that result rather than treating one approved evidence check
    as an approved property.
    """
    from apps.property.verification import PropertyReviewState, lifecycle

    return lifecycle(prop)["review_state"] == PropertyReviewState.VERIFIED


def space_condition_ok(unit) -> bool:
    return _current(SubjectType.SPACE, unit.id, VerificationKind.SPACE_CONDITION) is not None


def provider_standing_ok(user) -> bool:
    return _current(SubjectType.USER, user.id, VerificationKind.PROVIDER) is not None


# --- the gates ----------------------------------------------------------------


def can_build_inventory(*, prop) -> Decision:
    """Adding spaces, entering details, uploading evidence.

    Deliberately always allowed. This gate exists so the rule is stated rather
    than assumed — the next person to add a check has somewhere obvious to see
    that draft work is not gated, and a test to break if they gate it.
    """
    return allow(
        code="draft_work_is_open",
        message="Set up your property while the review runs. Nothing here waits on it.",
    )


def can_publish(*, prop, unit=None) -> Decision:
    """Offer this to strangers.

    The first gate with a counterparty: publishing puts a claim in front of
    people who cannot check it themselves, which is what the verification is
    for. Both the authority over the address and the condition of the space
    have to hold.
    """
    blockers: list[Blocker] = []

    if not property_authority_ok(prop):
        blockers.append(
            _state_blocker(
                _latest(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY),
                "Your authority over this property",
            )
        )

    if unit is not None and not space_condition_ok(unit):
        blockers.append(
            _state_blocker(
                _latest(SubjectType.SPACE, unit.id, VerificationKind.SPACE_CONDITION),
                "This space",
            )
        )

    if unit is not None:
        from apps.occupancy.services import unit_is_occupied

        if unit_is_occupied(unit):
            blockers.append(
                Blocker(
                    kind="space_occupied",
                    count=1,
                    message="This space is occupied and is not available to the public.",
                )
            )

    if blockers:
        return blocked_by(
            blockers,
            message=(
                "This cannot be advertised yet. Everything else about it stays "
                "available to you in the meantime."
            ),
        )

    return allow(message="This may be advertised.", confirm=True)


def can_submit_space_for_review(*, prop) -> Decision:
    """Ask a reviewer to look at one space inside this property.

    Requires the property's complete verification package to be approved first,
    and this is the one place in the ladder where the reason is about the
    reviewer rather than the tenant.

    A space review answers "is this room as described". That question only means
    something once "is this building this person's to let" has been answered —
    otherwise a reviewer spends their time on a room inside an address nobody has
    established a claim to, and an approved space would carry a trust mark
    resting on nothing. The provider is not blocked from *preparing*: creating
    the space, describing it, adding its photographs and saving it all stay open
    while the property is in review. Only asking for a decision waits.

    Property authority alone is deliberately insufficient. The provider sends
    authority documents and property photographs as one package and Operations
    returns one outcome, so a space cannot move ahead on a half-approved parent.
    """
    if not property_verification_ok(prop):
        from apps.property.verification import lifecycle

        review_state = lifecycle(prop)["review_state"]
        return blocked_by(
            [
                Blocker(
                    kind=f"verification_{review_state}",
                    count=1,
                    message=(
                        "The property this space is in must complete verification, "
                        "including its documents and photographs."
                    ),
                )
            ],
            message=(
                "This Unit can be sent for checking once the entire Property is "
                "verified. Everything about the Unit stays editable in the meantime."
            ),
        )
    return allow(message="This space may be sent for checking.")


def can_accept_applications(*, prop) -> Decision:
    """Take rental applications from the public.

    Same gate as publishing, and for the same reason: an application is a
    stranger acting on a claim. Kept as its own function because a later policy
    may want to separate them, and finding the decision then is easier than
    unpicking a shared one.
    """
    if not property_authority_ok(prop):
        return blocked_by(
            [
                _state_blocker(
                    _latest(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY),
                    "Your authority over this property",
                )
            ],
            message="Applications need your authority over this property confirmed first.",
        )
    return allow(message="This property may take applications.")


def can_invite_tenant(*, prop, unit=None) -> Decision:
    """Compatibility gate for installed clients that still render invitations."""
    return deny(
        "workflow_retired",
        "Direct tenant invitations have been retired. Share the verified Unit "
        "access code so the tenant can send a tenancy request.",
    )


def can_issue_lease_offer(*, prop, actor) -> Decision:
    """Put terms in front of a named person.

    Both gates: the account may operate here at all, and this address is one
    they hold. An offer is the point where money starts being discussed.
    """
    blockers: list[Blocker] = []

    if not provider_standing_ok(actor):
        blockers.append(
            Blocker(
                kind="provider_standing",
                count=1,
                message="Your account is not approved to operate as a provider yet.",
            )
        )

    if not property_authority_ok(prop):
        blockers.append(
            _state_blocker(
                _latest(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY),
                "Your authority over this property",
            )
        )

    if blockers:
        return blocked_by(
            blockers,
            message="An offer cannot be issued until these are confirmed.",
        )

    return allow(
        message="You may offer this to a tenant.",
        reason=False,
        confirm=True,
    )


def can_activate_tenancy(*, prop) -> Decision:
    """Start a tenancy against this property.

    The last gate, and the strictest in consequence if it is wrong: a tenancy
    is somebody's home.
    """
    if not property_authority_ok(prop):
        return blocked_by(
            [
                _state_blocker(
                    _latest(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY),
                    "Your authority over this property",
                )
            ],
            message="A tenancy cannot start until your authority over this property is confirmed.",
        )
    return allow(message="A tenancy may start here.")


# --- what a client renders ----------------------------------------------------

#: The gates a provider screen wants to show for a property, in the order the
#: journey reaches them.
PROPERTY_GATES = (
    ("build_inventory", can_build_inventory),
    ("accept_applications", can_accept_applications),
    ("invite_tenant", can_invite_tenant),
    ("activate_tenancy", can_activate_tenancy),
)


def gate_summary(*, prop, unit=None, actor=None) -> dict:
    """Every gate for this property, and whether it is open.

    Serialized onto the property so a screen can say what is available now and
    what is waiting on a review — rather than disabling everything and leaving
    the provider to guess which review it is waiting for.
    """
    summary = {}

    for name, gate in PROPERTY_GATES:
        summary[name] = _as_dict(gate(prop=prop))

    summary["publish"] = _as_dict(can_publish(prop=prop, unit=unit))
    if actor is not None:
        summary["issue_lease_offer"] = _as_dict(can_issue_lease_offer(prop=prop, actor=actor))

    return summary


def _as_dict(decision: Decision) -> dict:
    return {
        "allowed": decision.allowed,
        "code": decision.code,
        "message": decision.message,
        "requires_confirmation": decision.requires_confirmation,
        "blockers": [
            {"kind": b.kind, "count": b.count, "message": b.message} for b in decision.blockers
        ],
    }
