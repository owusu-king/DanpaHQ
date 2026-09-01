"""What may be done to a lease offer, and by whom.

Two asymmetries here are deliberate, and both protect the party who did not
take the action:

**Acceptance is irreversible by the tenant.** Once accepted, a tenant cannot
unilaterally undo it — withdrawal becomes a request to the provider. Otherwise
an agreement a provider has arranged around can silently evaporate, and a
provider who has stopped showing the space has no protection.

**An offer can be withdrawn by the provider only before acceptance.** After
that the terms are agreed, and ending the arrangement is a separate act with
its own record rather than an edit to this one.

Nothing here asserts what the law requires. Ending a tenancy, notice periods
and deposits are flagged for legal review and are deliberately not modelled as
provider-side actions — see `docs/architecture/property-to-tenancy.md`.
"""

from __future__ import annotations

from apps.core.policy import (
    IMMUTABLE,
    NOT_AUTHORIZED,
    WRONG_STATE,
    Decision,
    allow,
    deny,
    register,
)

#: The tenant may still answer while the offer is open.
OPEN_TO_TENANT = ("offered",)
#: The provider may still take it back while the tenant has not answered.
WITHDRAWABLE = ("draft", "ready", "offered")


def _is_tenant(actor, lease) -> bool:
    return actor is not None and lease.tenant_id == getattr(actor, "id", None)


def _is_landlord(actor, lease) -> bool:
    return actor is not None and lease.landlord_id == getattr(actor, "id", None)


def can_accept_offer(*, actor, target, elevated: bool = False) -> Decision:
    """Only the named tenant, only while it is open."""
    if not _is_tenant(actor, target):
        return deny(NOT_AUTHORIZED, "This offer was not made to you.")

    if target.status not in OPEN_TO_TENANT:
        return deny(
            WRONG_STATE,
            "This offer is no longer open. Ask the landlord to send a new one.",
        )

    # Confirmation, not a reason: they are agreeing, and there is nothing to
    # explain to anyone. But it is binding on them, so it should not happen on
    # a mis-tap.
    return allow(
        message="Accepting means you agree to these terms. You cannot undo it yourself.",
        confirm=True,
    )


def can_decline_offer(*, actor, target, elevated: bool = False) -> Decision:
    if not _is_tenant(actor, target):
        return deny(NOT_AUTHORIZED, "This offer was not made to you.")

    if target.status not in OPEN_TO_TENANT:
        return deny(WRONG_STATE, "This offer is no longer open.")

    # Deliberately *not* a required reason. The landlord would like to know, and
    # the interface asks — but requiring it would make a tenant justify saying
    # no to the party with more power in the arrangement. A provider withdrawing
    # an offer someone was relying on does have to explain; the asymmetry is the
    # point, and it favours whoever did not take the action.
    return allow(
        message="The landlord will see your reason if you give one.",
        confirm=True,
    )


def can_withdraw_offer(*, actor, target, elevated: bool = False) -> Decision:
    """The provider taking back an offer, before it has been answered."""
    if not (elevated or _is_landlord(actor, target)):
        return deny(NOT_AUTHORIZED, "This is not your offer to withdraw.")

    if target.status == "active":
        return deny(
            IMMUTABLE,
            "This lease has been accepted, so it cannot be withdrawn. "
            "Ending an agreed tenancy is a separate step with its own record.",
        )

    if target.status not in WITHDRAWABLE:
        return deny(WRONG_STATE, "This offer is already closed.")

    return allow(
        message="The tenant will see that it was withdrawn, and why.",
        reason=True,
        confirm=True,
    )


def can_modify_offer(*, actor, target, elevated: bool = False) -> Decision:
    """Editing terms. Allowed only while nobody has agreed to them."""
    if not (elevated or _is_landlord(actor, target)):
        return deny(NOT_AUTHORIZED, "This is not your lease.")

    if target.status in ("draft", "ready"):
        return allow(message="Nobody has seen this yet.")

    if target.status == "offered":
        return deny(
            WRONG_STATE,
            "The tenant is looking at these terms. Withdraw the offer to change it, "
            "so they are not agreeing to something that moved.",
        )

    return deny(
        IMMUTABLE,
        "An accepted lease records what both parties agreed. It cannot be edited — "
        "a change is a new agreement that supersedes this one.",
    )


def can_delete_lease(*, actor, target, elevated: bool = False) -> Decision:
    """Only ever a draft. An executed lease is a record, not a row."""
    if not (elevated or _is_landlord(actor, target)):
        return deny(NOT_AUTHORIZED, "This is not your lease.")

    if target.status != "draft":
        return deny(
            IMMUTABLE,
            "This lease has been sent or agreed, so it stays on the record. "
            "It can be withdrawn or ended, but not deleted.",
        )

    return allow(message="This draft has never been sent.", confirm=True)


register("lease", "accept", can_accept_offer)
register("lease", "decline", can_decline_offer)
register("lease", "withdraw", can_withdraw_offer)
register("lease", "modify", can_modify_offer)
register("lease", "delete", can_delete_lease)
