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

    class Meta:
        db_table = "artisan_certificate"
        ordering = ("created_at",)

    def __str__(self) -> str:
        return f"{self.get_trade_display()} certificate from {self.issuing_body}"

    @property
    def status(self) -> str:
        if self.expires_on is not None and self.expires_on < timezone.localdate():
            return CertificateStatus.EXPIRED
        if self.verified_at is not None:
            return CertificateStatus.VERIFIED
        return CertificateStatus.PROVIDED
