"""What a verification asks for, read rather than hardcoded by the client.

The provider screens used to state their own requirements — "send one
government-issued identity document" — which meant the interface and the
backend each held an opinion about what was needed, and only one of them was
checked. This endpoint is the single answer both read.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound, PermissionDenied

from . import evidence_policy


class EvidenceRequirementsView(APIView):
    """GET /trust/evidence-requirements/ — what to provide, for what.

    Query by any combination of:

    * ``relationship_type`` — the authority documents for that relationship
    * ``property_id`` — what shows the building and where it is
    * ``unit_id`` — what shows one rentable space

    Answering for a property or space requires authority over it: the shape of
    a requirement set is not sensitive, but the existence of a property and its
    room counts are, and this would otherwise enumerate both.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        relationship_type = request.query_params.get("relationship_type", "")
        prop = self._property(request)
        unit = self._unit(request, prop)

        if not (relationship_type or prop or unit):
            # Nothing asked, nothing to answer. Returning every policy would
            # invite a client to pick its own subset, which is the coupling
            # this endpoint exists to remove.
            raise NotFound(
                "Say what the evidence is for: a relationship type, a property, or a space."
            )

        return Response(
            evidence_policy.requirements(relationship_type=relationship_type, prop=prop, unit=unit)
        )

    # -- lookups, each authorised ---------------------------------------------

    def _property(self, request):
        from apps.property.models import Property

        raw = request.query_params.get("property_id")
        if not raw:
            return None
        prop = Property.objects.filter(pk=raw).first()
        if prop is None:
            raise NotFound("That property does not exist.")
        self._require_authority(request.user, prop)
        return prop

    def _unit(self, request, prop):
        from apps.property.models import Unit

        raw = request.query_params.get("unit_id")
        if not raw:
            return None
        unit = Unit.objects.filter(pk=raw).select_related("property").first()
        if unit is None:
            raise NotFound("That space does not exist.")
        if prop is None or unit.property_id != prop.id:
            self._require_authority(request.user, unit.property)
        return unit

    @staticmethod
    def _require_authority(user, prop) -> None:
        if not prop.relationships.filter(user=user, ended_at__isnull=True).exists():
            raise PermissionDenied("You do not manage this property.")
