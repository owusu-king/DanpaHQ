"""What was agreed, by whom, and what may be let separately.

Three things this phase had to fix:

* A four-bed hostel room admitted one live lease in total, because the
  constraint was keyed on the unit. The arrangement most students in this
  market actually rent under could not be recorded.
* The terms lived only on a mutable row. "We agreed six months, not twelve"
  had no answer except the row as it stands today.
* The advance rent position was a constant in a comparison rather than a
  decision an operator could make.
"""

import pytest
from django.test import override_settings

from apps.core.exceptions import Conflict, ValidationFailed
from apps.lease.models import LeaseStatus

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
    from datetime import date

    data = {
        "rent_minor": 90000,
        "rent_currency": "GHS",
        "starts_on": date(2026, 9, 1),
        "term_months": 12,
        "advance_months": 6,
        "conditions": "Water included. Prepaid electricity meter.",
    }
    data.update(overrides)
    return data


class TestABedCanBeLet:
    """The constraint that made a four-bed room a one-lease room."""

    def test_every_bed_in_a_room_can_have_its_own_lease(self, hostel, landlord, registered):
        from apps.lease import services

        _, unit, beds = hostel

        for n, bed in enumerate(beds):
            tenant = registered(f"02096600{n:02d}")
            lease = services.draft_lease(
                user=landlord, unit=unit, tenant=tenant, bed=bed, data=_terms()
            )
            services.offer_lease(lease=lease, user=landlord)

        from apps.lease.models import Lease

        assert Lease.objects.filter(unit=unit, status=LeaseStatus.OFFERED).count() == 4

    def test_the_same_bed_cannot_be_let_twice(self, hostel, landlord, registered):
        from apps.lease import services

        _, unit, beds = hostel
        services.draft_lease(
            user=landlord,
            unit=unit,
            tenant=registered("0209660010"),
            bed=beds[0],
            data=_terms(),
        )

        with pytest.raises(Conflict):
            services.draft_lease(
                user=landlord,
                unit=unit,
                tenant=registered("0209660011"),
                bed=beds[0],
                data=_terms(),
            )

    def test_letting_the_room_whole_blocks_its_beds(self, hostel, landlord, registered):
        """The cross-level rule no unique constraint can express."""
        from apps.lease import services

        _, unit, beds = hostel
        services.draft_lease(
            user=landlord, unit=unit, tenant=registered("0209660012"), data=_terms()
        )

        with pytest.raises(Conflict):
            services.draft_lease(
                user=landlord,
                unit=unit,
                tenant=registered("0209660013"),
                bed=beds[0],
                data=_terms(),
            )

    def test_a_let_bed_blocks_letting_the_room_whole(self, hostel, landlord, registered):
        from apps.lease import services

        _, unit, beds = hostel
        services.draft_lease(
            user=landlord,
            unit=unit,
            tenant=registered("0209660014"),
            bed=beds[0],
            data=_terms(),
        )

        with pytest.raises(Conflict):
            services.draft_lease(
                user=landlord, unit=unit, tenant=registered("0209660015"), data=_terms()
            )

    def test_a_bed_from_another_unit_is_refused(self, hostel, landlord, registered):
        from apps.lease import services
        from apps.property.models import Bed, Unit

        prop, unit, _ = hostel
        other = Unit.objects.create(
            property=prop,
            label="Room 5",
            bedrooms=1,
            bathrooms=1,
            space_type="room",
        )
        stray = Bed.objects.create(unit=other, label="Bed 1")

        with pytest.raises(ValidationFailed):
            services.draft_lease(
                user=landlord,
                unit=unit,
                tenant=registered("0209660016"),
                bed=stray,
                data=_terms(),
            )


