from django.contrib import admin

from .models import ObligationAdjustment, PropertyExpense, RentCharge, RentPayment, RentReminder

admin.site.register(PropertyExpense)


@admin.register(RentCharge)
class RentChargeAdmin(admin.ModelAdmin):
    list_display = ("__str__", "kind", "status", "due_on", "settled_at")
    list_filter = ("kind", "status")
    raw_id_fields = ("lease",)


@admin.register(RentPayment)
class RentPaymentAdmin(admin.ModelAdmin):
    list_display = (
        "__str__",
        "method",
        "status",
        "verification_source",
        "paid_on",
        "confirmed_at",
    )
    list_filter = ("method", "status", "verification_source")
    raw_id_fields = ("lease", "charge", "recorded_by", "confirmed_by")
    # Money records. Support reads them; nobody edits them here.
    readonly_fields = ("confirmed_at", "confirmed_by", "disputed_at")


@admin.register(RentReminder)
class RentReminderAdmin(admin.ModelAdmin):
    list_display = ("lease", "due_on", "stage", "emitted_at")
    list_filter = ("stage", "due_on")
    raw_id_fields = ("lease",)
    readonly_fields = ("lease", "due_on", "stage", "emitted_at")


@admin.register(ObligationAdjustment)
class ObligationAdjustmentAdmin(admin.ModelAdmin):
    list_display = ("obligation", "kind", "amount_display", "actor", "effective_at")
    list_filter = ("kind", "effective_at")
    raw_id_fields = ("obligation", "actor")
    readonly_fields = (
        "obligation",
        "kind",
        "amount_minor",
        "amount_currency",
        "reason",
        "actor",
        "effective_at",
        "created_at",
        "updated_at",
    )

    def has_add_permission(self, request):
        return False

    @admin.display(description="Amount")
    def amount_display(self, obj):
        return obj.amount

    def has_delete_permission(self, request, obj=None):
        return False
