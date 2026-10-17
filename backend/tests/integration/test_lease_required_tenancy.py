"""The lease is the only gateway into an active Danpa HQ tenancy."""

from datetime import date

import pytest
from django.db import IntegrityError, transaction

pytestmark = pytest.mark.django_db


@pytest.fixture
def unit(landlord, approve_provider):
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import Property, Unit

    region, _ = Region.objects.get_or_create(name="Greater Accra")
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        address=Address.objects.create(locality=locality, street="Invariant Road"),
        title="Invariant House",
        property_type="apartment",
    )
    approve_provider(landlord, prop)
    return Unit.objects.create(property=prop, label="Flat A", bedrooms=1, bathrooms=1)


def _draft(landlord, user, unit, **extra):
    from apps.lease import services

    lease = services.draft_lease(
        user=landlord,
        unit=unit,
        tenant=user,
        data={"rent_minor": 120000, "starts_on": date.today(), "term_months": 12},
    )
    for field, value in extra.items():
        setattr(lease, field, value)
    if extra:
        lease.save(update_fields=[*extra.keys(), "updated_at"])
    return lease


def test_database_rejects_active_tenancy_without_an_activation_lease(landlord, user, unit):
    from apps.tenancy.models import Tenancy, TenancyStatus

    with pytest.raises(IntegrityError), transaction.atomic():
        Tenancy.objects.create(
            tenant=user,
            property=unit.property,
            unit=unit,
            status=TenancyStatus.ACTIVE,
        )


def test_database_rejects_active_occupancy_without_lease_and_tenancy(user, unit):
    from apps.occupancy.models import Occupancy, OccupancyStatus

    with pytest.raises(IntegrityError), transaction.atomic():
        Occupancy.objects.create(
            user=user,
            property=unit.property,
            unit=unit,
            status=OccupancyStatus.ACTIVE,
        )


def test_tenancy_service_rejects_a_draft_or_mismatched_activation_lease(landlord, user, unit):
    from apps.core.exceptions import ValidationFailed
    from apps.tenancy.services import ensure_tenancy

    lease = _draft(landlord, user, unit)

    with pytest.raises(ValidationFailed, match="active lease"):
        ensure_tenancy(
            tenant=user,
            prop=unit.property,
            unit=unit,
            activation_lease=lease,
        )


def test_acceptance_activates_one_linked_tenancy_and_occupancy(landlord, user, unit):
    from apps.lease import services
    from apps.lease.models import LeaseStatus
    from apps.occupancy.models import OccupancyStatus
    from apps.tenancy.models import TenancyStatus

    lease = services.offer_lease(lease=_draft(landlord, user, unit), user=landlord)
    lease = services.accept_lease(lease=lease, user=user)

    assert lease.status == LeaseStatus.ACTIVE
    tenancy = lease.tenancy
    assert tenancy.status == TenancyStatus.ACTIVE
    assert tenancy.activation_lease_id == lease.id
    occupancy = tenancy.occupancies.get()
    assert occupancy.status == OccupancyStatus.ACTIVE
    assert occupancy.lease_id == lease.id


def test_future_payment_gate_pauses_after_acceptance_until_confirmed(landlord, user, unit):
    from apps.lease import services
    from apps.lease.models import LeaseActivationRequirement, LeaseStatus
    from apps.occupancy.models import Occupancy
    from apps.tenancy.models import Tenancy

    lease = _draft(
        landlord,
        user,
        unit,
        activation_requirement=LeaseActivationRequirement.INITIAL_PAYMENT,
    )
    lease = services.offer_lease(lease=lease, user=landlord)
    lease = services.accept_lease(lease=lease, user=user)

    assert lease.status == LeaseStatus.AWAITING_ACTIVATION
    assert not Tenancy.objects.filter(tenant=user, unit=unit).exists()
    assert not Occupancy.objects.filter(user=user, unit=unit).exists()

    lease = services.activate_lease(
        lease=lease,
        actor=landlord,
        satisfied_requirement=LeaseActivationRequirement.INITIAL_PAYMENT,
    )

    assert lease.status == LeaseStatus.ACTIVE
    assert lease.tenancy.activation_lease_id == lease.id
