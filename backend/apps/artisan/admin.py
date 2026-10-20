from django.contrib import admin

from .models import ArtisanCertificate, ArtisanPortfolioPhoto, ArtisanProfile


class ArtisanPortfolioPhotoInline(admin.TabularInline):
    model = ArtisanPortfolioPhoto
    extra = 0
    raw_id_fields = ("file",)


class ArtisanCertificateInline(admin.TabularInline):
    model = ArtisanCertificate
    extra = 0
    raw_id_fields = ("file",)
    readonly_fields = ("verified_at", "verified_by_management_id")


@admin.register(ArtisanProfile)
class ArtisanProfileAdmin(admin.ModelAdmin):
    list_display = ("__str__", "suspended_at", "created_at")
    raw_id_fields = ("user",)
    filter_horizontal = ("districts",)
    # Applications are decided in the verification queue and suspension is a
    # Management action with a reason the artisan reads; neither is set here.
    readonly_fields = ("suspended_at", "suspended_reason", "suspended_by_management_id")
    inlines = [ArtisanPortfolioPhotoInline, ArtisanCertificateInline]
