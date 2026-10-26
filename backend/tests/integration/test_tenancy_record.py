"""Tenancy as a record, distinct from the agreement and from the room.

Three things were conflated. The lease is what was agreed, the occupancy is
where somebody is, and the tenancy is the arrangement that outlives both — the
thing rent, maintenance and disputes are actually about.

Also pinned here: the P7 defect this phase found. Accepting a lease for one bed
allocated the whole room, so a four-bed hostel still held one tenant.
"""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.tenancy.models import Tenancy, TenancyStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def hostel(landlord, approve_provider, db):
    """A room with four beds, on a property the landlord genuinely holds."""
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import (
        Bed,
        Property,
        PropertyRelationship,
        PropertyRelationshipType,
        PropertyType,
        Unit,
    )

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Adentan Municipal"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="Adenta"
    )
    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title="Legon Hostel",
        property_type=PropertyType.HOSTEL,
        address=Address.objects.create(locality=locality, street="1 Hostel Road"),
    )
    PropertyRelationship.objects.create(
        property=prop,
        user=landlord,
        relationship_type=PropertyRelationshipType.OWNER,
        granted_by=landlord,
    )
    approve_provider(landlord, prop)
    unit = Unit.objects.create(
        property=prop,
        label="Room 4",
        bedrooms=1,
        bathrooms=1,
        space_type="room",
    )
    beds = [Bed.objects.create(unit=unit, label=f"Bed {n}", sort_order=n) for n in range(1, 5)]
    return prop, unit, beds


def _terms(**overrides):
    data = {
        "rent_minor": 90000,
        "rent_currency": "GHS",
        "starts_on": date.today(),
        "term_months": 12,
        "advance_months": 6,
    }
    data.update(overrides)
    return data


def _let(landlord, unit, tenant, bed=None, **terms):
    from apps.lease import services

    lease = services.draft_lease(
        user=landlord, unit=unit, tenant=tenant, bed=bed, data=_terms(**terms)
    )
    services.offer_lease(lease=lease, user=landlord)
    services.accept_lease(lease=lease, user=tenant)
    lease.refresh_from_db()
    return lease


def _activation_record(landlord, unit, tenant, bed=None, starts_on=None):
    """Minimal accepted-agreement evidence for tenancy service seam tests."""
    from apps.lease.models import Lease, LeaseStatus

    return Lease.objects.create(
        unit=unit,
        bed=bed,
        landlord=landlord,
        tenant=tenant,
        status=LeaseStatus.ACTIVE,
        rent_minor=90000,
        starts_on=starts_on or date.today(),
        term_months=12,
    )


class TestABedLeaseAllocatesTheBed:
    """The P7 defect, found while building P8."""

    def test_accepting_a_bed_lease_does_not_take_the_whole_room(self, hostel, landlord, registered):
        from apps.occupancy.models import Occupancy

        _, unit, beds = hostel
        tenant = registered("0209670001")

        lease = _let(landlord, unit, tenant, bed=beds[0])

        occupancy = Occupancy.objects.get(user=tenant)
        assert occupancy.bed_id == beds[0].id, "a bed lease allocated the whole unit"
        assert occupancy.lease_id == lease.id

    def test_four_students_can_actually_move_in(self, hostel, landlord, registered):
        """The point of the whole exercise.

        P7 made four bed *leases* possible. Until the allocation followed the
        bed, accepting the first one took the room and the other three could
        not be honoured.
        """
        from apps.occupancy.models import Occupancy

        _, unit, beds = hostel
        for n, bed in enumerate(beds):
            _let(landlord, unit, registered(f"020967010{n}"), bed=bed)

        allocated = Occupancy.objects.filter(unit=unit, ended_at__isnull=True)
        assert allocated.count() == 4
        assert {o.bed_id for o in allocated} == {b.id for b in beds}


