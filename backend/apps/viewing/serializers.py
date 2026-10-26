"""Viewing over the wire.

The one rule that shapes this file: contact details appear only after a slot is
confirmed, and only to the two people involved. Everything else is ordinary.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from apps.core.money import Money

from .models import (
    CancellationReason,
    ViewingAppointment,
    ViewingFollowUp,
    ViewingRequest,
    ViewingSlot,
    ViewingStatus,
)


class ViewingSlotSerializer(serializers.ModelSerializer):
    is_past = serializers.BooleanField(read_only=True)

    class Meta:
        model = ViewingSlot
        fields = ["id", "starts_at", "duration_minutes", "note", "is_past"]
        read_only_fields = fields


class ViewingAppointmentSerializer(serializers.ModelSerializer):
    rescheduled_by = serializers.SerializerMethodField()
    cancelled_by = serializers.SerializerMethodField()
    cancellation_reason_display = serializers.CharField(
        source="get_cancellation_reason_display", read_only=True
    )

    class Meta:
        model = ViewingAppointment
        fields = [
            "id",
            "sequence",
            "scheduled_at",
            "duration_minutes",
            "note",
            "status",
            "confirmed_at",
            "rescheduled_at",
            "rescheduled_by",
            "cancelled_at",
            "cancelled_by",
            "cancellation_reason",
            "cancellation_reason_display",
            "cancellation_note",
            "cancellation_notice_minutes",
        ]
        read_only_fields = fields

    def _role(self, obj, user) -> str | None:
        if user is None:
            return None
        return "tenant" if user.id == obj.viewing.tenant_id else "host"

    def get_rescheduled_by(self, obj) -> str | None:
        return self._role(obj, obj.rescheduled_by)

    def get_cancelled_by(self, obj) -> str | None:
        return self._role(obj, obj.cancelled_by)


class ContactSerializer(serializers.Serializer):
    """The other party's details, once there is a confirmed appointment."""

    name = serializers.CharField(read_only=True)
    phone = serializers.CharField(read_only=True)
    role = serializers.CharField(read_only=True)


