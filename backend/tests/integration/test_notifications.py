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

    def test_a_muted_alert_stays_in_the_app(self, user, sms):
        from apps.notifications.models import Notification
        from apps.notifications.services import preferences_for

        preference = preferences_for(user)
        preference.alerts = {"viewings": False}
        preference.save(update_fields=["alerts"])

        notify(
            user=user,
            kind="viewing.confirmed",
            title="Viewing confirmed",
            body="x",
            dedupe_key="m1:u",
        )
        assert len(sms.outbox) == 0
        # Updates keeps the record: the choice is about interruptions.
        assert Notification.objects.filter(user=user, kind="viewing.confirmed").exists()

        # Other topics are untouched.
        notify(user=user, kind="rent.payment_overdue", title="Overdue", body="x", dedupe_key="m2:u")
        assert len(sms.outbox) == 1

    def test_texts_go_to_the_chosen_number(self, user, sms):
        from apps.notifications.services import preferences_for

        preference = preferences_for(user)
        preference.sms_number = "+233201112233"
        preference.save(update_fields=["sms_number"])

        notify(
            user=user,
            kind="viewing.confirmed",
            title="Viewing confirmed",
            body="x",
            dedupe_key="n1:u",
        )
        assert sms.outbox[-1].to == "+233201112233"

    def test_every_notification_kind_belongs_to_a_topic(self):
        """A kind with no topic could never be muted; name them all."""
        import re
        from pathlib import Path

        from apps.notifications.services import topic_for

        root = Path(__file__).resolve().parents[2] / "apps"
        sources = [root / "notifications" / "handlers.py", root / "lease" / "tasks.py"]
        kinds = set()
        for source in sources:
            kinds |= set(re.findall(r'kind="([a-z_]+\.[a-z_]+)"', source.read_text()))
        kinds |= {"rent.payment_due_soon", "rent.payment_due_now", "rent.payment_overdue"}
        assert kinds, "no kinds found"
        assert {kind: topic_for(kind) for kind in kinds if topic_for(kind) is None} == {}
        assert topic_for("lease.expiring") == "lease_expiry"
        assert topic_for("lease.offered") == "leases"


class TestLeaseExpiry:
    def test_both_parties_hear_once_at_each_checkpoint(self, user, landlord, live_listing, sms):
        from datetime import timedelta

        from django.utils import timezone

        from apps.lease.models import Lease
        from apps.lease.tasks import emit_expiry_alerts
        from apps.notifications.models import Notification

        lease = Lease(
            tenant=user, landlord=landlord, ends_on=timezone.localdate() + timedelta(days=30)
        )
        lease.status = "active"
        lease.unit = live_listing.unit
        lease.rent_minor = 100000
        lease.starts_on = timezone.localdate() - timedelta(days=335)
        lease.save()

        assert emit_expiry_alerts()["sent"] == 2
        assert emit_expiry_alerts()["sent"] == 0
        rows = Notification.objects.filter(kind="lease.expiring", target_id=str(lease.id))
        assert {row.user_id for row in rows} == {user.id, landlord.id}
        assert all(row.title == "A lease ends in 30 days" for row in rows)


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


def _note(user, kind, key, title="x"):
    return notify(user=user, kind=kind, title=title, body="x", dedupe_key=key)


