from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict, NotFound, ValidationFailed
from apps.files.models import StoredFile
from apps.files.services import can_read
from apps.identity.models import Profile
from apps.organization.models import (
    Organization,
    OrganizationMembership,
    OrganizationPropertyRelationship,
)
from apps.passport import provider
from apps.passport.models import ProviderPassport, ProviderPassportDocument
from apps.trust import services as trust
from apps.trust.models import ReviewQueueEntry, Verification

from .test_management_portal import management_user, signed_in_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def storage(settings):
    from apps.files.storage import get_storage, reset_storage

    settings.STORAGE_BACKEND = "memory"
    reset_storage()
    yield get_storage()
    reset_storage()


def uploaded(user, purpose="property_document", **kwargs):
    return StoredFile.objects.create(
        storage_key=f"passport-tests/{uuid4()}",
        bucket="test",
        storage_backend="local",
        original_filename="private-business.pdf"
        if purpose == "property_document"
        else "profile.jpg",
        content_type="application/pdf" if purpose == "property_document" else "image/jpeg",
        uploaded_by=user,
        purpose=purpose,
        upload_status="ready",
        scan_status="clean",
        is_sensitive=purpose == "property_document",
        **kwargs,
    )


@pytest.fixture
def portfolio(landlord):
    organization = Organization.objects.create(
        name="Provider's Portfolio", organization_type="individual_owner", created_by=landlord
    )
    OrganizationMembership.objects.create(
        organization=organization, user=landlord, role="owner", joined_at=timezone.now()
    )
    landlord.email = "verified@example.com"
    landlord.is_email_verified = True
    landlord.save(update_fields=["email", "is_email_verified"])
    profile, _ = Profile.objects.get_or_create(user=landlord)
    profile.avatar = uploaded(landlord, "avatar")
    profile.save(update_fields=["avatar"])
    Verification.objects.create(
        subject_type="user",
        subject_id=str(landlord.id),
        kind="identity",
        status="approved",
        method="document_review",
        decided_at=timezone.now(),
    )
    return organization


def path(organization):
    return f"/api/v1/organizations/{organization.id}/provider-passport/"


@pytest.mark.parametrize(
    "category", ["individual_owner", "property_company", "property_manager", "hostel_operator"]
)
def test_category_requirements_and_submission(portfolio, landlord, sign_in_as, category):
    portfolio.organization_type = category
    portfolio.save(update_fields=["organization_type"])
    client = APIClient()
    sign_in_as(client, user=landlord)
    initial = client.get(path(portfolio))
    assert initial.status_code == 200
    assert initial.data["status"] == "not_started"
    assert not ProviderPassport.objects.exists(), "GET must not create a duplicate profile"
    data = {
        "representative_role": "Owner",
        "contact_email": "office@example.com",
        "contact_phone": "0302123456",
    }
    if category == "property_company":
        data["registration_number"] = "TEST-REG-1"
    saved = client.patch(path(portfolio), data, format="json")
    assert saved.status_code == 200
    if category == "property_company":
        assert any(row["field"] == "business_certificate" for row in saved.data["missing"])
        assert client.post(path(portfolio) + "submit/").status_code == 422
        document = uploaded(landlord)
        attached = client.post(
            path(portfolio) + "documents/",
            {"file_id": str(document.id), "evidence_type": "business_certificate"},
            format="json",
        )
        assert attached.status_code == 200
    else:
        assert not any(row["field"] == "business_certificate" for row in saved.data["missing"])
    sent = client.post(path(portfolio) + "submit/")
    assert sent.status_code == 200, sent.data
    assert sent.data["status"] == "submitted"
    assert sent.data["editable"] is False
    assert sent["Cache-Control"] == "no-store, private"
    check = ProviderPassport.objects.get(organization=portfolio).verification
    assert check.kind == "provider_credentials"
    assert check.subject_type == "organisation"
    assert (
        ReviewQueueEntry.objects.filter(verification=check, resolved_at__isnull=True).count() == 1
    )
    assert client.post(path(portfolio) + "submit/").status_code == 200
    assert Verification.objects.filter(kind="provider_credentials").count() == 1
    assert (
        client.patch(
            path(portfolio), {"contact_email": "changed@example.com"}, format="json"
        ).status_code
        == 409
    )


