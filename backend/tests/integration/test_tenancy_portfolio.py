"""A tenant may hold more than one tenancy, and must be able to see all of them.

The defect this pins: `/me/occupancies/` returned a list, and both clients
collapsed it with `find(active) ?? [0] ?? null`, so a tenant renting two places
saw one — chosen arbitrarily — and had no way to reach the other.
"""

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


def _property_with_unit(landlord, title, locality_name="Adenta"):
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import Property, PropertyType, Unit

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Adentan Municipal"
    )
    locality, _ = Locality.objects.get_or_create(district=district, name=locality_name)
    address = Address.objects.create(locality=locality, street=f"{title} Road")

    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title=title,
        property_type=PropertyType.RESIDENTIAL,
        address=address,
    )
    unit = Unit.objects.create(
        property=prop,
        label="Main",
        bedrooms=2,
        bathrooms=1,
    )
    return prop, unit


def _house(user, landlord, title, locality="Adenta"):
    """A tenancy and the allocation under it, the way production makes them.

    P8 made the tenancy the record the portfolio reads, and every occupancy the
    product can create now opens one. Building a bare `Occupancy` here would
    describe a state the system no longer reaches.
    """
    from apps.lease.models import Lease, LeaseStatus
    from apps.occupancy.models import Occupancy
    from apps.tenancy.services import ensure_tenancy

    prop, unit = _property_with_unit(landlord, title, locality)
    lease = Lease.objects.create(
        unit=unit,
        landlord=landlord,
        tenant=user,
        status=LeaseStatus.ACTIVE,
        rent_minor=100000,
        starts_on=timezone.localdate(),
    )
    tenancy = ensure_tenancy(
        tenant=user,
        prop=prop,
        unit=unit,
        activation_lease=lease,
        actor=landlord,
    )
    lease.tenancy = tenancy
    lease.save(update_fields=["tenancy", "updated_at"])
    return Occupancy.objects.create(
        user=user,
        property=prop,
        unit=unit,
        tenancy=tenancy,
        lease=lease,
        status="active",
    )


@pytest.fixture
def two_tenancies(landlord, user, db):
    """One tenant, two homes. The case that used to be invisible."""
    return [
        _house(user, landlord, title, locality)
        for title, locality in [("Adenta Flat", "Adenta"), ("Osu Shop", "Osu")]
    ]


class TestPortfolio:
    def test_every_tenancy_is_returned(self, api, sign_in_as, user, two_tenancies):
        sign_in_as(api, user=user)

        response = api.get("/api/v1/me/tenancies/")

        assert response.status_code == 200
        assert len(response.data) == 2, "a second tenancy must not disappear"
        titles = {row["property"]["title"] for row in response.data}
        assert titles == {"Adenta Flat", "Osu Shop"}

    def test_each_tenancy_carries_its_own_context(self, api, sign_in_as, user, two_tenancies):
        """No shared 'current' anything: each row stands alone."""
        sign_in_as(api, user=user)

        rows = api.get("/api/v1/me/tenancies/").data

        for row in rows:
            assert row["id"]
            assert row["property"]["id"]
            assert row["property"]["locality"]
            assert row["space"]["unit_id"]
            assert "lease" in row
            assert "rent" in row

    def test_a_single_tenancy_is_still_just_one(self, api, sign_in_as, user, landlord):
        """The portfolio must not make one home feel like a filing cabinet."""
        _house(user, landlord, "Only Home")
        sign_in_as(api, user=user)

        rows = api.get("/api/v1/me/tenancies/").data

        assert len(rows) == 1

    def test_a_tenant_with_no_tenancy_gets_an_empty_list(self, api, sign_in_as, user):
        sign_in_as(api, user=user)

        response = api.get("/api/v1/me/tenancies/")

        assert response.status_code == 200
        assert response.data == []

    def test_one_tenants_homes_are_not_anothers(self, api, sign_in_as, two_tenancies, registered):
        """Scoped to the caller, like every other /me/ route."""
        stranger = registered("0209990001")
        sign_in_as(api, user=stranger)

        assert api.get("/api/v1/me/tenancies/").data == []

    def test_it_needs_a_session(self, api):
        assert api.get("/api/v1/me/tenancies/").status_code in (401, 403)


