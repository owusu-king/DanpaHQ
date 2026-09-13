from datetime import timedelta

import pytest
from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditAction, AuditLog
from apps.identity.models import Session, User
from apps.operations.models import ManagementRole, ManagementUser

pytestmark = pytest.mark.django_db

PASSWORD = "correct-horse-battery-staple"


def management_user(role=ManagementRole.OPERATIONS_ADMIN, email="ops@example.com"):
    user = ManagementUser(
        email=email,
        first_name="Akua",
        last_name="Mensah",
        role=role,
        is_active=True,
        must_change_password=False,
    )
    user.set_password(PASSWORD)
    user.save()
    return user


def signed_in_client(user):
    client = APIClient()
    response = client.post(
        "/api/v1/management/auth/login/",
        {"email": user.email, "password": PASSWORD},
        format="json",
        HTTP_ORIGIN="http://localhost:3000",
    )
    assert response.status_code == 200
    csrf = response.data["csrf_token"]
    client.credentials(HTTP_X_MANAGEMENT_CSRF=csrf)
    return client


def test_management_roles_are_exactly_the_two_requested_roles():
    assert ManagementRole.values == ["operations_admin", "support_admin"]


def test_management_login_uses_email_password_and_an_isolated_cookie():
    user = management_user()
    response = APIClient().post(
        "/api/v1/management/auth/login/",
        {"email": "OPS@EXAMPLE.COM", "password": PASSWORD},
        format="json",
        HTTP_ORIGIN="http://localhost:3000",
    )

    assert response.status_code == 200
    assert response.data["user"]["role"] == "operations_admin"
    cookie = response.cookies["grp_management_session"]
    assert cookie["httponly"]
    assert cookie["samesite"] == "Strict"
    assert AuditLog.objects.filter(action=AuditAction.LOGIN, management_actor_id=user.id).exists()


def test_management_sign_in_is_capped_per_address():
    """Twenty attempts in fifteen minutes, and the twenty-first is refused.

    The cap used to be read-modify-write over the cache — every attempt read a
    number, added one, and wrote it back — so simultaneous attempts all read the
    same number and the cap never closed. It counts atomically now.
    """
    management_user()
    client = APIClient()
    wrong = {"email": "ops@example.com", "password": "not-the-password"}

    for attempt in range(20):
        response = client.post(
            "/api/v1/management/auth/login/",
            wrong,
            format="json",
            HTTP_ORIGIN="http://localhost:3000",
        )
        assert response.status_code == 403, f"attempt {attempt + 1}: {response.data}"

    refused = client.post(
        "/api/v1/management/auth/login/",
        wrong,
        format="json",
        HTTP_ORIGIN="http://localhost:3000",
    )
    assert refused.status_code == 429
    assert refused.data["error"]["code"] == "rate_limited"

    # And the cap is about attempts, not about whether the password was right:
    # the correct one is refused too while the window holds.
    correct = client.post(
        "/api/v1/management/auth/login/",
        {"email": "ops@example.com", "password": PASSWORD},
        format="json",
        HTTP_ORIGIN="http://localhost:3000",
    )
    assert correct.status_code == 429


def test_management_sign_in_refuses_when_its_limiter_cannot_count(monkeypatch):
    """A password form whose limiter is blind must not open.

    The cache went down with a corrupt append-only file and this view answered
    500 from inside `cache.get`. The tempting fix — treat the failure as zero
    attempts — would have left the Management password form unlimited for the
    length of the outage. It fails closed instead, and says so in a way the
    person on the other end can act on.
    """
    from django.core.cache import cache

    management_user()

    def unreachable(*args, **kwargs):
        raise OSError("[Errno -2] Name or service not known")

    for method in ("get", "set", "add", "incr", "touch"):
        monkeypatch.setattr(cache, method, unreachable)

    response = APIClient().post(
        "/api/v1/management/auth/login/",
        {"email": "ops@example.com", "password": PASSWORD},
        format="json",
        HTTP_ORIGIN="http://localhost:3000",
    )

    assert response.status_code == 503
    assert response.data["error"]["code"] == "provider_unavailable"
    assert response.data["error"]["details"]["reason"] == "rate_limit_unavailable"
    # Nobody was signed in on the way past the limiter.
    assert "grp_management_session" not in response.cookies
    assert not AuditLog.objects.filter(action=AuditAction.LOGIN).exists()


