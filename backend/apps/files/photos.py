"""A URL an ``<img>`` can actually load.

``GET /api/v1/files/<id>/download/`` does not serve bytes. It returns
``{"url": ..., "expires_in": ...}`` so the read goes straight from object
storage to the client without passing through Django, and it requires a bearer
token. Neither of those is something an ``<img src>`` can do: unauthenticated it
answers 401, and authenticated it answers JSON.

Three serializers handed that path out as ``download_url`` for every read that
was not the public one, which is every provider-side read there is. So the Unit
page, the Units list, the Property page, the photo manager and the listing card
for anything not currently advertised all pointed an ``<img>`` at a JSON
endpoint. `apps.trust.condition._provided_detail` had already found this and
worked around it locally, and its comment says so: *"which is how every listing
photograph on this product once failed to appear inside an ``<img>``"*.

This is that fix, in one place, for everybody.

**What it does not change.** The gate is unchanged and deliberately strict: an
image URL is issued only for a usable, non-sensitive **property photograph**.
Identity documents, property documents and verification evidence keep the
audited endpoint, because reading those is a thing the audit log should record
and a 300-second anonymous link is not that. Anything this refuses falls back to
exactly today's behaviour, so nothing that used to be private becomes public.
"""

from __future__ import annotations

#: Long enough to load a page of photographs on a slow connection, short enough
#: that a copied URL is not a lasting handout. Matches the public gallery.
INLINE_TTL_SECONDS = 300


def is_renderable_photo(file) -> bool:
    """Whether this file is something a browser should be handed directly."""
    from apps.files.models import FilePurpose

    return bool(
        file is not None
        and file.is_usable
        and not file.is_sensitive
        and file.purpose == FilePurpose.PROPERTY_PHOTO
    )


def inline_image_url(file) -> str | None:
    """A short-lived URL that renders in an ``<img>``, or None.

    ``inline`` rather than the default ``attachment``: with an attachment
    disposition a browser downloads the file instead of painting it, which is
    the same class of bug in a different disguise — the request succeeds, the
    frame stays empty.
    """
    if not is_renderable_photo(file):
        return None

    from apps.files.storage import get_storage

    return (
        get_storage()
        .presign_download(
            key=file.storage_key,
            expires_in=INLINE_TTL_SECONDS,
            filename=file.original_filename,
            disposition="inline",
        )
        .url
    )


def viewable_url(file, file_id=None) -> str | None:
    """The best URL for this file: renderable if it is a photograph, else the
    audited endpoint the client resolves for itself.

    Callers use this instead of choosing, so "can this be shown" is answered the
    same way everywhere.
    """
    if file is None:
        return None
    url = inline_image_url(file)
    if url is not None:
        return url
    if not file.is_usable:
        return None
    return f"/api/v1/files/{file_id or file.id}/download/"
