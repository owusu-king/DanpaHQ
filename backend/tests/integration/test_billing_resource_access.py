"""A downgrade restricts what is above the plan, and deletes nothing.

What is held here:

- going below a plan's limits never deletes a property, unit, tenancy,
  agreement or payment, and never changes a property's own lifecycle;
- what is above the allowance is restricted — winding down while a tenancy or
  an agreement runs, read-only once nothing does;
- the Portfolio chooses what stays fully active, and without a choice the
  documented fallback decides, never a client;
- nothing new starts on a restricted property or unit, whichever door the
  request came through, while everything already running carries on;
- more allowance makes restricted resources eligible, and only a person
  reactivates them.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.billing.models import (
    LIVE_STATUSES,
    AccessState,
    Entitlement,
    KeepActiveChoice,
    PortfolioPlanOverride,
    ResourceAccess,
    Subscription,
    SubscriptionStatus,
)
from apps.billing.services import (
    checkout_service,
    entitlement_service,
    lifecycle_service,
    resource_access_service,
    usage_service,
)
from apps.billing.services.resource_access_service import ResourceRestricted
from apps.core.exceptions import Conflict, NotFound, ValidationFailed
from apps.organization import services as organization_services
from apps.property import services as property_services
from tests.conftest import approve_provider_standing, upgrade_portfolio

pytestmark = pytest.mark.django_db


def _address(street):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, street=street)


@pytest.fixture
def portfolio(landlord):
    """A Portfolio with room to grow, as a paid plan would give it."""
    approve_provider_standing(landlord)
    organization = organization_services.create_organization(
        user=landlord,
        data={
            "name": "Osu Properties",
            "organization_type": "individual_owner",
            "activities": ["residential"],
        },
    )
    upgrade_portfolio(organization, "BUSINESS")
    return organization


def _property(landlord, portfolio, title, *, units=1, approve=None):
    prop = property_services.create_private_property(
        user=landlord,
        organization=portfolio,
        data={
            "title": title,
            "property_type": "residential",
            "address_id": _address(f"{title} Road").id,
        },
    )
    if approve is not None:
        approve(landlord, prop)
    spaces = [
        property_services.add_unit(
            prop=prop,
            user=landlord,
            data={"label": f"{title} {index + 1}", "space_type": "apartment", "bedrooms": 1},
        )
        for index in range(units)
    ]
    return prop, spaces


def _draft(landlord, tenant, unit):
    from apps.lease import services as lease_services

    return lease_services.draft_lease(
        user=landlord,
        unit=unit,
        tenant=tenant,
        data={
            "rent_minor": 150000,
            "advance_months": 1,
            "starts_on": date.today(),
            "term_months": 12,
        },
    )


def _active_lease(landlord, tenant, unit):
    from apps.lease import services as lease_services

    lease = lease_services.offer_lease(lease=_draft(landlord, tenant, unit), user=landlord)
    return lease_services.accept_lease(lease=lease, user=tenant)


def _to_free(portfolio, landlord, keep_active=None):
    return checkout_service.change_plan_without_payment(
        organization=portfolio, user=landlord, plan_code="FREE", keep_active=keep_active
    )


def _keep(*resources):
    return {"property_ids": [str(resource.id) for resource in resources]}


def state_of(*, prop=None, unit=None):
    return resource_access_service.effective_state(prop=prop, unit=unit)


def _paid_period(portfolio, *, ends_in=timedelta(days=20)):
    now = timezone.now()
    Subscription.objects.filter(
        billing_account__organization=portfolio, status__in=LIVE_STATUSES
    ).update(current_period_start=now - timedelta(days=10), current_period_end=now + ends_in)


class TestWithinTheLimits:
    def test_moving_to_free_within_its_limits_restricts_nothing(self, landlord, portfolio):
        prop, _ = _property(landlord, portfolio, "Only", units=2)

        _to_free(portfolio, landlord)

        assert entitlement_service.current_plan(organization=portfolio).code == "FREE"
        assert not ResourceAccess.objects.filter(organization=portfolio).exists()
        assert state_of(prop=prop) == AccessState.FULL


class TestAboveTheLimits:
    def test_nothing_is_deleted_and_the_excess_is_restricted(self, landlord, portfolio):
        from apps.property.models import Unit

        properties = [_property(landlord, portfolio, f"Block {index}")[0] for index in range(4)]

        _to_free(portfolio, landlord)

        # Everything is still held, with every unit, and no property's own record moved.
        assert usage_service.property_count(organization=portfolio) == 4
        assert Unit.objects.filter(property__in=properties, is_active=True).count() == 4
        for prop in properties:
            prop.refresh_from_db()
            assert prop.deleted_at is None
        # One runs in full; the rest are read-only, because nothing runs in them.
        states = [state_of(prop=prop) for prop in properties]
        assert states.count(AccessState.FULL) == 1
        assert states.count(AccessState.READ_ONLY) == 3

    def test_without_a_choice_the_busiest_property_is_kept(
        self, landlord, user, portfolio, approve_provider
    ):
        quiet, _ = _property(landlord, portfolio, "Quiet and old")
        busy, (busy_unit,) = _property(
            landlord, portfolio, "Busy and new", approve=approve_provider
        )
        _active_lease(landlord, user, busy_unit)

        _to_free(portfolio, landlord)

        assert state_of(prop=busy) == AccessState.FULL
        assert state_of(prop=quiet) == AccessState.READ_ONLY

    def test_without_a_choice_and_nothing_running_the_oldest_is_kept(self, landlord, portfolio):
        first, _ = _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")

        _to_free(portfolio, landlord)

        assert state_of(prop=first) == AccessState.FULL
        assert state_of(prop=second) == AccessState.READ_ONLY

    def test_units_above_the_allowance_are_restricted_inside_a_kept_property(
        self, landlord, portfolio
    ):
        prop, units = _property(landlord, portfolio, "Big block", units=7)

        _to_free(portfolio, landlord)

        assert state_of(prop=prop) == AccessState.FULL
        states = [state_of(unit=unit) for unit in units]
        # Free includes five; the five earliest stay fully active.
        assert states == [AccessState.FULL] * 5 + [AccessState.READ_ONLY] * 2


class TestChoosing:
    def test_the_chosen_property_stays_fully_active(self, landlord, portfolio):
        first, _ = _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        third, _ = _property(landlord, portfolio, "Third")

        _to_free(portfolio, landlord, keep_active=_keep(third))

        assert state_of(prop=third) == AccessState.FULL
        assert state_of(prop=first) == AccessState.READ_ONLY
        assert state_of(prop=second) == AccessState.READ_ONLY

    def test_the_quote_offers_the_choice_and_opens_on_what_would_happen(self, landlord, portfolio):
        first, _ = _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")

        offer = checkout_service.quote(organization=portfolio, plan_code="FREE", interval="monthly")
        choice = offer.resource_choice

        assert choice["required"] is True
        # The chooser settles these two; any other limit is not a choice.
        assert choice["covers"] == ["PROPERTY_LIMIT", "UNIT_LIMIT"]
        assert choice["limits"] == {"properties": 1, "units": 5}
        assert choice["active"] == {"properties": 2, "units": 2}
        assert [row["id"] for row in choice["properties"]] == [str(first.id), str(second.id)]
        assert choice["selected"]["property_ids"] == [str(first.id)]

    def test_no_choice_is_asked_for_when_everything_fits(self, landlord, portfolio):
        _property(landlord, portfolio, "Only")
        offer = checkout_service.quote(organization=portfolio, plan_code="FREE", interval="monthly")
        assert offer.resource_choice["required"] is False
        assert offer.resource_choice["properties"] == []

    def test_a_choice_beyond_the_plan_is_refused_and_nothing_changes(self, landlord, portfolio):
        first, _ = _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")

        with pytest.raises(ValidationFailed):
            _to_free(portfolio, landlord, keep_active=_keep(first, second))

        assert entitlement_service.current_plan(organization=portfolio).code == "BUSINESS"
        assert not ResourceAccess.objects.filter(organization=portfolio).exists()

    def test_units_can_be_chosen_inside_the_kept_property(self, landlord, portfolio):
        prop, units = _property(landlord, portfolio, "Big block", units=7)

        _to_free(
            portfolio,
            landlord,
            keep_active={
                "property_ids": [str(prop.id)],
                "unit_ids": [str(unit.id) for unit in units[2:]],
            },
        )

        assert [state_of(unit=unit) for unit in units[:2]] == [AccessState.READ_ONLY] * 2
        assert [state_of(unit=unit) for unit in units[2:]] == [AccessState.FULL] * 5

    def test_a_scheduled_downgrade_applies_the_choice_when_the_period_ends(
        self, landlord, portfolio
    ):
        upgrade_portfolio(portfolio, "PRO")
        first, _ = _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        _paid_period(portfolio)

        _to_free(portfolio, landlord, keep_active=_keep(second))
        # Still Pro for the rest of the paid period, so nothing is restricted yet.
        assert not ResourceAccess.objects.filter(organization=portfolio).exists()

        _paid_period(portfolio, ends_in=-timedelta(minutes=1))
        lifecycle_service.advance_subscriptions()

        assert entitlement_service.current_plan(organization=portfolio).code == "FREE"
        assert state_of(prop=second) == AccessState.FULL
        assert state_of(prop=first) == AccessState.READ_ONLY

    def test_keeping_the_plan_forgets_the_choice(self, landlord, portfolio):
        upgrade_portfolio(portfolio, "PRO")
        _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        _paid_period(portfolio)
        _to_free(portfolio, landlord, keep_active=_keep(second))
        assert KeepActiveChoice.objects.filter(organization=portfolio).exists()

        checkout_service.keep_current_plan(organization=portfolio, user=landlord)

        assert not KeepActiveChoice.objects.filter(organization=portfolio).exists()


class TestWhatAlreadyRuns:
    @pytest.fixture
    def tenanted(self, landlord, user, portfolio, approve_provider):
        kept, _ = _property(landlord, portfolio, "Kept")
        prop, (unit,) = _property(landlord, portfolio, "Tenanted", approve=approve_provider)
        lease = _active_lease(landlord, user, unit)
        _to_free(portfolio, landlord, keep_active=_keep(kept))
        return prop, unit, lease

    def test_a_restricted_property_with_a_tenancy_winds_down(self, tenanted):
        prop, unit, lease = tenanted
        lease.refresh_from_db()
        assert state_of(prop=prop) == AccessState.WIND_DOWN
        assert state_of(unit=unit) == AccessState.WIND_DOWN
        assert lease.status == "active"

    def test_rent_is_still_recorded_and_confirmed(self, landlord, user, tenanted):
        from apps.rent import services as rent_services
        from apps.rent.models import PaymentStatus

        _, _, lease = tenanted
        charge = next(
            charge for charge in rent_services.build_schedule(lease) if charge.outstanding_minor > 0
        )
        payment = rent_services.record_payment(
            lease=lease,
            user=landlord,
            data={
                "amount_minor": charge.outstanding_minor,
                "paid_on": date.today(),
                "charge_id": charge.id,
                "method": "momo",
            },
        )
        confirmed = rent_services.confirm_payment(payment=payment, user=user)

        assert confirmed.status == PaymentStatus.CONFIRMED
        assert rent_services.closing_financial_summary(lease=lease)["currency"] == "GHS"

    def test_upkeep_continues_while_it_winds_down(self, landlord, tenanted):
        from apps.property import spaces

        _, unit, _ = tenanted
        updated = spaces.update_space(unit=unit, user=landlord, data={"entrance_note": "Blue gate"})
        assert updated.entrance_note == "Blue gate"

    def test_ending_the_last_tenancy_makes_it_read_only(self, landlord, tenanted):
        from apps.lease import services as lease_services

        prop, unit, lease = tenanted
        lease_services.end_lease(lease=lease, user=landlord, reason="Moved out", confirmed=True)

        assert state_of(prop=prop) == AccessState.READ_ONLY
        assert state_of(unit=unit) == AccessState.READ_ONLY

    def test_the_sweep_catches_a_wind_down_that_ended_without_saying_so(self, tenanted):
        from apps.lease.models import Lease
        from apps.tenancy.models import Tenancy

        prop, unit, lease = tenanted
        Tenancy.objects.filter(unit=unit).update(status="ended")
        Lease.objects.filter(id=lease.id).update(status="ended")

        resource_access_service.sweep()

        assert state_of(prop=prop) == AccessState.READ_ONLY

    def test_an_offer_already_sent_can_still_be_accepted(
        self, landlord, user, portfolio, approve_provider
    ):
        from apps.lease import services as lease_services

        kept, _ = _property(landlord, portfolio, "Kept")
        prop, (unit,) = _property(landlord, portfolio, "Offered", approve=approve_provider)
        lease = lease_services.offer_lease(lease=_draft(landlord, user, unit), user=landlord)

        _to_free(portfolio, landlord, keep_active=_keep(kept))

        # An offer in a tenant's hands counts as running.
        assert state_of(prop=prop) == AccessState.WIND_DOWN
        lease = lease_services.accept_lease(lease=lease, user=user)
        assert lease.status == "active"


class TestNothingNewStarts:
    @pytest.fixture
    def restricted(self, landlord, portfolio, approve_provider, approve_space):
        kept, _ = _property(landlord, portfolio, "Kept")
        prop, (unit,) = _property(landlord, portfolio, "Restricted", approve=approve_provider)
        approve_space(unit)
        return kept, prop, unit

    def test_no_new_agreement_offer_or_renewal(self, landlord, user, portfolio, restricted):
        from apps.lease import services as lease_services
        from apps.property.models import Unit

        kept, prop, unit = restricted
        draft = _draft(landlord, user, unit)
        second_unit = Unit.objects.create(property=prop, label="Annex", bedrooms=1, bathrooms=1)
        running = _active_lease(landlord, user, second_unit)

        _to_free(portfolio, landlord, keep_active=_keep(kept))

        with pytest.raises(ResourceRestricted):
            lease_services.offer_lease(lease=draft, user=landlord)
        with pytest.raises(ResourceRestricted):
            _draft(landlord, user, unit)
        with pytest.raises(ResourceRestricted):
            lease_services.amend_lease(lease=running, user=landlord, data={})

    def test_no_new_listing_and_no_publication(self, landlord, portfolio, restricted):
        from apps.listing import services as listing_services

        kept, _, unit = restricted
        draft = listing_services.create_listing(
            user=landlord,
            unit=unit,
            data={"rent_minor": 120000, "headline": "Bright room", "description": "Near the beach"},
        )

        _to_free(portfolio, landlord, keep_active=_keep(kept))

        with pytest.raises(ResourceRestricted):
            listing_services.publish_listing(listing=draft, user=landlord)

    def test_a_listing_up_before_leaves_discovery_and_takes_no_requests(
        self, landlord, user, portfolio, restricted
    ):
        from apps.application import services as application_services
        from apps.listing import services as listing_services
        from apps.listing.models import AvailabilityState, ModerationState, PublicationState
        from apps.listing.read_models import public_listings
        from apps.viewing import services as viewing_services

        kept, prop, unit = restricted
        listing = listing_services.create_listing(
            user=landlord,
            unit=unit,
            data={"rent_minor": 120000, "headline": "Bright room", "description": "Near the beach"},
        )
        listing.publication_state = PublicationState.PUBLISHED
        listing.moderation_state = ModerationState.APPROVED
        listing.availability_state = AvailabilityState.AVAILABLE
        listing.save()
        assert public_listings().filter(id=listing.id).exists()

        _to_free(portfolio, landlord, keep_active=_keep(kept))

        listing.refresh_from_db()
        assert listing.status == "active", "the listing itself is left exactly as it was"
        assert not public_listings().filter(id=listing.id).exists()
        with pytest.raises(Conflict):
            application_services.submit_application(listing=listing, tenant=user, data={})
        with pytest.raises(Conflict):
            viewing_services.request_viewing(listing=listing, tenant=user)

        upgrade_portfolio(portfolio, "PRO")
        assert not public_listings().filter(id=listing.id).exists(), "nothing comes back by itself"
        resource_access_service.reactivate(
            organization=portfolio, user=landlord, property_ids=[str(prop.id)]
        )
        assert public_listings().filter(id=listing.id).exists()

    def test_an_access_code_shared_before_opens_nothing_now(
        self, landlord, user, portfolio, restricted
    ):
        from apps.occupancy import services as occupancy_services
        from apps.property import access_codes

        kept, prop, unit = restricted
        unit, raw = access_codes.rotate(unit=unit, actor=landlord)

        _to_free(portfolio, landlord, keep_active=_keep(kept))

        with pytest.raises(NotFound):
            occupancy_services.create_join_request(user=user, prop=prop, unit=unit, access_code=raw)
        with pytest.raises(ResourceRestricted):
            access_codes.rotate(unit=unit, actor=landlord)

    def test_no_new_unit_building_or_bed(self, landlord, portfolio, restricted):
        kept, prop, unit = restricted
        _to_free(portfolio, landlord, keep_active=_keep(kept))

        with pytest.raises(ResourceRestricted):
            property_services.add_unit(
                prop=prop, user=landlord, data={"label": "New", "space_type": "apartment"}
            )
        with pytest.raises(ResourceRestricted):
            property_services.add_building(prop=prop, user=landlord, data={"name": "Block B"})
        with pytest.raises(ResourceRestricted):
            property_services.add_bed(unit=unit, user=landlord, data={"label": "Bed 1"})

    def test_read_only_details_stay_as_they_are(self, landlord, portfolio):
        from apps.property import spaces

        kept, _ = _property(landlord, portfolio, "Kept")
        quiet, (quiet_unit,) = _property(landlord, portfolio, "Quiet")
        _to_free(portfolio, landlord, keep_active=_keep(kept))

        with pytest.raises(ResourceRestricted):
            property_services.update_property(prop=quiet, user=landlord, data={"notes": "Painted"})
        with pytest.raises(ResourceRestricted):
            spaces.update_space(unit=quiet_unit, user=landlord, data={"label": "Renamed"})


class TestCapacity:
    def test_upgrading_makes_restricted_eligible_but_reactivates_nothing(self, landlord, portfolio):
        _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        _to_free(portfolio, landlord)

        upgrade_portfolio(portfolio, "PRO")
        assert state_of(prop=second) == AccessState.READ_ONLY

        resource_access_service.reactivate(
            organization=portfolio, user=landlord, property_ids=[str(second.id)]
        )
        assert state_of(prop=second) == AccessState.FULL

    def test_reactivating_needs_room(self, landlord, portfolio):
        _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        _to_free(portfolio, landlord)

        with pytest.raises(entitlement_service.PlanLimitReached):
            resource_access_service.reactivate(
                organization=portfolio, user=landlord, property_ids=[str(second.id)]
            )
        assert state_of(prop=second) == AccessState.READ_ONLY

    def test_archiving_a_fully_active_property_frees_its_place(self, landlord, portfolio):
        from apps.property import lifecycle

        first, _ = _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        _to_free(portfolio, landlord)

        lifecycle.archive_property(prop=first, actor=landlord, reason="Sold it")
        resource_access_service.reactivate(
            organization=portfolio, user=landlord, property_ids=[str(second.id)]
        )

        assert state_of(prop=second) == AccessState.FULL

    def test_a_reactivated_property_brings_back_only_the_units_there_is_room_for(
        self, landlord, portfolio
    ):
        kept, _ = _property(landlord, portfolio, "Kept", units=4)
        other, units = _property(landlord, portfolio, "Other", units=3)
        _to_free(portfolio, landlord, keep_active=_keep(kept))
        PortfolioPlanOverride.objects.create(
            organization=portfolio,
            entitlement=Entitlement.objects.get(key="PROPERTY_LIMIT"),
            value=2,
            reason="Room for one more property",
            created_by=landlord,
        )

        resource_access_service.reactivate(
            organization=portfolio, user=landlord, property_ids=[str(other.id)]
        )

        assert state_of(prop=other) == AccessState.FULL
        # Four units are already fully active under a limit of five: one comes back.
        assert [state_of(unit=unit) for unit in units].count(AccessState.FULL) == 1

    def test_restoring_an_archived_property_is_no_way_past_the_allowance(self, landlord, portfolio):
        from apps.property import lifecycle

        _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        lifecycle.archive_property(prop=second, actor=landlord, reason="Selling it")
        _to_free(portfolio, landlord)
        assert not ResourceAccess.objects.filter(organization=portfolio).exists()

        lifecycle.restore_property(prop=second, actor=landlord)

        assert state_of(prop=second) == AccessState.READ_ONLY

    def test_a_new_property_needs_a_place_that_is_fully_free(self, landlord, portfolio):
        from apps.property import lifecycle

        first, _ = _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        _to_free(portfolio, landlord)

        with pytest.raises(entitlement_service.PlanLimitReached):
            _property(landlord, portfolio, "Third")

        lifecycle.archive_property(prop=first, actor=landlord, reason="Sold it")
        third, _ = _property(landlord, portfolio, "Third")

        assert state_of(prop=third) == AccessState.FULL
        assert state_of(prop=second) == AccessState.READ_ONLY, "nothing was promoted on the way"

    def test_grace_running_out_restricts_what_is_above_free(self, landlord, portfolio):
        upgrade_portfolio(portfolio, "PRO")
        _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        ended = timezone.now() - timedelta(days=8)
        Subscription.objects.filter(
            billing_account__organization=portfolio, status__in=LIVE_STATUSES
        ).update(
            status=SubscriptionStatus.GRACE_PERIOD,
            current_period_start=ended,
            current_period_end=ended + timedelta(days=30),
            grace_expires_at=timezone.now() - timedelta(minutes=1),
        )

        lifecycle_service.advance_subscriptions()

        assert state_of(prop=second) == AccessState.READ_ONLY


class TestTheApi:
    def _api(self, sign_in_as, user, fingerprint):
        api = APIClient()
        sign_in_as(api, user=user, device_fingerprint=fingerprint)
        return api

    def test_the_billing_read_says_what_is_restricted(self, sign_in_as, landlord, portfolio):
        _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        _to_free(portfolio, landlord)

        api = self._api(sign_in_as, landlord, "access-read")
        response = api.get(f"/api/v1/organizations/{portfolio.id}/billing/")

        assert response.status_code == 200, response.data
        access = response.data["resource_access"]
        assert access["properties"] == {
            "active": 1,
            "wind_down": 0,
            "read_only": 1,
            "limit": 1,
            "available": 0,
        }
        assert [row["id"] for row in access["restricted"]] == [str(second.id)]
        assert response.data["usage"]["PROPERTY_COUNT"] == 2
        assert response.data["active_usage"]["PROPERTY_COUNT"] == 1

    def test_the_plan_change_carries_the_choice(self, sign_in_as, landlord, portfolio):
        first, _ = _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")

        api = self._api(sign_in_as, landlord, "access-choose")
        response = api.post(
            f"/api/v1/organizations/{portfolio.id}/billing/plan-change/",
            {"plan_code": "FREE", "keep_active": _keep(second)},
            format="json",
            HTTP_IDEMPOTENCY_KEY="billing-keep-active-0001",
        )

        assert response.status_code == 200, response.data
        assert state_of(prop=second) == AccessState.FULL
        assert state_of(prop=first) == AccessState.READ_ONLY

    def test_reactivation_is_an_endpoint_and_is_refused_without_room(
        self, sign_in_as, landlord, portfolio
    ):
        _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        _to_free(portfolio, landlord)
        api = self._api(sign_in_as, landlord, "access-reactivate")
        url = f"/api/v1/organizations/{portfolio.id}/billing/resource-access/reactivate/"

        refused = api.post(
            url,
            {"property_ids": [str(second.id)]},
            format="json",
            HTTP_IDEMPOTENCY_KEY="billing-reactivate-0001",
        )
        assert refused.status_code == 409, refused.data
        assert refused.data["error"]["code"] == "plan_limit_reached"

        upgrade_portfolio(portfolio, "PRO")
        accepted = api.post(
            url,
            {"property_ids": [str(second.id)]},
            format="json",
            HTTP_IDEMPOTENCY_KEY="billing-reactivate-0002",
        )
        assert accepted.status_code == 200, accepted.data
        assert accepted.data["resource_access"]["properties"]["read_only"] == 0

    def test_a_client_cannot_add_a_unit_to_a_restricted_property(
        self, sign_in_as, landlord, portfolio
    ):
        kept, _ = _property(landlord, portfolio, "Kept")
        prop, _ = _property(landlord, portfolio, "Restricted")
        _to_free(portfolio, landlord, keep_active=_keep(kept))

        api = self._api(sign_in_as, landlord, "access-bypass")
        response = api.post(
            f"/api/v1/properties/{prop.id}/units/",
            {"label": "Sneaky", "space_type": "apartment", "bedrooms": 1},
            format="json",
        )

        assert response.status_code == 409, response.data
        assert response.data["error"]["code"] == "resource_restricted"
        assert response.data["error"]["details"]["access_state"] == "read_only"

    def test_property_and_unit_reads_carry_their_access(self, sign_in_as, landlord, portfolio):
        kept, _ = _property(landlord, portfolio, "Kept")
        prop, (unit,) = _property(landlord, portfolio, "Restricted")
        _to_free(portfolio, landlord, keep_active=_keep(kept))

        api = self._api(sign_in_as, landlord, "access-presentation")
        restricted = api.get(f"/api/v1/properties/{prop.id}/")
        active = api.get(f"/api/v1/properties/{kept.id}/")
        space = api.get(f"/api/v1/units/{unit.id}/")

        assert restricted.status_code == 200, restricted.data
        assert restricted.data["billing_access"]["state"] == "read_only"
        assert restricted.data["billing_access"]["message"]
        assert active.data["billing_access"] == {
            "state": "full",
            "label": "Fully active",
            "message": "",
        }
        assert space.data["billing_access"]["state"] == "read_only"

    def test_a_non_owner_cannot_reactivate(self, landlord, agent, portfolio):
        from apps.core.exceptions import PermissionDenied

        _property(landlord, portfolio, "First")
        second, _ = _property(landlord, portfolio, "Second")
        _to_free(portfolio, landlord)
        upgrade_portfolio(portfolio, "PRO")

        with pytest.raises(PermissionDenied):
            resource_access_service.reactivate(
                organization=portfolio, user=agent, property_ids=[str(second.id)]
            )
        assert state_of(prop=second) == AccessState.READ_ONLY