def test_consumer_and_django_sessions_cannot_authenticate_management(user):
    consumer_session = Session.objects.create(
        user=user,
        refresh_token_hash="unused",
        expires_at=timezone.now() + timedelta(days=1),
    )
    from apps.identity.services import issue_access_token

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_access_token(user, consumer_session)}")
    assert client.get("/api/v1/management/dashboard/").status_code == 401


def test_support_can_view_users_but_cannot_mutate_or_open_audit_logs(user):
    support = management_user(ManagementRole.SUPPORT_ADMIN, "support@example.com")
    client = signed_in_client(support)

    assert client.get("/api/v1/management/users/").status_code == 200
    assert (
        client.post(
            f"/api/v1/management/users/{user.id}/status/",
            {"active": False, "reason": "test"},
            format="json",
        ).status_code
        == 403
    )
    assert client.get("/api/v1/management/verifications/").status_code == 403
    assert client.get("/api/v1/management/audit-logs/").status_code == 403


def test_operations_can_deactivate_consumer_and_action_is_attributed(user):
    operator = management_user()
    client = signed_in_client(operator)

    response = client.post(
        f"/api/v1/management/users/{user.id}/status/",
        {"active": False, "reason": "Confirmed account takeover"},
        format="json",
    )

    assert response.status_code == 200
    user.refresh_from_db()
    assert not user.is_active
    entry = AuditLog.objects.filter(
        aggregate_type="user", aggregate_id=str(user.id), action=AuditAction.PERMISSION_CHANGE
    ).first()
    assert entry.management_actor_id == operator.id
    assert entry.actor_role == ManagementRole.OPERATIONS_ADMIN


def test_management_mutations_require_management_csrf(user):
    operator = management_user()
    client = signed_in_client(operator)
    client.credentials()

    response = client.post(
        f"/api/v1/management/users/{user.id}/status/",
        {"active": False, "reason": "test"},
        format="json",
    )

    assert response.status_code == 403


def test_only_superusers_can_authenticate_to_django_admin():
    User.objects.create_user(
        phone="0500000099",
        email="staff@example.com",
        password=PASSWORD,
        is_staff=True,
        is_email_verified=True,
    )
    superuser = User.objects.create_superuser(
        phone="0500000098", email="root@example.com", password=PASSWORD
    )

    assert authenticate(username="staff@example.com", password=PASSWORD) is None
    assert authenticate(username="root@example.com", password=PASSWORD) == superuser


