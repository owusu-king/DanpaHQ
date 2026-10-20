"""Trust API serializers.

The shape here is the contract the Stamp component renders against. Two things
it always carries and never omits:

* ``state`` — one of verified / pending / unverified / expired, computed rather
  than read from the stored status, so a stamp never claims currency between
  expiry sweeps.
* ``decided_at`` and ``expires_at`` — a check without a date is a claim about the
  past dressed up as a fact about today.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import (
    EvidenceType,
    ReviewQueueEntry,
    Verification,
    VerificationEvidence,
    VerificationKind,
    VerificationMethod,
)


class EvidenceSerializer(serializers.ModelSerializer):
    filename = serializers.CharField(source="file.original_filename", default="", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = VerificationEvidence
        fields = [
            "id",
            "evidence_type",
            "filename",
            "download_url",
            "reference",
            "collected_at",
            "notes",
        ]
        read_only_fields = fields

    def get_download_url(self, obj) -> str | None:
        return f"/api/v1/files/{obj.file_id}/download/" if obj.file_id else None


class VerificationSerializer(serializers.ModelSerializer):
    """The subject's own view of a check about them."""

    state = serializers.CharField(source="display_state", read_only=True)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    method_label = serializers.CharField(source="get_method_display", read_only=True)
    evidence_count = serializers.SerializerMethodField()

    class Meta:
        model = Verification
        fields = [
            "id",
            "kind",
            "kind_label",
            "state",
            "status",
            "method",
            "method_label",
            "decided_at",
            "expires_at",
            "decision_note",
            "evidence_count",
            "created_at",
        ]
        read_only_fields = fields

    def get_evidence_count(self, obj) -> int:
        return obj.evidence.count()


class ReviewerVerificationSerializer(VerificationSerializer):
    """Adds what only a reviewer may see."""

    evidence = EvidenceSerializer(many=True, read_only=True)
    subject_label = serializers.SerializerMethodField()
    subject_context = serializers.SerializerMethodField()

    class Meta(VerificationSerializer.Meta):
        fields = [
            *VerificationSerializer.Meta.fields,
            "subject_type",
            "subject_id",
            "subject_label",
            "subject_context",
            "evidence",
            "internal_note",
            "provider",
            "provider_reference",
        ]
        read_only_fields = fields

    def get_subject_label(self, obj) -> str:
        if obj.subject_type == "user":
            from apps.identity.models import User

            user = User.objects.filter(id=obj.subject_id).first()
            return user.display_name if user else "Unknown person"
        if obj.subject_type == "provider_application":
            from apps.property.models import PropertyProviderApplication

            application = (
                PropertyProviderApplication.objects.select_related("applicant", "address__locality")
                .filter(id=obj.subject_id)
                .first()
            )
            if application:
                return (
                    f"{application.applicant.display_name} - "
                    f"{application.get_relationship_type_display()} - "
                    f"{application.address.locality_label}"
                )
        if obj.subject_type == "property":
            from apps.property.models import Property

            prop = Property.objects.filter(id=obj.subject_id).first()
            return prop.title if prop else "Unknown property"
        return f"{obj.subject_type}:{obj.subject_id}"

    def get_subject_context(self, obj) -> dict | None:
        if obj.subject_type == "user":
            return self._user_context(obj)
        if obj.subject_type != "provider_application":
            return None
        from apps.property.models import PropertyProviderApplication

        application = (
            PropertyProviderApplication.objects.select_related(
                "applicant", "address__locality__district__region"
            )
            .filter(id=obj.subject_id)
            .first()
        )
        if not application:
            return None
        address = application.address
        return {
            "applicant": application.applicant.display_name,
            "phone_verified": application.applicant.is_phone_verified,
            "relationship": application.get_relationship_type_display(),
            "property_title": application.title,
            "property_type": application.get_property_type_display(),
            "locality": address.locality_label,
            "district": address.district_label,
            "region": address.region_label,
            "digital_address": address.digital_address,
            "street": address.street,
            "owner_name": application.owner_name,
            "owner_phone": application.owner_phone,
            "company_name": application.company_name,
        }

    def _user_context(self, obj) -> dict | None:
        """Who the reviewer is being asked to decide about.

        A check on a person used to arrive as a name and an attachment, which is
        not enough to decide anything — least of all provider standing, where
        approving means both "this is who they say" and "they may operate here".
        The reviewer needs the account around the document: how long it has
        existed, whether the number is proved, what else has been decided about
        them, and whether anything is already outstanding.

        The number is masked, as it is everywhere else on the operations
        surface. A reviewer needs to confirm a document against an account, not
        to be handed a contact list.
        """
        from apps.core.phone import mask
        from apps.identity.models import User

        user = User.objects.filter(id=obj.subject_id).first()
        if user is None:
            return None

        from .models import Verification, VerificationStatus

        others = (
            Verification.objects.for_subject("user", user.id)
            .exclude(id=obj.id)
            .exclude(status=VerificationStatus.SUPERSEDED)
        )
        # An artisan application is decided on what they do as much as who they
        # are, so the reviewer reads the trades and area beside the account.
        application = {}
        if obj.kind == VerificationKind.ARTISAN:
            from apps.artisan.services import review_context

            application = review_context(user.id) or {}
        return {
            **application,
            "name": user.display_name,
            "phone": mask(user.phone),
            "phone_verified": user.is_phone_verified,
            "account_type": user.account_type or "not chosen",
            "registration": user.registration_state,
            "date_of_birth": user.date_of_birth.isoformat() if user.date_of_birth else "",
            "email": user.email or "",
            "member_since": user.created_at.date().isoformat(),
            "other_checks": ", ".join(sorted(f"{row.kind}: {row.status}" for row in others))
            or "none",
        }


class StartVerificationSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=VerificationKind.choices)
    method = serializers.ChoiceField(
        choices=[VerificationMethod.DOCUMENT_REVIEW, VerificationMethod.PROVIDER_API],
        default=VerificationMethod.DOCUMENT_REVIEW,
    )


class AttachEvidenceSerializer(serializers.Serializer):
    evidence_type = serializers.ChoiceField(choices=EvidenceType.choices)
    file_id = serializers.UUIDField(required=False, allow_null=True)
    reference = serializers.CharField(required=False, allow_blank=True, max_length=200)
    #: Only for identity checks. Hashed immediately; never stored in the clear.
    national_id = serializers.CharField(required=False, allow_blank=True, max_length=32)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=600)


class DecisionSerializer(serializers.Serializer):
    approved = serializers.BooleanField()
    note = serializers.CharField(required=False, allow_blank=True, max_length=600)
    internal_note = serializers.CharField(required=False, allow_blank=True)
    validity_days = serializers.IntegerField(required=False, allow_null=True, min_value=1)

    def validate(self, attrs):
        if not attrs.get("approved") and not attrs.get("note"):
            raise serializers.ValidationError(
                {
                    "note": "Say why this was rejected and what the person should do next. "
                    "They will see this message."
                }
            )
        return attrs


class ReviewQueueSerializer(serializers.ModelSerializer):
    verification = ReviewerVerificationSerializer(read_only=True)
    waiting_hours = serializers.FloatField(read_only=True)
    claimed_by_name = serializers.CharField(
        source="claimed_by.display_name", default="", read_only=True
    )

    class Meta:
        model = ReviewQueueEntry
        fields = [
            "id",
            "priority",
            "verification",
            "waiting_hours",
            "claimed_by_name",
            "claimed_at",
            "created_at",
        ]
        read_only_fields = fields
