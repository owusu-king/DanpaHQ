from __future__ import annotations

from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def meta(request):
    """What this build is and what the client should know about it.

    The mobile app calls this on launch: it is how we tell an old build that it
    is below the minimum supported version, without shipping a new build first.
    """
    return Response(
        {
            "service": "danpahq",
            "version": settings.APP_VERSION,
            "environment": settings.ENVIRONMENT,
            "api_version": "v1",
            "minimum_client_versions": {"android": "0.1.0", "ios": "0.1.0"},
            "currency": "GHS",
            "phase": "0 - foundation",
        }
    )
