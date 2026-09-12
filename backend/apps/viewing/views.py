"""Viewing API.

Two inboxes, one resource. A tenant sees the viewings they asked for; a landlord
or agent sees the ones asked of them. They are separate endpoints rather than a
filtered one because they answer different questions and are read at different
moments.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound
from apps.idempotency.services import idempotent_mutation

from . import services
from .models import OPEN_STATUSES, ViewingRequest
from .serializers import (
    AttendanceReportSerializer,
    AttendanceResponseSerializer,
    CancelAppointmentSerializer,
    ConfirmSlotSerializer,
    NoteSerializer,
    OfferSlotsSerializer,
    OutcomeSerializer,
    PostViewingActionSerializer,
    RequestViewingSerializer,
    ValidateCheckInSerializer,
    ViewingRequestSerializer,
)
from .throttling import ViewingCheckInIpThrottle, ViewingCheckInUserThrottle

BASE_SELECT = (
    "listing__unit__property__address__locality",
    "listing__unit__property__owner",
    "tenant",
    "confirmed_slot",
    "responded_by",
    "current_appointment",
)


class MyViewingsView(APIView):
    """GET/POST /me/viewings/ — the tenant's side."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        viewings = (
            ViewingRequest.objects.filter(tenant=request.user)
            .select_related(*BASE_SELECT)
            .prefetch_related(
                "slots",
                "appointments",
                "listing__media__file",
                "listing__unit__media__file",
            )
        )
        return Response(
            ViewingRequestSerializer(viewings, many=True, context={"request": request}).data
        )

    @idempotent_mutation(resource_type="viewing_request")
    def post(self, request):
        from apps.identity.permissions import IsPhoneVerified
        from apps.listing.models import Listing

        # Phone verification is checked here rather than as a class permission
        # so the module graph stays acyclic - viewing must not import identity
        # at module level.
        if not IsPhoneVerified().has_permission(request, self):
            raise NotFound("Confirm your phone number before asking to view a place.")

        payload = RequestViewingSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        listing = (
            Listing.objects.filter(id=payload.validated_data["listing_id"])
            .select_related("unit__property__address__locality", "unit__property__owner")
            .first()
        )
        if listing is None or listing.deleted_at is not None:
            raise NotFound("We could not find that listing.")

        viewing = services.request_viewing(
            listing=listing,
            tenant=request.user,
            message=payload.validated_data.get("message", ""),
            availability_note=payload.validated_data.get("availability_note", ""),
        )
        return Response(
            ViewingRequestSerializer(viewing, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class HostViewingsView(APIView):
    """GET /me/viewing-requests/ — what tenants have asked of me."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        """`?organization=<id>` scopes this to one Portfolio, decided here."""
        from apps.organization.services import properties_in_scope

        viewings = (
            ViewingRequest.objects.filter(
                listing__unit__property__in=properties_in_scope(
                    user=request.user, organization=request.query_params.get("organization")
                )
            )
            .select_related(*BASE_SELECT)
            .prefetch_related(
                "slots",
                "appointments",
                "listing__media__file",
                "listing__unit__media__file",
            )
        )
        if request.query_params.get("open") == "true":
            viewings = viewings.filter(status__in=OPEN_STATUSES)
        return Response(
            ViewingRequestSerializer(viewings, many=True, context={"request": request}).data
        )


class ViewingDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        viewing = services.get_request_or_404(pk)
        services.assert_participant(viewing, request.user)
        return Response(ViewingRequestSerializer(viewing, context={"request": request}).data)


class ViewingCheckInCredentialView(APIView):
    """Issue secrets without the response-replay store retaining plaintext.

    Repeating this request rotates the QR/code pair. That is safer than applying
    the general idempotency decorator, whose durable response body is correct
    for ordinary mutations but inappropriate for temporary credentials.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        viewing = services.get_request_or_404(pk)
        return Response(services.issue_check_in_credential(request=viewing, user=request.user))


class ViewingActionView(APIView):
    """POST /viewings/<id>/<action>/ — one endpoint per transition.

    Named actions rather than a PATCH of `status`: the transitions have
    different inputs and different rules, and a client that can write any status
    it likes will eventually write the wrong one.
    """

    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        if self.kwargs.get("action") == "check-in":
            return [ViewingCheckInUserThrottle(), ViewingCheckInIpThrottle()]
        return super().get_throttles()

    @idempotent_mutation(resource_type="viewing_request")
    def post(self, request, pk, action):
        viewing = services.get_request_or_404(pk)
        handler = getattr(self, f"_{action.replace('-', '_')}", None)
        if handler is None:
            raise NotFound("Unknown action.")
        result = handler(request, viewing)
        if isinstance(result, dict):
            return Response(result)
        # Transition services may update prefetched slots/appointment rows.
        # Reload before serializing so an API response never returns the
        # pre-transition relation cache (especially after a reschedule).
        result = services.get_request_or_404(result.id)
        return Response(ViewingRequestSerializer(result, context={"request": request}).data)

    def _offer(self, request, viewing):
        payload = OfferSlotsSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.offer_slots(
            request=viewing,
            user=request.user,
            slots=payload.validated_data["slots"],
        )

    def _reschedule(self, request, viewing):
        payload = OfferSlotsSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.reschedule(
            request=viewing, user=request.user, slots=payload.validated_data["slots"]
        )

    def _decline(self, request, viewing):
        payload = NoteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.decline(
            request=viewing, user=request.user, note=payload.validated_data.get("note", "")
        )

    def _withdraw(self, request, viewing):
        payload = NoteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.withdraw(
            request=viewing, user=request.user, note=payload.validated_data.get("note", "")
        )

    def _confirm(self, request, viewing):
        payload = ConfirmSlotSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.confirm_slot(
            request=viewing, user=request.user, slot_id=payload.validated_data["slot_id"]
        )

    def _cancel(self, request, viewing):
        payload = CancelAppointmentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.cancel(
            request=viewing,
            user=request.user,
            reason=payload.validated_data["reason"],
            note=payload.validated_data.get("note", ""),
        )

    def _attendance_report(self, request, viewing):
        payload = AttendanceReportSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.report_no_show(
            request=viewing, user=request.user, note=payload.validated_data.get("note", "")
        )

    def _attendance_response(self, request, viewing):
        payload = AttendanceResponseSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.respond_to_attendance(
            request=viewing,
            user=request.user,
            response=payload.validated_data["response"],
            note=payload.validated_data.get("note", ""),
        )

    def _outcome(self, request, viewing):
        payload = OutcomeSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.record_outcome(
            request=viewing,
            user=request.user,
            outcome=payload.validated_data["outcome"],
            note=payload.validated_data.get("note", ""),
        )

    def _check_in(self, request, viewing):
        payload = ValidateCheckInSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.validate_check_in(
            request=viewing,
            user=request.user,
            credential=payload.validated_data.get("credential", ""),
            code=payload.validated_data.get("code", ""),
        )

    def _post_viewing(self, request, viewing):
        payload = PostViewingActionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return services.record_tenant_follow_up(
            request=viewing,
            user=request.user,
            action=payload.validated_data["action"],
            report_category=payload.validated_data.get("report_category", ""),
            details=payload.validated_data.get("details", ""),
        )
