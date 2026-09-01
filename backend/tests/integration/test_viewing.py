"""Viewing requests, end to end.

The rules worth testing here are the ones a dispute would turn on: who could do
what, whether attendance was securely verified, when phone numbers were
exchanged, and who failed to turn up.
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict, PermissionDenied, ValidationFailed
from apps.viewing import services
from apps.viewing.models import (
    AttendanceResolutionStatus,
    CancellationReason,
    CheckInMethod,
    ViewingAppointmentStatus,
    ViewingAttendanceResolution,
    ViewingCheckInSession,
    ViewingStatus,
)

pytestmark = pytest.mark.django_db

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 60


@pytest.fixture(autouse=True)
def memory_storage(settings):
    from apps.files.storage import get_storage, reset_storage

    settings.STORAGE_BACKEND = "memory"
    settings.FILE_SCAN_MODE = "permissive"
    reset_storage()
    yield get_storage()
    reset_storage()


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(
        locality=locality,
        landmark="Near the beach",
        street="Oxford Street",
        house_number="12",
        digital_address="GA-123-4567",
        latitude="5.556020",
        longitude="-0.182740",
    )


@pytest.fixture
def live_listing(landlord, address):
    """A published listing, the way Phase 2 makes one."""
    from apps.listing.models import Listing, ListingStatus
    from apps.property.models import Building, Property, Unit

    prop = Property.objects.create(
        owner=landlord, address=address, title="Osu block", property_type="apartment"
    )
    building = Building.objects.create(property=prop, name="Annex")
    unit = Unit.objects.create(
        property=prop,
        building=building,
        label="Flat A",
        bedrooms=1,
        bathrooms=1,
        wing="East wing",
        entrance_note="Use the blue gate beside the pharmacy.",
    )
    return Listing.objects.create(
        unit=unit,
        created_by=landlord,
        status=ListingStatus.ACTIVE,
        rent_minor=150000,
        headline="Chamber and hall in Osu",
        description="Prepaid meter.",
        locality_id_cache=address.locality_id,
        bedrooms_cache=1,
    )


def _slots(count=2, base_hours=24):
    now = timezone.now()
    return [
        {"starts_at": now + timedelta(hours=base_hours + n * 24), "duration_minutes": 30}
        for n in range(count)
    ]


class TestAskingForAViewing:
    def test_a_tenant_can_ask_to_see_a_live_listing(self, user, live_listing):
        viewing = services.request_viewing(
            listing=live_listing, tenant=user, message="Is it still free?"
        )
        assert viewing.status == ViewingStatus.REQUESTED
        assert viewing.message == "Is it still free?"

    def test_asking_twice_is_refused(self, user, live_listing):
        """Two taps on a slow connection must not start two conversations."""
        services.request_viewing(listing=live_listing, tenant=user)
        with pytest.raises(Conflict):
            services.request_viewing(listing=live_listing, tenant=user)

    def test_a_withdrawn_listing_cannot_be_viewed(self, user, live_listing):
        from apps.listing.models import ListingStatus

        live_listing.status = ListingStatus.WITHDRAWN
        live_listing.save(update_fields=["status"])
        with pytest.raises(Conflict):
            services.request_viewing(listing=live_listing, tenant=user)

    def test_a_landlord_cannot_ask_to_view_their_own_listing(self, landlord, live_listing):
        with pytest.raises(ValidationFailed):
            services.request_viewing(listing=live_listing, tenant=landlord)

    def test_asking_again_is_allowed_once_the_first_is_finished(self, user, live_listing):
        first = services.request_viewing(listing=live_listing, tenant=user)
        services.withdraw(request=first, user=user, note="Found somewhere else")
        again = services.request_viewing(listing=live_listing, tenant=user)
        assert again.id != first.id

    def test_tenant_withdraws_before_confirmation_and_provider_declines_before_confirmation(
        self, user, landlord, live_listing
    ):
        withdrawn = services.request_viewing(listing=live_listing, tenant=user)
        services.withdraw(request=withdrawn, user=user, note="Plans changed")
        assert withdrawn.status == ViewingStatus.WITHDRAWN
        assert withdrawn.cancelled_at is None

        declined = services.request_viewing(listing=live_listing, tenant=user)
        services.decline(request=declined, user=landlord, note="No suitable time")
        assert declined.status == ViewingStatus.DECLINED
        assert declined.responded_by_id == landlord.id


class TestOfferingTimes:
    def test_the_host_offers_times_and_the_tenant_chooses(self, user, landlord, live_listing):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        viewing = services.offer_slots(request=viewing, user=landlord, slots=_slots(3))
        assert viewing.status == ViewingStatus.OFFERED
        assert viewing.slots.count() == 3

        chosen = viewing.slots.first()
        viewing = services.confirm_slot(request=viewing, user=user, slot_id=chosen.id)
        assert viewing.status == ViewingStatus.CONFIRMED
        assert viewing.confirmed_slot_id == chosen.id

    def test_a_stranger_cannot_offer_times(self, user, agent, live_listing):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        with pytest.raises(PermissionDenied):
            services.offer_slots(request=viewing, user=agent, slots=_slots())

    def test_a_time_in_the_past_is_refused(self, user, landlord, live_listing):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        with pytest.raises(ValidationFailed):
            services.offer_slots(
                request=viewing,
                user=landlord,
                slots=[{"starts_at": timezone.now() - timedelta(hours=1)}],
            )

    def test_re_offering_replaces_the_old_times(self, user, landlord, live_listing):
        """Otherwise the tenant picks from a list half of which is stale."""
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        services.offer_slots(request=viewing, user=landlord, slots=_slots(3))
        services.offer_slots(request=viewing, user=landlord, slots=_slots(1, base_hours=100))
        assert viewing.slots.count() == 1

    def test_the_tenant_cannot_offer_times_to_themselves(self, user, live_listing):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        with pytest.raises(PermissionDenied):
            services.offer_slots(request=viewing, user=user, slots=_slots())


class TestFreeViewing:
    def test_viewing_fees_are_not_part_of_the_service_contract(self, user, landlord, live_listing):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        viewing = services.offer_slots(request=viewing, user=landlord, slots=_slots())
        assert viewing.status == ViewingStatus.OFFERED
        assert not hasattr(viewing, "viewing_fee_minor")


class TestContactRelease:
    def test_numbers_are_not_exchanged_before_a_time_is_agreed(self, user, landlord, live_listing):
        """A listing must not be farmable for tenants' phone numbers."""
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        assert viewing.contact_released_at is None
        services.offer_slots(request=viewing, user=landlord, slots=_slots())
        viewing.refresh_from_db()
        assert viewing.contact_released_at is None
        assert not viewing.contacts_are_released

    def test_numbers_are_exchanged_on_confirmation(self, user, landlord, live_listing):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        viewing = services.offer_slots(request=viewing, user=landlord, slots=_slots())
        viewing = services.confirm_slot(
            request=viewing, user=user, slot_id=viewing.slots.first().id
        )
        assert viewing.contacts_are_released


