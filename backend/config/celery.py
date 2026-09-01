from __future__ import annotations

import os

from celery import Celery
from celery.signals import setup_logging

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

app = Celery("grp")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@setup_logging.connect
def configure_logging(**_):
    """Use Django's LOGGING so worker output is the same JSON as the API's."""
    from logging.config import dictConfig

    from django.conf import settings

    dictConfig(settings.LOGGING)
