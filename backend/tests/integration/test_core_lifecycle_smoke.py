"""One executable contract for Rooomly's implemented rental lifecycle.

Domain tests explain individual rules; this smoke test proves those rules still
connect without bypassing Property or Unit verification gates.
"""

from datetime import date, timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db

PASSWORD = "correct-horse-battery-staple"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 4096


@pytest.fixture(autouse=True)
def lifecycle_storage(settings, monkeypatch):
    from django.db import transaction

    from apps.files.storage import get_storage, reset_storage

    settings.STORAGE_BACKEND = "memory"
    settings.FILE_SCAN_MODE = "permissive"
    reset_storage()
    monkeypatch.setattr(transaction, "on_commit", lambda func, using=None: func())
    yield get_storage()
    reset_storage()


def _sent_code(sms) -> str:
    return "".join(character for character in sms.outbox[-1].body.split()[0] if character.isdigit())


def _register(*, phone: str, account_type: str, sms) -> tuple[APIClient, dict]:
    """Register through the same three HTTP calls used by web and mobile."""
    api = APIClient()
    challenged = api.post(
        "/api/v1/auth/challenge/",
        {"phone": phone, "purpose": "sign_up"},
        format="json",
        HTTP_X_CLIENT="mobile",
    )
    assert challenged.status_code == 201, challenged.data
    verified = api.post(
        "/api/v1/auth/verify/",
        {
            "challenge_id": challenged.data["challenge_id"],
            "code": _sent_code(sms),
            "platform": "android",
        },
        format="json",
        HTTP_X_CLIENT="mobile",
    )
    assert verified.status_code == 200, verified.data
    registered = api.post(
        "/api/v1/me/registration/",
        {
            "registration_ticket": verified.data["registration_ticket"],
            "account_type": account_type,
            "first_name": "Kojo" if account_type == "provider" else "Abena",
            "last_name": "Lifecycle",
            "date_of_birth": "1992-04-11",
            "password": PASSWORD,
            "platform": "android",
        },
        format="json",
        HTTP_X_CLIENT="mobile",
    )
    assert registered.status_code == 201, registered.data
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {registered.data['access_token']}")
    return api, registered.data["user"]


def _ready_file(*, user, storage, purpose: str, name: str):
    """Create a scanned-ready upload; the smoke target is the rental contract."""
    from apps.files import services

    stored, _ = services.reserve_upload(
        user=user,
        purpose=purpose,
        filename=name,
        content_type="image/jpeg",
        size_bytes=len(JPEG),
    )
    storage.write(key=stored.storage_key, data=JPEG)
    completed = services.complete_upload(user=user, file_id=stored.id)
    completed.refresh_from_db()
    assert completed.is_usable
    return completed


def _management_client() -> APIClient:
    from apps.operations.models import ManagementRole, ManagementUser

    operator = ManagementUser(
        email="lifecycle-reviewer@example.com",
        first_name="Akua",
        last_name="Lifecycle",
        role=ManagementRole.OPERATIONS_ADMIN,
        is_active=True,
        must_change_password=False,
    )
    operator.set_password(PASSWORD)
    operator.save()
    api = APIClient()
    login = api.post(
        "/api/v1/management/auth/login/",
        {"email": operator.email, "password": PASSWORD},
        format="json",
        HTTP_ORIGIN="http://localhost:3000",
    )
    assert login.status_code == 200, login.data
    api.credentials(HTTP_X_MANAGEMENT_CSRF=login.data["csrf_token"])
    return api


def _review_group(management: APIClient, *, key: str) -> dict:
    queue = management.get("/api/v1/management/verifications/")
    assert queue.status_code == 200, queue.data
    return next(group for group in queue.data["results"] if group["key"] == key)


def _approve_check(management: APIClient, *, key: str, idempotency_key: str) -> dict:
    group = _review_group(management, key=key)
    verification_id = group["items"][0]["verification"]["id"]
    decided = management.post(
        f"/api/v1/management/verifications/{verification_id}/decision/",
        {"approved": True, "note": "Approved by the core lifecycle smoke test."},
        format="json",
        HTTP_IDEMPOTENCY_KEY=idempotency_key,
    )
    assert decided.status_code == 200, decided.data
    return decided.data