class TestTheTermsAreFrozen:
    def test_offering_records_what_was_agreed(self, hostel, landlord, registered):
        from apps.lease import services

        _, unit, beds = hostel
        tenant = registered("0209660020")
        lease = services.draft_lease(
            user=landlord, unit=unit, tenant=tenant, bed=beds[0], data=_terms()
        )
        services.offer_lease(lease=lease, user=landlord)
        lease.refresh_from_db()

        agreement = lease.agreement
        assert agreement.content_hash
        assert agreement.terms["money"]["advance_months"] == 6
        assert agreement.terms["space"]["bed_label"] == "Bed 1"
        assert "Prepaid electricity" in agreement.terms["conditions"]
        # Offered, not executed: the tenant has not accepted yet.
        assert agreement.executed_at is None

    def test_the_snapshot_survives_the_lease_moving_on(self, hostel, landlord, registered):
        """The whole point. A later edit must not rewrite history."""
        from apps.lease import services

        _, unit, _ = hostel
        tenant = registered("0209660021")
        lease = services.draft_lease(
            user=landlord, unit=unit, tenant=tenant, data=_terms(term_months=6)
        )
        services.offer_lease(lease=lease, user=landlord)
        agreed_hash = lease.agreement.content_hash

        # Somebody changes the row afterwards.
        from apps.lease.models import Lease

        Lease.objects.filter(id=lease.id).update(term_months=12, rent_minor=250000)

        lease.refresh_from_db()
        assert lease.term_months == 12
        assert lease.agreement.terms["term"]["term_months"] == 6, "history was rewritten"
        assert lease.agreement.terms["money"]["rent_minor"] == 90000
        assert lease.agreement.content_hash == agreed_hash

    def test_the_hash_is_stable_and_order_independent(self):
        from apps.lease.execution import canonical_hash

        a = canonical_hash({"rent": 900, "term": {"months": 12, "starts": "2026-09-01"}})
        b = canonical_hash({"term": {"starts": "2026-09-01", "months": 12}, "rent": 900})

        assert a == b
        assert a != canonical_hash({"rent": 901, "term": {"months": 12}})

    def test_altered_terms_are_detected(self, hostel, landlord, registered):
        from apps.lease import execution, services

        _, unit, _ = hostel
        lease = services.draft_lease(
            user=landlord, unit=unit, tenant=registered("0209660022"), data=_terms()
        )
        services.offer_lease(lease=lease, user=landlord)
        agreement = lease.agreement

        assert execution.verify(agreement)["hash_matches"] is True

        terms = dict(agreement.terms)
        terms["money"] = {**terms["money"], "advance_months": 24}
        agreement.terms = terms
        agreement.save(update_fields=["terms", "updated_at"])

        assert execution.verify(agreement)["hash_matches"] is False


class TestWhoAcceptedAndWhen:
    def test_both_parties_are_recorded_separately(self, hostel, landlord, registered):
        from apps.lease import execution, services
        from apps.lease.models import AcceptanceParty

        _, unit, _ = hostel
        tenant = registered("0209660030")
        lease = services.draft_lease(user=landlord, unit=unit, tenant=tenant, data=_terms())
        services.offer_lease(lease=lease, user=landlord)

        # Only the provider so far.
        assert execution.verify(lease.agreement)["fully_accepted"] is False

        services.accept_lease(lease=lease, user=tenant)
        lease.refresh_from_db()
        agreement = lease.agreement

        parties = {a.party for a in agreement.acceptances.all()}
        assert parties == {AcceptanceParty.LANDLORD, AcceptanceParty.TENANT}
        assert execution.verify(agreement)["fully_accepted"] is True
        assert agreement.executed_at is not None
        assert lease.status == LeaseStatus.ACTIVE

    def test_each_party_accepted_the_same_words(self, hostel, landlord, registered):
        from apps.lease import services

        _, unit, _ = hostel
        tenant = registered("0209660031")
        lease = services.draft_lease(user=landlord, unit=unit, tenant=tenant, data=_terms())
        services.offer_lease(lease=lease, user=landlord)
        services.accept_lease(lease=lease, user=tenant)
        lease.refresh_from_db()

        for acceptance in lease.agreement.acceptances.all():
            assert acceptance.matches_agreement

    def test_a_lease_predating_this_phase_still_accepts(self, hostel, landlord, registered):
        """A lease offered before this phase existed has no agreement row.

        Reached the way a legacy row actually is - offered without ever going
        through `offer_lease` - rather than by deleting an agreement, which the
        PROTECT on acceptances rightly refuses.
        """
        from django.utils import timezone

        from apps.lease import services
        from apps.lease.models import Lease

        _, unit, _ = hostel
        tenant = registered("0209660032")
        lease = services.draft_lease(user=landlord, unit=unit, tenant=tenant, data=_terms())
        now = timezone.now()
        Lease.objects.filter(id=lease.id).update(
            status=LeaseStatus.OFFERED, offered_at=now, landlord_accepted_at=now
        )
        lease.refresh_from_db()

        services.accept_lease(lease=lease, user=tenant)
        lease.refresh_from_db()

        assert lease.status == LeaseStatus.ACTIVE


