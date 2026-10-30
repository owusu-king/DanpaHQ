"""Properties for sale: standalone, verified more strictly, public once verified.

The owner's brief (2026-09-28): a provider can create a property *for sale*. It
takes no Units. It is submitted for verification like any property — more
strictly, because a sale transfers the property itself — and once verified it
goes straight to the public, with no listing or moderation step between. Buyers
ask through an enquiry, and the seller's number stays private.

These walk that journey through the real services and the real package decision,
so "public on verification" is tested against the decision a reviewer makes
rather than against verification rows written by hand.
"""

import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import ValidationFailed

pytestmark = pytest.mark.django_db


# --- the people and the place ---------------------------------------------------


def _verify_person(user):
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    user.mark_phone_verified()
    for kind in (VerificationKind.PHONE, VerificationKind.IDENTITY):
        Verification.objects.get_or_create(
            subject_type=SubjectType.USER,
            subject_id=str(user.id),
            kind=kind,
            status=VerificationStatus.APPROVED,
            defaults={"method": VerificationMethod.DOCUMENT_REVIEW, "decided_at": timezone.now()},
        )


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def seller(db):
    from apps.identity.models import Role, User
    from apps.identity.services import grant_role
    from tests.conftest import approve_provider_standing

    user = User.objects.create_user(phone="+233209720001", first_name="Esi", last_name="Seller")
    _verify_person(user)
    approve_provider_standing(user)
    # A provider's role, as the claim endpoint expects of whoever records one.
    grant_role(user=user, role=Role.LANDLORD, granted_by=user)
    return user


@pytest.fixture
def buyer(db):
    from apps.identity.models import User

    user = User.objects.create_user(phone="+233209720002", first_name="Kofi", last_name="Buyer")
    user.mark_phone_verified()
    return user


@pytest.fixture
def stranger(db):
    from apps.identity.models import User

    user = User.objects.create_user(phone="+233209720003", first_name="Ama", last_name="Other")
    user.mark_phone_verified()
    return user


@pytest.fixture
def reviewer(staff):
    return staff


@pytest.fixture
def portfolio(seller):
    from apps.organization import services as org_services
    from tests.conftest import upgrade_portfolio

    organization = org_services.create_organization(
        user=seller,
        data={
            "name": "Esi Estates",
            "organization_type": "individual_owner",
            "activities": ["sales"],
        },
    )
    # Several properties per test: past the free plan's one.
    upgrade_portfolio(organization)
    return organization


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region = Region.objects.create(name="Greater Accra", code=f"S-{uuid.uuid4().hex[:6]}")
    district = District.objects.create(region=region, name="Adentan Municipal")
    locality = Locality.objects.create(district=district, name="Adenta")
    return Address.objects.create(locality=locality, street="9 Sale Street", house_number="9")


@pytest.fixture
def upload(seller):
    from apps.files.models import ScanStatus, StoredFile, UploadStatus

    def make(purpose="property_photo"):
        return StoredFile.objects.create(
            uploaded_by=seller,
            owner_id_snapshot=str(seller.id),
            purpose=purpose,
            original_filename="f.jpg",
            declared_content_type="image/jpeg",
            content_type="image/jpeg",
            size_bytes=90_000,
            storage_key=f"{purpose}/{seller.id}/{uuid.uuid4().hex}.jpg",
            upload_status=UploadStatus.READY,
            scan_status=ScanStatus.CLEAN,
        )

    return make


LAND_DETAILS = {
    "price_minor": 25_000_000,
    "headline": "Two serviced plots near the Adenta barrier",
    "description": (
        "Level, fenced land with water and power to the boundary, " "ten minutes from the highway."
    ),
    "tenure": "leasehold",
    "lease_years_remaining": 94,
    "land_size": "2",
    "land_size_unit": "plots",
    "is_serviced": True,
}

HOUSE_DETAILS = {
    "price_minor": 120_000_000,
    "headline": "Four-bedroom house with a boys' quarters",
    "description": (
        "A detached family house on a walled compound, " "with a borehole and a standby generator."
    ),
    "tenure": "freehold",
    "bedrooms": 4,
    "bathrooms": 3,
}


def _create(api, seller, portfolio, address, *, kind, sale=None):
    api.force_authenticate(user=seller)
    made = api.post(
        f"/api/v1/organizations/{portfolio.id}/properties/",
        {
            "title": f"{kind} for sale",
            "purpose": "sale",
            "property_type": kind,
            "address_id": str(address.id),
            **({"sale": sale} if sale else {}),
        },
        format="json",
    )
    assert made.status_code == 201, made.data
    return made.data


