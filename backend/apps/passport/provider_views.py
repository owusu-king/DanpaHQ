from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import NotFound
from apps.files.storage import get_storage

from . import provider
from .models import ProviderPassportDocument


class PrivatePassportView(APIView):
    permission_classes = [IsAuthenticated]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store, private"
        response["X-Robots-Tag"] = "noindex, nofollow"
        response["Referrer-Policy"] = "no-referrer"
        return response


class ProviderPassportView(PrivatePassportView):
    def get(self, request, pk):
        return Response(provider.assemble(provider.authorized(pk, request.user)))

    def patch(self, request, pk):
        payload = provider.PassportInput(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        return Response(
            provider.assemble(provider.update(pk, request.user, payload.validated_data))
        )


class ProviderPassportSubmitView(PrivatePassportView):
    def post(self, request, pk):
        return Response(provider.assemble(provider.submit(pk, request.user)))


class ProviderPassportDocumentsView(PrivatePassportView):
    def post(self, request, pk):
        payload = provider.DocumentInput(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(
            provider.assemble(provider.add_document(pk, request.user, payload.validated_data))
        )


class ProviderPassportDocumentView(PrivatePassportView):
    def delete(self, request, pk, document_pk):
        return Response(provider.assemble(provider.remove_document(pk, document_pk, request.user)))


class ProviderPassportDownloadView(PrivatePassportView):
    def get(self, request, pk, document_pk=None):
        organization = provider.authorized(pk, request.user)
        passport = provider.draft(organization)
        if document_pk:
            document = (
                ProviderPassportDocument.objects.select_related("file")
                .filter(passport=passport, id=document_pk)
                .first()
            )
            stored = document.file if document else None
        else:
            person = provider.representative(organization, passport)
            if not provider.identity(person, organization)["photo_on_record"]:
                raise NotFound("That photo is not available.")
            stored = getattr(getattr(person, "profile", None), "avatar", None)
        if not stored or not stored.is_usable or stored.deleted_at is not None:
            raise NotFound("That file is not available.")
        signed = get_storage().presign_download(
            key=stored.storage_key, expires_in=60, filename=stored.original_filename
        )
        record(
            action=AuditAction.VIEW,
            aggregate_type="file",
            aggregate_id=stored.id,
            actor=request.user,
            metadata={"purpose": "provider_passport_review", "organization_id": str(pk)},
        )
        return Response({"url": signed.url, "expires_in": signed.expires_in})
