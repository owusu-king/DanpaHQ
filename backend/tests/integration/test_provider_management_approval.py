from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from apps.identity.models import User
from apps.identity.provider_terms import policy
from apps.trust.models import ReviewQueueEntry, Verification

pytestmark = pytest.mark.django_db
PASSWORD = "correct-horse-battery-staple"


def consent():
    terms = policy()
    return {
        "terms_accepted": True,
        "accepted_terms_version": terms["version"],
        "accepted_terms_digest": terms["digest"],
    }


def new_provider(*, changes=None, phone="+233209740001"):
    from apps.trust.services import record_phone_verification

    user = User.objects.create_user(phone=phone, is_phone_verified=True)
    record_phone_verification(user, challenge_id="registration-test")
    client = APIClient()
    client.force_authenticate(user=user)
    payload = {
        "account_type": "provider",
        "first_name": "Ama",
        "last_name": "Provider",
        "date_of_birth": "1990-06-15",
        "password": PASSWORD,
        "device_fingerprint": "new-provider",
        "platform": "android",
        **consent(),
    }
    payload.update(changes or {})
    response = client.post("/api/v1/me/registration/", payload, format="json")
    user.refresh_from_db()
    return user, client, response


def decide(approval, *, approved=True, role=None):
    from tests.integration.test_runtime_configuration_and_support import management_client

    kwargs = {"role": role} if role else {}
    _, client = management_client(email=f"review-{uuid4()}@example.com", **kwargs)
    return client.post(
        f"/api/v1/management/verifications/{approval.id}/decision/",
        {
            "approved": approved,
            "note": "Approved to operate" if approved else "Please correct your account details.",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid4()),
    )


def test_registration_without_documents_records_terms_and_pending_review_and_preserves_login():
    from apps.files.models import StoredFile
    from apps.identity.services import sign_in_with_password

    user, client, response = new_provider()
    assert response.status_code == 201, response.data
    assert user.is_active and user.is_registration_complete
    assert user.provider_terms_accepted_at and user.provider_terms_digest == policy()["digest"]
    approval = Verification.objects.get(kind="provider", subject_id=str(user.id))
    assert approval.status == "pending" and approval.method == "management_approval"
    assert not approval.evidence.exists()
    assert ReviewQueueEntry.objects.filter(verification=approval, resolved_at__isnull=True).exists()
    assert not StoredFile.objects.exists()
    assert not user.has_role("landlord")
    me = client.get("/api/v1/me/").data
    assert me["capabilities"]["provider"]["verification_status"] == "pending"
    assert not me["capabilities"]["provider"]["workspace_access"]
    assert not me["capabilities"]["provider"]["can_create_property"]
    assert sign_in_with_password(identifier=user.phone, password=PASSWORD)["user"].id == user.id


@pytest.mark.parametrize(
    "change",
    [
        {"terms_accepted": False},
        {"accepted_terms_digest": "wrong"},
        {"accepted_terms_version": "outdated"},
    ],
)
def test_current_explicit_terms_acceptance_is_required(change):
    user, _, response = new_provider(changes=change)
    assert response.status_code == 422, response.data
    assert not user.is_registration_complete
    assert user.provider_terms_accepted_at is None
    assert not Verification.objects.filter(kind="provider").exists()


def test_management_can_approve_without_documents_without_claiming_identity_is_verified():
    from apps.identity.assurance import permits_provider_operations
    from apps.identity.services import account_capabilities
    from apps.organization.models import OrganizationMembership

    user, _, response = new_provider()
    assert response.status_code == 201, response.data
    approval = Verification.objects.get(kind="provider")
    approved = decide(approval)
    assert approved.status_code == 200, approved.data
    approval.refresh_from_db()
    user.refresh_from_db()
    assert approval.status == "approved" and approval.decided_by_management_id
    assert user.has_role("landlord")
    assert OrganizationMembership.objects.filter(user=user, role="owner").count() == 1
    assert not Verification.objects.filter(kind="identity").exists()
    assert permits_provider_operations(user)
    assert account_capabilities(user)["provider"]["workspace_access"]
    assert not ReviewQueueEntry.objects.filter(
        verification=approval, resolved_at__isnull=True
    ).exists()


