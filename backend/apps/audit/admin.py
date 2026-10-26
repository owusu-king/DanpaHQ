from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = (
        "action",
        "aggregate_type",
        "aggregate_id",
        "actor_label",
        "actor_role",
        "created_at",
    )
    list_filter = ("action", "aggregate_type", "actor_role", "source")
    search_fields = ("aggregate_id", "actor_label", "request_id", "entry_hash")
    readonly_fields = [field.name for field in AuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
