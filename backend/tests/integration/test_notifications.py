"""Notifications.

Two properties matter more than the message wording:

1. **The right person is told.** A landlord hears about requests for their
   place; a tenant hears about decisions on theirs. Nobody hears about someone
   else's business.
2. **A retry does not send twice.** Outbox dispatch is at-least-once, so a
   handler that already sent a text must not send another one.
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.notifications.models import Notification
from apps.notifications.services import mark_read, notify, unread_count
from apps.outbox.models import OutboxEvent, OutboxStatus
from apps.outbox.tasks import dispatch_pending

pytestmark = pytest.mark.django_db


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


@pytest.fixture
def live_listing(landlord, address):
    from apps.listing.models import Listing, ListingStatus
    from apps.property.models import Property, Unit

    prop = Property.objects.create(
        owner=landlord, address=address, title="Osu block", property_type="apartment"
    )
    unit = Unit.objects.create(property=prop, label="Flat A", bedrooms=1, bathrooms=1)
    return Listing.objects.create(
        unit=unit,
        created_by=landlord,
        status=ListingStatus.ACTIVE,
        rent_minor=150000,
        headline="Chamber and hall in Osu",
        description="Prepaid meter.",
        advance_months=12,
        locality_id_cache=address.locality_id,
        bedrooms_cache=1,
    )


def _slots(count=1):
    now = timezone.now()
    return [{"starts_at": now + timedelta(days=n + 1)} for n in range(count)]


class TestDedupe:
    def test_the_same_event_delivered_twice_notifies_once(self, user):
        """The outbox is at-least-once. Two texts at 2am is the failure this
        prevents."""
        first = notify(
            user=user,
            kind="test.thing",
            title="A thing",
            body="happened",
            dedupe_key="event-1:user-1",
        )
        second = notify(
            user=user,
            kind="test.thing",
            title="A thing",
            body="happened",
            dedupe_key="event-1:user-1",
        )
        assert first is not None
        assert second is None
        assert Notification.objects.filter(user=user).count() == 1

    def test_two_genuinely_different_events_both_notify(self, user):
        notify(user=user, kind="test.thing", title="One", body="x", dedupe_key="event-1:user-1")
        notify(user=user, kind="test.thing", title="Two", body="y", dedupe_key="event-2:user-1")
        assert Notification.objects.filter(user=user).count() == 2


class TestViewingNotifications:
    def test_the_landlord_is_told_about_a_request(self, user, landlord, live_listing):
        from apps.viewing import services as viewing_services

        viewing_services.request_viewing(listing=live_listing, tenant=user)
        dispatch_pending()

        notification = Notification.objects.filter(user=landlord).first()
        assert notification is not None
        assert notification.kind == "viewing.requested"
        assert notification.target_type == "viewing"
        # And the tenant is not told about their own action.
        assert not Notification.objects.filter(user=user, kind="viewing.requested").exists()

    def test_the_tenant_is_told_when_times_are_offered(self, user, landlord, live_listing):
        from apps.viewing import services as viewing_services

        viewing = viewing_services.request_viewing(listing=live_listing, tenant=user)
        viewing_services.offer_slots(request=viewing, user=landlord, slots=_slots())
        dispatch_pending()

        notification = Notification.objects.filter(user=user, kind="viewing.slots_offered").first()
        assert notification is not None

    def test_offered_notification_says_viewings_are_free(self, user, landlord, live_listing):
        from apps.viewing import services as viewing_services

        viewing = viewing_services.request_viewing(listing=live_listing, tenant=user)
        viewing_services.offer_slots(
            request=viewing,
            user=landlord,
            slots=_slots(),
        )
        dispatch_pending()

        notification = Notification.objects.get(user=user, kind="viewing.slots_offered")
        assert "viewings are free" in notification.body.lower()

    def test_offering_new_times_notifies_again(self, user, landlord, live_listing):
        """Repeatable events must not be deduped away - this is why handlers
        take the event and not just the payload."""
        from apps.viewing import services as viewing_services

        viewing = viewing_services.request_viewing(listing=live_listing, tenant=user)
        viewing_services.offer_slots(request=viewing, user=landlord, slots=_slots())
        dispatch_pending()
        viewing_services.offer_slots(request=viewing, user=landlord, slots=_slots(2))
        dispatch_pending()

        assert Notification.objects.filter(user=user, kind="viewing.slots_offered").count() == 2

    def test_both_sides_are_told_when_a_viewing_is_confirmed(self, user, landlord, live_listing):
        from apps.viewing import services as viewing_services

        viewing = viewing_services.request_viewing(listing=live_listing, tenant=user)
        viewing = viewing_services.offer_slots(request=viewing, user=landlord, slots=_slots())
        viewing_services.confirm_slot(request=viewing, user=user, slot_id=viewing.slots.first().id)
        dispatch_pending()

        assert Notification.objects.filter(user=user, kind="viewing.confirmed").exists()
        assert Notification.objects.filter(user=landlord, kind="viewing.confirmed").exists()


class TestApplicationNotifications:
    def test_the_landlord_is_told_and_the_fit_is_in_the_message(self, user, landlord, live_listing):
        from apps.application import services as application_services

        application_services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )
        dispatch_pending()

        notification = Notification.objects.get(user=landlord, kind="application.submitted")
        assert "6 months short" in notification.body

    def test_the_applicant_is_told_the_decision_and_the_reason(self, user, landlord, live_listing):
        from apps.application import services as application_services

        application = application_services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 12}
        )
        application_services.decide(
            application=application,
            user=landlord,
            accept=False,
            note="I need someone who can start in January.",
        )
        dispatch_pending()

        notification = Notification.objects.get(user=user, kind="application.rejected")
        assert "January" in notification.body


class TestDelivery:
    def test_an_sms_failure_never_loses_the_in_app_record(self, user, settings, monkeypatch):
        """The in-app record is the thing we can guarantee. A provider outage
        must not silently swallow the notification."""
        from apps.identity import providers

        class Exploding:
            def send(self, **_):
                raise RuntimeError("provider is down")

        monkeypatch.setattr(providers, "get_sms_provider", lambda: Exploding())

        notification = notify(
            user=user,
            kind="viewing.confirmed",
            title="Confirmed",
            body="Saturday",
            dedupe_key="e:u",
        )
        assert notification is not None
        notification.refresh_from_db()
        assert notification.sms_sent_at is None
        assert "RuntimeError" in notification.sms_failed_reason

    def test_chatter_does_not_become_a_text_when_important_only_is_set(self, user, sms):
        from apps.notifications.services import preferences_for

        preferences_for(user)  # defaults: sms on, important only
        notify(
            user=user,
            kind="viewing.requested",
            title="Someone asked",
            body="x",
            dedupe_key="e1:u",
        )
        assert len(sms.outbox) == 0

    def test_something_that_needs_you_somewhere_does_become_a_text(self, user, sms):
        notify(
            user=user,
            kind="viewing.confirmed",
            title="Viewing confirmed",
            body="Sat 10:00",
            dedupe_key="e2:u",
        )
        assert len(sms.outbox) == 1
        assert "Viewing confirmed" in sms.outbox[-1].body

    def test_turning_sms_off_is_respected(self, user, sms):
        from apps.notifications.services import preferences_for

        preference = preferences_for(user)
        preference.sms_enabled = False
        preference.save(update_fields=["sms_enabled"])

        notify(
            user=user,
            kind="viewing.confirmed",
            title="Viewing confirmed",
            body="x",
            dedupe_key="e3:u",
        )
        assert len(sms.outbox) == 0


class TestReading:
    def test_unread_count_and_marking_read(self, user):
        for index in range(3):
            notify(
                user=user,
                kind="test.thing",
                title=f"Thing {index}",
                body="x",
                dedupe_key=f"e{index}:u",
            )
        assert unread_count(user=user) == 3

        marked = mark_read(user=user)
        assert marked == 3
        assert unread_count(user=user) == 0

    def test_marking_read_is_scoped_to_the_person(self, user, landlord):
        notify(user=user, kind="t", title="Theirs", body="x", dedupe_key="a:1")
        notify(user=landlord, kind="t", title="Mine", body="x", dedupe_key="a:2")

        mark_read(user=user)
        assert unread_count(user=landlord) == 1


class TestApi:
    @pytest.fixture
    def api(self, user, sms, sign_in_as):
        from rest_framework.test import APIClient

        client = APIClient()
        sign_in_as(client, user=user, device_fingerprint="t")
        return client

    def test_listing_and_marking_read_over_http(self, api, user):
        notify(user=user, kind="t", title="A thing", body="x", dedupe_key="api:1")

        listed = api.get("/api/v1/me/notifications/")
        assert listed.status_code == 200
        assert listed.data["unread_count"] == 1
        assert listed.data["results"][0]["title"] == "A thing"

        read = api.post("/api/v1/me/notifications/read/", {}, format="json")
        assert read.data["unread_count"] == 0

    def test_preferences_can_be_changed(self, api):
        response = api.patch(
            "/api/v1/me/notification-preferences/", {"sms_enabled": False}, format="json"
        )
        assert response.status_code == 200
        assert response.data["sms_enabled"] is False

    def test_notifications_require_signing_in(self):
        from rest_framework.test import APIClient

        response = APIClient().get("/api/v1/me/notifications/")
        assert response.status_code in (401, 403)


class TestOutboxStillWorks:
    def test_a_dispatched_event_is_marked_published(self, user, landlord, live_listing):
        from apps.viewing import services as viewing_services

        viewing_services.request_viewing(listing=live_listing, tenant=user)
        dispatch_pending()

        event = OutboxEvent.objects.get(name="viewing.requested.v1")
        assert event.status == OutboxStatus.PUBLISHED
