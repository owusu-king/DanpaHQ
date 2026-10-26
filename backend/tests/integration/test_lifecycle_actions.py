"""Archiving and removing property and space, end to end over HTTP.

P0.5 wrote the policies; nothing called them. These cover the acts themselves:
that the refusals reach the client with their blockers, that a permitted act
records an audit entry, and that archiving is reversible while deletion of a
let property is impossible.
"""

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def owned(landlord, db):
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import (
        Property,
        PropertyRelationship,
        PropertyRelationshipType,
        PropertyType,
        RentableSpaceType,
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
        title="Archive Test House",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street="1 Test Road"),
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
        space_type=RentableSpaceType.APARTMENT,
        bedrooms=2,
        bathrooms=1,
    )
    return prop, unit


class TestArchive:
    def test_archive_index_is_scoped_and_restore_obeys_parent_lifecycle(
        self, api, sign_in_as, landlord, agent, owned
    ):
        prop, unit = owned
        sign_in_as(api, user=landlord)

        api.post(
            f"/api/v1/spaces/{unit.id}/archive/",
            {"reason": "Combining the rooms.", "confirmed": True},
            format="json",
        )
        initial = api.get("/api/v1/me/archive/")

        assert initial.status_code == 200
        assert initial["Cache-Control"] == "private, no-store"
        assert initial.data["properties"] == []
        assert initial.data["spaces"][0]["id"] == str(unit.id)
        assert initial.data["spaces"][0]["archived_reason"] == "Combining the rooms."
        assert initial.data["spaces"][0]["restore"]["allowed"] is True

        api.post(
            f"/api/v1/properties/{prop.id}/archive/",
            {"reason": "Leaving this portfolio.", "confirmed": True},
            format="json",
        )
        nested = api.get("/api/v1/me/archive/")

        assert nested.data["properties"][0]["id"] == str(prop.id)
        assert nested.data["properties"][0]["archived_reason"] == "Leaving this portfolio."
        assert nested.data["properties"][0]["restore"]["allowed"] is True
        assert nested.data["spaces"][0]["property_archived"] is True
        assert nested.data["spaces"][0]["restore"]["allowed"] is False
        assert "parent property" in nested.data["spaces"][0]["restore"]["message"].lower()

        refused = api.post(f"/api/v1/spaces/{unit.id}/restore/", {}, format="json")
        assert refused.status_code == 409
        unit.refresh_from_db()
        assert unit.is_active is False

        property_restored = api.post(f"/api/v1/properties/{prop.id}/restore/", {}, format="json")
        assert property_restored.status_code == 200
        assert api.post(f"/api/v1/spaces/{unit.id}/restore/", {}, format="json").status_code == 200

        # Authorization is applied to the index itself, not just the restore
        # button. An unrelated provider cannot discover archived inventory.
        sign_in_as(api, user=agent)
        outside = api.get("/api/v1/me/archive/")
        assert outside.status_code == 200
        assert outside.data == {"properties": [], "spaces": []}

    def test_restore_refuses_a_space_that_no_longer_fits_its_property(
        self, api, sign_in_as, landlord, owned
    ):
        from apps.property.models import PropertyType

        prop, unit = owned
        sign_in_as(api, user=landlord)
        api.post(
            f"/api/v1/spaces/{unit.id}/archive/",
            {"reason": "Changing its use.", "confirmed": True},
            format="json",
        )
        prop.property_type = PropertyType.COMMERCIAL
        prop.save(update_fields=["property_type", "updated_at"])

        response = api.post(f"/api/v1/spaces/{unit.id}/restore/", {}, format="json")

        assert response.status_code == 409
        assert "category" in response.data["error"]["message"].lower()
        unit.refresh_from_db()
        assert unit.is_active is False

    def test_archiving_keeps_the_record_and_writes_an_audit_entry(
        self, api, sign_in_as, landlord, owned
    ):
        from apps.audit.models import AuditLog
        from apps.property.models import Property

        prop, _ = owned
        sign_in_as(api, user=landlord)

        response = api.post(
            f"/api/v1/properties/{prop.id}/archive/",
            {"reason": "Sold the building.", "confirmed": True},
            format="json",
        )

        assert response.status_code == 200
        prop.refresh_from_db()
        assert prop.deleted_at is not None
        assert prop.deleted_reason == "Sold the building."
        # The row is still there. That is the whole point.
        assert Property.all_objects.filter(pk=prop.pk).exists()

        entry = AuditLog.objects.filter(aggregate_id=str(prop.id)).order_by("-created_at").first()
        assert entry is not None
        assert entry.metadata["action"] == "archive"
        assert entry.metadata["reason"] == "Sold the building."

    def test_a_reason_is_required(self, api, sign_in_as, landlord, owned):
        prop, _ = owned
        sign_in_as(api, user=landlord)

        response = api.post(
            f"/api/v1/properties/{prop.id}/archive/", {"confirmed": True}, format="json"
        )

        assert response.status_code == 422

    def test_confirmation_is_required(self, api, sign_in_as, landlord, owned):
        prop, _ = owned
        sign_in_as(api, user=landlord)

        response = api.post(
            f"/api/v1/properties/{prop.id}/archive/",
            {"reason": "Sold it."},
            format="json",
        )

        assert response.status_code == 422

    def test_a_tenant_in_place_blocks_it(self, api, sign_in_as, landlord, user, owned):
        from apps.occupancy.models import Occupancy

        prop, unit = owned
        Occupancy.objects.create(user=user, property=prop, unit=unit)
        sign_in_as(api, user=landlord)

        response = api.post(
            f"/api/v1/properties/{prop.id}/archive/",
            {"reason": "Selling.", "confirmed": True},
            format="json",
        )

        assert response.status_code == 409
        prop.refresh_from_db()
        assert prop.deleted_at is None

    def test_someone_else_cannot_archive_it(self, api, sign_in_as, agent, owned):
        prop, _ = owned
        sign_in_as(api, user=agent)

        response = api.post(
            f"/api/v1/properties/{prop.id}/archive/",
            {"reason": "Mine now.", "confirmed": True},
            format="json",
        )

        assert response.status_code == 403

    def test_archiving_is_reversible(self, api, sign_in_as, landlord, owned):
        prop, _ = owned
        sign_in_as(api, user=landlord)

        api.post(
            f"/api/v1/properties/{prop.id}/archive/",
            {"reason": "Mistake incoming.", "confirmed": True},
            format="json",
        )
        response = api.post(f"/api/v1/properties/{prop.id}/restore/", {}, format="json")

        assert response.status_code == 200
        prop.refresh_from_db()
        assert prop.deleted_at is None


