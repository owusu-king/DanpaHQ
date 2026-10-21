"""Artisans — tradespeople who quote for and take on work through Danpa HQ.

An artisan is an existing account with an approved application, not a second
account and not a separate app. What this module owns is the part that is
theirs alone: the trades they work in, where they work, examples of their work
and the certificates they choose to show.

### What decides what

* **Whether they may work here at all** is a trust verification of kind
  ``ARTISAN`` on the person, reviewed in the same queue as provider standing.
  Its status *is* the application's status; nothing here copies it.
* **Suspension** is Management pausing an approved artisan. It is a field on the
  profile rather than a verification outcome because it is meant to be lifted:
  it blocks new quotes and new assignments, and leaves every existing record
  and the artisan's own access to it exactly where it was.

### What deliberately is not here

Scores, rankings, "trusted" or "guaranteed" labels. Danpa HQ connects people
and keeps the record; the profile states facts — ID checked, certificates and
their status, jobs completed here, reviews — and lets the reader decide.
"""

from __future__ import annotations

from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone

from apps.core.fields import MoneyField
from apps.core.models import BaseModel


class Trade(models.TextChoices):
    PLUMBING = "plumbing", "Plumbing"
    ELECTRICAL = "electrical", "Electrical"
    CARPENTRY = "carpentry", "Carpentry"
    MASONRY = "masonry", "Masonry and building"
    PAINTING = "painting", "Painting"
    TILING = "tiling", "Tiling"
    ROOFING = "roofing", "Roofing"
    WELDING = "welding", "Welding and metalwork"
    AIR_CONDITIONING = "air_conditioning", "Air conditioning and fridges"
    APPLIANCE_REPAIR = "appliance_repair", "Appliance repair"
    LOCKSMITH = "locksmith", "Locks and security"
    PEST_CONTROL = "pest_control", "Pest control"
    CLEANING = "cleaning", "Cleaning"
    FURNITURE = "furniture", "Furniture making and assembly"
    GARDENING = "gardening", "Gardening and compound"


#: How many examples of their work an application carries. One is enough to
#: show a reviewer something real; past eight a phone on metered data pays for
#: photographs nobody scrolls to.
MIN_PORTFOLIO_PHOTOS = 1
MAX_PORTFOLIO_PHOTOS = 8
MAX_SERVICE_DISTRICTS = 10
MAX_CERTIFICATES = 6


class ArtisanProfile(BaseModel):
    user = models.OneToOneField(
        "identity.User", on_delete=models.PROTECT, related_name="artisan_profile"
    )
    trades = ArrayField(models.CharField(max_length=24, choices=Trade.choices), default=list)
    #: Where they will travel to work. Districts rather than neighbourhoods: a
    #: plumber covers an area, and the government's own districts are the
    #: hierarchy everything else in Danpa HQ files addresses under.
    districts = models.ManyToManyField("geo.District", related_name="artisans", blank=True)
    bio = models.TextField(max_length=600, blank=True)

    suspended_at = models.DateTimeField(null=True, blank=True)
    #: Shown to the artisan, so it says what happened and what to do next.
    suspended_reason = models.CharField(max_length=300, blank=True)
    #: Management principals are not identity users; see `trust.Verification`.
    suspended_by_management_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = "artisan_profile"
        indexes = [
            models.Index(
                fields=["suspended_at"],
                name="artisan_suspended_idx",
                condition=models.Q(suspended_at__isnull=False),
            ),
        ]

    def __str__(self) -> str:
        return f"artisan {self.user_id}"

    @property
    def is_suspended(self) -> bool:
        return self.suspended_at is not None


class ArtisanPortfolioPhoto(BaseModel):
    profile = models.ForeignKey(ArtisanProfile, on_delete=models.CASCADE, related_name="portfolio")
    file = models.ForeignKey("files.StoredFile", on_delete=models.PROTECT, related_name="+")
    caption = models.CharField(max_length=140, blank=True)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "artisan_portfolio_photo"
        ordering = ("position", "created_at")


class CertificateStatus(models.TextChoices):
    #: On file, and nobody at Danpa HQ has checked it yet.
    PROVIDED = "provided", "Certificate provided"
    VERIFIED = "verified", "Verified"
    EXPIRED = "expired", "Expired"
    #: Management looked and could not accept it. Never shown to customers;
    #: the artisan reads why.
    DECLINED = "declined", "Not accepted"


