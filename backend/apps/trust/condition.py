"""Showing that a property, or a space inside it, is as described.

The gap this closes: `evidence_policy` has been able to say what a property and a
space must show since P2, and `missing_required` has been able to say what is
outstanding — but nothing called either. There was no way to attach a photograph
of a bedroom to anything, and no submission to gate. The policy was a statement
of intent with no mechanism under it.

### Two reviews, not one

`PROPERTY_AUTHORITY` asks whether this person may let the building at all, and is
answered by a deed or an authorisation letter. `PROPERTY_CONDITION` asks whether
the building is what they say it is, and is answered by photographs. They are
decided at different times by people looking for different things, and merging
them would mean asking for a title deed again every time a room is added.

`SPACE_CONDITION` is the same question one level down, per rentable space.

### Why submission is a separate step from opening

`start_verification` puts a review in a queue the moment it is created. For a
document review that is right — the document arrives in the same request. For a
condition review it is not: the photographs arrive over several minutes, often
over several sittings, and a reviewer opening an empty submission learns nothing
and wastes the trip.

So a condition review opens unqueued, evidence accumulates against named slots,
and `submit_for_review` is the act that asks for a decision — refused, with the
outstanding slots named, until the required ones are filled.
"""

from __future__ import annotations

from django.db import transaction

from apps.core.exceptions import Conflict, PermissionDenied, ValidationFailed
from apps.core.policy import enforce

from . import evidence_policy, services
from .models import (
    EvidenceType,
    ReviewQueueEntry,
    SubjectType,
    Verification,
    VerificationEvidence,
    VerificationKind,
    VerificationMethod,
    VerificationStatus,
)

#: Statuses in which evidence may still be added and a submission still made.
OPEN_STATUSES = (VerificationStatus.PENDING, VerificationStatus.NEEDS_MORE)

#: Which photograph best stands for a building, best first.
#:
#: A property is asked to photograph its front, a side and its surroundings, and
#: a reviewer needs to know which is which — so the slots are named rather than
#: collected as three anonymous exteriors. That naming is what makes a cover
#: possible: the front of a building is the picture of it, and the water meter
#: is not, even though both are photographs of the same property.
#:
#: `EXTERIOR` sits second because it is the superseded name for `PROPERTY_FRONT`
#: and evidence already collected under it is still evidence. `INTERIOR_OVERVIEW`
#: is last: a room is a poor portrait of a building, but it beats a grey box.
#: Utility close-ups — the water source, the meter — are photographs of a
#: *fact*, not of the place, and are deliberately absent.
COVER_SLOTS = (
    EvidenceType.PROPERTY_FRONT,
    EvidenceType.EXTERIOR,
    EvidenceType.PROPERTY_SIDE,
    EvidenceType.COMPOUND,
    EvidenceType.PROPERTY_SURROUNDINGS,
    EvidenceType.LOCATION_CONTEXT,
    EvidenceType.INTERIOR_OVERVIEW,
)


def cover_photographs(property_ids) -> dict[str, object]:
    """The photograph of each building itself, keyed by property id.

    Batched deliberately. `subject_id` is a `CharField` rather than a foreign
    key, so `prefetch_related` cannot reach this and a per-row lookup would put
    one query behind every row of the Properties list.

    Superseded reviews are excluded — a correction is a new verification, and
    the picture that was replaced should not resurface as the building's face.
    Everything else counts, including reviews still open: a provider who has
    just uploaded the front of their building should see it, not wait on a
    reviewer to look at it first.
    """
    ids = [str(pk) for pk in property_ids]
    if not ids:
        return {}

    rank = {slot: index for index, slot in enumerate(COVER_SLOTS)}
    rows = (
        VerificationEvidence.objects.filter(
            verification__subject_type=SubjectType.PROPERTY,
            verification__kind=VerificationKind.PROPERTY_CONDITION,
            verification__subject_id__in=ids,
            evidence_type__in=COVER_SLOTS,
            file__isnull=False,
        )
        .exclude(verification__status=VerificationStatus.SUPERSEDED)
        .select_related("file", "verification")
        .order_by("-collected_at")
    )

    best: dict[str, tuple[int, object]] = {}
    for row in rows:
        key = row.verification.subject_id
        position = rank[row.evidence_type]
        held = best.get(key)
        # Ordered newest first, so an equal slot keeps the one already held.
        if held is None or position < held[0]:
            best[key] = (position, row.file)
    return {key: file for key, (_, file) in best.items()}


