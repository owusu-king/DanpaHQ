"""Allocation is a period, and periods may not overlap.

The three failures this pins, all present before P1:

1. two allocations of the same bed for *different* months were refused, because
   the constraint asked "is it ended" rather than "does it overlap";
2. two *overlapping* allocations were accepted once `ended_at` was set;
3. a whole-unit allocation and per-bed allocations of the same unit were not
   mutually excluded at all.

Double-letting is the fraud this product exists to make impossible, so these
are constraint-level wherever Postgres can express them.
"""

from datetime import date, timedelta

import pytest
from django.db import IntegrityError, transaction

from apps.core.exceptions import Conflict

pytestmark = pytest.mark.django_db


def _hostel(landlord):
    """A property with one room and two beds in it."""
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import Bed, Property, PropertyType, Unit

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Adentan Municipal"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="Adenta"
    )
    address = Address.objects.create(locality=locality, street="Hostel Road")
    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title="Campus Hostel",
        property_type=PropertyType.HOSTEL,
        address=address,
    )
    room = Unit.objects.create(
        property=prop,
        label="Room A",
        space_type="room",
        bedrooms=1,
        bathrooms=1,
    )
    beds = [Bed.objects.create(unit=room, label=f"Bed {n}", sort_order=n) for n in (1, 2)]
    return prop, room, beds


JAN = date(2027, 1, 1)
APR = date(2027, 4, 1)
JUL = date(2027, 7, 1)
OCT = date(2027, 10, 1)


class TestTemporalOverlap:
    def test_the_same_bed_may_be_let_for_two_different_terms(self, landlord, user, registered):
        """The false positive that used to block legitimate future bookings."""
        from apps.occupancy.models import Occupancy

        prop, room, beds = _hostel(landlord)
        other = registered("0209880001")

        Occupancy.objects.create(
            user=user,
            property=prop,
            unit=room,
            bed=beds[0],
            starts_on=JAN,
            ends_on=APR,
        )
        # A different student, same bed, a later term. Nothing overlaps.
        Occupancy.objects.create(
            user=other,
            property=prop,
            unit=room,
            bed=beds[0],
            starts_on=JUL,
            ends_on=OCT,
        )

        assert Occupancy.objects.filter(bed=beds[0], ended_at__isnull=True).count() == 2

    def test_the_same_bed_cannot_be_let_twice_over(self, landlord, user, registered):
        from apps.occupancy.models import Occupancy

        prop, room, beds = _hostel(landlord)
        other = registered("0209880002")

        Occupancy.objects.create(
            user=user,
            property=prop,
            unit=room,
            bed=beds[0],
            starts_on=JAN,
            ends_on=OCT,
        )

        with pytest.raises(IntegrityError), transaction.atomic():
            Occupancy.objects.create(
                user=other,
                property=prop,
                unit=room,
                bed=beds[0],
                starts_on=APR,
                ends_on=JUL,
            )

    def test_a_handover_on_the_same_day_is_not_a_clash(self, landlord, user, registered):
        """`[)` bounds: one tenancy ending as another begins is normal."""
        from apps.occupancy.models import Occupancy

        prop, room, beds = _hostel(landlord)
        other = registered("0209880003")

        Occupancy.objects.create(
            user=user,
            property=prop,
            unit=room,
            bed=beds[0],
            starts_on=JAN,
            ends_on=APR,
        )
        Occupancy.objects.create(
            user=other,
            property=prop,
            unit=room,
            bed=beds[0],
            starts_on=APR,
            ends_on=JUL,
        )

        assert Occupancy.objects.filter(bed=beds[0], ended_at__isnull=True).count() == 2

    def test_two_open_ended_allocations_of_one_unit_are_refused(self, landlord, user, registered):
        """No dates at all means "all time", so a second one always overlaps."""
        from apps.occupancy.models import Occupancy

        prop, room, _ = _hostel(landlord)
        other = registered("0209880004")

        Occupancy.objects.create(user=user, property=prop, unit=room)

        with pytest.raises(IntegrityError), transaction.atomic():
            Occupancy.objects.create(user=other, property=prop, unit=room)

    def test_different_beds_in_one_room_do_not_clash(self, landlord, user, registered):
        """The whole point of bed-level inventory."""
        from apps.occupancy.models import Occupancy

        prop, room, beds = _hostel(landlord)
        other = registered("0209880005")

        Occupancy.objects.create(user=user, property=prop, unit=room, bed=beds[0])
        Occupancy.objects.create(user=other, property=prop, unit=room, bed=beds[1])

        assert Occupancy.objects.filter(unit=room, ended_at__isnull=True).count() == 2


class TestUnitVersusBed:
    """The case Postgres cannot express as one constraint, held in the service."""

    def test_a_bed_cannot_be_let_while_the_whole_unit_is(self, landlord, user, registered):
        from apps.occupancy import services
        from apps.occupancy.models import Occupancy

        prop, room, beds = _hostel(landlord)
        Occupancy.objects.create(
            user=user,
            property=prop,
            unit=room,
            starts_on=JAN,
            ends_on=OCT,
        )

        with pytest.raises(Conflict) as refusal:
            services.assert_space_is_free(
                unit=room,
                bed=beds[0],
                starts_on=APR,
                ends_on=JUL,
            )

        assert "whole unit" in str(refusal.value).lower()

    def test_the_unit_cannot_be_let_whole_while_a_bed_is_taken(self, landlord, user):
        from apps.occupancy import services
        from apps.occupancy.models import Occupancy

        prop, room, beds = _hostel(landlord)
        Occupancy.objects.create(
            user=user,
            property=prop,
            unit=room,
            bed=beds[0],
            starts_on=JAN,
            ends_on=OCT,
        )

        with pytest.raises(Conflict) as refusal:
            services.assert_space_is_free(unit=room, starts_on=APR, ends_on=JUL)

        assert "bed in this unit" in str(refusal.value).lower()

    def test_the_two_levels_may_follow_each_other_in_time(self, landlord, user):
        """A room let whole this term and by the bed next term is fine."""
        from apps.occupancy import services
        from apps.occupancy.models import Occupancy

        prop, room, beds = _hostel(landlord)
        Occupancy.objects.create(
            user=user,
            property=prop,
            unit=room,
            starts_on=JAN,
            ends_on=APR,
        )

        # No exception: the whole-unit let has finished by then.
        services.assert_space_is_free(unit=room, bed=beds[0], starts_on=JUL, ends_on=OCT)

    def test_an_ended_allocation_stops_blocking(self, landlord, user):
        from django.utils import timezone

        from apps.occupancy import services
        from apps.occupancy.models import Occupancy

        prop, room, beds = _hostel(landlord)
        Occupancy.objects.create(
            user=user,
            property=prop,
            unit=room,
            starts_on=JAN,
            ends_on=OCT,
            ended_at=timezone.now(),
            status="ended",
        )

        services.assert_space_is_free(unit=room, bed=beds[0], starts_on=APR, ends_on=JUL)


class TestServiceMessages:
    def test_a_clash_is_a_sentence_not_an_integrity_error(self, landlord, user, registered):
        """The service checks first so people get something they can act on."""
        from apps.occupancy import services
        from apps.occupancy.models import Occupancy

        prop, room, beds = _hostel(landlord)
        Occupancy.objects.create(
            user=user,
            property=prop,
            unit=room,
            starts_on=JAN,
            ends_on=OCT,
        )

        with pytest.raises(Conflict):
            services.assert_space_is_free(
                unit=room,
                bed=beds[0],
                starts_on=JAN + timedelta(days=30),
                ends_on=APR,
            )
