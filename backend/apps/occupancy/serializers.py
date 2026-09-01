from rest_framework import serializers

from .models import Occupancy, PropertyInvitation, PropertyJoinRequest


class OccupancySerializer(serializers.ModelSerializer):
    property_title = serializers.CharField(source="property.title", read_only=True)
    unit_label = serializers.CharField(source="unit.label", read_only=True)
    bed_label = serializers.CharField(source="bed.label", read_only=True, allow_null=True)

    class Meta:
        model = Occupancy
        fields = [
            "id",
            "property_id",
            "property_title",
            "unit_id",
            "unit_label",
            "bed_id",
            "bed_label",
            "lease_id",
            "status",
            "starts_on",
            "ends_on",
            "created_at",
        ]
        read_only_fields = fields


class InvitationSerializer(serializers.ModelSerializer):
    purpose_display = serializers.CharField(source="get_purpose_display", read_only=True)
    invitee_user_name = serializers.CharField(
        source="invitee_user.display_name", read_only=True, default=None
    )
    lease_status = serializers.CharField(source="lease.status", read_only=True, default=None)

    class Meta:
        model = PropertyInvitation
        fields = [
            "id",
            "property_id",
            "unit_id",
            "bed_id",
            "invitee_phone",
            "invitee_user_id",
            "invitee_user_name",
            "purpose",
            "purpose_display",
            "status",
            "expires_at",
            "accepted_at",
            "declined_at",
            "decline_reason",
            "note",
            "lease_id",
            "lease_status",
            "created_at",
        ]
        read_only_fields = fields


class JoinRequestSerializer(serializers.ModelSerializer):
    requester_display = serializers.CharField(source="requester.display_name", read_only=True)
    lease_status = serializers.CharField(source="lease.status", read_only=True, default=None)

    class Meta:
        model = PropertyJoinRequest
        fields = [
            "id",
            "requester_id",
            "requester_display",
            "property_id",
            "unit_id",
            "bed_id",
            "source_viewing_id",
            "status",
            "message",
            "decision_note",
            "decided_at",
            "lease_id",
            "lease_status",
            "created_at",
        ]
        read_only_fields = fields


class MyJoinRequestSerializer(serializers.ModelSerializer):
    """A join request as the person who sent it reads it.

    Named by place rather than by requester: they know who they are, and what
    they cannot otherwise see is which Unit at which Property they asked for and
    whether anyone has answered.
    """

    property_title = serializers.CharField(source="property.title", read_only=True)
    locality_name = serializers.CharField(
        source="property.address.locality.name", read_only=True, default=None
    )
    unit_label = serializers.CharField(source="unit.label", read_only=True, default=None)
    bed_label = serializers.CharField(source="bed.label", read_only=True, default=None)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    lease_status = serializers.CharField(source="lease.status", read_only=True, default=None)

    class Meta:
        model = PropertyJoinRequest
        fields = [
            "id",
            "property_id",
            "property_title",
            "locality_name",
            "unit_id",
            "unit_label",
            "bed_label",
            "status",
            "status_display",
            "decision_note",
            "decided_at",
            "lease_id",
            "lease_status",
            "created_at",
        ]
        read_only_fields = fields


class CreateJoinRequestSerializer(serializers.Serializer):
    unit_id = serializers.UUIDField()
    bed_id = serializers.UUIDField(required=False, allow_null=True)
    access_code = serializers.CharField(max_length=40, required=False)
    join_code = serializers.CharField(max_length=40, required=False, write_only=True)
    message = serializers.CharField(max_length=400, required=False, allow_blank=True)

    def validate(self, attrs):
        code = attrs.get("access_code") or attrs.get("join_code")
        if not code:
            raise serializers.ValidationError({"access_code": "Enter the space access code."})
        attrs["access_code"] = code
        return attrs


class JoinDecisionSerializer(serializers.Serializer):
    approved = serializers.BooleanField()
    note = serializers.CharField(max_length=400, required=False, allow_blank=True)
