"""Bounded, fail-closed malware scanning of private uploaded objects."""

from __future__ import annotations

import hashlib
from pathlib import Path

import requests
from django.conf import settings

from .storage import StorageError, get_storage

CLOUDMERSIVE_MAX_BYTES = 3_500_000
CLOUDMERSIVE_URL = "https://api.cloudmersive.com/virus/scan/file"


class ScanError(Exception):
    """The provider could not give a trustworthy verdict."""


def scan_with_cloudmersive(stored) -> bool:
    """Return True only for an explicit clean verdict; never send filenames or keys."""
    api_key = getattr(settings, "CLOUDMERSIVE_API_KEY", "")
    if not api_key:
        raise ScanError("Cloudmersive API key is not configured")
    if not stored.size_bytes or stored.size_bytes > CLOUDMERSIVE_MAX_BYTES:
        raise ScanError("File exceeds the configured scanner's size limit")

    try:
        data = get_storage().read(key=stored.storage_key, length=CLOUDMERSIVE_MAX_BYTES + 1)
    except StorageError as exc:
        raise ScanError("Uploaded object could not be read") from exc
    if len(data) != stored.size_bytes or hashlib.sha256(data).hexdigest() != stored.checksum_sha256:
        raise ScanError("Uploaded object changed after validation")

    suffix = Path(stored.storage_key).suffix or ".bin"
    try:
        response = requests.post(
            CLOUDMERSIVE_URL,
            headers={"Apikey": api_key},
            files={"inputFile": (f"upload{suffix}", data, stored.content_type)},
            timeout=(5, 45),
        )
        response.raise_for_status()
        verdict = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise ScanError("Malware scanner did not return a valid response") from exc

    if not isinstance(verdict, dict) or type(verdict.get("CleanResult")) is not bool:
        raise ScanError("Malware scanner response has no definitive verdict")
    found = verdict.get("FoundViruses", [])
    if not isinstance(found, list):
        raise ScanError("Malware scanner response has an invalid threat list")
    if found and verdict["CleanResult"]:
        raise ScanError("Malware scanner returned contradictory verdicts")
    return verdict["CleanResult"]