def test_management_review_more_information_and_resubmission(portfolio, landlord, storage):
    provider.submit(portfolio.id, landlord)
    passport = ProviderPassport.objects.get(organization=portfolio)
    original = passport.verification
    reviewer = management_user()
    client = signed_in_client(reviewer)
    queue = client.get("/api/v1/management/verifications/")
    assert queue.status_code == 200
    item = next(row for row in queue.data["items"] if row["verification"]["id"] == str(original.id))
    assert "Provider Passport" in item["verification"]["subject_label"]
    assert item["verification"]["subject_context"]["submission_current"] is True
    claimed = client.post(f"/api/v1/management/verifications/{item['id']}/claim/")
    assert claimed.status_code == 200
    assert provider.assemble(portfolio)["status"] == "under_review"
    more = client.post(
        f"/api/v1/management/verifications/{original.id}/more-info/",
        {"note": "State your representative role."},
        format="json",
    )
    assert more.status_code == 200, more.data
    assert provider.assemble(portfolio)["status"] == "needs_more_info"
    provider.update(portfolio.id, landlord, {"representative_role": "Owner"})
    assert provider.assemble(portfolio)["decision_note"] == "State your representative role."
    provider.submit(portfolio.id, landlord)
    passport.refresh_from_db()
    assert passport.verification_id != original.id
    original.refresh_from_db()
    assert original.status == "superseded"
    assert original.decision_note == "State your representative role."
    assert ReviewQueueEntry.objects.get(verification=original).resolved_at is not None
    result = client.post(
        f"/api/v1/management/verifications/{passport.verification_id}/decision/",
        {"approved": True, "note": "Credentials reviewed."},
        format="json",
    )
    assert result.status_code == 200, result.data
    assert provider.assemble(portfolio)["status"] == "verified"
    assert provider.public_credentials(portfolio)["verified"] is True
    passport.verification.refresh_from_db()
    assert passport.verification.decided_by_management_id == reviewer.id
    assert passport.verification.expires_at > timezone.now()
    history = client.get("/api/v1/management/providers/")
    assert any(
        row["verification_id"] == str(passport.verification_id)
        and row["review_label"] == "Provider Passport"
        for row in history.data["results"]
    )


def test_rejection_then_new_review_preserves_decision(portfolio, landlord, staff):
    provider.submit(portfolio.id, landlord)
    check = ProviderPassport.objects.get(organization=portfolio).verification
    trust.decide(check, approved=False, decided_by=staff, note="Credentials do not match.")
    assert provider.assemble(portfolio)["status"] == "rejected"
    provider.submit(portfolio.id, landlord)
    check.refresh_from_db()
    assert check.status == "rejected"
    assert len(provider.assemble(portfolio)["history"]) == 2


def test_changed_or_expired_credentials_do_not_keep_verified_stamp(portfolio, landlord, staff):
    provider.submit(portfolio.id, landlord)
    passport = ProviderPassport.objects.get(organization=portfolio)
    trust.decide(passport.verification, approved=True, decided_by=staff)
    assert provider.public_credentials(portfolio)["verified"] is True
    provider.update(portfolio.id, landlord, {"contact_email": "changed@example.com"})
    assert provider.public_credentials(portfolio)["verified"] is False
    provider.submit(portfolio.id, landlord)
    passport.refresh_from_db()
    trust.decide(passport.verification, approved=True, decided_by=staff)
    Verification.objects.filter(id=passport.verification_id).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    assert provider.public_credentials(portfolio)["verified"] is False
    provider.submit(portfolio.id, landlord)
    assert (
        ProviderPassport.objects.get(organization=portfolio).verification_id
        != passport.verification_id
    )


def test_stale_organization_or_identity_cannot_be_approved(portfolio, landlord, staff):
    provider.submit(portfolio.id, landlord)
    check = ProviderPassport.objects.get(organization=portfolio).verification
    portfolio.name = "Changed company name"
    portfolio.save(update_fields=["name"])
    with pytest.raises(ValidationFailed):
        trust.decide(check, approved=True, decided_by=staff)
    # A stale package can be corrected and resubmitted without leaving an orphan queue.
    provider.submit(portfolio.id, landlord)
    current = ProviderPassport.objects.get(organization=portfolio).verification
    assert current.id != check.id
    with pytest.raises(Conflict):
        trust.decide(check, approved=True, decided_by=staff)
    Verification.objects.filter(
        subject_type="user", subject_id=str(landlord.id), kind="identity"
    ).update(status="revoked")
    with pytest.raises(ValidationFailed):
        trust.decide(current, approved=True, decided_by=staff)