class TestReviewingProviderStanding:
    """The support team's actual job, end to end.

    The decision endpoint had no coverage at all, which is how it went this long
    without anyone noticing that a reviewer opening a check on a *person* was
    shown a name, a document, and nothing else.
    """

    JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 4096

    @pytest.fixture(autouse=True)
    def storage(self, settings, monkeypatch):
        from django.db import transaction

        from apps.files.storage import get_storage, reset_storage

        settings.STORAGE_BACKEND = "memory"
        settings.FILE_SCAN_MODE = "permissive"
        reset_storage()
        monkeypatch.setattr(transaction, "on_commit", lambda func, using=None: func())
        yield get_storage()
        reset_storage()

    def _submitted_provider(self, registered, storage, phone="0209887766"):
        from apps.files import services as file_services
        from apps.files.models import StoredFile
        from apps.identity import services as id_services

        applicant = registered(phone, account_type="provider")
        stored, _ = file_services.reserve_upload(
            user=applicant,
            purpose="identity_document",
            filename="ghcard.png",
            content_type="image/jpeg",
            size_bytes=len(self.JPEG),
        )
        storage.write(key=stored.storage_key, data=self.JPEG)
        file_services.complete_upload(user=applicant, file_id=stored.id)
        id_services.start_provider_verification(
            user=applicant,
            documents=[
                {
                    "file": StoredFile.objects.get(id=stored.id),
                    "evidence_type": "ghana_card_front",
                }
            ],
        )
        return applicant

    def test_a_reviewer_sees_the_person_behind_the_document(self, registered, storage):
        """Deciding "may this person operate here" needs the account, not just
        the attachment."""
        self._submitted_provider(registered, storage)
        client = signed_in_client(management_user())

        queue = client.get("/api/v1/management/verifications/")

        assert queue.status_code == 200
        item = next(row for row in queue.data["items"] if row["verification"]["kind"] == "provider")
        context = item["verification"]["subject_context"]
        assert context is not None, "a check about a person must say who they are"
        assert context["phone_verified"] is True
        assert context["account_type"] == "provider"
        assert context["registration"] == "complete"
        assert "***" in context["phone"], "the number is masked on the ops surface"

    def test_a_reviewer_can_open_the_evidence(self, registered, storage):
        self._submitted_provider(registered, storage, phone="0209887767")
        client = signed_in_client(management_user())

        item = next(
            row
            for row in client.get("/api/v1/management/verifications/").data["items"]
            if row["verification"]["kind"] == "provider"
        )
        verification = item["verification"]
        evidence = verification["evidence"][0]

        opened = client.get(
            f"/api/v1/management/verifications/{verification['id']}" f"/evidence/{evidence['id']}/"
        )

        assert opened.status_code == 200
        assert opened.data["download_url"]

    def test_approving_records_who_decided_it_and_establishes_identity(self, registered, storage):
        from apps.trust.models import SubjectType, VerificationKind
        from apps.trust.services import current_for

        applicant = self._submitted_provider(registered, storage, phone="0209887768")
        reviewer = management_user()
        client = signed_in_client(reviewer)

        item = next(
            row
            for row in client.get("/api/v1/management/verifications/").data["items"]
            if row["verification"]["kind"] == "provider"
        )
        decided = client.post(
            f"/api/v1/management/verifications/{item['verification']['id']}/decision/",
            {"approved": True, "note": "Card matches the account."},
            format="json",
        )

        assert decided.status_code == 200
        assert decided.data["status"] == "approved"

        # The same review answers identity, and the record says which reviewer
        # decided it — the portal's principals are not identity.User rows, so
        # without the management id the derived check would name nobody.
        identity = current_for(SubjectType.USER, applicant.id, VerificationKind.IDENTITY)
        assert identity is not None
        assert identity.decided_by_management_id == reviewer.id
        assert identity.evidence.count() == 1

    def test_a_support_admin_may_look_but_not_decide(self, registered, storage):
        """Reading a case and deciding one are separate capabilities."""
        self._submitted_provider(registered, storage, phone="0209887769")
        client = signed_in_client(
            management_user(role=ManagementRole.SUPPORT_ADMIN, email="support@example.com")
        )

        assert client.get("/api/v1/management/verifications/").status_code == 403


def test_property_list_survives_a_property_with_no_legacy_owner():
    """The whole page was a 500 as soon as one such property existed.

    `Property.owner` is the legacy individual-owner shortcut and is nullable —
    its own help text says organization authority is canonical. Every property
    created through the private or claim flow has it null, so reading
    `owner.display_name` was not an edge case but the normal one.
    """
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import (
        Property,
        PropertyRelationship,
        PropertyRelationshipType,
        PropertyType,
    )

    region = Region.objects.create(name="Greater Accra", code="MGT-GA")
    district = District.objects.create(region=region, name="Adentan Municipal")
    locality = Locality.objects.create(district=district, name="Adenta")
    claimant = User.objects.create_user(
        phone="+233209700001", first_name="Kwesi", last_name="Owner"
    )

    ownerless = Property.objects.create(
        owner=None,
        created_by=claimant,
        title="Claimed, not owned",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street="1 Claim Road"),
    )
    PropertyRelationship.objects.create(
        property=ownerless,
        user=claimant,
        relationship_type=PropertyRelationshipType.OWNER,
        granted_by=claimant,
    )

    client = signed_in_client(management_user(email="props@example.com"))
    response = client.get("/api/v1/management/properties/")

    assert response.status_code == 200
    row = next(r for r in response.data["results"] if r["id"] == str(ownerless.id))
    # The live relationship is who holds it, so that is who is shown.
    assert row["owner"] == claimant.display_name
    assert row["relationship"] == PropertyRelationshipType.OWNER
    assert row["locality"] == "Adenta"


