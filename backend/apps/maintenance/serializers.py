"""The maintenance request as both sides read it.

Every serializer here is only ever handed a request the reader may see
(``services.get_visible`` / the scoped list views), so the photograph and video
are signed inline for them: an ``<img>`` or ``<video>`` cannot send a bearer
token, and the reader is a party to the request. The file gate still applies —
nothing unscanned is ever signed.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.files.models import FilePurpose

from .models import MaintenanceCategory, MaintenanceRequest

#: Long enough to watch a clip on a slow connection; short enough that a copied
#: link is not a lasting handout. Matches the inline photograph lifetime.
INLINE_TTL_SECONDS = 300

_MEDIA_PURPOSES = {FilePurpose.MAINTENANCE_PHOTO, FilePurpose.MAINTENANCE_VIDEO}


def _media(file) -> dict | None:
    if file is None or not file.is_usable or file.purpose not in _MEDIA_PURPOSES:
        return None
    from apps.files.storage import get_storage

    url = (
        get_storage()
        .presign_download(
            key=file.storage_key,
            expires_in=INLINE_TTL_SECONDS,
            filename=file.original_filename,
            disposition="inline",
        )
        .url
    )
    return {"id": str(file.id), "url": url, "content_type": file.content_type}


class MaintenanceRequestSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    tenant = serializers.SerializerMethodField()
    place = serializers.SerializerMethodField()
    photo = serializers.SerializerMethodField()
    video = serializers.SerializerMethodField()
    events = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceRequest
        fields = [
            "id",
            "tenancy_id",
            "status",
            "status_display",
            "category",
            "category_display",
            "description",
            "tenant",
            "place",
            "photo",
            "video",
            "video_clip_start_ms",
            "video_clip_end_ms",
            "reopen_count",
            "created_at",
            "status_changed_at",
            "started_at",
            "fixed_reported_at",
            "completed_at",
            "reopened_at",
            "events",
        ]

    def get_tenant(self, obj):
        return {"id": str(obj.tenant_id), "name": obj.tenant.display_name}

    def get_place(self, obj):
        return {
            "property_id": str(obj.property_id),
            "property_title": obj.property.title,
            "unit_id": str(obj.unit_id),
            "unit_label": obj.unit.label,
            "bed_label": obj.bed.label if obj.bed_id else None,
        }

    def get_photo(self, obj):
        return _media(obj.photo)

    def get_video(self, obj):
        return _media(obj.video)

    def get_events(self, obj):
        return [
            {
                "id": str(event.id),
                "kind": event.kind,
                "kind_display": event.get_kind_display(),
                "to_status": event.to_status,
                "note": event.note,
                "actor_name": event.actor.display_name if event.actor_id else "",
                "at": event.created_at,
            }
            for event in obj.events.all()
        ]


class SubmitRequestSerializer(serializers.Serializer):
    tenancy_id = serializers.UUIDField()
    category = serializers.ChoiceField(choices=MaintenanceCategory.choices)
    description = serializers.CharField(max_length=2000)
    photo_file_id = serializers.UUIDField()
    video_file_id = serializers.UUIDField(required=False, allow_null=True)
    #: What the device measured. Used only to insist on a window for a long file.
    video_duration_ms = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    video_clip_start_ms = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    video_clip_end_ms = serializers.IntegerField(required=False, allow_null=True, min_value=1)


class NoteSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)
