from __future__ import annotations

from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound
from apps.idempotency.services import idempotent_mutation
from apps.identity.permissions import IsPhoneVerified
from apps.organization import services as organization_services
from apps.rent.models import RentCharge

from . import payouts, services
from .models import PayoutProvisioningStatus
from .serializers import (
    CreatePaymentIntentSerializer,
    PaymentIntentSerializer,
    PayoutInstitutionQuerySerializer,
    PayoutProfileSerializer,
    PayoutProvisioningOperationSerializer,
    ProvisionPayoutDestinationSerializer,
    ReceiptSerializer,
    ResolvePayoutAccountSerializer,
)
from .throttling import PaymentUserThrottle, PaymentWebhookIpThrottle


class PaymentIntentListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [PaymentUserThrottle]

    def get(self, request):
        rows = services.intents_for(user=request.user)
        return Response(PaymentIntentSerializer(rows, many=True).data)

    @idempotent_mutation(required=True, resource_type="payment_intent", external_calls=True)
    def post(self, request):
        payload = CreatePaymentIntentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        obligation = RentCharge.objects.filter(id=payload.validated_data["obligation_id"]).first()
        if obligation is None:
            raise NotFound("We could not find that payment obligation.")
        intent = services.create_intent(
            obligation=obligation,
            user=request.user,
            payment_method=payload.validated_data["payment_method"],
            amount_minor=payload.validated_data.get("amount_minor"),
        )
        return Response(PaymentIntentSerializer(intent).data, status=status.HTTP_201_CREATED)


class PaymentIntentDetailView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [PaymentUserThrottle]

    def get(self, request, pk):
        intent = services.get_intent_or_404(pk, user=request.user)
        return Response(PaymentIntentSerializer(intent).data)


class PaymentIntentRetryView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [PaymentUserThrottle]

    @idempotent_mutation(required=True, resource_type="payment_intent", external_calls=True)
    def post(self, request, pk):
        intent = services.get_intent_or_404(pk, user=request.user)
        services.retry_intent(intent=intent, user=request.user)
        intent.refresh_from_db()
        return Response(PaymentIntentSerializer(intent).data)


class PaymentIntentRefreshView(APIView):
    """Query the PSP after checkout; the client supplies no financial facts."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [PaymentUserThrottle]

    @idempotent_mutation(required=True, resource_type="payment_intent", external_calls=True)
    def post(self, request, pk):
        intent = services.get_intent_or_404(pk, user=request.user)
        intent = services.refresh_intent_from_provider(intent=intent, user=request.user)
        return Response(PaymentIntentSerializer(intent).data)


class ReceiptDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        receipt = services.get_receipt_or_404(pk, user=request.user)
        return Response(ReceiptSerializer(receipt).data)


class ReceiptDocumentView(APIView):
    """The exact PDF frozen when the processor-confirmed receipt was issued."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        receipt = services.get_receipt_or_404(pk, user=request.user)
        if not receipt.final_pdf:
            raise NotFound("The final receipt document is not available.")
        inline = request.query_params.get("disposition") == "inline"
        disposition = "inline" if inline else "attachment"
        filename = f"rooomly-receipt-{receipt.receipt_number}.pdf"
        response = HttpResponse(bytes(receipt.final_pdf), content_type="application/pdf")
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        response["ETag"] = f'"{receipt.final_pdf_hash}"'
        response["X-Content-Type-Options"] = "nosniff"
        return response


class PaymentWebhookView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [PaymentWebhookIpThrottle]

    def post(self, request, provider):
        intent = services.process_webhook(
            provider_name=provider,
            raw_body=request.body,
            headers=request.headers,
        )
        if intent is None:
            # Authenticated but not about a Rooomly payment. Acknowledged so the
            # provider stops retrying it; recorded so it is still evidence.
            return Response({"received": True, "ignored": True})
        return Response({"received": True, "intent_status": intent.status})


