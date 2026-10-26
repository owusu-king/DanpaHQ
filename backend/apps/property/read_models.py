"""Prepared reads for the provider-facing Property collection.

The detail serializer answers policy and lifecycle questions as well as plain
model fields.  On a collection those answers must be prepared as a collection:
running the detail queries once per row made the Properties screen linear in
the number of buildings a provider manages.
"""

from __future__ import annotations


def property_list_queryset(queryset, *, user):
    """Add every relational value the Property collection reads."""
    from django.db.models import (
        BooleanField,
        Case,
        Count,
        Exists,
        IntegerField,
        OuterRef,
        Prefetch,
        Subquery,
        Value,
        When,
    )
    from django.db.models.functions import Coalesce

    from apps.lease.models import OPEN_STATUSES, Lease
    from apps.listing.models import Listing
    from apps.occupancy.models import Occupancy
    from apps.organization.models import (
        MembershipRole,
        OrganizationMembership,
        OrganizationPropertyRelationship,
        PropertyAssignment,
    )
    from apps.organization.services import FULL_ORGANIZATION_ROLES

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
    actor_relationships = PropertyRelationship.objects.filter(
        property_id=OuterRef("pk"), user_id=actor_id, ended_at__isnull=True
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
        membership__role__in=[MembershipRole.PROPERTY_MANAGER, MembershipRole.STAFF],
    )
    can_manage = Case(
        When(owner_id=actor_id, then=Value(True)),
        When(managed_by_id=actor_id, then=Value(True)),
        When(condition=Exists(actor_relationships), then=Value(True)),
        When(condition=Exists(full_membership), then=Value(True)),
        When(condition=Exists(assignment), then=Value(True)),
        default=Value(bool(getattr(user, "is_staff", False))),
        output_field=BooleanField(),
    )

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
            "address__locality__district__region",
            "owner",
            "provider_application",
        )
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
            _property_list_can_manage=can_manage,
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


def prepare_property_list_rows(rows) -> list:
    """Load generic verification subjects once and attach them to each row."""
    from apps.trust.models import SubjectType, Verification
    from apps.trust.services import prime_subject_verifications

    from .models import PropertyProviderApplication

    prepared = list(rows)
    if not prepared:
        return prepared

    by_id = {str(row.pk): row for row in prepared}
    verification_rows = list(
        Verification.objects.filter(
            subject_type=SubjectType.PROPERTY,
            subject_id__in=by_id,
        )
        .select_related("queue_entry")
        .prefetch_related("evidence")
        .order_by("-created_at")
    )
    grouped = {key: [] for key in by_id}
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
    return prepared
