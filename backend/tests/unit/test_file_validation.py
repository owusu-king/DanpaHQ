"""File upload validation — pure Python, no database, no storage."""

import pytest

from apps.files.validation import (
    FileValidationError,
    sniff_content_type,
    validate_declared_upload,
    validate_uploaded_bytes,
)


class TestSniffContentType:
    def test_jpeg(self):
        assert sniff_content_type(b"\xff\xd8\xff\xe0" + b"\x00" * 60) == "image/jpeg"

    def test_png(self):
        assert sniff_content_type(b"\x89PNG\r\n\x1a\n" + b"\x00" * 56) == "image/png"

    def test_pdf(self):
        assert sniff_content_type(b"%PDF-1.7" + b"\x00" * 56) == "application/pdf"

    def test_webp(self):
        assert sniff_content_type(b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 52) == "image/webp"

    def test_heic(self):
        assert sniff_content_type(b"\x00\x00\x00 ftypheic" + b"\x00" * 55) == "image/heic"

    def test_unknown(self):
        assert sniff_content_type(b"\x00" * 64) is None

    def test_empty(self):
        assert sniff_content_type(b"") is None


class TestValidateDeclaredUpload:
    def test_valid_jpeg(self):
        r = validate_declared_upload(
            purpose="identity_document", content_type="image/jpeg", size_bytes=2 * 1024 * 1024
        )
        assert r.max_bytes == 8 * 1024 * 1024

    def test_content_type_with_params(self):
        r = validate_declared_upload(
            purpose="identity_document", content_type="image/jpeg; charset=utf-8", size_bytes=1000
        )
        assert r is not None

    def test_wrong_type_rejected(self):
        with pytest.raises(FileValidationError, match="file type"):
            validate_declared_upload(
                purpose="identity_document", content_type="video/mp4", size_bytes=1000
            )

    def test_oversized_rejected(self):
        with pytest.raises(FileValidationError, match="limit"):
            validate_declared_upload(
                purpose="identity_document", content_type="image/jpeg", size_bytes=100 * 1024 * 1024
            )

    def test_zero_size_rejected(self):
        with pytest.raises(FileValidationError):
            validate_declared_upload(
                purpose="identity_document", content_type="image/jpeg", size_bytes=0
            )

    def test_unknown_purpose_rejected(self):
        with pytest.raises(FileValidationError):
            validate_declared_upload(
                purpose="weapon_blueprint", content_type="image/jpeg", size_bytes=1000
            )

    def test_lease_doc_requires_pdf(self):
        with pytest.raises(FileValidationError):
            validate_declared_upload(
                purpose="lease_document", content_type="image/jpeg", size_bytes=1000
            )
        r = validate_declared_upload(
            purpose="lease_document", content_type="application/pdf", size_bytes=1000
        )
        assert r is not None


class TestValidateUploadedBytes:
    _jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 60

    def test_valid_jpeg_passes(self):
        t = validate_uploaded_bytes(
            purpose="identity_document",
            header=self._jpeg,
            actual_size=500_000,
            declared_content_type="image/jpeg",
        )
        assert t == "image/jpeg"

    def test_exe_rejected(self):
        with pytest.raises(FileValidationError, match="executable"):
            validate_uploaded_bytes(
                purpose="identity_document",
                header=b"MZ\x90\x00" + b"\x00" * 60,
                actual_size=10_000,
                declared_content_type="image/jpeg",
            )

    def test_elf_rejected(self):
        with pytest.raises(FileValidationError):
            validate_uploaded_bytes(
                purpose="identity_document",
                header=b"\x7fELF\x02\x01\x01" + b"\x00" * 57,
                actual_size=10_000,
                declared_content_type="image/jpeg",
            )

    def test_zip_rejected(self):
        with pytest.raises(FileValidationError, match="archive"):
            validate_uploaded_bytes(
                purpose="identity_document",
                header=b"PK\x03\x04" + b"\x00" * 60,
                actual_size=5_000,
                declared_content_type="image/jpeg",
            )

    def test_php_rejected(self):
        with pytest.raises(FileValidationError):
            validate_uploaded_bytes(
                purpose="identity_document",
                header=b"<?php echo 'x';" + b"\x00" * 50,
                actual_size=100,
                declared_content_type="image/jpeg",
            )

    def test_html_rejected(self):
        with pytest.raises(FileValidationError):
            validate_uploaded_bytes(
                purpose="identity_document",
                header=b"<!DOCTYPE html>" + b"\x00" * 49,
                actual_size=200,
                declared_content_type="image/jpeg",
            )

    def test_unknown_binary_rejected(self):
        with pytest.raises(FileValidationError):
            validate_uploaded_bytes(
                purpose="identity_document",
                header=b"\x00" * 64,
                actual_size=200,
                declared_content_type="image/jpeg",
            )

    def test_oversized_actual_upload_rejected(self):
        with pytest.raises(FileValidationError, match="limit"):
            validate_uploaded_bytes(
                purpose="identity_document",
                header=self._jpeg,
                actual_size=20 * 1024 * 1024,
                declared_content_type="image/jpeg",
            )

    def test_heic_mislabelled_as_jpeg_uses_detected(self):
        heic = b"\x00\x00\x00 ftypheic" + b"\x00" * 48
        t = validate_uploaded_bytes(
            purpose="identity_document",
            header=heic,
            actual_size=1_000_000,
            declared_content_type="image/jpeg",
        )
        assert t == "image/heic"

    def test_wrong_type_for_purpose(self):
        webp = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 52
        with pytest.raises(FileValidationError):
            validate_uploaded_bytes(
                purpose="lease_document",
                header=webp,
                actual_size=100_000,
                declared_content_type="image/webp",
            )
