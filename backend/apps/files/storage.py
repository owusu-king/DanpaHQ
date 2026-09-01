"""Storage backends.

The requirement is that local development storage and production object storage
are interchangeable without rewriting the application. That means the
application never touches a filesystem path or an S3 client directly - it asks a
backend for a *presigned upload* and a *presigned download*, and the backend
decides what those mean.

Two backends ship:

* :class:`S3StorageBackend` — MinIO locally, any S3-compatible service in
  production. This is the real path, and it is what local development uses by
  default so the production code path is the one being exercised.
* :class:`LocalStorageBackend` — writes under ``MEDIA_ROOT`` and signs its own
  URLs with an HMAC. It exists for the case the brief actually cares about: a
  Windows developer who cannot or does not want to run Docker. It implements the
  *same* presigned-URL contract, so switching is a settings change.

The contract both must honour, and the reason each part exists:

1. **Uploads are direct to storage, not through Django.** A 10MB photo streamed
   through a Python worker occupies it for the whole upload; on a Ghanaian
   mobile connection that could be a minute. The API issues a short-lived
   presigned PUT and the device uploads to storage itself.
2. **The presign is constrained.** Content type and maximum size are baked into
   the signature, so a client that asked to upload a 2MB JPEG cannot then push a
   50MB executable to the same URL.
3. **Nothing is public.** Downloads are presigned too, minted only after a
   permission check, and they expire. There is no bucket policy that makes an
   object world-readable, and no code path that produces an unsigned URL.
4. **The key is chosen by the server.** Client-supplied paths are how you get
   directory traversal and how one user overwrites another's evidence.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

__all__ = [
    "ObjectNotFound",
    "PresignedDownload",
    "PresignedUpload",
    "StorageBackend",
    "StorageError",
    "get_storage",
    "reset_storage",
]


class StorageError(Exception):
    """Storage did not do what was asked. Always retryable from the caller's
    point of view; never the user's fault."""


class ObjectNotFound(StorageError):
    pass


@dataclass(frozen=True, slots=True)
class PresignedUpload:
    """Everything a client needs to upload, and nothing it does not."""

    url: str
    method: str  # PUT or POST
    headers: dict[str, str] = field(default_factory=dict)
    #: Extra form fields, for backends that use a POST policy rather than a PUT.
    fields: dict[str, str] = field(default_factory=dict)
    expires_in: int = 900


@dataclass(frozen=True, slots=True)
class PresignedDownload:
    url: str
    expires_in: int


class StorageBackend(ABC):
    """What the application is allowed to ask of storage."""

    name = "abstract"

    @abstractmethod
    def presign_upload(
        self, *, key: str, content_type: str, max_bytes: int, expires_in: int = 900
    ) -> PresignedUpload:
        """A short-lived, size- and type-constrained URL the client uploads to."""

    @abstractmethod
    def presign_download(
        self,
        *,
        key: str,
        expires_in: int = 300,
        filename: str | None = None,
        disposition: str = "attachment",
    ) -> PresignedDownload:
        """A short-lived read URL. Only ever minted after a permission check.

        ``disposition`` defaults to ``attachment``, which is right for a
        document: it downloads rather than opening in the tab, and a browser
        never executes it.

        Marketing photographs need ``inline``. With ``attachment`` a browser
        refuses to paint the image at all — Chrome blocks it as an opaque
        response — so a listing's gallery rendered as empty frames while every
        request came back 200. The caller says which it wants, because the
        storage layer cannot know whether a JPEG is a bedroom or a Ghana Card.
        """

    @abstractmethod
    def stat(self, *, key: str) -> tuple[int, str]:
        """Return ``(size_bytes, etag)``. Raises :class:`ObjectNotFound`.

        This is how the server confirms an upload actually happened and how big
        it really was, rather than trusting what the client claims.
        """

    @abstractmethod
    def read(self, *, key: str, length: int | None = None) -> bytes:
        """Read an object, or its first ``length`` bytes.

        Used to sniff the real content type from magic bytes, and to checksum.
        """

    @abstractmethod
    def delete(self, *, key: str) -> None:
        """Remove an object. Used by retention jobs and failed-upload cleanup."""

    @abstractmethod
    def exists(self, *, key: str) -> bool: ...