class ArtisanCertificate(BaseModel):
    """A certificate an artisan chose to show. Optional for every trade.

    Its status is read from its dates rather than stored, so an expired
    certificate loses its badge the day it expires — there is no sweep to miss.
    """

    profile = models.ForeignKey(
        ArtisanProfile, on_delete=models.CASCADE, related_name="certificates"
    )
    trade = models.CharField(max_length=24, choices=Trade.choices)
    file = models.ForeignKey("files.StoredFile", on_delete=models.PROTECT, related_name="+")
    issuing_body = models.CharField(max_length=160)
    expires_on = models.DateField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by_management_id = models.UUIDField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)
    #: Shown to the artisan, so it says what to do next.
    decision_note = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = "artisan_certificate"
        ordering = ("created_at",)
        indexes = [
            models.Index(
                fields=["created_at"],
                name="artisan_cert_unchecked_idx",
                condition=models.Q(verified_at__isnull=True, declined_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_trade_display()} certificate from {self.issuing_body}"

    @property
    def status(self) -> str:
        if self.declined_at is not None:
            return CertificateStatus.DECLINED
        if self.expires_on is not None and self.expires_on < timezone.localdate():
            return CertificateStatus.EXPIRED
        if self.verified_at is not None:
            return CertificateStatus.VERIFIED
        return CertificateStatus.PROVIDED


# --- quotes ------------------------------------------------------------------------
#
# An artisan job is not a record of its own. It is an assignment on an existing
# maintenance request, which stays the single source of truth for status,
# photographs and history. What lives here is only what maintenance has no
# place for: who was asked to quote, and what each quote said.


class QuoteInvitation(BaseModel):
    """One artisan asked to quote for one maintenance request.

    A tenant may *suggest* an artisan (``suggested_by``, no ``invited_at``); it
    becomes an invitation only when somebody who runs the property sends it.
    Until then the artisan is told nothing.
    """

    #: Exactly one of these two is set: a repair on a rented home, or a job a
    #: tenant or provider posted for themselves (``DirectJob``).
    maintenance_request = models.ForeignKey(
        "maintenance.MaintenanceRequest",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="quote_invitations",
    )
    direct_job = models.ForeignKey(
        "DirectJob",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="quote_invitations",
    )
    artisan = models.ForeignKey(
        ArtisanProfile, on_delete=models.PROTECT, related_name="quote_invitations"
    )
    suggested_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    invited_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    invited_at = models.DateTimeField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)
    #: Another artisan was chosen, or the request no longer needs one.
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "artisan_quote_invitation"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["maintenance_request", "artisan"], name="artisan_one_invitation_per_request"
            ),
            models.UniqueConstraint(
                fields=["direct_job", "artisan"], name="artisan_one_invitation_per_direct_job"
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(maintenance_request__isnull=False, direct_job__isnull=True)
                    | models.Q(maintenance_request__isnull=True, direct_job__isnull=False)
                ),
                name="artisan_invitation_has_one_subject",
            ),
        ]

    @property
    def is_open(self) -> bool:
        return self.invited_at is not None and self.declined_at is None and self.closed_at is None


class QuoteStatus(models.TextChoices):
    SUBMITTED = "submitted", "Waiting for approval"
    APPROVED = "approved", "Approved"
    DECLINED = "declined", "Declined"
    WITHDRAWN = "withdrawn", "Withdrawn"
    #: A revision was approved after it, so it is no longer the price on record.
    SUPERSEDED = "superseded", "Replaced by a revised quote"


class Quote(BaseModel):
    """A price, what it covers, and optionally the materials it includes.

    Extra cost is never an edit. It is a new quote that ``revises`` the one on
    record, and nothing about it counts until the payer approves it.
    """

    invitation = models.ForeignKey(QuoteInvitation, on_delete=models.PROTECT, related_name="quotes")
    price = MoneyField()
    scope = models.TextField(max_length=1000)
    #: ``[{"item": str, "quantity": str, "cost_minor": int | None}]``, all optional.
    materials = models.JSONField(default=list, blank=True)
    revises = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="revisions"
    )
    #: Why a revision was needed — what the artisan found.
    reason = models.CharField(max_length=500, blank=True)
    status = models.CharField(
        max_length=16, choices=QuoteStatus.choices, default=QuoteStatus.SUBMITTED
    )
    decided_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=300, blank=True)
    #: The payer says they paid the price on record. Recorded, never moved:
    #: Danpa HQ holds no money. On a repair it is mirrored as a property expense.
    paid_at = models.DateTimeField(null=True, blank=True)
    paid_recorded_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    #: The `rent.PropertyExpense` the payment was mirrored into, when it was.
    expense_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = "artisan_quote"
        ordering = ("created_at",)
        constraints = [
            # One price waiting at a time per invitation: a second is a revision
            # of an approved one, never a rival to a pending one.
            models.UniqueConstraint(
                fields=["invitation"],
                condition=models.Q(status="submitted"),
                name="artisan_one_pending_quote",
            ),
        ]


