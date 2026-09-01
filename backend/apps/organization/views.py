from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound
from apps.core.memo import memoized
from apps.identity.permissions import IsPhoneVerified
from apps.property import services as property_services
from apps.property.models import Property
from apps.property.serializers import PropertySerializer

from . import services
from .models import (
    Organization,
    OrganizationInvitation,
    OrganizationMembership,
    PropertyAssignment,
)
from .serializers import (
    ChangeMembershipRoleSerializer,
    CreateInvitationSerializer,
    CreateOrganizationSerializer,
    CreatePropertyAssignmentSerializer,
    InvitationActionSerializer,
    MembershipSerializer,
    OrganizationInvitationSerializer,
    OrganizationSerializer,
    PropertyAssignmentSerializer,
    UpdateOrganizationSerializer,
)


class OrganizationListCreateView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request):
        rows = Organization.objects.filter(
            memberships__user=request.user,
            memberships__ended_at__isnull=True,
            is_active=True,
        ).distinct()
        return Response(
            OrganizationSerializer(rows, many=True, context={"user": request.user}).data
        )

    def post(self, request):
        # A Portfolio is provider administration, not a tenant-side shortcut.
        # The same approved-provider capability that opens Property creation
        # must be present before full company/Team setup can be created.
        property_services.assert_can_create_property(request.user)
        payload = CreateOrganizationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        organization = services.create_organization(user=request.user, data=payload.validated_data)
        return Response(
            OrganizationSerializer(organization, context={"user": request.user}).data,
            status=status.HTTP_201_CREATED,
        )


class OrganizationDetailView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        organization = services.get_organization_or_404(pk, request.user)
        return Response(OrganizationSerializer(organization, context={"user": request.user}).data)

    def patch(self, request, pk):
        organization = services.get_organization_or_404(pk, request.user)
        payload = UpdateOrganizationSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        organization = services.update_organization(
            organization=organization, actor=request.user, data=payload.validated_data
        )
        return Response(OrganizationSerializer(organization, context={"user": request.user}).data)


class OrganizationMembershipView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        organization = services.get_organization_or_404(pk, request.user)
        services.assert_can_manage_organization(organization, request.user)
        rows = organization.memberships.filter(ended_at__isnull=True).select_related("user")
        return Response(MembershipSerializer(rows, many=True).data)


class OrganizationMembershipDetailView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def patch(self, request, pk, membership_pk):
        organization = services.get_organization_or_404(pk, request.user)
        payload = ChangeMembershipRoleSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        membership = (
            organization.memberships.filter(id=membership_pk).select_related("user").first()
        )
        if membership is None:
            raise NotFound("We could not find that Portfolio member.")
        membership = services.change_membership_role(
            organization=organization,
            membership=membership,
            actor=request.user,
            role=payload.validated_data["role"],
        )
        return Response(MembershipSerializer(membership).data)

    def delete(self, request, pk, membership_pk):
        organization = services.get_organization_or_404(pk, request.user)
        membership = (
            organization.memberships.filter(id=membership_pk).select_related("user").first()
        )
        if membership is None:
            raise NotFound("We could not find that Portfolio member.")
        services.remove_membership(
            organization=organization,
            membership=membership,
            actor=request.user,
            reason=str(request.data.get("reason", "Access revoked")),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrganizationInvitationView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        organization = services.get_organization_or_404(pk, request.user)
        services.assert_can_manage_organization(organization, request.user)
        rows = list(
            organization.invitations.select_related("organization", "invited_by").prefetch_related(
                "property_selections__property"
            )[:100]
        )
        rows = [services.expire_invitation(row) for row in rows]
        return Response(
            OrganizationInvitationSerializer(rows, many=True, context={"include_token": True}).data
        )

    def post(self, request, pk):
        organization = services.get_organization_or_404(pk, request.user)
        payload = CreateInvitationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        invitation = services.create_invitation(
            organization=organization,
            actor=request.user,
            invitee_phone=payload.validated_data["phone"],
            role=payload.validated_data["role"],
            property_ids=payload.validated_data.get("property_ids", []),
        )
        invitation = (
            OrganizationInvitation.objects.select_related("organization", "invited_by")
            .prefetch_related("property_selections__property")
            .get(id=invitation.id)
        )
        return Response(
            OrganizationInvitationSerializer(invitation, context={"include_token": True}).data,
            status=status.HTTP_201_CREATED,
        )


class MyOrganizationInvitationView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request):
        rows = services.invitations_for_invitee(request.user)
        rows = (
            OrganizationInvitation.objects.filter(id__in=[row.id for row in rows])
            .select_related("organization", "invited_by")
            .prefetch_related("property_selections__property")
        )
        return Response(
            OrganizationInvitationSerializer(rows, many=True, context={"include_token": True}).data
        )