def _describe(subject) -> tuple[str, str, object]:
    """Which review this subject takes, and what to look it up by.

    Duck-typed on the presence of a `space_type`, because that is the field that
    distinguishes a rentable space from the property containing it, and importing
    both models here would make `trust` depend on `property` at module scope.
    """
    if hasattr(subject, "space_type"):
        return SubjectType.SPACE, VerificationKind.SPACE_CONDITION, subject.property
    return SubjectType.PROPERTY, VerificationKind.PROPERTY_CONDITION, subject


def assert_may_review(*, subject, user) -> None:
    """Whoever manages the property may get it checked.

    Deferred to `Property.is_managed_by`, which is the answer the rest of the
    app uses, rather than a relationship query written here.

    That query was the bug. A property created through the private or claim flow
    has **no** `PropertyRelationship` at all — deliberately, because the creator
    is a claimant and private setup is not proof of ownership; the relationship
    is materialised later by a reviewed authority workflow. So requiring one here
    refused every provider on their own property, and getting it checked is
    precisely the step that would eventually earn them the relationship. The
    check made its own precondition unreachable.

    `is_managed_by` covers the legacy owner field, live management
    relationships, staff, and organization membership — which is how a claimant
    reaches their own inventory.
    """
    _, _, prop = _describe(subject)
    if not prop.is_managed_by(user):
        raise PermissionDenied("You do not have access to that property.")


def slots_for(subject) -> list:
    """What this subject must show, from the policy rather than from a list here."""
    subject_type, _, _ = _describe(subject)
    if subject_type == SubjectType.SPACE:
        return evidence_policy.space_requirements(subject)
    return evidence_policy.property_requirements(subject)


def _missing_required(review: Verification | None, slots: list) -> list:
    """Required slots not filled by this review, keyed before typed fallback.

    New condition evidence always records its stable slot key. Matching that
    key prevents a photograph for one selected amenity from satisfying another
    amenity that happens to share an evidence type. Type matching remains only
    for legacy evidence collected before named slots existed.
    """
    if review is None:
        return [slot for slot in slots if slot.required]

    keyed: set[str] = set()
    legacy_types: list[str] = []
    for evidence in review.evidence.all():
        key = _slot_of(evidence)
        if key:
            keyed.add(key)
        else:
            legacy_types.append(evidence.evidence_type)

    outstanding = []
    for slot in slots:
        if not slot.required or slot.key in keyed:
            continue
        accepted = slot.accepts or (slot.evidence_type,)
        match = next((value for value in legacy_types if value in accepted), None)
        if match is None:
            outstanding.append(slot)
        else:
            legacy_types.remove(match)
    return outstanding


def current_review(subject) -> Verification | None:
    """The review still being worked on, if there is one.

    Open only. `attach` and `submit_for_review` both need the review they may
    still write to, and an approved one is finished.
    """
    subject_type, kind, _ = _describe(subject)
    from apps.core.memo import cached

    def produce():
        prepared = getattr(subject, "_property_list_verifications", None)
        if prepared is not None:
            return next(
                (row for row in prepared if row.kind == kind and row.status in OPEN_STATUSES),
                None,
            )
        return (
            Verification.objects.for_subject(subject_type, subject.id)
            .filter(kind=kind, status__in=OPEN_STATUSES)
            .order_by("-created_at")
            .first()
        )

    return cached(("condition.current", subject_type, str(subject.id), kind), produce)


def settled_review(subject) -> Verification | None:
    """A decision already reached: approved, rejected, or expired.

    Kept apart from `current_review` because the two answer different questions,
    and conflating them is what made a verified property look untouched. The
    screen asked only about open reviews, found none once a reviewer had
    approved, and rendered the whole checklist again as though nothing had
    happened — and then refused the first photo, because `open_review` could see
    the approval the screen could not.
    """
    subject_type, kind, _ = _describe(subject)
    from apps.core.memo import cached

    def produce():
        prepared = getattr(subject, "_property_list_verifications", None)
        if prepared is not None:
            candidates = [
                row
                for row in prepared
                if row.kind == kind
                and row.status not in OPEN_STATUSES
                and row.status != VerificationStatus.SUPERSEDED
            ]
            candidates.sort(
                key=lambda row: (
                    row.decided_at is None,
                    row.decided_at or row.created_at,
                    row.created_at,
                ),
                reverse=True,
            )
            return candidates[0] if candidates else None
        return (
            Verification.objects.for_subject(subject_type, subject.id)
            .filter(kind=kind)
            .exclude(status__in=OPEN_STATUSES)
            .exclude(status=VerificationStatus.SUPERSEDED)
            .order_by("-decided_at", "-created_at")
            .first()
        )

    return cached(("condition.settled", subject_type, str(subject.id), kind), produce)