class LocalStorageBackend(StorageBackend):
    """Filesystem storage with self-signed URLs.

    For developers without Docker. It is a real implementation of the same
    contract, not a stub: uploads still go to a presigned URL, that URL still
    expires, still pins the content type and size, and files are still not
    reachable without a signature.

    The signature covers key, content type, size limit and expiry, so none of
    them can be altered by editing the query string.
    """

    name = "local"

    def __init__(self, root: Path | None = None, base_url: str | None = None):
        self.root = Path(
            root or getattr(settings, "LOCAL_STORAGE_ROOT", settings.BASE_DIR / "media")
        )
        self.base_url = (
            base_url or getattr(settings, "LOCAL_STORAGE_BASE_URL", "/storage")
        ).rstrip("/")
        self.root.mkdir(parents=True, exist_ok=True)

    # -- signing ------------------------------------------------------------
    def _key(self) -> bytes:
        secret = getattr(settings, "STORAGE_SIGNING_KEY", None) or settings.SECRET_KEY
        return secret.encode()

    def sign(
        self, *, key: str, operation: str, expires: int, content_type: str = "", max_bytes: int = 0
    ) -> str:
        material = f"{operation}|{key}|{expires}|{content_type}|{max_bytes}".encode()
        return hmac.new(self._key(), material, hashlib.sha256).hexdigest()

    def verify(
        self,
        *,
        key: str,
        operation: str,
        expires: int,
        signature: str,
        content_type: str = "",
        max_bytes: int = 0,
    ) -> bool:
        if time.time() >= expires:
            return False
        expected = self.sign(
            key=key,
            operation=operation,
            expires=expires,
            content_type=content_type,
            max_bytes=max_bytes,
        )
        return hmac.compare_digest(expected, signature)

    def path_for(self, key: str) -> Path:
        """Resolve a key to a path, refusing anything that escapes the root.

        Keys are server-generated, so traversal should be impossible - but this
        is the last line before the filesystem, and defence here is cheap.
        """
        candidate = (self.root / key).resolve()
        root = self.root.resolve()
        if not str(candidate).startswith(str(root)):
            raise StorageError("Refusing to resolve a key outside the storage root.")
        return candidate

    # -- contract -----------------------------------------------------------
    def presign_upload(self, *, key, content_type, max_bytes, expires_in=900):
        expires = int(time.time()) + expires_in
        signature = self.sign(
            key=key,
            operation="PUT",
            expires=expires,
            content_type=content_type,
            max_bytes=max_bytes,
        )
        url = (
            f"{self.base_url}/upload/{quote(key)}"
            f"?expires={expires}&signature={signature}"
            f"&content_type={quote(content_type)}&max_bytes={max_bytes}"
        )
        return PresignedUpload(
            url=url,
            method="PUT",
            headers={"Content-Type": content_type},
            expires_in=expires_in,
        )

    def presign_download(self, *, key, expires_in=300, filename=None, disposition="attachment"):
        expires = int(time.time()) + expires_in
        signature = self.sign(key=key, operation="GET", expires=expires)
        url = f"{self.base_url}/download/{quote(key)}?expires={expires}&signature={signature}"
        if filename:
            url += f"&filename={quote(filename)}"
        # Not covered by the signature deliberately: it decides how a browser
        # presents bytes the signature has already authorised, so tampering with
        # it grants no access that the signature did not already grant.
        if disposition != "attachment":
            url += f"&disposition={quote(disposition)}"
        return PresignedDownload(url=url, expires_in=expires_in)

    def stat(self, *, key):
        path = self.path_for(key)
        if not path.is_file():
            raise ObjectNotFound(key)
        data = path.read_bytes()
        return len(data), hashlib.md5(data, usedforsecurity=False).hexdigest()

    def read(self, *, key, length=None):
        path = self.path_for(key)
        if not path.is_file():
            raise ObjectNotFound(key)
        with path.open("rb") as handle:
            return handle.read(length) if length else handle.read()

    def write(self, *, key: str, data: bytes) -> None:
        """Used by the local upload receiver. Not part of the abstract contract:
        with S3 the client writes directly and Django never sees the bytes."""
        path = self.path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, *, key):
        path = self.path_for(key)
        path.unlink(missing_ok=True)

    def exists(self, *, key):
        return self.path_for(key).is_file()


