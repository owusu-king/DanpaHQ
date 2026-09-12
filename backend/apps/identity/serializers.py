"""API serializers for identity.

Two rules run through this file:

* **Never echo a secret.** No serializer exposes a code, a token hash, a full
  national ID, or another user's phone number.
* **Error messages are product copy.** They say what to do next, in the same
  voice as the interface, because they are read by a person on a phone and not
  by a developer.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.core.phone import PhoneNumberError, format_national, mask, normalise_ghana_msisdn

from .models import (
    AccountType,
    AgentProfile,
    Device,
    DevicePlatform,
    LandlordProfile,
    Profile,
    Role,
    Session,
    TenantProfile,
    User,
)
from .services import PROVIDER_EVIDENCE_TYPES


class PhoneField(serializers.CharField):
    def to_internal_value(self, data):
        try:
            return normalise_ghana_msisdn(str(data))
        except PhoneNumberError as exc:
            raise serializers.ValidationError(str(exc)) from exc


class StartChallengeSerializer(serializers.Serializer):
    phone = PhoneField()
    purpose = serializers.ChoiceField(
        # sign_in/sign_up remain accepted for one compatibility release. New
        # consumer clients use one enumeration-resistant continue flow.
        choices=["continue", "sign_in", "sign_up", "change_phone", "recover_account"],
        default="continue",
    )
    device_fingerprint = serializers.CharField(required=False, allow_blank=True, max_length=128)


class ChallengeIssuedSerializer(serializers.Serializer):
    """What the client learns after asking for a code.

    Note what is absent: whether the number has an account. Returning that would
    turn this endpoint into an account-enumeration oracle, which is how attackers
    build lists to target. The client finds out after proving the number.
    """

    challenge_id = serializers.UUIDField()
    phone_display = serializers.CharField()
    expires_in = serializers.IntegerField()
    resend_in = serializers.IntegerField()
    attempts_allowed = serializers.IntegerField()


class VerifyChallengeSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    code = serializers.CharField(min_length=4, max_length=10, trim_whitespace=True)
    device_fingerprint = serializers.CharField(required=False, allow_blank=True, max_length=128)
    platform = serializers.ChoiceField(
        choices=DevicePlatform.choices, default=DevicePlatform.ANDROID
    )
    device_label = serializers.CharField(required=False, allow_blank=True, max_length=120)
    app_version = serializers.CharField(required=False, allow_blank=True, max_length=40)
    os_version = serializers.CharField(required=False, allow_blank=True, max_length=40)

    def validate_code(self, value: str) -> str:
        cleaned = "".join(ch for ch in value if ch.isdigit())
        if not cleaned:
            raise serializers.ValidationError("Enter the code from the message.")
        return cleaned


class DeviceContextSerializer(serializers.Serializer):
    """The device fields every session-opening endpoint accepts."""

    device_fingerprint = serializers.CharField(required=False, allow_blank=True, max_length=128)
    platform = serializers.ChoiceField(
        choices=DevicePlatform.choices, default=DevicePlatform.ANDROID
    )
    device_label = serializers.CharField(required=False, allow_blank=True, max_length=120)
    app_version = serializers.CharField(required=False, allow_blank=True, max_length=40)
    os_version = serializers.CharField(required=False, allow_blank=True, max_length=40)


class PasswordSignInSerializer(DeviceContextSerializer):
    phone = PhoneField()
    #: No max_length. Truncating a long passphrase silently would change the
    #: credential the person thinks they set.
    password = serializers.CharField(trim_whitespace=False)


class CompleteRegistrationSerializer(DeviceContextSerializer):
    """Shape only. Every judgement about the *content* belongs to the service.

    Deliberately permissive about blanks and absences. This layer used to reject
    an empty name itself, which meant it never got as far as checking the date of
    birth or the password — so a form with four faults reported two, and the
    person fixed those only to discover two more. The service checks all of them
    together and names each one, and it can only do that if it is reached.

    An unparseable date still fails here, because "not a date" is a shape problem
    and there is nothing the service could say about it that this does not.

    Carries the device fields because this is where a session is opened now: the
    account does not exist until this call succeeds, so there was nowhere
    earlier to open one.
    """

    #: From /auth/verify. Absent when an already-signed-in unfinished account is
    #: completing itself, which is the pre-ticket path.
    registration_ticket = serializers.CharField(required=False, allow_blank=True)
    account_type = serializers.ChoiceField(
        choices=AccountType.choices, required=False, allow_blank=True
    )
    first_name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    preferred_name = serializers.CharField(required=False, allow_blank=True, max_length=80)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)
    password = serializers.CharField(trim_whitespace=False, required=False, allow_blank=True)


class StartPasswordResetSerializer(serializers.Serializer):
    phone = PhoneField()
    device_fingerprint = serializers.CharField(required=False, allow_blank=True, max_length=128)


class VerifyPasswordResetSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    code = serializers.CharField(min_length=4, max_length=10, trim_whitespace=True)

    def validate_code(self, value: str) -> str:
        cleaned = "".join(ch for ch in value if ch.isdigit())
        if not cleaned:
            raise serializers.ValidationError("Enter the code from the message.")
        return cleaned


class CompletePasswordResetSerializer(DeviceContextSerializer):
    reset_token = serializers.CharField()
    new_password = serializers.CharField(trim_whitespace=False)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False)


class ProviderVerificationDocumentSerializer(serializers.Serializer):
    file_id = serializers.UUIDField()
    evidence_type = serializers.ChoiceField(choices=sorted(PROVIDER_EVIDENCE_TYPES))


class StartProviderVerificationSerializer(serializers.Serializer):
    documents = ProviderVerificationDocumentSerializer(many=True, allow_empty=False)


class ChooseWorkspaceSerializer(serializers.Serializer):
    workspace = serializers.ChoiceField(choices=["discovery", "tenant", "provider"])


class RefreshSerializer(serializers.Serializer):
    refresh_token = serializers.CharField()


class TokenPairSerializer(serializers.Serializer):
    access_token = serializers.CharField()
    refresh_token = serializers.CharField()
    expires_in = serializers.IntegerField()


class DeviceSerializer(serializers.ModelSerializer):
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = Device
        fields = [
            "id",
            "label",
            "platform",
            "os_version",
            "app_version",
            "first_seen_at",
            "last_seen_at",
            "trusted_at",
            "is_current",
        ]
        read_only_fields = fields

    def get_is_current(self, obj) -> bool:
        return str(obj.id) == str(self.context.get("current_device_id"))


class SessionSerializer(serializers.ModelSerializer):
    device_label = serializers.CharField(source="device.label", default="", read_only=True)
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = Session
        fields = [
            "id",
            "device_label",
            "client",
            "issued_at",
            "last_used_at",
            "expires_at",
            "is_current",
        ]
        read_only_fields = fields

    def get_is_current(self, obj) -> bool:
        return str(obj.id) == str(self.context.get("current_session_id"))


class TenantProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantProfile
        fields = [
            "occupation",
            "employer",
            "income_band",
            "household_size",
            "move_in_from",
            "budget_max_minor",
            "budget_max_currency",
            "advance_months_affordable",
            "has_pets",
            "smoker",
        ]


class LandlordProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = LandlordProfile
        fields = [
            "is_company",
            "company_name",
            "company_registration_number",
            "properties_declared",
            "manages_own_properties",
            "preferred_payout_method",
        ]


class AgentProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentProfile
        fields = [
            "agency_name",
            "licence_number",
            "years_active",
            "operating_localities",
            "commission_policy",
        ]


class ProfileSerializer(serializers.ModelSerializer):
    completeness = serializers.IntegerField(read_only=True)

    #: Where to fetch the photo. Null means there is none, or the one on file is
    #: not servable yet — the client shows initials either way, so it never has
    #: to reason about upload state.
    avatar_url = serializers.SerializerMethodField()
    #: Set by handing over the id of a file already uploaded under the `avatar`
    #: purpose. Explicit null removes the photo. Write-only because the id is an
    #: implementation detail of setting it; `avatar_url` is what a client reads.
    avatar_file_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Profile
        fields = [
            "bio",
            "address",
            "preferred_localities",
            "contact_preference",
            "national_id_last4",
            "completeness",
            "avatar_url",
            "avatar_file_id",
        ]
        read_only_fields = ["national_id_last4", "completeness"]

    def get_avatar_url(self, obj) -> str | None:
        from .avatar import avatar_url

        return avatar_url(obj)

    def update(self, instance, validated_data):
        """The photo is set through its own service, the rest as usual.

        `avatar_file_id` is popped before the normal field assignment because it
        is not a field on the model — the ownership and purpose checks in
        `avatar.set_avatar` are what stand between a file id and somebody
        else's document being served as their picture.
        """
        from .avatar import set_avatar

        has_avatar_change = "avatar_file_id" in validated_data
        file_id = validated_data.pop("avatar_file_id", None)

        instance = super().update(instance, validated_data)

        if has_avatar_change:
            user = getattr(self.context.get("request"), "user", None) or instance.user
            set_avatar(profile=instance, user=user, file_id=file_id)
            instance.refresh_from_db(fields=["avatar"])

        return instance


class MeSerializer(serializers.ModelSerializer):
    """The signed-in user's own view of themselves."""

    display_name = serializers.CharField(read_only=True)
    phone_display = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    primary_role = serializers.CharField(read_only=True)
    profile = ProfileSerializer(read_only=True)
    trust = serializers.SerializerMethodField()
    account_status = serializers.SerializerMethodField()
    authentication_state = serializers.SerializerMethodField()
    phone_verification_state = serializers.SerializerMethodField()
    onboarding_state = serializers.SerializerMethodField()
    available_contexts = serializers.SerializerMethodField()
    default_context = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    entry_routes = serializers.SerializerMethodField()
    provider_readiness = serializers.SerializerMethodField()
    intents = serializers.SerializerMethodField()
    contexts = serializers.SerializerMethodField()
    default_context_id = serializers.SerializerMethodField()
    capabilities = serializers.SerializerMethodField()
    registration_state = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "display_name",
            "first_name",
            "last_name",
            "preferred_name",
            "phone_display",
            "email",
            "date_of_birth",
            "account_type",
            "is_phone_verified",
            "preferred_language",
            "data_saver",
            "roles",
            "primary_role",
            "profile",
            "trust",
            "created_at",
            "account_status",
            "authentication_state",
            "phone_verification_state",
            "registration_state",
            "capabilities",
            "onboarding_state",
            "available_contexts",
            "default_context",
            "permissions",
            "entry_routes",
            "provider_readiness",
            "intents",
            "contexts",
            "default_context_id",
        ]
        read_only_fields = [
            "id",
            "is_phone_verified",
            "created_at",
            "account_type",
            "date_of_birth",
        ]

    def get_capabilities(self, obj) -> dict:
        """The authorization surface clients render from."""
        from .services import account_capabilities

        if not hasattr(self, "_capabilities"):
            self._capabilities = account_capabilities(obj)
        return self._capabilities

    def get_phone_display(self, obj) -> str:
        return format_national(obj.phone)

    def get_roles(self, obj) -> list[str]:
        return sorted(obj.roles)

    def get_trust(self, obj) -> dict:
        from apps.trust.services import trust_summary

        return trust_summary("user", obj.id)

    def get_account_status(self, obj) -> str:
        if obj.deactivated_at is not None:
            return "deactivated"
        return "active" if obj.is_active else "restricted"

    def get_authentication_state(self, obj) -> str:
        return "authenticated"

    def get_phone_verification_state(self, obj) -> str:
        return "verified" if obj.is_phone_verified else "unverified"

    def get_onboarding_state(self, obj) -> str:
        consumer_roles = {Role.TENANT, Role.LANDLORD, Role.AGENT, Role.PROPERTY_MANAGER}
        if obj.is_staff and not (obj.roles & consumer_roles):
            return "complete"
        if obj.is_registration_complete:
            # Registration now collects the name and the account type, which is
            # everything the old intent step was gating on. Asking again after
            # someone has just answered it is how a sign-up gets abandoned.
            return "complete"
        if obj.onboarding_completed_at and (
            obj.intent_selections.exists() or obj.primary_role is not None
        ):
            return "complete"
        if not (obj.first_name.strip() and obj.last_name.strip()):
            return "profile_required"
        return "intent_required"

    def get_intents(self, obj) -> list[str]:
        return list(
            obj.intent_selections.order_by("-is_primary", "selected_at").values_list(
                "intent", flat=True
            )
        )

    def get_contexts(self, obj) -> list[dict]:
        consumer_roles = {Role.TENANT, Role.LANDLORD, Role.AGENT, Role.PROPERTY_MANAGER}
        if obj.is_staff and not (obj.roles & consumer_roles):
            return []
        contexts = [
            {
                "id": "discovery",
                "type": "discovery",
                "label": "Find a property",
                "mobile_route": "/(app)/(tabs)",
                "web_route": "/rentals",
            }
        ]
        from apps.occupancy.services import occupancy_contexts_for_user
        from apps.organization.services import organization_contexts_for_user

        contexts.extend(occupancy_contexts_for_user(obj))
        contexts.extend(organization_contexts_for_user(obj))
        return contexts

    def get_default_context_id(self, obj) -> str | None:
        selection = obj.intent_selections.filter(is_primary=True).first()
        contexts = self.get_contexts(obj)
        if selection:
            prefix = {
                "manage_property": "organization:",
                "current_tenant": "occupancy:",
            }.get(selection.intent)
            if prefix:
                match = next((item for item in contexts if item["id"].startswith(prefix)), None)
                if match:
                    return match["id"]
                if selection.intent == "manage_property":
                    # Discovery is available, but it is not the manager's
                    # default mode merely because no organization exists yet.
                    return None
        return "discovery" if contexts else None

    def get_provider_readiness(self, obj) -> dict | None:
        if not ({Role.LANDLORD, Role.AGENT, Role.PROPERTY_MANAGER} & obj.roles):
            return None
        if not hasattr(self, "_provider_readiness"):
            from apps.property.services import provider_readiness

            self._provider_readiness = provider_readiness(obj)
        return self._provider_readiness

    def get_available_contexts(self, obj) -> list[str]:
        # Operations roles are never consumer workspaces. Staff authenticate on
        # the separate admin surface under its own password/MFA policy.
        consumer = {Role.TENANT, Role.LANDLORD, Role.AGENT, Role.PROPERTY_MANAGER}
        available = obj.roles & consumer
        if not self.get_capabilities(obj)["provider"]["workspace_access"]:
            # A provider role without approved standing is not a context the
            # client may offer, whatever put the role there.
            available -= {Role.LANDLORD, Role.AGENT, Role.PROPERTY_MANAGER}
        return sorted(available)

    def get_default_context(self, obj) -> str | None:
        contexts = self.get_available_contexts(obj)
        return (
            obj.primary_role
            if obj.primary_role in contexts
            else (contexts[0] if contexts else None)
        )

    def get_permissions(self, obj) -> list[str]:
        """Coarse navigation capabilities, never object-level authority."""
        roles = obj.roles
        capabilities = {"browse_listings", "manage_own_account"}
        if Role.TENANT in roles:
            capabilities.update({"save_listing", "request_viewing", "apply_for_rental"})
        if roles & {Role.LANDLORD, Role.AGENT, Role.PROPERTY_MANAGER}:
            capabilities.update({"manage_related_properties", "review_related_applications"})
        return sorted(capabilities)

    def get_entry_routes(self, obj) -> dict[str, str]:
        """Where this person lands, decided from the experience they asked for.

        The old version read a role name and ignored the choice entirely, so an
        existing tenant who tapped "I own or manage property" was dropped into
        tenant space — the one place they had just said they did not want to be.
        The workspace they chose now leads, and their capabilities decide only
        *how much* of it they see.

        Web lands on ``/home`` for every workspace that is actually open. The
        portal's home is role-aware, so the destination stops being "a list of
        properties" or "the public rentals page" and becomes the same question
        for both: what is going on, and what should I do next. The route itself
        still comes from here rather than being worked out in the browser.
        """
        if self.get_account_status(obj) != "active":
            return {"mobile": "/(app)/restricted", "web": "/restricted"}

        capabilities = self.get_capabilities(obj)
        if capabilities["registration_state"] != "complete":
            return {"mobile": "/(auth)/register", "web": "/register"}

        provider = capabilities["provider"]
        workspace = capabilities["active_workspace"]

        if workspace == "provider":
            # Access first, and declaration second. A Team member has access
            # without having declared anything, and the previous order sent them
            # to the provider onboarding form — asking an invited manager to
            # become an independent provider before they could open the
            # Portfolio that invited them.
            if provider["workspace_access"]:
                return {"mobile": "/(app)/(provider-tabs)", "web": "/home"}
            if provider["exists"]:
                # Declared but not yet approved. The provider screen is the
                # destination whether they have submitted or not: before, it is
                # the form; after, it is where their review stands. Neither is
                # the tenant experience, and neither is an empty workspace.
                return {"mobile": "/(app)/provider", "web": "/provider"}

        if workspace == "tenant" and capabilities["tenant"]["workspace_access"]:
            # A tenant with no occupancy still belongs here. Joining a property
            # is an action available from home, not a gate in front of it.
            return {"mobile": "/(app)/(tabs)", "web": "/home"}

        # Discovery: the experience that needs no capability at all, and the
        # honest destination for anyone whose chosen workspace is not open to
        # them. There is deliberately no role-name branch anywhere above.
        return {"mobile": "/(app)/(tabs)", "web": "/home"}


class PublicUserSerializer(serializers.ModelSerializer):
    """How one user appears to another.

    Contact details are masked. A tenant browsing listings does not get a
    landlord's phone number, and vice versa - the platform brokers contact so it
    can also record it.
    """

    display_name = serializers.CharField(read_only=True)
    phone_masked = serializers.SerializerMethodField()
    trust = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "display_name", "phone_masked", "trust", "created_at"]

    def get_phone_masked(self, obj) -> str:
        return mask(obj.phone)

    def get_trust(self, obj) -> dict:
        from apps.trust.services import trust_summary

        return trust_summary("user", obj.id)
