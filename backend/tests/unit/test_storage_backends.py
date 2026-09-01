"""Storage backend tests — no cloud credentials, no MinIO."""

import time
from urllib.parse import unquote

import pytest

from apps.files.storage import (
    LocalStorageBackend,
    MemoryStorageBackend,
    ObjectNotFound,
)


def _local_backend():
    import tempfile
    from pathlib import Path

    tmp = Path(tempfile.mkdtemp())
    return LocalStorageBackend(root=tmp, base_url="http://localhost:8000/storage")


def _memory_backend():
    return MemoryStorageBackend()


class TestBackendContract:
    """Every backend must honour the same contract."""

    def _backends(self):
        return [_memory_backend(), _local_backend()]

    def test_write_read_round_trip(self):
        for backend in self._backends():
            key = "test/round-trip.jpg"
            data = b"\xff\xd8\xff\xe0" + b"\x00" * 100
            backend.write(key=key, data=data)
            assert backend.read(key=key) == data, f"failed for {backend.name}"

    def test_stat_returns_size(self):
        for backend in self._backends():
            key = "test/stat.jpg"
            data = b"x" * 1000
            backend.write(key=key, data=data)
            size, _ = backend.stat(key=key)
            assert size == 1000, f"failed for {backend.name}"

    def test_missing_key_raises(self):
        for backend in self._backends():
            with pytest.raises(ObjectNotFound):
                backend.stat(key="test/nope-2099.jpg")

    def test_delete_removes_object(self):
        for backend in self._backends():
            key = "test/del.jpg"
            backend.write(key=key, data=b"x" * 10)
            assert backend.exists(key=key)
            backend.delete(key=key)
            assert not backend.exists(key=key)

    def test_partial_read(self):
        for backend in self._backends():
            key = "test/partial.jpg"
            data = b"\xff\xd8\xff" + b"\xaa" * 100
            backend.write(key=key, data=data)
            header = backend.read(key=key, length=8)
            assert len(header) == 8
            assert header[:3] == b"\xff\xd8\xff"


class TestLocalPresigning:
    def _backend(self):
        return _local_backend()

    def test_produces_put_url(self):
        b = self._backend()
        p = b.presign_upload(key="t/x.jpg", content_type="image/jpeg", max_bytes=1_000_000)
        assert p.method == "PUT"
        assert "expires" in p.url
        assert "signature" in p.url

    def test_valid_signature_verifies(self):
        b = self._backend()
        key = "test/file.jpg"
        expires = int(time.time()) + 300
        sig = b.sign(
            key=key,
            operation="PUT",
            expires=expires,
            content_type="image/jpeg",
            max_bytes=1_000_000,
        )
        assert b.verify(
            key=key,
            operation="PUT",
            expires=expires,
            signature=sig,
            content_type="image/jpeg",
            max_bytes=1_000_000,
        )

    def test_expired_fails(self):
        b = self._backend()
        key = "test/file.jpg"
        past = int(time.time()) - 10
        sig = b.sign(key=key, operation="PUT", expires=past)
        assert not b.verify(key=key, operation="PUT", expires=past, signature=sig)

    def test_tampered_key_fails(self):
        b = self._backend()
        expires = int(time.time()) + 300
        sig = b.sign(key="legit/file.jpg", operation="PUT", expires=expires)
        assert not b.verify(key="other/file.jpg", operation="PUT", expires=expires, signature=sig)

    def test_download_url_has_signature(self):
        b = self._backend()
        p = b.presign_download(key="t/x.jpg")
        assert "expires" in p.url and "signature" in p.url


class TestPathTraversalGuard:
    def test_traversal_is_refused(self):
        from apps.files.storage import StorageError

        b = _local_backend()
        with pytest.raises((StorageError, Exception)):
            b.path_for("../../etc/passwd")

    def test_normal_key_is_accepted(self):
        b = _local_backend()
        path = b.path_for("identity_document/2024/03/user-id/file.jpg")
        assert str(path).startswith(str(b.root))


class TestMemoryBackend:
    def test_memory_url_is_not_s3(self):
        b = _memory_backend()
        p = b.presign_upload(key="x.jpg", content_type="image/jpeg", max_bytes=1000)
        assert "memory://" in p.url

    def test_objects_survive_between_calls(self):
        b = _memory_backend()
        b.write(key="a.jpg", data=b"hello")
        b.write(key="b.jpg", data=b"world")
        assert b.read(key="a.jpg") == b"hello"


