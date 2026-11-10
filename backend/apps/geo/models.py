"""Source-linked Ghana reference geography and independently stored user addresses.

Regions and districts retain existing IDs. Localities may have unknown parents;
2021 boundary matches are an inference, not current administrative verification.
Imported gazetteer points never become a property's private map pin. User-entered
names remain on Address as explicitly unverified text rather than polluting the
public reference tables.
"""

from __future__ import annotations

from django.contrib.gis.db import models as gis_models
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
    boundary = gis_models.MultiPolygonField(srid=4326, null=True, blank=True)

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

    district = models.ForeignKey(
        District, on_delete=models.PROTECT, related_name="localities", null=True, blank=True
    )
    region = models.ForeignKey(
        Region, on_delete=models.PROTECT, related_name="localities", null=True, blank=True
    )
    name = models.CharField(max_length=200)
    normalized_name = models.CharField(max_length=240, blank=True, default="")
    search_text = models.TextField(blank=True, default="")
    kind = models.CharField(max_length=32, blank=True)
    parent_status = models.CharField(max_length=32, default="unverified")
    imported = models.BooleanField(default=False)
    primary_source = models.CharField(max_length=160, blank=True)
    import_locked = models.BooleanField(default=False)
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
        indexes = [
            models.Index(fields=["name"], name="geo_locality_name_idx"),
            GinIndex(fields=["normalized_name"], opclasses=["gin_trgm_ops"], name="geo_name_trgm"),
            GinIndex(fields=["search_text"], opclasses=["gin_trgm_ops"], name="geo_search_trgm"),
        ]

    @property
    def district_label(self):
        return self.district.name if self.district_id else ""

    @property
    def region_label(self):
        if self.district_id:
            return self.district.region.name
        return self.region.name if self.region_id else ""

    def prepare_search(self):
        from .search import normalize_name

        if self.district_id:
            self.region_id = self.district.region_id
        self.normalized_name = normalize_name(self.name)
        self.search_text = normalize_name(
            " ".join(
                [
                    self.name,
                    *self.aliases,
                    self.district_label,
                    self.region_label,
                ]
            )
        )

    def save(self, *args, **kwargs):
        self.prepare_search()
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = set(kwargs["update_fields"]) | {
                "normalized_name",
                "search_text",
                "region",
            }
        super().save(*args, **kwargs)

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
    # A resolved neighbourhood centre is public, approximate geography. Keep it
    # separate from the property's private latitude/longitude.
    place_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    place_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    digital_address = DigitalAddressField(max_length=14, blank=True, db_index=True)
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
        locality = self.locality
        return locality.name if locality is not None else self.place_name

    @property
    def district_label(self) -> str:
        locality = self.locality
        if locality is not None:
            return locality.district_label
        return self.place_context.split(",", 1)[0].strip()

    @property
    def region_label(self) -> str:
        locality = self.locality
        return locality.region_label if locality is not None else ""

    @property
    def location_status(self) -> str:
        return "reference" if self.locality_id else "unverified"

    def __str__(self) -> str:
        parts = [self.house_number, self.street, self.locality_label]
        return ", ".join(p for p in parts if p)


class GeoDataset(models.Model):
    """Licensing and version of an obtained reference dataset, never user addresses."""

    id = models.CharField(primary_key=True, max_length=40)
    url = models.URLField(max_length=500)
    license = models.CharField(max_length=80)
    attribution = models.TextField()
    version = models.CharField(max_length=160, blank=True)
    sha256 = models.CharField(max_length=64)
    imported_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.id


class LocationSourceRecord(models.Model):
    """Stable external identity and original facts; several sources can share one place."""

    dataset = models.ForeignKey(GeoDataset, on_delete=models.PROTECT)
    source_id = models.CharField(max_length=100)
    region = models.ForeignKey(
        Region, on_delete=models.PROTECT, null=True, blank=True, related_name="source_records"
    )
    district = models.ForeignKey(
        District, on_delete=models.PROTECT, null=True, blank=True, related_name="source_records"
    )
    locality = models.ForeignKey(
        Locality, on_delete=models.PROTECT, null=True, blank=True, related_name="source_records"
    )
    data = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["dataset", "source_id"], name="geo_source_identity"),
            models.CheckConstraint(
                condition=(
                    models.Q(region__isnull=False, district__isnull=True, locality__isnull=True)
                    | models.Q(region__isnull=True, district__isnull=False, locality__isnull=True)
                    | models.Q(region__isnull=True, district__isnull=True, locality__isnull=False)
                ),
                name="geo_source_one_target",
            ),
        ]

    def __str__(self):
        return f"{self.dataset_id}:{self.source_id}"
