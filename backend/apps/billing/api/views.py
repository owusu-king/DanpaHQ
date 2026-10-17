"""The provider's view of what their Portfolio is on, and how it changes it.

Reads: the public plan catalogue and one Portfolio's billing state. Writes: a
checkout that settles through the Payments Core, and a downgrade that takes no
money. **No endpoint here activates a paid plan.** Checkout opens a
server-priced payment; the plan moves when the provider's result is confirmed
server-side — by the signed webhook, a provider query or the reconciliation
sweep — never because a browser came back from a checkout page (ADR 0032 §10).
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.idempotency.services import idempotent_mutation
from apps.organization import services as organization_services
from apps.payments.throttling import PaymentUserThrottle

from .. import catalogue
from ..models import Entitlement, Plan, PlanEntitlement
from ..policies import entitlement_policy
from ..services import checkout_service, entitlement_service, resource_access_service


class PlanCatalogueView(APIView):
    """The public comparison. Three plans, priced from the database."""

    permission_classes = [AllowAny]

    def get(self, request):
        plans = list(Plan.objects.filter(is_active=True, is_public=True).order_by("display_order"))
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
                "recommended_plan": (
                    catalogue.RECOMMENDED_PLAN
                    if any(plan.code == catalogue.RECOMMENDED_PLAN for plan in plans)
                    else None
                ),
                "plans": [
                    {
                        "code": plan.code,
                        "name": plan.name,
                        "description": plan.description,
                        "monthly_price_minor": plan.monthly_price_minor,
                        "annual_price_minor": plan.annual_price_minor,
                        "currency": plan.monthly_price_currency,
                        "entitlements": {key: _value(values.get((plan.id, key))) for key in keys},
                        # Only what this plan actually grants, so moving a
                        # capability off a plan removes its highlight too.
                        "highlights": [
                            key
                            for key in catalogue.PLAN_HIGHLIGHTS.get(plan.code, [])
                            if key in rows and _granted(values.get((plan.id, key)))
                        ],
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


def _granted(row: PlanEntitlement | None) -> bool:
    return row is not None and bool(row.is_unlimited or row.value)


def _portfolio(request, pk, permission: str):
    organization = organization_services.get_organization_or_404(pk, request.user)
    entitlement_policy.assert_can(
        organization=organization, user=request.user, permission=permission
    )
    return organization


def _private(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


def _billing(organization, user, *, status_code: int = status.HTTP_200_OK) -> Response:
    """Everything Plan & billing renders, in one read.

    The same data the backend enforces with, plus what this viewer may do and
    what is happening to this Portfolio's money. The client renders from it and
    never decides with it.
    """
    return _private(
        Response(
            {
                **entitlement_service.snapshot(organization=organization),
                **checkout_service.overview(organization=organization, user=user),
            },
            status=status_code,
        )
    )


class PortfolioBillingView(APIView):
    """Plan, subscription, usage, invoices and what this viewer may change."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        organization = _portfolio(request, pk, entitlement_policy.VIEW)
        return _billing(organization, request.user)


class PlanChangeQuoteView(APIView):
    """What a move to another plan would cost, credit and do. Changes nothing."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        organization = _portfolio(request, pk, entitlement_policy.VIEW)
        offer = checkout_service.quote(
            organization=organization,
            plan_code=request.query_params.get("plan", ""),
            interval=request.query_params.get("interval", "monthly"),
        )
        return _private(Response(checkout_service.quote_payload(offer)))


class CheckoutView(APIView):
    """Open the payment for an upgrade or renewal. The plan does not move here."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [PaymentUserThrottle]

    @idempotent_mutation(required=True, resource_type="billing_checkout", external_calls=True)
    def post(self, request, pk):
        organization = _portfolio(request, pk, entitlement_policy.CHANGE_PLAN)
        intent = checkout_service.start_checkout(
            organization=organization,
            user=request.user,
            plan_code=str(request.data.get("plan_code", "")),
            interval=str(request.data.get("billing_interval", "")),
            payment_method=str(request.data.get("payment_method", "")),
        )
        return _private(
            Response(checkout_service.checkout_payload(intent), status=status.HTTP_201_CREATED)
        )