def state_of(subject) -> str:
    """One word for where this subject's check stands.

    `approved` / `pending` / `rejected` / `expired` / `not_started`. Used by
    listings of properties and spaces, so a card can say what is true without
    each one working it out from two queries and getting it slightly different.
    """
    settled = settled_review(subject)
    if settled is not None and settled.status == VerificationStatus.APPROVED:
        return "approved" if settled.is_current else "expired"

    open_review = current_review(subject)
    if open_review is not None:
        return "pending" if _is_queued(open_review) else "in_progress"

    return settled.status if settled is not None else "not_started"


def queue_entry_for(review: Verification | None) -> ReviewQueueEntry | None:
    """The review's queue row, including a select-related prepared value."""
    if review is None:
        return None
    try:
        return review.queue_entry
    except ReviewQueueEntry.DoesNotExist:
        return None


class ConditionState:
    """The lifecycle a provider is actually shown, in their words.

    `state_of` answers a narrower question — where the *review* stands — and both
    clients already render it on cards. This is the fuller vocabulary the
    property and space workspaces need, and it separates two things `state_of`
    collapses:

    * **draft** versus **ready to send.** A space with photographs still missing
      and a space with everything attached are both "in progress" to `state_of`,
      and they are the two states a provider most needs told apart: one has work
      left, the other is waiting on them to press a button.
    * **submitted** versus **under review.** Queued, and actually picked up by a
      reviewer. "Nobody has looked yet" and "somebody is looking now" are
      different answers to the only question the provider is asking.

    Verification only. Publication and availability are separate axes on the
    listing and are deliberately not folded in here — a space can be verified,
    private and unoccupied at once, and one field could not say that.
    """

    DRAFT = "draft"
    READY = "ready_for_submission"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    VERIFIED = "verified"
    CHANGES_REQUESTED = "changes_requested"
    REJECTED = "rejected"
    SUSPENDED = "suspended"
    EXPIRED = "expired"


#: What each state means, said once so both clients and the API agree.
CONDITION_STATE_LABELS: dict[str, str] = {
    ConditionState.DRAFT: "Draft",
    ConditionState.READY: "Ready to send",
    ConditionState.SUBMITTED: "Sent for review",
    ConditionState.UNDER_REVIEW: "Being reviewed",
    ConditionState.VERIFIED: "Verified",
    ConditionState.CHANGES_REQUESTED: "Changes requested",
    ConditionState.REJECTED: "Not approved",
    ConditionState.SUSPENDED: "Suspended",
    ConditionState.EXPIRED: "Expired",
}

#: States in which the record itself may still be edited.
#:
#: Editing while a reviewer is holding it would mean they decide on something
#: other than what they were shown, so the door closes at submission and opens
#: again on any outcome that returns the work to the provider.
EDITABLE_STATES = frozenset(
    {
        ConditionState.DRAFT,
        ConditionState.READY,
        ConditionState.CHANGES_REQUESTED,
        ConditionState.REJECTED,
        ConditionState.EXPIRED,
    }
)