class TestTheRelationshipOutlivesTheOthers:
    def test_a_lease_and_its_allocation_share_one_tenancy(self, hostel, landlord, registered):
        from apps.occupancy.models import Occupancy

        _, unit, beds = hostel
        tenant = registered("0209670002")

        lease = _let(landlord, unit, tenant, bed=beds[0])
        occupancy = Occupancy.objects.get(user=tenant)

        assert lease.tenancy_id is not None
        assert lease.tenancy_id == occupancy.tenancy_id

    def test_a_second_agreement_on_the_same_space_joins_the_same_tenancy(
        self, hostel, landlord, registered
    ):
        """The renewal property, tested at the seam that provides it.

        There is no renewal *flow* yet — the live-lease constraint means one
        would have to end the outgoing lease first, and that is its own phase.
        What P8 guarantees is that when it is built, `ensure_tenancy` finds the
        existing relationship rather than opening a second one. Getting that
        backwards is what would split three years of history in two.
        """
        from apps.tenancy.services import ensure_tenancy

        prop, unit, beds = hostel
        tenant = registered("0209670003")
        _let(landlord, unit, tenant, bed=beds[0])

        existing = Tenancy.objects.get(tenant=tenant, unit=unit, bed=beds[0])
        again = ensure_tenancy(
            tenant=tenant,
            prop=prop,
            unit=unit,
            bed=beds[0],
            activation_lease=existing.activation_lease,
            actor=landlord,
        )

        assert Tenancy.objects.filter(tenant=tenant, unit=unit, bed=beds[0]).count() == 1
        assert again.status == TenancyStatus.ACTIVE

    def test_the_same_person_in_a_different_bed_is_a_different_tenancy(
        self, hostel, landlord, registered
    ):
        from apps.tenancy.services import ensure_tenancy

        prop, unit, beds = hostel
        tenant = registered("0209670004")

        first_lease = _activation_record(landlord, unit, tenant, bed=beds[0])
        second_lease = _activation_record(landlord, unit, tenant, bed=beds[1])
        first = ensure_tenancy(
            tenant=tenant, prop=prop, unit=unit, bed=beds[0], activation_lease=first_lease
        )
        second = ensure_tenancy(
            tenant=tenant, prop=prop, unit=unit, bed=beds[1], activation_lease=second_lease
        )

        assert first.id != second.id

    def test_ending_the_agreement_ends_the_relationship(self, hostel, landlord, registered):
        from apps.lease import services

        _, unit, beds = hostel
        tenant = registered("0209670005")
        lease = _let(landlord, unit, tenant, bed=beds[0])

        services.end_lease(lease=lease, user=landlord, reason="Term completed.", confirmed=True)

        tenancy = Tenancy.objects.get(tenant=tenant, unit=unit, bed=beds[0])
        assert tenancy.status == TenancyStatus.ENDED
        assert tenancy.ended_on is not None
        assert "agreement ended" in tenancy.ended_reason


class TestManyPerTenant:
    def test_a_tenant_may_hold_several_at_once(self, landlord, registered, approve_provider):
        """A shop in Accra and a room in Kumasi. Both live, neither primary."""
        from apps.geo.models import Address, District, Locality, Region
        from apps.property.models import Property, PropertyType, Unit
        from apps.tenancy.services import ensure_tenancy

        tenant = registered("0209670006")
        region = Region.objects.first() or Region.objects.create(name="Greater Accra")
        district = District.objects.filter(region=region).first() or District.objects.create(
            region=region, name="Adentan Municipal"
        )

        for title, place in [("Osu Shop", "Osu"), ("Kumasi Room", "Adenta")]:
            locality, _ = Locality.objects.get_or_create(district=district, name=place)
            prop = Property.objects.create(
                owner=landlord,
                managed_by=landlord,
                created_by=landlord,
                title=title,
                property_type=PropertyType.RESIDENTIAL,
                address=Address.objects.create(locality=locality, street=f"{title} Road"),
            )
            unit = Unit.objects.create(
                property=prop,
                label="Main",
                bedrooms=1,
                bathrooms=1,
            )
            activation_lease = _activation_record(landlord, unit, tenant)
            ensure_tenancy(
                tenant=tenant,
                prop=prop,
                unit=unit,
                activation_lease=activation_lease,
            )

        live = Tenancy.objects.filter(tenant=tenant, status__in=["upcoming", "active"])
        assert live.count() == 2

    def test_one_person_cannot_hold_the_same_space_twice(self, hostel, landlord, registered):
        """Not a claim about other people — that is the occupancy constraints."""
        from django.db import IntegrityError, transaction

        prop, unit, _ = hostel
        tenant = registered("0209670007")
        activation_lease = _activation_record(landlord, unit, tenant)
        Tenancy.objects.create(
            tenant=tenant,
            property=prop,
            unit=unit,
            activation_lease=activation_lease,
            status=TenancyStatus.ACTIVE,
        )

        with pytest.raises(IntegrityError), transaction.atomic():
            Tenancy.objects.create(
                tenant=tenant,
                property=prop,
                unit=unit,
                activation_lease=activation_lease,
                status=TenancyStatus.ACTIVE,
            )


