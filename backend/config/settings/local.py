from .base import *
from .base import CACHES, LOGGING, env  # noqa: F401

DEBUG = True
ALLOWED_HOSTS = ["*"]
LOGGING["handlers"]["stdout"]["formatter"] = "console"

# Local MinIO stands in for S3 so the storage code path is the real one.
STORAGES = {
    "default": {"BACKEND": "storages.backends.s3.S3Storage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Upload settings for local development.
# STORAGE_BACKEND can be overridden in .env:
#   STORAGE_BACKEND=s3  uses MinIO (docker compose up minio)
#   STORAGE_BACKEND=local  uses the filesystem, no Docker required
# The default here is "s3" (MinIO) so the production code path is exercised,
# but FILE_SCAN_MODE=permissive releases files without a real scanner.
FILE_SCAN_MODE = "permissive"
INTERNAL_IPS = ["127.0.0.1"]

# Print outgoing SMS/OTP to the console instead of spending credit in dev.
SMS_BACKEND = "console"

# File upload in local development.
# Set STORAGE_BACKEND=local if you prefer not to run MinIO (no Docker needed
# for the storage layer). The presigned-URL contract is identical either way,
# so switching is just an env-var change.
STORAGE_BACKEND = env("STORAGE_BACKEND", "s3")
FILE_SCAN_MODE = env("FILE_SCAN_MODE", "permissive")
