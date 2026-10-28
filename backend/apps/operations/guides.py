"""Small, ordered video guide collection. Draft assets never enter the public feed."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import UUID

from django.db import transaction
from rest_framework import serializers

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import Conflict, ValidationFailed
from apps.files.models import StoredFile
from apps.files.storage import get_storage

from .models import HowItWorksContent

CONTENT_ID = UUID("00000000-0000-4000-8000-000000000001")
FILE_FIELDS = {
    "video_file_id": "guide_video",
    "thumbnail_file_id": "guide_thumbnail",
    "captions_file_id": "guide_captions",
}


def default_guides():
    rows = [
        (
            "welcome",
            "Welcome to Danpa HQ",
            "Get to know the essentials: finding a place, managing property, "
            "and working with skilled artisans.",
        ),
        (
            "find-a-place",
            "Find your next place",
            "Explore properties, refine your search, "
            "and take a closer look at the places that suit you.",
        ),
        (
            "viewings",
            "Viewings and applications",
            "Arrange a viewing and understand what happens when you apply for a tenancy.",
        ),
        (
            "agreements",
            "Your agreement",
            "Read the terms, review the details, and keep your agreement within reach.",
        ),
        (
            "rent",
            "Rent and receipts",
            "Follow rent due, payment confirmations, and the records that keep everyone informed.",
        ),
        (
            "provider",
            "Your provider workspace",
            "Bring your properties, tenants, agreements, and finances together in one workspace.",
        ),
        (
            "artisans",
            "Working with artisans",
            "Find skilled help, agree on the work, and follow each job through to completion.",
        ),
        (
            "support",
            "Support when you need it",
            "Find the right guidance and know how to reach our team when you need a hand.",
        ),
    ]
    return [
        {
            "id": key,
            "title": title,
            "description": description,
            "published": True,
            "url": "/videos/welcome.mp4" if key == "welcome" else "",
            **dict.fromkeys(FILE_FIELDS),
        }
        for key, title, description in rows
    ]


def video_source(value):
    """Normalize known embed providers; never accept HTML or arbitrary iframe origins."""
    if not value:
        return None, "video"
    if (re.fullmatch(r"/videos/[A-Za-z0-9_./-]+\.(mp4|webm)", value)
            and ".." not in value.split("/")):
        return value, "video"
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not host or parsed.username or parsed.password:
            raise ValueError
        parts = parsed.path.strip("/").split("/")
        query = parse_qs(parsed.query)
        if host in {
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "youtu.be",
            "www.youtube-nocookie.com",
            "youtube-nocookie.com",
        }:
            video_id = (
                parts[0]
                if host == "youtu.be"
                else query.get("v", [""])[0]
                if parsed.path == "/watch"
                else parts[1]
                if len(parts) == 2 and parts[0] in {"shorts", "embed"}
                else ""
            )
            if re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
                return f"https://www.youtube-nocookie.com/embed/{video_id}?rel=0", "youtube"
            raise ValueError
        if host in {"vimeo.com", "www.vimeo.com", "player.vimeo.com"}:
            index = 1 if host == "player.vimeo.com" and parts[0] == "video" else 0
            video_id = parts[index]
            if not re.fullmatch(r"[0-9]+", video_id):
                raise ValueError
            private = query.get("h", [""])[0] or (
                parts[index + 1] if len(parts) > index + 1 else ""
            )
            suffix = (
                "?" + urlencode({"h": private}) if re.fullmatch(r"[A-Za-z0-9]+", private) else ""
            )
            return f"https://player.vimeo.com/video/{video_id}{suffix}", "vimeo"
        if parsed.path.lower().endswith((".mp4", ".webm")):
            return value, "video"
    except (ValueError, IndexError):
        pass
    raise ValidationFailed("Use an HTTPS MP4/WebM, YouTube or Vimeo video link.")


class GuideInput(serializers.Serializer):
    id = serializers.SlugField(max_length=64)
    title = serializers.CharField(max_length=120)
    description = serializers.CharField(max_length=500, allow_blank=True)
    url = serializers.CharField(max_length=2048, allow_blank=True)
    published = serializers.BooleanField()
    video_file_id = serializers.UUIDField(allow_null=True, required=False, default=None)
    thumbnail_file_id = serializers.UUIDField(allow_null=True, required=False, default=None)
    captions_file_id = serializers.UUIDField(allow_null=True, required=False, default=None)

    def validate(self, attrs):
        video_source(attrs["url"])
        if attrs["url"] and attrs["video_file_id"]:
            raise serializers.ValidationError("Choose a video link or an uploaded video, not both.")
        for field, purpose in FILE_FIELDS.items():
            file_id = attrs.get(field)
            if (
                file_id
                and not StoredFile.objects.filter(
                    id=file_id,
                    purpose=purpose,
                    upload_status="ready",
                    scan_status="clean",
                    owner_id_snapshot__startswith="management:",
                ).exists()
            ):
                raise serializers.ValidationError("Choose a checked How It Works upload.")
            attrs[field] = str(file_id) if file_id else None
        return attrs


class ContentInput(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)
    guides = GuideInput(many=True, max_length=10, allow_empty=True)

    def validate_guides(self, guides):
        keys = [item["id"] for item in guides]
        if len(keys) != len(set(keys)):
            raise serializers.ValidationError("Chapter IDs must be unique.")
        return guides


def file_url(stored):
    if not stored or not stored.is_usable:
        return None
    return (
        get_storage()
        .presign_download(
            key=stored.storage_key,
            expires_in=3600,
            filename=stored.original_filename,
            disposition="inline",
        )
        .url
    )


def present_guides(guides, *, public=False):
    ids = [item[field] for item in guides for field in FILE_FIELDS if item.get(field)]
    files = {str(row.id): row for row in StoredFile.objects.filter(id__in=ids)}
    result = []
    for item in guides:
        if public and not item["published"]:
            continue
        src, kind = video_source(item["url"])
        video = files.get(item.get("video_file_id"))
        if item.get("video_file_id"):
            src = file_url(video) if video and video.purpose == "guide_video" else None
            kind = "video"

        def asset(field, row=item):
            stored = files.get(row.get(field))
            return file_url(stored) if stored and stored.purpose == FILE_FIELDS[field] else None

        public_item = {
            "id": item["id"],
            "title": item["title"],
            "description": item["description"],
            "src": src,
            "kind": kind,
            "thumbnail": asset("thumbnail_file_id"),
            "captions": asset("captions_file_id"),
            "unavailable": bool(item.get("video_file_id") and not src),
        }
        result.append(public_item if public else {**item, **public_item})
    return result


def content_payload(*, public=False):
    content = HowItWorksContent.objects.filter(id=CONTENT_ID).first()
    guides = content.guides if content else default_guides()
    return {
        "revision": content.revision if content else 0,
        "guides": present_guides(guides, public=public),
    }


@transaction.atomic
def save_content(*, actor, data):
    content, _ = HowItWorksContent.objects.select_for_update().get_or_create(id=CONTENT_ID)
    if content.revision != data["revision"]:
        raise Conflict("Another administrator updated these guides. Reload before saving.")
    content.guides = data["guides"]
    content.revision += 1
    content.save(update_fields=["guides", "revision", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="how_it_works",
        aggregate_id=content.id,
        management_actor=actor,
        metadata={"revision": content.revision, "chapters": len(content.guides)},
    )
    return content_payload()
