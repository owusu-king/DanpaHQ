from django.contrib import admin

from .models import Amenity, Property, Unit, UnitAmenity


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ("__str__", "owner", "property_type", "compound_type", "created_at")
    list_filter = ("property_type", "compound_type", "water_source", "power_meter_type")
    search_fields = ("title", "address__street", "owner__phone")
    raw_id_fields = ("owner", "managed_by", "address")


@admin.register(Unit)
class UnitAdmin(admin.ModelAdmin):
    list_display = ("__str__", "space_type", "bedrooms", "bathrooms", "is_active")
    list_filter = ("space_type", "is_active", "is_furnished")
    raw_id_fields = ("property",)


@admin.register(Amenity)
class AmenityAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "is_active")
    list_filter = ("category", "is_active")
    search_fields = ("name",)


@admin.register(UnitAmenity)
class UnitAmenityAdmin(admin.ModelAdmin):
    list_display = ("unit", "amenity", "confirmed_at", "removed_at")
    raw_id_fields = ("unit", "amenity")