def _complete(prop, seller, upload, *, title=True, site_plan=True, photos=True):
    """Record the claim — relationship, title, site plan — and the photographs."""
    from apps.property import services as property_services
    from apps.trust import condition
    from apps.trust.evidence_policy import sale_property_requirements

    relationship = upload("property_document")
    files = [relationship]
    types = {str(relationship.id): "ownership_document"}
    if title:
        deed = upload("property_document")
        files.append(deed)
        types[str(deed.id)] = "land_title_certificate"
    if site_plan and prop.property_type == "land":
        plan = upload("property_document")
        files.append(plan)
        types[str(plan.id)] = "site_plan"
    property_services.submit_provider_application(
        user=seller,
        data={"relationship_type": "owner", "property_id": str(prop.id), "evidence_types": types},
        files=files,
        queue=False,
    )
    if photos:
        for slot in sale_property_requirements(prop):
            if slot.required:
                condition.attach(subject=prop, actor=seller, slot_key=slot.key, file=upload())


def _verify(prop, seller, reviewer):
    """Send it, and have our team approve the whole package."""
    from apps.property import services as property_services
    from apps.property.models import PropertyProviderApplication

    property_services.submit_property_for_verification(prop=prop, user=seller)
    submission = PropertyProviderApplication.objects.get(property=prop)
    property_services.decide_property_verification(
        application=submission, approved=True, reviewer=reviewer, note="Title and plot checked."
    )


def _property(data):
    from apps.property.models import Property

    return Property.objects.get(id=data["id"])


def _public_ids(api):
    api.force_authenticate(user=None)
    response = api.get("/api/v1/sales/")
    assert response.status_code == 200, response.data
    return {row["id"] for row in response.data["results"]}


# --- a standalone property --------------------------------------------------------


class TestAStandaloneProperty:
    def test_it_is_created_for_sale_with_its_sale_record(self, api, seller, portfolio, address):
        data = _create(api, seller, portfolio, address, kind="land", sale=LAND_DETAILS)

        assert data["purpose"] == "sale"
        assert data["property_type"] == "land"
        assert data["sale"]["status"] == "active"
        # Not public: nothing is advertised before it is verified.
        assert data["sale"]["is_public"] is False

        from apps.organization.models import OrganizationActivity

        assert OrganizationActivity.objects.filter(
            organization=portfolio, activity="sales"
        ).exists()

    def test_it_takes_no_units(self, api, seller, portfolio, address):
        from apps.property import services as property_services

        prop = _property(_create(api, seller, portfolio, address, kind="residential"))

        with pytest.raises(ValidationFailed, match="sold whole"):
            property_services.add_unit(
                prop=prop,
                user=seller,
                data={"label": "Flat 1", "space_type": "apartment", "bedrooms": 2, "bathrooms": 1},
            )

    def test_each_purpose_chooses_from_its_own_categories(self, api, seller, portfolio, address):
        api.force_authenticate(user=seller)
        land_to_let = api.post(
            f"/api/v1/organizations/{portfolio.id}/properties/",
            {"title": "Plot", "property_type": "land", "address_id": str(address.id)},
            format="json",
        )
        hostel_for_sale = api.post(
            f"/api/v1/organizations/{portfolio.id}/properties/",
            {
                "title": "Hostel",
                "purpose": "sale",
                "property_type": "hostel",
                "address_id": str(address.id),
            },
            format="json",
        )

        assert land_to_let.status_code == 422
        assert hostel_for_sale.status_code == 422

    def test_the_vocabulary_keeps_land_out_of_letting(self, api):
        response = api.get("/api/v1/property-types/")

        letting = {row["value"] for row in response.data["property_types"]}
        selling = {row["value"] for row in response.data["sale_types"]}
        assert letting == {"residential", "commercial", "hostel"}
        assert selling == {"residential", "commercial", "land"}


# --- verified more strictly --------------------------------------------------------


