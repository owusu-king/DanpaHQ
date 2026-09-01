"""Where a property's verification stands, as one provider-facing answer.

A property carries **two** reviews, and they are genuinely different questions:

* `PROPERTY_AUTHORITY` — may this person let this building at all, answered by a
  document, and filed against a `PropertyProviderApplication`.
* `PROPERTY_CONDITION` — is the building what they say it is, answered by
  photographs, and filed against the property itself.

Keeping the evidence checks apart is right and stays. They are not separate
property approvals. The submission package exposes one ``review_state`` and a
reviewer decides both checks in one transaction. A *screen* cannot decide what
to offer from two half-answers — which is exactly how the
property page came to show "Continue with property details" to a provider whose
property had been rejected, and again to one whose property had been approved.

`authority_state` could not have told it either. That field collapses through
`Verification.display_state`, which has four values, so `REJECTED` and `REVOKED`
both arrive as `unverified` — indistinguishable from never having started. The
page was not ignoring the state; the state it was given did not contain the
distinction.

### The combining rule

Worst outcome wins, because the worst outcome is the one with something to do
about it. A property whose document was rejected and whose photographs are fine
is a rejected property, and telling somebody their photos are done is not the
sentence they need.

```
suspended  →  rejected  →  changes_requested  →  expired
    →  submitted / under_review  →  verified  →  ready_for_submission  →  draft
```

Nothing here is stored. Every value is derived from records the domain already
keeps for its own reasons, so there is no fifth thing to hold in step — the same
rule `propertySetup` follows on the clients.
"""

from __future__ import annotations

from dataclasses import dataclass

# `apps.trust` is imported inside the functions below, not here. Domain modules
# do not import each other's models at module level — `tests/unit/
# test_module_boundaries.py` enforces it, and the reason is that a module-level
# edge makes the dependency permanent and circular the moment trust needs
# anything back.


class PropertyVerificationState:
    """Detailed setup/review state retained for compatible workflow routing."""

    #: Setup is unfinished — something required has not been provided yet.
    DRAFT = "draft"
    #: Everything required is here and nobody has sent it.
    READY = "ready_for_submission"
    #: Sent, and nobody has picked it up.
    SUBMITTED = "submitted"
    #: A reviewer is holding it right now.
    UNDER_REVIEW = "under_review"
    #: Both reviews passed.
    VERIFIED = "verified"
    #: A reviewer asked for something else before they can decide.
    CHANGES_REQUESTED = "changes_requested"
    #: A reviewer said no.
    REJECTED = "rejected"
    #: An approval was taken away after the fact.
    SUSPENDED = "suspended"
    #: An approval aged out.
    EXPIRED = "expired"


class PropertyReviewState:
    """The only provider-facing property-verification lifecycle."""

    NOT_SUBMITTED = "not_submitted"
    PENDING_VERIFICATION = "pending_verification"
    VERIFIED = "verified"
    WITHDRAWN = "withdrawn"
    CHANGES_REQUIRED = "changes_required"
    REJECTED = "rejected"
    SUSPENDED = "suspended"
    EXPIRED = "expired"


REVIEW_LABELS: dict[str, str] = {
    PropertyReviewState.NOT_SUBMITTED: "Not submitted",
    PropertyReviewState.PENDING_VERIFICATION: "Pending verification",
    PropertyReviewState.VERIFIED: "Verified",
    PropertyReviewState.WITHDRAWN: "Withdrawn",
    PropertyReviewState.CHANGES_REQUIRED: "Changes required",
    PropertyReviewState.REJECTED: "Rejected",
    PropertyReviewState.SUSPENDED: "Verification suspended",
    PropertyReviewState.EXPIRED: "Verification expired",
}


LABELS: dict[str, str] = {
    PropertyVerificationState.DRAFT: "Setup in progress",
    # Not "ready to send". The property is *finished* — the provider may run it
    # privately for as long as they like, and sending it is a decision they have
    # not made rather than a task they have not done.
    PropertyVerificationState.READY: "Created, not submitted",
    PropertyVerificationState.SUBMITTED: "Pending verification",
    PropertyVerificationState.UNDER_REVIEW: "Under review",
    PropertyVerificationState.VERIFIED: "Verified property",
    PropertyVerificationState.CHANGES_REQUESTED: "Changes requested",
    PropertyVerificationState.REJECTED: "Not approved",
    PropertyVerificationState.SUSPENDED: "Verification withdrawn",
    PropertyVerificationState.EXPIRED: "Verification expired",
}

