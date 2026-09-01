"""The provider's view of what their Portfolio is on.

Read-only in this slice, plus the plan comparison. Paid checkout is the next
phase and goes through the Payments Core; there is deliberately no endpoint here
that activates a paid plan, because activating one without confirmed payment is
exactly the mistake the payment architecture spent its effort preventing.
"""

from __future__ import annotations

from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.organization import services as organization_services

from .. import catalogue
from ..models import Entitlement, Plan, PlanEntitlement
from ..policies import entitlement_policy
from ..services import entitlement_service


class PlanCatalogueView(APIView):
    """The public comparison. Three plans, priced from the database."""

    permission_classes = [AllowAny]

    def get(self, request):
        plans = Plan.objects.filter(is_active=True, is_public=True).order_by("display_order")
        values = {
            (row.plan_id, row.entitlement.key): row
            for row in PlanEntitlement.objects.select_related("entitlement", "plan")
        }
        rows = {row.key: row for row in Entitlement.objects.all()}
        layout = catalogue.entitlement_layout(rows.keys())
        keys = [item["key"] for item in layout]

        return Response(
            {
                # The names and the grouping travel with the data, so a client
                # never hardcodes "Properties" or decides which section a
                # capability belongs to. Renaming an entitlement or moving it
                # between sections stays a change here, not a release of three
                # frontends.
                "entitlements": [
                    {
                        "key": item["key"],
                        "group": item["group"],
                        "name": rows[item["key"]].name,
                        "description": rows[item["key"]].description,
                        "value_type": rows[item["key"]].value_type,
                    }
                    for item in layout
                ],
                "groups": _groups_in_order(layout),
                "headline_limits": [key for key in catalogue.HEADLINE_LIMITS if key in rows],
                "upgrade_order": catalogue.UPGRADE_ORDER,
                "plans": [
                    {
                        "code": plan.code,
                        "name": plan.name,
                        "description": plan.description,
                        "monthly_price_minor": plan.monthly_price_minor,
                        "annual_price_minor": plan.annual_price_minor,
                        "currency": plan.monthly_price_currency,
                        "entitlements": {key: _value(values.get((plan.id, key))) for key in keys},
                    }
                    for plan in plans
                ],
            }
        )


def _groups_in_order(layout: list[dict]) -> list[str]:
    seen = []
    for item in layout:
        if item["group"] not in seen:
            seen.append(item["group"])
    return seen


def _value(row: PlanEntitlement | None) -> dict:
    if row is None:
        return {"value": None, "unlimited": False}
    return {"value": None if row.is_unlimited else row.value, "unlimited": row.is_unlimited}


class PortfolioBillingView(APIView):
    """Plan, usage and entitlements for one Portfolio, in one read.

    The same resolution the backend enforces with. A client renders from this
    and never decides with it: every limit and capability is checked again on
    the server at the moment of the write, which is why the enforcement lives in
    `billing.enforcement` rather than in a serializer.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        organization = organization_services.get_organization_or_404(pk, request.user)
        entitlement_policy.assert_can(
            organization=organization,
            user=request.user,
            permission=entitlement_policy.VIEW,
        )
        response = Response(entitlement_service.snapshot(organization=organization))
        response["Cache-Control"] = "private, no-store"
        return response
