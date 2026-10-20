"""Maintenance API.

Tenant:   ``GET/POST /me/maintenance/`` — their requests, and reporting one.
Provider: ``GET /organizations/<id>/maintenance/`` — requests on the Portfolio's
          properties this member can see.
Both:     ``GET /maintenance/<id>/`` and the four moves on it; the service decides
          which side may make which move.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.idempotency.services import idempotent_mutation

from . import services
from .models import OPEN_STATUSES, MaintenanceStatus
from .serializers import (
    MaintenanceRequestSerializer,
    NoteSerializer,
    ReasonSerializer,
    SubmitRequestSerializer,
)

_RELATED = ("tenant", "property", "unit", "bed", "photo", "video")


def _filtered(rows, request):
    """``?status=open`` for everything unfinished, or one status by name."""
    wanted = request.query_params.get("status", "")
    if wanted == "open":
        return rows.filter(status__in=OPEN_STATUSES)
    if wanted in MaintenanceStatus.values:
        return rows.filter(status=wanted)
    return rows


def _rows(rows, request):
    rows = _filtered(rows, request).select_related(*_RELATED).prefetch_related("events__actor")
    return MaintenanceRequestSerializer(rows[:200], many=True).data


class MyMaintenanceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(_rows(services.for_tenant(user=request.user), request))

    @idempotent_mutation(resource_type="maintenance_request")
    def post(self, request):
        payload = SubmitRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        created = services.submit_request(user=request.user, **payload.validated_data)
        fresh = services.get_visible(request_id=created.id, user=request.user)
        return Response(MaintenanceRequestSerializer(fresh).data, status=status.HTTP_201_CREATED)


class OrganizationMaintenanceView(APIView):
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
        return Response(_rows(services.for_properties(properties=properties), request))


class MaintenanceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        found = services.get_visible(request_id=pk, user=request.user)
        return Response(
            {
                **MaintenanceRequestSerializer(found).data,
                # What this reader may do now, so neither client re-derives the
                # rules (and gets them wrong).
                "permissions": _permissions(found, request.user),
                "artisans": _artisans(found, request.user),
            }
        )


def _artisans(found, user) -> dict:
    """Invitations, quotes and the assignment, as this reader may see them."""
    from apps.artisan.work import work_for

    return work_for(found, user)


def _permissions(found, user) -> dict:
    provider = services.is_provider_for(request=found, user=user)
    tenant = str(found.tenant_id) == str(user.id)
    return {
        "start": provider
        and found.status in (MaintenanceStatus.SUBMITTED, MaintenanceStatus.REOPENED),
        "report_fixed": provider and found.status == MaintenanceStatus.IN_PROGRESS,
        "confirm": tenant and found.status == MaintenanceStatus.AWAITING_TENANT_CONFIRMATION,
        "reopen": tenant and found.status == MaintenanceStatus.AWAITING_TENANT_CONFIRMATION,
    }


class _ActionView(APIView):
    permission_classes = [IsAuthenticated]
    payload_class = NoteSerializer

    def act(self, found, user, data):  # pragma: no cover - overridden
        raise NotImplementedError

    @idempotent_mutation(resource_type="maintenance_request")
    def post(self, request, pk):
        found = services.get_visible(request_id=pk, user=request.user)
        payload = self.payload_class(data=request.data)
        payload.is_valid(raise_exception=True)
        self.act(found, request.user, payload.validated_data)
        fresh = services.get_visible(request_id=pk, user=request.user)
        return Response(
            {
                **MaintenanceRequestSerializer(fresh).data,
                "permissions": _permissions(fresh, request.user),
                "artisans": _artisans(fresh, request.user),
            }
        )


class StartWorkView(_ActionView):
    def act(self, found, user, data):
        services.start_work(request=found, user=user, note=data.get("note", ""))


class ReportFixedView(_ActionView):
    def act(self, found, user, data):
        services.report_fixed(request=found, user=user, note=data.get("note", ""))


class ConfirmFixedView(_ActionView):
    def act(self, found, user, data):
        services.confirm_fixed(request=found, user=user)


class ReopenView(_ActionView):
    payload_class = ReasonSerializer

    def act(self, found, user, data):
        services.reopen(request=found, user=user, reason=data["reason"])