class OrganizationPayoutDestinationView(APIView):
    """Owner/admin-only Paystack subaccount setup and recovery state."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]
    throttle_classes = [PaymentUserThrottle]

    def get(self, request, pk):
        organization = organization_services.get_organization_or_404(pk, request.user)
        profile, profiles, operation = payouts.payout_destination_state(
            organization=organization,
            user=request.user,
        )
        response = Response(_payout_destination_payload(profile, profiles, operation))
        response["Cache-Control"] = "private, no-store"
        return response

    def post(self, request, pk):
        organization = organization_services.get_organization_or_404(pk, request.user)
        payload = ProvisionPayoutDestinationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        operation, _, replayed = payouts.provision_paystack_subaccount_idempotently(
            organization=organization,
            user=request.user,
            method=payload.validated_data["method"],
            bank_code=payload.validated_data["bank_code"],
            account_number=payload.validated_data["account_number"],
            idempotency_key=request.headers.get("Idempotency-Key", ""),
            request=request,
        )
        profile, profiles, _ = payouts.payout_destination_state(
            organization=organization,
            user=request.user,
        )
        completed = operation.status == PayoutProvisioningStatus.SUCCEEDED
        response = Response(
            _payout_destination_payload(profile, profiles, operation),
            status=(
                status.HTTP_200_OK
                if replayed and completed
                else status.HTTP_201_CREATED
                if completed
                else status.HTTP_202_ACCEPTED
            ),
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Idempotency-Key"] = operation.idempotency_key
        if replayed:
            response["X-Idempotent-Replay"] = "true"
        return response


class OrganizationPayoutInstitutionView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]
    throttle_classes = [PaymentUserThrottle]

    def get(self, request, pk):
        organization = organization_services.get_organization_or_404(pk, request.user)
        query = PayoutInstitutionQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        rows = payouts.payout_institutions(
            organization=organization,
            user=request.user,
            method=query.validated_data["method"],
        )
        response = Response({"results": rows})
        response["Cache-Control"] = "private, max-age=300"
        return response


class OrganizationPayoutVerificationRefreshView(APIView):
    """Recheck an existing subaccount; the client never supplies the decision."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]
    throttle_classes = [PaymentUserThrottle]

    def post(self, request, pk):
        organization = organization_services.get_organization_or_404(pk, request.user)
        payouts.refresh_payout_verification(
            organization=organization,
            user=request.user,
        )
        profile, profiles, operation = payouts.payout_destination_state(
            organization=organization,
            user=request.user,
        )
        response = Response(_payout_destination_payload(profile, profiles, operation))
        response["Cache-Control"] = "private, no-store"
        return response


class OrganizationPayoutProfileVerificationRefreshView(APIView):
    """Recheck one saved destination, including an inactive candidate."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]
    throttle_classes = [PaymentUserThrottle]

    def post(self, request, pk, profile_pk):
        organization = organization_services.get_organization_or_404(pk, request.user)
        payouts.refresh_payout_verification(
            organization=organization,
            user=request.user,
            profile_id=profile_pk,
        )
        profile, profiles, operation = payouts.payout_destination_state(
            organization=organization,
            user=request.user,
        )
        response = Response(_payout_destination_payload(profile, profiles, operation))
        response["Cache-Control"] = "private, no-store"
        return response


class OrganizationPayoutProfileActivateView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]
    throttle_classes = [PaymentUserThrottle]

    def post(self, request, pk, profile_pk):
        organization = organization_services.get_organization_or_404(pk, request.user)
        payouts.activate_payout_destination(
            organization=organization,
            user=request.user,
            profile_id=profile_pk,
            request=request,
        )
        profile, profiles, operation = payouts.payout_destination_state(
            organization=organization,
            user=request.user,
        )
        response = Response(_payout_destination_payload(profile, profiles, operation))
        response["Cache-Control"] = "private, no-store"
        return response


class OrganizationPayoutProfileDetailView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]
    throttle_classes = [PaymentUserThrottle]

    def delete(self, request, pk, profile_pk):
        organization = organization_services.get_organization_or_404(pk, request.user)
        payouts.remove_payout_destination(
            organization=organization,
            user=request.user,
            profile_id=profile_pk,
            request=request,
        )
        profile, profiles, operation = payouts.payout_destination_state(
            organization=organization,
            user=request.user,
        )
        response = Response(_payout_destination_payload(profile, profiles, operation))
        response["Cache-Control"] = "private, no-store"
        return response


class OrganizationPayoutAccountResolveView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]
    throttle_classes = [PaymentUserThrottle]

    def post(self, request, pk):
        organization = organization_services.get_organization_or_404(pk, request.user)
        payload = ResolvePayoutAccountSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        result = payouts.resolve_payout_account(
            organization=organization,
            user=request.user,
            method=payload.validated_data["method"],
            bank_code=payload.validated_data["bank_code"],
            account_number=payload.validated_data["account_number"],
        )
        response = Response(result)
        response["Cache-Control"] = "private, no-store"
        return response


def _payout_destination_payload(profile, profiles, operation) -> dict:
    return {
        # `profile` remains a compatibility alias for clients released before
        # multiple receiving accounts. Both aliases mean the selected account.
        "profile": PayoutProfileSerializer(profile).data if profile is not None else None,
        "active_profile": (PayoutProfileSerializer(profile).data if profile is not None else None),
        "profiles": PayoutProfileSerializer(profiles, many=True).data,
        "provisioning": (
            PayoutProvisioningOperationSerializer(operation).data if operation is not None else None
        ),
    }
