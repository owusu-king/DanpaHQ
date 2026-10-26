"""Optional first-admin creation, only in the isolated owner release job."""

import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, connection, transaction
from django.db.models import Q

from apps.core.phone import PhoneNumberError, normalise_ghana_msisdn

BOOTSTRAP_LOCK = 0x44414E50414253


class Command(BaseCommand):
    help = "Create the first superuser if configured; never change an existing account."

    def handle(self, *args, **options):
        values = [os.environ.pop(f"DJANGO_SUPERUSER_{key}", "")
                  for key in ("PHONE", "EMAIL", "PASSWORD")]
        user_model = get_user_model()
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("SELECT current_user")
            if cursor.fetchone()[0] == settings.DATABASE_RUNTIME_ROLE:
                raise CommandError("Bootstrap requires the isolated owner release environment.")
            # Serialize even separate release runners/commands. Include disabled
            # superusers in the check: bootstrap must never bypass deactivation.
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [BOOTSTRAP_LOCK])
            if user_model.objects.filter(is_superuser=True).exists():
                self.stdout.write("Superuser exists; bootstrap skipped.")
                return
            if not any(values):
                self.stdout.write("No bootstrap credentials configured; skipped.")
                return
            if not all(value.strip() for value in values):
                raise CommandError("Set all three DJANGO_SUPERUSER_* values, or none.")
            phone, email, password = values
            email = user_model.objects.normalize_email(email.strip())
            try:
                phone = normalise_ghana_msisdn(phone)
                user_model._meta.get_field("email").clean(email, None)
                validate_password(password, user=user_model(phone=phone, email=email))
            except (ValidationError, PhoneNumberError):
                raise CommandError("Invalid bootstrap details or weak password.") from None
            if user_model.objects.filter(Q(phone=phone) | Q(email__iexact=email)).exists():
                raise CommandError("Bootstrap details belong to an existing account; refusing.")
            try:
                user_model.objects.create_superuser(phone=phone, email=email, password=password)
            except IntegrityError:
                raise CommandError("Bootstrap conflicts with an existing account.") from None
        self.stdout.write(self.style.SUCCESS(
            "First superuser created; remove bootstrap credentials."
        ))