class TestStricterVerification:
    def test_a_sale_asks_for_its_title_and_land_for_its_site_plan(
        self, api, seller, portfolio, address
    ):
        from apps.trust.evidence_policy import authority_requirements, property_requirements

        land = _property(_create(api, seller, portfolio, address, kind="land"))
        house = _property(_create(api, seller, portfolio, address, kind="residential"))

        assert [s.key for s in authority_requirements("owner", land)] == [
            "authority.ownership",
            "title.document",
            "title.site_plan",
        ]
        assert [s.key for s in authority_requirements("owner", house)] == [
            "authority.ownership",
            "title.document",
        ]
        assert [s.key for s in authority_requirements("owner", land) if s.required] == [
            "title.document"
        ]
        assert [s.key for s in authority_requirements("owner", house) if s.required] == [
            "title.document"
        ]
        # Letting is unchanged: the relationship's one document.
        assert [s.key for s in authority_requirements("owner")] == ["authority.ownership"]

        # Photographed for what is being bought.
        assert {s.key for s in property_requirements(land) if s.required} == {
            "sale.plot",
            "sale.boundary",
            "sale.access",
        }
        assert "sale.interior" in {s.key for s in property_requirements(house) if s.required}

    @pytest.mark.parametrize("kind", ["land", "residential"])
    @pytest.mark.parametrize(
        "relationship", ["owner", "agent", "manager", "company_representative"]
    )
    def test_sale_claim_accepts_title_without_optional_documents(
        self, api, seller, portfolio, address, upload, relationship, kind
    ):
        from apps.property.models import PropertyProviderApplication

        prop = _property(_create(api, seller, portfolio, address, kind=kind))
        title = upload("property_document")
        response = api.post(
            f"/api/v1/properties/{prop.id}/claim/",
            {
                "relationship_type": relationship,
                "owner_name": "Test owner",
                "owner_phone": "+233209720009",
                "company_name": "Test company",
                "file_ids": [str(title.id)],
                "evidence_types": {str(title.id): "land_title_certificate"},
            },
            format="json",
        )
        assert response.status_code == 201, response.data
        assert PropertyProviderApplication.objects.filter(property=prop).exists()

    @pytest.mark.parametrize("document_type", ["ownership_document", "site_plan"])
    def test_optional_documents_cannot_replace_required_title(
        self, api, seller, portfolio, address, upload, document_type
    ):
        prop = _property(_create(api, seller, portfolio, address, kind="land"))
        document = upload("property_document")
        response = api.post(
            f"/api/v1/properties/{prop.id}/claim/",
            {
                "relationship_type": "owner",
                "file_ids": [str(document.id)],
                "evidence_types": {str(document.id): document_type},
            },
            format="json",
        )
        assert response.status_code == 422, response.data
        assert "title" in str(response.data).lower()

    def test_title_only_land_can_complete_verification(
        self, api, seller, portfolio, address, upload, reviewer
    ):
        from apps.property.models import PropertyProviderApplication
        from apps.property.policies import can_submit_property
        from apps.property.verification import application_for
        from apps.trust.models import VerificationEvidence

        prop = _property(_create(api, seller, portfolio, address, kind="land", sale=LAND_DETAILS))
        _complete(prop, seller, upload, site_plan=False)
        claim = application_for(prop)
        VerificationEvidence.objects.filter(
            verification_id=claim.authority_verification_id,
            evidence_type="ownership_document",
        ).delete()
        assert can_submit_property(actor=seller, target=prop).allowed is True
        _verify(prop, seller, reviewer)
        assert PropertyProviderApplication.objects.get(property=prop).status == "approved"

    def test_submission_names_what_is_missing(self, api, seller, portfolio, address, upload):
        from apps.property.policies import can_submit_property
        from apps.property.verification import application_for
        from apps.trust.models import VerificationEvidence

        prop = _property(_create(api, seller, portfolio, address, kind="land"))
        _complete(prop, seller, upload, site_plan=False)
        VerificationEvidence.objects.filter(
            verification_id=application_for(prop).authority_verification_id,
            evidence_type="land_title_certificate",
        ).delete()
        decision = can_submit_property(actor=seller, target=prop)
        assert decision.allowed is False
        kinds = [blocker.kind for blocker in decision.blockers]
        assert kinds.count("title_missing") == 1
        assert "sale_details_missing" in kinds

    def test_a_document_the_review_does_not_ask_for_is_refused(
        self, api, seller, portfolio, address, upload
    ):
        """A letting property's claim cannot carry a site plan: nobody would read it."""
        api.force_authenticate(user=seller)
        made = api.post(
            f"/api/v1/organizations/{portfolio.id}/properties/",
            {"title": "Flats", "property_type": "residential", "address_id": str(address.id)},
            format="json",
        )
        document = upload("property_document")
        refused = api.post(
            f"/api/v1/properties/{made.data['id']}/claim/",
            {
                "relationship_type": "owner",
                "file_ids": [str(document.id)],
                "evidence_types": {str(document.id): "site_plan"},
            },
            format="json",
        )

        assert refused.status_code == 422


