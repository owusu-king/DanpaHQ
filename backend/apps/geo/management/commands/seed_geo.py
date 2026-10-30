"""Compatibility entry point: seed the packaged, source-linked Ghana reference dataset."""

from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Import the packaged Ghana reference snapshot (no network)."

    def handle(self, *args, **options):
        call_command("import_ghana_locations", stdout=self.stdout)
