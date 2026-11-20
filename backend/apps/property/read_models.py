"""Prepared reads for the provider-facing Property collection.

The detail serializer answers policy and lifecycle questions as well as plain
model fields.  On a collection those answers must be prepared as a collection:
running the detail queries once per row made the Properties screen linear in
the number of buildings a provider manages.
"""

from __future__ import annotations


def property_management_expression(*, user):
    from django.db.models import BooleanField, Case, Exists, OuterRef, Value, When

    from apps.organization.models import MembershipRole, OrganizationMembership, PropertyAssignment
    from apps.organization.services import FULL_ORGANIZATION_ROLES

    from .models import PropertyRelationship, PropertyRelationshipType

    actor_id = getattr(user, "pk", None)
    actor_relationships = PropertyRelationship.objects.filter(
        property_id=OuterRef("pk"),
        user_id=actor_id,
        ended_at__isnull=True,
        relationship_type__in=PropertyRelationshipType.management_types(),
    )
    full_membership = OrganizationMembership.objects.filter(
        user_id=actor_id,
        ended_at__isnull=True,
        role__in=FULL_ORGANIZATION_ROLES,
        organization__is_active=True,
        organization__property_relationships__property_id=OuterRef("pk"),
        organization__property_relationships__ended_at__isnull=True,
    )
    assignment = PropertyAssignment.objects.filter(
        property_id=OuterRef("pk"),
        ended_at__isnull=True,
        membership__user_id=actor_id,
        membership__ended_at__isnull=True,
        membership__organization__is_active=True,
        membership__organization__property_relationships__property_id=OuterRef("pk"),
        membership__organization__property_relationships__ended_at__isnull=True,
        membership__role__in=[MembershipRole.PROPERTY_MANAGER, MembershipRole.STAFF],
    )
    return Case(
        When(owner_id=actor_id, then=Value(True)),
        When(managed_by_id=actor_id, then=Value(True)),
        When(condition=Exists(actor_relationships), then=Value(True)),
        When(condition=Exists(full_membership), then=Value(True)),
        When(condition=Exists(assignment), then=Value(True)),
        default=Value(bool(getattr(user, "is_staff", False))),
        output_field=BooleanField(),
    )


def property_list_queryset(queryset, *, user):
    """Add every relational value the Property collection reads."""
    from django.db.models import (
        Count,
        Exists,
        IntegerField,
        OuterRef,
        Prefetch,
        Subquery,
        Value,
    )
    from django.db.models.functions import Coalesce

    from apps.lease.models import OPEN_STATUSES, Lease
    from apps.listing.models import Listing
    from apps.occupancy.models import Occupancy
    from apps.organization.models import (
        OrganizationMembership,
        OrganizationPropertyRelationship,
    )

    from .models import Bed, PropertyAmenity, PropertyRelationship, Unit

    def related_count(rows, group, field="pk", *, distinct=False):
        counted = (
            rows.order_by()
            .values(group)
            .annotate(value=Count(field, distinct=distinct))
            .values("value")[:1]
        )
        return Coalesce(
            Subquery(counted, output_field=IntegerField()),
            Value(0),
            output_field=IntegerField(),
        )

    active_units = Unit.objects.filter(property_id=OuterRef("pk"), is_active=True)
    active_beds = Bed.objects.filter(unit__property_id=OuterRef("pk"), is_active=True)
    live_occupancies = Occupancy.objects.filter(property_id=OuterRef("pk"), ended_at__isnull=True)
    occupied_units = live_occupancies.filter(status__in=["pending_lease", "active"])
    open_leases = Lease.objects.filter(unit__property_id=OuterRef("pk"), status__in=OPEN_STATUSES)
    open_listings = Listing.objects.filter(
        unit__property_id=OuterRef("pk"),
        status__in=["draft", "pending_review", "active"],
    )

    actor_id = getattr(user, "pk", None)
    actor_memberships = OrganizationMembership.objects.filter(
        user_id=actor_id,
        ended_at__isnull=True,
        organization__is_active=True,
    )
    organization_relationships = (
        OrganizationPropertyRelationship.objects.filter(ended_at__isnull=True)
        .select_related("organization")
        .prefetch_related(
            Prefetch(
                "organization__memberships",
                queryset=actor_memberships,
                to_attr="_property_list_actor_memberships",
            )
        )
    )

    return (
        queryset.select_related(
            "video",
            "address__locality__district__region",
            "address__locality__region",
            "owner",
            "provider_application",
        )
        .defer("address__locality__district__boundary")
        .prefetch_related(
            "media__file",
            Prefetch(
                "property_amenities",
                queryset=PropertyAmenity.objects.filter(removed_at__isnull=True).select_related(
                    "amenity"
                ),
                to_attr="_property_list_amenities",
            ),
            Prefetch(
                "relationships",
                queryset=PropertyRelationship.objects.filter(
                    user_id=actor_id, ended_at__isnull=True
                ),
                to_attr="_property_list_actor_relationships",
            ),
            Prefetch(
                "organization_relationships",
                queryset=organization_relationships,
                to_attr="_property_list_organization_relationships",
            ),
        )
        .annotate(
            _property_list_can_manage=property_management_expression(user=user),
            _property_list_unit_count=related_count(active_units, "property_id"),
            _property_list_bed_count=related_count(active_beds, "unit__property_id"),
            _property_list_occupied_unit_count=related_count(
                occupied_units, "property_id", "unit_id", distinct=True
            ),
            _property_list_open_occupancy_count=related_count(live_occupancies, "property_id"),
            _property_list_open_lease_count=related_count(open_leases, "unit__property_id"),
            _property_list_open_listing_count=related_count(open_listings, "unit__property_id"),
            _property_list_has_occupancy_history=Exists(
                Occupancy.objects.filter(property_id=OuterRef("pk"))
            ),
            _property_list_has_lease_history=Exists(
                Lease.objects.filter(unit__property_id=OuterRef("pk"))
            ),
            _property_list_has_listing_history=Exists(
                Listing.all_objects.filter(unit__property_id=OuterRef("pk")).exclude(status="draft")
            ),
        )
    )


