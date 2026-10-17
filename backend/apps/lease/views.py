"""Lease API.

Two inboxes again, and for a real reason rather than symmetry: one person can be
a tenant on one agreement and a landlord on another, which is normal here.
"""

from __future__ import annotations

import hashlib

from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import Gone, NotFound
from apps.idempotency.services import idempotent_mutation

from . import services
from .models import Lease, LeaseStatus
from .serializers import (
    DraftLeaseSerializer,
    LeaseSerializer,
    ReasonSerializer,
    TermsTemplateInputSerializer,
    TermsTemplateSerializer,
    UpdateLeaseSerializer,
)

SELECT = (
    "unit__property__address__locality",
    "unit__property__owner",
    "landlord",
    "tenant",
    "agreement",
    "template",
)


class MyLeasesView(APIView):
    """GET/POST /me/leases/ — agreements where I am the tenant."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        leases = (
            # A provider's draft has not been sent to the tenant. It becomes
            # tenant-visible only once the provider offers it.
            Lease.objects.filter(tenant=request.user)
            .exclude(status__in=[LeaseStatus.DRAFT, LeaseStatus.READY])
            .select_related(*SELECT)
            .prefetch_related("agreement__acceptances__user")
        )
        return Response(LeaseSerializer(leases, many=True).data)

    @idempotent_mutation(resource_type="lease")
    def post(self, request):
        from apps.application.models import RentalApplication
        from apps.identity.models import User
        from apps.listing.models import Listing
        from apps.occupancy.models import PropertyJoinRequest
        from apps.property.models import Bed, Unit

        payload = DraftLeaseSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        unit = (
            Unit.objects.filter(id=data["unit_id"])
            .select_related("property__owner", "property__address__locality")
            .first()
        )
        if unit is None:
            raise NotFound("We could not find that unit.")

        tenant = User.objects.filter(id=data["tenant_id"]).first()
        if tenant is None:
            raise NotFound("We could not find that person.")

        bed = None
        if data.get("bed_id"):
            bed = Bed.objects.filter(id=data["bed_id"], unit=unit).first()
            if bed is None:
                raise NotFound("We could not find that bed in this unit.")

        application = (
            RentalApplication.objects.filter(id=data["application_id"]).first()
            if data.get("application_id")
            else None
        )
        listing = (
            Listing.objects.filter(id=data["listing_id"]).first()
            if data.get("listing_id")
            else None
        )
        if data.get("invitation_id"):
            # Retain the input long enough for installed clients to receive the
            # migration answer instead of silently drafting an unlinked lease.
            raise Gone(
                "An invitation cannot authorize a lease. The tenant must send a "
                "tenancy request and the provider must approve it first."
            )
        join_request = (
            PropertyJoinRequest.objects.filter(id=data["join_request_id"]).first()
            if data.get("join_request_id")
            else None
        )
        if data.get("join_request_id") and join_request is None:
            raise NotFound("We could not find that tenancy request.")

        lease = services.draft_lease(
            user=request.user,
            unit=unit,
            tenant=tenant,
            data=data,
            application=application,
            listing=listing,
            join_request=join_request,
            bed=bed,
        )
        return Response(LeaseSerializer(lease).data, status=status.HTTP_201_CREATED)


class LandlordLeasesView(APIView):
    """GET /me/granted-leases/ — agreements on places I manage."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        """`?organization=<id>` scopes this to one Portfolio, decided here.

        An agreement belongs to the Portfolio whose Property it was granted on,
        so a provider looking at one Portfolio is never shown another's.
        """
        from apps.organization.services import properties_in_scope

        leases = (
            Lease.objects.filter(
                unit__property__in=properties_in_scope(
                    user=request.user, organization=request.query_params.get("organization")
                )
            )
            .select_related(*SELECT)
            .prefetch_related("agreement__acceptances__user")
        )
        return Response(LeaseSerializer(leases, many=True).data)


class LeaseDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        lease = services.get_lease_or_404(pk)
        services.assert_participant(lease, request.user)
        return Response(LeaseSerializer(lease).data)

    @idempotent_mutation(resource_type="lease")
    def patch(self, request, pk):
        lease = services.get_lease_or_404(pk)
        payload = UpdateLeaseSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        lease = services.update_draft(lease=lease, user=request.user, data=payload.validated_data)
        return Response(LeaseSerializer(lease).data)


class LeaseActionView(APIView):
    permission_classes = [IsAuthenticated]

    @idempotent_mutation(resource_type="lease")
    def post(self, request, pk, action):
        lease = services.get_lease_or_404(pk)

        # Amending is the one action that answers with a *different* agreement,
        # and the only one carrying builder terms rather than a reason. It is
        # handled before the reason payload is read so neither has to pretend
        # to be the other.
        if action == "amend":
            terms = UpdateLeaseSerializer(data=request.data, partial=True)
            terms.is_valid(raise_exception=True)
            amendment = services.amend_lease(
                lease=lease, user=request.user, data=terms.validated_data
            )
            return Response(LeaseSerializer(amendment).data, status=201)

        payload = ReasonSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        reason = payload.validated_data.get("reason", "")

        # The request is threaded through so the acceptance record carries the
        # circumstances - which is most of what makes it worth having later.
        if action == "ready":
            lease = services.ready_lease(lease=lease, user=request.user)
        elif action == "offer":
            lease = services.offer_lease(lease=lease, user=request.user, request=request)
        elif action == "review":
            lease = services.record_tenant_review(lease=lease, user=request.user)
        elif action == "accept":
            lease = services.accept_lease(
                lease=lease,
                user=request.user,
                acknowledged=payload.validated_data.get("acknowledged", False),
                request=request,
            )
        elif action == "decline":
            lease = services.decline_lease(lease=lease, user=request.user, reason=reason)
        elif action == "cancel":
            lease = services.cancel_lease(lease=lease, user=request.user, reason=reason)
        elif action == "end":
            lease = services.end_lease(
                lease=lease,
                user=request.user,
                reason=reason,
                confirmed=payload.validated_data.get("confirmed", False),
            )
        elif action == "confirm":
            lease = services.confirm_lease(lease=lease, user=request.user, request=request)
        else:
            raise NotFound("Unknown action.")

        return Response(LeaseSerializer(lease).data)


class LeaseDocumentView(APIView):
    """The stored final PDF, or a non-mutating print copy of its frozen snapshot."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        lease = services.get_lease_or_404(pk)
        services.assert_participant(lease, request.user)
        agreement = getattr(lease, "agreement", None)
        if agreement is None or not agreement.final_pdf:
            raise NotFound("The final agreement document is not available yet.")
        print_copy = request.query_params.get("disposition") == "print"
        if print_copy:
            from .pdf import render_final_pdf

            document = render_final_pdf(agreement)
        else:
            document = bytes(agreement.final_pdf)
        # Downloaded by default; opened in place only when the client asks,
        # which is what "View" does and "Download" does not.
        inline = request.query_params.get("disposition") in {"inline", "print"}
        disposition = "inline" if inline else "attachment"
        filename = f"danpahq-agreement-{agreement.reference_number or lease.id}.pdf"
        response = HttpResponse(document, content_type="application/pdf")
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        response["ETag"] = f'"{hashlib.sha256(document).hexdigest()}"'
        response["X-Content-Type-Options"] = "nosniff"
        return response


