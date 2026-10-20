"""Artisan API.

Applicant: ``GET/POST /me/artisan/`` — where their application stands, and
           sending it (or answering a reviewer's request for more).
Management decides applications in the verification queue and suspends from
``/management/artisans/`` (``apps.operations``).
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.idempotency.services import idempotent_mutation
from apps.identity.permissions import IsPhoneVerified, IsRegistrationComplete

from . import discover, quotes, services, work
from .serializers import (
    ApplySerializer,
    ArtisanChoiceSerializer,
    DiscoverQuerySerializer,
    QuoteDecisionSerializer,
    QuoteInputSerializer,
    RevisionInputSerializer,
    UpdateProfileSerializer,
    my_application,
)


class MyArtisanView(APIView):
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), IsPhoneVerified(), IsRegistrationComplete()]
        return super().get_permissions()

    def get(self, request):
        return Response(my_application(request.user))

    @idempotent_mutation(resource_type="artisan_application")
    def post(self, request):
        payload = ApplySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        services.apply(user=request.user, **payload.validated_data)
        return Response(my_application(request.user), status=status.HTTP_201_CREATED)


class MyArtisanProfileView(APIView):
    """PUT /me/artisan/profile/ — an approved artisan keeps their profile current."""

    permission_classes = [IsAuthenticated, IsPhoneVerified, IsRegistrationComplete]

    @idempotent_mutation(resource_type="artisan_profile")
    def put(self, request):
        payload = UpdateProfileSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        services.update_profile(user=request.user, **payload.validated_data)
        return Response(my_application(request.user))


class DiscoverView(APIView):
    """GET /artisans/ — approved artisans a customer may invite to quote.

    Filters: ``trade``, ``district``, ``certified``. In the electrical trade only
    certified artisans are listed unless ``show_uncertified`` asks for the rest.
    """

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    def get(self, request):
        query = DiscoverQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        data = query.validated_data
        return Response(
            discover.discover(
                viewer=request.user,
                trade=data.get("trade", ""),
                district_id=data.get("district"),
                certified_only=data["certified"],
                show_uncertified_electrical=data["show_uncertified"],
            )
        )


class ArtisanProfileView(APIView):
    """GET /artisans/<id>/ — one listed artisan, as facts. Never a phone or address."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    def get(self, request, pk):
        return Response(discover.public_profile(profile_id=pk, viewer=request.user))


# --- quotes on maintenance requests (apps.artisan.quotes, .work) --------------------


def _work(request_id, user) -> dict:
    """The request's artisan block after a change, for the reader who made it."""
    from apps.maintenance.services import get_visible

    return work.work_for(get_visible(request_id=request_id, user=user), user)


class InviteView(APIView):
    """POST /maintenance/<id>/artisan-invitations/ — ask an artisan to quote."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    @idempotent_mutation(resource_type="quote_invitation")
    def post(self, request, pk):
        payload = ArtisanChoiceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        quotes.invite(
            user=request.user, request_id=pk, artisan_id=payload.validated_data["artisan_id"]
        )
        return Response(_work(pk, request.user), status=status.HTTP_201_CREATED)


class SuggestView(APIView):
    """POST /maintenance/<id>/artisan-suggestions/ — a tenant names an artisan."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    @idempotent_mutation(resource_type="quote_invitation")
    def post(self, request, pk):
        payload = ArtisanChoiceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        quotes.suggest(
            user=request.user, request_id=pk, artisan_id=payload.validated_data["artisan_id"]
        )
        return Response(_work(pk, request.user), status=status.HTTP_201_CREATED)


class RevisionView(APIView):
    """POST /maintenance/<id>/revisions/ — the assigned artisan asks for more."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    @idempotent_mutation(resource_type="artisan_quote")
    def post(self, request, pk):
        payload = RevisionInputSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        quote = quotes.submit_revision(user=request.user, request_id=pk, **payload.validated_data)
        return Response(
            work.my_invitation(request.user, quote.invitation_id), status=status.HTTP_201_CREATED
        )


class MyInvitationsView(APIView):
    """GET /me/artisan/invitations/ — quote invitations and the quotes sent on them."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    def get(self, request):
        return Response(work.my_invitations(request.user))


class MyJobsView(APIView):
    """GET /me/artisan/jobs/ — requests this artisan was assigned, unlocked."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    def get(self, request):
        return Response(work.my_jobs(request.user))


class MyInvitationView(APIView):
    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    def get(self, request, pk):
        return Response(work.my_invitation(request.user, pk))


class DeclineInvitationView(APIView):
    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    @idempotent_mutation(resource_type="quote_invitation")
    def post(self, request, pk):
        quotes.decline_invitation(user=request.user, invitation_id=pk)
        return Response(work.my_invitation(request.user, pk))


class SubmitQuoteView(APIView):
    """POST /me/artisan/invitations/<id>/quotes/ — a price, its scope, its materials."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    @idempotent_mutation(resource_type="artisan_quote")
    def post(self, request, pk):
        payload = QuoteInputSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        quotes.submit_quote(user=request.user, invitation_id=pk, **payload.validated_data)
        return Response(work.my_invitation(request.user, pk), status=status.HTTP_201_CREATED)


class WithdrawQuoteView(APIView):
    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    @idempotent_mutation(resource_type="artisan_quote")
    def post(self, request, pk):
        quote = quotes.withdraw_quote(user=request.user, quote_id=pk)
        return Response(work.my_invitation(request.user, quote.invitation_id))


class ApproveQuoteView(APIView):
    """POST /artisan-quotes/<id>/approve/ — the payer says yes: assigns, or raises the price."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    @idempotent_mutation(resource_type="artisan_quote")
    def post(self, request, pk):
        quote = quotes.approve_quote(user=request.user, quote_id=pk)
        return Response(_work(quote.invitation.maintenance_request_id, request.user))


class DeclineQuoteView(APIView):
    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    @idempotent_mutation(resource_type="artisan_quote")
    def post(self, request, pk):
        payload = QuoteDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        quote = quotes.decline_quote(
            user=request.user, quote_id=pk, note=payload.validated_data["note"]
        )
        return Response(_work(quote.invitation.maintenance_request_id, request.user))


class CustomerWorkView(APIView):
    """GET /artisan-work/ — the Artisans sheet: Requests and Records."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    def get(self, request):
        return Response(work.customer_overview(request.user))
