"""Trust gates: what a review in progress does and does not block.

The rule under test throughout: draft work is never gated. Only actions with a
counterparty wait on a verification — and each refusal has to name which review
it is waiting for, or the provider cannot act on it.
"""

import pytest
from rest_framework.test import APIClient

from apps.trust import gates

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


def _property(landlord):
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import (
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
        title="Gate Test",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street="1 Gate Road"),
    )
    PropertyRelationship.objects.create(
        property=prop,
        user=landlord,
        relationship_type=PropertyRelationshipType.OWNER,
        granted_by=landlord,
    )
    unit = Unit.objects.create(
        property=prop,
        label="Main",
        bedrooms=2,
        bathrooms=1,
        space_type="apartment",
    )
    return prop, unit


def _verify(subject_type, subject_id, kind, status="approved"):
    from django.utils import timezone

    from apps.trust.models import Verification, VerificationMethod, VerificationStatus

    return Verification.objects.create(
        subject_type=subject_type,
        subject_id=str(subject_id),
        kind=kind,
        status=status,
        method=VerificationMethod.DOCUMENT_REVIEW,
        decided_at=timezone.now() if status == VerificationStatus.APPROVED else None,
    )


class TestDraftWorkIsNeverBlocked:
    def test_inventory_can_be_built_with_no_verification_at_all(self, landlord):
        """The rule this whole file exists to hold.

        Disabling everything while a review sits in a queue means the provider
        cannot prepare, and the review has nothing to look at when reached.
        """
        prop, _ = _property(landlord)

        assert gates.can_build_inventory(prop=prop).allowed

    def test_inventory_stays_open_while_a_review_is_pending(self, landlord):
        from apps.trust.models import SubjectType, VerificationKind

        prop, _ = _property(landlord)
        _verify(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY, "pending")

        assert gates.can_build_inventory(prop=prop).allowed

    def test_inventory_stays_open_even_after_a_rejection(self, landlord):
        """They have to be able to fix it. Locking them out is how it stays broken."""
        from apps.trust.models import SubjectType, VerificationKind

        prop, _ = _property(landlord)
        _verify(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY, "rejected")

        assert gates.can_build_inventory(prop=prop).allowed


class TestPublishing:
    def test_publishing_is_closed_without_authority(self, landlord):
        prop, unit = _property(landlord)

        decision = gates.can_publish(prop=prop, unit=unit)

        assert not decision.allowed
        assert decision.code == "has_dependents"
        assert any("authority" in b.message.lower() for b in decision.blockers)

    def test_the_refusal_names_which_review_it_waits_on(self, landlord):
        """A blocked provider must know which of two reviews is the problem."""
        from apps.trust.models import SubjectType, VerificationKind

        prop, unit = _property(landlord)
        _verify(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY)

        decision = gates.can_publish(prop=prop, unit=unit)

        assert not decision.allowed
        # Authority is settled; the space is what remains.
        assert len(decision.blockers) == 1
        assert "space" in decision.blockers[0].message.lower()

    def test_a_pending_review_reads_as_pending_not_as_missing(self, landlord):
        from apps.trust.models import SubjectType, VerificationKind

        prop, unit = _property(landlord)
        _verify(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY, "pending")

        decision = gates.can_publish(prop=prop, unit=unit)
        authority = decision.blockers[0]

        assert authority.kind == "verification_pending"
        assert "review team" in authority.message

    def test_both_approvals_open_it(self, landlord):
        from apps.trust.models import SubjectType, VerificationKind

        prop, unit = _property(landlord)
        _verify(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY)
        _verify(SubjectType.SPACE, unit.id, VerificationKind.SPACE_CONDITION)

        assert gates.can_publish(prop=prop, unit=unit).allowed


class TestRetiredPrivateInvitations:
    def test_installed_clients_receive_the_replacement_path(self, landlord):
        from apps.trust.models import SubjectType, VerificationKind

        prop, unit = _property(landlord)
        _verify(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY)

        assert not gates.can_publish(prop=prop, unit=unit).allowed
        decision = gates.can_invite_tenant(prop=prop)
        assert not decision.allowed
        assert decision.code == "workflow_retired"
        assert "access code" in decision.message.lower()

    def test_retirement_does_not_depend_on_property_state(self, landlord):
        prop, _ = _property(landlord)

        decision = gates.can_invite_tenant(prop=prop)

        assert not decision.allowed
        assert decision.code == "workflow_retired"


class TestLeaseAndTenancyGates:
    def test_an_offer_names_every_missing_approval_at_once(self, landlord, registered):
        """Both, not just the first — a provider fixing them one at a time
        because each refusal named only one is a bad afternoon."""

        prop, _ = _property(landlord)
        # The `landlord` fixture already holds approved provider standing, so a
        # separate account is needed to see that blocker at all.
        without_standing = registered("0209770001", account_type="provider")

        decision = gates.can_issue_lease_offer(prop=prop, actor=without_standing)

        assert not decision.allowed
        kinds = {b.kind for b in decision.blockers}
        assert "provider_standing" in kinds
        assert "verification_missing" in kinds

    def test_standing_alone_is_not_enough(self, landlord):
        """The landlord is an approved provider; this address is still not theirs
        as far as the platform knows."""
        from apps.trust.models import SubjectType, VerificationKind

        prop, _ = _property(landlord)

        decision = gates.can_issue_lease_offer(prop=prop, actor=landlord)
        assert not decision.allowed
        assert {b.kind for b in decision.blockers} == {"verification_missing"}

        _verify(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY)
        assert gates.can_issue_lease_offer(prop=prop, actor=landlord).allowed

    def test_a_tenancy_cannot_start_without_authority(self, landlord):
        prop, _ = _property(landlord)

        assert not gates.can_activate_tenancy(prop=prop).allowed

    def test_an_expired_approval_does_not_count(self, landlord):
        """`current()` already excludes expiry; this pins that gates use it."""
        from datetime import timedelta

        from django.utils import timezone

        from apps.trust.models import SubjectType, VerificationKind

        prop, _ = _property(landlord)
        verification = _verify(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY)
        verification.expires_at = timezone.now() - timedelta(days=1)
        verification.save(update_fields=["expires_at"])

        assert not gates.can_activate_tenancy(prop=prop).allowed


class TestSummary:
    def test_the_summary_says_what_is_open_and_what_waits(self, landlord):
        from apps.trust.models import SubjectType, VerificationKind

        prop, unit = _property(landlord)
        _verify(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY)

        summary = gates.gate_summary(prop=prop, unit=unit, actor=landlord)

        # Draft work open, publishing still waiting on the space.
        assert summary["build_inventory"]["allowed"] is True
        assert summary["accept_applications"]["allowed"] is True
        assert summary["invite_tenant"]["allowed"] is False
        assert summary["invite_tenant"]["code"] == "workflow_retired"
        assert summary["publish"]["allowed"] is False
        assert summary["publish"]["blockers"]

    def test_every_gate_carries_a_message(self, landlord):
        """A closed gate with no explanation is a disabled button."""
        prop, unit = _property(landlord)

        summary = gates.gate_summary(prop=prop, unit=unit, actor=landlord)

        for name, gate in summary.items():
            assert gate["message"], name
