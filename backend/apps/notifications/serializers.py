from rest_framework import serializers

from .models import Notification, NotificationPreference


class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.BooleanField(read_only=True)

    class Meta:
        model = Notification
        fields = [
            "id",
            "kind",
            "title",
            "body",
            "target_type",
            "target_id",
            "read_at",
            "is_read",
            "created_at",
        ]
        read_only_fields = fields


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ["sms_enabled", "push_enabled", "sms_important_only"]


class MarkReadSerializer(serializers.Serializer):
    """Empty means "all of them", which is what the button in the app does."""

    ids = serializers.ListField(child=serializers.UUIDField(), required=False, allow_empty=True)