def lifecycle_state(subject, *, outstanding: int | None = None) -> str:
    """Where this subject stands, in the provider-facing vocabulary.

    ``outstanding`` is accepted so a caller that has already computed the
    progress does not pay for the slot resolution twice; omitted, it is worked
    out here.
    """
    settled = settled_review(subject)
    if settled is not None:
        if settled.status == VerificationStatus.APPROVED:
            return ConditionState.VERIFIED if settled.is_current else ConditionState.EXPIRED
        if settled.status == VerificationStatus.REVOKED:
            return ConditionState.SUSPENDED
        if settled.status == VerificationStatus.EXPIRED:
            return ConditionState.EXPIRED
        # A rejection stands until the provider opens a fresh review, which
        # `attach` does on the next photograph.
        if settled.status == VerificationStatus.REJECTED and current_review(subject) is None:
            return ConditionState.REJECTED

    review = current_review(subject)
    if review is None:
        return ConditionState.DRAFT

    if review.status == VerificationStatus.NEEDS_MORE:
        return ConditionState.CHANGES_REQUESTED

    entry = (
        ReviewQueueEntry.objects.filter(verification=review)
        .only("claimed_at", "resolved_at")
        .first()
    )
    if entry is not None:
        return (
            ConditionState.UNDER_REVIEW
            if entry.claimed_at is not None and entry.resolved_at is None
            else ConditionState.SUBMITTED
        )

    if outstanding is None:
        outstanding = len(_missing_required(review, slots_for(subject)))
    return ConditionState.DRAFT if outstanding else ConditionState.READY


def snapshot(subject) -> dict:
    """Everything a card needs to say where a check stands, in one pass.

    `state_of` and `lifecycle_state` each re-read the same two rows, and a
    serializer rendering forty hostel rooms called both. This computes them
    together and is what the serializers use; the two functions stay because
    other callers ask only one of the questions.

    `condition_state` is the older vocabulary both clients already render.
    `state` is the fuller one. Both are returned rather than the old one being
    replaced, because a mobile build installed on somebody's phone today reads
    the old field and cannot be forced to update.
    """
    subject_type, kind, _ = _describe(subject)
    from apps.core.memo import cached

    return cached(
        ("condition.snapshot", subject_type, str(subject.id), kind),
        lambda: _snapshot(subject),
    )


def _snapshot(subject) -> dict:
    settled = settled_review(subject)
    review = current_review(subject)

    entry = queue_entry_for(review)

    slots = slots_for(subject)
    required_total = sum(1 for slot in slots if slot.required)
    outstanding = required_total
    if review is not None:
        collected = [evidence.evidence_type for evidence in review.evidence.all()]
        outstanding = len(evidence_policy.missing_required(collected, slots))

    # --- the older vocabulary -------------------------------------------------
    if settled is not None and settled.status == VerificationStatus.APPROVED:
        condition_state = "approved" if settled.is_current else "expired"
    elif review is not None:
        condition_state = "pending" if entry is not None else "in_progress"
    else:
        condition_state = settled.status if settled is not None else "not_started"

    # --- the fuller one -------------------------------------------------------
    state = None
    if settled is not None:
        if settled.status == VerificationStatus.APPROVED:
            state = ConditionState.VERIFIED if settled.is_current else ConditionState.EXPIRED
        elif settled.status == VerificationStatus.REVOKED:
            state = ConditionState.SUSPENDED
        elif settled.status == VerificationStatus.EXPIRED:
            state = ConditionState.EXPIRED
        elif settled.status == VerificationStatus.REJECTED and review is None:
            state = ConditionState.REJECTED

    if state is None:
        if review is None:
            state = ConditionState.DRAFT
        elif review.status == VerificationStatus.NEEDS_MORE:
            state = ConditionState.CHANGES_REQUESTED
        elif entry is not None:
            state = (
                ConditionState.UNDER_REVIEW
                if entry.claimed_at is not None and entry.resolved_at is None
                else ConditionState.SUBMITTED
            )
        else:
            state = ConditionState.DRAFT if outstanding else ConditionState.READY

    note = ""
    if review is not None and review.decision_note:
        note = review.decision_note
    elif settled is not None:
        note = settled.decision_note

    return {
        "state": state,
        "state_label": CONDITION_STATE_LABELS[state],
        "condition_state": condition_state,
        "editable": state in EDITABLE_STATES,
        "required_total": required_total,
        "required_outstanding": 0 if state == ConditionState.VERIFIED else outstanding,
        "can_submit": state == ConditionState.READY,
        "decision_note": note,
        "policy_version": evidence_policy.POLICY_VERSION,
    }


def is_editable(subject) -> bool:
    """Whether the record may still be changed.

    The gate the architecture states as "edit space details — yes while not
    under review". Draft work is never blocked by a review that has not started;
    it is blocked once somebody has been asked to look.
    """
    return lifecycle_state(subject) in EDITABLE_STATES