class TestUpcomingIsNotActive:
    def test_a_tenancy_agreed_for_next_month_is_not_active_yet(self, hostel, landlord, registered):
        from apps.tenancy.services import ensure_tenancy

        prop, unit, _ = hostel
        tenant = registered("0209670008")

        tenancy = ensure_tenancy(
            tenant=tenant,
            prop=prop,
            unit=unit,
            activation_lease=_activation_record(
                landlord,
                unit,
                tenant,
                starts_on=timezone.now().date() + timedelta(days=30),
            ),
            starts_on=timezone.now().date() + timedelta(days=30),
        )

        assert tenancy.status == TenancyStatus.UPCOMING
        assert tenancy.is_live

    def test_the_due_ones_become_active(self, hostel, landlord, registered):
        from apps.tenancy.services import activate_due_tenancies, ensure_tenancy

        prop, unit, _ = hostel
        tenant = registered("0209670009")
        tenancy = ensure_tenancy(
            tenant=tenant,
            prop=prop,
            unit=unit,
            activation_lease=_activation_record(
                landlord,
                unit,
                tenant,
                starts_on=timezone.now().date() + timedelta(days=30),
            ),
            starts_on=timezone.now().date() + timedelta(days=30),
        )

        Tenancy.objects.filter(id=tenancy.id).update(
            started_on=timezone.now().date() - timedelta(days=1)
        )
        moved = activate_due_tenancies()

        tenancy.refresh_from_db()
        assert moved == 1
        assert tenancy.status == TenancyStatus.ACTIVE
        # Idempotent: running it again changes nothing.
        assert activate_due_tenancies() == 0


class TestThePortfolioReadsTenancies:
    @pytest.fixture
    def api(self):
        from rest_framework.test import APIClient

        return APIClient()

    def test_a_bed_tenancy_names_the_bed(self, api, sign_in_as, hostel, landlord, registered):
        _, unit, beds = hostel
        tenant = registered("0209670010")
        _let(landlord, unit, tenant, bed=beds[0])

        sign_in_as(api, user=tenant)
        rows = api.get("/api/v1/me/tenancies/").data

        assert len(rows) == 1
        assert rows[0]["space"]["bed_label"] == "Bed 1"
        assert rows[0]["status"] == TenancyStatus.ACTIVE
        assert rows[0]["lease"]["status"] == "active"

    def test_an_active_lease_with_rent_charges_still_renders_on_tenant_home(
        self, api, sign_in_as, hostel, landlord, registered
    ):
        """Activating a lease creates money rows; those rows must not make the
        whole tenancy portfolio fail while formatting the outstanding amount.
        """
        from apps.rent.services import build_schedule

        _, unit, beds = hostel
        tenant = registered("0209670012")
        lease = _let(landlord, unit, tenant, bed=beds[0])
        build_schedule(lease)

        sign_in_as(api, user=tenant)
        response = api.get("/api/v1/me/tenancies/")

        assert response.status_code == 200, response.data
        assert len(response.data) == 1
        next_due = response.data[0]["rent"]["next_due"]
        assert next_due["amount_formatted"] == "GH₵5,400.00"

    def test_an_ended_tenancy_leaves_the_portfolio(
        self, api, sign_in_as, hostel, landlord, registered
    ):
        from apps.lease import services

        _, unit, beds = hostel
        tenant = registered("0209670011")
        lease = _let(landlord, unit, tenant, bed=beds[0])

        services.end_lease(lease=lease, user=landlord, reason="Term completed.", confirmed=True)

        sign_in_as(api, user=tenant)
        assert api.get("/api/v1/me/tenancies/").data == []