class TestRetention:
    """Read alerts disappear; every activity remains in the user history."""

    def test_a_reminder_is_deleted_once_read(self, user):
        reminder = _note(user, "rent.payment_due_now", "r:1")
        activity = _note(user, "application.accepted", "a:1")

        mark_read(user=user)

        assert not Notification.objects.filter(id=reminder.id).exists()
        assert Notification.objects.filter(id=activity.id).exists()

    def test_an_unread_reminder_stays(self, user):
        reminder = _note(user, "lease.expiring", "r:2")
        activity = _note(user, "application.accepted", "a:2")

        mark_read(user=user, notification_ids=[activity.id])

        assert Notification.objects.filter(id=reminder.id, read_at__isnull=True).exists()

    def test_all_read_activities_are_kept(self, user):
        for index in range(14):
            _note(user, "viewing.confirmed", f"v:{index}", title=f"Confirmed {index}")
        mark_read(user=user)

        kept = Notification.objects.filter(user=user).order_by("created_at")
        expected = [f"Confirmed {index}" for index in range(14)]
        assert list(kept.values_list("title", flat=True)) == expected

    def test_unread_activity_is_never_pruned(self, user):
        for index in range(14):
            _note(user, "viewing.confirmed", f"u:{index}")

        assert Notification.objects.filter(user=user).count() == 14

    def test_a_deleted_reminder_is_not_sent_again(self, user):
        key = "lease.expiring:L:30:U"
        _note(user, "lease.expiring", key)
        mark_read(user=user)
        assert not Notification.objects.filter(user=user).exists()

        assert _note(user, "lease.expiring", key) is None
        assert not Notification.objects.filter(user=user).exists()

    def test_retention_is_per_person(self, user, landlord):
        for index in range(12):
            _note(landlord, "viewing.requested", f"l:{index}")
        _note(user, "viewing.confirmed", "m:1")
        mark_read(user=landlord)
        mark_read(user=user)

        assert Notification.objects.filter(user=landlord).count() == 12
        assert Notification.objects.filter(user=user).count() == 1

    def test_each_record_says_what_kind_it_is(self, user):
        from apps.notifications.serializers import NotificationSerializer

        reminder = _note(user, "viewing.approaching", "s:1")
        activity = _note(user, "lease.offered", "s:2")
        assert NotificationSerializer(reminder).data["record"] == "informational"
        assert NotificationSerializer(activity).data["record"] == "activity"


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

    def test_full_history_pages_without_crossing_accounts(self, api, user, landlord):
        # Same kind and target must remain distinct historical events.
        notes = [
            Notification(
                user=user,
                kind="viewing.confirmed",
                title=f"Event {i}",
                body="History",
                target_type="viewing",
                target_id="same",
                dedupe_key=f"history:{i}",
            )
            for i in range(115)
        ]
        Notification.objects.bulk_create(notes)
        _note(landlord, "viewing.confirmed", "private-other")
        mark_read(user=user)
        first = api.get("/api/v1/me/notifications/")
        assert len(first.data["results"]) == 100
        second = api.get("/api/v1/me/notifications/", {"cursor": first.data["next_cursor"]})
        assert len(second.data["results"]) == 15
        assert second.data["next_cursor"] is None
        ids = [row["id"] for row in first.data["results"] + second.data["results"]]
        assert len(set(ids)) == 115
        assert set(ids) == {str(note.id) for note in notes}

    def test_dismissing_alert_keeps_activity_and_other_users_alerts(self, api, user, landlord):
        alert = _note(user, "lease.expiring", "dismiss-me")
        event = _note(user, "lease.offered", "keep-event")
        other = _note(landlord, "lease.expiring", "keep-private")
        response = api.post(
            "/api/v1/me/notifications/read/",
            {"ids": [str(alert.id), str(other.id)]},
            format="json",
        )
        assert response.status_code == 200
        assert not Notification.objects.filter(id=alert.id).exists()
        assert Notification.objects.filter(id=event.id).exists()
        assert Notification.objects.filter(id=other.id, read_at__isnull=True).exists()

    def test_preferences_can_be_changed(self, api):
        response = api.patch(
            "/api/v1/me/notification-preferences/", {"sms_enabled": False}, format="json"
        )
        assert response.status_code == 200
        assert response.data["sms_enabled"] is False

    def test_numbers_and_alerts_are_read_back_complete(self, api):
        response = api.patch(
            "/api/v1/me/notification-preferences/",
            {"sms_number": "024 111 2233", "whatsapp_enabled": True, "alerts": {"payments": False}},
            format="json",
        )
        assert response.status_code == 200, response.data
        assert response.data["sms_number"] == "+233241112233"
        assert response.data["whatsapp_enabled"] is True
        assert response.data["alerts"]["payments"] is False
        assert response.data["alerts"]["lease_expiry"] is True
        assert [topic["key"] for topic in response.data["alert_topics"]][:2] == [
            "payments",
            "lease_expiry",
        ]
        assert response.data["whatsapp_available"] is False

    def test_a_bad_number_or_alert_is_refused(self, api):
        bad_number = api.patch(
            "/api/v1/me/notification-preferences/", {"sms_number": "12"}, format="json"
        )
        assert bad_number.status_code == 422
        bad_alert = api.patch(
            "/api/v1/me/notification-preferences/", {"alerts": {"weather": False}}, format="json"
        )
        assert bad_alert.status_code == 422

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


class TestStaleNotificationsAgeOut:
    """Unread for weeks, a notification is history (owner, 2026-10-05).

    A tenant's badge read 72: prompts about agreements and viewings dealt with
    long ago. Reading the list ages them out; the daily sweep does it for all.
    """

    @pytest.fixture
    def api(self):
        from rest_framework.test import APIClient

        return APIClient()

    def _make(self, user, *, days_old, kind="lease.offered", key="k"):
        note = notify(user=user, kind=kind, title="T", body="B", dedupe_key=f"{key}:{user.id}")
        Notification.objects.filter(id=note.id).update(
            created_at=timezone.now() - timedelta(days=days_old)
        )
        return note

    def test_reading_the_list_ages_out_only_the_old(self, api, sign_in_as, user):
        old = self._make(user, days_old=20, key="old")
        fresh = self._make(user, days_old=2, key="fresh")
        sign_in_as(api, user=user)

        response = api.get("/api/v1/me/notifications/")

        assert response.status_code == 200
        assert response.data["unread_count"] == 1
        unread = {row["id"] for row in response.data["results"] if not row["is_read"]}
        assert unread == {str(fresh.id)}
        assert str(old.id) not in unread

    def test_an_old_alert_waits_for_explicit_acknowledgement(self, user):
        from apps.notifications.services import age_out

        reminder = self._make(user, days_old=30, kind="rent.payment_overdue", key="due")

        assert age_out(user=user) == 0
        assert Notification.objects.filter(id=reminder.id, read_at__isnull=True).exists()
        mark_read(user=user, notification_ids=[reminder.id])
        assert not Notification.objects.filter(id=reminder.id).exists()

    def test_the_daily_sweep_covers_everyone(self, user, registered):
        from apps.notifications.tasks import age_out_stale

        other = registered("0209333444")
        self._make(user, days_old=15, key="a")
        self._make(other, days_old=40, key="b")
        self._make(other, days_old=1, key="c")

        assert age_out_stale() == {"aged_out": 2}
        assert Notification.objects.filter(read_at__isnull=True).count() == 1