@transaction.atomic
def open_review(*, subject, actor) -> Verification:
    """Start collecting, without asking anyone to look yet.

    Idempotent: called again while one is open, it returns that one. A provider
    who reloads the page mid-upload must not end up with two half-filled reviews
    of the same room.
    """
    existing = current_review(subject)
    if existing is not None:
        return existing

    subject_type, kind, _ = _describe(subject)

    approved = (
        Verification.objects.for_subject(subject_type, subject.id)
        .filter(kind=kind, status=VerificationStatus.APPROVED)
        .first()
    )
    if approved is not None and approved.is_current:
        raise Conflict("This has already been checked and approved.")

    return services.start_verification(
        subject_type=subject_type,
        subject_id=subject.id,
        kind=kind,
        method=VerificationMethod.DOCUMENT_REVIEW,
        submitted_by=actor,
        # The point of this module. Nothing goes to a reviewer until the person
        # says they are finished.
        queue=False,
    )


@transaction.atomic
def attach(*, subject, actor, slot_key: str, file) -> object:
    """Add one photograph against one named slot.

    The slot is checked against the policy rather than trusted, so a client
    cannot invent `space.penthouse` and have it stored as though it had been
    asked for. Storing the slot key in the note is what lets `progress` report
    per-slot rather than merely counting files.
    """
    assert_may_review(subject=subject, user=actor)

    slots = {slot.key: slot for slot in slots_for(subject)}
    slot = slots.get(slot_key)
    if slot is None:
        raise ValidationFailed("That is not something this needs a photo of.")

    if file is None or not file.is_usable:
        raise ValidationFailed("That photo is still being checked. Try again in a moment.")
    if not file.is_owned_by(actor):
        raise ValidationFailed("That upload belongs to another account.")

    review = open_review(subject=subject, actor=actor)

    # Nothing goes into a case a reviewer is already holding.
    #
    # `open_review` is idempotent and a queued review is still the current one,
    # so this path happily added evidence to a submission in the queue — the
    # reviewer's case changing under them mid-decision. `detach` has refused
    # that since P3 and its twin never did.
    #
    # `NEEDS_MORE` is the exception and the reason this is not simply
    # `_is_queued`: there, a reviewer has *asked* for something else, and the
    # answer has to be able to reach the case they are holding.
    if _is_queued(review) and review.status != VerificationStatus.NEEDS_MORE:
        raise Conflict(
            "This is already with our team, so what they were sent cannot change. "
            "You can make changes once they come back to you."
        )

    # One slot holds one photograph, so a second upload against the same slot
    # *replaces* the first rather than stacking behind it.
    #
    # Without this there was no way to correct a photograph at all. The screen
    # showed a filled slot as a flat "Added" with no control on it, because
    # there was nothing it could have called: attaching again would have left
    # two files in a slot the policy describes as one, and `progress` reports
    # per-slot from a set, so the second would have been invisible. A provider
    # who photographed the wrong side of the building was stuck with it.
    #
    # Not while a reviewer holds it: under `NEEDS_MORE` the new photograph is an
    # addition to what they were sent, not a substitution for it.
    if not _is_queued(review):
        _clear_slot(review, slot.key)

    return services.attach_evidence(
        review,
        evidence_type=slot.evidence_type,
        file=file,
        collected_by=actor,
        notes=(f"Evidence policy {evidence_policy.POLICY_VERSION}, slot {slot.key}."),
    )


def _slot_of(evidence) -> str:
    """Which slot a piece of evidence was provided for.

    Read from the note rather than a column because evidence is shared with the
    authority flow, which has no slots. `attach` writes it; this is the only
    other place that reads it, and `progress` does the same parse.
    """
    marker = "slot "
    notes = evidence.notes or ""
    return notes.split(marker, 1)[1].strip(" .").strip() if marker in notes else ""


def _clear_slot(review, slot_key: str) -> int:
    """Remove whatever is currently filling one slot. Caller checks the state."""
    doomed = [e.id for e in review.evidence.all() if _slot_of(e) == slot_key]
    if not doomed:
        return 0
    removed, _ = review.evidence.filter(id__in=doomed).delete()
    return removed


