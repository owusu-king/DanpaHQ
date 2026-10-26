"""Resource-scoped workspaces and private tenant access."""

from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict, PermissionDenied
from apps.rent.models import PaymentEvidence, PaymentSource

pytestmark = pytest.mark.django_db


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region = Region.objects.create(name="Greater Accra", code="ORG-GA")
    district = District.objects.create(region=region, name="Ayawaso West")
    locality = Locality.objects.create(district=district, name="Dzorwulu")
    return Address.objects.create(
        locality=locality,
        digital_address="GA-100-2000",
        street="Nii Nortei Nyanchi Street",
    )


def make_user(phone, name):
    from apps.identity.models import User

    user = User.objects.create_user(phone=phone, first_name=name, last_name="User")
    user.mark_phone_verified()
    return user


def verify_account(user):
    """Approve the person to operate here, and nothing about any property.

    Three account-level checks, all about the person: the number is theirs, the
    identity is real, and they are approved to act as a provider. None of them
    says anything about a building.
    """
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    for kind, method in (
        (VerificationKind.PHONE, VerificationMethod.AUTOMATED_OTP),
        (VerificationKind.IDENTITY, VerificationMethod.DOCUMENT_REVIEW),
        (VerificationKind.PROVIDER, VerificationMethod.DOCUMENT_REVIEW),
    ):
        Verification.objects.create(
            subject_type=SubjectType.USER,
            subject_id=str(user.id),
            kind=kind,
            method=method,
            status=VerificationStatus.APPROVED,
            submitted_by=user,
            decided_at=timezone.now(),
        )
    return user


def verify_space(unit):
    """Mark a rentable space as checked.

    Inviting somebody into a space now requires this. A tenant invited into a
    room nobody has looked at is the person least able to check it themselves,
    so the precondition is stated here rather than assumed.
    """
    from django.utils import timezone

    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    verification, _ = Verification.objects.get_or_create(
        subject_type=SubjectType.SPACE,
        subject_id=str(unit.id),
        kind=VerificationKind.SPACE_CONDITION,
        status=VerificationStatus.APPROVED,
        defaults={
            "method": VerificationMethod.DOCUMENT_REVIEW,
            "decided_at": timezone.now(),
        },
    )
    unit.refresh_from_db()
    return verification


def make_workspace(owner):
    from apps.organization import services
    from tests.conftest import upgrade_portfolio

    organization = services.create_organization(
        user=owner,
        data={
            "name": f"{owner.first_name} Properties",
            "organization_type": "individual_owner",
            "activities": ["residential"],
        },
    )
    # These tests are about Portfolio authority and scoping across several
    # properties and members, not about plan limits. Free includes one of each.
    upgrade_portfolio(organization, "BUSINESS")
    return organization


def make_private_property(owner, organization, address):
    """Create a property the way the product now allows one to be created.

    Provider standing is approved first because it is a precondition of the
    call, not a detail of these tests: a property is the root everything else
    hangs from, and only an approved provider may put one there.
    """
    from apps.property import services
    from tests.conftest import approve_provider_standing

    approve_provider_standing(owner)
    return services.create_private_property(
        user=owner,
        organization=organization,
        data={
            "title": "Dzorwulu Court",
            "property_type": "residential",
            "address_id": address.id,
        },
    )


class TestOrganizationActivities:
    def test_api_accepts_and_returns_commercial_activity(self, registered, sign_in_as):
        from apps.organization import services as organization_services
        from tests.conftest import approve_provider_standing

        owner = registered("0202000059", first_name="Commercial", account_type="provider")
        approve_provider_standing(owner)
        portfolio = organization_services.provision_provider_portfolio(user=owner)
        api = APIClient()
        sign_in_as(api, user=owner)

        # What a Portfolio does is the owner's to say, on the Portfolio Danpa HQ
        # provisioned for them.
        response = api.patch(
            f"/api/v1/organizations/{portfolio.id}/",
            {
                "name": "Market Street Portfolio",
                "organization_type": "property_company",
                "activities": ["residential", "commercial", "hostel"],
            },
            format="json",
        )

        assert response.status_code == 200, response.data
        assert set(response.data["activities"]) == {"residential", "commercial", "hostel"}