# --- public once verified ----------------------------------------------------------


@pytest.fixture
def verified_land(api, seller, portfolio, address, upload, reviewer):
    prop = _property(_create(api, seller, portfolio, address, kind="land", sale=LAND_DETAILS))
    _complete(prop, seller, upload)
    _verify(prop, seller, reviewer)
    prop.refresh_from_db()
    return prop


class TestPublicOnceVerified:
    def test_it_is_not_public_before_verification(self, api, seller, portfolio, address, upload):
        prop = _property(_create(api, seller, portfolio, address, kind="land", sale=LAND_DETAILS))
        _complete(prop, seller, upload)

        assert str(prop.sale.id) not in _public_ids(api)

    def test_verification_publishes_it_with_no_further_step(self, api, verified_land):
        sale = verified_land.sale

        assert str(sale.id) in _public_ids(api)

        detail = api.get(f"/api/v1/sales/{sale.id}/")
        assert detail.status_code == 200
        assert detail.data["kind"] == "land"
        assert detail.data["price_formatted"]
        assert detail.data["locality_name"] == "Adenta"
        assert detail.data["features"] is None  # a plot has no water source or meter

    def test_the_public_never_reads_the_street_or_the_seller(self, api, verified_land, seller):
        detail = api.get(f"/api/v1/sales/{verified_land.sale.id}/")
        text = str(detail.data)

        assert "9 Sale Street" not in text
        assert seller.phone not in text

    def test_search_filters_by_kind_and_price(self, api, verified_land):
        api.force_authenticate(user=None)
        sale_id = str(verified_land.sale.id)

        by_kind = api.get("/api/v1/sales/", {"kind": "land"}).data["results"]
        not_houses = api.get("/api/v1/sales/", {"kind": "residential"}).data["results"]
        too_cheap = api.get("/api/v1/sales/", {"price_max": 1_000}).data["results"]

        assert sale_id in {row["id"] for row in by_kind}
        assert sale_id not in {row["id"] for row in not_houses}
        assert sale_id not in {row["id"] for row in too_cheap}

    def test_withdrawn_and_sold_leave_the_market(self, api, verified_land, seller):
        sale_id = str(verified_land.sale.id)
        api.force_authenticate(user=seller)
        base = f"/api/v1/properties/{verified_land.id}/sale"

        assert api.post(f"{base}/withdraw/").status_code == 200
        assert sale_id not in _public_ids(api)

        api.force_authenticate(user=seller)
        assert api.post(f"{base}/relist/").status_code == 200
        assert sale_id in _public_ids(api)

        api.force_authenticate(user=seller)
        assert api.post(f"{base}/sold/").status_code == 200
        assert sale_id not in _public_ids(api)
        api.force_authenticate(user=seller)
        assert api.post(f"{base}/relist/").status_code == 409

    def test_a_revoked_verification_takes_it_down_at_once(self, api, verified_land):
        from apps.trust.models import (
            SubjectType,
            Verification,
            VerificationKind,
            VerificationStatus,
        )

        Verification.objects.filter(
            subject_type=SubjectType.PROPERTY,
            subject_id=str(verified_land.id),
            kind=VerificationKind.PROPERTY_AUTHORITY,
        ).update(status=VerificationStatus.REVOKED)

        assert str(verified_land.sale.id) not in _public_ids(api)

    def test_once_verified_only_the_presentation_can_change(self, api, verified_land, seller):
        api.force_authenticate(user=seller)
        path = f"/api/v1/properties/{verified_land.id}/sale/"

        repriced = api.patch(path, {"price_minor": 23_000_000}, format="json")
        resized = api.patch(path, {"land_size": "3"}, format="json")

        assert repriced.status_code == 200, repriced.data
        assert repriced.data["price_minor"] == 23_000_000
        assert resized.status_code == 409
        assert set(repriced.data["editable_fields"]) == {
            "price_minor",
            "price_negotiable",
            "headline",
            "description",
        }


# --- enquiries -----------------------------------------------------------------------