class S3StorageBackend(StorageBackend):
    """S3-compatible object storage: MinIO locally, S3/R2/Spaces in production.

    boto3 is imported lazily so that a developer running the local backend does
    not need it installed or configured, and so importing this module never
    reaches for credentials.
    """

    name = "s3"

    def __init__(self):
        self.bucket = settings.AWS_STORAGE_BUCKET_NAME
        if not self.bucket:
            raise ImproperlyConfigured("S3_BUCKET must be set to use the S3 storage backend.")

    def _build_client(self, endpoint_url: str | None):
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover
            raise ImproperlyConfigured(
                "boto3 is required for the S3 storage backend. "
                "Install it, or set STORAGE_BACKEND=local."
            ) from exc

        return boto3.client(
            "s3",
            endpoint_url=endpoint_url or None,
            region_name=settings.AWS_S3_REGION_NAME,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            # SigV4 so presigned URLs work against every S3-compatible
            # implementation, not just AWS.
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )

    @property
    def client(self):
        """For the server's own reads and writes, over the internal endpoint."""
        if not hasattr(self, "_client"):
            self._client = self._build_client(settings.AWS_S3_ENDPOINT_URL)
        return self._client

    def public_endpoint(self) -> str:
        """The endpoint to sign browser-facing URLs against, for this request.

        Normally the configured value. With
        ``S3_PUBLIC_ENDPOINT_FOLLOWS_REQUEST`` on, the host is taken from
        whoever is asking and the scheme and port from the setting — because a
        single baked-in address cannot serve a laptop, an Android emulator and a
        real handset at the same time, and "localhost" is a different machine to
        each of them.

        Outside a request there is nobody to follow, so a worker, a management
        command and the test suite all get the configured value.
        """
        configured = settings.AWS_S3_PUBLIC_ENDPOINT_URL or settings.AWS_S3_ENDPOINT_URL
        if not getattr(settings, "AWS_S3_PUBLIC_ENDPOINT_FOLLOWS_REQUEST", False):
            return configured

        from apps.core.context import get_context

        host = (get_context().client_host or "").split(":")[0]
        if not host:
            return configured

        parts = urlsplit(configured)
        port = f":{parts.port}" if parts.port else ""
        return urlunsplit((parts.scheme, f"{host}{port}", parts.path, "", ""))

    @property
    def signing_client(self):
        """For URLs a browser will fetch, bound to the endpoint it can reach.

        SigV4 signs the `Host` header — that is what `X-Amz-SignedHeaders=host`
        in every presigned URL means — so a URL signed against the compose
        service name and then rewritten to `localhost` arrives with a signature
        computed over a different host and MinIO answers `SignatureDoesNotMatch`.

        That is what it did: every presigned *download* returned 403, so no
        listing photograph had ever rendered in a browser in this configuration,
        while the API kept reporting 200 for the page around it. Uploads were
        unaffected and hid the problem — `generate_presigned_post` signs a
        policy document that does not include the host, so rewriting its origin
        genuinely is safe.

        Signing against the public endpoint from the start removes the rewrite
        for downloads entirely. Where there is no separate public endpoint —
        production against real S3 — this is the same client.
        """
        public = self.public_endpoint()
        if not public or public == settings.AWS_S3_ENDPOINT_URL:
            return self.client
        # Keyed by endpoint: following the request means there is one client per
        # address clients actually arrive on, which ALLOWED_HOSTS bounds.
        if not hasattr(self, "_signing_clients"):
            self._signing_clients: dict[str, object] = {}
        if public not in self._signing_clients:
            self._signing_clients[public] = self._build_client(public)
        return self._signing_clients[public]

    def _public(self, url: str) -> str:
        """Rewrite an internal endpoint to the one a client can actually reach.

        Only safe where the host is not part of what was signed, which is true
        of a presigned POST policy and false of a presigned GET. Downloads sign
        against the public endpoint instead — see :meth:`signing_client`.
        """
        internal = (settings.AWS_S3_ENDPOINT_URL or "").rstrip("/")
        public = (self.public_endpoint() or "").rstrip("/")
        if internal and public and internal != public and url.startswith(internal):
            return public + url[len(internal) :]
        return url

    def presign_upload(self, *, key, content_type, max_bytes, expires_in=900):
        # A POST policy rather than a presigned PUT: the policy can carry a
        # content-length range, so storage itself rejects an oversized upload.
        # A presigned PUT cannot express that, which would leave size enforcement
        # to a client we do not control.
        try:
            presigned = self.client.generate_presigned_post(
                Bucket=self.bucket,
                Key=key,
                Fields={"Content-Type": content_type},
                Conditions=[
                    {"Content-Type": content_type},
                    ["content-length-range", 1, max_bytes],
                ],
                ExpiresIn=expires_in,
            )
        except Exception as exc:
            raise StorageError(f"Could not presign an upload: {exc}") from exc

        return PresignedUpload(
            url=self._public(presigned["url"]),
            method="POST",
            fields=presigned["fields"],
            expires_in=expires_in,
        )

    def presign_download(self, *, key, expires_in=300, filename=None, disposition="attachment"):
        params = {"Bucket": self.bucket, "Key": key}
        if filename:
            params["ResponseContentDisposition"] = f'{disposition}; filename="{filename}"'
        try:
            # Signed against the endpoint the browser will use, not rewritten
            # afterwards — the host is part of the signature.
            url = self.signing_client.generate_presigned_url(
                "get_object", Params=params, ExpiresIn=expires_in
            )
        except Exception as exc:
            raise StorageError(f"Could not presign a download: {exc}") from exc
        return PresignedDownload(url=url, expires_in=expires_in)

    def stat(self, *, key):
        try:
            head = self.client.head_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            raise ObjectNotFound(key) from exc
        return head["ContentLength"], head.get("ETag", "").strip('"')

    def read(self, *, key, length=None):
        params = {"Bucket": self.bucket, "Key": key}
        if length:
            params["Range"] = f"bytes=0-{length - 1}"
        try:
            response = self.client.get_object(**params)
        except Exception as exc:
            raise ObjectNotFound(key) from exc
        return response["Body"].read()

    def delete(self, *, key):
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            raise StorageError(f"Could not delete {key}: {exc}") from exc

    def exists(self, *, key):
        try:
            self.stat(key=key)
        except ObjectNotFound:
            return False
        return True


