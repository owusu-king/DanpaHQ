"""Verification: the trust domain.

The requirement from Phase 0 was that verification must never reduce to
``verified = true``. This is what that means concretely.

A **Verification** is a decision about one claim, of one kind, about one subject,
made by someone, at a time, on the strength of evidence, and valid until a date.
Every one of those words is a column. Missing any of them turns a check into a
rumour:

* no *kind* → "verified" means nothing in particular
* no *evidence* → the decision cannot be re-examined during a dispute
* no *decider* → nobody is accountable for a wrong approval
* no *expiry* → a two-year-old check is presented as a fact about today
* no *history* → a revoked verification looks the same as one that never existed

Re-checking never overwrites. It creates a new verification, and the old one
stays, superseded. What we believed in March and why must remain readable in
December.

The one thing this domain deliberately does not do is compute a trust score.
A single number hides which check passed and invites false confidence; the UI
shows the stamps themselves.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.core.ids import uuid7
from apps.core.models import BaseModel


class SubjectType(models.TextChoices):
    USER = "user", "Person"
    PROPERTY = "property", "Property"
    #: One rentable space inside a property. Verified separately from the
    #: building: authority over an address says nothing about whether a
    #: particular flat is as described, and the two are reviewed at different
    #: times by different evidence (see `trust.evidence_policy`).
    SPACE = "space", "Rentable space"
    PROVIDER_APPLICATION = "provider_application", "Property provider application"
    LISTING = "listing", "Listing"
    ORGANISATION = "organisation", "Organisation"


class VerificationKind(models.TextChoices):
    """What is being checked. Each kind has its own evidence expectations."""

    PHONE = "phone", "Phone number"
    IDENTITY = "identity", "Identity (Ghana Card)"
    SELFIE_MATCH = "selfie_match", "Face matches ID"
    ADDRESS = "address", "Residential address"
    AGENCY = "agency", "Agent licence or agency"
    COMPANY = "company", "Company registration"
    BANK_ACCOUNT = "bank_account", "Bank or mobile money account"
    OWNERSHIP = "ownership", "Property ownership"  # Phase 2 subject, defined here
    PROPERTY_AUTHORITY = "property_authority", "Authority to list a property"
    #: Is the building what they say it is? Answered by photographs, and kept
    #: apart from PROPERTY_AUTHORITY — which asks whether this person may let it
    #: at all — because the two are decided at different times by reviewers
    #: looking for different things. Merged, adding a room would mean producing
    #: the title deed again.
    PROPERTY_CONDITION = "property_condition", "Property is as described"
    #: The same question one level down. Distinct from PROPERTY_AUTHORITY, which
    #: asks whether this person may let the building at all.
    SPACE_CONDITION = "space_condition", "Rentable space is as described"
    #: About the person, not any property: may this account operate as a
    #: provider at all. Answering it per property was the mistake ADR 0019
    #: corrects — a provider is approved once and then claims properties, each
    #: of which is reviewed separately under PROPERTY_AUTHORITY.
    PROVIDER = "provider", "Approved to operate as a property provider"


class VerificationStatus(models.TextChoices):
    NOT_STARTED = "not_started", "Not started"
    PENDING = "pending", "Awaiting review"
    NEEDS_MORE = "needs_more_info", "More information needed"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    EXPIRED = "expired", "Expired"
    REVOKED = "revoked", "Revoked"
    SUPERSEDED = "superseded", "Superseded by a newer check"


class VerificationMethod(models.TextChoices):
    AUTOMATED_OTP = "automated_otp", "One-time code"
    DOCUMENT_REVIEW = "document_review", "Reviewed document"
    PROVIDER_API = "provider_api", "Checked with an authority"
    SITE_VISIT = "site_visit", "Visited in person"
    MANUAL_OVERRIDE = "manual_override", "Manual decision"


#: How long each kind stays meaningful. A phone check ages because numbers are
#: reassigned; an identity check ages because documents expire and faces change;
#: an agency licence ages because licences lapse. None means it does not expire
#: on its own, only on revocation.
VALIDITY_DAYS: dict[str, int | None] = {
    VerificationKind.PHONE: 365,
    VerificationKind.IDENTITY: 730,
    VerificationKind.SELFIE_MATCH: 365,
    VerificationKind.ADDRESS: 365,
    VerificationKind.AGENCY: 365,
    VerificationKind.COMPANY: 365,
    VerificationKind.BANK_ACCOUNT: 365,
    VerificationKind.OWNERSHIP: None,
    VerificationKind.PROPERTY_AUTHORITY: 365,
    # Condition checks do not lapse on a timer. What a building looks like does
    # change, but it changes when something happens to it — not on an
    # anniversary — and expiring the check would quietly pull a live listing
    # while the property is exactly as it was photographed. Re-checking is
    # triggered by an edit or by a report, both of which supersede.
    #
    # Stated rather than omitted: every other kind is listed here, and an
    # absence reads as an oversight instead of a decision.
    VerificationKind.PROPERTY_CONDITION: None,
    VerificationKind.SPACE_CONDITION: None,
    # Deliberately not time-limited. Silently expiring a provider would lock a
    # working landlord out of their own tenancies on an anniversary they were
    # never told about. It ends by revocation, which is a decision someone makes
    # and has to record a reason for.
    VerificationKind.PROVIDER: None,
}


class VerificationQuerySet(models.QuerySet):
    def current(self):
        """Approved and not past its expiry."""
        now = timezone.now()
        return self.filter(status=VerificationStatus.APPROVED).filter(
            models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=now)
        )

    def for_subject(self, subject_type: str, subject_id) -> VerificationQuerySet:
        return self.filter(subject_type=subject_type, subject_id=str(subject_id))


class Verification(BaseModel):
    subject_type = models.CharField(max_length=20, choices=SubjectType.choices)
    subject_id = models.CharField(max_length=64)

    kind = models.CharField(max_length=24, choices=VerificationKind.choices)
    status = models.CharField(
        max_length=20, choices=VerificationStatus.choices, default=VerificationStatus.PENDING
    )
    method = models.CharField(max_length=24, choices=VerificationMethod.choices)

    submitted_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="verifications_submitted",
    )
    #: Null for automated decisions. Recording "system" as a person would be a lie.
    decided_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="verifications_decided",
    )
    decided_by_management_id = models.UUIDField(null=True, blank=True, db_index=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)

    #: Shown to the person. Must say what to do next, not just what was wrong.
    decision_note = models.TextField(blank=True, max_length=600)
    #: Reviewer-only. Never leaves the admin.
    internal_note = models.TextField(blank=True)

    #: What the provider or authority answered, kept verbatim for disputes.
    provider = models.CharField(max_length=40, blank=True)
    provider_reference = models.CharField(max_length=120, blank=True)
    provider_response = models.JSONField(default=dict, blank=True)

    supersedes = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="superseded_by"
    )

    objects = models.Manager.from_queryset(VerificationQuerySet)()

    class Meta:
        db_table = "trust_verification"
        ordering = ("-created_at",)
        indexes = [
            models.Index(
                fields=["subject_type", "subject_id", "kind", "-created_at"],
                name="verification_subject_idx",
            ),
            models.Index(
                fields=["status", "-created_at"],
                name="verification_queue_idx",
                condition=models.Q(status__in=["pending", "needs_more_info"]),
            ),
            models.Index(
                fields=["expires_at"],
                name="verification_expiry_idx",
                condition=models.Q(status="approved", expires_at__isnull=False),
            ),
        ]
        constraints = [
            # At most one live verification per subject and kind. Two approved
            # identity checks on one person means the UI has to guess which is
            # true, and the guess will be wrong at the worst moment.
            models.UniqueConstraint(
                fields=["subject_type", "subject_id", "kind"],
                condition=models.Q(status__in=["pending", "needs_more_info", "approved"]),
                name="trust_one_live_verification",
            )
        ]

    def __str__(self) -> str:
        return (
            f"{self.get_kind_display()} for {self.subject_type}:{self.subject_id} ({self.status})"
        )

    @property
    def is_current(self) -> bool:
        if self.status != VerificationStatus.APPROVED:
            return False
        return self.expires_at is None or self.expires_at > timezone.now()

    @property
    def display_state(self) -> str:
        """The four states the Stamp component renders.

        Expiry is computed here rather than trusted from ``status``, because a
        row only becomes ``expired`` when the sweep job runs, and a stamp must
        never claim currency it does not have between sweeps.
        """
        if self.status == VerificationStatus.APPROVED:
            return "verified" if self.is_current else "expired"
        if self.status in (VerificationStatus.PENDING, VerificationStatus.NEEDS_MORE):
            return "pending"
        return "unverified"


class EvidenceType(models.TextChoices):
    GHANA_CARD_FRONT = "ghana_card_front", "Ghana Card (front)"
    GHANA_CARD_BACK = "ghana_card_back", "Ghana Card (back)"
    PASSPORT = "passport", "Passport"
    DRIVERS_LICENCE = "drivers_licence", "Driver's licence"
    SELFIE = "selfie", "Selfie"
    UTILITY_BILL = "utility_bill", "Utility bill"
    TENANCY_AGREEMENT = "tenancy_agreement", "Tenancy agreement"
    BUSINESS_CERTIFICATE = "business_certificate", "Business certificate"
    AGENCY_LICENCE = "agency_licence", "Agency licence"
    OWNERSHIP_DOCUMENT = "ownership_document", "Ownership document"
    AUTHORIZATION_LETTER = "authorization_letter", "Owner authorization"
    MANAGEMENT_AGREEMENT = "management_agreement", "Property management agreement"
    PROVIDER_RESPONSE = "provider_response", "Response from an authority"
    OTP_CONFIRMATION = "otp_confirmation", "One-time code confirmation"

    # --- what the place actually is ------------------------------------------
    #
    # Everything above proves a *right* — that this person may let this
    # property. These show the property itself, which is a different question
    # answered by different artefacts. A reviewer confirming authority reads a
    # deed; a reviewer confirming a listing is honest looks at rooms.
    #
    # Kept in one enum because they are all evidence attached to a
    # verification, and splitting the table would mean two of everything for a
    # distinction the policy already draws.

    # The three a property is always asked for. Named individually rather than
    # collected as three anonymous "exterior" uploads, because a reviewer
    # checking that a building exists at an address needs to know which side
    # they are looking at — and a provider who sends the same wall three times
    # should be told which two are still missing.
    PROPERTY_FRONT = "property_front", "Front of the property"
    PROPERTY_SIDE = "property_side", "Side of the property"
    PROPERTY_SURROUNDINGS = "property_surroundings", "The surrounding area"

    #: Superseded by `PROPERTY_FRONT`, kept because evidence already collected
    #: under it is still valid evidence. Accepted in its place, never asked for.
    EXTERIOR = "exterior", "Outside of the building"
    COMPOUND = "compound", "Compound or grounds"
    INTERIOR_OVERVIEW = "interior_overview", "Inside, general view"
    #: The two a rentable space is asked for alongside its interior view.
    SPACE_ENTRANCE = "space_entrance", "Entrance to the space"
    SPACE_ADDITIONAL = "space_additional", "Another view of the space"
    PLOT_BOUNDARY = "plot_boundary", "The plot boundary"
    BEDROOM = "bedroom", "Bedroom"
    BATHROOM = "bathroom", "Bathroom or washroom"
    KITCHEN = "kitchen", "Kitchen"
    LIVING_AREA = "living_area", "Living area"
    BALCONY = "balcony", "Balcony"
    SLEEPING_ARRANGEMENT = "sleeping_arrangement", "Sleeping arrangement"
    BED_SPACE_VIEW = "bed_space_view", "The bed space"
    STOREFRONT = "storefront", "Shopfront"
    COMMERCIAL_SURROUNDINGS = "commercial_surroundings", "Surrounding commercial area"
    WATER_SOURCE_VIEW = "water_source_view", "Water source"
    POWER_METER_VIEW = "power_meter_view", "Electricity meter"
    LOCATION_CONTEXT = "location_context", "Where it sits — street or landmark"


class VerificationEvidence(BaseModel):
    """One artefact supporting one verification.

    Evidence is never edited and never deleted while its verification stands. A
    correction is a new verification with new evidence; the previous decision and
    what it rested on remain readable.

    ``checksum`` is copied from the file at attach time, so a dispute can
    establish that the document shown today is the document reviewed in March.
    """

    verification = models.ForeignKey(
        Verification, on_delete=models.CASCADE, related_name="evidence"
    )
    evidence_type = models.CharField(max_length=32, choices=EvidenceType.choices)

    file = models.ForeignKey(
        "files.StoredFile", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    #: For non-file evidence: a provider reference, a challenge id, a case number.
    reference = models.CharField(max_length=200, blank=True)
    checksum_at_attach = models.CharField(max_length=64, blank=True)

    collected_at = models.DateTimeField(default=timezone.now)
    collected_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    notes = models.TextField(blank=True, max_length=600)

    class Meta:
        db_table = "trust_verification_evidence"
        ordering = ("collected_at",)
        indexes = [models.Index(fields=["verification"], name="evidence_verification_idx")]

    def __str__(self) -> str:
        return f"{self.get_evidence_type_display()} for {self.verification_id}"

    def delete(self, *args, **kwargs):
        raise RuntimeError(
            "Evidence is not deleted. Supersede the verification instead so the "
            "history of what was decided, and on what basis, survives. The one "
            "exception is `trust.condition.detach`, which withdraws a photograph "
            "from a review that is still open and has never been queued — where "
            "there is no decision yet for the history to protect."
        )


class ReviewQueueEntry(models.Model):
    """Work waiting for a human reviewer.

    A separate table rather than a query over verifications, because a queue has
    its own concerns: who claimed an item, when the claim goes stale, and how
    long people have waited. Claiming is what stops two reviewers deciding the
    same case differently.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    verification = models.OneToOneField(
        Verification, on_delete=models.CASCADE, related_name="queue_entry"
    )

    priority = models.PositiveSmallIntegerField(
        default=50, help_text="Lower is more urgent. Agents and landlords outrank tenants."
    )
    claimed_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="claimed_reviews",
    )
    claimed_by_management_id = models.UUIDField(null=True, blank=True, db_index=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    #: Claims expire so an item cannot be lost because a reviewer closed their laptop.
    claim_expires_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "trust_review_queue"
        ordering = ("priority", "created_at")
        indexes = [
            models.Index(
                fields=["priority", "created_at"],
                name="review_open_idx",
                condition=models.Q(resolved_at__isnull=True),
            )
        ]

    def __str__(self) -> str:
        # How long it has waited is the thing a reviewer looking at a queue
        # needs from the label, so it is in the label.
        return f"{self.verification} — waiting {self.waiting_hours:.0f}h"

    @property
    def is_claimable(self) -> bool:
        if self.resolved_at is not None:
            return False
        if self.claimed_at is None:
            return True
        return self.claim_expires_at is not None and self.claim_expires_at <= timezone.now()

    @property
    def waiting_hours(self) -> float:
        end = self.resolved_at or timezone.now()
        return (end - self.created_at).total_seconds() / 3600
