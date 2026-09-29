"""What may be done to a property or a rentable space, and on what terms.

The governing rule (ADR 0021): a provider may remove a draft nobody has seen.
Once anything a counterparty relied on exists — a listing that was published, a
lease, an occupancy — the record is archived rather than deleted, and stays
readable to the people it concerns.

A tenant who accepted terms must still be able to read them after the provider
has moved on. That is the whole reason deletion is refused here, and the
refusal messages say so rather than reporting a database constraint.
"""

from __future__ import annotations

from apps.core.policy import (
    NOT_AUTHORIZED,
    WRONG_STATE,
    Blocker,
    Decision,
    allow,
    blocked_by,
    deny,
    register,
)


def _plural(count: int, one: str, many: str) -> str:
    return one if count == 1 else many


# --- authorization -----------------------------------------------------------


def _manages(actor, property_obj) -> bool:
    """The predicate every service on this path actually enforces.

    `Property.is_managed_by`, not `_has_authority`. The distinction matters and
    getting it wrong is what made a saved draft unsendable: a property created
    through the private or organization flow has **no** `PropertyRelationship`
    at all — deliberately, because creating one is a claim rather than proof, and
    the relationship is materialised later by a reviewed authority workflow.

    So a policy keyed on the relationship answered "you do not manage this
    property" to the provider who had just created it, while
    `spaces.assert_can_manage` and `condition.assert_may_review` — the code that
    actually runs — answered yes. The client renders the policy and the server
    enforces the service, and when those two disagree the control simply
    disappears with nothing said. `assert_may_review` carries the same warning
    about the same query.

    Destructive policy uses this same resource-scoped answer. What may be
    destroyed is then narrowed by the record's lifecycle and history, rather
    than by requiring a relationship that private organization inventory does
    not have yet.
    """
    if actor is None or not getattr(actor, "is_authenticated", True):
        return False
    prepared = getattr(property_obj, "_property_list_can_manage", None)
    if prepared is not None:
        return bool(prepared)
    # Every one of the six property policies opens with this question, so a
    # listing asked it six times per row. Keyed on both, because the answer is
    # about a pairing rather than about either side.
    from apps.core.memo import cached

    return cached(
        ("property.manages", property_obj.pk, getattr(actor, "pk", None)),
        lambda: property_obj.is_managed_by(actor),
    )


# --- what stands in the way --------------------------------------------------


def _property_blockers(property_obj) -> list[Blocker]:
    # Archive and delete both ask, and the three counts below are the same three
    # counts either way.
    from apps.core.memo import cached

    return cached(("property.blockers", property_obj.pk), lambda: _count_blockers(property_obj))


def _count_blockers(property_obj) -> list[Blocker]:
    from apps.lease.models import OPEN_STATUSES, Lease
    from apps.listing.models import Listing
    from apps.occupancy.models import Occupancy

    blockers: list[Blocker] = []

    tenants = getattr(property_obj, "_property_list_open_occupancy_count", None)
    if tenants is None:
        tenants = Occupancy.objects.filter(property=property_obj, ended_at__isnull=True).count()
    if tenants:
        blockers.append(
            Blocker(
                kind="tenancy",
                count=tenants,
                message=f"{tenants} {_plural(tenants, 'tenant', 'tenants')} still living here.",
            )
        )

    leases = getattr(property_obj, "_property_list_open_lease_count", None)
    if leases is None:
        leases = Lease.objects.filter(unit__property=property_obj, status__in=OPEN_STATUSES).count()
    if leases:
        blockers.append(
            Blocker(
                kind="lease",
                count=leases,
                message=f"{leases} {_plural(leases, 'lease', 'leases')} still running.",
            )
        )

    listings = getattr(property_obj, "_property_list_open_listing_count", None)
    if listings is None:
        listings = Listing.objects.filter(
            unit__property=property_obj,
            status__in=["draft", "pending_review", "active"],
        ).count()
    if listings:
        blockers.append(
            Blocker(
                kind="listing",
                count=listings,
                message=f"{listings} {_plural(listings, 'listing', 'listings')} still live.",
            )
        )

    return blockers