# botocore signs with `datetime.utcnow()`, which Python 3.12 deprecates. The
# project turns DeprecationWarning into an error deliberately, and that policy
# is right — but it is a policy about *our* code, and nothing here can fix a
# library's internals. Narrowed to that one module so the rest still bites.
@pytest.mark.filterwarnings("ignore::DeprecationWarning:botocore.auth")
class TestS3PresigningHost:
    """A presigned GET is signed over the host; a presigned POST is not.

    Getting that backwards cost every listing photograph. The API signed a
    download against the compose service name, rewrote the origin to the one a
    browser can reach, and MinIO answered `SignatureDoesNotMatch` — so a gallery
    of empty frames sat under a page returning 200. Uploads kept working and hid
    it, because `generate_presigned_post` signs a policy that says nothing about
    the host.

    No MinIO and no credentials: boto3 signs offline, and what is asserted is
    which endpoint each URL was signed against.
    """

    def _backend(self, settings, *, internal, public):
        from apps.files.storage import S3StorageBackend

        settings.AWS_STORAGE_BUCKET_NAME = "grp-test"
        settings.AWS_S3_ENDPOINT_URL = internal
        settings.AWS_S3_PUBLIC_ENDPOINT_URL = public
        settings.AWS_S3_REGION_NAME = "us-east-1"
        settings.AWS_ACCESS_KEY_ID = "test-key"
        settings.AWS_SECRET_ACCESS_KEY = "test-secret"
        return S3StorageBackend()

    def test_a_download_is_signed_against_the_public_endpoint(self, settings):
        pytest.importorskip("boto3")

        backend = self._backend(
            settings, internal="http://minio:9000", public="http://localhost:9000"
        )

        url = backend.presign_download(key="photos/room.jpg", filename="room.jpg").url

        assert url.startswith("http://localhost:9000/")
        # And it really was signed there rather than rewritten afterwards: a URL
        # signed against `minio:9000` and moved would carry a signature for the
        # other host, which is exactly the 403 this replaces.
        rewritten = backend.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": "grp-test", "Key": "photos/room.jpg"},
            ExpiresIn=300,
        )
        assert _signature(url) != _signature(rewritten)

    def test_one_endpoint_means_one_client(self, settings):
        """Production against real S3 has no separate public endpoint."""
        pytest.importorskip("boto3")

        backend = self._backend(settings, internal="", public="")

        assert backend.signing_client is backend.client

    def test_a_photo_may_be_asked_for_inline(self, settings):
        pytest.importorskip("boto3")

        backend = self._backend(
            settings, internal="http://minio:9000", public="http://localhost:9000"
        )

        document = backend.presign_download(key="d.pdf", filename="deed.pdf").url
        photo = backend.presign_download(key="p.jpg", filename="room.jpg", disposition="inline").url

        assert "attachment" in unquote(document)
        assert "inline" in unquote(photo)


def _signature(url: str) -> str:
    from urllib.parse import parse_qs, urlparse

    return parse_qs(urlparse(url).query).get("X-Amz-Signature", [""])[0]


class TestThePublicEndpointCanFollowTheRequest:
    """One baked-in storage address cannot serve every client.

    A presigned URL carries the host it was signed for. "localhost" is the API
    machine to a desktop browser and the handset itself to a phone, so a single
    configured address leaves one of them looking at empty frames — which is
    exactly what happened to mobile. The host a client reached the API on is,
    by construction, one that client can resolve.
    """

    def _backend(self, settings, *, follows: bool):
        from apps.files.storage import S3StorageBackend

        settings.AWS_S3_ENDPOINT_URL = "http://minio:9000"
        settings.AWS_S3_PUBLIC_ENDPOINT_URL = "http://localhost:9000"
        settings.AWS_S3_PUBLIC_ENDPOINT_FOLLOWS_REQUEST = follows
        settings.AWS_STORAGE_BUCKET_NAME = "grp-local"
        return S3StorageBackend()

    def test_off_by_default_the_configured_address_is_used(self, settings):
        """Production points at a CDN or a bucket host that has nothing to do
        with the host the API answers on, so following the request is wrong
        there and the flag defaults off."""
        from apps.core.context import use_context

        backend = self._backend(settings, follows=False)
        with use_context(client_host="192.168.1.42:8000"):
            assert backend.public_endpoint() == "http://localhost:9000"

    def test_the_host_follows_the_caller_and_the_port_does_not(self, settings):
        from apps.core.context import use_context

        backend = self._backend(settings, follows=True)

        for host, expected in [
            ("localhost:8000", "http://localhost:9000"),
            ("192.168.1.42:8000", "http://192.168.1.42:9000"),
            # The Android emulator's address for the host machine.
            ("10.0.2.2:8000", "http://10.0.2.2:9000"),
            # A host with no port of its own still gets the storage port.
            ("rooomly.test", "http://rooomly.test:9000"),
        ]:
            with use_context(client_host=host):
                assert backend.public_endpoint() == expected

    def test_outside_a_request_there_is_nobody_to_follow(self, settings):
        """A worker, a management command and the test suite have no client."""
        from apps.core.context import use_context

        backend = self._backend(settings, follows=True)
        with use_context(client_host=""):
            assert backend.public_endpoint() == "http://localhost:9000"

    def test_each_address_gets_its_own_signing_client(self, settings):
        """SigV4 signs the Host header, so a URL cannot be rewritten after the
        fact — it has to be signed against the address it will be fetched on."""
        from apps.core.context import use_context

        backend = self._backend(settings, follows=True)
        with use_context(client_host="192.168.1.42:8000"):
            first = backend.signing_client
            again = backend.signing_client
        with use_context(client_host="10.0.2.2:8000"):
            other = backend.signing_client

        assert first is again
        assert first is not other
