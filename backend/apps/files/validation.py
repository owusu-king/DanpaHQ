"""File type and size validation.

Deliberately **not** python-magic: it needs libmagic, which on Windows means
hunting down a DLL. The brief says no unnecessary Linux-only dependencies, and
the set of formats this product accepts is small enough to sniff directly.

The rule this module exists to enforce: **never trust the client.** A browser's
`Content-Type` header and a file's extension are both attacker-controlled. The
only thing worth believing is the first few bytes of the object, read back from
storage after the upload lands.

Three checks, in order of trust:

1. Declared type is on the allow-list for the stated purpose (cheap, pre-upload).
2. Declared size is within the limit for that purpose (cheap, pre-upload).
3. **The bytes actually are what was claimed** (after upload, authoritative).

Step 3 is what stops someone uploading a polyglot or an executable renamed to
.jpg. A file that fails it is quarantined, never linked to evidence.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = [
    "LIMITS",
    "FileValidationError",
    "effective_max_bytes",
    "sniff_content_type",
    "validate_declared_upload",
    "validate_uploaded_bytes",
]


class FileValidationError(ValueError):
    """Raised with a message written for the person who uploaded the file."""


@dataclass(frozen=True, slots=True)
class PurposeLimits:
    max_bytes: int
    content_types: frozenset[str]
    human: str


MB = 1024 * 1024

#: Per-purpose limits. Sized for the market: a mid-range Android camera photo is
#: 2-5MB, and a tenant on metered data should not be asked to upload 20MB of
#: anything. Identity documents are capped tighter than property photos because
#: a legible Ghana Card photo needs far less.
LIMITS: dict[str, PurposeLimits] = {
    "identity_document": PurposeLimits(
        max_bytes=8 * MB,
        content_types=frozenset({"image/jpeg", "image/png", "image/heic", "application/pdf"}),
        human="a photo or PDF up to 8MB",
    ),
    "property_photo": PurposeLimits(
        max_bytes=12 * MB,
        content_types=frozenset({"image/jpeg", "image/png", "image/webp", "image/heic"}),
        human="a photo up to 12MB",
    ),
    "property_document": PurposeLimits(
        max_bytes=15 * MB,
        content_types=frozenset({"application/pdf", "image/jpeg", "image/png"}),
        human="a PDF or photo up to 15MB",
    ),
    "lease_document": PurposeLimits(
        max_bytes=15 * MB,
        content_types=frozenset({"application/pdf"}),
        human="a PDF up to 15MB",
    ),
    "payment_evidence": PurposeLimits(
        max_bytes=8 * MB,
        content_types=frozenset({"image/jpeg", "image/png", "application/pdf"}),
        human="a screenshot or PDF up to 8MB",
    ),
    "maintenance_photo": PurposeLimits(
        max_bytes=12 * MB,
        content_types=frozenset({"image/jpeg", "image/png", "image/webp", "image/heic"}),
        human="a photo up to 12MB",
    ),
    # A clip of at most five seconds (apps.maintenance). Clients cut it on the
    # device, so a real clip is a few MB; the cap leaves room for a phone that
    # records at a high bitrate, and is what stops a full-length video landing.
    "maintenance_video": PurposeLimits(
        max_bytes=30 * MB,
        content_types=frozenset({"video/mp4", "video/quicktime", "video/webm"}),
        human="a video clip up to 30MB",
    ),
    "avatar": PurposeLimits(
        max_bytes=5 * MB,
        content_types=frozenset({"image/jpeg", "image/png", "image/webp"}),
        human="a photo up to 5MB",
    ),
    "other": PurposeLimits(
        max_bytes=8 * MB,
        content_types=frozenset({"image/jpeg", "image/png", "application/pdf"}),
        human="a photo or PDF up to 8MB",
    ),
}


def effective_max_bytes(purpose: str) -> int:
    """The smaller of the product limit and the configured scanner's limit."""
    from django.conf import settings

    allowed = LIMITS[purpose].max_bytes
    if getattr(settings, "FILE_SCAN_MODE", "strict") == "cloudmersive":
        from .scanner import CLOUDMERSIVE_MAX_BYTES

        return min(allowed, CLOUDMERSIVE_MAX_BYTES)
    return allowed

#: Magic-number signatures. ``(offset, bytes, content_type)``.
_SIGNATURES: list[tuple[int, bytes, str]] = [
    (0, b"\xff\xd8\xff", "image/jpeg"),
    (0, b"\x89PNG\r\n\x1a\n", "image/png"),
    (0, b"%PDF-", "application/pdf"),
    (0, b"GIF87a", "image/gif"),
    (0, b"GIF89a", "image/gif"),
]

