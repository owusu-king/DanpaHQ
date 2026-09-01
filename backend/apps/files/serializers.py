"""Upload API serializers."""

from __future__ import annotations

from rest_framework import serializers

from .models import FilePurpose, StoredFile
from .validation import LIMITS


class ReserveUploadSerializer(serializers.Serializer):
    purpose = serializers.ChoiceField(choices=FilePurpose.choices)
    filename = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=120)
    size_bytes = serializers.IntegerField(min_value=1)

    def validate_filename(self, value: str) -> str:
        """Keep only the base name.

        The filename is display text, never a path - the storage key is chosen
        by the server. Stripping separators here means a filename can never be
        mistaken for a location later, whatever a future caller does with it.
        """
        cleaned = value.replace("\\", "/").split("/")[-1].strip()
        if not cleaned or cleaned in {".", ".."}:
            raise serializers.ValidationError("That file needs a name.")
        return cleaned[:255]


class PresignedUploadSerializer(serializers.Serializer):
    """What the client needs to perform the upload itself."""

    file_id = serializers.UUIDField()
    url = serializers.CharField()
    method = serializers.CharField()
    headers = serializers.DictField(child=serializers.CharField(), required=False)
    fields = serializers.DictField(child=serializers.CharField(), required=False)
    expires_in = serializers.IntegerField()
    max_bytes = serializers.IntegerField()


class StoredFileSerializer(serializers.ModelSerializer):
    """The owner's view of their own file.

    Note what is absent: `storage_key` and `bucket`. Where an object physically
    lives is not the client's business, and exposing it invites someone to try
    reaching it directly.
    """

    is_usable = serializers.BooleanField(read_only=True)
    status_message = serializers.SerializerMethodField()

    class Meta:
        model = StoredFile
        fields = [
            "id",
            "original_filename",
            "content_type",
            "size_bytes",
            "purpose",
            "upload_status",
            "scan_status",
            "is_usable",
            "is_sensitive",
            "rejection_reason",
            "status_message",
            "uploaded_at",
            "created_at",
        ]
        read_only_fields = fields

    def get_status_message(self, obj) -> str:
        """One line, written for the person waiting on the upload."""
        return {
            "awaiting_upload": "Waiting for the file.",
            "uploaded": "Checking the file. This usually takes a few seconds.",
            "ready": "Ready.",
            "rejected": obj.rejection_reason or "This file was not accepted.",
            "expired": "This upload took too long. Start again.",
        }.get(obj.upload_status, "")


class UploadLimitsSerializer(serializers.Serializer):
    """Advertised so clients can validate before spending a user's data.

    Checking a 15MB file locally and telling someone immediately is far kinder
    than uploading it over a metered connection and rejecting it afterwards.
    """

    @staticmethod
    def payload() -> dict:
        return {
            purpose: {
                "max_bytes": limits.max_bytes,
                "content_types": sorted(limits.content_types),
                "description": limits.human,
            }
            for purpose, limits in LIMITS.items()
        }


class AttachEvidenceSerializer(serializers.Serializer):
    file_id = serializers.UUIDField()
    evidence_type = serializers.CharField(max_length=32)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=600)
