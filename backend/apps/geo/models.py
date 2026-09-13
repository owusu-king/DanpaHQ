"""Ghanaian location reference data and addresses.

Location is a trust problem here, not just a display problem. "East Legon" means
something specific to a tenant deciding whether a rent is plausible, and a listing
that claims the wrong neighbourhood is one of the commonest scam signals. So
location is modelled as reference data with a controlled hierarchy, plus a free
"landmark" field because that is genuinely how people navigate.

Region -> District -> Locality is the government's own hierarchy (16 regions
since 2019). Localities are seeded and extended by operations, never created ad
hoc from user input - otherwise the same neighbourhood appears eleven times with
eleven spellings and search stops working.

PostGIS arrived with map search (ADR 0033, superseding that part of ADR 0003):
`Place` is what a tenant types into the location field, with a centre and a box a
map can fit, and listings carry an approximate public point the map searches.
Addresses keep their plain latitude/longitude pair — they are private facts, and
no query needs to be spatial about them.
"""

from __future__ import annotations

from django.contrib.gis.db.models import PointField, PolygonField
from django.contrib.postgres.indexes import GinIndex
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

    locality = models.ForeignKey(Locality, on_delete=models.PROTECT, related_name="addresses")
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

    def __str__(self) -> str:
        parts = [self.house_number, self.street, self.locality.name]
        return ", ".join(p for p in parts if p)


class PlaceKind(models.TextChoices):
    """What sort of place a suggestion is, roughly in order of the area it means."""

    REGION = "region", "Region"
    DISTRICT = "district", "District"
    CITY = "city", "City"
    TOWN = "town", "Town"
    SUBURB = "suburb", "Suburb"
    NEIGHBOURHOOD = "neighbourhood", "Neighbourhood"
    VILLAGE = "village", "Village"
    LANDMARK = "landmark", "Landmark"


class PlaceBoundsSource(models.TextChoices):
    MAPPED = "mapped", "Mapped outline"
    ESTIMATED = "estimated", "Estimated from the kind of place"


class Place(BaseModel):
    """Somewhere a tenant can search: a named area with a centre and a box.

    A Locality is where a listing is *filed*; a Place is what somebody *types*.
    They overlap without being the same thing — "Airport" should find the
    Airport Residential Area and Kotoka International Airport, "Ashanti" a whole
    region — so places are their own table, and a place that is also a Rooomly
    locality links to it. That link is what lets a search for the place include
    every listing filed under the locality, point or no point.

    Imported from OpenStreetMap and curated by operations (ADR 0033). The box is
    the bounding box of a mapped outline where there is one, or estimated around
    a mapped point from the kind of place — `bounds_source` says which, because
    a neighbourhood mapped only as a point has no outline to take one from.
    """

    slug = models.SlugField(max_length=160, unique=True)
    name = models.CharField(max_length=160)
    kind = models.CharField(max_length=16, choices=PlaceKind.choices, db_index=True)
    #: The larger place a name is read against: "Accra, Greater Accra".
    context = models.CharField(max_length=200, blank=True)
    aliases = models.JSONField(default=list, blank=True)
    #: The lowercased name and aliases as one string, for the trigram index.
    search_text = models.CharField(max_length=800)
    center = PointField(srid=4326)
    bounds = PolygonField(srid=4326)
    bounds_source = models.CharField(max_length=12, choices=PlaceBoundsSource.choices)
    region = models.ForeignKey(
        Region, null=True, blank=True, on_delete=models.SET_NULL, related_name="places"
    )
    district = models.ForeignKey(
        District, null=True, blank=True, on_delete=models.SET_NULL, related_name="places"
    )
    locality = models.OneToOneField(
        Locality, null=True, blank=True, on_delete=models.SET_NULL, related_name="place"
    )
    importance = models.FloatField(default=0)
    source = models.CharField(max_length=16, default="osm")
    #: Identity at the source — "node/123" for OpenStreetMap — so a re-import
    #: updates a place instead of adding it twice.
    source_ref = models.CharField(max_length=64)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "geo_place"
        ordering = ("-importance", "name")
        constraints = [
            models.UniqueConstraint(fields=["source", "source_ref"], name="geo_place_source_unique")
        ]
        indexes = [
            GinIndex(
                fields=["search_text"], name="geo_place_search_trgm", opclasses=["gin_trgm_ops"]
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.kind})"
