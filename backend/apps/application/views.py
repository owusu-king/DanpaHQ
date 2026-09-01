"""Application API.

Same two-inbox shape as viewings: what I applied for, and what has been applied
for of mine.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound
from apps.idempotency.services import idempotent_mutation

from . import services
from .models import OPEN_STATUSES, RentalApplication
from .serializers import (
    DecisionSerializer,
    RentalApplicationSerializer,
    SubmitApplicationSerializer,
)

SELECT = ("unit__property__address__locality", "unit__property__owner", "listing", "tenant")
# The photograph and the Unit's identity are read for every row, so they are
# fetched with the rows rather than one query per application.
PREFETCH = ("listing__media__file", "unit__media__file")


class MyApplicationsView(APIView):
    """GET/POST /me/applications/ — the applicant's side."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        applications = (
            RentalApplication.objects.filter(tenant=request.user, superseded_by__isnull=True)
            .select_related(*SELECT)
            .prefetch_related(*PREFETCH)
        )
        return Response(RentalApplicationSerializer(applications, many=True).data)

    @idempotent_mutation(resource_type="rental_application")
    def post(self, request):
        from apps.identity.permissions import IsPhoneVerified
        from apps.listing.models import Listing

        if not IsPhoneVerified().has_permission(request, self):
            raise NotFound("Confirm your phone number before applying for a place.")

        payload = SubmitApplicationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        listing = (
            Listing.objects.filter(id=payload.validated_data["listing_id"])
            .select_related("unit__property__address__locality", "unit__property__owner")
            .first()
        )
        if listing is None or listing.deleted_at is not None:
            raise NotFound("We could not find that listing.")

        application = services.submit_application(
            listing=listing, tenant=request.user, data=payload.validated_data
        )
        return Response(
            RentalApplicationSerializer(application).data, status=status.HTTP_201_CREATED
        )


class HostApplicationsView(APIView):
    """GET /me/received-applications/ — what has been applied for of mine."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.organization.services import properties_for_user

        applications = (
            RentalApplication.objects.filter(
                unit__property__in=properties_for_user(request.user), superseded_by__isnull=True
            )
            .select_related(*SELECT)
            .prefetch_related(*PREFETCH)
        )
        if request.query_params.get("open") == "true":
            applications = applications.filter(status__in=OPEN_STATUSES)
        return Response(RentalApplicationSerializer(applications, many=True).data)


class ApplicationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        application = services.get_application_or_404(pk)
        services.assert_participant(application, request.user)
        return Response(RentalApplicationSerializer(application).data)


class ApplicationActionView(APIView):
    permission_classes = [IsAuthenticated]

    @idempotent_mutation(resource_type="rental_application")
    def post(self, request, pk, action):
        application = services.get_application_or_404(pk)
        payload = DecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        note = payload.validated_data.get("note", "")

        if action == "review":
            application = services.start_review(application=application, user=request.user)
        elif action == "accept":
            application = services.decide(
                application=application, user=request.user, accept=True, note=note
            )
        elif action == "reject":
            application = services.decide(
                application=application, user=request.user, accept=False, note=note
            )
        elif action == "withdraw":
            application = services.withdraw(application=application, user=request.user, note=note)
        else:
            raise NotFound("Unknown action.")

        return Response(RentalApplicationSerializer(application).data)
