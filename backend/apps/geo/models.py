"""Ghanaian location reference data and addresses.

Location is a trust problem here, not just a display problem. "East Legon" means
something specific to a tenant deciding whether a rent is plausible, and a listing
that claims the wrong neighbourhood is one of the commonest scam signals. So
location is modelled as reference data with a controlled hierarchy, plus a free
"landmark" field because that is genuinely how people navigate.

Region -> District -> Locality is the government's own hierarchy (16 regions
since 2019). Localities are seeded and extended by operations, never created ad
hoc from user input - otherwise the same neighbourhood appears eleven times with
eleven spellings and search stops working. An Address may instead retain a
provider-resolved place when the controlled table does not yet cover that town;
that does not silently promote third-party text into Rooomly reference data.

PostGIS arrived with map search (ADR 0033, superseding that part of ADR 0003):
listings carry an approximate public point the map searches. What a tenant types
into the location field is looked up through a location provider and never
stored here (ADR 0034). Addresses keep their plain latitude/longitude pair — they
are private facts, and no query needs to be spatial about them.
"""

from __future__ import annotations

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.fields import DigitalAddressField
from apps.core.models import BaseModel, SoftDeleteModel


class Region(BaseModel):
    name = models.CharField(max_length=60, unique=True)
    code = models.CharField(max_length=8, unique=True)  # "GA", "AH"
    capital = models.CharField(max_length=60, blank=True)

    class Meta:
        db_table = "geo_region"
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class District(BaseModel):
    region = models.ForeignKey(Region, on_delete=models.PROTECT, related_name="districts")
    name = models.CharField(max_length=80)
    code = models.CharField(max_length=12, blank=True)

    class Meta:
        db_table = "geo_district"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(fields=["region", "name"], name="geo_district_unique")
        ]

    def __str__(self) -> str:
        return f"{self.name}, {self.region.name}"


class Locality(BaseModel):
    """A neighbourhood or town: Osu, Adenta, Ahodwo.

    ``aliases`` carries the other names people search with (Nima/Kanda,
    Spintex/Sakumono), so a tenant typing the name they know still finds the
    listing an agent filed under a different one.
    """

    district = models.ForeignKey(District, on_delete=models.PROTECT, related_name="localities")
    name = models.CharField(max_length=100)
    aliases = models.JSONField(default=list, blank=True)
    latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        validators=[MinValueValidator(-90), MaxValueValidator(90)],
    )
    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        validators=[MinValueValidator(-180), MaxValueValidator(180)],
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "geo_locality"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(fields=["district", "name"], name="geo_locality_unique")
        ]
        indexes = [models.Index(fields=["name"], name="geo_locality_name_idx")]

    def __str__(self) -> str:
        return self.name


class Address(SoftDeleteModel):
    """A physical address. Attached to properties, users and payout records.

    Free text is kept alongside structured fields because Ghanaian addresses are
    genuinely descriptive; discarding the description in favour of a tidy schema
    would make addresses less useful, not more.
    """

    locality = models.ForeignKey(
        Locality,
        on_delete=models.PROTECT,
        related_name="addresses",
        null=True,
        blank=True,
    )
    # A provider-resolved town/neighbourhood that is not yet represented by the
    # controlled hierarchy above. Provider references are durable; coordinates
    # from a suggestion are deliberately not persisted as property coordinates.
    place_name = models.CharField(max_length=160, blank=True)
    place_context = models.CharField(max_length=160, blank=True)
    place_provider = models.CharField(max_length=32, blank=True)
    place_reference = models.CharField(max_length=300, blank=True)
    digital_address = DigitalAddressField(blank=True, db_index=True)
    street = models.CharField(max_length=160, blank=True)
    house_number = models.CharField(max_length=32, blank=True)
    landmark = models.CharField(
        max_length=200,
        blank=True,
        help_text=(
            "How people actually find it, e.g. 'second gate after the Total " "filling station'."
        ),
    )
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    #: Set only when coordinates came from GhanaPost or a surveyed visit, never
    #: from a user typing them. Consumed by the trust layer in Phase 2.
    coordinates_source = models.CharField(max_length=32, blank=True)
    coordinates_confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "geo_address"
        indexes = [
            models.Index(fields=["locality"], name="geo_address_locality_idx"),
            models.Index(fields=["latitude", "longitude"], name="geo_address_coords_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(locality__isnull=False) | ~models.Q(place_name=""),
                name="geo_address_has_location",
            )
        ]

    @property
    def locality_label(self) -> str:
        return self.locality.name if self.locality_id else self.place_name

    @property
    def district_label(self) -> str:
        if self.locality_id:
            return self.locality.district.name
        return self.place_context.split(",", 1)[0].strip()

    @property
    def region_label(self) -> str:
        return self.locality.district.region.name if self.locality_id else ""

    def __str__(self) -> str:
        parts = [self.house_number, self.street, self.locality_label]
        return ", ".join(p for p in parts if p)
