from django.contrib import admin

from .models import MaintenanceEvent, MaintenanceRequest


class MaintenanceEventInline(admin.TabularInline):
    model = MaintenanceEvent
    extra = 0
    can_delete = False
    readonly_fields = ("kind", "actor", "from_status", "to_status", "note", "created_at")


@admin.register(MaintenanceRequest)
class MaintenanceRequestAdmin(admin.ModelAdmin):
    list_display = ("__str__", "category", "status", "status_changed_at", "reopen_count")
    list_filter = ("status", "category")
    raw_id_fields = ("tenancy", "tenant", "property", "unit", "bed", "photo", "video")
    # The history is the record. Support reads it; status moves go through the API.
    readonly_fields = (
        "status",
        "status_changed_at",
        "started_at",
        "fixed_reported_at",
        "completed_at",
        "reopened_at",
        "reopen_count",
    )
    inlines = [MaintenanceEventInline]