#: Container formats where the marker sits after a length-prefixed header.
_RIFF_BRANDS = {b"WEBP": "image/webp"}
_FTYP_BRANDS = {
    b"heic": "image/heic",
    b"heix": "image/heic",
    b"hevc": "image/heic",
    b"mif1": "image/heic",
    b"heim": "image/heic",
    # ISO base media video. Phones write `mp42`/`isom`; iPhones write `qt  `.
    b"isom": "video/mp4",
    b"iso2": "video/mp4",
    b"iso4": "video/mp4",
    b"iso5": "video/mp4",
    b"iso6": "video/mp4",
    b"mp41": "video/mp4",
    b"mp42": "video/mp4",
    b"avc1": "video/mp4",
    b"M4V ": "video/mp4",
    b"dash": "video/mp4",
    b"qt  ": "video/quicktime",
}

#: WebM (and Matroska) open with the EBML magic; it is what a browser's
#: MediaRecorder writes in Chrome and Firefox.
_EBML = b"\x1a\x45\xdf\xa3"

#: Signatures that must never appear, whatever the extension says. Executables
#: and archives are how a file-sharing feature becomes a malware channel.
_FORBIDDEN: list[tuple[bytes, str]] = [
    (b"MZ", "a Windows executable"),
    (b"\x7fELF", "a Linux executable"),
    (b"PK\x03\x04", "an archive"),
    (b"\xca\xfe\xba\xbe", "a Java class file"),
    (b"#!", "a script"),
    (b"<?php", "a PHP script"),
    (b"<script", "a script"),
    (b"<!DOCTYPE html", "an HTML file"),
    (b"<html", "an HTML file"),
]

HEADER_BYTES = 64


def sniff_content_type(header: bytes) -> str | None:
    """Identify a file from its first bytes, or ``None`` if unrecognised."""
    if not header:
        return None

    for offset, magic, content_type in _SIGNATURES:
        if header[offset : offset + len(magic)] == magic:
            return content_type

    # RIFF....WEBP
    if header[:4] == b"RIFF" and len(header) >= 12:
        brand = _RIFF_BRANDS.get(header[8:12])
        if brand:
            return brand

    # ....ftypXXXX  (HEIC and friends, MP4 and QuickTime video)
    if len(header) >= 12 and header[4:8] == b"ftyp":
        return _FTYP_BRANDS.get(header[8:12])

    if header[:4] == _EBML:
        return "video/webm"

    return None


def _forbidden_reason(header: bytes) -> str | None:
    lowered = header.lower()
    for magic, description in _FORBIDDEN:
        if header.startswith(magic) or lowered.startswith(magic.lower()):
            return description
    return None


def validate_declared_upload(*, purpose: str, content_type: str, size_bytes: int) -> PurposeLimits:
    """Pre-upload check on what the client *says* it is sending.

    Cheap and advisory. Passing this does not mean the file is acceptable - it
    means it is worth issuing a presigned URL for.
    """
    limits = LIMITS.get(purpose)
    if limits is None:
        raise FileValidationError("We do not accept uploads for that purpose.")

    normalised = (content_type or "").split(";")[0].strip().lower()
    if normalised not in limits.content_types:
        raise FileValidationError(f"That file type is not accepted here. Send {limits.human}.")

    if size_bytes <= 0:
        raise FileValidationError("That file appears to be empty.")

    if size_bytes > limits.max_bytes:
        actual = size_bytes / MB
        allowed = limits.max_bytes / MB
        raise FileValidationError(
            f"That file is {actual:.1f}MB. The limit here is {allowed:.0f}MB — "
            f"try a smaller photo, or one taken at a lower resolution."
        )

    return limits


def validate_uploaded_bytes(
    *, purpose: str, header: bytes, actual_size: int, declared_content_type: str
) -> str:
    """Authoritative post-upload check. Returns the true content type.

    Runs against bytes read back from storage, so it cannot be fooled by a
    client that lied at presign time or uploaded something different afterwards.
    """
    limits = LIMITS[purpose]

    forbidden = _forbidden_reason(header)
    if forbidden:
        raise FileValidationError(
            f"That file is {forbidden}, not a document or photo. It has not been saved."
        )

    if actual_size > limits.max_bytes:
        raise FileValidationError(f"That file is larger than the {limits.max_bytes // MB}MB limit.")
    if actual_size <= 0:
        raise FileValidationError("That file is empty.")

    detected = sniff_content_type(header)
    if detected is None:
        raise FileValidationError(f"We could not recognise that file. Send {limits.human}.")

    if detected not in limits.content_types:
        raise FileValidationError(
            f"That file is a {detected.split('/')[-1].upper()}, which is not accepted here. "
            f"Send {limits.human}."
        )

    # A mismatch between claim and reality is not necessarily an attack - phones
    # mislabel HEIC constantly - so it is not fatal by itself. What matters is
    # that the *detected* type is allowed, and the detected type is what gets
    # stored and served.
    return detected