class MemoryStorageBackend(StorageBackend):
    """In-memory storage for tests. Signs URLs the same way the local backend
    does so that presign behaviour is still exercised rather than bypassed."""

    name = "memory"

    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def presign_upload(self, *, key, content_type, max_bytes, expires_in=900):
        return PresignedUpload(
            url=f"memory://upload/{key}",
            method="PUT",
            headers={"Content-Type": content_type},
            expires_in=expires_in,
        )

    def presign_download(self, *, key, expires_in=300, filename=None, disposition="attachment"):
        # The disposition is carried in the URL so a test can assert it was
        # asked for, rather than the memory backend silently accepting an
        # argument the real ones act on.
        suffix = "" if disposition == "attachment" else f"?disposition={disposition}"
        return PresignedDownload(url=f"memory://download/{key}{suffix}", expires_in=expires_in)

    def stat(self, *, key):
        if key not in self.objects:
            raise ObjectNotFound(key)
        data = self.objects[key]
        return len(data), hashlib.md5(data, usedforsecurity=False).hexdigest()

    def read(self, *, key, length=None):
        if key not in self.objects:
            raise ObjectNotFound(key)
        data = self.objects[key]
        return data[:length] if length else data

    def write(self, *, key: str, data: bytes) -> None:
        self.objects[key] = data

    def delete(self, *, key):
        self.objects.pop(key, None)

    def exists(self, *, key):
        return key in self.objects