class OrganizationInvitationDecisionView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request, invitation_pk, decision):
        payload = InvitationActionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        invitation = OrganizationInvitation.objects.filter(id=invitation_pk).first()
        if invitation is None:
            raise NotFound("We could not find that Portfolio invitation.")
        if decision == "accept":
            membership = services.accept_invitation(
                invitation=invitation,
                actor=request.user,
                token=payload.validated_data["token"],
            )
            return Response(MembershipSerializer(membership).data)
        if decision == "decline":
            invitation = services.decline_invitation(
                invitation=invitation,
                actor=request.user,
                token=payload.validated_data["token"],
            )
            return Response(OrganizationInvitationSerializer(invitation).data)
        raise NotFound("We could not find that invitation action.")


class OrganizationInvitationRevokeView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request, pk, invitation_pk):
        organization = services.get_organization_or_404(pk, request.user)
        invitation = organization.invitations.filter(id=invitation_pk).first()
        if invitation is None:
            raise NotFound("We could not find that Portfolio invitation.")
        invitation = services.revoke_invitation(invitation=invitation, actor=request.user)
        return Response(OrganizationInvitationSerializer(invitation).data)


class OrganizationPropertyView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        organization = services.get_organization_or_404(pk, request.user)
        rows = (
            services.properties_for_organization_member(
                organization=organization, user=request.user
            )
            .select_related("address__locality__district__region", "owner")
            .prefetch_related(
                # The mobile Properties tab reads `cover_url` from the same
                # serializer; its condition-evidence fallback is batched there.
                "media__file"
            )
        )
        # The mobile Properties tab, reading the same serializer.
        with memoized():
            return Response(
                PropertySerializer(rows, many=True, context={"user": request.user}).data
            )

    def post(self, request, pk):
        organization = services.get_organization_or_404(pk, request.user)
        prop = property_services.create_private_property(
            user=request.user,
            organization=organization,
            data=request.data,
        )
        return Response(
            PropertySerializer(prop, context={"user": request.user}).data,
            status=status.HTTP_201_CREATED,
        )


class PersonalPortfolioPropertyCreateView(APIView):
    """Create an individual's first Property and personal Portfolio together."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request):
        prop = property_services.create_personal_property(user=request.user, data=request.data)
        return Response(
            PropertySerializer(prop, context={"user": request.user}).data,
            status=status.HTTP_201_CREATED,
        )


class OrganizationPortfolioView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        organization = services.get_organization_or_404(pk, request.user)
        response = Response(
            services.portfolio_summary(organization=organization, user=request.user)
        )
        response["Cache-Control"] = "private, no-store"
        return response


class OrganizationUnitView(APIView):
    """GET /organizations/<id>/units/ — every Unit in one Portfolio.

    Units were readable only one Property at a time, so finding a room across a
    portfolio meant a request per Property. Same serializer as the per-Property
    list and the same organization gate as the summary beside it; the only new
    thing here is the scope of the query.
    """

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        from apps.property.models import Unit
        from apps.property.serializers import UnitSerializer

        organization = services.get_organization_or_404(pk, request.user)
        # The same scoping the Portfolio summary uses: a member with Property
        # assignments sees their Properties, not the Portfolio's.
        property_ids = list(
            services.properties_for_organization_member(
                organization=organization, user=request.user
            ).values_list("id", flat=True)
        )
        units = (
            Unit.objects.filter(property_id__in=property_ids, is_active=True)
            .select_related("property__address__locality__district__region")
            .prefetch_related("media__file", "unit_amenities__amenity", "beds")
            .order_by("property__title", "label")
        )
        response = Response(UnitSerializer(units, many=True, context={"user": request.user}).data)
        response["Cache-Control"] = "private, no-store"
        return response


class OrganizationPropertyAssignmentView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        organization = services.get_organization_or_404(pk, request.user)
        services.assert_can_manage_organization(organization, request.user)
        rows = PropertyAssignment.objects.filter(
            membership__organization=organization, ended_at__isnull=True
        ).select_related("membership", "property")
        return Response(PropertyAssignmentSerializer(rows, many=True).data)

    def post(self, request, pk):
        organization = services.get_organization_or_404(pk, request.user)
        payload = CreatePropertyAssignmentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        membership = OrganizationMembership.objects.filter(
            id=payload.validated_data["membership_id"], organization=organization
        ).first()
        prop = Property.objects.filter(id=payload.validated_data["property_id"]).first()
        if membership is None or prop is None:
            raise NotFound("We could not find that member or property.")
        assignment = services.assign_property(
            organization=organization,
            property=prop,
            membership=membership,
            actor=request.user,
        )
        return Response(
            PropertyAssignmentSerializer(assignment).data,
            status=status.HTTP_201_CREATED,
        )


class OrganizationPropertyAssignmentDetailView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def delete(self, request, pk, assignment_pk):
        organization = services.get_organization_or_404(pk, request.user)
        assignment = (
            PropertyAssignment.objects.filter(
                id=assignment_pk, membership__organization=organization
            )
            .select_related("membership")
            .first()
        )
        if assignment is None:
            raise NotFound("We could not find that Property assignment.")
        services.unassign_property(
            organization=organization, assignment=assignment, actor=request.user
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
