"""The lifecycle policy: who may act, when, and what is preserved.

These pin ADR 0021. The rule under test throughout is that anything a
counterparty has seen or relied on survives — a provider may remove a draft
nobody saw, and nothing else.
"""

import pytest

from apps.core.exceptions import Conflict, PermissionDenied, ValidationFailed
from apps.core.policy import enforce, permitted_actions

pytestmark = pytest.mark.django_db


@pytest.fixture
def owned_property(landlord, db):
    """A property the landlord genuinely holds authority over."""
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import (
        Property,
        PropertyRelationship,
        PropertyRelationshipType,
        PropertyType,
    )

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Adentan Municipal"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="Adenta"
    )
    address = Address.objects.create(locality=locality, street="1 Test Road")

    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title="Test House",
        property_type=PropertyType.RESIDENTIAL,
        address=address,
    )
    PropertyRelationship.objects.create(
        property=prop,
        user=landlord,
        relationship_type=PropertyRelationshipType.OWNER,
        granted_by=landlord,
    )
    return prop


@pytest.fixture
def a_unit(owned_property):
    from apps.property.models import Unit

    return Unit.objects.create(
        property=owned_property,
        label="Main",
        bedrooms=2,
        bathrooms=1,
    )


class TestAuthorization:
    def test_authority_is_per_property_not_per_account(self, owned_property, agent):
        """Being a provider elsewhere is not authority here.

        The commonest way this goes wrong is treating organization membership,
        or a provider role, as authority over every property in reach.
        """
        from apps.property.policies import can_archive_property

        decision = can_archive_property(actor=agent, target=owned_property)

        assert not decision.allowed
        assert decision.code == "not_authorized"

    def test_the_holder_of_the_relationship_may_act(self, owned_property, landlord):
        from apps.property.policies import can_archive_property

        assert can_archive_property(actor=landlord, target=owned_property).allowed

    def test_an_ended_relationship_is_no_authority(self, owned_property, agent):
        """Somebody whose only tie was a relationship loses it when it ends.

        Tested on the agent rather than the landlord deliberately. The landlord
        is `owner` and `managed_by` on the row as well, so ending their
        relationship proves nothing — they still hold the property by two other
        routes, and an owner who may no longer archive their own building would
        be the bug rather than the rule.
        """
        from django.utils import timezone

        from apps.property.models import PropertyRelationship, PropertyRelationshipType
        from apps.property.policies import can_archive_property

        relationship = PropertyRelationship.objects.create(
            property=owned_property,
            user=agent,
            relationship_type=PropertyRelationshipType.AGENT,
            granted_by=owned_property.owner,
        )
        assert can_archive_property(actor=agent, target=owned_property).allowed

        relationship.ended_at = timezone.now()
        relationship.save(update_fields=["ended_at"])

        assert not can_archive_property(actor=agent, target=owned_property).allowed


class TestDestructionBecomesArchival:
    def test_a_property_with_a_tenant_cannot_be_archived(
        self, owned_property, a_unit, landlord, user
    ):
        from apps.occupancy.models import Occupancy
        from apps.property.policies import can_archive_property

        Occupancy.objects.create(user=user, property=owned_property, unit=a_unit)

        decision = can_archive_property(actor=landlord, target=owned_property)

        assert not decision.allowed
        assert decision.code == "has_dependents"
        # The refusal has to say what is in the way, or the person cannot act.
        assert any(b.kind == "tenancy" for b in decision.blockers)
        assert decision.blockers[0].count == 1

    def test_a_property_with_history_can_never_be_deleted(
        self, owned_property, a_unit, landlord, user
    ):
        """Even after everyone has left. The records are the point."""
        from django.utils import timezone

        from apps.occupancy.models import Occupancy
        from apps.property.policies import can_archive_property, can_delete_property

        Occupancy.objects.create(
            user=user,
            property=owned_property,
            unit=a_unit,
            ended_at=timezone.now(),
            status="ended",
        )

        # Archiving is fine once nobody is living there.
        assert can_archive_property(actor=landlord, target=owned_property).allowed

        # Deleting never is: a former tenant must still be able to read it.
        deletion = can_delete_property(actor=landlord, target=owned_property)
        assert not deletion.allowed
        assert deletion.code == "immutable"
        assert "archive" in deletion.message.lower()

    def test_an_untouched_property_may_be_deleted(self, owned_property, landlord):
        """Nobody has seen it, so there is no history to protect."""
        from apps.property.policies import can_delete_property

        decision = can_delete_property(actor=landlord, target=owned_property)

        assert decision.allowed
        assert decision.requires_confirmation
        assert decision.requires_reason

    def test_a_space_that_was_let_may_be_archived_but_not_deleted(
        self, owned_property, a_unit, landlord, user
    ):
        from django.utils import timezone

        from apps.occupancy.models import Occupancy
        from apps.property.policies import can_archive_space, can_delete_space

        Occupancy.objects.create(
            user=user,
            property=owned_property,
            unit=a_unit,
            ended_at=timezone.now(),
            status="ended",
        )

        assert can_archive_space(actor=landlord, target=a_unit).allowed
        assert not can_delete_space(actor=landlord, target=a_unit).allowed


