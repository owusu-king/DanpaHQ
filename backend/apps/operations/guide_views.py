"""Public guide reading and capability-gated editorial/upload endpoints."""

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound
from apps.files import services, storage
from apps.files.models import StoredFile
from apps.files.serializers import (
    PresignedUploadSerializer,
    ReserveUploadSerializer,
    StoredFileSerializer,
)
from apps.files.validation import effective_max_bytes

from .guides import ContentInput, GuideInput, content_payload, present_guides, save_content
from .permissions import Capability
from .views import ManagementAPIView


class PublicGuidesView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        response = Response(content_payload(public=True))
        response["Cache-Control"] = "no-store"
        return response


class GuideContentView(ManagementAPIView):
    required_capability = Capability.MANAGE_CONFIGURATION

    def get(self, request):
        return Response(content_payload())

    def put(self, request):
        payload = ContentInput(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(save_content(actor=request.user, data=payload.validated_data))


class GuidePreviewView(ManagementAPIView):
    required_capability = Capability.MANAGE_CONFIGURATION

    def post(self, request):
        payload = GuideInput(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(present_guides([payload.validated_data])[0])


class GuideReserveUploadView(ManagementAPIView):
    required_capability = Capability.MANAGE_CONFIGURATION

    def post(self, request):
        payload = ReserveUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        stored, presigned = services.reserve_upload(user=request.user, **data)
        return Response(
            PresignedUploadSerializer(
                {
                    "file_id": stored.id,
                    "url": storage.rehost(presigned.url, storage.reachable_upload_origin(request)),
                    "method": presigned.method,
                    "headers": presigned.headers,
                    "fields": presigned.fields,
                    "expires_in": presigned.expires_in,
                    "max_bytes": effective_max_bytes(data["purpose"]),
                }
            ).data,
            status=201,
        )


class GuideUploadView(ManagementAPIView):
    required_capability = Capability.MANAGE_CONFIGURATION

    def get(self, request, pk):
        stored = StoredFile.objects.filter(id=pk).first()
        if not stored or not stored.is_owned_by(request.user):
            raise NotFound("We could not find that upload.")
        return Response(StoredFileSerializer(stored).data)

    def post(self, request, pk):
        stored = services.complete_upload(user=request.user, file_id=pk)
        return Response(StoredFileSerializer(stored).data)