class TestTheAdvancePolicy:
    def test_the_default_states_the_position_without_refusing(self):
        from apps.lease import advance_policy

        assessment = advance_policy.assess(advance_months=24)

        assert assessment.stance == "warn"
        assert assessment.exceeds is True
        assert assessment.blocks is False
        assert assessment.requires_acknowledgement is True
        assert "not legal advice" in assessment.message

    def test_within_the_threshold_says_nothing(self):
        from apps.lease import advance_policy

        assessment = advance_policy.assess(advance_months=6)

        assert assessment.exceeds is False
        assert assessment.message == ""

    @override_settings(RENT_ADVANCE_POLICY={"stance": "block", "threshold_months": 6})
    def test_an_operator_can_refuse_without_a_code_change(self, hostel, landlord, registered):
        from apps.lease import services

        _, unit, _ = hostel
        lease = services.draft_lease(
            user=landlord,
            unit=unit,
            tenant=registered("0209660040"),
            data=_terms(advance_months=24),
        )

        with pytest.raises(ValidationFailed):
            services.offer_lease(lease=lease, user=landlord)

    @override_settings(RENT_ADVANCE_POLICY={"stance": "allow"})
    def test_allow_records_it_and_stays_quiet(self, hostel, landlord, registered):
        from apps.lease import services

        _, unit, _ = hostel
        lease = services.draft_lease(
            user=landlord,
            unit=unit,
            tenant=registered("0209660041"),
            data=_terms(advance_months=24),
        )
        services.offer_lease(lease=lease, user=landlord)
        lease.refresh_from_db()

        assert lease.status == LeaseStatus.OFFERED
        assert lease.agreement.advance_stance == "allow"

    @override_settings(RENT_ADVANCE_POLICY={"stance": "nonsense"})
    def test_a_misconfiguration_falls_back_to_warning(self):
        from apps.lease import advance_policy

        stance, threshold = advance_policy.configured()

        # Neither silently disabling the warning nor silently blocking leases.
        assert stance == "warn"
        assert threshold == 6

    def test_a_non_monthly_rent_is_not_judged(self):
        """Six months of advance does not mean the same thing on a yearly rent."""
        from apps.lease import advance_policy

        assessment = advance_policy.assess(advance_months=2, rent_period="yearly")

        assert assessment.exceeds is False
        assert assessment.stance == "allow"

    def test_the_stance_at_the_time_is_kept(self, hostel, landlord, registered):
        """The setting today does not tell you what was shown then."""
        from apps.lease import services

        _, unit, _ = hostel
        lease = services.draft_lease(
            user=landlord,
            unit=unit,
            tenant=registered("0209660042"),
            data=_terms(advance_months=24),
        )
        services.offer_lease(lease=lease, user=landlord)
        lease.refresh_from_db()

        assert lease.agreement.advance_stance == "warn"
        assert lease.agreement.advance_threshold_months == 6


class TestLettingABedClosesAUnitListing:
    def test_unit_level_applicants_are_rejected(self, hostel, landlord, registered):
        """A Unit listing has no bed target, so any bed allocation closes it."""
        from apps.application.models import ApplicationStatus, RentalApplication
        from apps.lease import services
        from apps.listing.models import Listing, ListingStatus

        _, unit, beds = hostel
        listing = Listing.objects.create(
            unit=unit,
            created_by=landlord,
            headline="Bed in a shared room",
            description="Four beds, one room.",
            rent_minor=90000,
            rent_currency="GHS",
            status=ListingStatus.ACTIVE,
        )
        hopeful = registered("0209660050")
        application = RentalApplication.objects.create(
            listing=listing,
            unit=unit,
            tenant=hopeful,
            status=ApplicationStatus.SUBMITTED,
        )

        lease = services.draft_lease(
            user=landlord,
            unit=unit,
            tenant=registered("0209660051"),
            bed=beds[0],
            listing=listing,
            data=_terms(),
        )
        services.offer_lease(lease=lease, user=landlord)
        services.accept_lease(lease=lease, user=lease.tenant)

        application.refresh_from_db()
        listing.refresh_from_db()
        assert application.status == ApplicationStatus.REJECTED
        assert listing.status == ListingStatus.WITHDRAWN