class TestEnforcement:
    def test_a_refusal_to_authorize_is_403_not_409(self, owned_property, agent):
        from apps.property.policies import can_archive_property

        decision = can_archive_property(actor=agent, target=owned_property)
        with pytest.raises(PermissionDenied):
            enforce(decision)

    def test_a_dependent_record_is_409(self, owned_property, a_unit, landlord, user):
        from apps.occupancy.models import Occupancy
        from apps.property.policies import can_archive_property

        Occupancy.objects.create(user=user, property=owned_property, unit=a_unit)

        with pytest.raises(Conflict):
            enforce(can_archive_property(actor=landlord, target=owned_property))

    def test_a_required_reason_is_demanded(self, owned_property, landlord):
        from apps.property.policies import can_archive_property

        decision = can_archive_property(actor=landlord, target=owned_property)

        with pytest.raises(ValidationFailed):
            enforce(decision, reason="   ")

        enforce(decision, reason="Sold the building.")

    def test_confirmation_is_demanded(self, owned_property, landlord):
        from apps.property.policies import can_archive_property

        decision = can_archive_property(actor=landlord, target=owned_property)

        with pytest.raises(ValidationFailed):
            enforce(decision, reason="Sold it.", confirmed=False)


class TestLeaseTransitions:
    def _offered_lease(self, landlord, tenant, unit):
        from datetime import date

        from apps.lease.models import Lease, LeaseStatus

        return Lease.objects.create(
            unit=unit,
            landlord=landlord,
            tenant=tenant,
            status=LeaseStatus.OFFERED,
            # MoneyField declares a (minor units, currency) pair rather than one
            # amount column, so it is set by its parts.
            rent_minor=150000,
            rent_currency="GHS",
            starts_on=date.today(),
        )

    def test_only_the_named_tenant_may_accept(self, a_unit, landlord, user, agent):
        from apps.lease.policies import can_accept_offer

        lease = self._offered_lease(landlord, user, a_unit)

        assert can_accept_offer(actor=user, target=lease).allowed
        assert not can_accept_offer(actor=agent, target=lease).allowed
        # Not even the landlord may accept on the tenant's behalf.
        assert not can_accept_offer(actor=landlord, target=lease).allowed

    def test_acceptance_asks_for_confirmation_but_not_a_reason(self, a_unit, landlord, user):
        from apps.lease.policies import can_accept_offer

        decision = can_accept_offer(actor=user, target=self._offered_lease(landlord, user, a_unit))

        assert decision.requires_confirmation
        assert not decision.requires_reason

    def test_declining_never_demands_a_justification(self, a_unit, landlord, user):
        """The asymmetry: a tenant saying no does not owe an explanation.

        A provider withdrawing an offer someone was relying on does.
        """
        from apps.lease.policies import can_decline_offer, can_withdraw_offer

        lease = self._offered_lease(landlord, user, a_unit)

        assert not can_decline_offer(actor=user, target=lease).requires_reason
        assert can_withdraw_offer(actor=landlord, target=lease).requires_reason

    def test_an_accepted_lease_cannot_be_withdrawn_edited_or_deleted(self, a_unit, landlord, user):
        from apps.lease.models import LeaseStatus
        from apps.lease.policies import (
            can_delete_lease,
            can_modify_offer,
            can_withdraw_offer,
        )

        lease = self._offered_lease(landlord, user, a_unit)
        lease.status = LeaseStatus.ACTIVE
        lease.save(update_fields=["status"])

        for policy in (can_withdraw_offer, can_modify_offer, can_delete_lease):
            decision = policy(actor=landlord, target=lease)
            assert not decision.allowed, policy.__name__
            assert decision.code == "immutable", policy.__name__

    def test_a_draft_nobody_has_seen_may_be_deleted(self, a_unit, landlord, user):
        from apps.lease.models import LeaseStatus
        from apps.lease.policies import can_delete_lease

        lease = self._offered_lease(landlord, user, a_unit)
        lease.status = LeaseStatus.DRAFT
        lease.save(update_fields=["status"])

        assert can_delete_lease(actor=landlord, target=lease).allowed


class TestExposure:
    def test_permitted_actions_are_enumerable_for_a_client(self, owned_property, landlord):
        """The client renders this rather than deciding for itself."""
        actions = permitted_actions("property", actor=landlord, target=owned_property)

        # Every action the registry holds for a property, not a fixed pair. The
        # set grows as the lifecycle does — what this pins is that a client can
        # enumerate it, and that each entry answers in the same shape.
        assert {"archive", "delete", "edit", "submit_for_verification"} <= set(actions)
        assert actions["archive"]["allowed"] is True
        assert actions["archive"]["requires_reason"] is True
        assert "blockers" in actions["archive"]

    def test_a_refusal_carries_its_blockers_to_the_client(
        self, owned_property, a_unit, landlord, user
    ):
        from apps.occupancy.models import Occupancy

        Occupancy.objects.create(user=user, property=owned_property, unit=a_unit)

        actions = permitted_actions("property", actor=landlord, target=owned_property)

        assert actions["archive"]["allowed"] is False
        assert actions["archive"]["blockers"][0]["kind"] == "tenancy"
        assert actions["archive"]["blockers"][0]["count"] == 1
