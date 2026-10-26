"""Create the local storage bucket if it is missing.

Run on API start by docker-compose. Without it, a fresh MinIO container has no bucket
and the first upload fails with an opaque error - which was exactly the kind of
setup problem this project has had.

Safe to run repeatedly, and a no-op for backends that have no concept of a
bucket.
"""

from __future__ import annotations

import contextlib

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.files.storage import S3StorageBackend, get_storage


class Command(BaseCommand):
    help = "Create the object-storage bucket used for uploads, if it does not exist."

    def handle(self, *args, **options):
        storage = get_storage()

        if not isinstance(storage, S3StorageBackend):
            self.stdout.write(
                self.style.SUCCESS(f"Storage backend is '{storage.name}' - no bucket needed.")
            )
            return

        bucket = settings.AWS_STORAGE_BUCKET_NAME
        # Any failure here means "we could not confirm it exists", and the answer
        # to that is the same as "it does not": try to create it below.
        # `suppress` says that; try/except/pass leaves a reader wondering whether
        # somebody forgot the handler.
        with contextlib.suppress(Exception):
            storage.client.head_bucket(Bucket=bucket)
            self.stdout.write(self.style.SUCCESS(f"Bucket '{bucket}' already exists."))
            return

        try:
            storage.client.create_bucket(Bucket=bucket)
        except Exception as exc:
            self.stderr.write(
                f"Could not create bucket '{bucket}': {exc}\n"
                f"Check that MinIO is running (docker compose ps minio) and that "
                f"S3_ENDPOINT_URL points at it."
            )
            return

        self.stdout.write(self.style.SUCCESS(f"Created bucket '{bucket}'."))
        self.stdout.write(
            "Note: no public-read policy is applied, deliberately. Every read "
            "goes through a short-lived presigned URL issued after a permission check."
        )
