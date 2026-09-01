from django.contrib import admin

from .models import StoredFile


@admin.register(StoredFile)
class StoredFileAdmin(admin.ModelAdmin):
    list_display = (
        "original_filename",
        "purpose",
        "upload_status",
        "scan_status",
        "size_bytes",
        "is_sensitive",
        "uploaded_by",
        "created_at",
    )
    list_filter = ("purpose", "upload_status", "scan_status", "is_sensitive")
    search_fields = ("original_filename", "owner_id_snapshot")
    readonly_fields = ("storage_key", "bucket", "checksum_sha256", "created_at", "updated_at")

    def has_delete_permission(self, request, obj=None):
        # Evidence files must not be deleted from the admin. The retention job
        # handles lifecycle; manual deletion bypasses the outbox event.
        if obj and obj.is_sensitive:
            return False
        return super().has_delete_permission(request, obj)
