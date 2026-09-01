"""Leases over the wire.

Money is formatted server-side so the two clients cannot disagree about what
GH₵1,500.00 looks like, and the statutory advance limit is sent alongside the
flag so the interface can name the number rather than hard-coding a 6.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.core.money import Money

from . import advance_policy
from .models import Lease, LeaseWorkflow

UTILITY_PARTIES = ["tenant", "provider", "included", "shared", "not_applicable"]
RESPONSIBILITIES = [
    "structural_repairs",
    "shared_areas",
    "property_rates",
    "routine_cleaning",
    "minor_consumables",
    "report_damage",
    "respect_neighbours",
    "residential_use",
]


class OccupantSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    relationship = serializers.CharField(max_length=80, required=False, allow_blank=True)


class AdditionalTermSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=120)
    body = serializers.CharField(max_length=1000)


class StructuredTermsSerializer(serializers.Serializer):
    payment_due = serializers.CharField(max_length=120, default="on the first day of each period")
    utilities = serializers.DictField(
        child=serializers.ChoiceField(choices=UTILITY_PARTIES), required=False, default=dict
    )
    occupants = OccupantSerializer(many=True, required=False, default=list)
    provider_responsibilities = serializers.ListField(
        child=serializers.ChoiceField(choices=RESPONSIBILITIES), required=False, default=list
    )
    tenant_responsibilities = serializers.ListField(
        child=serializers.ChoiceField(choices=RESPONSIBILITIES), required=False, default=list
    )
    notice_channels = serializers.ListField(
        child=serializers.ChoiceField(choices=["Rooomly", "email", "SMS", "written notice"]),
        required=False,
        default=list,
    )
    additional_terms = AdditionalTermSerializer(many=True, required=False, default=list)


class LeaseSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    unit_label = serializers.CharField(source="unit.label", read_only=True)
    property_title = serializers.CharField(source="unit.property.title", read_only=True)
    locality_name = serializers.CharField(
        source="unit.property.address.locality.name", read_only=True, default=None
    )
    landlord_name = serializers.CharField(source="landlord.display_name", read_only=True)
    tenant_name = serializers.CharField(source="tenant.display_name", read_only=True)

    rent_formatted = serializers.SerializerMethodField()
    move_in_total_minor = serializers.IntegerField(read_only=True)
    move_in_total_formatted = serializers.SerializerMethodField()
    advance_total_formatted = serializers.SerializerMethodField()

    bed_label = serializers.CharField(source="bed.label", read_only=True, default=None)

    both_accepted = serializers.BooleanField(read_only=True)
    advance_notice = serializers.SerializerMethodField()
    agreement = serializers.SerializerMethodField()
    builder_preview = serializers.SerializerMethodField()
    exceeds_statutory_advance = serializers.BooleanField(read_only=True)
    statutory_advance_limit_months = serializers.SerializerMethodField()

    class Meta:
        model = Lease
        fields = [
            "id",
            "workflow_version",
            "status",
            "status_display",
            "activation_requirement",
            "unit",
            "unit_label",
            "bed",
            "bed_label",
            "property_title",
            "locality_name",
            "landlord_name",
            "tenant_name",
            "listing",
            "application",
            "supersedes",
            "rent_minor",
            "rent_currency",
            "rent_period",
            "rent_formatted",
            "advance_months",
            "deposit_months",
            "agency_fee_months",
            "advance_total_formatted",
            "move_in_total_minor",
            "move_in_total_formatted",
            "starts_on",
            "term_months",
            "ends_on",
            "conditions",
            "structured_terms",
            "ready_at",
            "offered_at",
            "tenant_reviewed_at",
            "landlord_accepted_at",
            "tenant_accepted_at",
            "provider_confirmed_at",
            "activated_at",
            "both_accepted",
            "declined_at",
            "decline_reason",
            "ended_on",
            "superseded_at",
            "exceeds_statutory_advance",
            "statutory_advance_limit_months",
            "advance_notice",
            "agreement",
            "builder_preview",
            "created_at",
        ]
        read_only_fields = fields

    def _money(self, minor, currency) -> str | None:
        if minor is None:
            return None
        return str(Money(minor, currency or "GHS"))

    def get_rent_formatted(self, obj) -> str | None:
        return self._money(obj.rent_minor, obj.rent_currency)

    def get_move_in_total_formatted(self, obj) -> str | None:
        return self._money(obj.move_in_total_minor, obj.rent_currency)

    def get_advance_total_formatted(self, obj) -> str | None:
        return self._money(obj.advance_total_minor, obj.rent_currency)

    def get_statutory_advance_limit_months(self, obj) -> int:
        _, threshold = advance_policy.configured()
        return threshold

    def get_advance_notice(self, obj) -> dict | None:
        """What the product says about this advance, if it says anything.

        Sent as text rather than a flag the client interprets, so that the one
        place the wording is decided is the one place a lawyer has to review.
        """
        assessment = advance_policy.assess(
            advance_months=obj.advance_months, rent_period=obj.rent_period
        )
        if not assessment.exceeds or not assessment.message:
            return None
        return {
            "stance": assessment.stance,
            "months": assessment.months,
            "threshold_months": assessment.threshold_months,
            "message": assessment.message,
            "requires_acknowledgement": assessment.requires_acknowledgement,
        }

    def get_agreement(self, obj) -> dict | None:
        """The executed record, if this lease has one.

        Null for a lease offered before this existed. The hash is included so a
        client can show that the terms on screen are the ones that were
        accepted - not as a claim about signatures, which this is not.
        """
        agreement = getattr(obj, "agreement", None)
        if agreement is None:
            return None
        return {
            "content_hash": agreement.content_hash,
            "schema_version": agreement.schema_version,
            "hash_scope": agreement.hash_scope,
            "reference_number": agreement.reference_number,
            "template": {
                "code": agreement.template_code,
                "version": agreement.template_version,
                "review_status": agreement.legal_review_status,
            },
            # The tenant must review the same frozen words the acceptance hash
            # names, not fields re-read from the live Lease row.
            "terms": agreement.terms,
            "rendered_document": agreement.rendered_document,
            "rendered_text": agreement.rendered_text,
            "executed_at": agreement.executed_at,
            "final_pdf_hash": agreement.final_pdf_hash,
            "final_pdf_url": (
                f"/api/v1/leases/{obj.id}/document.pdf" if agreement.final_pdf else None
            ),
            "advance_stance": agreement.advance_stance,
            "advance_acknowledged": agreement.advance_acknowledged,
            "accepted_by": [
                {
                    "party": a.party,
                    "name": a.user.display_name,
                    "accepted_at": a.accepted_at,
                    "method": a.method,
                }
                for a in agreement.acceptances.all()
            ],
        }

    def get_builder_preview(self, obj) -> dict | None:
        if (
            obj.workflow_version != LeaseWorkflow.CANONICAL
            or obj.status not in ("draft", "ready")
            or not obj.template_id
        ):
            return None
        from .documents import render_agreement
        from .execution import freeze_terms

        document, text = render_agreement(lease=obj, template=obj.template, terms=freeze_terms(obj))
        return {"rendered_document": document, "rendered_text": text}


class DraftLeaseSerializer(serializers.Serializer):
    workflow_version = serializers.ChoiceField(
        choices=LeaseWorkflow.choices, default=LeaseWorkflow.LEGACY
    )
    unit_id = serializers.UUIDField()
    #: Letting a bed rather than the whole unit. Optional: null is a whole-unit
    #: lease, which is every lease that existed before this.
    bed_id = serializers.UUIDField(required=False, allow_null=True)
    tenant_id = serializers.UUIDField()
    application_id = serializers.UUIDField(required=False, allow_null=True)
    listing_id = serializers.UUIDField(required=False, allow_null=True)
    # Deprecated compatibility input. The view returns HTTP 410 with the
    # canonical tenancy-request path when an installed client still sends it.
    invitation_id = serializers.UUIDField(required=False, allow_null=True)
    join_request_id = serializers.UUIDField(required=False, allow_null=True)

    rent_minor = serializers.IntegerField(min_value=1)
    rent_currency = serializers.CharField(max_length=3, default="GHS")
    rent_period = serializers.ChoiceField(choices=["monthly", "yearly"], default="monthly")
    advance_months = serializers.IntegerField(min_value=0, max_value=36, default=0)
    deposit_months = serializers.IntegerField(min_value=0, max_value=12, default=0)
    agency_fee_months = serializers.IntegerField(min_value=0, max_value=6, default=0)

    starts_on = serializers.DateField()
    term_months = serializers.IntegerField(min_value=1, max_value=120, default=12)
    conditions = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    structured_terms = StructuredTermsSerializer(required=False, default=dict)


class UpdateLeaseSerializer(serializers.Serializer):
    rent_minor = serializers.IntegerField(min_value=1, required=False)
    rent_currency = serializers.CharField(max_length=3, required=False)
    rent_period = serializers.ChoiceField(choices=["monthly", "yearly"], required=False)
    advance_months = serializers.IntegerField(min_value=0, max_value=36, required=False)
    deposit_months = serializers.IntegerField(min_value=0, max_value=12, required=False)
    agency_fee_months = serializers.IntegerField(min_value=0, max_value=6, required=False)
    starts_on = serializers.DateField(required=False)
    term_months = serializers.IntegerField(min_value=1, max_value=120, required=False)
    conditions = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    structured_terms = StructuredTermsSerializer(required=False)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True)
    confirmed = serializers.BooleanField(required=False, default=False)
    #: Whether the tenant was shown the advance notice and said they read it.
    #: Recorded, never required: making acceptance conditional on it would turn
    #: the `warn` stance into `block` for anyone whose client does not send it.
    acknowledged = serializers.BooleanField(required=False, default=False)