class TestDelete:
    def test_a_property_with_history_cannot_be_deleted(
        self, api, sign_in_as, landlord, user, owned
    ):
        from django.utils import timezone

        from apps.occupancy.models import Occupancy
        from apps.property.models import Property

        prop, unit = owned
        Occupancy.objects.create(
            user=user,
            property=prop,
            unit=unit,
            ended_at=timezone.now(),
            status="ended",
        )
        sign_in_as(api, user=landlord)

        response = api.delete(
            f"/api/v1/properties/{prop.id}/archive/?reason=Cleanup&confirmed=true"
        )

        assert response.status_code == 409
        assert Property.all_objects.filter(pk=prop.pk).exists()

    def test_an_untouched_property_can_be_removed(self, api, sign_in_as, landlord, owned):
        from apps.property.models import Property

        prop, _ = owned
        sign_in_as(api, user=landlord)

        response = api.delete(
            f"/api/v1/properties/{prop.id}/archive/?reason=Created+by+mistake&confirmed=true"
        )

        assert response.status_code == 204
        assert not Property.all_objects.filter(pk=prop.pk).exists()

    def test_the_removal_is_recorded_before_the_row_goes(self, api, sign_in_as, landlord, owned):
        """The audit entry has to outlive the record it describes."""
        from apps.audit.models import AuditLog

        prop, _ = owned
        sign_in_as(api, user=landlord)

        api.delete(f"/api/v1/properties/{prop.id}/archive/?reason=Mistake&confirmed=true")

        entry = AuditLog.objects.filter(aggregate_id=str(prop.id)).order_by("-created_at").first()
        assert entry is not None
        assert entry.metadata["action"] == "delete"
        assert entry.metadata["title"] == "Archive Test House"


