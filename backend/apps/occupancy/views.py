from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import Gone, NotFound
from apps.idempotency.services import idempotent_mutation
from apps.identity.permissions import IsPhoneVerified
from apps.property import services as property_services
from apps.property.models import Bed, Property, Unit

from . import services
from .models import Occupancy, PropertyInvitation, PropertyJoinRequest
from .serializers import (
    CreateJoinRequestSerializer,
    InvitationSerializer,
    JoinDecisionSerializer,
    JoinRequestSerializer,
    MyJoinRequestSerializer,
    OccupancySerializer,
)
from .throttling import AccessCodeIpThrottle, AccessCodeUserThrottle


def _space(payload, prop):
    unit = Unit.objects.filter(id=payload["unit_id"], property=prop).first()
    bed = (
        Bed.objects.filter(id=payload.get("bed_id"), unit=unit).first()
        if unit and payload.get("bed_id")
        else None
    )
    if unit is None or (payload.get("bed_id") and bed is None):
        raise NotFound("We could not find that unit or bed.")
    return unit, bed


class MyOccupanciesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = Occupancy.objects.filter(user=request.user, ended_at__isnull=True).select_related(
            "property", "unit", "bed"
        )
        return Response(OccupancySerializer(rows, many=True).data)


class PropertyInvitationView(APIView):
    """Read historical invitations; refuse creation from legacy clients."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, property_pk):
        prop = property_services.get_property_or_404(property_pk, request.user)
        property_services.assert_can_manage(prop, request.user)
        rows = PropertyInvitation.objects.filter(property=prop).select_related(
            "unit", "bed", "invitee_user", "lease"
        )
        return Response(InvitationSerializer(rows, many=True).data)

    def post(self, request, property_pk):
        # Keep the route long enough for installed clients to receive a stable
        # migration answer. Removing it outright would turn a lifecycle change
        # into an ambiguous 404 and encourage retries.
        raise Gone(
            "Direct tenant invitations have been retired. Share the verified "
            "Unit access code so the tenant can send a tenancy request."
        )


class ResolveInvitationView(APIView):
    """Compatibility endpoint for retired invitation tokens."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request):
        raise Gone(
            "Invitation codes are no longer accepted. Ask the provider for the "
            "verified Unit access code and send a tenancy request instead."
        )


class AcceptInvitationView(APIView):
    """Compatibility endpoint that cannot accept a legacy invitation."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request):
        raise Gone(
            "Invitations can no longer be accepted. Use the Unit access code to "
            "send a tenancy request; approval then leads to a lease offer."
        )


class DeclineInvitationView(APIView):
    """Compatibility endpoint for a workflow whose open offers were revoked."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request):
        raise Gone("This invitation workflow has been retired. No tenancy or access was created.")


class MyJoinRequestsView(APIView):
    """GET /me/join-requests/ — the access requests this person sent.

    The only read of a join request used to be
    `GET /properties/<pk>/join-requests/`, which asserts management of the
    Property. So the person who *sent* the request could not see it: after
    quoting an access code they got a success message and then silence. An
    approval eventually surfaced as a lease offer; a rejection surfaced as
    nothing at all.

    Read-only, and scoped to `requester=request.user` — no new authority, and
    no new domain behaviour. It exposes a record the caller created and is a
    party to.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = (
            PropertyJoinRequest.objects.filter(requester=request.user)
            .select_related("property__address__locality", "unit", "bed", "lease")
            .order_by("-created_at")
        )
        return Response(MyJoinRequestSerializer(rows, many=True).data)


class PropertyJoinRequestView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get_throttles(self):
        if self.request.method == "POST":
            return [AccessCodeUserThrottle(), AccessCodeIpThrottle()]
        return super().get_throttles()

    def get(self, request, property_pk):
        prop = property_services.get_property_or_404(property_pk, request.user)
        property_services.assert_can_manage(prop, request.user)
        rows = PropertyJoinRequest.objects.filter(property=prop).select_related(
            "requester", "lease"
        )
        return Response(JoinRequestSerializer(rows, many=True).data)

    @idempotent_mutation(resource_type="property_join_request")
    def post(self, request, property_pk):
        prop = Property.objects.filter(id=property_pk).first()
        if prop is None:
            raise NotFound("We could not find that property.")
        payload = CreateJoinRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        unit, bed = _space(payload.validated_data, prop)
        join_request = services.create_join_request(
            user=request.user,
            prop=prop,
            unit=unit,
            bed=bed,
            access_code=payload.validated_data["access_code"],
            message=payload.validated_data.get("message", ""),
        )
        return Response(JoinRequestSerializer(join_request).data, status=status.HTTP_201_CREATED)


class JoinRequestDecisionView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    @idempotent_mutation(resource_type="property_join_request")
    def post(self, request, pk):
        join_request = PropertyJoinRequest.objects.filter(id=pk).first()
        if join_request is None:
            raise NotFound("We could not find that join request.")
        payload = JoinDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        join_request, _occupancy = services.decide_join_request(
            join_request=join_request,
            actor=request.user,
            approved=payload.validated_data["approved"],
            note=payload.validated_data.get("note", ""),
        )
        data = JoinRequestSerializer(join_request).data
        data["occupancy_id"] = None
        data["next_step"] = "provider_prepares_lease" if join_request.status == "approved" else None
        return Response(data)


class PropertyJoinLookupView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]
    throttle_classes = [AccessCodeUserThrottle, AccessCodeIpThrottle]

    def get(self, request):
        """Resolve a join code to the one space it names.

        A code used to name a *property*, and the tenant then chose a unit from
        a list of every space in the building — which meant one secret admitted
        somebody to any room in a hostel, and asked them to pick the right one
        honestly. A code now names exactly what its holder is being invited to.

        The unit is still returned inside its property, because a person needs to
        recognise the building to know they have the right code.
        """
        from apps.property.access_codes import resolve
        from apps.property.space_rules import is_hostel_room

        code = str(request.query_params.get("code", ""))
        unit = resolve(code)

        prop = unit.property
        beds = unit.beds.filter(is_active=True) if is_hostel_room(unit) else []
        serialized_beds = [{"id": str(bed.id), "label": bed.label} for bed in beds]
        return Response(
            {
                "id": str(prop.id),
                "title": prop.title,
                "locality": prop.address.locality_label if prop.address_id else "",
                "unit": {
                    "id": str(unit.id),
                    "label": unit.label or "Unit",
                    "space_type": unit.space_type,
                    "beds": serialized_beds,
                },
                # Kept so a client written against the old shape still finds the
                # space it should offer, rather than an empty list.
                "units": [
                    {
                        "id": str(unit.id),
                        "label": unit.label or "Unit",
                        "beds": serialized_beds,
                    }
                ],
            }
        )
