"""Rent over the wire."""

from __future__ import annotations

from rest_framework import serializers

from apps.core.money import Money

from .models import (
    ExpenseCategory,
    ObligationAdjustment,
    PaymentMethod,
    PropertyExpense,
    RentCharge,
    RentPayment,
)


def _money(minor, currency) -> str | None:
    if minor is None:
        return None
    return str(Money(minor, currency or "GHS"))


class RentChargeSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    amount_formatted = serializers.SerializerMethodField()
    outstanding_minor = serializers.IntegerField(read_only=True)
    outstanding_formatted = serializers.SerializerMethodField()
    is_overdue = serializers.BooleanField(read_only=True)
    days_overdue = serializers.IntegerField(read_only=True)
    effective_status = serializers.CharField(read_only=True)
    has_dispute = serializers.BooleanField(read_only=True)
    adjusted_minor = serializers.IntegerField(read_only=True)
    waived_minor = serializers.IntegerField(read_only=True)
    written_off_minor = serializers.IntegerField(read_only=True)
    adjustments = serializers.SerializerMethodField()

    class Meta:
        model = RentCharge
        fields = [
            "id",
            "lease",
            "kind",
            "kind_display",
            "status",
            "status_display",
            "amount_minor",
            "amount_currency",
            "amount_formatted",
            "amount_paid_minor",
            "outstanding_minor",
            "outstanding_formatted",
            "due_on",
            "period_start",
            "period_end",
            "is_overdue",
            "days_overdue",
            "effective_status",
            "has_dispute",
            "adjusted_minor",
            "waived_minor",
            "written_off_minor",
            "adjustments",
            "settled_at",
            "waived_reason",
        ]
        read_only_fields = fields

    def get_amount_formatted(self, obj) -> str | None:
        return _money(obj.amount_minor, obj.amount_currency)

    def get_outstanding_formatted(self, obj) -> str | None:
        return _money(obj.outstanding_minor, obj.amount_currency)

    def get_adjustments(self, obj) -> list[dict]:
        return ObligationAdjustmentSerializer(obj.adjustments.all(), many=True).data


class ObligationAdjustmentSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    amount_formatted = serializers.SerializerMethodField()
    actor_name = serializers.CharField(source="actor.display_name", read_only=True)

    class Meta:
        model = ObligationAdjustment
        fields = [
            "id",
            "obligation_id",
            "kind",
            "kind_display",
            "amount_minor",
            "amount_currency",
            "amount_formatted",
            "reason",
            "actor_id",
            "actor_name",
            "effective_at",
        ]
        read_only_fields = fields

    def get_amount_formatted(self, obj) -> str:
        return _money(obj.amount_minor, obj.amount_currency) or ""


class RentPaymentSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    method_display = serializers.CharField(source="get_method_display", read_only=True)
    amount_formatted = serializers.SerializerMethodField()
    recorded_by_name = serializers.CharField(source="recorded_by.display_name", read_only=True)
    recorded_by_tenant = serializers.BooleanField(read_only=True)
    is_confirmed = serializers.BooleanField(read_only=True)
    #: Whether the person reading this is the one who still has to answer.
    awaiting_you = serializers.SerializerMethodField()
    source = serializers.CharField(source="payment_source", read_only=True)
    channel = serializers.CharField(source="payment_channel", read_only=True)
    provider = serializers.CharField(source="payment_provider", read_only=True)
    evidence = serializers.CharField(source="payment_evidence", read_only=True)
    receipt_id = serializers.SerializerMethodField()
    evidence_file = serializers.SerializerMethodField()
    obligation_label = serializers.SerializerMethodField()

    class Meta:
        model = RentPayment
        fields = [
            "id",
            "lease",
            "charge",
            "status",
            "status_display",
            "verification_source",
            "source",
            "channel",
            "provider",
            "evidence",
            "lifecycle_status",
            "amount_minor",
            "amount_currency",
            "amount_formatted",
            "paid_on",
            "method",
            "method_display",
            "reference",
            "note",
            "evidence_file",
            "recorded_by",
            "recorded_by_name",
            "recorded_by_tenant",
            "confirmed_at",
            "is_confirmed",
            "disputed_at",
            "dispute_reason",
            "awaiting_you",
            "receipt_id",
            "obligation_label",
            "created_at",
        ]
        read_only_fields = fields

    def get_amount_formatted(self, obj) -> str | None:
        return _money(obj.amount_minor, obj.amount_currency)

    def get_awaiting_you(self, obj) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is None or not user.is_authenticated:
            return False
        return obj.status == "claimed" and str(obj.recorded_by_id) != str(user.id)

    def get_receipt_id(self, obj) -> str | None:
        external = getattr(obj, "external_receipt", None)
        if external is not None:
            return str(external.id)
        transaction = getattr(obj, "provider_transaction", None)
        receipt = getattr(transaction, "receipt", None) if transaction else None
        return str(receipt.id) if receipt else None

    def get_evidence_file(self, obj) -> dict | None:
        stored = obj.evidence_file
        if stored is None:
            return None
        return {
            "id": str(stored.id),
            "name": stored.original_filename,
            "content_type": stored.content_type,
        }

    def get_obligation_label(self, obj) -> str:
        if obj.charge is None:
            return "Rental payment"
        period = ""
        if obj.charge.period_start and obj.charge.period_end:
            period = f" · {obj.charge.period_start:%b %Y}"
        return f"{obj.charge.get_kind_display()}{period}"