class TestOrganizationAuthorization:
    def test_pending_lease_occupancy_is_occupied_in_property_and_portfolio_rollups(
        self, address, registered
    ):
        from apps.occupancy.models import Occupancy, OccupancyStatus
        from apps.organization import services as organization_services
        from apps.property import services as property_services
        from apps.property.serializers import PropertySerializer

        owner = registered("0202000066", first_name="Rollup", account_type="provider")
        tenant = registered("0202000067", first_name="Resident")
        organization = make_workspace(owner)
        prop = make_private_property(owner, organization, address)
        unit = property_services.add_unit(
            prop=prop,
            user=owner,
            data={"label": "Flat 2", "space_type": "apartment", "bedrooms": 1},
        )
        Occupancy.objects.create(
            user=tenant,
            property=prop,
            unit=unit,
            status=OccupancyStatus.PENDING_LEASE,
            created_by=owner,
        )

        serializer = PropertySerializer()
        assert serializer.get_occupied_unit_count(prop) == 1
        assert serializer.get_vacant_unit_count(prop) == 0

        summary = organization_services.portfolio_summary(
            organization=organization,
            user=owner,
        )
        assert summary["counts"]["occupied_units"] == 1
        assert summary["counts"]["vacant_units"] == 0
        assert summary["counts"]["active_tenants"] == 0

    def test_portfolio_contains_scoped_tenancy_requests_and_unit_access(
        self, address, approve_provider, registered, sign_in_as
    ):
        from apps.occupancy import services as occupancy_services
        from apps.organization import services as organization_services
        from apps.property import access_codes
        from apps.property import services as property_services

        owner = registered("0202000064", first_name="Access", account_type="provider")
        tenant = registered("0202000065", first_name="Requesting")
        organization = make_workspace(owner)
        from tests.conftest import approve_provider_standing

        approve_provider_standing(owner)
        prop = property_services.create_private_property(
            user=owner,
            organization=organization,
            data={
                "title": "Osu Courtyard",
                "property_type": "residential",
                "address_id": address.id,
            },
        )
        approve_provider(owner, prop)
        unit = property_services.add_unit(
            prop=prop,
            user=owner,
            data={"label": "Flat 1", "space_type": "apartment", "bedrooms": 1},
        )
        verify_space(unit)
        unit, raw_code = access_codes.rotate(unit=unit, actor=owner)
        join_request = occupancy_services.create_join_request(
            user=tenant,
            prop=prop,
            unit=unit,
            access_code=raw_code,
            message="I would like this space.",
        )

        summary = organization_services.portfolio_summary(
            organization=organization,
            user=owner,
        )

        assert summary["counts"]["pending_join_requests"] == 1
        assert summary["tenancy_requests"] == [
            {
                "id": str(join_request.id),
                "requester_id": str(tenant.id),
                "requester_display": tenant.display_name,
                "property_id": str(prop.id),
                "property_title": "Osu Courtyard",
                "unit_id": str(unit.id),
                "unit_label": "Flat 1",
                "bed_id": None,
                "bed_label": None,
                "status": "pending",
                "message": "I would like this space.",
                "decision_note": "",
                "lease_id": None,
                "lease_status": None,
                "created_at": join_request.created_at.isoformat(),
                "can_manage": True,
            }
        ]
        assert summary["tenant_access"][0]["unit_id"] == str(unit.id)
        assert summary["tenant_access"][0]["condition_state"] == "approved"
        assert summary["tenant_access"][0]["access_code"]["state"] == "active"
        assert summary["tenant_access"][0]["access_code"]["can_rotate"] is True

        api = APIClient()
        sign_in_as(api, user=owner)
        response = api.get(f"/api/v1/organizations/{organization.id}/portfolio/")
        assert response.status_code == 200
        assert response.data["tenancy_requests"][0]["id"] == str(join_request.id)
        assert response.data["tenant_access"][0]["access_code"]["state"] == "active"

    def test_portfolio_tenant_rows_follow_each_occupancys_lease_and_tenancy(
        self, address, approve_provider, registered, sign_in_as
    ):
        """Two hostel beds in one Unit must never share a projected lease."""
        from apps.lease import services as lease_services
        from apps.organization import services as organization_services
        from apps.property import services as property_services
        from apps.rent import services as rent_services
        from apps.rent.models import RentCharge

        owner = registered("0202000060", first_name="Portfolio", account_type="provider")
        first_tenant = registered("0202000061", first_name="First")
        second_tenant = registered("0202000062", first_name="Second")
        stranger = registered("0202000063", first_name="Outside")
        organization = make_workspace(owner)
        from tests.conftest import approve_provider_standing

        approve_provider_standing(owner)
        prop = property_services.create_private_property(
            user=owner,
            organization=organization,
            data={
                "title": "Legon Hostel",
                "property_type": "hostel",
                "address_id": address.id,
            },
        )
        approve_provider(owner, prop)
        unit = property_services.add_unit(
            prop=prop,
            user=owner,
            data={"label": "Room 12", "space_type": "room", "bedrooms": 1},
        )
        first_bed = property_services.add_bed(
            unit=unit, user=owner, data={"label": "Bed A", "sort_order": 1}
        )
        second_bed = property_services.add_bed(
            unit=unit, user=owner, data={"label": "Bed B", "sort_order": 2}
        )

        def activate(tenant, bed, rent_minor):
            lease = lease_services.draft_lease(
                user=owner,
                unit=unit,
                bed=bed,
                tenant=tenant,
                data={
                    "rent_minor": rent_minor,
                    "starts_on": timezone.localdate(),
                    "term_months": 12,
                },
            )
            lease = lease_services.offer_lease(lease=lease, user=owner)
            return lease_services.accept_lease(lease=lease, user=tenant)

        first_lease = activate(first_tenant, first_bed, 100000)
        second_lease = activate(second_tenant, second_bed, 120000)
        first_charge = RentCharge.objects.create(
            lease=first_lease,
            kind="rent",
            amount_minor=25000,
            amount_currency="GHS",
            due_on=timezone.localdate() - timedelta(days=1),
        )
        payment = rent_services.record_payment(
            lease=first_lease,
            user=first_tenant,
            data={
                "charge_id": first_charge.id,
                "amount_minor": 10000,
                "paid_on": timezone.localdate(),
                "method": "momo",
            },
        )

        result = organization_services.portfolio_summary(organization=organization, user=owner)
        rows = {row["bed_id"]: row for row in result["tenants"]}

        assert rows[str(first_bed.id)]["lease_id"] == str(first_lease.id)
        assert rows[str(second_bed.id)]["lease_id"] == str(second_lease.id)
        assert rows[str(first_bed.id)]["tenancy_id"] == str(first_lease.tenancy_id)
        assert rows[str(second_bed.id)]["tenancy_id"] == str(second_lease.tenancy_id)
        assert rows[str(first_bed.id)]["rent"] == {
            "status": "overdue",
            "outstanding_minor": 25000,
            "overdue_minor": 25000,
            "next_due_on": (timezone.localdate() - timedelta(days=1)).isoformat(),
        }
        assert rows[str(second_bed.id)]["rent"]["status"] == "current"
        assert isinstance(rows[str(first_bed.id)]["can_record_payment"], bool)
        assert result["recent_payments"] == [
            {
                "id": str(payment.id),
                "lease_id": str(first_lease.id),
                "tenant_name": first_tenant.display_name,
                "property_title": "Legon Hostel",
                "unit_label": "Room 12",
                "amount_minor": 10000,
                "currency": "GHS",
                "status": "claimed",
                "paid_on": timezone.localdate().isoformat(),
                "method_display": "Mobile money",
                "recorded_by_tenant": True,
                "awaiting_you": True,
                "verification_source": "party_confirmation",
                # An off-platform claim says so on its face. These two are what
                # keep it visibly different from a PSP-confirmed transaction.
                "source": PaymentSource.EXTERNAL,
                "evidence": PaymentEvidence.AWAITING_COUNTERPARTY_CONFIRMATION,
            }
        ]

        owner_api = APIClient()
        sign_in_as(owner_api, user=owner)
        response = owner_api.get(f"/api/v1/organizations/{organization.id}/portfolio/")
        assert response.status_code == 200
        assert {row["tenancy_id"] for row in response.data["tenants"]} == {
            str(first_lease.tenancy_id),
            str(second_lease.tenancy_id),
        }
        assert response.data["past_tenants"] == []

        # Ending a tenancy moves the person to the Archive (owner, 2026-10-05):
        # out of `tenants`, into `past_tenants`, with the day they left.
        from apps.lease.services import end_lease

        second_lease.refresh_from_db()
        end_lease(lease=second_lease, user=owner, reason="Moved out", confirmed=True)
        response = owner_api.get(f"/api/v1/organizations/{organization.id}/portfolio/")
        assert {row["tenancy_id"] for row in response.data["tenants"]} == {
            str(first_lease.tenancy_id)
        }
        past = response.data["past_tenants"]
        assert [row["tenancy_id"] for row in past] == [str(second_lease.tenancy_id)]
        assert past[0]["ended_at"]

        outsider_api = APIClient()
        sign_in_as(outsider_api, user=stranger)
        assert (
            outsider_api.get(f"/api/v1/organizations/{organization.id}/portfolio/").status_code
            == 404
        )

    def test_payment_attention_counts_only_claims_the_provider_still_owes(
        self, address, approve_provider, registered, sign_in_as
    ):
        """A record the provider made is waiting on the tenant, not on them.

        The portfolio previously reported every unagreed claim as the
        provider's own queue, so recording three payments made Home announce
        three things to confirm. It also cut payment records to the ten most
        recent, which could hide the one claim actually awaiting an answer
        behind newer activity.
        """
        from apps.lease import services as lease_services
        from apps.organization import services as organization_services
        from apps.property import services as property_services
        from apps.rent import services as rent_services
        from apps.rent.models import RentCharge, RentPayment

        owner = registered("0202000070", first_name="Ledger", account_type="provider")
        tenant = registered("0202000071", first_name="Renter")
        organization = make_workspace(owner)
        from tests.conftest import approve_provider_standing

        approve_provider_standing(owner)
        prop = property_services.create_private_property(
            user=owner,
            organization=organization,
            data={
                "title": "Osu Court",
                "property_type": "residential",
                "address_id": address.id,
            },
        )
        approve_provider(owner, prop)
        unit = property_services.add_unit(
            prop=prop,
            user=owner,
            data={"label": "Flat 1", "space_type": "apartment", "bedrooms": 2},
        )
        lease = lease_services.draft_lease(
            user=owner,
            unit=unit,
            tenant=tenant,
            data={
                "rent_minor": 150000,
                "starts_on": timezone.localdate(),
                "term_months": 12,
            },
        )
        lease = lease_services.offer_lease(lease=lease, user=owner)
        lease = lease_services.accept_lease(lease=lease, user=tenant)
        charge = RentCharge.objects.create(
            lease=lease,
            kind="rent",
            amount_minor=150000,
            amount_currency="GHS",
            due_on=timezone.localdate(),
        )

        # The tenant's claim is the only thing the provider owes an answer to.
        tenant_claim = rent_services.record_payment(
            lease=lease,
            user=tenant,
            data={
                "charge_id": charge.id,
                "amount_minor": 50000,
                "paid_on": timezone.localdate() - timedelta(days=30),
                "method": "momo",
            },
        )
        # Twelve newer provider records: each waits on the tenant, and together
        # they are more than the recent window the summary used to return.
        for index in range(12):
            RentPayment.objects.create(
                lease=lease,
                amount_minor=1000,
                amount_currency="GHS",
                paid_on=timezone.localdate() - timedelta(days=index),
                method="cash",
                recorded_by=owner,
            )

        result = organization_services.portfolio_summary(organization=organization, user=owner)

        assert result["money"]["pending_payment_records"] == 13
        assert result["money"]["payment_records_awaiting_you"] == 1

        records = result["recent_payments"]
        assert records[0]["id"] == str(tenant_claim.id)
        assert records[0]["awaiting_you"] is True
        assert [row["awaiting_you"] for row in records[1:]] == [False] * (len(records) - 1)

    def test_portfolio_units_are_readable_in_one_call_and_scoped_to_the_member(
        self, address, approve_provider, registered, sign_in_as
    ):
        """Units were readable one Property at a time.

        A portfolio-wide Units screen therefore meant a request per Property,
        which is fine at five and unusable at fifty. The collection read has to
        respect the same scoping as everything else: a member assigned to one
        Property sees that Property's Units, not the Portfolio's.
        """
        from apps.organization import services as organization_services
        from apps.property import services as property_services

        owner = registered("0202000080", first_name="Inventory", account_type="provider")
        manager = registered("0202000081", first_name="Scoped")
        organization = make_workspace(owner)
        from tests.conftest import approve_provider_standing

        approve_provider_standing(owner)

        units_by_property = {}
        for index, title in enumerate(("Osu Court", "Legon House")):
            prop = property_services.create_private_property(
                user=owner,
                organization=organization,
                data={
                    "title": title,
                    "property_type": "residential",
                    "address_id": address.id,
                },
            )
            approve_provider(owner, prop)
            units_by_property[title] = [
                property_services.add_unit(
                    prop=prop,
                    user=owner,
                    data={"label": f"{title} unit {n}", "space_type": "apartment", "bedrooms": 1},
                )
                for n in range(1, 3 - index)
            ]

        owner_api = APIClient()
        sign_in_as(owner_api, user=owner)
        response = owner_api.get(f"/api/v1/organizations/{organization.id}/units/")
        assert response.status_code == 200

        labels = [row["label"] for row in response.data]
        assert labels == ["Legon House unit 1", "Osu Court unit 1", "Osu Court unit 2"]

        # Everything a Unit card renders, without going back to the Property.
        first = response.data[0]
        assert first["property_title"] == "Legon House"
        for field in ("availability", "verification", "publication", "primary_photo"):
            assert field in first

        # A member assigned to one Property sees only its Units.
        membership = organization_services.add_membership(
            organization=organization, actor=owner, user=manager, role="property_manager"
        )
        osu = next(
            prop
            for prop in organization_services.properties_for_organization_member(
                organization=organization, user=owner
            )
            if prop.title == "Osu Court"
        )
        organization_services.assign_property(
            organization=organization, property=osu, membership=membership, actor=owner
        )

        manager_api = APIClient()
        sign_in_as(manager_api, user=manager)
        scoped = manager_api.get(f"/api/v1/organizations/{organization.id}/units/")
        assert scoped.status_code == 200
        assert {row["property_title"] for row in scoped.data} == {"Osu Court"}

        stranger = registered("0202000082", first_name="Outside")
        outsider_api = APIClient()
        sign_in_as(outsider_api, user=stranger)
        assert (
            outsider_api.get(f"/api/v1/organizations/{organization.id}/units/").status_code == 404
        )

    def test_private_property_and_draft_do_not_require_publication_trust(self, address):
        from apps.core.exceptions import PermissionDenied
        from apps.listing import services as listing_services
        from apps.property import services as property_services

        owner = make_user("0202000001", "Ama")
        organization = make_workspace(owner)
        prop = make_private_property(owner, organization, address)
        unit = property_services.add_unit(
            prop=prop,
            user=owner,
            data={"label": "Flat 1", "space_type": "apartment", "bedrooms": 2, "bathrooms": 2},
        )
        listing = listing_services.create_listing(
            user=owner,
            unit=unit,
            data={
                "rent_minor": 300000,
                "headline": "Private draft",
                "description": "Not visible until trust and staff review are complete.",
            },
        )

        assert unit.access_code_hash is None, "a private draft is valid but has no access secret"
        assert listing.status == "draft"
        with pytest.raises(PermissionDenied):
            listing_services.publish_listing(listing=listing, user=owner)

        public = APIClient().get("/api/v1/listings/")
        assert public.status_code == 200
        assert public.data["results"] == []

    def test_private_claim_grants_inventory_but_not_high_trust_actions(self, address):
        from apps.lease import services as lease_services
        from apps.listing import services as listing_services
        from apps.property import services as property_services
        from apps.property.capabilities import property_capabilities

        claimant = make_user("0202000008", "Claimant")
        tenant = make_user("0202000009", "Tenant")
        prop = make_private_property(claimant, make_workspace(claimant), address)
        unit = property_services.add_unit(
            prop=prop,
            user=claimant,
            data={"label": "Private 1", "space_type": "apartment", "bedrooms": 1},
        )
        listing = listing_services.create_listing(
            user=claimant,
            unit=unit,
            data={"rent_minor": 100000, "headline": "Draft", "description": "Private"},
        )

        assert prop.created_by == claimant
        assert prop.owner_id is None
        assert not prop.relationships.exists()
        capabilities = property_capabilities(prop=prop, user=claimant)
        assert capabilities["private_inventory"]["allowed"] is True
        for capability in ("tenant_access", "leases", "payment_collection", "publication"):
            assert capabilities[capability]["allowed"] is False

        with pytest.raises(PermissionDenied):
            lease_services.draft_lease(
                user=claimant,
                unit=unit,
                tenant=tenant,
                data={"rent_minor": 100000, "starts_on": timezone.localdate()},
            )
        with pytest.raises(PermissionDenied):
            listing_services.publish_listing(listing=listing, user=claimant)

    def test_a_verified_account_still_cannot_place_a_tenant_in_an_unconfirmed_property(
        self, address
    ):
        """Knowing who the manager is is no longer enough on its own.

        This used to pass: private tenant management asked only about the person,
        on the reasoning that a private arrangement makes no claim to strangers
        and that blocking it would push the arrangement off the platform where
        nobody is protected.

        That gave away the wrong thing. A tenant handed keys to a property nobody
        has confirmed the provider holds is exactly the person least able to
        check it, and "it is private" is the framing under which that goes
        unexamined. Advertising and taking money already needed the property
        confirmed; placing somebody in it now does too.
        """
        from apps.lease import services as lease_services
        from apps.listing import services as listing_services
        from apps.property import services as property_services
        from apps.property.capabilities import property_capabilities

        manager = verify_account(make_user("0202000040", "Identity"))
        tenant = make_user("0202000041", "Tenant")
        prop = make_private_property(manager, make_workspace(manager), address)
        unit = property_services.add_unit(
            prop=prop,
            user=manager,
            data={"label": "Flat Identity", "space_type": "apartment", "bedrooms": 1},
        )
        listing_services.create_listing(
            user=manager,
            unit=unit,
            data={"rent_minor": 100000, "headline": "Draft", "description": "Private"},
        )

        capabilities = property_capabilities(prop=prop, user=manager)

        # Building inventory is still free: a property nobody has confirmed can
        # be described, and describing it is how the claim gets made at all.
        assert capabilities["private_inventory"]["allowed"] is True

        for capability in ("tenant_access", "leases", "publication", "payment_collection"):
            assert capabilities[capability]["allowed"] is False, capability
            assert "property_authority" in capabilities[capability]["missing"], capability

        # The lease path closes with it. Gating invitations alone would leave a
        # way to place somebody by drafting an agreement instead.
        with pytest.raises(PermissionDenied):
            lease_services.draft_lease(
                user=manager,
                unit=unit,
                tenant=tenant,
                data={"rent_minor": 100000, "starts_on": timezone.localdate()},
            )
        assert APIClient().get("/api/v1/listings/").data["results"] == []

    def test_property_authority_alone_does_not_replace_account_verification(self, address):
        """The reverse direction: an unidentified person holding an approved
        authority document still reaches nothing."""
        from apps.property import services as property_services
        from apps.property.capabilities import property_capabilities
        from apps.trust.models import (
            SubjectType,
            Verification,
            VerificationKind,
            VerificationMethod,
            VerificationStatus,
        )

        manager = make_user("0202000044", "Anonymous")
        prop = make_private_property(manager, make_workspace(manager), address)
        property_services.add_unit(
            prop=prop,
            user=manager,
            data={"label": "Flat Anon", "space_type": "apartment", "bedrooms": 1},
        )
        Verification.objects.create(
            subject_type=SubjectType.PROPERTY,
            subject_id=str(prop.id),
            kind=VerificationKind.PROPERTY_AUTHORITY,
            method=VerificationMethod.DOCUMENT_REVIEW,
            status=VerificationStatus.APPROVED,
            submitted_by=manager,
            decided_at=timezone.now(),
        )

        capabilities = property_capabilities(prop=prop, user=manager)

        assert capabilities["private_inventory"]["allowed"] is True
        assert capabilities["tenant_access"]["allowed"] is False
        # Provider standing is present — creating the property required it — so
        # what is left missing is the person: who they are, and that the number
        # is theirs. Neither is supplied by a document about a building.
        #
        # `property_authority` is missing too, and for a reason worth reading:
        # the verification above was approved but no `PropertyRelationship` was
        # ever written, and it is the relationship that says *this actor* holds
        # it. An approved document floating free of anybody is not authority.
        assert capabilities["tenant_access"]["missing"] == [
            "phone",
            "identity",
            "property_authority",
        ]
        assert capabilities["publication"]["allowed"] is False

    def test_verified_property_permits_advertising_but_stays_private_until_asked(
        self, address, approve_provider
    ):
        """Approving authority unlocks the *option* to advertise. It does not
        advertise anything: the property stays off the public index until
        someone publishes a listing for it."""
        from apps.property import access_codes
        from apps.property import services as property_services
        from apps.property.capabilities import property_capabilities

        manager = make_user("0202000042", "Verified")
        prop = make_private_property(manager, make_workspace(manager), address)
        unit = property_services.add_unit(
            prop=prop,
            user=manager,
            data={"label": "Flat Private", "space_type": "apartment", "bedrooms": 2},
        )
        approve_provider(manager, prop)

        capabilities = property_capabilities(prop=prop, user=manager)
        verify_space(unit)
        shared_unit, access_code = access_codes.rotate(unit=unit, actor=manager)

        assert capabilities["tenant_access"]["allowed"] is True
        assert capabilities["publication"]["allowed"] is True
        assert shared_unit.property == prop
        assert access_code
        assert APIClient().get("/api/v1/listings/").data["results"] == []

    def test_recording_external_payment_needs_authority_not_a_receiving_account(
        self, address, approve_provider
    ):
        from apps.lease import services as lease_services
        from apps.property import services as property_services
        from apps.rent import services as rent_services
        from apps.trust.models import Verification, VerificationKind, VerificationStatus

        owner = make_user("0202000030", "Verified")
        tenant = make_user("0202000031", "Tenant")
        prop = make_private_property(owner, make_workspace(owner), address)
        approve_provider(owner, prop)
        Verification.objects.filter(
            subject_id=str(owner.id), kind=VerificationKind.BANK_ACCOUNT
        ).update(status=VerificationStatus.REVOKED)
        unit = property_services.add_unit(
            prop=prop,
            user=owner,
            data={"label": "Flat Pay", "space_type": "apartment", "bedrooms": 1},
        )
        lease = lease_services.draft_lease(
            user=owner,
            unit=unit,
            tenant=tenant,
            data={"rent_minor": 100000, "starts_on": timezone.localdate()},
        )
        lease = lease_services.offer_lease(lease=lease, user=owner)
        lease = lease_services.accept_lease(lease=lease, user=tenant)

        payment_data = {
            "amount_minor": 100000,
            "paid_on": timezone.localdate(),
            "method": "momo",
        }
        # Recording an off-platform payment is evidence, not collection. The
        # cash or the MoMo transfer already reached the provider outside
        # Danpa HQ, so a Danpa HQ receiving account is deliberately irrelevant:
        # requiring one would make a landlord unable to acknowledge money they
        # have actually been paid. Property authority is still required.
        payment = rent_services.record_payment(lease=lease, user=tenant, data=payment_data)
        rent_services.confirm_payment(payment=payment, user=owner)

        # Collecting rent *through Danpa HQ* is reported separately, and it no
        # longer consults this person's `BANK_ACCOUNT` stamp at all: the money
        # routes to a Portfolio's provider-verified destination, so that is what
        # the readiness answers from. Revoking the personal stamp above is
        # therefore correctly irrelevant to both capabilities.
        from apps.property.capabilities import PropertyCapability, property_capabilities

        capabilities = property_capabilities(prop=prop, user=owner)
        assert capabilities[PropertyCapability.LEASES.value]["allowed"] is True
        assert capabilities[PropertyCapability.PAYMENT_COLLECTION.value]["allowed"] is True

        # And with no rail configured at all, nobody is told they are ready.
        with override_settings(PAYMENT_BACKEND=""):
            unavailable = property_capabilities(prop=prop, user=owner)[
                PropertyCapability.PAYMENT_COLLECTION.value
            ]
        assert unavailable["allowed"] is False
        assert unavailable["missing"] == ["payment_rail"]

        # Somebody with no authority over the property still cannot touch it.
        outsider = make_user("0202000032", "Outsider")
        with pytest.raises(PermissionDenied):
            rent_services.record_payment(lease=lease, user=outsider, data=payment_data)

    def test_assignment_scopes_manager_to_one_property(self, address):
        from apps.organization import services
        from apps.organization.models import MembershipRole
        from apps.property import services as property_services

        owner = make_user("0202000002", "Kofi")
        manager = make_user("0202000003", "Efua")
        organization = make_workspace(owner)
        first = make_private_property(owner, organization, address)
        second = make_private_property(owner, organization, address)
        membership = services.add_membership(
            organization=organization,
            actor=owner,
            user=manager,
            role=MembershipRole.PROPERTY_MANAGER,
        )

        assert not services.can_manage_property(prop=first, user=manager)
        services.assign_property(
            organization=organization,
            property=first,
            membership=membership,
            actor=owner,
        )
        assert services.can_manage_property(prop=first, user=manager)
        assert not services.can_manage_property(prop=second, user=manager)

        property_services.add_unit(
            prop=first,
            user=manager,
            data={"label": "Managed", "space_type": "apartment", "bedrooms": 1, "bathrooms": 1},
        )
        with pytest.raises(PermissionDenied):
            property_services.add_unit(
                prop=second,
                user=manager,
                data={"label": "Denied", "space_type": "apartment", "bedrooms": 1, "bathrooms": 1},
            )

    def test_private_expense_record_uses_resource_scope_not_ownership_verification(self, address):
        from apps.rent import services as rent_services

        owner = make_user("0202000040", "Expense")
        stranger = make_user("0202000041", "Stranger")
        organization = make_workspace(owner)
        prop = make_private_property(owner, organization, address)

        expense = rent_services.record_expense(
            organization=organization,
            prop=prop,
            user=owner,
            data={
                "amount_minor": 25000,
                "category": "maintenance",
                "incurred_on": timezone.localdate(),
                "note": "Replaced a lock",
            },
        )
        assert expense.amount_minor == 25000
        with pytest.raises(PermissionDenied):
            rent_services.record_expense(
                organization=organization,
                prop=prop,
                user=stranger,
                data={
                    "amount_minor": 100,
                    "incurred_on": timezone.localdate(),
                },
            )