def _approve_property(management: APIClient, *, property_id: str) -> dict:
    group = _review_group(management, key=f"property:{property_id}")
    assert len(group["items"]) == 2, "one Property package must contain authority and condition"
    decided = management.post(
        f"/api/v1/management/property-verifications/{group['submission_id']}/decision/",
        {"approved": True, "note": "The complete Property package was verified."},
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-property-decision",
    )
    assert decided.status_code == 200, decided.data
    return decided.data


def test_provider_to_tenant_core_lifecycle(sms, lifecycle_storage):
    """Provider registration through confirmed rent record, over current APIs."""
    from apps.geo.models import District, Locality, Region
    from apps.identity.models import User
    from apps.occupancy.models import Occupancy
    from apps.outbox.tasks import dispatch_pending
    from apps.tenancy.models import Tenancy

    provider_api, provider_payload = _register(phone="0247001001", account_type="provider", sms=sms)
    provider = User.objects.get(id=provider_payload["id"])
    provider_document = _ready_file(
        user=provider,
        storage=lifecycle_storage,
        purpose="identity_document",
        name="provider-ghana-card.jpg",
    )
    standing = provider_api.post(
        "/api/v1/me/provider-verification/",
        {
            "documents": [
                {"file_id": str(provider_document.id), "evidence_type": "ghana_card_front"}
            ]
        },
        format="json",
    )
    assert standing.status_code == 201, standing.data
    assert standing.data["can_create_property"] is False

    management = _management_client()
    _approve_check(
        management,
        key=f"user:{provider.id}",
        idempotency_key="smoke-provider-decision",
    )
    provider_state = provider_api.get("/api/v1/me/provider-verification/")
    assert provider_state.data["can_create_property"] is True

    # The existing rent-record confirmation policy requires a reviewed receiving
    # destination. There is no payout-account workflow yet (Payment Core has not
    # started), so establish that external prerequisite explicitly rather than
    # weakening the gate or pretending this smoke test moved money.
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    Verification.objects.create(
        subject_type=SubjectType.USER,
        subject_id=str(provider.id),
        kind=VerificationKind.BANK_ACCOUNT,
        method=VerificationMethod.PROVIDER_API,
        status=VerificationStatus.APPROVED,
        submitted_by=provider,
        decided_at=timezone.now(),
    )

    organization = provider_api.post(
        "/api/v1/organizations/",
        {
            "name": "Lifecycle Homes",
            "organization_type": "individual_owner",
            "activities": ["residential"],
        },
        format="json",
    )
    assert organization.status_code == 201, organization.data

    region = Region.objects.create(name="Greater Accra", code="SMOKE-GA")
    district = District.objects.create(region=region, name="La Dade-Kotopon Municipal")
    locality = Locality.objects.create(district=district, name="Osu")
    address = provider_api.post(
        "/api/v1/geo/addresses/",
        {
            "locality_id": str(locality.id),
            "street": "Oxford Street",
            "house_number": "12",
            "digital_address": "GA-123-4567",
            "landmark": "Beside the pharmacy",
            "latitude": "5.556020",
            "longitude": "-0.182740",
        },
        format="json",
    )
    assert address.status_code == 201, address.data

    created = provider_api.post(
        f"/api/v1/organizations/{organization.data['id']}/properties/",
        {
            "title": "Lifecycle Court",
            "property_type": "residential",
            "address_id": address.data["id"],
            "water_source": "borehole",
            "power_meter_type": "prepaid",
            "compound_type": "self_compound",
        },
        format="json",
    )
    assert created.status_code == 201, created.data
    property_id = created.data["id"]
    assert created.data["verification"]["review_state"] == "not_submitted"

    authority_document = _ready_file(
        user=provider,
        storage=lifecycle_storage,
        purpose="property_document",
        name="property-authority.jpg",
    )
    claim = provider_api.post(
        f"/api/v1/properties/{property_id}/claim/",
        {"relationship_type": "owner", "file_ids": [str(authority_document.id)]},
        format="json",
    )
    assert claim.status_code == 201, claim.data

    property_progress = provider_api.get(f"/api/v1/properties/{property_id}/verification/")
    assert property_progress.status_code == 200, property_progress.data
    for index, slot in enumerate(property_progress.data["slots"]):
        if not slot["required"]:
            continue
        photo = _ready_file(
            user=provider,
            storage=lifecycle_storage,
            purpose="property_photo",
            name=f"property-{index}.jpg",
        )
        evidence = provider_api.post(
            f"/api/v1/properties/{property_id}/verification/evidence/",
            {"slot_key": slot["key"], "file_id": str(photo.id)},
            format="json",
        )
        assert evidence.status_code == 201, evidence.data

    submitted_property = provider_api.post(
        f"/api/v1/properties/{property_id}/verification/",
        {},
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-property-submission",
    )
    assert submitted_property.status_code == 200, submitted_property.data
    assert submitted_property.data["state"] == "submitted"
    property_decision = _approve_property(management, property_id=property_id)
    assert property_decision["verification"]["review_state"] == "verified"

    unit = provider_api.post(
        f"/api/v1/properties/{property_id}/units/",
        {
            "label": "Flat A",
            "space_type": "apartment",
            "bedrooms": 2,
            "bathrooms": 1,
            "entrance_note": "Use the blue gate beside the pharmacy.",
        },
        format="json",
    )
    assert unit.status_code == 201, unit.data
    unit_id = unit.data["id"]
    assert unit.data["verification"]["state"] == "draft"

    unit_photo = _ready_file(
        user=provider,
        storage=lifecycle_storage,
        purpose="property_photo",
        name="flat-a-main-room.jpg",
    )
    attached = provider_api.post(
        f"/api/v1/units/{unit_id}/photos/",
        {"file_id": str(unit_photo.id)},
        format="json",
    )
    assert attached.status_code == 201, attached.data
    submitted_unit = provider_api.post(
        f"/api/v1/units/{unit_id}/verification/",
        {},
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-unit-submission",
    )
    assert submitted_unit.status_code == 200, submitted_unit.data
    assert submitted_unit.data["state"] == "submitted"
    _approve_check(
        management,
        key=f"space:{unit_id}",
        idempotency_key="smoke-unit-decision",
    )
    verified_unit = provider_api.get(f"/api/v1/units/{unit_id}/")
    assert verified_unit.data["verification"]["state"] == "verified"

    listing = provider_api.post(
        "/api/v1/me/listings/",
        {
            "unit_id": unit_id,
            "rent_minor": 150000,
            "rent_period": "monthly",
            "advance_months": 6,
            "deposit_months": 1,
            "headline": "Verified two-bedroom in Osu",
            "description": "A quiet home near Oxford Street.",
        },
        format="json",
    )
    assert listing.status_code == 201, listing.data
    listing_id = listing.data["id"]
    published = provider_api.post(f"/api/v1/listings/{listing_id}/publish/", {}, format="json")
    assert published.status_code == 200, published.data
    assert published.data["status"] == "active"
    public_results = APIClient().get("/api/v1/listings/?q=Osu")
    assert any(row["id"] == listing_id for row in public_results.data["results"])

    tenant_api, tenant_payload = _register(phone="0247001002", account_type="tenant", sms=sms)
    viewing = tenant_api.post(
        "/api/v1/me/viewings/",
        {
            "listing_id": listing_id,
            "message": "May I view it?",
            "availability_note": "Saturday",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-viewing-request",
    )
    assert viewing.status_code == 201, viewing.data
    viewing_id = viewing.data["id"]
    offered_slots = provider_api.post(
        f"/api/v1/viewings/{viewing_id}/offer/",
        {
            "slots": [{"starts_at": (timezone.now() + timedelta(days=1)).isoformat()}],
        },
        format="json",
    )
    assert offered_slots.status_code == 200, offered_slots.data
    confirmed_viewing = tenant_api.post(
        f"/api/v1/viewings/{viewing_id}/confirm/",
        {"slot_id": offered_slots.data["slots"][0]["id"]},
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-viewing-confirmation",
    )
    assert confirmed_viewing.status_code == 200, confirmed_viewing.data
    assert confirmed_viewing.data["status"] == "confirmed"
    assert confirmed_viewing.data["viewing_directions"]["street"] == "Oxford Street"

    application = tenant_api.post(
        "/api/v1/me/applications/",
        {
            "listing_id": listing_id,
            "advance_months_offered": 6,
            "household_size": 2,
            "guarantor_name": "Ama Mensah",
            "guarantor_phone": "0244000111",
            "guarantor_relationship": "Aunt",
            "message": "We are ready to proceed.",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-application",
    )
    assert application.status_code == 201, application.data
    application_id = application.data["id"]
    inbox = provider_api.get("/api/v1/me/received-applications/?open=true")
    assert any(row["id"] == application_id for row in inbox.data)
    reviewing = provider_api.post(
        f"/api/v1/applications/{application_id}/review/",
        {},
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-application-review",
    )
    assert reviewing.status_code == 200, reviewing.data
    accepted_application = provider_api.post(
        f"/api/v1/applications/{application_id}/accept/",
        {"note": "Application approved for lease."},
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-application-accept",
    )
    assert accepted_application.status_code == 200, accepted_application.data
    assert accepted_application.data["status"] == "accepted"

    lease = provider_api.post(
        "/api/v1/me/leases/",
        {
            "unit_id": unit_id,
            "tenant_id": tenant_payload["id"],
            "application_id": application_id,
            "listing_id": listing_id,
            "rent_minor": 150000,
            "advance_months": 6,
            "deposit_months": 1,
            "starts_on": str(date.today() + timedelta(days=14)),
            "term_months": 12,
            "conditions": "Utilities are paid separately by the tenant.",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-lease-draft",
    )
    assert lease.status_code == 201, lease.data
    lease_id = lease.data["id"]
    offered_lease = provider_api.post(
        f"/api/v1/leases/{lease_id}/offer/",
        {},
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-lease-offer",
    )
    assert offered_lease.status_code == 200, offered_lease.data
    assert offered_lease.data["agreement"]["content_hash"]
    tenant_leases = tenant_api.get("/api/v1/me/leases/")
    assert any(row["id"] == lease_id for row in tenant_leases.data)
    accepted_lease = tenant_api.post(
        f"/api/v1/leases/{lease_id}/accept/",
        {},
        format="json",
        HTTP_IDEMPOTENCY_KEY="smoke-lease-accept",
    )
    assert accepted_lease.status_code == 200, accepted_lease.data
    assert accepted_lease.data["status"] == "active"
    assert Tenancy.objects.filter(leases__id=lease_id, tenant_id=tenant_payload["id"]).exists()
    assert Occupancy.objects.filter(lease_id=lease_id, user_id=tenant_payload["id"]).exists()
    tenancies = tenant_api.get("/api/v1/me/tenancies/")
    assert any(row["lease"]["id"] == lease_id for row in tenancies.data)

    dispatch = dispatch_pending()
    assert dispatch["failed"] == 0
    schedule = tenant_api.get(f"/api/v1/leases/{lease_id}/charges/")
    assert schedule.status_code == 200, schedule.data
    advance = next(charge for charge in schedule.data["charges"] if charge["kind"] == "advance")
    payment = tenant_api.post(
        "/api/v1/rent/payments/",
        {
            "lease_id": lease_id,
            "charge_id": advance["id"],
            "amount_minor": advance["amount_minor"],
            "paid_on": str(date.today()),
            "method": "momo",
            "reference": "SMOKE-MOMO-0001",
        },
        format="json",
    )
    assert payment.status_code == 201, payment.data
    confirmed_payment = provider_api.post(
        f"/api/v1/rent/payments/{payment.data['id']}/confirm/", {}, format="json"
    )
    assert confirmed_payment.status_code == 200, confirmed_payment.data
    assert confirmed_payment.data["status"] == "confirmed"
    history = tenant_api.get("/api/v1/me/rental-history/")
    assert history.data["payments_confirmed"] == 1