def test_a_property_nobody_is_recorded_against_still_appears():
    """Saying so beats dropping it from an operations list."""
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import Property, PropertyType

    region = Region.objects.create(name="Ashanti", code="MGT-AS")
    district = District.objects.create(region=region, name="Kumasi Metro")
    locality = Locality.objects.create(district=district, name="Asokwa")
    orphan = Property.objects.create(
        owner=None,
        title="Nobody attached",
        property_type=PropertyType.COMMERCIAL,
        address=Address.objects.create(locality=locality, street="2 Orphan Road"),
    )

    client = signed_in_client(management_user(email="orphan@example.com"))
    response = client.get("/api/v1/management/properties/")

    assert response.status_code == 200
    row = next(r for r in response.data["results"] if r["id"] == str(orphan.id))
    assert row["owner"] == "Nobody attached"
    assert row["owner_phone"] == ""
    assert row["relationship_count"] == 0
    assert row["authority_verified"] is False


def test_a_claimed_property_names_who_claimed_it():
    """ "Not recorded" was useless on every privately created property.

    `created_by` is not authority — it is whoever set the property up — but it is
    the fact a reviewer most needs, and the row now says which of the two it is
    reporting rather than showing a blank.
    """
    from apps.geo.models import Address, District, Locality, Region
    from apps.property.models import Property, PropertyType

    region = Region.objects.create(name="Volta", code="MGT-VO")
    district = District.objects.create(region=region, name="Ho Municipal")
    locality = Locality.objects.create(district=district, name="Ho")
    claimant = User.objects.create_user(
        phone="+233209700002", first_name="Efua", last_name="Claimant"
    )
    prop = Property.objects.create(
        owner=None,
        created_by=claimant,
        title="Claimed, unverified",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street="3 Claim Lane"),
    )

    client = signed_in_client(management_user(email="claims@example.com"))
    row = next(
        r
        for r in client.get("/api/v1/management/properties/").data["results"]
        if r["id"] == str(prop.id)
    )

    assert row["owner"] == claimant.display_name
    # Named as a claim, not as confirmed authority — the distinction a reviewer
    # is looking at this list to make.
    assert row["relationship"] == "claimed_unverified"
    assert row["authority_verified"] is False


