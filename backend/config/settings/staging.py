"""Hosted staging uses the same security requirements as production."""

from datetime import timedelta

from .production import *

ENVIRONMENT = "staging"

CELERY_BEAT_SCHEDULE = {
    **CELERY_BEAT_SCHEDULE,
    "outbox-dispatch": {
        **CELERY_BEAT_SCHEDULE["outbox-dispatch"],
        "schedule": timedelta(seconds=15),
    },
}