class TestSecureCheckIn:
    def _confirmed(self, tenant, landlord, listing, *, minutes_from_now=0):
        viewing = services.request_viewing(listing=listing, tenant=tenant)
        viewing = services.offer_slots(request=viewing, user=landlord, slots=_slots())
        viewing = services.confirm_slot(
            request=viewing, user=tenant, slot_id=viewing.slots.first().id
        )
        viewing.confirmed_slot.starts_at = timezone.now() + timedelta(minutes=minutes_from_now)
        viewing.confirmed_slot.save(update_fields=["starts_at", "updated_at"])
        return viewing

    def test_credential_cannot_be_issued_before_the_window(self, user, landlord, live_listing):
        viewing = self._confirmed(user, landlord, live_listing, minutes_from_now=120)
        with pytest.raises(Conflict):
            services.issue_check_in_credential(request=viewing, user=user)

    def test_credential_cannot_be_used_before_its_allowed_window(
        self, user, landlord, live_listing
    ):
        viewing = self._confirmed(user, landlord, live_listing)
        pair = services.issue_check_in_credential(request=viewing, user=user)
        session = ViewingCheckInSession.objects.get(viewing=viewing)
        session.not_before = timezone.now() + timedelta(minutes=5)
        session.save(update_fields=["not_before", "updated_at"])

        with pytest.raises(PermissionDenied):
            services.validate_check_in(
                request=viewing, user=landlord, credential=pair["qr_payload"]
            )

    def test_qr_and_code_both_reach_the_same_checked_in_state(self, user, landlord, live_listing):
        qr_viewing = self._confirmed(user, landlord, live_listing)
        qr = services.issue_check_in_credential(request=qr_viewing, user=user)
        checked = services.validate_check_in(
            request=qr_viewing, user=landlord, credential=qr["qr_payload"]
        )
        assert checked.status == ViewingStatus.CHECKED_IN
        assert checked.check_in_method == CheckInMethod.QR
        services.record_outcome(request=checked, user=landlord, outcome=ViewingStatus.COMPLETED)

        code_viewing = self._confirmed(user, landlord, live_listing)
        fallback = services.issue_check_in_credential(request=code_viewing, user=user)
        checked = services.validate_check_in(
            request=code_viewing, user=landlord, code=fallback["code"]
        )
        assert checked.status == ViewingStatus.CHECKED_IN
        assert checked.check_in_method == CheckInMethod.CODE

    def test_incorrect_code_is_bounded_and_audited(self, user, landlord, live_listing):
        from apps.audit.models import AuditLog

        viewing = self._confirmed(user, landlord, live_listing)
        credential = services.issue_check_in_credential(request=viewing, user=user)
        wrong_code = "000000" if credential["code"] != "000000" else "111111"
        for _ in range(5):
            with pytest.raises(PermissionDenied):
                services.validate_check_in(request=viewing, user=landlord, code=wrong_code)
        with pytest.raises(PermissionDenied):
            services.validate_check_in(request=viewing, user=landlord, code=credential["code"])
        session = ViewingCheckInSession.objects.get(viewing=viewing)
        assert session.failed_code_attempts == 5
        assert (
            AuditLog.objects.filter(
                aggregate_id=str(viewing.id), metadata__action="check_in_failed"
            ).count()
            >= 5
        )

    def test_expired_and_used_credentials_are_rejected(self, user, landlord, live_listing):
        viewing = self._confirmed(user, landlord, live_listing)
        credential = services.issue_check_in_credential(request=viewing, user=user)
        session = ViewingCheckInSession.objects.get(viewing=viewing)
        session.expires_at = timezone.now() - timedelta(seconds=1)
        session.save(update_fields=["expires_at", "updated_at"])
        with pytest.raises(PermissionDenied):
            services.validate_check_in(
                request=viewing, user=landlord, credential=credential["qr_payload"]
            )

        fresh = services.issue_check_in_credential(request=viewing, user=user)
        services.validate_check_in(request=viewing, user=landlord, code=fresh["code"])
        with pytest.raises(PermissionDenied):
            services.validate_check_in(request=viewing, user=landlord, code=fresh["code"])

    def test_cancel_and_reschedule_invalidate_the_old_pair(self, user, landlord, live_listing):
        cancelled = self._confirmed(user, landlord, live_listing)
        old = services.issue_check_in_credential(request=cancelled, user=user)
        services.cancel(
            request=cancelled,
            user=user,
            reason=CancellationReason.SCHEDULE_CONFLICT,
            note="Plans changed",
        )
        session = ViewingCheckInSession.objects.get(viewing=cancelled)
        assert session.invalidated_reason == "cancelled"
        with pytest.raises(PermissionDenied):
            services.validate_check_in(
                request=cancelled, user=landlord, credential=old["qr_payload"]
            )

        rescheduled = self._confirmed(user, landlord, live_listing)
        services.issue_check_in_credential(request=rescheduled, user=user)
        services.reschedule(
            request=rescheduled,
            user=landlord,
            slots=_slots(2, base_hours=48),
        )
        session = ViewingCheckInSession.objects.get(viewing=rescheduled)
        assert session.invalidated_reason == "rescheduled"
        assert rescheduled.status == ViewingStatus.OFFERED

    def test_old_pair_is_invalid_after_reschedule_and_new_pair_works(
        self, user, landlord, live_listing
    ):
        viewing = self._confirmed(user, landlord, live_listing)
        old = services.issue_check_in_credential(request=viewing, user=user)
        services.reschedule(request=viewing, user=landlord, slots=_slots(1, base_hours=48))
        replacement = viewing.slots.first()
        viewing = services.confirm_slot(request=viewing, user=user, slot_id=replacement.id)
        viewing.confirmed_slot.starts_at = timezone.now()
        viewing.confirmed_slot.save(update_fields=["starts_at", "updated_at"])
        new = services.issue_check_in_credential(request=viewing, user=user)

        with pytest.raises(PermissionDenied):
            services.validate_check_in(request=viewing, user=landlord, credential=old["qr_payload"])
        checked = services.validate_check_in(request=viewing, user=landlord, code=new["code"])
        assert checked.status == ViewingStatus.CHECKED_IN

    def test_cross_viewing_and_unauthorized_validation_are_rejected(
        self, user, agent, landlord, live_listing
    ):
        first = self._confirmed(user, landlord, live_listing)
        second = self._confirmed(agent, landlord, live_listing)
        first_pair = services.issue_check_in_credential(request=first, user=user)
        second_pair = services.issue_check_in_credential(request=second, user=agent)
        with pytest.raises(PermissionDenied):
            services.validate_check_in(
                request=second, user=landlord, credential=first_pair["qr_payload"]
            )
        with pytest.raises(PermissionDenied):
            services.validate_check_in(
                request=first, user=agent, credential=first_pair["qr_payload"]
            )
        checked = services.validate_check_in(
            request=second, user=landlord, credential=second_pair["qr_payload"]
        )
        assert checked.status == ViewingStatus.CHECKED_IN


