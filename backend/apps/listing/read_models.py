"""Read models for public rental discovery.

Public visibility is intentionally defined once. Search and recommendations
must never disagree about whether an advertised space is still available.
"""

from django.db.models import (
    BigIntegerField,
    Case,
    Count,
    Exists,
    ExpressionWrapper,
    F,
    IntegerField,
    OuterRef,
    Q,
    QuerySet,
    Value,
    When,
)
from django.db.models.functions import Abs

from apps.occupancy.models import Occupancy, OccupancyStatus

from .models import Listing, ListingStatus, RentPeriod


def public_listings() -> QuerySet[Listing]:
    """Listings a tenant may act on: published, available and unoccupied."""

    active_occupancy = Occupancy.objects.filter(
        unit_id=OuterRef("unit_id"),
        status=OccupancyStatus.ACTIVE,
        ended_at__isnull=True,
    )
    return (
        Listing.objects.filter(status=ListingStatus.ACTIVE)
        .annotate(unit_is_occupied=Exists(active_occupancy))
        .filter(unit_is_occupied=False)
    )


def related_listings(listing: Listing, *, limit: int = 4) -> QuerySet[Listing]:
    """Return a small, deterministic set of useful alternatives.

    Location leads, then affordability after yearly rents are normalized to a
    monthly amount. Physical similarity refines those choices rather than
    overpowering them: an identical flat far away is not more useful than an
    affordable option in the tenant's chosen neighbourhood.
    """

    monthly_rent = listing.rent_minor or 0
    if listing.rent_period == RentPeriod.YEARLY:
        monthly_rent //= 12

    normalized_rent = Case(
        When(
            rent_period=RentPeriod.YEARLY,
            then=ExpressionWrapper(F("rent_minor") / Value(12), output_field=BigIntegerField()),
        ),
        default=F("rent_minor"),
        output_field=BigIntegerField(),
    )

    locality_id = listing.locality_id_cache
    district_id = listing.unit.property.address.locality.district_id
    property_type = listing.unit.property.property_type
    space_type = listing.unit.space_type
    bedrooms = listing.unit.bedrooms
    furnished = listing.unit.is_furnished
    amenity_ids = list(
        listing.unit.unit_amenities.filter(removed_at__isnull=True).values_list(
            "amenity_id", flat=True
        )
    )
    property_amenity_ids = list(
        listing.unit.property.property_amenities.filter(removed_at__isnull=True).values_list(
            "amenity_id", flat=True
        )
    )

    # Relative bands keep "affordable" meaningful for both a GH₵600 room and
    # a GH₵8,000 apartment. A zero rent is defensive only; published listings
    # are required to carry a positive amount by the service layer.
    close_low, close_high = int(monthly_rent * 0.85), int(monthly_rent * 1.15)
    near_low, near_high = int(monthly_rent * 0.70), int(monthly_rent * 1.30)
    broad_low, broad_high = int(monthly_rent * 0.50), int(monthly_rent * 1.50)

    location_score = Case(
        When(locality_id_cache=locality_id, then=Value(1000)),
        When(
            unit__property__address__locality__district_id=district_id,
            then=Value(500),
        ),
        default=Value(0),
        output_field=IntegerField(),
    )
    affordability_score = Case(
        When(normalized_rent__range=(close_low, close_high), then=Value(400)),
        When(normalized_rent__range=(near_low, near_high), then=Value(250)),
        When(normalized_rent__range=(broad_low, broad_high), then=Value(100)),
        default=Value(0),
        output_field=IntegerField(),
    )
    physical_score = (
        Case(
            When(unit__property__property_type=property_type, then=Value(40)),
            default=Value(0),
            output_field=IntegerField(),
        )
        + Case(
            When(unit__space_type=space_type, then=Value(50)),
            default=Value(0),
            output_field=IntegerField(),
        )
        + Case(
            When(unit__bedrooms=bedrooms, then=Value(30)),
            default=Value(0),
            output_field=IntegerField(),
        )
        + Case(
            When(unit__is_furnished=furnished, then=Value(10)),
            default=Value(0),
            output_field=IntegerField(),
        )
    )

    candidates = (
        public_listings()
        .exclude(pk=listing.pk)
        .annotate(
            normalized_rent=normalized_rent,
        )
    )
    # Do not manufacture relevance from the whole catalogue. A candidate must
    # share geography or a core physical/affordability trait.
    candidates = candidates.filter(
        Q(locality_id_cache=locality_id)
        | Q(unit__property__address__locality__district_id=district_id)
        | Q(normalized_rent__range=(broad_low, broad_high))
        | Q(unit__property__property_type=property_type)
        | Q(unit__space_type=space_type)
    )

    if amenity_ids:
        candidates = candidates.annotate(
            amenity_overlap=Count(
                "unit__unit_amenities__amenity_id",
                filter=Q(
                    unit__unit_amenities__removed_at__isnull=True,
                    unit__unit_amenities__amenity_id__in=amenity_ids,
                ),
                distinct=True,
            )
        )
    else:
        candidates = candidates.annotate(amenity_overlap=Value(0, output_field=IntegerField()))

    if property_amenity_ids:
        candidates = candidates.annotate(
            property_amenity_overlap=Count(
                "unit__property__property_amenities__amenity_id",
                filter=Q(
                    unit__property__property_amenities__removed_at__isnull=True,
                    unit__property__property_amenities__amenity_id__in=property_amenity_ids,
                ),
                distinct=True,
            )
        )
    else:
        candidates = candidates.annotate(
            property_amenity_overlap=Value(0, output_field=IntegerField())
        )

    return (
        candidates.annotate(
            location_score=location_score,
            affordability_score=affordability_score,
            physical_score=physical_score,
            rent_distance=Abs(F("normalized_rent") - Value(monthly_rent)),
        )
        .annotate(
            relevance_score=ExpressionWrapper(
                F("location_score")
                + F("affordability_score")
                + F("physical_score")
                + F("amenity_overlap") * Value(5)
                + F("property_amenity_overlap") * Value(5),
                output_field=IntegerField(),
            )
        )
        .select_related("unit__property__address__locality__district", "created_by")
        .prefetch_related("media__file", "unit__media__file", "highlighted_amenities")
        .order_by("-relevance_score", "rent_distance", "-created_at")[:limit]
    )
