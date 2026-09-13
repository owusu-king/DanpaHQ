"""Publish the basemap — vector tiles and label fonts — to the public map bucket.

    python manage.py publish_map_assets /tmp/map-assets [--skip-existing]

`source` holds `tiles/<archive>.pmtiles` and `fonts/<fontstack>/<range>.pbf`,
cut from Protomaps' OpenStreetMap basemap; `docs/runbook.md` has the recipe.

This is the one public bucket in the product, and deliberately a separate one.
A basemap is public geography, identical for every visitor, and the browser
reads it by range request — a signature that expires in five minutes would
break a map left open. Nothing a person uploads is ever put here: the upload
bucket stays private and signed (see `ensure_bucket`).
"""

from __future__ import annotations

import json
import mimetypes
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.files.storage import S3StorageBackend

CONTENT_TYPES = {
    ".pmtiles": "application/octet-stream",
    ".pbf": "application/x-protobuf",
    ".json": "application/json",
    ".png": "image/png",
}
CACHE_CONTROL = {
    # An archive can be replaced in place by a newer extract.
    ".pmtiles": "public, max-age=86400",
    # A glyph range for a font stack never changes.
    ".pbf": "public, max-age=31536000, immutable",
}


class Command(BaseCommand):
    help = "Upload basemap tiles and fonts to the public-read map bucket."

    def add_arguments(self, parser):
        parser.add_argument("source", help="Directory holding tiles/ and fonts/.")
        parser.add_argument(
            "--skip-existing",
            action="store_true",
            help="Leave objects that already exist with the same size.",
        )

    def handle(self, *args, source: str, skip_existing: bool, **options):
        root = Path(source)
        if not root.is_dir():
            raise CommandError(f"{root} is not a directory.")

        client = S3StorageBackend().client
        bucket = settings.MAP_ASSETS_BUCKET
        try:
            client.head_bucket(Bucket=bucket)
        except Exception:
            client.create_bucket(Bucket=bucket)
            self.stdout.write(f"Created bucket '{bucket}'.")

        client.put_bucket_policy(
            Bucket=bucket,
            Policy=json.dumps(
                {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Sid": "PublicBasemapRead",
                            "Effect": "Allow",
                            "Principal": {"AWS": ["*"]},
                            "Action": ["s3:GetObject"],
                            "Resource": [f"arn:aws:s3:::{bucket}/*"],
                        }
                    ],
                }
            ),
        )
        try:
            client.put_bucket_cors(
                Bucket=bucket,
                CORSConfiguration={
                    "CORSRules": [
                        {
                            "AllowedOrigins": list(settings.CORS_ALLOWED_ORIGINS) or ["*"],
                            "AllowedMethods": ["GET", "HEAD"],
                            "AllowedHeaders": ["Range", "If-Match", "If-None-Match"],
                            "ExposeHeaders": ["ETag", "Content-Range", "Content-Length"],
                            "MaxAgeSeconds": 3600,
                        }
                    ]
                },
            )
        except Exception as exc:
            # MinIO answers every origin itself and rejects per-bucket CORS;
            # S3 needs the rule so the browser may read ranged responses.
            self.stdout.write(
                f"Bucket CORS not applied ({type(exc).__name__}); relying on the server default."
            )

        existing: dict[str, int] = {}
        if skip_existing:
            for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
                existing.update({row["Key"]: row["Size"] for row in page.get("Contents", [])})

        uploaded = skipped = 0
        for path in sorted(p for p in root.rglob("*") if p.is_file()):
            key = path.relative_to(root).as_posix()
            if skip_existing and existing.get(key) == path.stat().st_size:
                skipped += 1
                continue
            content_type = CONTENT_TYPES.get(path.suffix) or (
                mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            )
            client.upload_file(
                str(path),
                bucket,
                key,
                ExtraArgs={
                    "ContentType": content_type,
                    "CacheControl": CACHE_CONTROL.get(path.suffix, "public, max-age=3600"),
                },
            )
            uploaded += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Published {uploaded} map assets to '{bucket}' ({skipped} unchanged)."
            )
        )
