from django.contrib import admin

from .models import PassportCorrection, PassportShare


@admin.register(PassportShare)
class PassportShareAdmin(admin.ModelAdmin):
    """Read-only: a link is the tenant's consent, and only they change it."""

    list_display = ("id", "owner", "created_at", "expires_at", "revoked_at", "view_count")
    list_filter = ("revoked_at",)
    raw_id_fields = ("owner",)
    # The digest and salt never leave the database, not even to the admin.
    exclude = ("token_digest", "salt")
    readonly_fields = (
        "owner",
        "recipient_label",
        "include_identity",
        "tenancy_ids",
        "include_payments",
        "include_amounts",
        "expires_at",
        "revoked_at",
        "view_count",
        "first_viewed_at",
        "last_viewed_at",
    )

    def has_add_permission(self, request):
        return False


@admin.register(PassportCorrection)
class PassportCorrectionAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "record_type", "record_id", "created_at", "support_case_id")
    list_filter = ("record_type",)
    raw_id_fields = ("owner",)
    readonly_fields = ("owner", "record_type", "record_id", "reason", "support_case_id")

    def has_add_permission(self, request):
        return False