@transaction.atomic
def detach(*, subject, actor, file_id) -> int:
    """Withdraw a photograph from a review nobody has been asked to look at yet.

    Evidence is immutable once a verification stands — `VerificationEvidence`
    refuses its own `delete` for exactly that reason, because a decision has to
    stay re-examinable against what it rested on.

    This is the one case that rule does not cover: a review that is still open
    and has not been queued has not been relied on by anybody. The provider is
    still assembling it, and a photograph they have taken back down must not
    still count towards the submission — otherwise a space could be submitted on
    evidence its own provider had removed, and a reviewer would open a case
    whose photographs are not there.

    Refused the moment a reviewer could be looking. Returns how many rows went.
    """
    assert_may_review(subject=subject, user=actor)

    review = current_review(subject)
    if review is None:
        return 0
    if _is_queued(review):
        raise Conflict(
            "This is already with our team, so what they were sent cannot change. "
            "You can make changes once they come back to you."
        )

    # Queryset delete, not instance delete: the model's guard is about evidence
    # behind a decision, and the checks above have established there is none.
    removed, _ = review.evidence.filter(file_id=file_id).delete()
    return removed


@transaction.atomic
def detach_slot(*, subject, actor, slot_key: str) -> int:
    """Take back the photograph filling one named slot.

    The slot-keyed twin of `detach`. A screen knows which *slot* it is showing —
    "the front of the building" — and had no way to name the file inside it, so
    a checklist could offer no way to undo an upload. Same rule: only while the
    review is still with the provider.
    """
    assert_may_review(subject=subject, user=actor)

    review = current_review(subject)
    if review is None:
        return 0
    if _is_queued(review):
        raise Conflict(
            "This is already with our team, so what they were sent cannot change. "
            "You can make changes once they come back to you."
        )
    return _clear_slot(review, slot_key)


def _provided_detail(evidence) -> dict:
    """What is in a slot: enough to show it back and enough to take it down.

    The preview is `inline` and short-lived. `attachment` — the default — makes a
    browser download rather than render, which is how every listing photograph
    on this product once failed to appear inside an `<img>`.
    """
    if evidence is None:
        return {"file_id": None, "preview_url": None, "filename": ""}

    file = evidence.file
    url = None
    if file is not None and file.is_usable:
        from apps.files.storage import get_storage

        url = (
            get_storage()
            .presign_download(
                key=file.storage_key,
                expires_in=300,
                filename=file.original_filename,
                disposition="inline",
            )
            .url
        )
    return {
        "file_id": str(file.id) if file is not None else None,
        "preview_url": url,
        "filename": file.original_filename if file is not None else "",
    }


def progress(*, subject, user) -> dict:
    """What is asked for, what has arrived, and what is still outstanding.

    Shaped for a checklist. A submission that is refused should tell somebody
    which three photographs are missing, not that their submission was
    incomplete — so the same structure serves the screen and the refusal.
    """
    assert_may_review(subject=subject, user=user)

    slots = slots_for(subject)
    settled = settled_review(subject)

    # A finished check is reported as finished. The screen used to ask only for
    # an *open* review, so once a reviewer approved one there was nothing to
    # find and the checklist came back from the beginning.
    if settled is not None and settled.status == VerificationStatus.APPROVED and settled.is_current:
        return {
            "policy_version": evidence_policy.POLICY_VERSION,
            "state": ConditionState.VERIFIED,
            "state_label": CONDITION_STATE_LABELS[ConditionState.VERIFIED],
            "editable": False,
            "status": VerificationStatus.APPROVED,
            "verification_id": str(settled.id),
            "submitted": True,
            "decision_note": settled.decision_note,
            "required_total": sum(1 for slot in slots if slot.required),
            "required_outstanding": 0,
            "can_submit": False,
            # No slots: there is nothing left to ask for, and listing them again
            # is what made an approved property look like an unstarted one.
            "slots": [],
            "outstanding": [],
        }

    review = current_review(subject)

    filled: dict[str, object] = {}
    if review is not None:
        for evidence in review.evidence.select_related("file"):
            key = _slot_of(evidence)
            if key:
                filled[key] = evidence

    outstanding = _missing_required(review, slots)
    required_total = sum(1 for slot in slots if slot.required)
    state = lifecycle_state(subject, outstanding=len(outstanding))

    return {
        "policy_version": evidence_policy.POLICY_VERSION,
        "state": state,
        "state_label": CONDITION_STATE_LABELS[state],
        "editable": state in EDITABLE_STATES,
        "status": review.status if review else VerificationStatus.NOT_STARTED,
        "verification_id": str(review.id) if review else None,
        "submitted": bool(review and _is_queued(review)),
        "decision_note": review.decision_note if review else "",
        "required_total": required_total,
        "required_outstanding": len(outstanding),
        "can_submit": review is not None and not outstanding and not _is_queued(review),
        # Each slot says what is *in* it, not merely that something is. A
        # checklist that reports a boolean can offer no way to look at what was
        # uploaded or to take it back down.
        "slots": [
            {
                **evidence_policy.as_dict(slot),
                "provided": slot.key in filled,
                **_provided_detail(filled.get(slot.key)),
            }
            for slot in slots
        ],
        "outstanding": [evidence_policy.as_dict(slot) for slot in outstanding],
    }