class TestOutcome:
    def _confirmed(self, tenant, landlord, listing):
        viewing = services.request_viewing(listing=listing, tenant=tenant)
        viewing = services.offer_slots(request=viewing, user=landlord, slots=_slots())
        return services.confirm_slot(request=viewing, user=tenant, slot_id=viewing.slots.first().id)

    def _checked_in(self, tenant, landlord, listing, *, method=CheckInMethod.CODE):
        viewing = self._confirmed(tenant, landlord, listing)
        viewing.confirmed_slot.starts_at = timezone.now()
        viewing.confirmed_slot.save(update_fields=["starts_at", "updated_at"])
        credential = services.issue_check_in_credential(request=viewing, user=tenant)
        return services.validate_check_in(
            request=viewing,
            user=landlord,
            credential=credential["qr_payload"] if method == CheckInMethod.QR else "",
            code=credential["code"] if method == CheckInMethod.CODE else "",
        )

    def test_the_host_completes_a_checked_in_viewing(self, user, landlord, live_listing):
        viewing = self._checked_in(user, landlord, live_listing)
        viewing = services.record_outcome(
            request=viewing, user=landlord, outcome=ViewingStatus.COMPLETED
        )
        assert viewing.status == ViewingStatus.COMPLETED
        assert viewing.outcome_recorded_at is not None

    def test_confirmed_cannot_be_marked_completed_without_check_in(
        self, user, landlord, live_listing
    ):
        viewing = self._confirmed(user, landlord, live_listing)
        with pytest.raises(Conflict):
            services.record_outcome(request=viewing, user=landlord, outcome=ViewingStatus.COMPLETED)

    def test_completed_viewing_can_create_a_tenancy_request_but_not_a_tenancy(
        self, user, landlord, live_listing
    ):
        from apps.occupancy.models import PropertyJoinRequest
        from apps.tenancy.models import Tenancy

        viewing = self._checked_in(user, landlord, live_listing)
        viewing = services.record_outcome(
            request=viewing, user=landlord, outcome=ViewingStatus.COMPLETED
        )
        assert not Tenancy.objects.filter(tenant=user).exists()

        result = services.record_tenant_follow_up(request=viewing, user=user, action="request_home")

        tenancy_request = PropertyJoinRequest.objects.get(id=result["tenancy_request_id"])
        assert tenancy_request.source_viewing_id == viewing.id
        assert tenancy_request.status == "pending"
        assert not Tenancy.objects.filter(tenant=user).exists()

    def test_post_viewing_save_reuses_the_shortlist(self, user, landlord, live_listing):
        from apps.listing.models import SavedListing

        viewing = self._checked_in(user, landlord, live_listing)
        viewing = services.record_outcome(
            request=viewing, user=landlord, outcome=ViewingStatus.COMPLETED
        )

        result = services.record_tenant_follow_up(request=viewing, user=user, action="save")

        assert result["saved_listing_id"]
        assert SavedListing.objects.filter(user=user, listing=live_listing).exists()

    def test_post_viewing_report_reuses_operations_reporting(self, user, landlord, live_listing):
        from apps.operations.models import ManagementReport, ReportSubject

        viewing = self._checked_in(user, landlord, live_listing)
        viewing = services.record_outcome(
            request=viewing, user=landlord, outcome=ViewingStatus.COMPLETED
        )

        result = services.record_tenant_follow_up(
            request=viewing,
            user=user,
            action="report",
            report_category="wrong_unit_or_property",
            details="The host showed a different room.",
        )

        report = ManagementReport.objects.get(id=result["report_id"])
        assert report.subject_type == ReportSubject.VIEWING
        assert report.subject_id == str(viewing.id)
        assert report.category == "wrong_unit_or_property"

    def test_no_show_cannot_be_written_as_a_direct_outcome(self, user, landlord, live_listing):
        viewing = self._confirmed(user, landlord, live_listing)
        with pytest.raises(ValidationFailed):
            services.record_outcome(request=viewing, user=user, outcome=ViewingStatus.HOST_NO_SHOW)

    def test_an_unconfirmed_viewing_has_no_outcome(self, user, landlord, live_listing):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        with pytest.raises(Conflict):
            services.record_outcome(request=viewing, user=landlord, outcome=ViewingStatus.COMPLETED)


