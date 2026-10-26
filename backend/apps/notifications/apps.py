from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    name = "apps.notifications"
    label = "notifications"
    verbose_name = "Notifications"

    def ready(self):
        # Importing the module is what registers the outbox subscriptions.
        # Without this the events are dispatched to nobody and the product is
        # silent again.
        from . import handlers  # noqa
