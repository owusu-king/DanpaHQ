from django.apps import AppConfig


class LeaseConfig(AppConfig):
    name = "apps.lease"
    label = "lease"
    verbose_name = "Leases"

    def ready(self) -> None:
        # Importing registers this app's lifecycle policies, which is what
        # lets the API enumerate permitted actions for a client.
        from . import policies  # noqa: F401