class TestAttendanceResolution:
    def _expired(self, tenant, landlord, listing):
        viewing = services.request_viewing(listing=listing, tenant=tenant)
        services.offer_slots(request=viewing, user=landlord, slots=_slots())
        viewing = services.confirm_slot(
            request=viewing, user=tenant, slot_id=viewing.slots.first().id
        )
        viewing.confirmed_slot.starts_at = timezone.now() - timedelta(hours=2)
        viewing.confirmed_slot.save(update_fields=["starts_at", "updated_at"])
        return viewing

    def test_no_check_in_does_not_automatically_blame_either_party(
        self, user, landlord, live_listing
    ):
        viewing = self._expired(user, landlord, live_listing)
        viewing.refresh_from_db()
        assert viewing.status == ViewingStatus.CONFIRMED
        assert not ViewingAttendanceResolution.objects.exists()

    @pytest.mark.parametrize(
        ("reporter_fixture", "responder_fixture", "expected"),
        [
            ("landlord", "user", ViewingStatus.TENANT_NO_SHOW),
            ("user", "landlord", ViewingStatus.HOST_NO_SHOW),
        ],
    )
    def test_no_show_requires_a_counterparty_confirmation(
        self,
        request,
        reporter_fixture,
        responder_fixture,
        expected,
        user,
        landlord,
        live_listing,
    ):
        viewing = self._expired(user, landlord, live_listing)
        reporter = request.getfixturevalue(reporter_fixture)
        responder = request.getfixturevalue(responder_fixture)
        viewing = services.report_no_show(
            request=viewing, user=reporter, note="Nobody arrived before the window closed."
        )
        assert viewing.status == ViewingStatus.ATTENDANCE_PENDING
        resolution = ViewingAttendanceResolution.objects.get(
            appointment=viewing.current_appointment
        )
        assert resolution.dispute_status == AttendanceResolutionStatus.PENDING

        viewing = services.respond_to_attendance(
            request=viewing, user=responder, response="confirm", note="I could not attend."
        )
        assert viewing.status == expected
        resolution.refresh_from_db()
        assert resolution.dispute_status == AttendanceResolutionStatus.VERIFIED

    def test_counterparty_can_dispute_and_the_result_remains_unresolved(
        self, user, landlord, live_listing
    ):
        viewing = self._expired(user, landlord, live_listing)
        viewing = services.report_no_show(request=viewing, user=landlord, note="Tenant absent")
        viewing = services.respond_to_attendance(
            request=viewing,
            user=user,
            response="dispute",
            note="I attended but the host was not there.",
        )
        assert viewing.status == ViewingStatus.DISPUTED
        resolution = ViewingAttendanceResolution.objects.get(
            appointment=viewing.current_appointment
        )
        assert resolution.dispute_status == AttendanceResolutionStatus.DISPUTED

    def test_unauthorized_user_cannot_report_or_resolve_attendance(
        self, user, landlord, agent, live_listing
    ):
        viewing = self._expired(user, landlord, live_listing)
        with pytest.raises(PermissionDenied):
            services.report_no_show(request=viewing, user=agent)
        viewing = services.report_no_show(request=viewing, user=landlord)
        with pytest.raises(PermissionDenied):
            services.respond_to_attendance(request=viewing, user=agent, response="confirm")
        with pytest.raises(PermissionDenied):
            services.respond_to_attendance(request=viewing, user=landlord, response="confirm")


