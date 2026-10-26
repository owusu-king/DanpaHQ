"""Properties for sale — a property advertised whole, and buyers asking about it.

A property's `purpose` is fixed when it is created (see
`apps.property.models.PropertyPurpose`). One *for sale* has no Units, no
tenancies and no rent. It is sold as itself, so what a buyer reads — the price,
the tenure, the size — belongs to the property rather than to a campaign inside
it, and lives here, one row per property.

**Nothing here says whether a sale is public.** That is derived: a property for
sale is advertised exactly while its verification is current and its seller has
it on the market — see `read_models.public_sales`. Storing a "published" flag
would need a hook on every way a verification can end (a decision, a revocation,
an expiry sweep) and would be wrong whenever one was missed.

Buyers ask through `SaleEnquiry`: one conversation per buyer per property, kept
on the platform so the seller's number stays private and the conversation stays
on record (owner, 2026-09-28).
"""

from __future__ import annotations

from django.contrib.gis.db import models as gis_models
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import BaseModel


class SaleStatus(models.TextChoices):
    """Where the seller has put it. Verification decides the rest."""

    ACTIVE = "active", "On the market"
    WITHDRAWN = "withdrawn", "Taken off the market"
    #: Final. A sold property is not relisted; a new owner starts again.
    SOLD = "sold", "Sold"


class Tenure(models.TextChoices):
    """What is being bought, legally. Asked because it changes what a price means."""

    FREEHOLD = "freehold", "Freehold"
    LEASEHOLD = "leasehold", "Leasehold"
    #: Stool, skin or family land held under customary tenure — common here, and
    #: a buyer needs to know it is what they are dealing with.
    CUSTOMARY = "customary", "Customary land"


class LandSizeUnit(models.TextChoices):
    PLOTS = "plots", "Plots"
    ACRES = "acres", "Acres"
    SQUARE_METRES = "sqm", "Square metres"


class CommercialUse(models.TextChoices):
    SHOP = "shop", "Shop or retail"
    OFFICE = "office", "Office"
    WAREHOUSE = "warehouse", "Warehouse or industrial"
    MIXED = "mixed_use", "Mixed use"
    OTHER = "other", "Other commercial"


class LocationPrecision(models.TextChoices):
    """How coarse the public point is. The same meanings `listing` uses."""

    AREA = "area", "Around here"
    LOCALITY = "locality", "Somewhere in this neighbourhood"


class SaleListing(BaseModel):
    """What a buyer reads about one property for sale."""

    property = models.OneToOneField(
        "property.Property", on_delete=models.CASCADE, related_name="sale"
    )
    created_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    status = models.CharField(
        max_length=12, choices=SaleStatus.choices, default=SaleStatus.ACTIVE, db_index=True
    )
    status_changed_at = models.DateTimeField(null=True, blank=True)

    #: In pesewas, as every amount on the platform is.
    price_minor = models.BigIntegerField(null=True, blank=True)
    currency = models.CharField(max_length=3, default="GHS")
    price_negotiable = models.BooleanField(default=False)

    headline = models.CharField(max_length=160, blank=True)
    description = models.TextField(max_length=3000, blank=True)
    tenure = models.CharField(max_length=12, choices=Tenure.choices, blank=True)
    #: Only for leasehold: what is left of the lease is most of what it is worth.
    lease_years_remaining = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MaxValueValidator(999)]
    )

    # A house, or a commercial building.
    bedrooms = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MaxValueValidator(50)]
    )
    bathrooms = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MaxValueValidator(50)]
    )
    floor_area_sqm = models.DecimalField(
        max_digits=9,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )
    commercial_use = models.CharField(max_length=16, choices=CommercialUse.choices, blank=True)

    # Land.
    land_size = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )
    land_size_unit = models.CharField(max_length=6, choices=LandSizeUnit.choices, blank=True)
    #: Whether water and electricity reach the plot. A serviced plot and a bare
    #: one at the same size are different purchases.
    is_serviced = models.BooleanField(null=True, blank=True)

    #: The coarse public point, derived from the property's address — never the
    #: address itself. See `apps.listing.location`.
    public_point = gis_models.PointField(srid=4326, null=True, blank=True)
    public_point_precision = models.CharField(
        max_length=10, choices=LocationPrecision.choices, blank=True
    )

    class Meta:
        db_table = "sale_listing"
        indexes = [
            models.Index(fields=["status", "-created_at"], name="sale_status_idx"),
            models.Index(fields=["price_minor"], name="sale_price_idx"),
        ]

    def __str__(self) -> str:
        return self.headline or f"Sale of {self.property_id}"


class EnquiryStatus(models.TextChoices):
    OPEN = "open", "Open"
    CLOSED = "closed", "Closed"


class SaleEnquiry(BaseModel):
    """One buyer's conversation with the seller of one property.

    One per buyer per property: a second enquiry from the same person is the
    same conversation continuing, not a new lead.
    """

    sale = models.ForeignKey(SaleListing, on_delete=models.CASCADE, related_name="enquiries")
    buyer = models.ForeignKey(
        "identity.User", on_delete=models.CASCADE, related_name="sale_enquiries"
    )
    status = models.CharField(
        max_length=8, choices=EnquiryStatus.choices, default=EnquiryStatus.OPEN
    )
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    #: When each side last read it, so each can be told what is new.
    buyer_read_at = models.DateTimeField(null=True, blank=True)
    seller_read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "sale_enquiry"
        constraints = [
            models.UniqueConstraint(fields=["sale", "buyer"], name="sale_enquiry_one_per_buyer"),
        ]

    def __str__(self) -> str:
        return f"Enquiry {self.id} on {self.sale_id}"


class SaleEnquiryMessage(BaseModel):
    enquiry = models.ForeignKey(SaleEnquiry, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey("identity.User", on_delete=models.PROTECT, related_name="+")
    body = models.TextField(max_length=2000)

    class Meta:
        db_table = "sale_enquiry_message"
        ordering = ["created_at"]