class CheckoutDetailView(APIView):
    """What Danpa HQ currently knows about one subscription payment. No provider call."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk, intent_pk):
        organization = _portfolio(request, pk, entitlement_policy.CHANGE_PLAN)
        intent = checkout_service.checkout_intent(organization=organization, intent_id=intent_pk)
        return _private(Response(checkout_service.checkout_payload(intent)))


class CheckoutRefreshView(APIView):
    """Ask the provider after checkout. The client supplies no financial facts."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [PaymentUserThrottle]

    @idempotent_mutation(required=True, resource_type="billing_checkout", external_calls=True)
    def post(self, request, pk, intent_pk):
        organization = _portfolio(request, pk, entitlement_policy.CHANGE_PLAN)
        intent = checkout_service.refresh_checkout(
            organization=organization, user=request.user, intent_id=intent_pk
        )
        return _private(Response(checkout_service.checkout_payload(intent)))


class CheckoutRetryView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [PaymentUserThrottle]

    @idempotent_mutation(required=True, resource_type="billing_checkout", external_calls=True)
    def post(self, request, pk, intent_pk):
        organization = _portfolio(request, pk, entitlement_policy.CHANGE_PLAN)
        intent = checkout_service.retry_checkout(
            organization=organization, user=request.user, intent_id=intent_pk
        )
        return _private(Response(checkout_service.checkout_payload(intent)))


class CheckoutCancelView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [PaymentUserThrottle]

    @idempotent_mutation(required=True, resource_type="billing_checkout", external_calls=True)
    def post(self, request, pk, intent_pk):
        organization = _portfolio(request, pk, entitlement_policy.CHANGE_PLAN)
        intent = checkout_service.cancel_checkout(
            organization=organization, user=request.user, intent_id=intent_pk
        )
        return _private(Response(checkout_service.checkout_payload(intent)))


class PlanChangeView(APIView):
    """Move to a cheaper plan: now, or when the paid period ends. Takes no money."""

    permission_classes = [IsAuthenticated]

    @idempotent_mutation(required=True, resource_type="billing_subscription")
    def post(self, request, pk):
        organization = _portfolio(request, pk, entitlement_policy.CHANGE_PLAN)
        checkout_service.change_plan_without_payment(
            organization=organization,
            user=request.user,
            plan_code=str(request.data.get("plan_code", "")),
            # `{"property_ids": [...], "unit_ids": [...]}` — what to keep fully
            # active if the move takes the Portfolio above the plan's allowance.
            # Absent, the documented fallback decides; the client never does.
            keep_active=request.data.get("keep_active"),
        )
        return _billing(organization, request.user)


class KeepPlanView(APIView):
    """Undo a scheduled downgrade or cancellation before the period ends."""

    permission_classes = [IsAuthenticated]

    @idempotent_mutation(required=True, resource_type="billing_subscription")
    def post(self, request, pk):
        organization = _portfolio(request, pk, entitlement_policy.CHANGE_PLAN)
        checkout_service.keep_current_plan(organization=organization, user=request.user)
        return _billing(organization, request.user)


class ResourceReactivateView(APIView):
    """Bring restricted properties or units back into full use, as far as the plan has room.

    The only way anything restricted becomes fully active again: an upgrade or a
    freed place makes it eligible, and this is the deliberate step after that.
    """

    permission_classes = [IsAuthenticated]

    @idempotent_mutation(required=True, resource_type="billing_resource_access")
    def post(self, request, pk):
        organization = _portfolio(request, pk, entitlement_policy.CHANGE_PLAN)
        resource_access_service.reactivate(
            organization=organization,
            user=request.user,
            property_ids=request.data.get("property_ids"),
            unit_ids=request.data.get("unit_ids"),
        )
        return _billing(organization, request.user)