class TestWhatTheTenantsHomeNeeds:
    """Home has to answer "what am I renting" and "did anyone answer me".

    Neither was answerable before: the tenancy carried no photograph, so a home
    was a line of text on somebody's own front door; and a join request could
    only be read by the Property's managers, so the person who sent one had no
    way to learn it had been turned down.
    """

    def _photo(self, owner, name):
        from uuid import uuid4

        from apps.files.models import ScanStatus, StoredFile, UploadStatus

        return StoredFile.objects.create(
            storage_key=f"tenancy-photo/{uuid4()}-{name}",
            bucket="test",
            original_filename=name,
            declared_content_type="image/jpeg",
            content_type="image/jpeg",
            size_bytes=80_000,
            purpose="property_photo",
            is_sensitive=False,
            upload_status=UploadStatus.READY,
            scan_status=ScanStatus.CLEAN,
            uploaded_by=owner,
            owner_id_snapshot=str(owner.id),
        )

    def test_a_home_carries_its_own_photograph(self, api, sign_in_as, user, landlord):
        """The Unit's own primary photograph, not a listing cover.

        A tenancy may never have been advertised at all — most of this market
        is let privately — so a campaign photograph is the wrong source.
        """
        from apps.property.models import UnitMedia

        occupancy = _house(user, landlord, "Adenta Flat")
        # What is being let, so the card can name it when the Unit has no label.
        occupancy.unit.space_type = "apartment"
        occupancy.unit.save(update_fields=["space_type"])
        UnitMedia.objects.create(
            unit=occupancy.unit, file=self._photo(landlord, "side.jpg"), sort_order=1
        )
        UnitMedia.objects.create(
            unit=occupancy.unit,
            file=self._photo(landlord, "front.jpg"),
            is_primary=True,
            sort_order=0,
        )

        sign_in_as(api, user=user)
        row = api.get("/api/v1/me/tenancies/").data[0]

        assert "front.jpg" in row["photo_url"]
        assert row["space"]["space_type_label"] == "Apartment / flat"

    def test_a_home_without_a_photograph_says_so_rather_than_guessing(
        self, api, sign_in_as, user, landlord
    ):
        _house(user, landlord, "Adenta Flat")
        sign_in_as(api, user=user)

        assert api.get("/api/v1/me/tenancies/").data[0]["photo_url"] is None

    def test_the_person_who_sent_an_access_request_can_read_it(
        self, api, sign_in_as, user, landlord
    ):
        """Until now only the Property's managers could.

        No notification is emitted for the decision either, so a rejection was
        silent on every screen the requester could reach.
        """
        from apps.occupancy.models import JoinRequestStatus, PropertyJoinRequest

        prop, unit = _property_with_unit(landlord, "Osu Block")
        PropertyJoinRequest.objects.create(
            requester=user,
            property=prop,
            unit=unit,
            status=JoinRequestStatus.REJECTED,
            decision_note="That room is already taken.",
        )

        sign_in_as(api, user=user)
        response = api.get("/api/v1/me/join-requests/")

        assert response.status_code == 200
        assert len(response.data) == 1
        row = response.data[0]
        assert row["status"] == "rejected"
        assert row["property_title"] == "Osu Block"
        assert row["unit_label"] == "Main"
        assert row["decision_note"] == "That room is already taken."

    def test_one_persons_access_requests_are_not_anothers(
        self, api, sign_in_as, user, landlord, registered
    ):
        from apps.occupancy.models import PropertyJoinRequest

        prop, unit = _property_with_unit(landlord, "Osu Block")
        PropertyJoinRequest.objects.create(requester=user, property=prop, unit=unit)

        sign_in_as(api, user=registered("0209990002"))
        assert api.get("/api/v1/me/join-requests/").data == []

    def test_it_needs_a_session(self, api):
        assert api.get("/api/v1/me/join-requests/").status_code in (401, 403)