class ViewingRequestSerializer(serializers.ModelSerializer):
    slots = ViewingSlotSerializer(many=True, read_only=True)
    status_display = serializers.SerializerMethodField()

    listing_id = serializers.UUIDField(source="listing.id", read_only=True)
    listing_headline = serializers.CharField(source="listing.headline", read_only=True)
    locality_name = serializers.CharField(
        source="listing.unit.property.address.locality_label", read_only=True, default=None
    )
    landmark = serializers.CharField(
        source="listing.unit.property.address.landmark", read_only=True, default=None
    )
    rent_formatted = serializers.SerializerMethodField()
    # A viewing is about going to a place. A schedule of headlines is a schedule
    # nobody recognizes their own appointments in.
    photo_url = serializers.SerializerMethodField()
    property_title = serializers.CharField(
        source="listing.unit.property.title", read_only=True, default=None
    )
    unit_label = serializers.CharField(source="listing.unit.label", read_only=True, default=None)

    tenant_name = serializers.CharField(source="tenant.display_name", read_only=True)

    confirmed_starts_at = serializers.DateTimeField(
        source="confirmed_slot.starts_at", read_only=True, default=None
    )
    contact = serializers.SerializerMethodField()
    viewing_directions = serializers.SerializerMethodField()
    is_upcoming = serializers.BooleanField(read_only=True)
    check_in = serializers.SerializerMethodField()
    post_viewing = serializers.SerializerMethodField()
    appointments = ViewingAppointmentSerializer(many=True, read_only=True)
    cancellation_reason_display = serializers.CharField(
        source="get_cancellation_reason_display", read_only=True
    )
    cancelled_by = serializers.SerializerMethodField()
    attendance = serializers.SerializerMethodField()
    actions = serializers.SerializerMethodField()

    class Meta:
        model = ViewingRequest
        fields = [
            "id",
            "status",
            "status_display",
            "listing_id",
            "listing_headline",
            "locality_name",
            "landmark",
            "rent_formatted",
            "photo_url",
            "property_title",
            "unit_label",
            "tenant_name",
            "message",
            "availability_note",
            "slots",
            "confirmed_starts_at",
            "is_upcoming",
            "checked_in_at",
            "check_in_method",
            "check_in",
            "response_note",
            "cancelled_at",
            "cancelled_by",
            "cancellation_reason",
            "cancellation_reason_display",
            "cancellation_note",
            "cancellation_notice_minutes",
            "outcome_note",
            "appointments",
            "attendance",
            "actions",
            "tenant_follow_up",
            "tenant_follow_up_at",
            "post_viewing",
            "contact",
            "viewing_directions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_status_display(self, obj) -> str:
        if obj.status == ViewingStatus.CONFIRMED and self.get_check_in(obj)["state"] == "ready":
            return "Ready for check-in"
        if obj.status == ViewingStatus.CONFIRMED and self.get_check_in(obj)["state"] == "closed":
            return "Attendance needs resolution"
        return obj.get_status_display()

    def get_cancelled_by(self, obj) -> str | None:
        if obj.cancelled_by_id is None:
            return None
        return "tenant" if obj.cancelled_by_id == obj.tenant_id else "host"

    def get_rent_formatted(self, obj) -> str | None:
        listing = obj.listing
        if listing.rent_minor is None:
            return None
        return str(Money(listing.rent_minor, listing.rent_currency or "GHS"))

    def get_photo_url(self, obj) -> str | None:
        """See `participant_cover_url`: the reader is always party to this."""
        from apps.listing.serializers import participant_cover_url

        return participant_cover_url(unit=obj.listing.unit, listing=obj.listing)

    def get_contact(self, obj) -> dict | None:
        """The other side's number, released only on confirmation.

        Before that this is null for everyone. A listing that hands out a
        tenant's phone number on request is a lead-generation list, not a
        rental platform.
        """
        if obj.contact_released_at is None:
            return None

        user = getattr(self.context.get("request"), "user", None)
        if user is None or not user.is_authenticated:
            return None

        viewer_is_tenant = str(obj.tenant_id) == str(user.id)
        if viewer_is_tenant:
            host = obj.responded_by or obj.listing.created_by
            return {
                "name": host.display_name,
                "phone": host.phone,
                "role": "Landlord or agent",
            }
        if not obj.listing.unit.property.is_managed_by(user):
            return None
        return {
            "name": obj.tenant.display_name,
            "phone": obj.tenant.phone,
            "role": "Tenant",
        }

    def get_viewing_directions(self, obj) -> dict | None:
        """Release exact directions only during a valid confirmed appointment.

        Approximate locality and landmark remain available before confirmation.
        The street, house number, GhanaPost address, coordinates and the note
        for finding this particular door are possession-sensitive.
        """
        if not obj.directions_are_released:
            return None

        user = getattr(self.context.get("request"), "user", None)
        if user is None or not user.is_authenticated:
            return None

        viewer_is_tenant = str(obj.tenant_id) == str(user.id)
        viewer_is_host = obj.listing.unit.property.is_managed_by(user)
        if not viewer_is_tenant and not viewer_is_host:
            return None

        address = obj.listing.unit.property.address
        unit = obj.listing.unit
        return {
            "street": address.street,
            "house_number": address.house_number,
            "digital_address": address.digital_address,
            "latitude": str(address.latitude) if address.latitude is not None else None,
            "longitude": str(address.longitude) if address.longitude is not None else None,
            "entrance_note": unit.entrance_note,
            "wing": unit.wing,
        }

    def get_check_in(self, obj) -> dict:
        user = getattr(self.context.get("request"), "user", None)
        state = "unavailable"
        opens_at = closes_at = None
        if obj.confirmed_slot_id and obj.status in (
            ViewingStatus.CONFIRMED,
            ViewingStatus.CHECKED_IN,
        ):
            from .services import check_in_window

            opens_at, closes_at = check_in_window(obj)
            now = timezone.now()
            if obj.status == ViewingStatus.CHECKED_IN:
                state = "checked_in"
            elif now < opens_at:
                state = "upcoming"
            elif now < closes_at:
                state = "ready"
            else:
                state = "closed"
        viewer_is_tenant = bool(user and user.is_authenticated and obj.tenant_id == user.id)
        viewer_is_host = bool(
            user and user.is_authenticated and obj.listing.unit.property.is_managed_by(user)
        )
        return {
            "state": state,
            "opens_at": opens_at,
            "closes_at": closes_at,
            "checked_in_at": obj.checked_in_at,
            "can_issue": state == "ready" and viewer_is_tenant,
            "can_validate": state == "ready" and viewer_is_host,
        }

    def get_post_viewing(self, obj) -> dict:
        user = getattr(self.context.get("request"), "user", None)
        viewer_is_tenant = bool(user and user.is_authenticated and obj.tenant_id == user.id)
        return {
            "available": viewer_is_tenant
            and obj.status in (ViewingStatus.COMPLETED, ViewingStatus.HOST_NO_SHOW)
            and not obj.tenant_follow_up,
            "selected_action": obj.tenant_follow_up or None,
            "can_request_home": obj.status == ViewingStatus.COMPLETED,
        }

    def get_attendance(self, obj) -> dict:
        user = getattr(self.context.get("request"), "user", None)
        participant = bool(
            user
            and user.is_authenticated
            and (obj.tenant_id == user.id or obj.listing.unit.property.is_managed_by(user))
        )
        resolution = None
        appointment = obj.current_appointment
        if appointment is not None:
            resolution = getattr(appointment, "attendance_resolution", None)
        can_report = False
        state = "unavailable"
        if obj.status == ViewingStatus.CONFIRMED and obj.confirmed_slot_id:
            from .services import check_in_window

            _, closes_at = check_in_window(obj)
            if timezone.now() >= closes_at:
                state = "awaiting_report"
                can_report = participant
            else:
                state = "scheduled"
        elif obj.status == ViewingStatus.ATTENDANCE_PENDING:
            state = "pending"
        elif obj.status == ViewingStatus.DISPUTED:
            state = "disputed"
        elif obj.status in (ViewingStatus.TENANT_NO_SHOW, ViewingStatus.HOST_NO_SHOW):
            state = "verified"

        alleged = resolution.alleged_absent_party if resolution else None
        viewer_role = None
        if participant:
            viewer_role = "tenant" if obj.tenant_id == user.id else "host"
        return {
            "state": state,
            "reported_by": (
                "tenant"
                if resolution and resolution.reported_by_id == obj.tenant_id
                else "host"
                if resolution
                else None
            ),
            "reported_at": resolution.reported_at if resolution else None,
            "alleged_absent_party": alleged,
            "report_note": resolution.report_note if resolution else "",
            "counterparty_response": resolution.response if resolution else "",
            "responded_at": resolution.responded_at if resolution else None,
            "response_note": resolution.response_note if resolution else "",
            "dispute_status": resolution.dispute_status if resolution else "",
            "can_report": can_report,
            "can_respond": bool(
                resolution and resolution.dispute_status == "pending" and viewer_role == alleged
            ),
        }

    def get_actions(self, obj) -> dict:
        user = getattr(self.context.get("request"), "user", None)
        if user is None or not user.is_authenticated:
            return {}
        tenant = obj.tenant_id == user.id
        host = obj.listing.unit.property.is_managed_by(user)
        participant = tenant or host
        proposal = next((slot for slot in obj.slots.all() if not slot.is_past), None)
        proposed_by_tenant = bool(proposal and proposal.proposed_by_id == obj.tenant_id)
        ever_confirmed = bool(obj.appointments.all())
        return {
            "can_withdraw": tenant
            and obj.status in (ViewingStatus.REQUESTED, ViewingStatus.OFFERED)
            and not ever_confirmed,
            "can_decline": host
            and obj.status in (ViewingStatus.REQUESTED, ViewingStatus.OFFERED)
            and not ever_confirmed,
            "can_reschedule": participant and obj.status == ViewingStatus.CONFIRMED,
            "can_cancel": participant
            and (
                obj.status == ViewingStatus.CONFIRMED
                or (obj.status == ViewingStatus.OFFERED and ever_confirmed)
            ),
            "can_confirm_slot": obj.status == ViewingStatus.OFFERED
            and bool(proposal)
            and ((proposed_by_tenant and host) or (not proposed_by_tenant and tenant)),
            "can_complete": participant and obj.status == ViewingStatus.CHECKED_IN,
        }


class RequestViewingSerializer(serializers.Serializer):
    listing_id = serializers.UUIDField()
    message = serializers.CharField(max_length=600, required=False, allow_blank=True)
    availability_note = serializers.CharField(max_length=200, required=False, allow_blank=True)


class SlotInputSerializer(serializers.Serializer):
    starts_at = serializers.DateTimeField()
    duration_minutes = serializers.IntegerField(min_value=10, max_value=180, default=30)
    note = serializers.CharField(max_length=200, required=False, allow_blank=True)


class OfferSlotsSerializer(serializers.Serializer):
    slots = SlotInputSerializer(many=True)

    def validate(self, attrs):
        if "viewing_fee_minor" in self.initial_data or "viewing_fee_note" in self.initial_data:
            raise serializers.ValidationError(
                "Danpa HQ viewings are free. Viewing fees cannot be added."
            )
        return attrs


class ConfirmSlotSerializer(serializers.Serializer):
    slot_id = serializers.UUIDField()


class NoteSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


class CancelAppointmentSerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=CancellationReason.choices)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


class OutcomeSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=[ViewingStatus.COMPLETED])
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


class AttendanceReportSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


class AttendanceResponseSerializer(serializers.Serializer):
    response = serializers.ChoiceField(choices=["confirm", "dispute"])
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


class ValidateCheckInSerializer(serializers.Serializer):
    credential = serializers.CharField(max_length=160, required=False, allow_blank=True)
    code = serializers.CharField(max_length=20, required=False, allow_blank=True)

    def validate(self, attrs):
        if bool(attrs.get("credential")) == bool(attrs.get("code")):
            raise serializers.ValidationError("Scan a QR code or enter the 6-digit code.")
        return attrs


class PostViewingActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=ViewingFollowUp.choices)
    report_category = serializers.ChoiceField(
        choices=[
            "misleading_listing",
            "wrong_unit_or_property",
            "host_no_show",
            "inappropriate_conduct",
            "other",
        ],
        required=False,
        allow_blank=True,
    )
    details = serializers.CharField(max_length=3000, required=False, allow_blank=True)
