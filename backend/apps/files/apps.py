from django.apps import AppConfig


class FilesConfig(AppConfig):
    name = "apps.files"
    label = "files"
    verbose_name = "Files"

    def ready(self):
        # Register the Celery beat schedules that live in this app.
        from django.conf import settings

        if hasattr(settings, "CELERY_BEAT_SCHEDULE"):
            from datetime import timedelta

            settings.CELERY_BEAT_SCHEDULE.setdefault(
                "media-expire-abandoned",
                {"task": "media.expire_abandoned_uploads", "schedule": timedelta(hours=1)},
            )
            settings.CELERY_BEAT_SCHEDULE.setdefault(
                "media-purge-expired",
                {"task": "media.purge_expired_files", "schedule": timedelta(hours=24)},
            )