def test_rejection_preserves_login_and_allows_a_new_review_without_uploads():
    user, client, response = new_provider()
    assert response.status_code == 201, response.data
    approval = Verification.objects.get(kind="provider")
    assert decide(approval, approved=False).status_code == 200
    user.refresh_from_db()
    assert user.is_active and not user.has_role("landlord")
    state = client.get("/api/v1/me/provider-verification/").data
    assert state["verification_status"] == "rejected" and state["decision_note"]
    retried = client.post("/api/v1/me/provider-verification/", consent(), format="json")
    assert retried.status_code == 201, retried.data
    assert retried.data["verification_status"] == "pending"
    assert Verification.objects.filter(kind="provider").count() == 2
    approval.refresh_from_db()
    assert approval.status == "rejected"


def test_support_cannot_approve_provider_accounts():
    from apps.operations.models import ManagementRole

    _, _, response = new_provider()
    assert response.status_code == 201, response.data
    approval = Verification.objects.get(kind="provider")
    assert decide(approval, role=ManagementRole.SUPPORT_ADMIN).status_code == 403
    approval.refresh_from_db()
    assert approval.status == "pending"


def test_new_approval_method_cannot_bypass_evidence_for_property_or_identity_checks(registered):
    from apps.core.exceptions import ValidationFailed
    from apps.trust import services

    user = registered("0209740002")
    for kind in ["identity", "property_authority"]:
        row = Verification.objects.create(
            subject_type="user",
            subject_id=str(user.id),
            kind=kind,
            method="management_approval",
            submitted_by=user,
        )
        with pytest.raises(ValidationFailed):
            services.decide(row, approved=True, decided_by=user)
        row.refresh_from_db()
        assert row.status == "pending"


def test_terms_can_be_edited_in_management_and_old_acceptance_does_not_match(settings):
    from tests.integration.test_runtime_configuration_and_support import management_client

    settings.RUNTIME_CONFIGURATION_ENABLED = True
    old = consent()
    _, management = management_client(email="provider-terms-editor@example.com")
    saved = management.patch(
        "/api/v1/management/configuration/",
        {
            "updates": [
                {"key": "PROVIDER_TERMS_VERSION", "value": "terms-v2"},
                {"key": "PROVIDER_TERMS_TEXT", "value": "Updated provider terms for this test."},
            ]
        },
        format="json",
    )
    assert saved.status_code == 200, saved.data
    public = APIClient().get("/api/v1/provider-registration-policy/")
    assert public.status_code == 200 and public.data["version"] == "terms-v2"
    assert public.data["text"] == "Updated provider terms for this test."
    _, _, response = new_provider(changes=old)
    assert response.status_code == 422, response.data


def test_existing_provider_keeps_approval_without_new_acceptance(registered, provider_standing):
    from apps.identity.services import account_capabilities

    user = registered("0209740003", account_type="provider")
    provider_standing(user)
    assert user.provider_terms_accepted_at is None
    assert account_capabilities(user)["provider"]["workspace_access"]


class RequireIndependentIdentity:
    def permits_provider_operations(self, user):
        return False


def test_identity_policy_is_replaceable_independently_of_registration_and_approval(settings):
    from apps.identity.assurance import permits_provider_operations

    user, _, response = new_provider()
    assert response.status_code == 201, response.data
    assert decide(Verification.objects.get(kind="provider")).status_code == 200
    assert permits_provider_operations(user)
    settings.PROVIDER_IDENTITY_POLICY = (
        "tests.integration.test_provider_management_approval.RequireIndependentIdentity"
    )
    assert not permits_provider_operations(user)
    assert user.provider_terms_accepted_at


def test_phone_ticket_registration_also_creates_a_pending_provider_without_documents(sms):
    from tests.integration.test_auth_flow import register_new_number

    user = register_new_number(sms, "0209740004", account_type="provider", **consent())
    assert user.is_registration_complete
    assert Verification.objects.get(kind="provider", subject_id=str(user.id)).status == "pending"
    assert not Verification.objects.filter(kind="identity").exists()