# --- direct jobs ---------------------------------------------------------------------


class DirectJobStatus(models.TextChoices):
    OPEN = "open", "Looking for an artisan"
    ASSIGNED = "assigned", "Artisan chosen"
    #: The artisan says it is done; the person who posted it confirms.
    DONE_REPORTED = "done_reported", "Waiting for your confirmation"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"


class DirectJob(BaseModel):
    """Work somebody hires an artisan for themselves: no property, no repair.

    Assembling a wardrobe, painting a room, fixing a gate at home. A tenant or a
    provider posts it and is its payer: they choose who quotes, approve the price
    and later confirm the work. It never touches maintenance, which is the record
    for repairs on a rented home that the provider pays for.

    Like a repair, an invited artisan reads the job and the area, and the address
    and a contact open only once their quote is approved.
    """

    owner = models.ForeignKey("identity.User", on_delete=models.PROTECT, related_name="direct_jobs")
    trade = models.CharField(max_length=24, choices=Trade.choices)
    title = models.CharField(max_length=120)
    description = models.TextField(max_length=2000)
    photo = models.ForeignKey(
        "files.StoredFile", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    #: The area an invited artisan reads. The rest of the address waits.
    locality = models.ForeignKey("geo.Locality", on_delete=models.PROTECT, related_name="+")
    house_number = models.CharField(max_length=32, blank=True)
    street = models.CharField(max_length=160, blank=True)
    landmark = models.CharField(max_length=200, blank=True)

    status = models.CharField(
        max_length=16, choices=DirectJobStatus.choices, default=DirectJobStatus.OPEN
    )
    assigned_artisan = models.ForeignKey(
        ArtisanProfile, null=True, blank=True, on_delete=models.PROTECT, related_name="direct_jobs"
    )
    assigned_quote = models.ForeignKey(
        Quote, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    assigned_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "artisan_direct_job"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["owner", "-created_at"], name="artisan_job_owner_idx")]

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"

    @property
    def is_open(self) -> bool:
        return self.status not in (DirectJobStatus.CANCELLED, DirectJobStatus.COMPLETED)

    @property
    def address_line(self) -> str:
        parts = [self.house_number, self.street, self.locality.name if self.locality_id else ""]
        return ", ".join(part for part in parts if part)


# --- finishing: the artisan's report, and the payer's review ---------------------------


class WorkFileKind(models.TextChoices):
    PHOTO = "photo", "Photo of the finished work"
    RECEIPT = "receipt", "Receipt"


class WorkReport(BaseModel):
    """The assigned artisan says the work is done: what they did, photos, receipts.

    It moves nothing by itself. On a repair the request goes to the tenant to
    confirm, exactly as when the provider reports it fixed; on a direct job the
    person who posted it confirms. A reopened job gets a new report, so every
    claim of "done" — and its photographs — stays on the record.
    """

    invitation = models.ForeignKey(
        QuoteInvitation, on_delete=models.PROTECT, related_name="work_reports"
    )
    note = models.CharField(max_length=500, blank=True)
    submitted_by = models.ForeignKey("identity.User", on_delete=models.PROTECT, related_name="+")
    #: A direct job's answer. A repair's lives in its maintenance history.
    confirmed_at = models.DateTimeField(null=True, blank=True)
    reopened_at = models.DateTimeField(null=True, blank=True)
    reopen_reason = models.CharField(max_length=500, blank=True)

    class Meta:
        db_table = "artisan_work_report"
        ordering = ("created_at",)


class WorkReportFile(BaseModel):
    report = models.ForeignKey(WorkReport, on_delete=models.PROTECT, related_name="files")
    file = models.ForeignKey("files.StoredFile", on_delete=models.PROTECT, related_name="+")
    kind = models.CharField(max_length=12, choices=WorkFileKind.choices)

    class Meta:
        db_table = "artisan_work_report_file"
        ordering = ("created_at",)


class ArtisanReview(BaseModel):
    """What the payer says about finished work. One per job, and no score.

    A sentence or two and whether they would hire the artisan again: facts a
    reader weighs, never averaged into a rating Danpa HQ would be vouching for.
    """

    invitation = models.OneToOneField(
        QuoteInvitation, on_delete=models.PROTECT, related_name="review"
    )
    artisan = models.ForeignKey(ArtisanProfile, on_delete=models.PROTECT, related_name="reviews")
    author = models.ForeignKey("identity.User", on_delete=models.PROTECT, related_name="+")
    text = models.TextField(max_length=1000)
    would_hire_again = models.BooleanField()

    class Meta:
        db_table = "artisan_review"
        ordering = ("-created_at",)
