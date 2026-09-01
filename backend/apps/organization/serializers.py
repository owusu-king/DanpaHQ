from rest_framework import serializers

from apps.core.phone import PhoneNumberError, format_national, normalise_ghana_msisdn

from .models import (
    Organization,
    OrganizationActivityType,
    OrganizationInvitation,
    OrganizationMembership,
    OrganizationType,
    PropertyAssignment,
)


class OrganizationSerializer(serializers.ModelSerializer):
    activities = serializers.SerializerMethodField()
    current_user_role = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = [
            "id",
            "name",
            "organization_type",
            "activities",
            "current_user_role",
            "is_active",
            "created_at",
        ]
        read_only_fields = fields

    def get_activities(self, obj) -> list[str]:
        return list(obj.activities.values_list("activity", flat=True))

    def get_current_user_role(self, obj) -> str | None:
        user = self.context.get("user")
        if user is None:
            return None
        membership = obj.memberships.filter(user=user, ended_at__isnull=True).first()
        return membership.role if membership else None


class CreateOrganizationSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=180)
    organization_type = serializers.ChoiceField(choices=OrganizationType.values)
    activities = serializers.ListField(
        child=serializers.ChoiceField(choices=OrganizationActivityType.values),
        min_length=1,
        max_length=len(OrganizationActivityType.values),
    )


class UpdateOrganizationSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=180, required=False)
    organization_type = serializers.ChoiceField(choices=OrganizationType.values, required=False)
    activities = serializers.ListField(
        child=serializers.ChoiceField(choices=OrganizationActivityType.values),
        min_length=1,
        max_length=len(OrganizationActivityType.values),
        required=False,
    )


class MembershipSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(source="user.display_name", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)

    assigned_properties = serializers.SerializerMethodField()
    effective_access = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationMembership
        fields = [
            "id",
            "user_id",
            "display_name",
            "phone",
            "role",
            "joined_at",
            "ended_at",
            "assigned_properties",
            "effective_access",
        ]
        read_only_fields = fields

    def get_assigned_properties(self, obj) -> list[dict]:
        rows = obj.property_assignments.filter(ended_at__isnull=True).select_related("property")
        return [{"id": str(row.property_id), "title": row.property.title} for row in rows]

    def get_effective_access(self, obj) -> str:
        if obj.role in {"owner", "admin"}:
            return "portfolio_wide"
        if obj.role == "accountant":
            return "assigned_financial"
        return "assigned_properties"


class CreateInvitationSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32)
    role = serializers.ChoiceField(
        choices=["owner", "admin", "property_manager", "accountant", "staff"]
    )
    property_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, allow_empty=True, max_length=200
    )

    def validate_phone(self, value: str) -> str:
        try:
            return normalise_ghana_msisdn(value)
        except PhoneNumberError as exc:
            raise serializers.ValidationError(str(exc)) from exc


class InvitationActionSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=1000)


class ChangeMembershipRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(
        choices=["owner", "admin", "property_manager", "accountant", "staff"]
    )


class OrganizationInvitationSerializer(serializers.ModelSerializer):
    portfolio = serializers.SerializerMethodField()
    invitee_phone = serializers.SerializerMethodField()
    invited_by_name = serializers.CharField(source="invited_by.display_name", read_only=True)
    properties = serializers.SerializerMethodField()
    token = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationInvitation
        fields = [
            "id",
            "portfolio",
            "invitee_phone",
            "role",
            "status",
            "invited_by_name",
            "properties",
            "expires_at",
            "responded_at",
            "created_at",
            "token",
        ]
        read_only_fields = fields

    def get_portfolio(self, obj) -> dict:
        return {
            "id": str(obj.organization_id),
            "name": obj.organization.name,
            "type": obj.organization.organization_type,
        }

    def get_invitee_phone(self, obj) -> str:
        return format_national(obj.invitee_phone)

    def get_properties(self, obj) -> list[dict]:
        rows = obj.property_selections.select_related("property")
        return [{"id": str(row.property_id), "title": row.property.title} for row in rows]

    def get_token(self, obj) -> str | None:
        if not self.context.get("include_token") or obj.status != "pending":
            return None
        from .services import invitation_token

        return invitation_token(obj)


class PropertyAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyAssignment
        fields = ["id", "membership_id", "property_id", "created_at", "ended_at"]
        read_only_fields = fields


class CreatePropertyAssignmentSerializer(serializers.Serializer):
    membership_id = serializers.UUIDField()
    property_id = serializers.UUIDField()
