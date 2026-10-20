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

from . import services
from .serializers import ApplySerializer, my_application


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
