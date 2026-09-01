"""Endpoints for archiving, restoring and removing property and space.

Thin by design: the view parses, the policy decides, the service performs and
records. A view that decided for itself would be the second opinion ADR 0021
exists to prevent.

`reason` and `confirmed` come from the client because the *policy* asked for
them — `permitted_actions` on the record says which are required, so the
interface knows what to collect before it calls.
"""

from __future__ import annotations

from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound

from . import lifecycle
from .models import Property, Unit
from .serializers import PropertySerializer


class TransitionSerializer(serializers.Serializer):
    """What a consequential action carries with it."""

    reason = serializers.CharField(required=False, allow_blank=True, max_length=400)
    #: Defaults to False so a client that forgets is refused rather than
    #: silently confirming on the person's behalf.
    confirmed = serializers.BooleanField(default=False)


def _property_or_404(pk) -> Property:
    prop = Property.all_objects.filter(pk=pk).first()
    if prop is None:
        raise NotFound("That property does not exist.")
    return prop


def _space_or_404(pk) -> Unit:
    unit = Unit.objects.filter(pk=pk).first()
    if unit is None:
        raise NotFound("That space does not exist.")
    return unit


class MyArchiveView(APIView):
    """GET /me/archive — authorized, reversible provider inventory history."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        response = Response(lifecycle.archived_resources_for(actor=request.user))
        response["Cache-Control"] = "private, no-store"
        return response


class PropertyArchiveView(APIView):
    """POST /properties/{id}/archive — take it out of the workspace.

    DELETE on the same path removes it, and only ever for a property with no
    history. The split is deliberate: two different acts should not share a
    verb, because one is reversible and the other is not.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        payload = TransitionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        prop = _property_or_404(pk)

        lifecycle.archive_property(
            prop=prop,
            actor=request.user,
            reason=payload.validated_data.get("reason", ""),
            confirmed=payload.validated_data["confirmed"],
        )
        return Response(PropertySerializer(prop, context={"user": request.user}).data)

    def delete(self, request, pk):
        payload = TransitionSerializer(data=request.query_params)
        payload.is_valid(raise_exception=True)
        prop = _property_or_404(pk)

        lifecycle.delete_property(
            prop=prop,
            actor=request.user,
            reason=payload.validated_data.get("reason", ""),
            confirmed=payload.validated_data["confirmed"],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class PropertyRestoreView(APIView):
    """POST /properties/{id}/restore — undo an archive."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        prop = _property_or_404(pk)
        lifecycle.restore_property(prop=prop, actor=request.user)
        return Response(PropertySerializer(prop, context={"user": request.user}).data)


class SpaceArchiveView(APIView):
    """POST /spaces/{id}/archive, DELETE /spaces/{id}/archive."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        payload = TransitionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        unit = _space_or_404(pk)

        lifecycle.archive_space(
            unit=unit,
            actor=request.user,
            reason=payload.validated_data.get("reason", ""),
            confirmed=payload.validated_data["confirmed"],
        )
        return Response({"id": str(unit.id), "is_active": unit.is_active})

    def delete(self, request, pk):
        payload = TransitionSerializer(data=request.query_params)
        payload.is_valid(raise_exception=True)
        unit = _space_or_404(pk)

        lifecycle.delete_space(
            unit=unit,
            actor=request.user,
            reason=payload.validated_data.get("reason", ""),
            confirmed=payload.validated_data["confirmed"],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class SpaceRestoreView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        unit = _space_or_404(pk)
        lifecycle.restore_space(unit=unit, actor=request.user)
        return Response({"id": str(unit.id), "is_active": unit.is_active})
