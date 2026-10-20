"""Housing Passport API.

The owner's endpoints live under ``/me/passport/`` and read only the caller's
own records. The recipient's endpoint is the one public route: it takes the
token in a POST body rather than the URL, so it never lands in access logs or a
Referer header, and it ignores any credentials a signed-in recipient's browser
might carry — the link is the whole authority, and nothing about who opens it
widens what it shows.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .record import assemble, correction_states, full_scope
from .serializers import (
    CorrectionInputSerializer,
    OpenShareSerializer,
    ScopeInputSerializer,
    ShareInputSerializer,
    ShareSerializer,
)
from .throttling import PassportViewIpThrottle


class MyPassportView(APIView):
    """GET /me/passport/ — the whole passport, as its owner sees it."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        passport = assemble(request.user, scope=full_scope(), audience="owner")
        passport["corrections"] = [
            {"record_type": record_type, "record_id": record_id, **state}
            for (record_type, record_id), state in correction_states(request.user).items()
        ]
        return Response(passport)


class PassportPreviewView(APIView):
    """POST /me/passport/preview/ — what a recipient would see, saving nothing."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = ScopeInputSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(services.preview(request.user, payload.validated_data))


class PassportSharesView(APIView):
    """GET/POST /me/passport/shares/ — the owner's links, and making one."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = services.visible_shares(request.user)
        return Response(ShareSerializer(rows, many=True).data)

    def post(self, request):
        payload = ShareInputSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        share = services.create_share(request.user, payload.validated_data)
        return Response(ShareSerializer(share).data, status=status.HTTP_201_CREATED)


class PassportShareRevokeView(APIView):
    """POST /me/passport/shares/<id>/revoke/ — the link stops working now."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        share = services.revoke_share(request.user, pk)
        return Response(ShareSerializer(share).data)


class PassportCorrectionsView(APIView):
    """POST /me/passport/corrections/ — ask Danpa HQ to review a record."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = CorrectionInputSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        correction = services.request_correction(request.user, **payload.validated_data)
        state = correction_states(request.user)[(correction.record_type, correction.record_id)]
        return Response(
            {"record_type": correction.record_type, "record_id": correction.record_id, **state},
            status=status.HTTP_201_CREATED,
        )


class SharedPassportView(APIView):
    """POST /passport-shares/open/ — a recipient opening a link."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [PassportViewIpThrottle]

    def post(self, request):
        payload = OpenShareSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        share, view = services.open_share(payload.validated_data["token"])
        response = Response(
            {
                **view,
                "share": {
                    "recipient_label": share.recipient_label,
                    "issued_at": share.created_at,
                    "expires_at": share.expires_at,
                },
            }
        )
        return _private(response)

    def handle_exception(self, exc):
        return _private(super().handle_exception(exc))


def _private(response):
    """A shared passport is for one reader: never cached, indexed or referred on."""
    response["Cache-Control"] = "no-store, private"
    response["X-Robots-Tag"] = "noindex, nofollow"
    response["Referrer-Policy"] = "no-referrer"
    return response