class RecordPaymentSerializer(serializers.Serializer):
    lease_id = serializers.UUIDField()
    charge_id = serializers.UUIDField(required=False, allow_null=True)
    amount_minor = serializers.IntegerField(min_value=1)
    amount_currency = serializers.CharField(max_length=3, required=False)
    paid_on = serializers.DateField()
    method = serializers.ChoiceField(choices=PaymentMethod.choices, default=PaymentMethod.MOMO)
    reference = serializers.CharField(max_length=120, required=False, allow_blank=True)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)
    evidence_file_id = serializers.UUIDField(required=False, allow_null=True)


class PropertyExpenseSerializer(serializers.ModelSerializer):
    amount_formatted = serializers.SerializerMethodField()
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    property_title = serializers.CharField(source="property.title", read_only=True)

    class Meta:
        model = PropertyExpense
        fields = [
            "id",
            "organization_id",
            "property_id",
            "property_title",
            "amount_minor",
            "amount_currency",
            "amount_formatted",
            "category",
            "category_display",
            "incurred_on",
            "note",
            "recorded_by_id",
            "created_at",
        ]
        read_only_fields = fields

    def get_amount_formatted(self, obj) -> str:
        return _money(obj.amount_minor, obj.amount_currency) or ""


class RecordExpenseSerializer(serializers.Serializer):
    property_id = serializers.UUIDField()
    amount_minor = serializers.IntegerField(min_value=1)
    amount_currency = serializers.CharField(max_length=3, default="GHS")
    category = serializers.ChoiceField(
        choices=ExpenseCategory.choices, default=ExpenseCategory.OTHER
    )
    incurred_on = serializers.DateField()
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True)


class ObligationAdjustmentRequestSerializer(serializers.Serializer):
    amount_minor = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=300, allow_blank=False, trim_whitespace=True)
    confirmed = serializers.BooleanField()

    def validate_confirmed(self, value):
        if not value:
            raise serializers.ValidationError("Confirm the financial consequence to continue.")
        return value


class RentalHistorySerializer(serializers.Serializer):
    """The portable record. Confirmed payments only."""

    tenancies_total = serializers.IntegerField()
    tenancies_active = serializers.IntegerField()
    payments_confirmed = serializers.IntegerField()
    total_confirmed_minor = serializers.IntegerField()
    total_confirmed_formatted = serializers.SerializerMethodField()
    charges_settled_on_time = serializers.IntegerField()
    charges_settled_late = serializers.IntegerField()
    outstanding_minor = serializers.IntegerField()
    outstanding_formatted = serializers.SerializerMethodField()

    def get_total_confirmed_formatted(self, obj) -> str:
        return str(Money(obj["total_confirmed_minor"], "GHS"))

    def get_outstanding_formatted(self, obj) -> str:
        return str(Money(obj["outstanding_minor"], "GHS"))
