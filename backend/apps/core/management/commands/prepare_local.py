"""Prepare the local Compose API in one Django process."""

from time import monotonic

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Apply local migrations, protections, reference data and storage setup."
    requires_system_checks = ()

    def handle(self, *args, **options):
        if settings.SETTINGS_MODULE != "config.settings.local":
            raise CommandError("prepare_local requires config.settings.local.")

        for name, arguments in (
            ("migrate", {"interactive": False}),
            ("harden_database", {}),
            ("seed_geo", {"skip_if_current": True}),
            ("seed_amenities", {}),
            ("ensure_bucket", {}),
        ):
            started = monotonic()
            try:
                call_command(name, stdout=self.stdout, stderr=self.stderr, **arguments)
            except Exception as exc:
                # Match Compose's existing best-effort hardening step. All
                # other failures must stop startup.
                if name != "harden_database":
                    raise
                self.stderr.write(f"Database hardening failed. Continuing local startup. {exc}")
            self.stdout.write(f"{name} completed in {monotonic() - started:.2f}s")