class OrganizationContractsView(APIView):
    """GET /organizations/<id>/contracts/ - what a Portfolio's agreements are made of.

    Danpa HQ's controlled agreement (read-only: its clauses and version), the
    placeholders a provider may use, and the Portfolio's own terms templates.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, organization_pk):
        from apps.organization.services import get_organization_or_404

        from . import terms_templates
        from .templates import canonical_template

        organization = get_organization_or_404(organization_pk, request.user)
        templates = terms_templates.list_templates(organization=organization, user=request.user)
        agreement = canonical_template()
        return Response(
            {
                "agreement": {
                    "title": agreement.title,
                    "version": agreement.version,
                    "review_status": agreement.review_status,
                    "clauses": [
                        {"id": clause["id"], "title": clause["title"], "body": clause["body"]}
                        for clause in agreement.clauses
                    ],
                },
                "placeholders": terms_templates.placeholder_catalogue(),
                "templates": TermsTemplateSerializer(templates, many=True).data,
            }
        )


class OrganizationTermsTemplatesView(APIView):
    """POST /organizations/<id>/terms-templates/ - save reusable additional terms."""

    permission_classes = [IsAuthenticated]

    @idempotent_mutation(resource_type="terms_template")
    def post(self, request, organization_pk):
        from apps.organization.services import get_organization_or_404

        from . import terms_templates

        organization = get_organization_or_404(organization_pk, request.user)
        payload = TermsTemplateInputSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        template = terms_templates.create_template(
            organization=organization, user=request.user, data=payload.validated_data
        )
        return Response(TermsTemplateSerializer(template).data, status=status.HTTP_201_CREATED)


class OrganizationTermsTemplateView(APIView):
    """PATCH/DELETE /organizations/<id>/terms-templates/<template>/."""

    permission_classes = [IsAuthenticated]

    def _template(self, request, organization_pk, pk):
        from apps.organization.services import get_organization_or_404

        from .models import TermsTemplate

        organization = get_organization_or_404(organization_pk, request.user)
        template = TermsTemplate.objects.filter(organization=organization, id=pk).first()
        if template is None:
            raise NotFound("We could not find that template.")
        return template

    def patch(self, request, organization_pk, pk):
        from . import terms_templates

        template = self._template(request, organization_pk, pk)
        payload = TermsTemplateInputSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        template = terms_templates.update_template(
            template=template, user=request.user, data=payload.validated_data
        )
        return Response(TermsTemplateSerializer(template).data)

    def delete(self, request, organization_pk, pk):
        from . import terms_templates

        template = self._template(request, organization_pk, pk)
        terms_templates.delete_template(template=template, user=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
