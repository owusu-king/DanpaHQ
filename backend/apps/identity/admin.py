"""Identity admin.

The operations console. Two rules shape it:

* **Never show a full phone number or a code.** Support does not need them, and
  an admin that displays them turns every operator's screen into a leak.
* **Read-only where writing would bypass a service.** Editing a session or a
  challenge by hand would skip the audit entry that makes it accountable.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from apps.core.phone import mask

from .admin_auth import AdminEmailAuthenticationForm
from .models import (
    AgentProfile,
    AuthChallenge,
    Device,
    LandlordProfile,
    Profile,
    Session,
    TenantProfile,
    User,
    UserRole,
)

admin.site.login_form = AdminEmailAuthenticationForm
admin.site.site_header = "Ghana Rental Super Admin"
admin.site.site_title = "Ghana Rental Super Admin"
admin.site.index_title = "System configuration and unrestricted administration"


class UserRoleInline(admin.TabularInline):
    model = UserRole
    fk_name = "user"
    extra = 0
    fields = ("role", "is_primary", "granted_at", "revoked_at", "revoked_reason")
    readonly_fields = ("granted_at",)


class ProfileInline(admin.StackedInline):
    model = Profile
    extra = 0
    fields = ("bio", "address", "contact_preference", "national_id_last4")
    readonly_fields = ("national_id_last4",)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("-created_at",)
    list_display = (
        "display_name",
        "masked_phone",
        "role_list",
        "is_phone_verified",
        "is_active",
        "created_at",
    )
    list_filter = ("is_active", "is_staff", "is_phone_verified", "created_at")
    search_fields = ("phone", "email", "first_name", "last_name", "preferred_name")
    readonly_fields = ("created_at", "updated_at", "last_login", "phone_verified_at")
    inlines = [UserRoleInline, ProfileInline]

    fieldsets = (
        (None, {"fields": ("phone", "email", "password")}),
        ("Name", {"fields": ("first_name", "last_name", "preferred_name")}),
        (
            "Verification",
            {"fields": ("is_phone_verified", "phone_verified_at", "is_email_verified")},
        ),
        ("Preferences", {"fields": ("preferred_language", "data_saver")}),
        (
            "Access",
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        ("Timestamps", {"fields": ("created_at", "updated_at", "last_login", "deactivated_at")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("phone", "email", "password1", "password2")}),
    )

    @admin.display(description="Phone")
    def masked_phone(self, obj):
        return mask(obj.phone)

    @admin.display(description="Roles")
    def role_list(self, obj):
        return ", ".join(sorted(obj.roles)) or "-"


@admin.register(AuthChallenge)
class AuthChallengeAdmin(admin.ModelAdmin):
    """Read-only. Support may need to see that a code was sent and failed;
    nobody needs to see the code, and nobody may edit the record."""

    list_display = ("masked_phone", "purpose", "status", "attempts", "send_count", "created_at")
    list_filter = ("purpose", "status", "created_at")
    readonly_fields = [f.name for f in AuthChallenge._meta.fields]
    exclude = ("code_hash", "code_salt")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    @admin.display(description="Phone")
    def masked_phone(self, obj):
        return mask(obj.phone)


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ("label", "platform", "user", "first_seen_at", "last_seen_at", "blocked_at")
    list_filter = ("platform", "blocked_at")
    search_fields = ("label", "user__phone")
    readonly_fields = ("fingerprint", "first_seen_at", "last_seen_at")


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = ("user", "device", "client", "issued_at", "expires_at", "revoked_at")
    list_filter = ("client", "revoked_reason")
    readonly_fields = [f.name for f in Session._meta.fields]
    exclude = ("refresh_token_hash",)

    def has_add_permission(self, request):
        return False


@admin.register(TenantProfile)
class TenantProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "occupation", "income_band", "advance_months_affordable")
    search_fields = ("user__phone", "occupation", "employer")


@admin.register(LandlordProfile)
class LandlordProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "is_company", "company_name", "properties_declared")
    search_fields = ("user__phone", "company_name")


@admin.register(AgentProfile)
class AgentProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "agency_name", "licence_number", "years_active")
    search_fields = ("user__phone", "agency_name", "licence_number")