@pytest.mark.parametrize(
    ("approved", "expected_check_status", "expected_application_status", "review_state"),
    [
        (True, "approved", "approved", "verified"),
        (False, "rejected", "rejected", "rejected"),
    ],
)
def test_one_property_sent_once_is_one_thing_to_decide(
    approved, expected_check_status, expected_application_status, review_state
):
    """The provider presses send once, so the queue shows one record.

    The two reviews are keyed differently — the condition check against the
    property, the authority claim against the application that names it — so
    they arrived as two unrelated rows with nothing saying they were the same
    building. A reviewer had to notice.
    """
    from apps.files.models import ScanStatus, StoredFile, UploadStatus
    from apps.geo.models import Address, District, Locality, Region
    from apps.organization import services as org_services
    from apps.property import services as property_services
    from apps.trust import condition
    from tests.conftest import approve_provider_standing

    region = Region.objects.create(name="Greater Accra", code="MGT-GRP")
    district = District.objects.create(region=region, name="Adentan Municipal")
    locality = Locality.objects.create(district=district, name="Adenta")
    landlord = User.objects.create_user(
        phone="+233209710001", first_name="Kojo", last_name="Provider"
    )
    landlord.mark_phone_verified()

    def photo(purpose):
        return StoredFile.objects.create(
            uploaded_by=landlord,
            owner_id_snapshot=str(landlord.id),
            purpose=purpose,
            original_filename="shot.jpg",
            declared_content_type="image/jpeg",
            content_type="image/jpeg",
            size_bytes=90_000,
            storage_key=f"g/{StoredFile.objects.count()}.jpg",
            upload_status=UploadStatus.READY,
            scan_status=ScanStatus.CLEAN,
        )

    approve_provider_standing(landlord)
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    for kind in (VerificationKind.PHONE, VerificationKind.IDENTITY):
        Verification.objects.get_or_create(
            subject_type=SubjectType.USER,
            subject_id=str(landlord.id),
            kind=kind,
            status=VerificationStatus.APPROVED,
            defaults={"method": VerificationMethod.DOCUMENT_REVIEW, "decided_at": timezone.now()},
        )

    organization = org_services.create_organization(
        user=landlord,
        data={
            "name": "Grouping Properties",
            "organization_type": "individual_owner",
            "activities": ["residential"],
        },
    )
    prop = property_services.create_private_property(
        user=landlord,
        organization=organization,
        data={
            "title": "Grouped Court",
            "property_type": "residential",
            "address_id": Address.objects.create(locality=locality, street="1 Group Road").id,
        },
    )

    # Both halves, the way the one button sends them.
    property_services.submit_provider_application(
        user=landlord,
        data={"relationship_type": "owner", "property_id": str(prop.id)},
        files=[photo("property_document")],
        queue=False,
    )
    for key in ("property.front", "property.side", "property.surroundings"):
        condition.attach(subject=prop, actor=landlord, slot_key=key, file=photo("property_photo"))
    property_services.submit_property_for_verification(prop=prop, user=landlord)

    operator = management_user(email="grouping@example.com")
    client = signed_in_client(operator)
    results = client.get("/api/v1/management/verifications/").data["results"]

    group = next(row for row in results if row["key"] == f"property:{prop.id}")
    kinds = {item["verification"]["kind"] for item in group["items"]}

    assert kinds == {"property_authority", "property_condition"}
    assert group["label"] == "Grouped Court"
    assert group["submission_id"]
    # All four files are reachable from the one record.
    assert sum(len(item["verification"]["evidence"]) for item in group["items"]) == 4

    # The package transaction cannot leave the photographs approved when the
    # authority decision fails its identity precondition.
    from apps.property.models import PropertyProviderApplication

    submission = PropertyProviderApplication.objects.get(id=group["submission_id"])
    identity = Verification.objects.get(
        subject_type=SubjectType.USER,
        subject_id=str(landlord.id),
        kind=VerificationKind.IDENTITY,
    )
    if approved:
        identity.status = VerificationStatus.REVOKED
        identity.save(update_fields=["status", "updated_at"])
        failed = client.post(
            f"/api/v1/management/property-verifications/{group['submission_id']}/decision/",
            {"approved": True},
            format="json",
        )
        assert failed.status_code == 422
        assert set(
            Verification.objects.filter(
                id__in=[submission.authority_verification_id, submission.condition_verification_id]
            ).values_list("status", flat=True)
        ) == {VerificationStatus.PENDING}
        identity.status = VerificationStatus.APPROVED
        identity.save(update_fields=["status", "updated_at"])

    # A client that still addresses one visible check is routed through the
    # package transaction. It does not create an independent approval.
    decision_path = (
        f"/api/v1/management/verifications/" f"{group['items'][0]['verification']['id']}/decision/"
    )
    decision_body = {
        "approved": approved,
        "note": "The complete property package was reviewed.",
    }
    decided = client.post(
        decision_path,
        decision_body,
        format="json",
        HTTP_IDEMPOTENCY_KEY="management-property-decision-01",
    )
    assert decided.status_code == 200, decided.data
    replay = client.post(
        decision_path,
        decision_body,
        format="json",
        HTTP_IDEMPOTENCY_KEY="management-property-decision-01",
    )
    assert replay.status_code == 200
    assert replay.data == decided.data
    assert replay["X-Idempotent-Replay"] == "true"

    from apps.idempotency.models import IdempotencyKey

    claim = IdempotencyKey.objects.get(key="management-property-decision-01")
    assert claim.actor_id is None
    assert claim.management_actor_id == operator.id
    assert not client.get("/api/v1/management/verifications/").data["results"]

    submission.refresh_from_db()
    assert submission.status == expected_application_status
    assert submission.condition_verification_id is not None
    assert set(
        Verification.objects.filter(
            id__in=[submission.authority_verification_id, submission.condition_verification_id]
        ).values_list("status", flat=True)
    ) == {expected_check_status}

    # The old screen used to post the second visible check too. That retry is
    # harmless and does not fail after the first request decided the package.
    repeated = client.post(
        f"/api/v1/management/verifications/{group['items'][1]['verification']['id']}/decision/",
        {"approved": approved, "note": "The complete property package was reviewed."},
        format="json",
    )
    assert repeated.status_code == 200, repeated.data

    # The canonical submission endpoint is idempotent with the same outcome.
    package_retry = client.post(
        f"/api/v1/management/property-verifications/{group['submission_id']}/decision/",
        {"approved": approved, "note": "The complete property package was reviewed."},
        format="json",
    )
    assert package_retry.status_code == 200, package_retry.data
    assert package_retry.data["verification"]["review_state"] == review_state
    assert package_retry.data["verification"]["review_state_label"] == review_state.title()