class TestCancellingAndRescheduling:
    def _confirmed(self, user, landlord, live_listing):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        services.offer_slots(request=viewing, user=landlord, slots=_slots())
        return services.confirm_slot(request=viewing, user=user, slot_id=viewing.slots.first().id)

    @pytest.mark.parametrize("actor_fixture", ["user", "landlord"])
    def test_either_side_can_cancel_and_the_record_says_who(
        self, request, actor_fixture, user, landlord, live_listing
    ):
        viewing = self._confirmed(user, landlord, live_listing)
        actor = request.getfixturevalue(actor_fixture)
        viewing = services.cancel(
            request=viewing,
            user=actor,
            reason=CancellationReason.SCHEDULE_CONFLICT,
            note="Work ran late",
        )
        assert viewing.status == ViewingStatus.CANCELLED
        assert viewing.cancelled_by_id == actor.id
        assert viewing.cancelled_at is not None
        assert viewing.cancellation_reason == CancellationReason.SCHEDULE_CONFLICT
        assert viewing.cancellation_note == "Work ran late"
        assert viewing.cancellation_notice_minutes > 0
        assert viewing.current_appointment.status == ViewingAppointmentStatus.CANCELLED

    @pytest.mark.parametrize("actor_fixture", ["user", "landlord"])
    def test_rescheduling_preserves_the_old_appointment_and_counterparty_confirms(
        self, request, actor_fixture, user, landlord, live_listing
    ):
        viewing = self._confirmed(user, landlord, live_listing)
        original = viewing.current_appointment
        actor = request.getfixturevalue(actor_fixture)
        viewing = services.reschedule(request=viewing, user=actor, slots=_slots(1, base_hours=72))
        original.refresh_from_db()
        assert original.status == ViewingAppointmentStatus.RESCHEDULED
        assert original.rescheduled_by_id == actor.id
        assert viewing.appointments.count() == 1
        with pytest.raises(Conflict):
            services.withdraw(request=viewing, user=user)
        with pytest.raises(Conflict):
            services.decline(request=viewing, user=landlord)

        counterparty = landlord if actor == user else user
        replacement = services.confirm_slot(
            request=viewing, user=counterparty, slot_id=viewing.slots.first().id
        )
        assert replacement.status == ViewingStatus.CONFIRMED
        assert replacement.appointments.count() == 2
        assert replacement.current_appointment.sequence == 2

    def test_replacement_negotiation_can_be_cancelled_but_not_withdrawn(
        self, user, landlord, live_listing
    ):
        viewing = self._confirmed(user, landlord, live_listing)
        original = viewing.current_appointment
        viewing = services.reschedule(request=viewing, user=user, slots=_slots(1, base_hours=72))
        viewing = services.cancel(
            request=viewing,
            user=landlord,
            reason=CancellationReason.PROPERTY_UNAVAILABLE,
        )
        original.refresh_from_db()
        assert viewing.status == ViewingStatus.CANCELLED
        assert original.status == ViewingAppointmentStatus.RESCHEDULED
        assert viewing.cancelled_by_id == landlord.id

    def test_a_finished_viewing_cannot_be_cancelled(self, user, landlord, live_listing):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        services.decline(request=viewing, user=landlord, note="Not available")
        with pytest.raises(Conflict):
            services.cancel(request=viewing, user=user)

    def test_a_checked_in_viewing_must_be_concluded_not_cancelled(
        self, user, landlord, live_listing
    ):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        viewing = services.offer_slots(request=viewing, user=landlord, slots=_slots())
        viewing = services.confirm_slot(
            request=viewing, user=user, slot_id=viewing.slots.first().id
        )
        viewing.confirmed_slot.starts_at = timezone.now()
        viewing.confirmed_slot.save(update_fields=["starts_at", "updated_at"])
        pair = services.issue_check_in_credential(request=viewing, user=user)
        viewing = services.validate_check_in(
            request=viewing, user=landlord, credential=pair["qr_payload"]
        )

        with pytest.raises(Conflict):
            services.cancel(request=viewing, user=user)


