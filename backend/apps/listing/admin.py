from django.contrib import admin

from .models import Listing, ListingMedia, SavedListing


@admin.register(Listing)
class ListingAdmin(admin.ModelAdmin):
    list_display = ("headline", "status", "created_by", "advance_months", "created_at")
    list_filter = ("status", "rent_period")
    search_fields = ("headline", "created_by__phone")
    raw_id_fields = ("unit", "created_by", "reviewed_by")


@admin.register(ListingMedia)
class ListingMediaAdmin(admin.ModelAdmin):
    list_display = ("listing", "is_cover", "sort_order", "caption")
    list_filter = ("is_cover",)
    raw_id_fields = ("listing", "file")


@admin.register(SavedListing)
class SavedListingAdmin(admin.ModelAdmin):
    list_display = ("user", "listing", "created_at")
    raw_id_fields = ("user", "listing")