def _is_queued(review: Verification) -> bool:
    """Whether a reviewer has already been asked to look at this."""
    return ReviewQueueEntry.objects.filter(verification=review).exists()


def assert_property_is_ready(subject) -> None:
    """A space waits for its property; a property waits for nothing.

    Scoped to spaces on purpose. Applying it to every subject would mean the
    property's own condition review required the property to be verified before
    it could be submitted — a precondition that can only be met by the thing it
    blocks, which is the deadlock `assert_may_review` was already once written
    into and had to be pulled back out of.
    """
    from .gates import can_submit_space_for_review

    subject_type, _, prop = _describe(subject)
    if subject_type != SubjectType.SPACE:
        return

    decision = can_submit_space_for_review(prop=prop)
    if not decision.allowed:
        # `enforce` composes the blockers into the message, so the refusal names
        # which review is outstanding rather than only that one is.
        enforce(decision)


@transaction.atomic
def withdraw_submission(*, subject, actor, reason: str = "") -> Verification:
    """Take a submission back before anyone has decided it.

    The inverse of :func:`submit_for_review`, and deliberately the smallest
    possible one: it removes the queue entry and touches nothing else. The
    verification stays open and its evidence stays attached, so the subject
    lands back exactly where it was before the send — `lifecycle_state` reads an
    open, unqueued review as `ready_for_submission`, editing reopens, and
    resubmitting is the same call it was the first time.

    Nothing is deleted that was decided, because nothing has been: the guard
    below refuses once a verdict exists. A withdrawal after a decision would be
    an attempt to unsay somebody else's answer.

    Allowed while a reviewer is holding it, not only while it is queued. They
    may have opened it a minute ago, and the provider's right to stop a
    submission about their own property outweighs a partial trip; the reviewer
    finds it gone, which is the correct outcome either way.
    """
    assert_may_review(subject=subject, user=actor)

    review = current_review(subject)
    if review is None:
        raise Conflict("There is nothing with our team to take back.")

    entry = ReviewQueueEntry.objects.filter(verification=review).first()
    if entry is None:
        raise Conflict("This has not been sent yet.")
    if entry.resolved_at is not None:
        raise Conflict(
            "This has already been decided. Read the outcome and send it again "
            "if you need to change something."
        )

    entry.delete()

    from apps.core.policy import record_transition

    subject_type, _, _ = _describe(subject)
    record_transition(
        action="withdraw",
        target_type="space" if subject_type == SubjectType.SPACE else "property",
        target=subject,
        actor=actor,
        reason=reason,
        previous="submitted",
        current="ready_for_submission",
        extra={"verification_id": str(review.id)},
    )
    return review


@transaction.atomic
def submit_for_review(*, subject, actor) -> Verification:
    """Ask for a decision. Refused while anything required is missing.

    This is the gate the brief asks for, and it is enforced here rather than in a
    serializer so that no caller can reach the queue around it. The refusal names
    the outstanding slots: "incomplete" tells somebody nothing they can act on.
    """
    assert_may_review(subject=subject, user=actor)
    assert_property_is_ready(subject)

    review = current_review(subject)
    if review is None:
        raise Conflict("Add the photos first — there is nothing to submit yet.")
    if _is_queued(review):
        raise Conflict("This is already with our team. We will let you know the outcome.")

    slots = slots_for(subject)
    outstanding = _missing_required(review, slots)

    if outstanding:
        missing = ", ".join(slot.label.lower() for slot in outstanding)
        raise ValidationFailed(f"Add {len(outstanding)} more before submitting: {missing}.")

    ReviewQueueEntry.objects.create(
        verification=review,
        priority=services.PRIORITY_BY_KIND.get(review.kind, 50),
    )
    return review