def _space_blockers(unit) -> list[Blocker]:
    from apps.lease.models import OPEN_STATUSES, Lease
    from apps.listing.models import Listing
    from apps.occupancy.models import Occupancy

    blockers: list[Blocker] = []

    tenants = Occupancy.objects.filter(unit=unit, ended_at__isnull=True).count()
    if tenants:
        blockers.append(
            Blocker(
                kind="tenancy",
                count=tenants,
                message=f"{tenants} {_plural(tenants, 'tenant', 'tenants')} still here.",
            )
        )

    leases = Lease.objects.filter(unit=unit, status__in=OPEN_STATUSES).count()
    if leases:
        blockers.append(
            Blocker(
                kind="lease",
                count=leases,
                message=f"{leases} {_plural(leases, 'lease', 'leases')} still running.",
            )
        )

    listings = Listing.objects.filter(
        unit=unit, status__in=["draft", "pending_review", "active"]
    ).count()
    if listings:
        blockers.append(
            Blocker(
                kind="listing",
                count=listings,
                message="This space is still listed.",
            )
        )

    return blockers


def _property_has_history(property_obj) -> bool:
    """Has anyone outside the provider's own workspace seen this?

    Any lease, occupancy or once-published listing — ended ones included — makes
    this a record with a counterparty rather than a draft.
    """
    from apps.lease.models import Lease
    from apps.listing.models import Listing
    from apps.occupancy.models import Occupancy

    prepared = (
        getattr(property_obj, "_property_list_has_occupancy_history", None),
        getattr(property_obj, "_property_list_has_lease_history", None),
        getattr(property_obj, "_property_list_has_listing_history", None),
    )
    if all(value is not None for value in prepared):
        return any(prepared)

    return (
        Occupancy.objects.filter(property=property_obj).exists()
        or Lease.objects.filter(unit__property=property_obj).exists()
        or Listing.all_objects.filter(unit__property=property_obj).exclude(status="draft").exists()
    )


def _space_has_history(unit) -> bool:
    from apps.lease.models import Lease
    from apps.listing.models import Listing
    from apps.occupancy.models import Occupancy

    return (
        Occupancy.objects.filter(unit=unit).exists()
        or Lease.objects.filter(unit=unit).exists()
        or Listing.all_objects.filter(unit=unit).exclude(status="draft").exists()
    )


# --- policies ----------------------------------------------------------------


