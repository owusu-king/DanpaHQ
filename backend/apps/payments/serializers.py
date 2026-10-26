from __future__ import annotations

from rest_framework import serializers

from apps.core.money import Money

from .models import (
    DigitalPaymentMethod,
    PaymentIntent,
    PayoutMethod,
    PayoutProfile,
    PayoutProvisioningOperation,
    PayoutProvisioningStatus,
    Receipt,
)


class CreatePaymentIntentSerializer(serializers.Serializer):
    obligation_id = serializers.UUIDField()
    payment_method = serializers.ChoiceField(choices=DigitalPaymentMethod.choices)
    #: How much of the obligation to pay, in the currency subunit. Omitted means
    #: the whole outstanding balance, which is what every current client sends.
    #: Whatever arrives is a request: the server bounds it against the locked
    #: balance and never treats it as the price.
    amount_minor = serializers.IntegerField(required=False, allow_null=True, min_value=1)


class PaymentIntentSerializer(serializers.ModelSerializer):
    amount_formatted = serializers.SerializerMethodField()
    obligation_kind = serializers.CharField(source="obligation.kind", read_only=True)
    property_title = serializers.CharField(source="lease.unit.property.title", read_only=True)
    unit_label = serializers.CharField(source="lease.unit.label", read_only=True)
    receipt_id = serializers.SerializerMethodField()

    class Meta:
        model = PaymentIntent
        fields = [
            "id",
            "lease_id",
            "obligation_id",
            "obligation_kind",
            "property_title",
            "unit_label",
            "amount_minor",
            "amount_currency",
            "amount_formatted",
            "status",
            "payment_method",
            "provider",
            "client_reference",
            "provider_reference",
            "expires_at",
            "failure_code",
            "failure_message",
            "next_action",
            "receipt_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_amount_formatted(self, obj) -> str:
        return str(Money(obj.amount_minor, obj.amount_currency))

    def get_receipt_id(self, obj) -> str | None:
        transaction = obj.transactions.filter(status="succeeded").first()
        receipt = getattr(transaction, "receipt", None) if transaction else None
        return str(receipt.id) if receipt else None


class ReceiptSerializer(serializers.ModelSerializer):
    amount_formatted = serializers.SerializerMethodField()
    payment_method = serializers.SerializerMethodField()
    provider = serializers.SerializerMethodField()
    provider_transaction_id = serializers.SerializerMethodField()
    source = serializers.SerializerMethodField()
    evidence = serializers.SerializerMethodField()
    snapshot = serializers.SerializerMethodField()
    final_document_available = serializers.SerializerMethodField()

    class Meta:
        model = Receipt
        fields = [
            "id",
            "receipt_number",
            "issued_at",
            "amount_formatted",
            "payment_method",
            "provider",
            "provider_transaction_id",
            "source",
            "evidence",
            "snapshot",
            "final_document_available",
            "breakdown",
        ]
        read_only_fields = fields

    def get_amount_formatted(self, obj) -> str:
        payment = obj.transaction if obj.transaction_id else obj.rent_record
        return str(Money(payment.amount_minor, payment.amount_currency))

    def get_payment_method(self, obj) -> str:
        return (
            obj.transaction.payment_method
            if obj.transaction_id
            else obj.rent_record.payment_channel
        )

    def get_provider(self, obj) -> str:
        return obj.transaction.provider if obj.transaction_id else "NONE"

    def get_provider_transaction_id(self, obj) -> str:
        return obj.transaction.provider_transaction_id if obj.transaction_id else ""

    def get_source(self, obj) -> str:
        return obj.breakdown.get("payment", {}).get("source", "")

    def get_evidence(self, obj) -> str:
        return obj.breakdown.get("evidence", {}).get("status", "")

    def get_final_document_available(self, obj) -> bool:
        return bool(obj.final_pdf)

    def get_snapshot(self, obj) -> dict | None:
        if obj.breakdown.get("schema_version") != "danpahq.payment_receipt.v1":
            return None
        return obj.breakdown


class ProvisionPayoutDestinationSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=PayoutMethod.choices)
    bank_code = serializers.CharField(max_length=32, trim_whitespace=True)
    account_number = serializers.CharField(
        max_length=32,
        trim_whitespace=True,
        write_only=True,
    )


class PayoutInstitutionQuerySerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=PayoutMethod.choices)


class ResolvePayoutAccountSerializer(ProvisionPayoutDestinationSerializer):
    pass


class PayoutProfileSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = PayoutProfile
        fields = [
            "id",
            "method",
            "provider",
            "masked_account",
            "account_name",
            "institution",
            "status",
            "status_display",
            "is_active",
            "verified_at",
            "updated_at",
        ]
        read_only_fields = fields


class PayoutProvisioningOperationSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    checking = serializers.SerializerMethodField()

    class Meta:
        model = PayoutProvisioningOperation
        fields = [
            "id",
            "provider",
            "method",
            "status",
            "status_display",
            "checking",
            "failure_code",
            "failure_message",
            "check_count",
            "last_checked_at",
            "completed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_checking(self, obj) -> bool:
        return obj.status in (
            PayoutProvisioningStatus.PENDING,
            PayoutProvisioningStatus.NEEDS_RECONCILIATION,
        )
