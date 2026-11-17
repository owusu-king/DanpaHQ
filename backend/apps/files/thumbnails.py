"""Short-lived previews for private Property cards."""

from __future__ import annotations

from io import BytesIO
from urllib.parse import urlencode

from django.core import signing
from django.http import Http404, HttpResponse, HttpResponseRedirect
from django.urls import reverse
from django.views.decorators.http import require_safe
from PIL import Image, ImageOps

from apps.core.cache import cache_get, cache_set

from .models import StoredFile
from .photos import INLINE_TTL_SECONDS, inline_image_url, is_renderable_photo
from .storage import StorageError, get_storage

_SALT = "property-card-thumbnail-v1"
_MIN_BYTES = 64 * 1024
_MAX_BYTES = 12 * 1024 * 1024
_MAX_PIXELS = 24_000_000
_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}


def _can_thumbnail(file: StoredFile | None) -> bool:
    return (
        file is not None
        and is_renderable_photo(file)
        and file.content_type in _FORMATS
        and file.size_bytes is not None
        and _MIN_BYTES < file.size_bytes <= _MAX_BYTES
    )


def thumbnail_url(file: StoredFile | None, *, request) -> str | None:
    if file is None or not _can_thumbnail(file):
        return None
    token = signing.dumps(str(file.pk), salt=_SALT)
    path = reverse("v1:file-thumbnail", kwargs={"pk": file.pk})
    return request.build_absolute_uri(f"{path}?{urlencode({'token': token})}")


def _resize(file: StoredFile) -> bytes:
    raw = get_storage().read(key=file.storage_key, length=_MAX_BYTES + 1)
    if len(raw) > _MAX_BYTES:
        return b""
    with Image.open(BytesIO(raw), formats=[_FORMATS[file.content_type]]) as image:
        if image.width * image.height > _MAX_PIXELS:
            return b""
        image.thumbnail((320, 320), reducing_gap=2.0)
        with ImageOps.exif_transpose(image) as oriented, BytesIO() as output:
            oriented.convert("RGB").save(output, format="JPEG", quality=78)
            preview = output.getvalue()
            return preview if len(preview) < len(raw) else b""


@require_safe
def download_thumbnail(request, pk):
    try:
        signed_id = signing.loads(
            request.GET.get("token", ""), salt=_SALT, max_age=INLINE_TTL_SECONDS
        )
    except signing.BadSignature as exc:
        raise Http404 from exc
    if signed_id != str(pk):
        raise Http404

    file = StoredFile.objects.filter(pk=pk).first()
    if file is None or not _can_thumbnail(file):
        raise Http404
    key = f"photo-thumb:v1:{file.pk}:{file.checksum_sha256}"
    preview = cache_get(key)
    if preview is None:
        try:
            preview = _resize(file)
        except StorageError as exc:
            raise Http404 from exc
        except (OSError, ValueError, Image.DecompressionBombError):
            preview = b""
        cache_set(key, preview, timeout=3600)

    if preview:
        response = HttpResponse(preview, content_type="image/jpeg")
    else:
        original = inline_image_url(file)
        if original is None:
            raise Http404
        response = HttpResponseRedirect(original)
    response["Cache-Control"] = "private, no-store"
    return response