class TestAudit:
    def test_every_transition_leaves_an_audit_entry(self, user, landlord, live_listing):
        """Who offered what, and when, is the whole point in a dispute."""
        from apps.audit.services import verify_chain

        viewing = services.request_viewing(listing=live_listing, tenant=user)
        viewing = services.offer_slots(request=viewing, user=landlord, slots=_slots())
        viewing = services.confirm_slot(
            request=viewing, user=user, slot_id=viewing.slots.first().id
        )
        viewing.confirmed_slot.starts_at = timezone.now()
        viewing.confirmed_slot.save(update_fields=["starts_at", "updated_at"])
        credential = services.issue_check_in_credential(request=viewing, user=user)
        viewing = services.validate_check_in(
            request=viewing, user=landlord, code=credential["code"]
        )
        services.record_outcome(request=viewing, user=landlord, outcome=ViewingStatus.COMPLETED)

        from apps.audit.models import AuditLog

        entries = AuditLog.objects.filter(aggregate_type="viewing", aggregate_id=str(viewing.id))
        assert entries.count() == 6
        ok, broken = verify_chain("viewing", str(viewing.id))
        assert ok, broken

    def test_reschedule_and_attendance_resolution_keep_audit_and_event_history(
        self, user, landlord, live_listing
    ):
        from apps.audit.models import AuditLog
        from apps.audit.services import verify_chain
        from apps.outbox.models import OutboxEvent

        viewing = services.request_viewing(listing=live_listing, tenant=user)
        services.offer_slots(request=viewing, user=landlord, slots=_slots())
        viewing = services.confirm_slot(
            request=viewing, user=user, slot_id=viewing.slots.first().id
        )
        viewing = services.reschedule(request=viewing, user=user, slots=_slots(1, base_hours=72))
        viewing = services.confirm_slot(
            request=viewing, user=landlord, slot_id=viewing.slots.first().id
        )
        viewing.confirmed_slot.starts_at = timezone.now() - timedelta(hours=2)
        viewing.confirmed_slot.save(update_fields=["starts_at", "updated_at"])
        viewing = services.report_no_show(request=viewing, user=landlord)
        services.respond_to_attendance(request=viewing, user=user, response="dispute")

        actions = set(
            AuditLog.objects.filter(
                aggregate_type="viewing", aggregate_id=str(viewing.id)
            ).values_list("metadata__action", flat=True)
        )
        assert {"rescheduled", "no_show_reported", "attendance_response"} <= actions
        event_names = set(
            OutboxEvent.objects.filter(
                aggregate_type="viewing", aggregate_id=str(viewing.id)
            ).values_list("name", flat=True)
        )
        assert {
            "viewing.rescheduled.v1",
            "viewing.attendance_reported.v1",
            "viewing.attendance_responded.v1",
        } <= event_names
        ok, broken = verify_chain("viewing", str(viewing.id))
        assert ok, broken