def test_accepted_terms_snapshot_survives_later_terms_edits(settings):
    user, _, response = new_provider()
    assert response.status_code == 201, response.data
    approval = Verification.objects.get(kind="provider")
    accepted = approval.provider_response["terms"].copy()
    settings.PROVIDER_TERMS_TEXT = "A later agreement with different contents."
    assert policy()["digest"] != accepted["digest"]
    assert decide(approval).status_code == 200
    approval.refresh_from_db()
    assert approval.provider_response["terms"] == accepted
    user.refresh_from_db()
    assert user.provider_terms_digest == accepted["digest"]


def test_approved_account_can_prepare_property_but_cannot_publish_without_property_verification(
    settings,
):
    from apps.geo.models import Address, District, Locality, Region
    from apps.organization.models import OrganizationMembership
    from apps.property.capabilities import property_capabilities
    from apps.property.services import create_private_property

    user, _, response = new_provider()
    assert response.status_code == 201, response.data
    assert decide(Verification.objects.get(kind="provider")).status_code == 200
    membership = OrganizationMembership.objects.get(user=user, role="owner")
    region = Region.objects.create(name="Approval region", code="APR")
    district = District.objects.create(name="Approval district", region=region)
    locality = Locality.objects.create(name="Approval locality", district=district)
    address = Address.objects.create(locality=locality)
    prop = create_private_property(
        user=user,
        organization=membership.organization,
        data={
            "title": "Approval Court",
            "property_type": "residential",
            "address_id": address.id,
        },
    )
    result = property_capabilities(prop=prop, user=user)
    assert result["private_inventory"]["allowed"]
    for capability in ["tenant_access", "leases", "publication", "payment_collection"]:
        assert not result[capability]["allowed"]
        assert "property_authority" in result[capability]["missing"]
    assert not Verification.objects.filter(kind="identity").exists()

    from apps.core.exceptions import ValidationFailed
    from apps.files.models import ScanStatus, StoredFile, UploadStatus
    from apps.property.services import submit_provider_application

    data = {
        "property_id": prop.id,
        "organization_id": membership.organization_id,
        "relationship_type": "owner",
        "title": prop.title,
        "property_type": "residential",
        "address_id": address.id,
    }
    with pytest.raises(ValidationFailed):
        submit_provider_application(user=user, data=data, files=[])
    document = StoredFile.objects.create(
        uploaded_by=user,
        owner_id_snapshot=str(user.id),
        purpose="property_document",
        original_filename="authority.pdf",
        declared_content_type="application/pdf",
        content_type="application/pdf",
        size_bytes=2048,
        storage_key=f"property-authority/{uuid4()}.pdf",
        upload_status=UploadStatus.READY,
        scan_status=ScanStatus.CLEAN,
    )
    application = submit_provider_application(user=user, data=data, files=[document])
    authority = Verification.objects.get(id=application.authority_verification_id)
    assert authority.evidence.count() == 1
    reviewed = decide(authority)
    assert reviewed.status_code == 200, reviewed.data
    application.refresh_from_db()
    assert application.status == "approved"
    assert property_capabilities(prop=prop, user=user)["tenant_access"]["allowed"]
    assert not Verification.objects.filter(kind="identity").exists()

    # The future policy must also be able to supersede a legacy identity result.
    Verification.objects.create(
        subject_type="user",
        subject_id=user.id,
        kind="identity",
        method="document_review",
        status="approved",
    )
    settings.PROVIDER_IDENTITY_POLICY = (
        "tests.integration.test_provider_management_approval.RequireIndependentIdentity"
    )
    replacement = property_capabilities(prop=prop, user=user)
    assert replacement["private_inventory"]["allowed"]  # Existing private membership access.
    assert "identity" in replacement["tenant_access"]["missing"]
    from apps.property.services import provider_readiness

    assert provider_readiness(user)["next_step"] == "identity"


@pytest.mark.parametrize("phone", [None, "+233209740005"])
def test_password_registration_cannot_spoof_phone_verification(phone):
    user = User.objects.create_user(phone=phone)
    api = APIClient()
    api.force_authenticate(user=user)
    response = api.post(
        "/api/v1/me/registration/",
        {
            "account_type": "provider",
            "first_name": "Ama",
            "last_name": "Provider",
            "date_of_birth": "1990-06-15",
            "email": "provider@example.com",
            "password": PASSWORD,
            "phone": "+233209740005",
            "is_phone_verified": True,
            **consent(),
        },
        format="json",
    )
    assert response.status_code == 403, response.data
    user.refresh_from_db()
    assert not user.is_phone_verified and not user.is_registration_complete
    assert not Verification.objects.filter(kind="provider").exists()
    assert not ReviewQueueEntry.objects.exists()


