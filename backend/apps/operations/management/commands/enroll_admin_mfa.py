"""Enroll an administrator from a trusted operator terminal, never startup logs."""

import getpass

from django.apps import apps
from django.core.management.base import BaseCommand, CommandError

from apps.core.exceptions import ValidationFailed
from apps.operations import mfa


class Command(BaseCommand):
    help = "Enroll/reset administrator MFA interactively. Store recovery codes offline."

    def add_arguments(self, parser):
        parser.add_argument("--surface", required=True, choices=["django", "management"])
        parser.add_argument("--email", required=True)
        parser.add_argument("--reset", action="store_true")

    def handle(self, *args, **options):
        label = "identity.User" if options["surface"] == "django" else "operations.ManagementUser"
        model = apps.get_model(label)
        users = model.objects.filter(email__iexact=options["email"].strip())
        if users.count() != 1:
            raise CommandError("Choose exactly one provisioned administrator.")
        user = users.get()
        if mfa.device_id(user) and not options["reset"]:
            raise CommandError("Already enrolled. Use --reset only for an authorized recovery.")
        secret = mfa.new_secret()
        self.stdout.write("Private enrollment key. Do not copy this output into logs or tickets.")
        self.stdout.write(f"Account: {user.email}\nKey: {secret}")
        self.stdout.write(mfa.provisioning_uri(user=user, secret=secret))
        code = getpass.getpass("Enter the six-digit code from your authenticator: ")
        try:
            recovery = mfa.enroll(user=user, secret=secret, code=code, reset=options["reset"])
        except ValidationFailed as exc:
            raise CommandError(exc.message) from exc
        self.stdout.write(
            "MFA enrolled. Save these one-use recovery codes in a secure offline location:"
        )
        for value in recovery:
            self.stdout.write(value)
        self.stdout.write(
            "Existing sessions are invalid. Use a fresh authenticator code to sign in."
        )
