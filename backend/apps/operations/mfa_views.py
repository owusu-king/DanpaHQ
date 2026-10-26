from typing import ClassVar

from django.conf import settings
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.context import get_context
from apps.core.exceptions import PermissionDenied, RateLimited
from apps.core.throttling import count_attempt

from . import login_mfa


class MFAConfirmationSerializer(serializers.Serializer):
    challenge_token = serializers.CharField(max_length=128, trim_whitespace=False)
    code = serializers.CharField(max_length=32, required=False, default="", allow_blank=True)
    action = serializers.ChoiceField(choices=["verify", "skip", "complete"], default="verify")


def no_store(response):
    response["Cache-Control"] = "no-store"
    response["Pragma"] = "no-cache"
    return response


class MFALoginView(APIView):
    authentication_classes: ClassVar[list] = []
    permission_classes: ClassVar[list] = [AllowAny]
    surface = "consumer"

    def post(self, request):
        origin = request.headers.get("Origin")
        if origin and origin not in settings.CORS_ALLOWED_ORIGINS:
            raise PermissionDenied("This sign-in origin is not allowed.")
        if (
            count_attempt(
                f"mfa-login-ip:{get_context().ip_address or 'unknown'}",
                window=300,
                scope="mfa_login",
            )
            > 30
        ):
            raise RateLimited("Too many attempts. Try again later.")
        payload = MFAConfirmationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        result = login_mfa.finish(
            token=data["challenge_token"],
            surface=self.surface,
            code=data["code"],
            action=data["action"],
            client=get_context().source,
        )
        if isinstance(result, dict) and result.get("mfa_required"):
            return no_store(Response(result))
        if self.surface == "management":
            from .authentication import set_management_cookies
            from .services import management_payload

            session, raw_session, raw_csrf = result
            response = Response({"user": management_payload(session.user), "csrf_token": raw_csrf})
            set_management_cookies(response, session_token=raw_session, csrf_token=raw_csrf)
        else:
            from apps.identity.serializers import MeSerializer
            from apps.identity.views import _token_response

            response = _token_response(
                request,
                {
                    "access_token": result["access_token"],
                    "refresh_token": result["refresh_token"],
                    "expires_in": result["expires_in"],
                    "user": MeSerializer(result["user"]).data,
                },
            )
        return no_store(response)


class ManagementMFALoginView(MFALoginView):
    surface = "management"