def google_provider(monkeypatch):
    from tests.integration.test_google_auth import register_google

    api = APIClient()
    response = register_google(api, monkeypatch, account_type="provider")
    assert response.status_code == 201, response.data
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access_token']}")
    return User.objects.get(), api


def test_google_provider_must_complete_otp_before_submitting(monkeypatch, sms):
    from tests.integration.test_google_auth import code_from
    from tests.integration.test_runtime_configuration_and_support import management_client

    user, api = google_provider(monkeypatch)
    _, management = management_client()
    state = api.get("/api/v1/me/provider-verification/").data
    assert state["application_state"] == "incomplete"
    assert state["terms_accepted"] and not state["onboarding_complete"]
    assert not Verification.objects.filter(kind="provider").exists()
    refused = api.post(
        "/api/v1/me/provider-verification/",
        {
            **consent(),
            "phone": "+233209740006",
            "is_phone_verified": True,
        },
        format="json",
    )
    assert refused.status_code == 403
    assert management.get("/api/v1/management/verifications/").data["results"] == []
    started = api.post(
        "/api/v1/me/phone/",
        {
            "phone": "0209740006",
            "device_fingerprint": "google-browser",
        },
        format="json",
    )
    assert started.status_code == 201, started.data
    code = code_from(sms)
    wrong = "000000" if code != "000000" else "111111"
    rejected = api.post(
        "/api/v1/me/phone/verify/",
        {
            "challenge_id": started.data["challenge_id"],
            "code": wrong,
        },
        format="json",
    )
    assert rejected.status_code == 400, rejected.data
    assert (
        api.post("/api/v1/me/provider-verification/", consent(), format="json").status_code == 403
    )
    assert not ReviewQueueEntry.objects.exists()
    verified = api.post(
        "/api/v1/me/phone/verify/",
        {
            "challenge_id": started.data["challenge_id"],
            "code": code,
        },
        format="json",
    )
    assert verified.status_code == 200, verified.data
    assert not Verification.objects.filter(kind="provider").exists()
    assert not ReviewQueueEntry.objects.exists()  # Verification alone is not submission.
    assert (
        api.post("/api/v1/me/provider-verification/", consent(), format="json").status_code == 201
    )
    assert (
        api.post("/api/v1/me/provider-verification/", consent(), format="json").status_code == 201
    )
    assert Verification.objects.filter(kind="provider", status="pending").count() == 1
    assert ReviewQueueEntry.objects.count() == 1
    groups = management.get("/api/v1/management/verifications/").data["results"]
    assert len(groups) == 1
    assert groups[0]["items"][0]["verification"]["subject_id"] == str(user.id)


@pytest.mark.parametrize("method", ["management_approval", "document_review"])
def test_preexisting_unverified_review_is_hidden_and_cannot_be_approved(monkeypatch, method):
    from apps.identity.provider_approval import record_terms_acceptance
    from tests.integration.test_runtime_configuration_and_support import management_client

    user, _ = google_provider(monkeypatch)
    snapshot = record_terms_acceptance(user=user, terms=policy())
    approval = Verification.objects.create(
        kind="provider",
        subject_type="user",
        subject_id=user.id,
        method=method,
        status="pending",
        submitted_by=user,
        provider_reference=policy()["digest"],
        provider_response={"terms": snapshot},
    )
    entry = ReviewQueueEntry.objects.create(verification=approval)
    _, management = management_client()
    assert management.get("/api/v1/management/verifications/").data["results"] == []
    assert (
        management.get("/api/v1/management/dashboard/").data["counts"]["pending_verifications"] == 0
    )
    claim = management.post(
        f"/api/v1/management/verifications/{entry.id}/claim/", {}, format="json"
    )
    assert claim.status_code == 404
    assert decide(approval).status_code == 403
    approval.refresh_from_db()
    assert approval.status == "pending"  # Historical data is retained.
    assert not user.has_role("landlord")
