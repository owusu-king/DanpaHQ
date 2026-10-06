from rest_framework import serializers

from .models import Notification, NotificationPreference


class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.BooleanField(read_only=True)
    #: "informational" (a reminder, deleted once read) or "activity" (kept,
    #: the most recent few). The client says so rather than guessing.
    record = serializers.SerializerMethodField()

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
            "record",
            "created_at",
        ]
        read_only_fields = fields

    def get_record(self, obj) -> str:
        from .services import is_informational

        return "informational" if is_informational(obj.kind) else "activity"


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    """Channels, the numbers they use, and which alerts may use them.

    Numbers are stored in E.164 and a blank one means "the account's own".
    ``alerts`` is read back complete, every topic present, so a client never
    has to know which ones were never touched.
    """

    alerts = serializers.DictField(child=serializers.BooleanField(), required=False)
    account_phone = serializers.CharField(source="user.phone", read_only=True)
    alert_topics = serializers.SerializerMethodField()
    whatsapp_available = serializers.SerializerMethodField()

    class Meta:
        model = NotificationPreference
        fields = [
            "sms_enabled",
            "push_enabled",
            "sms_important_only",
            "sms_number",
            "whatsapp_enabled",
            "whatsapp_number",
            "alerts",
            "account_phone",
            "alert_topics",
            "whatsapp_available",
        ]

    def get_alert_topics(self, obj) -> list[dict]:
        from .services import ALERT_TOPICS

        return [
            {"key": topic["key"], "label": topic["label"], "description": topic["description"]}
            for topic in ALERT_TOPICS
        ]

    def get_whatsapp_available(self, obj) -> bool:
        # No WhatsApp provider is connected yet. When one is, this is the switch.
        return False

    def _number(self, value: str) -> str:
        from apps.core.phone import PhoneNumberError, normalise_ghana_msisdn

        value = (value or "").strip()
        if not value:
            return ""
        try:
            return normalise_ghana_msisdn(value)
        except PhoneNumberError as exc:
            raise serializers.ValidationError("Enter a Ghana mobile number.") from exc

    def validate_sms_number(self, value):
        return self._number(value)

    def validate_whatsapp_number(self, value):
        return self._number(value)

    def validate_alerts(self, value):
        from .services import ALERT_KEYS

        unknown = sorted(set(value) - set(ALERT_KEYS))
        if unknown:
            raise serializers.ValidationError(f"Unknown alert: {', '.join(unknown)}.")
        return value

    def update(self, instance, validated_data):
        alerts = validated_data.pop("alerts", None)
        if alerts is not None:
            instance.alerts = {**(instance.alerts or {}), **alerts}
        return super().update(instance, validated_data)

    def to_representation(self, instance):
        from .services import alerts_for

        data = super().to_representation(instance)
        data["alerts"] = alerts_for(instance)
        return data


class MarkReadSerializer(serializers.Serializer):
    """Empty means "all of them", which is what the button in the app does."""

    ids = serializers.ListField(child=serializers.UUIDField(), required=False, allow_empty=True)
