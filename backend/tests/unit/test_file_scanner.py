"""The scanner only releases objects after an explicit clean provider verdict."""

import hashlib
from types import SimpleNamespace

import pytest
import requests

from apps.files import scanner


class MemoryObject:
    def __init__(self, data):
        self.data = data

    def read(self, *, key, length=None):
        return self.data[:length]


def stored_file(data):
    return SimpleNamespace(
        storage_key="identity_document/abc.jpg",
        size_bytes=len(data),
        checksum_sha256=hashlib.sha256(data).hexdigest(),
        content_type="image/jpeg",
    )


@pytest.mark.parametrize("verdict,expected", [(True, True), (False, False)])
def test_explicit_verdict(monkeypatch, settings, verdict, expected):
    data = b"test image bytes"
    settings.CLOUDMERSIVE_API_KEY = "test-key"
    monkeypatch.setattr(scanner, "get_storage", lambda: MemoryObject(data))

    def post(url, *, headers, files, timeout):
        assert url == scanner.CLOUDMERSIVE_URL
        assert headers == {"Apikey": "test-key"}
        assert files["inputFile"][0] == "upload.jpg"
        assert files["inputFile"][1] == data
        assert timeout[0] > 0 and timeout[1] > 0
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"CleanResult": verdict})

    monkeypatch.setattr(scanner.requests, "post", post)
    assert scanner.scan_with_cloudmersive(stored_file(data)) is expected


def test_changed_object_is_not_sent(monkeypatch, settings):
    settings.CLOUDMERSIVE_API_KEY = "test-key"
    monkeypatch.setattr(scanner, "get_storage", lambda: MemoryObject(b"changed"))
    monkeypatch.setattr(scanner.requests, "post", lambda *args, **kwargs: pytest.fail("sent"))
    with pytest.raises(scanner.ScanError, match="changed"):
        scanner.scan_with_cloudmersive(stored_file(b"original"))


@pytest.mark.parametrize("payload", [{}, {"CleanResult": None}, {"CleanResult": "true"}])
def test_ambiguous_verdict_stays_pending(monkeypatch, settings, payload):
    data = b"test image bytes"
    settings.CLOUDMERSIVE_API_KEY = "test-key"
    monkeypatch.setattr(scanner, "get_storage", lambda: MemoryObject(data))
    monkeypatch.setattr(
        scanner.requests,
        "post",
        lambda *args, **kwargs: SimpleNamespace(
            raise_for_status=lambda: None, json=lambda: payload
        ),
    )
    with pytest.raises(scanner.ScanError, match="definitive"):
        scanner.scan_with_cloudmersive(stored_file(data))


def test_network_failure_stays_pending(monkeypatch, settings):
    data = b"test image bytes"
    settings.CLOUDMERSIVE_API_KEY = "test-key"
    monkeypatch.setattr(scanner, "get_storage", lambda: MemoryObject(data))

    def fail(*args, **kwargs):
        raise requests.Timeout()

    monkeypatch.setattr(scanner.requests, "post", fail)
    with pytest.raises(scanner.ScanError, match="valid response"):
        scanner.scan_with_cloudmersive(stored_file(data))


def test_provider_size_limit_applies_before_read(monkeypatch, settings):
    settings.CLOUDMERSIVE_API_KEY = "test-key"
    monkeypatch.setattr(scanner, "get_storage", lambda: pytest.fail("read"))
    stored = stored_file(b"original")
    stored.size_bytes = scanner.CLOUDMERSIVE_MAX_BYTES + 1
    with pytest.raises(scanner.ScanError, match="size limit"):
        scanner.scan_with_cloudmersive(stored)
