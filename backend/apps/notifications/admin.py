from django.contrib import admin

from .models import Notification, NotificationPreference


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("kind", "user", "title", "read_at", "sms_sent_at", "created_at")
    list_filter = ("kind",)
    search_fields = ("user__phone", "title")
    raw_id_fields = ("user",)
    readonly_fields = ("dedupe_key", "sms_sent_at", "push_sent_at")


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "sms_enabled", "push_enabled", "sms_important_only")
    raw_id_fields = ("user",)