_BACKENDS: dict[str, type[StorageBackend]] = {
    "s3": S3StorageBackend,
    "local": LocalStorageBackend,
    "memory": MemoryStorageBackend,
}

_instance: StorageBackend | None = None


def get_storage() -> StorageBackend:
    """The configured backend. Switching is a settings change, nothing more."""
    global _instance
    if _instance is None:
        chosen = getattr(settings, "STORAGE_BACKEND", "s3")
        backend = _BACKENDS.get(chosen)
        if backend is None:
            raise ImproperlyConfigured(
                f"Unknown STORAGE_BACKEND {chosen!r}. Choose one of: {', '.join(_BACKENDS)}."
            )
        _instance = backend()
    return _instance


def reset_storage() -> None:
    """Test helper: forget the cached backend."""
    global _instance
    _instance = None


# --- reaching storage from wherever the client actually is -------------------

#: Hosts that mean "this machine" — and therefore mean something different on
#: every machine that reads them.
LOOPBACK_HOSTS = frozenset(
    # S104 reads `0.0.0.0` as a bind address. This set is the opposite: it is
    # what an origin is checked *against* so one of these is never handed to a
    # phone as somewhere to upload to.
    {"localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"}  # noqa: S104  # nosec B104
)


def reachable_upload_origin(request) -> str | None:
    """The storage origin *this* client can reach, or None to use the configured one.

    Presigned URLs are minted against ``S3_PUBLIC_ENDPOINT_URL``, which in local
    development defaults to ``http://localhost:9000``. That is correct for a
    browser on the host machine and wrong for everything else: on a phone,
    ``localhost`` is the phone, so the device is handed an address for itself,
    the upload cannot connect, and the only visible symptom is the API logging a
    healthy 201 for the reservation while no file ever arrives — the upload step
    never touches Django at all.

    The mobile client already solves the same problem for the API by asking Expo
    which machine served the bundle. This is the server side of that idea: when
    the configured origin is a loopback address, the host the client used to
    reach *this* request is a far better guess, because it is by definition an
    address that reached this machine.

    Safe to rewrite because uploads are presigned POST policies: the signature
    covers the policy document — bucket, key, content type, size range — and not
    the Host header. Downloads are presigned GETs, where SigV4 *does* sign the
    host, so this deliberately applies to uploads only.

    Returns None when the configured origin is a real hostname, which is the
    production case: that value is authoritative and must not be second-guessed.
    """
    from urllib.parse import urlsplit

    configured = (getattr(settings, "AWS_S3_PUBLIC_ENDPOINT_URL", "") or "").rstrip("/")
    if not configured or request is None:
        return None

    parts = urlsplit(configured)
    if parts.hostname not in LOOPBACK_HOSTS:
        return None

    # Whatever host reached us, minus its port, plus storage's.
    client_host = (request.get_host() or "").split(":")[0]
    if not client_host or client_host in LOOPBACK_HOSTS:
        return None

    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{client_host}{port}"


def rehost(url: str, origin: str | None) -> str:
    """Swap a URL's origin, keeping its path and query untouched."""
    if not origin:
        return url
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    rest = url[len(f"{parts.scheme}://{parts.netloc}") :]
    return f"{origin.rstrip('/')}{rest}"
