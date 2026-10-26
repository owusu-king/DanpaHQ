from django.apps import AppConfig


class PropertyConfig(AppConfig):
    name = "apps.property"
    label = "property"
    verbose_name = "Property"

    def ready(self) -> None:
        # Importing registers this app's lifecycle policies, which is what
        # lets the API enumerate permitted actions for a client.
        from . import policies  # noqa: F401
