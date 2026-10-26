from django.contrib import admin

from .models import (
    ViewingAppointment,
    ViewingAttendanceResolution,
    ViewingCheckInSession,
    ViewingRequest,
    ViewingSlot,
)


class ViewingSlotInline(admin.TabularInline):
    model = ViewingSlot
    extra = 0
    raw_id_fields = ("proposed_by",)


@admin.register(ViewingRequest)
class ViewingRequestAdmin(admin.ModelAdmin):
    list_display = ("__str__", "status", "tenant", "confirmed_at", "created_at")
    list_filter = ("status",)
    search_fields = ("tenant__phone", "listing__headline")
    raw_id_fields = (
        "listing",
        "tenant",
        "responded_by",
        "confirmed_slot",
        "current_appointment",
        "cancelled_by",
        "checked_in_by",
    )
    inlines = [ViewingSlotInline]
    # Support reads these during a dispute; they should not be editing them.
    readonly_fields = (
        "contact_released_at",
        "confirmed_at",
        "cancelled_at",
        "checked_in_at",
        "outcome_recorded_at",
    )


@admin.register(ViewingAppointment)
class ViewingAppointmentAdmin(admin.ModelAdmin):
    list_display = ("viewing", "sequence", "scheduled_at", "status")
    list_filter = ("status",)
    raw_id_fields = ("viewing", "confirmed_by", "rescheduled_by", "cancelled_by")
    readonly_fields = ("confirmed_at", "rescheduled_at", "cancelled_at")


@admin.register(ViewingAttendanceResolution)
class ViewingAttendanceResolutionAdmin(admin.ModelAdmin):
    list_display = ("appointment", "alleged_absent_party", "dispute_status", "reported_at")
    list_filter = ("dispute_status", "alleged_absent_party")
    raw_id_fields = ("appointment", "reported_by", "responded_by")
    readonly_fields = ("reported_at", "responded_at")


@admin.register(ViewingCheckInSession)
class ViewingCheckInSessionAdmin(admin.ModelAdmin):
    list_display = ("viewing", "expires_at", "used_at", "invalidated_at")
    raw_id_fields = ("viewing", "used_by")
    readonly_fields = (
        "qr_token_hash",
        "code_hash",
        "failed_code_attempts",
        "last_failed_at",
        "used_at",
        "invalidated_at",
    )
