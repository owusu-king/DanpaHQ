from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = "apps.core"
    label = "core"
    verbose_name = "Core"

    def ready(self):
        from django.db.backends.signals import connection_created

        from .database import configure_extension_search_path

        connection_created.connect(
            configure_extension_search_path, dispatch_uid="core.extension_search_path",
        )