class TestSpace:
    def test_a_private_unit_uses_property_management_authority(
        self, api, sign_in_as, landlord, owned
    ):
        """A new organization-held Unit has no direct PropertyRelationship.

        Property archive/delete already use ``Property.is_managed_by`` for this
        reason. Unit lifecycle must not hide both actions during the exact
        private-draft stage in which deletion is legitimate.
        """
        prop, unit = owned
        prop.relationships.all().delete()
        sign_in_as(api, user=landlord)

        detail = api.get(f"/api/v1/units/{unit.id}/")

        assert detail.status_code == 200
        assert detail.data["permitted_actions"]["delete"]["allowed"] is True
        assert detail.data["permitted_actions"]["archive"]["allowed"] is True

    def test_a_space_can_be_archived_and_restored(self, api, sign_in_as, landlord, owned):
        _, unit = owned
        sign_in_as(api, user=landlord)

        archived = api.post(
            f"/api/v1/spaces/{unit.id}/archive/",
            {"reason": "Out of use.", "confirmed": True},
            format="json",
        )
        assert archived.status_code == 200
        unit.refresh_from_db()
        assert unit.is_active is False

        restored = api.post(f"/api/v1/spaces/{unit.id}/restore/", {}, format="json")
        assert restored.status_code == 200
        unit.refresh_from_db()
        assert unit.is_active is True

    def test_deleting_an_untouched_unit_requires_a_reason_and_is_audited(
        self, api, sign_in_as, landlord, owned
    ):
        from apps.audit.models import AuditLog
        from apps.property.models import Unit

        prop, _ = owned
        unit = Unit.objects.create(property=prop, label="Mistake", bedrooms=1, bathrooms=1)
        sign_in_as(api, user=landlord)

        missing_reason = api.delete(f"/api/v1/spaces/{unit.id}/archive/?confirmed=true")
        assert missing_reason.status_code == 422
        assert Unit.objects.filter(pk=unit.pk).exists()

        removed = api.delete(f"/api/v1/spaces/{unit.id}/archive/?reason=Duplicate&confirmed=true")
        assert removed.status_code == 204
        assert not Unit.objects.filter(pk=unit.pk).exists()

        entry = (
            AuditLog.objects.filter(aggregate_type="space", aggregate_id=str(unit.id))
            .order_by("-created_at")
            .first()
        )
        assert entry is not None
        assert entry.metadata["action"] == "delete"
        assert entry.metadata["reason"] == "Duplicate"

    def test_a_reviewed_unit_is_archived_not_deleted(
        self, api, sign_in_as, landlord, approve_space, owned
    ):
        from apps.property.models import Unit

        _, unit = owned
        approve_space(unit)
        sign_in_as(api, user=landlord)

        detail = api.get(f"/api/v1/units/{unit.id}/")
        assert detail.data["permitted_actions"]["delete"]["allowed"] is False
        assert detail.data["permitted_actions"]["archive"]["allowed"] is True

        refused = api.delete(f"/api/v1/spaces/{unit.id}/archive/?reason=Cleanup&confirmed=true")
        assert refused.status_code == 409
        assert Unit.objects.filter(pk=unit.pk).exists()

    def test_a_unit_with_the_review_team_must_be_withdrawn_before_archiving(
        self, api, sign_in_as, landlord, owned
    ):
        from apps.trust.models import (
            ReviewQueueEntry,
            SubjectType,
            Verification,
            VerificationKind,
            VerificationMethod,
            VerificationStatus,
        )

        _, unit = owned
        review = Verification.objects.create(
            subject_type=SubjectType.SPACE,
            subject_id=str(unit.id),
            kind=VerificationKind.SPACE_CONDITION,
            status=VerificationStatus.PENDING,
            method=VerificationMethod.DOCUMENT_REVIEW,
            submitted_by=landlord,
        )
        ReviewQueueEntry.objects.create(verification=review)
        sign_in_as(api, user=landlord)

        detail = api.get(f"/api/v1/units/{unit.id}/")
        assert detail.data["permitted_actions"]["delete"]["allowed"] is False
        assert detail.data["permitted_actions"]["archive"]["allowed"] is False

        refused = api.post(
            f"/api/v1/spaces/{unit.id}/archive/",
            {"reason": "No longer needed.", "confirmed": True},
            format="json",
        )
        assert refused.status_code == 409
        assert "withdraw" in refused.data["error"]["message"].lower()

    def test_an_occupied_space_cannot_be_archived(self, api, sign_in_as, landlord, user, owned):
        from apps.occupancy.models import Occupancy

        prop, unit = owned
        Occupancy.objects.create(user=user, property=prop, unit=unit)
        sign_in_as(api, user=landlord)

        response = api.post(
            f"/api/v1/spaces/{unit.id}/archive/",
            {"reason": "Renovating.", "confirmed": True},
            format="json",
        )

        assert response.status_code == 409
