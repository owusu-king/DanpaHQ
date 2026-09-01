from rest_framework import serializers

from apps.payments.models import ReconciliationStatus

from .models import CaseStatus, Priority, ReportSubject, SupportCategory


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(max_length=128, trim_whitespace=False)
    new_password = serializers.CharField(min_length=10, max_length=128, trim_whitespace=False)


class DecisionSerializer(serializers.Serializer):
    approved = serializers.BooleanField()
    note = serializers.CharField(required=False, allow_blank=True, max_length=600)
    internal_note = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    validity_days = serializers.IntegerField(required=False, allow_null=True, min_value=1)

    def validate(self, attrs):
        if not attrs.get("approved") and not attrs.get("note", "").strip():
            raise serializers.ValidationError({"note": "Record why this was rejected."})
        return attrs


class ModerationSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["approve", "reject", "suspend", "flag"])
    note = serializers.CharField(required=False, allow_blank=True, max_length=600)

    def validate(self, attrs):
        if attrs["action"] != "approve" and not attrs.get("note", "").strip():
            raise serializers.ValidationError({"note": "Record a reason for this action."})
        return attrs


class UserStatusSerializer(serializers.Serializer):
    active = serializers.BooleanField()
    reason = serializers.CharField(required=False, allow_blank=True, max_length=300)

    def validate(self, attrs):
        if not attrs["active"] and not attrs.get("reason", "").strip():
            raise serializers.ValidationError({"reason": "Record why this account is deactivated."})
        return attrs


class DeviceRestoreSerializer(serializers.Serializer):
    """Lifting a block is a security decision, so it is never unexplained."""

    reason = serializers.CharField(max_length=300)

    def validate_reason(self, value):
        if not value.strip():
            raise serializers.ValidationError("Record why this device is being restored.")
        return value


class CaseUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=CaseStatus.choices)
    resolution_note = serializers.CharField(required=False, allow_blank=True, max_length=1000)


class ReportCreateSerializer(serializers.Serializer):
    subject_type = serializers.ChoiceField(choices=ReportSubject.choices)
    subject_id = serializers.CharField(max_length=64)
    category = serializers.CharField(max_length=40)
    summary = serializers.CharField(max_length=180)
    details = serializers.CharField(required=False, allow_blank=True, max_length=3000)
    priority = serializers.ChoiceField(choices=Priority.choices, default=Priority.NORMAL)
    reported_by_id = serializers.UUIDField(required=False, allow_null=True)


class SupportCreateSerializer(serializers.Serializer):
    user_id = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.ChoiceField(choices=SupportCategory.choices)
    summary = serializers.CharField(max_length=180)
    details = serializers.CharField(required=False, allow_blank=True, max_length=3000)
    priority = serializers.ChoiceField(choices=Priority.choices, default=Priority.NORMAL)
    related_application_id = serializers.UUIDField(required=False, allow_null=True)
    related_lease_id = serializers.UUIDField(required=False, allow_null=True)


class ReconciliationDecisionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[
            ReconciliationStatus.INVESTIGATING,
            ReconciliationStatus.RESOLVED,
            ReconciliationStatus.ACCEPTED,
        ]
    )
    note = serializers.CharField(max_length=500, trim_whitespace=True)