class TestPrivateTenantAccess:
    def test_access_code_creates_a_request_not_a_tenancy(self, address, approve_provider):
        from apps.occupancy import services as occupancy_services
        from apps.property import access_codes
        from apps.property import services as property_services

        owner = make_user("0202000010", "Yaw")
        tenant = make_user("0202000011", "Adwoa")
        prop = make_private_property(owner, make_workspace(owner), address)
        approve_provider(owner, prop)
        unit = property_services.add_unit(
            prop=prop,
            user=owner,
            data={"label": "B204", "space_type": "apartment", "bedrooms": 2, "bathrooms": 1},
        )
        verify_space(unit)
        unit, share_code = access_codes.rotate(unit=unit, actor=owner)
        request = occupancy_services.create_join_request(
            user=tenant,
            prop=prop,
            unit=unit,
            access_code=share_code,
        )

        assert request.status == "pending"
        assert not tenant.occupancies.exists()
        assert not tenant.tenancies.exists()

    def test_access_code_requires_manager_approval(self, address, approve_provider):
        from apps.occupancy import services as occupancy_services
        from apps.property import access_codes
        from apps.property import services as property_services

        owner = make_user("0202000020", "Nana")
        tenant = make_user("0202000021", "Akos")
        prop = make_private_property(owner, make_workspace(owner), address)
        approve_provider(owner, prop)
        unit = property_services.add_unit(
            prop=prop,
            user=owner,
            data={"label": "Room 3", "space_type": "studio", "bedrooms": 0, "bathrooms": 1},
        )
        verify_space(unit)
        unit, raw_code = access_codes.rotate(unit=unit, actor=owner)
        join_request = occupancy_services.create_join_request(
            user=tenant,
            prop=prop,
            unit=unit,
            access_code=raw_code,
            message="I already rent this room.",
        )
        assert not tenant.occupancies.exists()

        decided, occupancy = occupancy_services.decide_join_request(
            join_request=join_request,
            actor=owner,
            approved=True,
        )
        assert decided.status == "approved"
        assert occupancy is None
        assert not tenant.occupancies.exists()
        assert not tenant.tenancies.exists()

    def test_tenant_can_join_another_unit_in_the_same_property(
        self, address, approve_provider, monkeypatch, registered, sign_in_as
    ):
        """Private access is exclusive by rentable space, not by Property."""
        from apps.occupancy import services as occupancy_services
        from apps.occupancy.models import Occupancy
        from apps.property import access_codes
        from apps.property import services as property_services
        from apps.tenancy.models import Tenancy

        owner = registered("0202000022", first_name="Esi", account_type="provider")
        tenant = registered("0202000023", first_name="Kojo")
        prop = make_private_property(owner, make_workspace(owner), address)
        approve_provider(owner, prop)
        first = property_services.add_unit(
            prop=prop,
            user=owner,
            data={"label": "Flat 1", "space_type": "apartment", "bedrooms": 1},
        )
        second = property_services.add_unit(
            prop=prop,
            user=owner,
            data={"label": "Flat 2", "space_type": "apartment", "bedrooms": 1},
        )
        verify_space(first)
        verify_space(second)

        first, first_code = access_codes.rotate(unit=first, actor=owner)
        first_request = occupancy_services.create_join_request(
            user=tenant,
            prop=prop,
            unit=first,
            access_code=first_code,
        )
        first_request, _ = occupancy_services.decide_join_request(
            join_request=first_request,
            actor=owner,
            approved=True,
        )
        from apps.lease import services as lease_services

        first_lease = lease_services.draft_lease(
            user=owner,
            unit=first,
            tenant=tenant,
            join_request=first_request,
            data={"rent_minor": 100000, "starts_on": timezone.localdate(), "term_months": 12},
        )
        first_lease = lease_services.offer_lease(lease=first_lease, user=owner)
        lease_services.accept_lease(lease=first_lease, user=tenant)

        # Access codes are revoked on occupancy, but the allocation boundary
        # must still refuse the exact same space if credential verification is
        # ever reached through a race or a future credential type.
        with monkeypatch.context() as patch:
            patch.setattr(access_codes, "verify", lambda *_args, **_kwargs: True)
            with pytest.raises(Conflict, match="occupied and is not accepting requests"):
                occupancy_services.create_join_request(
                    user=tenant,
                    prop=prop,
                    unit=first,
                    access_code="test-only-valid-code",
                )

        second, second_code = access_codes.rotate(unit=second, actor=owner)

        tenant_api = APIClient()
        sign_in_as(tenant_api, user=tenant)
        requested = tenant_api.post(
            f"/api/v1/properties/{prop.id}/join-requests/",
            {"unit_id": str(second.id), "access_code": second_code},
            format="json",
        )

        assert requested.status_code == 201, requested.data

        owner_api = APIClient()
        sign_in_as(owner_api, user=owner)
        approved = owner_api.post(
            f"/api/v1/join-requests/{requested.data['id']}/decision/",
            {"approved": True},
            format="json",
        )

        assert approved.status_code == 200, approved.data
        assert approved.data["occupancy_id"] is None
        assert approved.data["next_step"] == "provider_prepares_lease"

        from apps.occupancy.models import PropertyJoinRequest

        join_request = PropertyJoinRequest.objects.get(id=requested.data["id"])
        second_lease = lease_services.draft_lease(
            user=owner,
            unit=second,
            tenant=tenant,
            join_request=join_request,
            data={"rent_minor": 120000, "starts_on": timezone.localdate(), "term_months": 12},
        )
        second_lease = lease_services.offer_lease(lease=second_lease, user=owner)
        lease_services.accept_lease(lease=second_lease, user=tenant)
        active_occupancies = Occupancy.objects.filter(
            user=tenant, property=prop, ended_at__isnull=True
        )
        assert active_occupancies.count() == 2
        assert Tenancy.objects.filter(tenant=tenant, property=prop, status="active").count() == 2
        assert set(active_occupancies.values_list("unit_id", flat=True)) == {first.id, second.id}