#: States in which the provider is still assembling, and everything is editable.
OPEN_STATES = frozenset(
    {
        PropertyVerificationState.DRAFT,
        PropertyVerificationState.READY,
        PropertyVerificationState.CHANGES_REQUESTED,
        PropertyVerificationState.REJECTED,
        PropertyVerificationState.EXPIRED,
    }
)

#: States in which somebody else is holding it and nothing may change under them.
WITH_REVIEWER = frozenset(
    {PropertyVerificationState.SUBMITTED, PropertyVerificationState.UNDER_REVIEW}
)


@dataclass(frozen=True)
class Half:
    """One of the two reviews, reduced to what the page needs from it."""

    state: str
    decided_at: object = None
    submitted_at: object = None
    note: str = ""


def application_for(prop):
    """The Property submission envelope, using the collection preparation."""
    if hasattr(prop, "_property_list_provider_application"):
        return prop._property_list_provider_application

    from .models import PropertyProviderApplication

    return PropertyProviderApplication.objects.filter(property=prop).first()


def _authority(prop) -> Half:
    """The document review, which lives on the application rather than here."""
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationStatus,
    )

    from .models import ProviderApplicationStatus

    prepared = getattr(prop, "_property_list_verifications", None)
    if prepared is None:
        approved = (
            Verification.objects.current()
            .for_subject(SubjectType.PROPERTY, prop.id)
            .filter(kind=VerificationKind.PROPERTY_AUTHORITY)
            .order_by("-decided_at")
            .first()
        )
    else:
        approved = next(
            (
                row
                for row in prepared
                if row.kind == VerificationKind.PROPERTY_AUTHORITY and row.is_current
            ),
            None,
        )
    if approved is not None:
        return Half(PropertyVerificationState.VERIFIED, decided_at=approved.decided_at)

    if prepared is None:
        revoked = (
            Verification.objects.for_subject(SubjectType.PROPERTY, prop.id)
            .filter(kind=VerificationKind.PROPERTY_AUTHORITY)
            .exclude(status=VerificationStatus.SUPERSEDED)
            .order_by("-decided_at", "-created_at")
            .first()
        )
    else:
        candidates = [
            row
            for row in prepared
            if row.kind == VerificationKind.PROPERTY_AUTHORITY
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
        revoked = candidates[0] if candidates else None
    if revoked is not None and revoked.status == VerificationStatus.REVOKED:
        return Half(
            PropertyVerificationState.SUSPENDED,
            decided_at=revoked.decided_at,
            note=revoked.decision_note,
        )
    if revoked is not None and revoked.status == VerificationStatus.EXPIRED:
        return Half(PropertyVerificationState.EXPIRED, decided_at=revoked.decided_at)

    application = application_for(prop)
    if application is None:
        return Half(PropertyVerificationState.DRAFT)

    by_status = {
        # Recorded during creation and not yet sent. This is the state the whole
        # creation/submission split turns on: the document is *held*, the way
        # photographs are held, and nobody has been asked to read it.
        ProviderApplicationStatus.DRAFT: PropertyVerificationState.READY,
        # Withdrawal is a review outcome, not loss of the saved document. The
        # detailed setup state therefore remains ready while `review_state`
        # below reports the authoritative provider-facing word.
        ProviderApplicationStatus.WITHDRAWN: PropertyVerificationState.READY,
        ProviderApplicationStatus.PENDING_REVIEW: PropertyVerificationState.SUBMITTED,
        ProviderApplicationStatus.NEEDS_MORE: PropertyVerificationState.CHANGES_REQUESTED,
        ProviderApplicationStatus.REJECTED: PropertyVerificationState.REJECTED,
        ProviderApplicationStatus.SUSPENDED: PropertyVerificationState.SUSPENDED,
        ProviderApplicationStatus.EXPIRED: PropertyVerificationState.EXPIRED,
        ProviderApplicationStatus.APPROVED: PropertyVerificationState.VERIFIED,
    }
    return Half(
        by_status.get(application.status, PropertyVerificationState.DRAFT),
        decided_at=application.reviewed_at,
        submitted_at=application.submitted_at,
        note=application.decision_note,
    )


def _condition(prop) -> Half:
    """The photograph review, which `trust.condition` already reduces for us."""
    from apps.trust import condition

    snapshot = condition.snapshot(prop)
    settled = condition.settled_review(prop)
    review = condition.current_review(prop)

    # When it was *sent*, not when it was opened.
    #
    # A condition review opens on the first photograph, so reading its
    # `created_at` reported a submission date for a property that had never been
    # submitted — the page would tell somebody mid-creation "Sent on 20 August".
    # The queue entry is the thing that means "with our team".
    queue_entry = condition.queue_entry_for(review)
    queued = queue_entry.created_at if queue_entry is not None else None

    return Half(
        snapshot["state"],
        decided_at=settled.decided_at if settled is not None else None,
        submitted_at=queued,
        note=snapshot["decision_note"],
    )


#: Worst first. The page shows the state with something to act on.
_PRECEDENCE = [
    PropertyVerificationState.SUSPENDED,
    PropertyVerificationState.REJECTED,
    PropertyVerificationState.CHANGES_REQUESTED,
    PropertyVerificationState.EXPIRED,
    PropertyVerificationState.DRAFT,
    PropertyVerificationState.SUBMITTED,
    PropertyVerificationState.UNDER_REVIEW,
    PropertyVerificationState.READY,
    PropertyVerificationState.VERIFIED,
]


def lifecycle(prop) -> dict:
    """One property result plus internal package details.

    ``review_state`` is authoritative for provider status and actions. ``state``
    remains the more detailed setup/router value for installed clients. The
    internal checks remain available for package completeness and targeted
    feedback, not as independent property outcomes.

    Four of the six property policies read this, and the serializer reads it
    again for its own field, so a listing computed the same answer five times a
    row. Memoized only inside a declared read — see `apps.core.memo`.
    """
    from apps.core.memo import cached

    return cached(("property.lifecycle", prop.pk), lambda: _lifecycle(prop))


def _lifecycle(prop) -> dict:
    authority = _authority(prop)
    photos = _condition(prop)

    # `draft` on the authority half means no claim exists yet, which is a real
    # thing to do rather than a bad outcome — so it ranks below the verdicts but
    # above "everything is fine", or a property with no claim and finished
    # photographs would read as ready when it is not.
    order = {state: index for index, state in enumerate(_PRECEDENCE)}
    ranked = sorted(
        [authority, photos],
        key=lambda half: order.get(half.state, len(_PRECEDENCE)),
    )
    worst = ranked[0]

    state = worst.state
    if state == PropertyVerificationState.DRAFT and photos.state in {
        PropertyVerificationState.READY,
        PropertyVerificationState.VERIFIED,
    }:
        # Photographs finished, no claim yet: still draft, and the page will say
        # which half is outstanding from the halves below.
        state = PropertyVerificationState.DRAFT

    review_state = {
        PropertyVerificationState.DRAFT: PropertyReviewState.NOT_SUBMITTED,
        PropertyVerificationState.READY: PropertyReviewState.NOT_SUBMITTED,
        PropertyVerificationState.SUBMITTED: PropertyReviewState.PENDING_VERIFICATION,
        PropertyVerificationState.UNDER_REVIEW: PropertyReviewState.PENDING_VERIFICATION,
        PropertyVerificationState.VERIFIED: PropertyReviewState.VERIFIED,
        PropertyVerificationState.CHANGES_REQUESTED: PropertyReviewState.CHANGES_REQUIRED,
        PropertyVerificationState.REJECTED: PropertyReviewState.REJECTED,
        PropertyVerificationState.SUSPENDED: PropertyReviewState.SUSPENDED,
        PropertyVerificationState.EXPIRED: PropertyReviewState.EXPIRED,
    }[state]
    from .models import ProviderApplicationStatus

    application = application_for(prop)
    if application is not None and application.status == ProviderApplicationStatus.WITHDRAWN:
        review_state = PropertyReviewState.WITHDRAWN

    return {
        "state": state,
        "state_label": LABELS.get(state, state),
        "review_state": review_state,
        "review_state_label": REVIEW_LABELS[review_state],
        "editable": state in OPEN_STATES,
        "with_reviewer": state in WITH_REVIEWER,
        "submitted_at": authority.submitted_at or photos.submitted_at,
        "decided_at": worst.decided_at,
        "decision_note": worst.note or authority.note or photos.note,
        "authority": {
            "state": authority.state,
            "state_label": LABELS.get(authority.state, authority.state),
            "decided_at": authority.decided_at,
            "note": authority.note,
        },
        "photos": {
            "state": photos.state,
            "state_label": LABELS.get(photos.state, photos.state),
            "decided_at": photos.decided_at,
            "note": photos.note,
        },
    }