def test_a_check_about_a_person_is_its_own_record():
    """Grouping is about properties. A person's identity is not one."""
    from apps.trust.models import (
        ReviewQueueEntry,
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
    )

    person = User.objects.create_user(phone="+233209710002", first_name="Abena", last_name="Person")
    verification = Verification.objects.create(
        subject_type=SubjectType.USER,
        subject_id=str(person.id),
        kind=VerificationKind.IDENTITY,
        method=VerificationMethod.DOCUMENT_REVIEW,
        submitted_by=person,
    )
    ReviewQueueEntry.objects.create(verification=verification, priority=20)

    client = signed_in_client(management_user(email="person@example.com"))
    results = client.get("/api/v1/management/verifications/").data["results"]

    group = next(row for row in results if row["key"] == f"user:{person.id}")
    assert len(group["items"]) == 1


class TestDeviceRecovery:
    """Support's route back for a barred handset.

    `blocked_at` used to be written in one place and cleared in none, so the
    refusal's "Contact support" resolved to somebody editing the row by hand in
    Django admin. These pin that the product now has the tool the message
    promises, and that it is not handed to every Management role.
    """

    def _blocked_device(self, user):
        from apps.identity import services as identity_services
        from apps.identity.models import Device

        device = Device.objects.create(user=user, fingerprint="lost", platform="android")
        identity_services.block_device(
            device=device, reason="reported lost or stolen by owner", actor=user
        )
        return device

    def test_operations_can_lift_a_block_and_the_handset_signs_in_again(self, user):
        from apps.identity import services as identity_services

        device = self._blocked_device(user)
        client = signed_in_client(management_user(email="restore@example.com"))

        response = client.post(
            f"/api/v1/management/users/{user.id}/devices/{device.id}/restore/",
            {"reason": "Owner found the phone; verified on a support call."},
            format="json",
        )

        assert response.status_code == 200, response.data
        device.refresh_from_db()
        assert device.blocked_at is None
        # Restored, not trusted: it still has to sign in, which alerts the owner.
        assert device.removed_at is not None

        from tests.conftest import TEST_PASSWORD

        back = identity_services.sign_in_with_password(
            raw_phone=user.phone, password=TEST_PASSWORD, device_fingerprint="lost"
        )
        assert back["device"].id == device.id
        assert back["device"].removed_at is None

    def test_lifting_a_block_is_recorded_against_the_device(self, user):
        device = self._blocked_device(user)
        actor = management_user(email="audited@example.com")
        signed_in_client(actor).post(
            f"/api/v1/management/users/{user.id}/devices/{device.id}/restore/",
            {"reason": "Verified on a support call."},
            format="json",
        )

        entry = AuditLog.objects.filter(
            aggregate_type="device", aggregate_id=str(device.id)
        ).latest("id")
        assert entry.management_actor_id == actor.id
        assert entry.metadata["reason"] == "Verified on a support call."

    def test_a_reason_is_required(self, user):
        device = self._blocked_device(user)
        client = signed_in_client(management_user(email="noreason@example.com"))

        response = client.post(
            f"/api/v1/management/users/{user.id}/devices/{device.id}/restore/",
            {"reason": "   "},
            format="json",
        )

        # 422 is this API's validation refusal, not 400.
        assert response.status_code == 422
        device.refresh_from_db()
        assert device.blocked_at is not None

    def test_support_admins_can_see_the_devices_but_not_restore_one(self, user):
        device = self._blocked_device(user)
        support = management_user(role=ManagementRole.SUPPORT_ADMIN, email="support@example.com")
        client = signed_in_client(support)

        listing = client.get(f"/api/v1/management/users/{user.id}/devices/")
        assert listing.status_code == 200
        assert [row["state"] for row in listing.data] == ["blocked"]

        refused = client.post(
            f"/api/v1/management/users/{user.id}/devices/{device.id}/restore/",
            {"reason": "Trying anyway."},
            format="json",
        )
        assert refused.status_code == 403
        device.refresh_from_db()
        assert device.blocked_at is not None