class TestEnquiries:
    @pytest.mark.parametrize(
        "push_enabled,email_enabled,muted_topics",
        [(True, True, []), (False, True, []), (True, False, []), (False, False, []),
         (True, True, ["enquiries"])],
    )
    def test_interest_without_a_message_delivers_only_to_seller_and_respects_preferences(
        self, api, verified_land, seller, buyer, settings, monkeypatch,
        django_capture_on_commit_callbacks, push_enabled, email_enabled, muted_topics,
    ):
        from datetime import timedelta
        from unittest.mock import Mock

        from apps.identity.models import Device, Session
        from apps.notifications.models import Notification
        from apps.notifications.services import preferences_for
        from apps.outbox.models import OutboxEvent
        from apps.outbox.tasks import dispatch_pending
        from apps.sale.models import SaleEnquiryMessage

        seller.email = "seller-interest@example.com"
        seller.is_email_verified = True
        seller.save(update_fields=["email", "is_email_verified"])
        preference = preferences_for(seller)
        preference.push_enabled = push_enabled
        preference.email_enabled = email_enabled
        preference.alerts = {topic: False for topic in muted_topics}
        preference.save()
        phone = Device.objects.create(
            user=seller, fingerprint="seller-interest-phone", platform="android",
            push_token="ExpoPushToken[seller-interest]",
        )
        Session.objects.create(user=seller, device=phone, refresh_token_hash="a" * 64,
                               expires_at=timezone.now() + timedelta(days=1))
        Device.objects.create(user=buyer, fingerprint="buyer-interest-phone", platform="android",
                              push_token="ExpoPushToken[buyer-must-not-receive]")
        settings.EXPO_PUSH_ENABLED = True
        settings.NOTIFICATION_EMAIL_BACKEND = "brevo"
        settings.BREVO_API_KEY = "test-key"
        settings.BREVO_SENDER_EMAIL = "alerts@example.com"
        settings.BREVO_SENDER_NAME = "Danpa HQ"
        post = Mock(side_effect=lambda url, **kwargs: Mock(json=lambda: (
            {"data": {"status": "ok"}} if "exp.host" in url else {"messageId": "accepted"}
        )))
        monkeypatch.setattr("apps.notifications.push.requests.post", post)

        api.force_authenticate(user=buyer)
        with django_capture_on_commit_callbacks(execute=True):
            response = api.post(
                f"/api/v1/sales/{verified_land.sale.id}/enquiries/", {}, format="json"
            )
            assert response.status_code == 201, response.data
            dispatch_pending()
        enquiry_id = response.data["id"]
        assert response.data["messages"] == []
        assert SaleEnquiryMessage.objects.count() == 0
        event = OutboxEvent.objects.get(name="sale.enquiry_received.v1")
        assert "message_id" not in event.payload
        notification = Notification.objects.get(kind="sale.enquiry_received")
        assert notification.user == seller
        assert notification.target_type == "sale_enquiry"
        assert notification.target_id == enquiry_id
        push_calls = [call for call in post.call_args_list if "exp.host" in call.args[0]]
        email_calls = [call for call in post.call_args_list if "brevo.com" in call.args[0]]
        assert len(push_calls) == int(push_enabled and not muted_topics)
        assert len(email_calls) == int(email_enabled and not muted_topics)
        if push_calls:
            payload = push_calls[0].kwargs["json"]
            assert payload["to"] == phone.push_token
            assert payload["title"] == "New interest in your property"
            assert buyer.display_name in payload["body"]
            assert payload["data"] == {"recipient_id": str(seller.id),
                                       "target_type": "sale_enquiry", "target_id": enquiry_id}
        if email_calls:
            payload = email_calls[0].kwargs["json"]
            assert payload["to"] == [{"email": seller.email}]
            assert buyer.display_name in payload["textContent"]
        api.force_authenticate(user=seller)
        listing = api.get("/api/v1/me/sale-enquiries/", {"as": "seller"})
        assert listing.data[0]["unread"] is True
        record = api.get(f"/api/v1/sale-enquiries/{enquiry_id}/")
        assert record.status_code == 200
        assert record.data["unread"] is False
        assert record.data["buyer_name"] == buyer.display_name
        assert api.get("/api/v1/me/sale-enquiries/", {"as": "seller"}).data[0]["unread"] is False
        api.force_authenticate(user=buyer)
        with django_capture_on_commit_callbacks(execute=True):
            repeated = api.post(
                f"/api/v1/sales/{verified_land.sale.id}/enquiries/", {}, format="json"
            )
            dispatch_pending()
        assert repeated.data["id"] == enquiry_id
        assert Notification.objects.filter(target_id=enquiry_id).count() == 1
        assert OutboxEvent.objects.filter(name="sale.enquiry_received.v1").count() == 1

    def test_provider_failures_do_not_lose_interest_or_in_app_notification(
        self, api, verified_land, seller, buyer, settings, monkeypatch,
        django_capture_on_commit_callbacks,
    ):
        from datetime import timedelta
        from unittest.mock import Mock

        import requests

        from apps.identity.models import Device, Session
        from apps.notifications.models import Notification
        from apps.notifications.services import preferences_for
        from apps.outbox.tasks import dispatch_pending
        from apps.sale.models import SaleEnquiryMessage

        seller.email = "seller-interest@example.com"
        seller.is_email_verified = True
        seller.save(update_fields=["email", "is_email_verified"])
        preference = preferences_for(seller)
        preference.push_enabled = preference.email_enabled = True
        preference.save()
        phone = Device.objects.create(user=seller, fingerprint="failed-interest-phone",
                                      platform="android", push_token="ExpoPushToken[failure]")
        Session.objects.create(user=seller, device=phone, refresh_token_hash="b" * 64,
                               expires_at=timezone.now() + timedelta(days=1))
        settings.EXPO_PUSH_ENABLED = True
        settings.NOTIFICATION_EMAIL_BACKEND = "brevo"
        settings.BREVO_API_KEY = "test-key"
        settings.BREVO_SENDER_EMAIL = "alerts@example.com"
        post = Mock(side_effect=requests.Timeout("provider unavailable"))
        monkeypatch.setattr("apps.notifications.push.requests.post", post)
        api.force_authenticate(user=buyer)
        with django_capture_on_commit_callbacks(execute=True):
            response = api.post(
                f"/api/v1/sales/{verified_land.sale.id}/enquiries/", {}, format="json"
            )
            assert response.status_code == 201
            dispatch_pending()
        note = Notification.objects.get(kind="sale.enquiry_received", user=seller)
        assert note.email_sent_at is None
        assert note.push_sent_at is None
        assert note.email_failed_reason
        assert post.call_count == 2
        assert SaleEnquiryMessage.objects.count() == 0
        api.force_authenticate(user=seller)
        assert api.get(f"/api/v1/sale-enquiries/{response.data['id']}/").status_code == 200

    def test_every_message_emits_an_event_and_pushes_only_to_the_other_side(
        self, verified_land, seller, buyer, monkeypatch, django_capture_on_commit_callbacks,
    ):
        from unittest.mock import Mock

        from apps.notifications.models import Notification
        from apps.outbox.models import OutboxEvent
        from apps.outbox.tasks import dispatch_pending
        from apps.sale import services

        send = Mock()
        monkeypatch.setattr("apps.notifications.push.send_message_alert", send)
        with django_capture_on_commit_callbacks(execute=True):
            enquiry = services.start_enquiry(
                sale_id=verified_land.sale.id, buyer=buyer, body="Private first message"
            )
            dispatch_pending()
        notification = Notification.objects.get(kind="sale.enquiry_received", user=seller)
        send.assert_called_once_with(notification.id, buyer.display_name)
        send.reset_mock()

        # Asking again on the advert continues the thread, but must still emit a reply.
        with django_capture_on_commit_callbacks(execute=True):
            services.start_enquiry(
                sale_id=verified_land.sale.id, buyer=buyer, body="Private follow-up"
            )
            dispatch_pending()
        notification = Notification.objects.get(kind="sale.enquiry_replied", user=seller)
        send.assert_called_once_with(notification.id, buyer.display_name)
        send.reset_mock()

        with django_capture_on_commit_callbacks(execute=True):
            services.reply(enquiry_id=enquiry.id, user=seller, body="Private answer")
            dispatch_pending()
        notification = Notification.objects.get(kind="sale.enquiry_replied", user=buyer)
        send.assert_called_once_with(notification.id, seller.display_name)
        assert OutboxEvent.objects.filter(name="sale.enquiry_replied.v1").count() == 2
        assert Notification.objects.filter(target_id=str(enquiry.id)).count() == 3
        dispatch_pending()
        send.assert_called_once()

    def test_a_buyer_asks_and_the_seller_answers(self, api, verified_land, seller, buyer):
        sale_id = verified_land.sale.id

        api.force_authenticate(user=buyer)
        asked = api.post(
            f"/api/v1/sales/{sale_id}/enquiries/",
            {"message": "Is the site plan registered with the Lands Commission?"},
            format="json",
        )
        assert asked.status_code == 201, asked.data
        enquiry_id = asked.data["id"]
        assert asked.data["role"] == "buyer"
        assert asked.data["last_message_mine"] is True

        # The seller finds it in their inbox, unread, and answers.
        api.force_authenticate(user=seller)
        inbox = api.get("/api/v1/me/sale-enquiries/", {"as": "seller"}).data
        assert [row["id"] for row in inbox] == [enquiry_id]
        assert inbox[0]["unread"] is True
        assert inbox[0]["last_message_mine"] is False
        answered = api.post(
            f"/api/v1/sale-enquiries/{enquiry_id}/messages/",
            {"message": "Yes — and you are welcome to see it at the site."},
            format="json",
        )
        assert answered.status_code == 201, answered.data
        assert answered.data["last_message_mine"] is True
        assert answered.data["last_message"] == "Yes — and you are welcome to see it at the site."

        # The buyer sees the answer, from the seller's Portfolio rather than a person.
        api.force_authenticate(user=buyer)
        thread = api.get(f"/api/v1/sale-enquiries/{enquiry_id}/").data
        assert [message["mine"] for message in thread["messages"]] == [True, False]
        assert thread["messages"][1]["author_name"] == "Esi Estates"
        assert thread["last_message_mine"] is False
        assert seller.phone not in str(thread)

        # Asking again continues the same conversation.
        again = api.post(
            f"/api/v1/sales/{sale_id}/enquiries/",
            {"message": "Could I visit on Saturday?"},
            format="json",
        )
        assert again.data["id"] == enquiry_id

    def test_one_inbox_holds_both_sides_and_says_which(self, api, verified_land, seller, buyer):
        api.force_authenticate(user=buyer)
        enquiry_id = api.post(
            f"/api/v1/sales/{verified_land.sale.id}/enquiries/",
            {"message": "Is the price negotiable?"},
            format="json",
        ).data["id"]

        api.force_authenticate(user=seller)
        selling = api.get("/api/v1/me/sale-enquiries/", {"as": "all"}).data
        api.force_authenticate(user=buyer)
        buying = api.get("/api/v1/me/sale-enquiries/", {"as": "all"}).data

        assert [(row["id"], row["role"]) for row in selling] == [(enquiry_id, "seller")]
        assert [(row["id"], row["role"]) for row in buying] == [(enquiry_id, "buyer")]

    def test_the_seller_is_notified(self, api, verified_land, seller, buyer):
        from apps.notifications.handlers import on_sale_enquiry_received
        from apps.notifications.models import Notification
        from apps.outbox.models import OutboxEvent

        api.force_authenticate(user=buyer)
        api.post(
            f"/api/v1/sales/{verified_land.sale.id}/enquiries/",
            {"message": "Still available?"},
            format="json",
        )
        event = OutboxEvent.objects.filter(name="sale.enquiry_received.v1").latest("created_at")
        on_sale_enquiry_received(event)

        assert Notification.objects.filter(user=seller, kind="sale.enquiry_received").exists()

    def test_only_its_two_sides_can_read_it(self, api, verified_land, buyer, stranger):
        api.force_authenticate(user=buyer)
        enquiry_id = api.post(
            f"/api/v1/sales/{verified_land.sale.id}/enquiries/",
            {"message": "Hello"},
            format="json",
        ).data["id"]

        api.force_authenticate(user=stranger)
        assert api.get(f"/api/v1/sale-enquiries/{enquiry_id}/").status_code == 404

    def test_nobody_enquires_about_what_is_not_for_sale(
        self, api, seller, portfolio, address, upload, buyer, verified_land
    ):
        unverified = _property(
            _create(api, seller, portfolio, address, kind="land", sale=LAND_DETAILS)
        )

        api.force_authenticate(user=buyer)
        refused = api.post(
            f"/api/v1/sales/{unverified.sale.id}/enquiries/", {"message": "Hi"}, format="json"
        )
        assert refused.status_code == 404

        # And a seller does not enquire about their own property.
        api.force_authenticate(user=seller)
        own = api.post(
            f"/api/v1/sales/{verified_land.sale.id}/enquiries/", {"message": "Hi"}, format="json"
        )
        assert own.status_code == 403
