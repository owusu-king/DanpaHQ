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
    access = serializers.SerializerMethodField()
    portfolio = serializers.SerializerMethodField()
    context_id = serializers.SerializerMethodField()

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
            "access",
            "portfolio",
            "context_id",
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

    def get_access(self, obj) -> dict:
        """State, outstanding requirements and abilities, decided in the service."""
        from .services import membership_access

        return membership_access(obj, standing=self.context.get("portfolio_standing"))

    def get_portfolio(self, obj) -> dict:
        return {
            "id": str(obj.organization_id),
            "name": obj.organization.name,
            "type": obj.organization.organization_type,
        }

    def get_context_id(self, obj) -> str:
        """The workspace context this membership is, named the way `/me/` names it.

        Returned so a client that has just accepted an invitation can select the
        Portfolio it joined without assembling the identifier itself.
        """
        return f"organization:{obj.organization_id}"


#: Said the same way wherever somebody asks for the owner role, because it is
#: the same answer: ownership is not a role a Team screen hands out.
OWNERSHIP_IS_SEPARATE = (
    "Ownership is not granted from the Team. Transferring a Portfolio is its own "
    "deliberate workflow."
)


class CreateInvitationSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32)
    # `owner` stays a valid choice so the refusal can explain itself; a choice
    # field would answer "is not a valid choice", which tells nobody where
    # ownership does move.
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

    def validate_role(self, value: str) -> str:
        if value == "owner":
            raise serializers.ValidationError(OWNERSHIP_IS_SEPARATE)
        return value


class InvitationActionSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=1000)


class ChangeMembershipRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(
        choices=["owner", "admin", "property_manager", "accountant", "staff"]
    )

    def validate_role(self, value: str) -> str:
        if value == "owner":
            raise serializers.ValidationError(OWNERSHIP_IS_SEPARATE)
        return value


class OrganizationInvitationSerializer(serializers.ModelSerializer):
    """One invitation, said differently to the Portfolio and to the invitee.

    A `viewer` in the context means "this is being read by somebody who followed
    a link". Then the number is only shown to the person it belongs to, and
    `addressed_to_you` and `requirements` answer the two questions a recipient
    actually has: is this for me, and is there anything I must do first.
    """

    portfolio = serializers.SerializerMethodField()
    invitee_phone = serializers.SerializerMethodField()
    invited_by_name = serializers.CharField(source="invited_by.display_name", read_only=True)
    properties = serializers.SerializerMethodField()
    token = serializers.SerializerMethodField()
    addressed_to_you = serializers.SerializerMethodField()
    requirements = serializers.SerializerMethodField()

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
            "addressed_to_you",
            "requirements",
        ]
        read_only_fields = fields

    def _addressed_to_viewer(self, obj) -> bool:
        viewer = self.context.get("viewer")
        return viewer is not None and viewer.phone == obj.invitee_phone

    def get_portfolio(self, obj) -> dict:
        return {
            "id": str(obj.organization_id),
            "name": obj.organization.name,
            "type": obj.organization.organization_type,
        }

    def get_invitee_phone(self, obj) -> str:
        national = format_national(obj.invitee_phone)
        if self.context.get("viewer") is None or self._addressed_to_viewer(obj):
            return national
        # Somebody else's link, opened by the wrong account. They are told what
        # it is and that it is not theirs, without being handed the number.
        parts = national.split(" ")
        return f"{parts[0]} ••• {parts[-1]}" if len(parts) >= 3 else "•••"

    def get_properties(self, obj) -> list[dict]:
        rows = obj.property_selections.select_related("property")
        return [{"id": str(row.property_id), "title": row.property.title} for row in rows]

    def get_token(self, obj) -> str | None:
        if not self.context.get("include_token") or obj.status != "pending":
            return None
        if self.context.get("viewer") is not None and not self._addressed_to_viewer(obj):
            return None
        from .services import invitation_token

        return invitation_token(obj)

    def get_addressed_to_you(self, obj) -> bool:
        return self._addressed_to_viewer(obj)

    def get_requirements(self, obj) -> list[str]:
        """What this reader must do before the invitation can become access."""
        from .models import MembershipRole
        from .services import elevated_authority_missing

        viewer = self.context.get("viewer")
        if viewer is None or obj.status != "pending" or not self._addressed_to_viewer(obj):
            return []
        if obj.role in {MembershipRole.OWNER, MembershipRole.ADMIN}:
            return elevated_authority_missing(viewer)
        return []


class PropertyAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyAssignment
        fields = ["id", "membership_id", "property_id", "created_at", "ended_at"]
        read_only_fields = fields


class CreatePropertyAssignmentSerializer(serializers.Serializer):
    membership_id = serializers.UUIDField()
    property_id = serializers.UUIDField()
