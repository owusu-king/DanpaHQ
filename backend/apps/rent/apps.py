from django.apps import AppConfig


class RentConfig(AppConfig):
    name = "apps.rent"
    label = "rent"
    verbose_name = "Rent"

    def ready(self):
        from . import handlers  # noqa
