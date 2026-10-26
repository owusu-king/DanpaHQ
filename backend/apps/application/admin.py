from django.contrib import admin

from .models import RentalApplication


@admin.register(RentalApplication)
class RentalApplicationAdmin(admin.ModelAdmin):
    list_display = ("__str__", "status", "advance_months_offered", "decided_at", "created_at")
    list_filter = ("status",)
    search_fields = ("tenant__phone", "listing__headline", "guarantor_name")
    raw_id_fields = ("listing", "tenant", "decided_by")
    readonly_fields = ("decided_at", "withdrawn_at")
