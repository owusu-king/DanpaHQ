"""Rent API."""

from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound
from apps.idempotency.services import idempotent_mutation

from . import services
from .models import PropertyExpense, RentCharge, RentPayment
from .serializers import (
    ObligationAdjustmentRequestSerializer,
    PropertyExpenseSerializer,
    ReasonSerializer,
    RecordExpenseSerializer,
    RecordPaymentSerializer,
    RentalHistorySerializer,
    RentChargeSerializer,
    RentPaymentSerializer,
)


class OrganizationExpenseView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, organization_pk):
        from apps.organization.services import (
            get_organization_or_404,
            properties_for_organization_member,
        )

        organization = get_organization_or_404(organization_pk, request.user)
        properties = properties_for_organization_member(
            organization=organization, user=request.user
        )
        rows = PropertyExpense.objects.filter(
            organization=organization, property__in=properties
        ).select_related("property", "recorded_by")[:100]
        return Response(PropertyExpenseSerializer(rows, many=True).data)

    @idempotent_mutation(resource_type="property_expense")
    def post(self, request, organization_pk):
        from apps.organization.services import get_organization_or_404
        from apps.property.models import Property

        organization = get_organization_or_404(organization_pk, request.user)
        payload = RecordExpenseSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        prop = Property.objects.filter(id=payload.validated_data["property_id"]).first()
        if prop is None:
            raise NotFound("We could not find that property.")
        expense = services.record_expense(
            organization=organization,
            prop=prop,
            user=request.user,
            data=payload.validated_data,
        )
        return Response(PropertyExpenseSerializer(expense).data, status=status.HTTP_201_CREATED)


def _lease_or_404(pk, user):
    from apps.lease.models import Lease

    lease = (
        Lease.objects.filter(id=pk)
        .select_related(
            "unit__property__owner",
            "unit__property__address__locality__district__region",
            "tenant",
            "landlord",
            "tenancy",
        )
        .first()
    )
    if lease is None:
        raise NotFound("We could not find that tenancy.")
    services.assert_party(lease, user)
    return lease


class LeaseChargesView(APIView):
    """GET /leases/<id>/charges/ — what this tenancy owes and has paid."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        lease = _lease_or_404(pk, request.user)
        charges = RentCharge.objects.filter(lease=lease).prefetch_related(
            "adjustments__actor", "payments"
        )
        payments = RentPayment.objects.filter(lease=lease).select_related(
            "recorded_by",
            "confirmed_by",
            "charge",
            "evidence_file",
            "external_receipt",
            "provider_transaction__receipt",
        )
        permissions = _obligation_permissions(lease=lease, user=request.user)
        prop = lease.unit.property
        address = getattr(prop, "address", None)
        return Response(
            {
                "charges": RentChargeSerializer(charges, many=True).data,
                "payments": RentPaymentSerializer(
                    payments, many=True, context={"request": request}
                ).data,
                "digital_payment": _digital_payment_availability(lease=lease, user=request.user),
                "permissions": permissions,
                "context": {
                    "lease_status": lease.status,
                    "lease_status_display": lease.get_status_display(),
                    "tenancy_id": str(lease.tenancy_id) if lease.tenancy_id else None,
                    "tenant_name": lease.tenant.display_name,
                    "property_title": prop.title,
                    "unit_label": lease.unit.label,
                    "location": address.locality_label if address else "",
                    "ended_on": lease.ended_on,
                },
                "financial_summary": services.closing_financial_summary(lease=lease),
            }
        )


def _obligation_permissions(*, lease, user) -> dict:
    from apps.property.capabilities import PropertyCapability, property_capabilities

    from .permissions import ObligationCapability, can_adjust_obligation

    is_tenant = str(lease.tenant_id) == str(user.id)
    sample = (
        RentCharge.objects.filter(lease=lease)
        .select_related("lease__landlord", "lease__unit__property")
        .first()
    )
    external_recording = (
        property_capabilities(prop=lease.unit.property, user=user)[PropertyCapability.LEASES.value][
            "allowed"
        ]
        if not is_tenant
        else False
    )
    return {
        "record_payment": external_recording,
        "waive": bool(sample)
        and can_adjust_obligation(charge=sample, user=user, capability=ObligationCapability.WAIVE),
        "write_off": bool(sample)
        and can_adjust_obligation(
            charge=sample, user=user, capability=ObligationCapability.WRITE_OFF
        ),
    }


def _digital_payment_availability(*, lease, user) -> dict:
    # Imported at the read-model boundary to keep Rent's services independent
    # of the payment implementation that consumes its obligations.
    from apps.payments.services import digital_payment_availability

    return digital_payment_availability(lease=lease, user=user)


class RecordPaymentView(APIView):
    """POST /rent/payments/ — say money changed hands."""

    permission_classes = [IsAuthenticated]

    @idempotent_mutation(resource_type="rent_payment")
    def post(self, request):
        payload = RecordPaymentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        lease = _lease_or_404(payload.validated_data["lease_id"], request.user)
        payment = services.record_payment(
            lease=lease, user=request.user, data=payload.validated_data
        )
        return Response(
            RentPaymentSerializer(payment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class PaymentActionView(APIView):
    """POST /rent/payments/<id>/confirm|dispute/"""

    permission_classes = [IsAuthenticated]

    @idempotent_mutation(resource_type="rent_payment")
    def post(self, request, pk, action):
        payment = services.get_payment_or_404(pk)
        payload = ReasonSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        if action == "confirm":
            payment = services.confirm_payment(payment=payment, user=request.user)
        elif action == "dispute":
            payment = services.dispute_payment(
                payment=payment,
                user=request.user,
                reason=payload.validated_data.get("reason", ""),
            )
        else:
            raise NotFound("Unknown action.")

        return Response(RentPaymentSerializer(payment, context={"request": request}).data)


class WaiveChargeView(APIView):
    permission_classes = [IsAuthenticated]

    @idempotent_mutation(resource_type="rent_charge")
    def post(self, request, pk):
        charge = (
            RentCharge.objects.filter(id=pk).select_related("lease__unit__property__owner").first()
        )
        if charge is None:
            raise NotFound("We could not find that charge.")

        payload = ObligationAdjustmentRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        charge = services.waive_charge(
            charge=charge,
            user=request.user,
            reason=payload.validated_data["reason"],
            amount_minor=payload.validated_data["amount_minor"],
        )
        return Response(RentChargeSerializer(charge).data)


class WriteOffChargeView(APIView):
    permission_classes = [IsAuthenticated]

    @idempotent_mutation(resource_type="rent_charge")
    def post(self, request, pk):
        charge = (
            RentCharge.objects.filter(id=pk)
            .select_related("lease__unit__property__owner", "lease__landlord")
            .first()
        )
        if charge is None:
            raise NotFound("We could not find that charge.")
        payload = ObligationAdjustmentRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        charge = services.write_off_charge(
            charge=charge,
            user=request.user,
            reason=payload.validated_data["reason"],
            amount_minor=payload.validated_data["amount_minor"],
        )
        return Response(RentChargeSerializer(charge).data)


class RentalHistoryView(APIView):
    """GET /me/rental-history/ — the record a tenant can show a future landlord."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        history = services.rental_history(user=request.user)
        return Response(RentalHistorySerializer(history).data)
