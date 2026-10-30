"""Recompute every listing's public map point.

    python manage.py refresh_listing_locations

Run after providers save property pins, or to backfill neighbourhood markers
for older properties without pins. Verified property records are never edited.
This command never resolves addresses or calls an external service.
Safe to repeat: a listing whose point is
already right is not written. See `apps.listing.location` for what a public
point is, and why it is never the address.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db.models import Count

from apps.listing.location import refresh_public_locations, refresh_public_sale_locations
from apps.listing.models import Listing


class Command(BaseCommand):
    help = "Recompute the approximate public map point of every listing."

    def handle(self, *args, **options):
        updated = refresh_public_locations()
        sale_updated = refresh_public_sale_locations()
        by_precision = (
            Listing.objects.values("public_point_precision")
            .annotate(listings=Count("id"))
            .order_by("public_point_precision")
        )
        breakdown = ", ".join(
            f"{row['public_point_precision'] or 'no point'} {row['listings']}"
            for row in by_precision
        )
        self.stdout.write(self.style.SUCCESS(
            f"Updated {updated} rental and {sale_updated} sale listings. Rentals now: {breakdown}."
        ))
