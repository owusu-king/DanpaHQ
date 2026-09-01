"""Rental applications — a tenant formally asking for a place.

What a Ghanaian landlord actually decides on is narrower than the forms used in
other markets, and pretending otherwise produces a form nobody finishes:

* **Can they raise the advance?** A listing asking twelve months and a tenant
  who can find six is not a negotiation, it is a mismatch, and both sides
  should see it in the first second rather than after two viewings. The
  shortfall is computed and shown to both.
* **Who will vouch for them?** A guarantor is normal here and is often what the
  decision turns on. It is a first-class field, not a note.
* **Income is banded and self-declared.** Much work in this market is informal.
  An exact salary figure invites a fabricated one; a band is closer to honest
  and is what a landlord reasons with anyway.

Everything the tenant states is a *claim*, snapshotted at submission. Profiles
change, and a landlord defending a decision months later needs to see what was
in front of them at the time, not what the tenant's profile says today.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import PhoneNumberField
from apps.core.models import BaseModel


class ApplicationStatus(models.TextChoices):
    SUBMITTED = "submitted", "Submitted"
    UNDER_REVIEW = "under_review", "Being considered"
    ACCEPTED = "accepted", "Accepted"
    REJECTED = "rejected", "Not accepted"
    WITHDRAWN = "withdrawn", "Withdrawn by the applicant"


OPEN_STATUSES = (ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW)
# An accepted application has left the review queue, but it still represents
# the tenant's live acquisition of this Unit.  A second application must not be
# opened simply because the first one has advanced to lease preparation.
BLOCKING_STATUSES = (*OPEN_STATUSES, ApplicationStatus.ACCEPTED)


class RentalApplication(BaseModel):
    listing = models.ForeignKey(
        "listing.Listing", on_delete=models.PROTECT, related_name="applications"
    )
    # The Unit is the thing being applied for.  Keep the listing as the frozen
    # campaign/terms source, but key duplicate protection on the underlying
    # Unit so withdrawing and recreating a listing cannot reopen the gate.
    unit = models.ForeignKey(
        "property.Unit", on_delete=models.PROTECT, related_name="rental_applications"
    )
    tenant = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="applications"
    )
    status = models.CharField(
        max_length=20, choices=ApplicationStatus.choices, default=ApplicationStatus.SUBMITTED
    )

    # --- what the tenant is offering -----------------------------------------
    move_in_from = models.DateField(null=True, blank=True)
    household_size = models.PositiveSmallIntegerField(null=True, blank=True)
    #: The decisive number in this market. Compared against the listing's
    #: advance_months to produce the shortfall both sides see.
    advance_months_offered = models.PositiveSmallIntegerField(default=0)
    message = models.TextField(blank=True, max_length=1000)

    # --- claims, snapshotted at submission -----------------------------------
    occupation = models.CharField(max_length=120, blank=True)
    employer = models.CharField(max_length=160, blank=True)
    income_band = models.CharField(max_length=24, blank=True)

    # --- guarantor -----------------------------------------------------------
    guarantor_name = models.CharField(max_length=160, blank=True)
    guarantor_phone = PhoneNumberField(blank=True)
    guarantor_relationship = models.CharField(max_length=60, blank=True)

    # --- decision ------------------------------------------------------------
    decided_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="applications_decided",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    #: Shown to the applicant. A rejection that says nothing teaches nobody
    #: anything, and this market runs on word of mouth.
    decision_note = models.CharField(max_length=300, blank=True)

    withdrawn_at = models.DateTimeField(null=True, blank=True)

    # Earlier builds allowed multiple current applications for one tenant and
    # Unit.  Preserve those rows and their decisions, but identify the one
    # authoritative record rather than deleting history or inventing a
    # withdrawal that never happened.
    superseded_by = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="superseded_applications",
    )

    #: When the acquisition this application produced came to an end.
    #:
    #: `status` stays `accepted` — it was accepted, and rewriting that would be
    #: rewriting history. But an accepted application only speaks for a *live*
    #: claim on the Unit, and once the agreement it became is declined,
    #: cancelled or ended, it is a record rather than a claim.
    #:
    #: Without this, "accepted" blocked forever: a tenant who rented a place,
    #: moved out, and came back to it a year later was told they had already
    #: applied, by their own finished tenancy, with no way round it.
    concluded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "application_rental"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "tenant"],
                # One *current* application per Unit per tenant. `status` alone
                # was standing in for "current" and got it wrong at the end of a
                # tenancy, so the thing being asserted is now stated.
                condition=models.Q(
                    status__in=["submitted", "under_review", "accepted"],
                    superseded_by__isnull=True,
                    concluded_at__isnull=True,
                ),
                name="app_one_current_per_unit",
            )
        ]
        indexes = [
            models.Index(
                fields=["listing", "status", "-created_at"], name="application_listing_idx"
            ),
            models.Index(fields=["tenant", "-created_at"], name="application_tenant_idx"),
            models.Index(
                fields=["status", "-created_at"],
                name="application_open_idx",
                condition=models.Q(status__in=["submitted", "under_review"]),
            ),
        ]

    def __str__(self) -> str:
        return f"application for {self.listing_id} by {self.tenant_id} ({self.status})"

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES

    @property
    def advance_shortfall_months(self) -> int:
        """How far short of the asking advance this applicant is.

        Zero means they can meet it. A positive number is the single most useful
        fact on the whole application, for either side.
        """
        asked = self.listing.advance_months or 0
        return max(asked - (self.advance_months_offered or 0), 0)

    @property
    def meets_advance(self) -> bool:
        return self.advance_shortfall_months == 0