@pytest.mark.parametrize("role", ["staff", "accountant", "property_manager", "outsider", "ended"])
def test_private_endpoints_reject_other_providers_and_delegates(
    portfolio, landlord, user, sign_in_as, role
):
    if role != "outsider":
        OrganizationMembership.objects.create(
            organization=portfolio,
            user=user,
            role="admin" if role == "ended" else role,
            joined_at=timezone.now(),
            ended_at=timezone.now() if role == "ended" else None,
        )
    client = APIClient()
    sign_in_as(client, user=user)
    file = uploaded(landlord)
    provider.add_document(
        portfolio.id, landlord, {"file_id": file.id, "evidence_type": "business_certificate"}
    )
    document = ProviderPassportDocument.objects.get(file=file)
    for response in (
        client.get(path(portfolio)),
        client.patch(path(portfolio), {"contact_email": "intruder@example.com"}, format="json"),
        client.post(path(portfolio) + "submit/"),
        client.post(
            path(portfolio) + "documents/",
            {"file_id": str(file.id), "evidence_type": "business_certificate"},
            format="json",
        ),
        client.delete(path(portfolio) + f"documents/{document.id}/"),
        client.get(path(portfolio) + f"documents/{document.id}/download/"),
        client.get(path(portfolio) + "photo/"),
    ):
        assert response.status_code in (403, 404), response.data
    assert ProviderPassportDocument.objects.filter(id=document.id).exists()


def test_sensitive_documents_have_private_scope_and_immutable_review_evidence(
    portfolio, landlord, user, staff, storage
):
    with pytest.raises(NotFound):
        provider.add_document(
            portfolio.id,
            landlord,
            {"file_id": uploaded(user).id, "evidence_type": "business_certificate"},
        )
    file = uploaded(landlord)
    provider.add_document(
        portfolio.id, landlord, {"file_id": file.id, "evidence_type": "business_certificate"}
    )
    passport = ProviderPassport.objects.get(organization=portfolio)
    document = passport.documents.get()
    assert not can_read(user=user, stored=file)
    assert not can_read(
        user=staff, stored=file
    ), "Legacy support/staff access is not a Management capability"
    provider.submit(portfolio.id, landlord)
    passport.refresh_from_db()
    reviewer = signed_in_client(management_user())
    check = passport.verification
    evidence = check.evidence.get(file=file)
    response = reviewer.get(f"/api/v1/management/verifications/{check.id}/evidence/{evidence.id}/")
    assert response.status_code == 200
    support = signed_in_client(
        management_user(role="support_admin", email="support-passport@example.com")
    )
    assert (
        support.get(
            f"/api/v1/management/verifications/{check.id}/evidence/{evidence.id}/"
        ).status_code
        == 403
    )
    trust.decide(check, approved=True, decided_by=staff)
    provider.remove_document(portfolio.id, document.id, landlord)
    assert check.evidence.filter(file=file).exists()
    assert not can_read(user=staff, stored=file)
    assert provider.public_credentials(portfolio)["verified"] is False


def test_passport_does_not_verify_properties_or_expose_private_data(
    portfolio, landlord, staff, user, address
):
    from apps.property.models import Property

    prop = Property.objects.create(
        owner=landlord, address=address, title="An unchecked property", property_type="apartment"
    )
    OrganizationPropertyRelationship.objects.create(
        organization=portfolio, property=prop, relationship_type="manager"
    )
    provider.submit(portfolio.id, landlord)
    trust.decide(
        ProviderPassport.objects.get(organization=portfolio).verification,
        approved=True,
        decided_by=staff,
    )
    record = provider.assemble(portfolio)
    assert record["properties"][0]["relationship"] == "manager"
    assert record["properties"][0]["authority_verified"] is False
    assert record["properties"][0]["property_verified"] is False
    assert record["activity"]["completed_tenancies"] == 0
    assert record["activity"]["completed_maintenance"] == 0
    public = provider.public_for_property(prop)
    assert len(public) == 1
    assert set(public[0]) == {"name", "category", "verified", "verified_at", "valid_until"}
    assert landlord.email not in str(public)
    assert not Verification.objects.filter(
        subject_type="property", subject_id=str(prop.id)
    ).exists()
    assert APIClient().get(path(portfolio)).status_code in (401, 403)


