"""Import a complete obtained reference snapshot, or explicitly download a new one."""

import gzip
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, F, Q

from apps.geo.importing import build_snapshot, import_snapshot, obtain, validate_document
from apps.geo.models import District, Locality, Region


class Command(BaseCommand):
    help = "Import licensed Ghana geography without deleting or moving existing addresses."

    def add_arguments(self, parser):
        root = Path(settings.BASE_DIR) / "data/geography"
        parser.add_argument("--snapshot", type=Path, default=root / "ghana-reference.json.gz")
        parser.add_argument("--data-dir", type=Path, default=root / "raw")
        parser.add_argument("--download", action="store_true", help="Obtain fresh source archives")
        parser.add_argument(
            "--build-snapshot", action="store_true", help="Normalize cached archives"
        )
        parser.add_argument(
            "--dry-run", action="store_true", help="Validate snapshot without DB writes"
        )

    def handle(self, *args, **options):
        try:
            if options["download"]:
                obtain(options["data_dir"])
            if options["download"] or options["build_snapshot"]:
                self.stdout.write("Normalizing obtained GSS/HDX, GeoNames and OSM records...")
                document = build_snapshot(options["data_dir"], options["snapshot"])
            else:
                with gzip.open(options["snapshot"], "rb") as stream:
                    content = stream.read(128 * 1024 * 1024 + 1)
                if len(content) > 128 * 1024 * 1024:
                    raise ValueError("Snapshot exceeds the 128 MB decompressed limit")
                document = json.loads(content)
            validate_document(document)
            self.stdout.write(
                json.dumps(
                    {
                        "snapshot": str(options["snapshot"]),
                        "source_regions": len(document["regions"]),
                        "source_districts": len(document["districts"]),
                        "source_localities": len(document["localities"]),
                        "source_aliases": sum(
                            len(row["aliases"]) for row in document["localities"]
                        ),
                        "rejected": document.get("rejected", {}),
                    }
                )
            )
            if options["dry_run"]:
                return
            result = import_snapshot(document)
            rows = Locality.objects.all()
            result.update(
                {
                    "regions_total": Region.objects.count(),
                    "districts_total": District.objects.count(),
                    "localities_total": rows.count(),
                    "aliases_total": sum(
                        len(row) for row in rows.values_list("aliases", flat=True)
                    ),
                    "unknown_district": rows.filter(district__isnull=True).count(),
                    "unknown_region": rows.filter(region__isnull=True).count(),
                    "inconsistent_parents": rows.filter(district__isnull=False)
                    .exclude(region_id=F("district__region_id"))
                    .count(),
                    "invalid_coordinates": rows.filter(
                        Q(latitude__lt=-90)
                        | Q(latitude__gt=90)
                        | Q(longitude__lt=-180)
                        | Q(longitude__gt=180)
                        | Q(latitude__isnull=True, longitude__isnull=False)
                        | Q(latitude__isnull=False, longitude__isnull=True)
                    ).count(),
                    "exact_duplicate_groups": rows.exclude(latitude=None)
                    .values("normalized_name", "district_id", "latitude", "longitude")
                    .annotate(n=Count("id"))
                    .filter(n__gt=1)
                    .count(),
                }
            )
            self.stdout.write(self.style.SUCCESS(json.dumps(result, sort_keys=True)))
        except (ValueError, KeyError, OSError, StopIteration) as exc:
            raise CommandError(str(exc)) from exc
