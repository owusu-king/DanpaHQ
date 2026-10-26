"""Listing domain — how a unit is advertised for rent.

A listing is an ephemeral advertisement for a rentable unit. Key rules:

* **One live listing per unit.** You cannot advertise the same flat twice at
  different rents. The unique constraint is enforced at the database level so it
  cannot be bypassed by a race condition.
* **Listings are not deleted.** They are withdrawn, expired or superseded. The
  history of what was advertised and for how much stays readable — it is the
  record that settles disputes about what was agreed before the lease was signed.
* **Rent is in integer minor units (pesewas).** See ADR 0006.
* **Advance months is a first-class field.** Up to two-year advance is common
  in Ghana and is the single biggest factor in whether a tenancy can happen.
  Burying it in a notes field is how it gets missed, and missing it wastes
  everyone's time.

Ghana-specific listing fields:
* ``advance_months`` — how many months must be paid upfront.
* ``agency_fee_months`` — how many months' rent the agent takes as commission.
  Opaque and variable agent fees are one of the loudest complaints in this
  market; making it visible up front is a product decision, not an admin field.
* ``caution_months`` — the refundable deposit in months of rent.
"""

from __future__ import annotations

from django.contrib.gis.db.models import PointField
from django.contrib.postgres.indexes import GistIndex
from django.db import models

from apps.core.fields import MoneyField
from apps.core.models import AliveQuerySet, BaseModel, SoftDeleteModel, SoftDeleteQuerySet


class ListingStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PENDING_REVIEW = "pending_review", "Pending review"
    ACTIVE = "active", "Active"
    RENTED = "rented", "Rented"
    WITHDRAWN = "withdrawn", "Withdrawn"
    EXPIRED = "expired", "Expired"
    SUSPENDED = "suspended", "Suspended"
    REJECTED = "rejected", "Rejected"
    FLAGGED = "flagged", "Flagged"


class RentPeriod(models.TextChoices):
    MONTHLY = "monthly", "Per month"
    YEARLY = "yearly", "Per year"


class LocationPrecision(models.TextChoices):
    """How closely a listing's public map point describes where it is.

    Neither is the address. See `apps.listing.location`.
    """

    AREA = "area", "Within about 300 metres"
    LOCALITY = "locality", "Somewhere in the neighbourhood"


class _KeepsAxesInStep:
    """Keeps `status` and the axes in step on bulk writes too.

    `Model.save()` translates between them, but a queryset `.update()` goes
    straight to SQL and never reaches it. That is not hypothetical: activating
    a lease marked its listing rented with an `.update()`, so `status` said
    `rented` while `availability_state` still said `available` — and the next
    save would have derived `active` from the stale axes and quietly put a let
    property back into public search.

    A mixin rather than a check at each call site, because the only fix that
    survives is one nobody has to remember.
    """

    def update(self, **kwargs):
        status = kwargs.get("status")
        already_setting_axes = {
            "moderation_state",
            "publication_state",
            "availability_state",
        } & kwargs.keys()
        if status is not None and not already_setting_axes:
            axes = Listing._STATUS_TO_AXES.get(status)
            if axes is not None:
                kwargs["moderation_state"] = axes[0]
                kwargs["publication_state"] = axes[1]
                kwargs["availability_state"] = axes[2]
        return super().update(**kwargs)


class ListingQuerySet(_KeepsAxesInStep, SoftDeleteQuerySet):
    """Every row, soft-deleted included."""


class ListingAliveQuerySet(_KeepsAxesInStep, AliveQuerySet):
    """The default: soft-deleted rows already excluded."""


class ModerationState(models.TextChoices):
    """What review has decided. Survives the listing being taken down.

    Kept apart from publication because they answer different questions and
    change at different times. While they shared one field, withdrawing an
    approved listing erased the approval, so re-publishing it sent unchanged
    work back through the queue — a fortnight off the market for a landlord
    whose relative was visiting, and a re-review for a team that had already
    said yes.
    """

    NOT_REVIEWED = "not_reviewed", "Not reviewed"
    PENDING = "pending", "Awaiting review"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    FLAGGED = "flagged", "Flagged"
    SUSPENDED = "suspended", "Suspended"


class PublicationState(models.TextChoices):
    """Whether the provider is offering this to the public right now."""

    DRAFT = "draft", "Draft"
    PUBLISHED = "published", "Published"
    WITHDRAWN = "withdrawn", "Withdrawn"


class AvailabilityState(models.TextChoices):
    """Whether it can still be taken."""

    AVAILABLE = "available", "Available"
    TAKEN = "taken", "Taken"
    EXPIRED = "expired", "Expired"


