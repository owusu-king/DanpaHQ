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

from . import discover, services
from .serializers import (
    ApplySerializer,
    DiscoverQuerySerializer,
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