def test_legacy_property_authority_and_manager_authorization_stay_distinct(
    portfolio,
    landlord,
    user,
    address,
    approve_provider,
):
    from apps.property.models import Property

    owned = Property.objects.create(owner=landlord, address=address, title="Legacy owner property")
    managed = Property.objects.create(owner=user, address=address, title="Someone else's property")
    approve_provider(landlord, owned)
    approve_provider(user, managed)
    OrganizationPropertyRelationship.objects.create(
        organization=portfolio, property=owned, relationship_type="owner"
    )
    OrganizationPropertyRelationship.objects.create(
        organization=portfolio, property=managed, relationship_type="manager"
    )
    rows = {row["id"]: row for row in provider.property_records(portfolio)}
    assert rows[str(owned.id)]["authority_verified"] is True
    assert rows[str(owned.id)]["property_verified"] is True
    assert rows[str(managed.id)]["property_verified"] is True
    assert (
        rows[str(managed.id)]["authority_verified"] is False
    ), "Another owner's deed cannot authorize this manager"


def test_inactive_representative_contacts_and_photo_are_not_disclosed(
    portfolio,
    landlord,
    user,
    staff,
    sign_in_as,
):
    provider.submit(portfolio.id, landlord)
    trust.decide(
        ProviderPassport.objects.get(organization=portfolio).verification,
        approved=True,
        decided_by=staff,
    )
    OrganizationMembership.objects.create(
        organization=portfolio, user=user, role="admin", joined_at=timezone.now()
    )
    OrganizationMembership.objects.filter(organization=portfolio, user=landlord).update(
        ended_at=timezone.now()
    )
    client = APIClient()
    sign_in_as(client, user=user)
    response = client.get(path(portfolio))
    assert response.status_code == 200
    assert response.data["identity"]["phone"] == ""
    assert response.data["identity"]["email"] == ""
    assert response.data["identity"]["photo_on_record"] is False
    assert client.get(path(portfolio) + "photo/").status_code == 404
    assert provider.public_credentials(portfolio)["verified"] is False
    assert (
        client.patch(
            path(portfolio), {"representative_id": str(user.id)}, format="json"
        ).status_code
        == 200
    )
    assert (
        client.patch(
            path(portfolio), {"representative_id": str(landlord.id)}, format="json"
        ).status_code
        == 422
    )


def test_activity_counts_only_platform_records_from_current_relationships(
    portfolio,
    landlord,
    user,
    address,
    approve_provider,
):
    from apps.maintenance.models import MaintenanceRequest
    from apps.property.models import Property, Unit
    from apps.tenancy.models import Tenancy

    from .test_passport import _let

    prop = Property.objects.create(owner=landlord, address=address, title="Real test ledger")
    approve_provider(landlord, prop)
    relation = OrganizationPropertyRelationship.objects.create(
        organization=portfolio, property=prop, relationship_type="owner"
    )
    unit = Unit.objects.create(property=prop, label="Flat A", bedrooms=1, bathrooms=1)
    lease = _let(landlord, user, unit)
    tenancy = Tenancy.objects.get(activation_lease=lease)
    assert provider.assemble(portfolio)["activity"]["active_tenancies"] == 1
    MaintenanceRequest.objects.create(
        tenancy=tenancy,
        tenant=user,
        property=prop,
        unit=unit,
        category="plumbing",
        description="Recorded repair",
        photo=uploaded(user, "maintenance_photo"),
        status="completed",
        status_changed_at=timezone.now(),
        completed_at=timezone.now(),
    )
    Tenancy.objects.filter(id=tenancy.id).update(status="ended", ended_on=timezone.localdate())
    activity = provider.assemble(portfolio)["activity"]
    assert activity["completed_tenancies"] == 1
    assert activity["completed_maintenance"] == 1
    OrganizationPropertyRelationship.objects.filter(id=relation.id).update(
        created_at=timezone.now() + timedelta(seconds=1)
    )
    activity = provider.assemble(portfolio)["activity"]
    assert activity["completed_tenancies"] == 0
    assert activity["completed_maintenance"] == 0


def test_unavailable_evidence_or_revoked_provider_standing_removes_public_stamp(
    portfolio, landlord, staff
):
    file = uploaded(landlord)
    provider.add_document(
        portfolio.id, landlord, {"file_id": file.id, "evidence_type": "agency_licence"}
    )
    provider.submit(portfolio.id, landlord)
    trust.decide(
        ProviderPassport.objects.get(organization=portfolio).verification,
        approved=True,
        decided_by=staff,
    )
    assert provider.public_credentials(portfolio)["verified"] is True
    StoredFile.objects.filter(id=file.id).update(scan_status="infected")
    assert provider.public_credentials(portfolio)["verified"] is False
    StoredFile.objects.filter(id=file.id).update(scan_status="clean")
    Verification.objects.filter(
        subject_type="user", subject_id=str(landlord.id), kind="provider"
    ).update(status="revoked")
    assert provider.public_credentials(portfolio)["verified"] is False


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality)
