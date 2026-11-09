"""Management editor for the supported provider plan inclusions."""

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.billing import catalogue
from apps.billing.models import Plan, PlanEntitlement, ValueType
from apps.core.exceptions import NotFound, StaleWrite, ValidationFailed

from .permissions import Capability
from .views import ManagementAPIView

EDITABLE_FEATURES = frozenset({catalogue.AUTOMATED_RENT_REMINDERS, catalogue.TEAM_MANAGEMENT})
EDITABLE_LIMITS = frozenset(catalogue.HEADLINE_LIMITS)


class PlanInclusionSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=48)
    value = serializers.JSONField(allow_null=True)
    unlimited = serializers.BooleanField()


class PlanConfigurationSerializer(serializers.Serializer):
    revision = serializers.DateTimeField()
    reason = serializers.CharField(max_length=300)
    updates = PlanInclusionSerializer(many=True, allow_empty=False)

    def validate_updates(self, updates):
        if len(updates) > len(EDITABLE_FEATURES) + len(EDITABLE_LIMITS):
            raise serializers.ValidationError("Too many inclusions in one update.")
        return updates


def _inclusion(row):
    entitlement = row.entitlement
    if entitlement.key in EDITABLE_FEATURES and entitlement.value_type == ValueType.BOOLEAN:
        editor = "toggle"
    elif entitlement.key in EDITABLE_LIMITS and entitlement.value_type == ValueType.INTEGER:
        editor = "increase_limit"
    else:
        editor = "read_only"
    return {
        "key": entitlement.key,
        "name": entitlement.name,
        "description": entitlement.description,
        "value": row.value,
        "unlimited": row.is_unlimited,
        "editor": editor,
    }


def _plan(plan, rows):
    inclusions = {row.entitlement.key: _inclusion(row) for row in rows}
    return {
        "code": plan.code,
        "name": plan.name,
        "revision": plan.updated_at.isoformat(),
        "inclusions": [
            inclusions[item["key"]] for item in catalogue.entitlement_layout(inclusions)
        ],
    }


def _response(data):
    response = Response(data)
    response["Cache-Control"] = "private, no-store"
    return response


class PlanConfigurationView(ManagementAPIView):
    required_capability = Capability.MANAGE_BILLING

    def get(self, request):
        plans = list(Plan.objects.all())
        by_plan = {plan.pk: [] for plan in plans}
        for row in PlanEntitlement.objects.select_related("entitlement").order_by():
            by_plan[row.plan_id].append(row)
        return _response({"plans": [_plan(plan, by_plan[plan.pk]) for plan in plans]})


class PlanConfigurationDetailView(ManagementAPIView):
    required_capability = Capability.MANAGE_BILLING

    @transaction.atomic
    def patch(self, request, code):
        payload = PlanConfigurationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        plan = Plan.objects.select_for_update().filter(code=code).first()
        if plan is None:
            raise NotFound("We could not find that plan.")
        if data["revision"] != plan.updated_at:
            raise StaleWrite("This plan changed. Reload its inclusions before saving.")

        rows = {
            row.entitlement.key: row
            for row in PlanEntitlement.objects.select_for_update(of=("self",))
            .filter(plan=plan).select_related("entitlement").order_by()
        }
        changes = {}
        seen = set()
        for update in data["updates"]:
            key, value, unlimited = update["key"], update["value"], update["unlimited"]
            if key in seen:
                raise ValidationFailed("Each inclusion can only be changed once.")
            seen.add(key)
            row = rows.get(key)
            if row is None:
                raise ValidationFailed("That inclusion does not belong to this plan.")
            before = _inclusion(row)
            if before["editor"] == "toggle":
                if type(value) is not bool or unlimited:
                    raise ValidationFailed(f"Choose included or excluded for {before['name']}.")
            elif before["editor"] == "increase_limit":
                if unlimited:
                    if value is not None:
                        raise ValidationFailed("Leave the limit empty when choosing unlimited.")
                elif type(value) is not int or not 0 <= value <= 2_147_483_647:
                    raise ValidationFailed(f"Enter a whole number for {before['name']}.")
                elif row.is_unlimited or value < (row.value or 0):
                    raise ValidationFailed(
                        f"{before['name']} cannot be lowered here. A lower limit needs a "
                        "separate review of existing Portfolios and their active records."
                    )
            else:
                raise ValidationFailed("This inclusion has no plan-specific enforcement yet.")

            if row.value != value or row.is_unlimited != unlimited:
                row.value, row.is_unlimited = value, unlimited
                row.save(update_fields=["value", "is_unlimited", "updated_at"])
                changes[key] = [
                    {"value": before["value"], "unlimited": before["unlimited"]},
                    {"value": value, "unlimited": unlimited},
                ]

        if changes:
            plan.updated_at = timezone.now()
            Plan.objects.filter(pk=plan.pk).update(updated_at=plan.updated_at)
            record(
                action=AuditAction.UPDATE,
                aggregate_type="billing_plan",
                aggregate_id=plan.id,
                management_actor=request.user,
                changes=changes,
                metadata={"reason": data["reason"], "plan_code": plan.code},
            )
        return _response(_plan(plan, rows.values()))
