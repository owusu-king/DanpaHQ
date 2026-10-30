"""Read-only coverage and duplicate audit; candidate homonyms are never auto-deleted."""

import json
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db.models import Count, F, Q

from apps.geo.importing import distance, district_key
from apps.geo.models import District, Locality, LocationSourceRecord, Region


class Command(BaseCommand):
    help = "Audit imported geography and report ambiguous nearby same-name records."

    def add_arguments(self, parser):
        parser.add_argument("--show-candidates", action="store_true")

    def handle(self, *args, **options):
        rows = list(Locality.objects.all())
        grouped = defaultdict(list)
        nearby = []
        for row in rows:
            key = row.normalized_name, row.district_id
            if row.latitude is not None and row.longitude is not None:
                for other in grouped[key]:
                    if distance(other, float(row.latitude), float(row.longitude)) <= 1000:
                        nearby.append({"name": row.name, "ids": [str(other.id), str(row.id)]})
                grouped[key].append(row)
        districts = defaultdict(int)
        for row in District.objects.all():
            districts[row.region_id, district_key(row.name)] += 1
        result = {
            "regions": Region.objects.count(),
            "districts": District.objects.count(),
            "districts_with_boundaries": District.objects.exclude(boundary=None).count(),
            "localities": len(rows),
            "aliases": sum(len(row.aliases) for row in rows),
            "source_records": list(
                LocationSourceRecord.objects.values("dataset_id")
                .annotate(count=Count("id"))
                .order_by("dataset_id")
            ),
            "unknown_district": sum(row.district_id is None for row in rows),
            "unknown_region": sum(row.region_id is None for row in rows),
            "invalid_coordinates": Locality.objects.filter(
                Q(latitude__lt=-90)
                | Q(latitude__gt=90)
                | Q(longitude__lt=-180)
                | Q(longitude__gt=180)
                | Q(latitude__isnull=True, longitude__isnull=False)
                | Q(latitude__isnull=False, longitude__isnull=True)
            ).count(),
            "inconsistent_parents": Locality.objects.filter(district__isnull=False)
            .exclude(region_id=F("district__region_id"))
            .count(),
            "administrative_duplicate_groups": sum(count > 1 for count in districts.values()),
            "exact_duplicate_groups": Locality.objects.exclude(latitude=None)
            .values("normalized_name", "district_id", "latitude", "longitude")
            .annotate(count=Count("id"))
            .filter(count__gt=1)
            .count(),
            "nearby_same_name_pairs_for_review": len(nearby),
        }
        if options["show_candidates"]:
            result["review_candidates"] = nearby
        self.stdout.write(json.dumps(result, sort_keys=True))
