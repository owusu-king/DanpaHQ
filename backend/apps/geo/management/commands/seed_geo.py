"""Compatibility entry point: seed the packaged, source-linked Ghana reference dataset."""

from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Import the packaged Ghana reference snapshot (no network)."

    def add_arguments(self, parser):
        parser.add_argument("--skip-if-current", action="store_true", help="Reuse a completed seed")

    def handle(self, *args, **options):
        call_command(
            "import_ghana_locations", skip_if_current=options["skip_if_current"], stdout=self.stdout
        )