class TestApi:
    @pytest.fixture
    def tenant_api(self, user, sms, sign_in_as):
        client = APIClient()
        sign_in_as(client, user=user, device_fingerprint="t")
        return client

    @pytest.fixture
    def host_api(self, landlord, sms, sign_in_as):
        client = APIClient()
        sign_in_as(client, user=landlord, device_fingerprint="h")
        return client

    def test_the_whole_arrangement_over_http(self, tenant_api, host_api, live_listing):
        asked = tenant_api.post(
            "/api/v1/me/viewings/",
            {
                "listing_id": str(live_listing.id),
                "message": "Is it still free?",
                "availability_note": "Weekends",
            },
            format="json",
        )
        assert asked.status_code == 201, asked.data
        viewing_id = asked.data["id"]
        assert asked.data["contact"] is None
        assert asked.data["viewing_directions"] is None

        inbox = host_api.get("/api/v1/me/viewing-requests/")
        assert [item["id"] for item in inbox.data] == [viewing_id]

        offered = host_api.post(
            f"/api/v1/viewings/{viewing_id}/offer/",
            {
                "slots": [{"starts_at": (timezone.now() + timedelta(days=1)).isoformat()}],
                "viewing_fee_minor": 5000,
                "viewing_fee_note": "Inspection fee",
            },
            format="json",
        )
        assert offered.status_code == 422, offered.data

        offered = host_api.post(
            f"/api/v1/viewings/{viewing_id}/offer/",
            {"slots": [{"starts_at": (timezone.now() + timedelta(days=1)).isoformat()}]},
            format="json",
        )
        assert offered.status_code == 200, offered.data
        assert "viewing_fee_minor" not in offered.data

        # Still no contact details: a time has been offered, not agreed.
        mine = tenant_api.get("/api/v1/me/viewings/")
        assert mine.data[0]["contact"] is None
        assert mine.data[0]["viewing_directions"] is None
        slot_id = mine.data[0]["slots"][0]["id"]

        confirmed = tenant_api.post(
            f"/api/v1/viewings/{viewing_id}/confirm/", {"slot_id": slot_id}, format="json"
        )
        assert confirmed.status_code == 200, confirmed.data
        assert confirmed.data["status"] == "confirmed"
        assert confirmed.data["contact"]["phone"]
        assert confirmed.data["contact"]["role"] == "Landlord or agent"
        assert confirmed.data["viewing_directions"] == {
            "street": "Oxford Street",
            "house_number": "12",
            "digital_address": "GA-123-4567",
            "latitude": "5.556020",
            "longitude": "-0.182740",
            "entrance_note": "Use the blue gate beside the pharmacy.",
            "building": "Annex",
            "wing": "East wing",
        }

        # And the host now sees the tenant's number, not their own.
        host_view = host_api.get(f"/api/v1/viewings/{viewing_id}/")
        assert host_view.data["contact"]["role"] == "Tenant"
        assert host_view.data["viewing_directions"]["street"] == "Oxford Street"

        viewing = services.get_request_or_404(viewing_id)
        viewing.confirmed_slot.starts_at = timezone.now()
        viewing.confirmed_slot.save(update_fields=["starts_at", "updated_at"])
        issued = tenant_api.post(
            f"/api/v1/viewings/{viewing_id}/check-in-credential/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="viewing-secret-must-not-persist",
        )
        assert issued.status_code == 200, issued.data
        assert len(issued.data["code"]) == 6
        from apps.idempotency.models import IdempotencyKey

        assert not IdempotencyKey.objects.filter(endpoint__contains="check-in-credential").exists()
        checked_in = host_api.post(
            f"/api/v1/viewings/{viewing_id}/check-in/",
            {"code": issued.data["code"]},
            format="json",
        )
        assert checked_in.status_code == 200, checked_in.data
        assert checked_in.data["status"] == "checked_in"
        completed = host_api.post(
            f"/api/v1/viewings/{viewing_id}/outcome/",
            {"outcome": "completed"},
            format="json",
        )
        assert completed.status_code == 200
        follow_up = tenant_api.post(
            f"/api/v1/viewings/{viewing_id}/post-viewing/",
            {"action": "request_home"},
            format="json",
        )
        assert follow_up.status_code == 200, follow_up.data
        assert follow_up.data["tenancy_request_id"]

    def test_check_in_endpoint_rate_limits_repeated_bad_attempts(
        self, user, landlord, host_api, live_listing
    ):
        from django.core.cache import cache

        cache.clear()
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        viewing = services.offer_slots(request=viewing, user=landlord, slots=_slots())
        viewing = services.confirm_slot(
            request=viewing, user=user, slot_id=viewing.slots.first().id
        )
        viewing.confirmed_slot.starts_at = timezone.now()
        viewing.confirmed_slot.save(update_fields=["starts_at", "updated_at"])
        services.issue_check_in_credential(request=viewing, user=user)

        responses = [
            host_api.post(
                f"/api/v1/viewings/{viewing.id}/check-in/",
                {"credential": f"rvci_wrong_{attempt}"},
                format="json",
            )
            for attempt in range(13)
        ]

        assert responses[-1].status_code == 429

    def test_an_authorized_representative_receives_confirmed_directions(
        self, tenant_api, live_listing, agent, sms, sign_in_as
    ):
        prop = live_listing.unit.property
        prop.managed_by = agent
        prop.save(update_fields=["managed_by", "updated_at"])

        asked = tenant_api.post(
            "/api/v1/me/viewings/", {"listing_id": str(live_listing.id)}, format="json"
        )
        representative = APIClient()
        sign_in_as(representative, user=agent, device_fingerprint="representative")
        inbox = representative.get("/api/v1/me/viewing-requests/")
        assert inbox.status_code == 200
        assert [row["id"] for row in inbox.data] == [asked.data["id"]]

        viewing = services.get_request_or_404(asked.data["id"])
        services.offer_slots(request=viewing, user=agent, slots=_slots())
        services.confirm_slot(
            request=viewing, user=viewing.tenant, slot_id=viewing.slots.first().id
        )

        response = representative.get(f"/api/v1/viewings/{viewing.id}/")

        assert response.status_code == 200
        assert response.data["viewing_directions"]["entrance_note"] == (
            "Use the blue gate beside the pharmacy."
        )

    def test_only_the_requesting_tenant_can_confirm_over_http(
        self, tenant_api, host_api, live_listing
    ):
        asked = tenant_api.post(
            "/api/v1/me/viewings/", {"listing_id": str(live_listing.id)}, format="json"
        )
        viewing = services.get_request_or_404(asked.data["id"])
        services.offer_slots(request=viewing, user=live_listing.created_by, slots=_slots())

        response = host_api.post(
            f"/api/v1/viewings/{viewing.id}/confirm/",
            {"slot_id": str(viewing.slots.first().id)},
            format="json",
        )

        assert response.status_code == 403
        viewing.refresh_from_db()
        assert viewing.status == ViewingStatus.OFFERED

    def test_cancelling_revokes_exact_directions(self, tenant_api, host_api, live_listing):
        asked = tenant_api.post(
            "/api/v1/me/viewings/", {"listing_id": str(live_listing.id)}, format="json"
        )
        viewing = services.get_request_or_404(asked.data["id"])
        services.offer_slots(request=viewing, user=live_listing.created_by, slots=_slots())
        services.confirm_slot(
            request=viewing, user=viewing.tenant, slot_id=viewing.slots.first().id
        )

        cancelled = tenant_api.post(
            f"/api/v1/viewings/{viewing.id}/cancel/",
            {"reason": "schedule_conflict", "note": "Plans changed"},
            format="json",
        )

        assert cancelled.status_code == 200
        assert cancelled.data["status"] == "cancelled"
        assert cancelled.data["cancelled_by"] == "tenant"
        assert cancelled.data["cancellation_reason"] == "schedule_conflict"
        assert cancelled.data["cancellation_notice_minutes"] > 0
        assert cancelled.data["viewing_directions"] is None
        assert host_api.get(f"/api/v1/viewings/{viewing.id}/").data["viewing_directions"] is None

    def test_http_withdrawal_decline_and_symmetric_reschedule_are_authoritative(
        self, tenant_api, host_api, live_listing
    ):
        asked = tenant_api.post(
            "/api/v1/me/viewings/", {"listing_id": str(live_listing.id)}, format="json"
        )
        withdrawn = tenant_api.post(
            f"/api/v1/viewings/{asked.data['id']}/withdraw/",
            {"note": "No longer interested"},
            format="json",
        )
        assert withdrawn.status_code == 200
        assert withdrawn.data["status"] == "withdrawn"

        asked = tenant_api.post(
            "/api/v1/me/viewings/", {"listing_id": str(live_listing.id)}, format="json"
        )
        viewing = services.get_request_or_404(asked.data["id"])
        services.offer_slots(request=viewing, user=live_listing.created_by, slots=_slots())
        services.confirm_slot(
            request=viewing, user=viewing.tenant, slot_id=viewing.slots.first().id
        )
        rescheduled = tenant_api.post(
            f"/api/v1/viewings/{viewing.id}/reschedule/",
            {"slots": [{"starts_at": (timezone.now() + timedelta(days=3)).isoformat()}]},
            format="json",
        )
        assert rescheduled.status_code == 200, rescheduled.data
        assert rescheduled.data["appointments"][0]["status"] == "rescheduled"
        assert rescheduled.data["appointments"][0]["rescheduled_by"] == "tenant"
        assert rescheduled.data["actions"]["can_confirm_slot"] is False
        assert rescheduled.data["actions"]["can_withdraw"] is False
        assert rescheduled.data["actions"]["can_cancel"] is True

        host_view = host_api.get(f"/api/v1/viewings/{viewing.id}/")
        assert host_view.data["actions"]["can_confirm_slot"] is True
        assert host_view.data["actions"]["can_decline"] is False
        replacement = host_view.data["slots"][0]["id"]
        confirmed = host_api.post(
            f"/api/v1/viewings/{viewing.id}/confirm/",
            {"slot_id": replacement},
            format="json",
        )
        assert confirmed.status_code == 200, confirmed.data
        assert len(confirmed.data["appointments"]) == 2

    def test_http_attendance_claim_requires_counterparty_response(
        self, user, landlord, tenant_api, host_api, live_listing, agent, sms, sign_in_as
    ):
        viewing = services.request_viewing(listing=live_listing, tenant=user)
        services.offer_slots(request=viewing, user=landlord, slots=_slots())
        viewing = services.confirm_slot(
            request=viewing, user=user, slot_id=viewing.slots.first().id
        )
        viewing.confirmed_slot.starts_at = timezone.now() - timedelta(hours=2)
        viewing.confirmed_slot.save(update_fields=["starts_at", "updated_at"])

        alleged = host_api.post(
            f"/api/v1/viewings/{viewing.id}/attendance-report/",
            {"note": "Tenant did not arrive"},
            format="json",
        )
        assert alleged.status_code == 200, alleged.data
        assert alleged.data["status"] == "attendance_pending"
        assert alleged.data["attendance"]["dispute_status"] == "pending"

        stranger = APIClient()
        sign_in_as(stranger, user=agent, device_fingerprint="attendance-stranger")
        forbidden = stranger.post(
            f"/api/v1/viewings/{viewing.id}/attendance-response/",
            {"response": "confirm"},
            format="json",
        )
        assert forbidden.status_code == 403

        tenant_view = tenant_api.get(f"/api/v1/viewings/{viewing.id}/")
        assert tenant_view.data["attendance"]["can_respond"] is True
        disputed = tenant_api.post(
            f"/api/v1/viewings/{viewing.id}/attendance-response/",
            {"response": "dispute", "note": "I was at the gate."},
            format="json",
        )
        assert disputed.status_code == 200, disputed.data
        assert disputed.data["status"] == "disputed"

        direct_blame = host_api.post(
            f"/api/v1/viewings/{viewing.id}/outcome/",
            {"outcome": "tenant_no_show"},
            format="json",
        )
        assert direct_blame.status_code == 422

    def test_exact_directions_expire_after_the_appointment(self, tenant_api, live_listing):
        asked = tenant_api.post(
            "/api/v1/me/viewings/", {"listing_id": str(live_listing.id)}, format="json"
        )
        viewing = services.get_request_or_404(asked.data["id"])
        services.offer_slots(request=viewing, user=live_listing.created_by, slots=_slots())
        services.confirm_slot(
            request=viewing, user=viewing.tenant, slot_id=viewing.slots.first().id
        )

        slot = viewing.confirmed_slot
        slot.starts_at = timezone.now() - timedelta(minutes=slot.duration_minutes + 1)
        slot.save(update_fields=["starts_at", "updated_at"])

        response = tenant_api.get(f"/api/v1/viewings/{viewing.id}/")
        assert response.status_code == 200
        assert response.data["viewing_directions"] is None

    def test_a_stranger_cannot_read_someone_elses_viewing(
        self, tenant_api, host_api, live_listing, agent, sms, sign_in_as
    ):
        asked = tenant_api.post(
            "/api/v1/me/viewings/", {"listing_id": str(live_listing.id)}, format="json"
        )
        stranger = APIClient()
        sign_in_as(stranger, user=agent, device_fingerprint="s")

        response = stranger.get(f"/api/v1/viewings/{asked.data['id']}/")
        assert response.status_code in (403, 404)

    def test_asking_requires_signing_in(self, live_listing):
        response = APIClient().post(
            "/api/v1/me/viewings/", {"listing_id": str(live_listing.id)}, format="json"
        )
        assert response.status_code in (401, 403)