class TestOverHttp:
    """The evidence is only worth having if the views actually capture it."""

    @pytest.fixture
    def api(self):
        from rest_framework.test import APIClient

        return APIClient()

    def test_a_bed_lease_can_be_drafted_over_http(
        self, api, sign_in_as, hostel, landlord, registered
    ):
        _, unit, beds = hostel
        tenant = registered("0209660060")
        sign_in_as(api, user=landlord)

        response = api.post(
            "/api/v1/me/leases/",
            {
                "unit_id": str(unit.id),
                "bed_id": str(beds[0].id),
                "tenant_id": str(tenant.id),
                "rent_minor": 90000,
                "starts_on": "2026-09-01",
                "advance_months": 6,
            },
            format="json",
        )

        assert response.status_code == 201, response.data
        assert response.data["bed_label"] == "Bed 1"

    def test_a_bed_from_another_unit_is_refused_over_http(
        self, api, sign_in_as, hostel, landlord, registered
    ):
        from apps.property.models import Bed, Unit

        prop, unit, _ = hostel
        other = Unit.objects.create(
            property=prop,
            label="Room 9",
            bedrooms=1,
            bathrooms=1,
            space_type="room",
        )
        stray = Bed.objects.create(unit=other, label="Bed 1")
        tenant = registered("0209660061")
        sign_in_as(api, user=landlord)

        response = api.post(
            "/api/v1/me/leases/",
            {
                "unit_id": str(unit.id),
                "bed_id": str(stray.id),
                "tenant_id": str(tenant.id),
                "rent_minor": 90000,
                "starts_on": "2026-09-01",
            },
            format="json",
        )

        assert response.status_code == 404

    def test_the_circumstances_of_each_acceptance_are_kept(
        self, api, sign_in_as, hostel, landlord, registered
    ):
        from apps.lease import services
        from apps.lease.models import AcceptanceParty

        _, unit, _ = hostel
        tenant = registered("0209660062")
        lease = services.draft_lease(user=landlord, unit=unit, tenant=tenant, data=_terms())

        sign_in_as(api, user=landlord)
        offered = api.post(
            f"/api/v1/leases/{lease.id}/offer/",
            {},
            format="json",
            HTTP_USER_AGENT="RentalProvider/1.0",
        )
        assert offered.status_code == 200, offered.data

        api.credentials()
        sign_in_as(api, user=tenant)
        accepted = api.post(
            f"/api/v1/leases/{lease.id}/accept/",
            {"acknowledged": True},
            format="json",
            HTTP_USER_AGENT="RentalTenant/1.0",
        )
        assert accepted.status_code == 200, accepted.data

        lease.refresh_from_db()
        by_party = {a.party: a for a in lease.agreement.acceptances.all()}
        assert by_party[AcceptanceParty.LANDLORD].user_agent == "RentalProvider/1.0"
        assert by_party[AcceptanceParty.TENANT].user_agent == "RentalTenant/1.0"
        assert by_party[AcceptanceParty.TENANT].ip_address
        assert lease.agreement.advance_acknowledged is True

    def test_the_agreement_is_visible_on_the_lease(
        self, api, sign_in_as, hostel, landlord, registered
    ):
        from apps.lease import services

        _, unit, _ = hostel
        tenant = registered("0209660063")
        lease = services.draft_lease(
            user=landlord, unit=unit, tenant=tenant, data=_terms(advance_months=24)
        )
        services.offer_lease(lease=lease, user=landlord)

        sign_in_as(api, user=tenant)
        response = api.get(f"/api/v1/leases/{lease.id}/")

        assert response.status_code == 200
        assert response.data["agreement"]["content_hash"]
        assert response.data["agreement"]["executed_at"] is None
        assert response.data["agreement"]["terms"]["money"]["advance_months"] == 24
        assert response.data["agreement"]["terms"]["space"]["unit_id"] == str(unit.id)
        assert response.data["agreement"]["terms"]["conditions"] == lease.conditions
        notice = response.data["advance_notice"]
        assert notice["stance"] == "warn"
        assert notice["months"] == 24
        assert "not legal advice" in notice["message"]

    def test_tenant_acceptance_fails_closed_if_frozen_terms_no_longer_match_the_hash(
        self, api, sign_in_as, hostel, landlord, registered
    ):
        from apps.lease import services
        from apps.lease.models import AcceptanceParty, LeaseAgreement, LeaseStatus

        _, unit, _ = hostel
        tenant = registered("0209660099")
        lease = services.draft_lease(user=landlord, unit=unit, tenant=tenant, data=_terms())
        services.offer_lease(lease=lease, user=landlord)

        agreement = LeaseAgreement.objects.get(lease=lease)
        changed = dict(agreement.terms)
        changed["conditions"] = "Terms changed after the offer."
        agreement.terms = changed
        agreement.save(update_fields=["terms", "updated_at"])

        sign_in_as(api, user=tenant)
        response = api.post(
            f"/api/v1/leases/{lease.id}/accept/", {"acknowledged": True}, format="json"
        )

        assert response.status_code == 409
        lease.refresh_from_db()
        assert lease.status == LeaseStatus.OFFERED
        assert lease.tenant_accepted_at is None
        assert not agreement.acceptances.filter(party=AcceptanceParty.TENANT).exists()

    def test_a_lease_within_the_threshold_carries_no_notice(
        self, api, sign_in_as, hostel, landlord, registered
    ):
        from apps.lease import services

        _, unit, _ = hostel
        tenant = registered("0209660064")
        lease = services.draft_lease(
            user=landlord, unit=unit, tenant=tenant, data=_terms(advance_months=3)
        )
        services.offer_lease(lease=lease, user=landlord)

        sign_in_as(api, user=tenant)
        response = api.get(f"/api/v1/leases/{lease.id}/")

        assert response.data["advance_notice"] is None
        assert response.data["exceeds_statutory_advance"] is False