class Listing(SoftDeleteModel):
    unit = models.ForeignKey("property.Unit", on_delete=models.PROTECT, related_name="listings")
    created_by = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="listings_created"
    )

    #: Derived from the three axes below in `save()`. Kept as a real column
    #: because public search, the one-live-listing constraint, the operations
    #: portal and both clients all read it — deriving it preserves that surface
    #: exactly while giving the axes one source of truth.
    status = models.CharField(
        max_length=20, choices=ListingStatus.choices, default=ListingStatus.DRAFT
    )

    # --- the axes, which are what services actually set ----------------------
    moderation_state = models.CharField(
        max_length=16,
        choices=ModerationState.choices,
        default=ModerationState.NOT_REVIEWED,
        db_index=True,
    )
    publication_state = models.CharField(
        max_length=16,
        choices=PublicationState.choices,
        default=PublicationState.DRAFT,
        db_index=True,
    )
    availability_state = models.CharField(
        max_length=16,
        choices=AvailabilityState.choices,
        default=AvailabilityState.AVAILABLE,
        db_index=True,
    )

    # --- rent ----------------------------------------------------------------
    rent = MoneyField()
    rent_period = models.CharField(
        max_length=8, choices=RentPeriod.choices, default=RentPeriod.MONTHLY
    )

    # --- Ghana-specific payment terms ----------------------------------------
    advance_months = models.PositiveSmallIntegerField(
        default=1,
        help_text="How many months must be paid upfront. Up to 24 is common.",
    )
    caution_months = models.PositiveSmallIntegerField(
        default=0,
        help_text="Refundable security deposit in months of rent.",
    )
    agency_fee_months = models.PositiveSmallIntegerField(
        default=0,
        help_text="Agent commission in months of rent. Shown to tenants up front.",
    )

    # --- headline and description --------------------------------------------
    headline = models.CharField(max_length=160)
    description = models.TextField(max_length=3000)

    # --- availability --------------------------------------------------------
    available_from = models.DateField(null=True, blank=True)
    minimum_lease_months = models.PositiveSmallIntegerField(default=6)

    # --- highlighted amenities -----------------------------------------------
    # A listing may highlight a subset of what the unit actually has — the
    # amenities the landlord particularly wants tenants to notice. The full set
    # lives on UnitAmenity in the property domain. A listing FK to
    # property.Amenity is correct: amenities are physical facts about a unit,
    # not properties of a rental campaign.
    highlighted_amenities = models.ManyToManyField(
        "property.Amenity",
        blank=True,
        related_name="listings",
        help_text="Amenities the landlord wants to call out specifically in this listing.",
    )

    # --- review / moderation -------------------------------------------------
    reviewed_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="listings_reviewed",
    )
    reviewed_by_management_id = models.UUIDField(null=True, blank=True, db_index=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True, max_length=600)

    # --- search helpers ------------------------------------------------------
    # Denormalised from the unit + property for query performance. Updated by
    # the service layer when either changes. A UUID, not an integer: every
    # primary key in this schema is a UUIDv7, geo.Locality included.
    locality_id_cache = models.UUIDField(null=True, blank=True, db_index=True)
    bedrooms_cache = models.PositiveSmallIntegerField(null=True, blank=True)
    #: Where the listing may be drawn on a public map: never the address, only a
    #: snapped cell centre or the neighbourhood's centre. Derived by
    #: `apps.listing.location`, and indexed for map search (ADR 0033).
    public_point = PointField(srid=4326, null=True, blank=True, spatial_index=False)
    public_point_precision = models.CharField(
        max_length=10, choices=LocationPrecision.choices, blank=True
    )

    # --- derivation -----------------------------------------------------------

    def derived_status(self) -> str:
        """Collapse the three axes onto the single status the API still speaks.

        Order matters: a moderation verdict that stops publication outranks
        whatever the provider has asked for, because a suspended listing is not
        a draft the provider may simply re-publish.
        """
        if self.moderation_state == ModerationState.SUSPENDED:
            return ListingStatus.SUSPENDED
        if self.moderation_state == ModerationState.FLAGGED:
            return ListingStatus.FLAGGED
        if self.moderation_state == ModerationState.REJECTED:
            return ListingStatus.REJECTED
        # A pending review is the one moderation value that does not outrank
        # publication: it is a wait, not a verdict, and a listing the provider
        # has taken down is withdrawn regardless of what was queued.
        if (
            self.moderation_state == ModerationState.PENDING
            and self.publication_state == PublicationState.PUBLISHED
        ):
            return ListingStatus.PENDING_REVIEW

        if self.publication_state == PublicationState.DRAFT:
            return ListingStatus.DRAFT
        if self.publication_state == PublicationState.WITHDRAWN:
            return ListingStatus.WITHDRAWN

        if self.availability_state == AvailabilityState.TAKEN:
            return ListingStatus.RENTED
        if self.availability_state == AvailabilityState.EXPIRED:
            return ListingStatus.EXPIRED
        return ListingStatus.ACTIVE

    #: The inverse of `derived_status`, for callers that still write `status`.
    #: A withdrawn or draft row cannot say what review had decided, so it reads
    #: as not-reviewed — the safe direction, since claiming an approval that may
    #: never have happened would put unreviewed work in front of the public.
    _STATUS_TO_AXES = {
        ListingStatus.DRAFT: ("not_reviewed", "draft", "available"),
        ListingStatus.PENDING_REVIEW: ("pending", "published", "available"),
        ListingStatus.ACTIVE: ("approved", "published", "available"),
        ListingStatus.RENTED: ("approved", "published", "taken"),
        ListingStatus.EXPIRED: ("approved", "published", "expired"),
        ListingStatus.WITHDRAWN: ("not_reviewed", "withdrawn", "available"),
        ListingStatus.REJECTED: ("rejected", "draft", "available"),
        ListingStatus.FLAGGED: ("flagged", "published", "available"),
        ListingStatus.SUSPENDED: ("suspended", "published", "available"),
    }

    def adopt_status(self, status: str) -> None:
        """Set the axes from a collapsed status."""
        axes = self._STATUS_TO_AXES.get(status)
        if axes is None:
            return
        self.moderation_state, self.publication_state, self.availability_state = axes

    def save(self, *args, **kwargs):
        """Keep `status` and the axes in step, whichever the caller wrote.

        The axes are the model the domain now reasons in, but `status` is
        written directly in several places — a queryset `.update()` marking a
        listing rented, tests building a scenario — and silently discarding
        those writes would have made this an additive migration that quietly
        broke everything. So the translation runs both ways: write either, and
        the other follows.
        """
        update_fields = kwargs.get("update_fields")
        derived = self.derived_status()

        wrote_status = (update_fields is not None and "status" in update_fields) or (
            self._state.adding and self.status and self.status != derived
        )

        if wrote_status and self.status != derived:
            self.adopt_status(self.status)

        self.status = self.derived_status()

        if update_fields is not None:
            # Whichever side was written, both sides are persisted.
            kwargs["update_fields"] = list(
                dict.fromkeys(
                    [
                        *update_fields,
                        "status",
                        "moderation_state",
                        "publication_state",
                        "availability_state",
                    ]
                )
            )
        super().save(*args, **kwargs)

    objects = models.Manager.from_queryset(ListingAliveQuerySet)()
    all_objects = models.Manager.from_queryset(ListingQuerySet)()

    class Meta:
        db_table = "listing_listing"
        ordering = ("-created_at",)
        constraints = [
            # Soft-deleted rows are excluded deliberately: without that clause a
            # withdrawn-then-deleted listing keeps its unit hostage forever,
            # because deletion here only sets deleted_at and leaves status alone.
            models.UniqueConstraint(
                fields=["unit"],
                condition=models.Q(
                    status__in=["draft", "pending_review", "active"],
                    deleted_at__isnull=True,
                ),
                name="listing_one_live_per_unit",
            )
        ]
        indexes = [
            models.Index(
                fields=["status", "locality_id_cache", "-created_at"],
                name="listing_search_idx",
                condition=models.Q(status="active"),
            ),
            models.Index(fields=["created_by", "-created_at"], name="listing_owner_idx"),
            # Only live listings are searched on the map, so only they are indexed.
            GistIndex(
                fields=["public_point"],
                name="listing_public_point_gist",
                condition=models.Q(status="active"),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.headline or 'Draft listing'} ({self.status})"

    @property
    def is_live(self) -> bool:
        return self.status == ListingStatus.ACTIVE

    @property
    def total_move_in_minor(self) -> int:
        """Total cash needed on day one: advance + deposit + agency fee.

        In pesewas. Carries no currency because it is always in the listing's
        own rent currency — multi-currency listings are not a planned feature.
        """
        if self.rent_minor is None:
            return 0
        monthly = self.rent_minor
        if self.rent_period == RentPeriod.YEARLY:
            monthly = monthly // 12
        return (
            monthly * self.advance_months
            + monthly * self.caution_months
            + monthly * self.agency_fee_months
        )


class SavedListing(BaseModel):
    """A tenant's shortlist entry.

    Kept as its own table rather than a many-to-many on Listing because the
    relationship carries the tenant's own note - the reason they saved it - and
    because when it was saved is what orders the shortlist.
    """

    user = models.ForeignKey(
        "identity.User", on_delete=models.CASCADE, related_name="saved_listings"
    )
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="saved_by")
    note = models.CharField(
        max_length=200,
        blank=True,
        help_text="The tenant's own note, e.g. 'ask about the water'. Never shown to the landlord.",
    )

    class Meta:
        db_table = "listing_saved"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(fields=["user", "listing"], name="listing_unique_saved")
        ]

    def __str__(self) -> str:
        return f"{self.user_id} saved {self.listing_id}"


class ListingMedia(BaseModel):
    """Photos attached to a specific listing campaign.

    A photo can be perfect for one listing's presentation and wrong for another
    (different lighting, different staging), so listing media is decoupled from
    property media.
    """

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="media")
    file = models.ForeignKey("files.StoredFile", on_delete=models.PROTECT, related_name="+")
    sort_order = models.PositiveSmallIntegerField(default=0)
    caption = models.CharField(max_length=120, blank=True)
    is_cover = models.BooleanField(default=False)

    class Meta:
        db_table = "listing_media"
        ordering = ("-is_cover", "sort_order")
        constraints = [
            models.UniqueConstraint(
                fields=["listing"],
                condition=models.Q(is_cover=True),
                name="listing_one_cover",
            )
        ]

    def __str__(self) -> str:
        return f"Media for {self.listing_id} ({'cover' if self.is_cover else str(self.sort_order)})"
