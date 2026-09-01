"""Upload API.

The flow a client follows:

    POST /files/uploads/            -> file_id + presigned URL
    PUT/POST directly to storage    -> the bytes never touch Django
    POST /files/uploads/<id>/complete/  -> server verifies and releases
    GET  /files/<id>/download/      -> short-lived signed read URL

Every endpoint requires authentication, and every one that names a file checks
ownership. There is no public read path.
"""

from __future__ import annotations

from django.http import HttpResponse, HttpResponseForbidden
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound

# IsPhoneVerified is imported inside classes to keep the module-level graph acyclic.
from . import services, storage
from .models import StoredFile
from .serializers import (
    PresignedUploadSerializer,
    ReserveUploadSerializer,
    StoredFileSerializer,
    UploadLimitsSerializer,
)
from .storage import LocalStorageBackend, get_storage
from .validation import LIMITS


class UploadLimitsView(APIView):
    """GET /files/limits/ — what may be uploaded, so clients can check locally."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UploadLimitsSerializer.payload())


class ReserveUploadView(APIView):
    """POST /files/uploads/ — reserve a slot and get a presigned URL.

    Phone verification is required. Uploading identity documents is not
    something an unproven account should be able to do at volume.
    """

    @property
    def permission_classes(self):
        from apps.identity.permissions import IsPhoneVerified  # function-scope

        return [IsAuthenticated, IsPhoneVerified]

    def post(self, request):
        payload = ReserveUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        stored, presigned = services.reserve_upload(
            user=request.user,
            purpose=data["purpose"],
            filename=data["filename"],
            content_type=data["content_type"],
            size_bytes=data["size_bytes"],
        )

        # Point the upload at an address this client can actually reach. The
        # configured origin is a loopback in local development, which is the
        # host machine's own address and therefore useless to a phone.
        origin = storage.reachable_upload_origin(request)

        body = PresignedUploadSerializer(
            {
                "file_id": stored.id,
                "url": storage.rehost(presigned.url, origin),
                "method": presigned.method,
                "headers": presigned.headers,
                "fields": presigned.fields,
                "expires_in": presigned.expires_in,
                "max_bytes": LIMITS[data["purpose"]].max_bytes,
            }
        ).data
        return Response(body, status=status.HTTP_201_CREATED)


class CompleteUploadView(APIView):
    """POST /files/uploads/<id>/complete/ — verify and release the file.

    Idempotent: a client that retries on a flaky connection gets the same
    answer rather than an error.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        stored = services.complete_upload(user=request.user, file_id=pk)
        return Response(StoredFileSerializer(stored).data)


class FileDetailView(APIView):
    """GET /files/<id>/ — the owner's view of one upload."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        stored = StoredFile.objects.filter(id=pk).first()
        if stored is None or not services.can_read(user=request.user, stored=stored):
            raise NotFound("We could not find that file.")
        return Response(StoredFileSerializer(stored).data)


class FileDownloadView(APIView):
    """GET /files/<id>/download/ — a short-lived signed URL.

    Returns a URL rather than the bytes so the download goes straight from
    storage to the client. Sensitive files get a 60-second URL and the read is
    written to the audit log.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        stored = StoredFile.objects.filter(id=pk).first()
        if stored is None:
            raise NotFound("We could not find that file.")

        presigned = services.issue_download(
            user=request.user,
            stored=stored,
            reason=request.query_params.get("reason", ""),
        )
        return Response({"url": presigned.url, "expires_in": presigned.expires_in})


# --- local storage receiver --------------------------------------------------
#
# Only mounted when STORAGE_BACKEND=local. With S3 these views do not exist and
# the client talks to object storage directly.


@api_view(["PUT"])
@permission_classes([AllowAny])
def local_upload(request, key: str):
    """Receive an upload for the local filesystem backend.

    `AllowAny` is not an oversight: the presigned URL *is* the credential, and
    it is verified below. That is the same model S3 uses - the difference is
    only that here we are the ones checking the signature.

    The signature covers the key, the content type, the size limit and the
    expiry, so none of them can be altered by editing the query string.
    """
    storage = get_storage()
    if not isinstance(storage, LocalStorageBackend):
        return HttpResponse("Not available with this storage backend.", status=404)

    try:
        expires = int(request.query_params.get("expires", "0"))
        max_bytes = int(request.query_params.get("max_bytes", "0"))
    except ValueError:
        return HttpResponseForbidden("Malformed upload URL.")

    signature = request.query_params.get("signature", "")
    content_type = request.query_params.get("content_type", "")

    if not storage.verify(
        key=key,
        operation="PUT",
        expires=expires,
        signature=signature,
        content_type=content_type,
        max_bytes=max_bytes,
    ):
        return HttpResponseForbidden("This upload link is not valid or has expired.")

    body = request.body
    if len(body) > max_bytes:
        return HttpResponse("That file is larger than the limit for this upload.", status=413)
    if not body:
        return HttpResponse("That file is empty.", status=400)

    storage.write(key=key, data=body)
    return Response({"stored": True, "size_bytes": len(body)}, status=201)


@api_view(["GET"])
@permission_classes([AllowAny])
def local_download(request, key: str):
    """Serve a file for the local backend, against a signed URL."""
    storage = get_storage()
    if not isinstance(storage, LocalStorageBackend):
        return HttpResponse("Not available with this storage backend.", status=404)

    try:
        expires = int(request.query_params.get("expires", "0"))
    except ValueError:
        return HttpResponseForbidden("Malformed download URL.")

    if not storage.verify(
        key=key,
        operation="GET",
        expires=expires,
        signature=request.query_params.get("signature", ""),
    ):
        return HttpResponseForbidden("This link is not valid or has expired.")

    try:
        data = storage.read(key=key)
    except Exception:
        raise NotFound("We could not find that file.") from None

    # `inline` is only ever honoured for an image, and the content type is set
    # from what the file actually is rather than from what the URL asked for —
    # `nosniff` plus an image type is what makes displaying it safe. Anything
    # else stays an octet-stream attachment, which a browser will not render or
    # execute.
    inline = request.query_params.get("disposition") == "inline"
    stored = StoredFile.objects.filter(storage_key=key).first()
    is_image = bool(stored and (stored.content_type or "").startswith("image/"))

    if inline and is_image:
        response = HttpResponse(data, content_type=stored.content_type)
        response["Content-Disposition"] = "inline"
    else:
        response = HttpResponse(data, content_type="application/octet-stream")
        filename = request.query_params.get("filename")
        if filename:
            response["Content-Disposition"] = f'attachment; filename="{filename}"'

    # Never let a proxy or browser keep a copy of a signed private object.
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
