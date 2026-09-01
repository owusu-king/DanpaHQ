from django.contrib import admin

from .models import (
    LedgerEntry,
    PaymentIntent,
    PaymentTransaction,
    PayoutProfile,
    PayoutProvisioningOperation,
    ProviderWebhook,
    Receipt,
    Settlement,
)


@admin.register(PaymentIntent)
class PaymentIntentAdmin(admin.ModelAdmin):
    list_display = ("client_reference", "provider", "status", "amount_minor", "created_at")
    list_filter = ("provider", "status", "payment_method")
    raw_id_fields = ("tenant", "lease", "obligation")
    readonly_fields = ("client_reference", "provider_reference", "amount_minor", "amount_currency")


for model in (
    PaymentTransaction,
    LedgerEntry,
    ProviderWebhook,
    Receipt,
    Settlement,
    PayoutProfile,
    PayoutProvisioningOperation,
):
    admin.site.register(model)
