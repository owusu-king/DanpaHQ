from __future__ import annotations

from rest_framework import serializers

from .models import CorrectionRecord, PassportShare
from .services import DEFAULT_EXPIRY_DAYS, EXPIRY_DAYS, link_token


class ScopeInputSerializer(serializers.Serializer):
    include_identity = serializers.BooleanField(default=False)
    tenancy_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list, max_length=50
    )
    include_payments = serializers.BooleanField(default=False)
    include_amounts = serializers.BooleanField(default=False)


class ShareInputSerializer(ScopeInputSerializer):
    recipient_label = serializers.CharField(
        max_length=80, required=False, allow_blank=True, default=""
    )
    expires_in_days = serializers.ChoiceField(choices=EXPIRY_DAYS, default=DEFAULT_EXPIRY_DAYS)


class CorrectionInputSerializer(serializers.Serializer):
    record_type = serializers.ChoiceField(choices=CorrectionRecord.choices)
    record_id = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    reason = serializers.CharField(max_length=1000)


class OpenShareSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)


class ShareSerializer(serializers.ModelSerializer):
    """One of the owner's links. The token appears only while the link works."""

    state = serializers.CharField(read_only=True)
    token = serializers.SerializerMethodField()
    scope = serializers.SerializerMethodField()

    class Meta:
        model = PassportShare
        fields = [
            "id",
            "recipient_label",
            "state",
            "token",
            "scope",
            "created_at",
            "expires_at",
            "revoked_at",
            "view_count",
            "first_viewed_at",
            "last_viewed_at",
        ]

    def get_token(self, obj) -> str | None:
        return link_token(obj)

    def get_scope(self, obj) -> dict:
        return {
            "identity": obj.include_identity,
            "tenancy_ids": [str(value) for value in obj.tenancy_ids or []],
            "payments": obj.include_payments,
            "amounts": obj.include_amounts,
        }