def can_archive_property(*, actor, target, elevated: bool = False) -> Decision:
    """Archive: it leaves the provider's working view, and nothing is lost."""
    from .verification import WITH_REVIEWER

    if not (elevated or _manages(actor, target)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")

    if target.deleted_at is not None:
        return deny(WRONG_STATE, "This property is already archived.")

    if _property_state(target)["state"] in WITH_REVIEWER:
        return deny(
            WRONG_STATE,
            "This property is with our review team. Take the submission back "
            "first, then archive it.",
        )

    blockers = _property_blockers(target)
    if blockers:
        return blocked_by(
            blockers,
            message=(
                "This property is still in use. End what is running here first — "
                "archiving now would hide records people are relying on."
            ),
        )

    return allow(
        message="Archiving keeps every record and removes the property from your workspace.",
        reason=True,
        confirm=True,
    )


def can_restore_property(*, actor, target, elevated: bool = False) -> Decision:
    """Return an archived Property to working inventory, if it is still coherent."""
    from .models import PropertyType
    from .space_rules import allowed_space_types
    from .verification import WITH_REVIEWER

    if not (elevated or _manages(actor, target)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")
    if target.deleted_at is None:
        return deny(WRONG_STATE, "This property is not archived.")
    if _property_state(target)["state"] in WITH_REVIEWER:
        return deny(
            WRONG_STATE,
            "This property has an open review. Resolve or withdraw that review "
            "before restoring it.",
        )

    blockers = _property_blockers(target)
    if blockers:
        return blocked_by(
            blockers,
            message=(
                "This property gained active records while archived and cannot be restored yet."
            ),
        )

    allowed_types = allowed_space_types(target.property_type)
    if target.units.filter(is_active=True).exclude(space_type__in=allowed_types).exists():
        return deny(
            WRONG_STATE,
            "One or more active spaces no longer fit this property's category. "
            "Archive or correct those spaces before restoring the property.",
        )
    if (
        target.property_type != PropertyType.HOSTEL
        and target.units.filter(beds__is_active=True).exists()
    ):
        return deny(
            WRONG_STATE,
            "This non-hostel property still contains active beds. Resolve that inventory "
            "before restoring it.",
        )

    return allow(message="Restore this property to your working inventory.")


def can_delete_property(*, actor, target, elevated: bool = False) -> Decision:
    """Permanent removal, and only for something nobody else has seen.

    A reviewer counts as somebody. Once a property has been sent, deleting it
    would destroy the thing a decision was made about — so anything with the
    team, or already decided, is archived instead.

    Keyed on `_manages` rather than `_has_authority`, which had it exactly
    backwards. `_has_authority` needs a live `PropertyRelationship`, and that
    only exists once an authority claim has been *approved* — so the provider
    could not delete the draft they had just created, and could delete the
    property whose verification they had just been granted.
    """
    from .verification import OPEN_STATES, PropertyVerificationState

    if not (elevated or _manages(actor, target)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")

    state = _property_state(target)["state"]
    if state not in OPEN_STATES or state in {
        PropertyVerificationState.CHANGES_REQUESTED,
        PropertyVerificationState.REJECTED,
        PropertyVerificationState.EXPIRED,
    }:
        return deny(
            "immutable",
            "Our team has seen this property, so it cannot be deleted. Archive "
            "it instead — the records stay and it leaves your workspace.",
        )

    if _property_has_history(target):
        return deny(
            "immutable",
            "This property has tenancy or listing history, so it cannot be deleted. "
            "Archive it instead — the records stay and it leaves your workspace.",
        )

    blockers = _property_blockers(target)
    if blockers:
        return blocked_by(blockers, message="This property is still in use.")

    return allow(
        message="Nothing has been let or published here, so this can be removed entirely.",
        reason=True,
        confirm=True,
    )


def can_archive_space(*, actor, target, elevated: bool = False) -> Decision:
    """Take a Unit out of working inventory without erasing its history.

    This follows the Property boundary: the person who may manage a private
    draft may also abandon it, while a reviewer holding the record must first
    receive an explicit withdrawal rather than have the subject disappear from
    underneath their queue entry.
    """
    from apps.trust.condition import ConditionState, lifecycle_state

    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")

    if not target.is_active:
        return deny(WRONG_STATE, "This space is already archived.")

    if lifecycle_state(target) in {
        ConditionState.SUBMITTED,
        ConditionState.UNDER_REVIEW,
    }:
        return deny(
            WRONG_STATE,
            "This Unit is with our review team. Withdraw the submission first, " "then archive it.",
        )

    blockers = _space_blockers(target)
    if blockers:
        return blocked_by(
            blockers,
            message="This space is still in use. End what is running here first.",
        )

    return allow(
        message="Archiving keeps its history and takes it out of your inventory.",
        reason=True,
        confirm=True,
    )


def can_restore_space(*, actor, target, elevated: bool = False) -> Decision:
    """Reactivate a space only beneath a live, compatible Property."""
    from .models import PropertyType
    from .space_rules import allowed_space_types

    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")
    if target.is_active:
        return deny(WRONG_STATE, "This space is not archived.")
    if target.property.deleted_at is not None:
        return deny(
            WRONG_STATE,
            "Restore the parent property before restoring this space.",
        )

    blockers = _space_blockers(target)
    if blockers:
        return blocked_by(
            blockers,
            message="This space gained active records while archived and cannot be restored yet.",
        )
    if target.space_type not in allowed_space_types(target.property.property_type):
        return deny(
            WRONG_STATE,
            "This space no longer fits the property's category. Correct its category "
            "before restoring it.",
        )
    if (
        target.property.property_type != PropertyType.HOSTEL
        and target.beds.filter(is_active=True).exists()
    ):
        return deny(
            WRONG_STATE,
            "Beds can only be active inside a hostel property. Resolve those beds before "
            "restoring this space.",
        )

    return allow(message="Restore this space to the property's working inventory.")


def can_delete_space(*, actor, target, elevated: bool = False) -> Decision:
    """Permanently remove only a Unit nobody outside the workspace has seen."""
    from apps.trust.condition import ConditionState, lifecycle_state

    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")

    if lifecycle_state(target) not in {
        ConditionState.DRAFT,
        ConditionState.READY,
    }:
        return deny(
            "immutable",
            "Our team has seen this Unit, so it cannot be deleted. Archive it "
            "instead — its record stays and it leaves your inventory.",
        )

    if _space_has_history(target):
        return deny(
            "immutable",
            "This space has been let or listed, so its history has to stay. " "Archive it instead.",
        )

    blockers = _space_blockers(target)
    if blockers:
        return blocked_by(blockers, message="This space is still in use.")

    return allow(
        message=(
            "Nothing has been let, listed or reviewed here, so this Unit can be "
            "removed entirely."
        ),
        reason=True,
        confirm=True,
    )


# --- the property lifecycle --------------------------------------------------
#
# The page renders these; the services enforce them. Both read
# `property.verification.lifecycle`, so what a provider is offered and what the
# API will accept are the same answer to the same question — which is the
# invariant the space policies broke once already.


def _property_state(prop) -> dict:
    from .verification import lifecycle

    return lifecycle(prop)


# `lifecycle` memoizes itself, so the policies that read it share one answer
# with each other and with the serializer's `verification` field.


def can_edit_property(*, actor, target, elevated: bool = False) -> Decision:
    """Change the property's own details.

    Open while it is with the provider, closed while a reviewer is holding it —
    they would otherwise decide about something other than what they were shown
    — and closed again once they have approved it.

    **A verified property is not editable at all**, not even its name.

    This was briefly a partial allowance: the four fields `trust.evidence_policy`
    reads were refused and the labels around them let through, on the reasoning
    that a name is not something a reviewer checked. That reasoning is wrong at
    the level that matters. A verification is a statement about a described
    thing, and the description a tenant is shown includes the name. Letting
    "Adom Heights" become something else under a live approval means the mark
    now vouches for a property nobody looked at.

    The honest way to change a verified property is to have it looked at again.
    Spaces have that (`spaces.request_recheck`, which supersedes the approval and
    returns the space to draft); properties do not yet, so this refuses and says
    so rather than offering a half-door. When a property re-check exists this is
    where it gets named.
    """
    from .verification import WITH_REVIEWER, PropertyVerificationState

    if not (elevated or _manages(actor, target)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")

    state = _property_state(target)["state"]
    if state in WITH_REVIEWER:
        return deny(
            WRONG_STATE,
            "This property is with our review team. You can change it again once "
            "they have come back to you.",
        )
    if state == PropertyVerificationState.VERIFIED:
        return deny(
            WRONG_STATE,
            "This property has been verified, so its details are fixed. Changing "
            "them would break the check our team has already made. Contact "
            "support if something here is genuinely wrong.",
        )
    return allow(message="You can change this property while it is with you.")


def _sale_title_blockers(target, application) -> list[Blocker]:
    """The title — and for land the site plan — a sale's review reads.

    Stricter than letting on purpose (owner, 2026-09-28): the claim carries the
    seller's relationship, and a sale adds the document showing what is being
    sold. Named, because "a document is missing" does not say which of three.
    """
    from apps.trust.evidence_policy import missing_required, sale_title_slots
    from apps.trust.models import VerificationEvidence

    collected = list(
        VerificationEvidence.objects.filter(
            verification_id=application.authority_verification_id
        ).values_list("evidence_type", flat=True)
    )
    outstanding = missing_required(collected, sale_title_slots(target))
    return [
        Blocker(kind="title_missing", count=1, message=f"{slot.label} is still needed.")
        for slot in outstanding
    ]


def can_submit_property(*, actor, target, elevated: bool = False) -> Decision:
    """Send the property to our team.

    Refused while it is already there, once it is verified, and while the
    photographs are incomplete — the last with the count, because "not ready"
    tells nobody which of five views is missing.
    """
    from apps.trust import condition

    from .verification import WITH_REVIEWER, PropertyVerificationState

    if not (elevated or _manages(actor, target)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")

    state = _property_state(target)["state"]
    if state in WITH_REVIEWER:
        return deny(WRONG_STATE, "This property is already with our team.")
    if state == PropertyVerificationState.VERIFIED:
        return deny(WRONG_STATE, "This property has already been verified.")
    if state == PropertyVerificationState.SUSPENDED:
        return deny(
            WRONG_STATE,
            "This property's verification was withdrawn by our team. Contact "
            "support before sending it again.",
        )

    blockers: list[Blocker] = []

    # The document. A reviewer looking at photographs of a building nobody has
    # claimed cannot decide anything, so both halves have to be here.
    from .models import ProviderApplicationStatus
    from .verification import application_for

    application = application_for(target)
    claimed = application is not None and application.status in [
        ProviderApplicationStatus.DRAFT,
        ProviderApplicationStatus.WITHDRAWN,
        ProviderApplicationStatus.PENDING_REVIEW,
        ProviderApplicationStatus.NEEDS_MORE,
        ProviderApplicationStatus.APPROVED,
    ]
    if not claimed:
        blockers.append(
            Blocker(
                kind="document_missing",
                count=1,
                message=(
                    "The document showing this property is yours to sell is missing."
                    if target.is_for_sale
                    else "The document showing this property is yours to let is missing."
                ),
            )
        )
    elif target.is_for_sale:
        blockers.extend(_sale_title_blockers(target, application))

    if target.is_for_sale:
        from apps.sale.services import sale_blockers

        missing = sale_blockers(target)
        if missing:
            first = missing[0]["message"]
            blockers.append(
                Blocker(
                    kind="sale_details_missing",
                    count=len(missing),
                    message=first
                    if len(missing) == 1
                    else f"{len(missing)} sale details still needed — {first.lower()}",
                )
            )

    snapshot = condition.snapshot(target)
    outstanding = snapshot["required_outstanding"]
    if outstanding:
        blockers.append(
            Blocker(
                kind="evidence_missing",
                count=outstanding,
                message=(
                    f"{outstanding} of {snapshot['required_total']} photographs still needed."
                ),
            )
        )

    if blockers:
        return blocked_by(
            blockers,
            message="This property is not finished yet, so there is nothing to send.",
        )

    return allow(message="This property is ready to send for checking.", confirm=True)


def can_withdraw_property_submission(*, actor, target, elevated: bool = False) -> Decision:
    """Take a submission back before anyone has decided it.

    Only while it is genuinely with the team and undecided. Withdrawing after a
    verdict would be an attempt to unsay somebody else's answer, and there is a
    separate, honest thing to do then — read the note and send it again.
    """
    from .verification import WITH_REVIEWER

    if not (elevated or _manages(actor, target)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")

    if _property_state(target)["state"] not in WITH_REVIEWER:
        return deny(WRONG_STATE, "There is nothing with our team to take back.")

    return allow(
        message=(
            "This comes out of the review queue and back to you. Everything you "
            "sent is kept, and you can send it again when you are ready."
        ),
        reason=False,
        confirm=True,
    )


# --- the space lifecycle -----------------------------------------------------
#
# Four separate questions, deliberately not one. A space can be editable and
# unpublishable, or verified and private, or published and taken. Collapsing
# them into a single "status" is what forced the listing rework, and repeating
# the mistake one level down would undo it.


def can_edit_space(*, actor, target, elevated: bool = False) -> Decision:
    """Change the space's own details.

    Open while the space is a draft and while a review has come back; closed
    while a reviewer is holding it, because they would then decide about
    something other than what they were shown. After approval it is a re-check
    rather than an edit — the details are fixed as they were approved.
    """
    from apps.trust import condition

    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")
    if not target.is_active:
        return deny(WRONG_STATE, "Restore this space before changing its checked details.")

    from apps.occupancy.services import unit_is_occupied

    if unit_is_occupied(target):
        return deny(
            WRONG_STATE,
            "This space is currently occupied, so its checked characteristics are "
            "protected until that occupancy ends. Its private entrance directions "
            "can still be updated.",
        )

    state = condition.lifecycle_state(target)
    if state in condition.EDITABLE_STATES:
        return allow(message="You can change this space while it is with you.")
    if state == condition.ConditionState.VERIFIED:
        return deny(
            WRONG_STATE,
            "This space has been checked, so its details are fixed as they were "
            "approved. Start a re-check to change them.",
        )
    return deny(
        WRONG_STATE,
        "This space is with our review team. You can change it again once they "
        "have come back to you.",
    )


def can_edit_operational_space(*, actor, target, elevated: bool = False) -> Decision:
    """Change only private directions used to operate access to the Unit."""
    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")
    if not target.is_active:
        return deny(WRONG_STATE, "Restore this space before changing its operational details.")
    return allow(message="You can update its private entrance directions.")


def can_recheck_space(*, actor, target, elevated: bool = False) -> Decision:
    """Reopen a verified Unit only while nobody relies on its approved facts."""
    from apps.occupancy.services import unit_is_occupied
    from apps.trust import condition

    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")
    if unit_is_occupied(target):
        return blocked_by(
            [
                Blocker(
                    kind="space_occupied",
                    count=1,
                    message="This space is currently occupied.",
                )
            ],
            message=(
                "The approved facts cannot be reopened while a tenant relies on them. "
                "End the occupancy first."
            ),
        )
    if condition.lifecycle_state(target) != condition.ConditionState.VERIFIED:
        return deny(WRONG_STATE, "This space has no approved check to reopen.")
    return allow(
        message="Reopening preserves the old decision and returns this space to draft.",
        confirm=True,
    )


def can_add_bed_to_space(*, actor, target, elevated: bool = False) -> Decision:
    """Change a hostel room's allocation before any tenancy relies on it."""
    from apps.occupancy.services import unit_is_occupied

    from .space_rules import is_hostel_room

    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")
    if not target.is_active:
        return deny(WRONG_STATE, "Restore this space before adding beds.")
    if not is_hostel_room(target):
        return deny(
            WRONG_STATE,
            "Beds can only be added to rooms in a hostel property.",
        )
    if unit_is_occupied(target):
        return blocked_by(
            [
                Blocker(
                    kind="space_occupied",
                    count=1,
                    message="This space is currently occupied.",
                )
            ],
            message="Its bed allocation cannot change until that occupancy has ended.",
        )
    return allow(message="A bed may be added to this space.")


def can_submit_space(*, actor, target, elevated: bool = False) -> Decision:
    """Ask for a decision on this space.

    Refused while a required photograph is outstanding, and the refusal names
    what is missing: "incomplete" is not something anybody can act on.
    """
    from apps.trust import condition, evidence_policy
    from apps.trust.gates import can_submit_space_for_review

    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")

    # Asked before the evidence, because it is the answer that does not change
    # by adding another photograph — and a screen that says "one more photo"
    # when the real wait is the property review sends somebody to do the wrong
    # thing.
    property_ready = can_submit_space_for_review(prop=target.property)
    if not property_ready.allowed:
        return property_ready

    state = condition.lifecycle_state(target)
    if state == condition.ConditionState.VERIFIED:
        return deny(WRONG_STATE, "This space has already been checked.")
    if state in {condition.ConditionState.SUBMITTED, condition.ConditionState.UNDER_REVIEW}:
        return deny(WRONG_STATE, "This is already with our team.")

    review = condition.current_review(target)
    collected = [evidence.evidence_type for evidence in review.evidence.all()] if review else []
    outstanding = evidence_policy.missing_required(collected, condition.slots_for(target))
    if outstanding:
        missing = ", ".join(slot.label.lower() for slot in outstanding)
        return blocked_by(
            [Blocker(kind="evidence_missing", count=len(outstanding), message=missing)],
            message=f"Add {len(outstanding)} more before sending: {missing}.",
        )

    return allow(
        message="This is ready to send for checking.",
        confirm=True,
    )


def can_withdraw_space_submission(*, actor, target, elevated: bool = False) -> Decision:
    """The same act on a space: take it back while nobody has decided it."""
    from apps.trust import condition

    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")

    state = condition.lifecycle_state(target)
    if state not in {
        condition.ConditionState.SUBMITTED,
        condition.ConditionState.UNDER_REVIEW,
    }:
        return deny(WRONG_STATE, "There is nothing with our team to take back.")

    return allow(
        message=(
            "This comes out of the review queue and back to you. The photographs "
            "you sent are kept."
        ),
        confirm=True,
    )


def can_publish_space(*, actor, target, elevated: bool = False) -> Decision:
    """Offer this space to the public.

    Defers to `trust.gates.can_publish` rather than restating it, so the answer a
    client renders and the answer `publish_listing` enforces are the same
    function called twice.
    """
    from apps.trust.gates import can_publish

    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")
    return can_publish(prop=target.property, unit=target)


def can_invite_to_space(*, actor, target, elevated: bool = False) -> Decision:
    """Bring somebody into this space privately."""
    from apps.trust.gates import can_invite_tenant

    if not (elevated or _manages(actor, target.property)):
        return deny(NOT_AUTHORIZED, "You do not manage this property.")
    return can_invite_tenant(prop=target.property, unit=target)


register("property", "archive", can_archive_property)
register("property", "restore", can_restore_property)
register("property", "delete", can_delete_property)
register("property", "edit", can_edit_property)
register("property", "submit_for_verification", can_submit_property)
register("property", "withdraw_submission", can_withdraw_property_submission)
register("space", "archive", can_archive_space)
register("space", "restore", can_restore_space)
register("space", "delete", can_delete_space)
register("space", "edit", can_edit_space)
register("space", "edit_operational", can_edit_operational_space)
register("space", "recheck", can_recheck_space)
register("space", "add_bed", can_add_bed_to_space)
register("space", "submit_for_verification", can_submit_space)
register("space", "publish", can_publish_space)
register("space", "invite_tenant", can_invite_to_space)
register("space", "withdraw_submission", can_withdraw_space_submission)