def prepare_property_reviews(prepared, *, include_photo_files=False) -> None:
    """Load the evidence and review state for an already scoped collection."""
    from django.db.models import Prefetch

    from apps.trust.models import SubjectType, Verification, VerificationEvidence
    from apps.trust.services import prime_subject_verifications

    from .models import PropertyProviderApplication

    if not prepared:
        return

    by_id = {str(row.pk): row for row in prepared}
    evidence = (
        Prefetch("evidence", queryset=VerificationEvidence.objects.select_related("file"))
        if include_photo_files
        else "evidence"
    )
    verification_rows = list(
        Verification.objects.filter(
            subject_type=SubjectType.PROPERTY,
            subject_id__in=by_id,
        )
        .select_related("queue_entry")
        .prefetch_related(evidence)
        .order_by("-created_at")
    )
    grouped: dict[str, list[Verification]] = {key: [] for key in by_id}
    for verification in verification_rows:
        grouped.setdefault(verification.subject_id, []).append(verification)

    for key, prop in by_id.items():
        prop._property_list_verifications = grouped.get(key, [])
        try:
            application = prop.provider_application
        except PropertyProviderApplication.DoesNotExist:
            application = None
        prop._property_list_provider_application = application

    prime_subject_verifications(
        subject_type=SubjectType.PROPERTY,
        subject_ids=by_id,
        rows=verification_rows,
    )


def prepare_property_list_rows(rows) -> list:
    from apps.sale.models import SaleListing
    from apps.sale.read_models import public_sales

    prepared = list(rows)
    prepare_property_reviews(prepared)
    for_sale = [prop.pk for prop in prepared if prop.is_for_sale]
    sales = {
        sale.property_id: sale for sale in SaleListing.objects.filter(property_id__in=for_sale)
    }
    public_properties = set(
        public_sales().filter(property_id__in=sales).values_list("property_id", flat=True)
    )
    for prop in prepared:
        prop._property_list_sale = sales.get(prop.pk)
        prop._property_list_sale_public = prop.pk in public_properties
    return prepared


def prepare_unit_card_rows(queryset) -> list:
    """Batch the verification, listing and occupancy facts rendered on Units."""
    from collections import defaultdict

    from django.db.models import Prefetch

    from apps.listing.models import Listing, ListingStatus, PublicationState
    from apps.listing.read_models import public_listings
    from apps.occupancy.services import unit_occupying_allocations
    from apps.trust.models import SubjectType, Verification, VerificationKind, VerificationStatus

    from .models import UnitAmenity, UnitMedia

    units = list(
        queryset.select_related("property").prefetch_related(
            Prefetch("media", queryset=UnitMedia.objects.select_related("file")),
            Prefetch(
                "unit_amenities",
                queryset=UnitAmenity.objects.filter(removed_at__isnull=True).select_related("amenity"),
            ),
        )
    )
    if not units:
        return units

    unit_ids = [unit.pk for unit in units]
    listings = (
        Listing.objects.filter(unit_id__in=unit_ids)
        .only("unit_id", "status", "publication_state", "moderation_state", "availability_state")
        .order_by("unit_id", "-created_at")
    )
    latest = {
        listing.unit_id: listing
        for listing in listings.exclude(status=ListingStatus.REJECTED).distinct("unit_id")
    }
    latest_published = {
        listing.unit_id: listing
        for listing in listings.filter(publication_state=PublicationState.PUBLISHED).distinct(
            "unit_id"
        )
    }
    occupied_ids = set(
        unit_occupying_allocations()
        .filter(unit_id__in=unit_ids)
        .order_by()
        .values_list("unit_id", flat=True)
        .distinct()
    )
    public_candidates = [
        row.pk
        for row in latest.values()
        if row.unit_id not in occupied_ids
        and row.publication_state == PublicationState.PUBLISHED
        and row.derived_status() == ListingStatus.ACTIVE
    ]
    public_ids = set(
        public_listings().filter(pk__in=public_candidates).values_list("pk", flat=True)
    )
    reviews = defaultdict(list)
    for review in (
        Verification.objects.filter(
            subject_type=SubjectType.SPACE,
            kind=VerificationKind.SPACE_CONDITION,
            subject_id__in=[str(pk) for pk in unit_ids],
        )
        .exclude(status=VerificationStatus.SUPERSEDED)
        .select_related("queue_entry")
        .prefetch_related("evidence")
        .order_by("-created_at")
    ):
        reviews[review.subject_id].append(review)

    for unit in units:
        publication = latest.get(unit.pk)
        unit._unit_card_availability = (unit.pk in occupied_ids, latest_published.get(unit.pk))
        unit._unit_card_publication = (
            publication,
            unit.pk in occupied_ids,
            publication is not None and publication.pk in public_ids,
        )
        unit._condition_reviews = reviews[str(unit.pk)]
    return units
