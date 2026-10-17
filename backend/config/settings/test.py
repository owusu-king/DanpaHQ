from .base import *

DEBUG = False
# Not a secret and cannot become one: this module is only ever loaded by
# `DJANGO_SETTINGS_MODULE=config.settings.test`, and production reads the key
# from the environment. Named so that finding it in a running process is
# immediately recognisable as the wrong settings module.
SECRET_KEY = "test-only-key"  # nosec B105

# Fast, deterministic tests.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
SESSION_ENGINE = "django.contrib.sessions.backends.db"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
LOGGING["root"]["level"] = "ERROR"
SMS_BACKEND = "memory"
STORAGE_BACKEND = "memory"
FILE_SCAN_MODE = "permissive"
PAYMENT_BACKEND = "memory"
PAYMENT_TEST_WEBHOOK_SECRET = "test-payment-webhook-secret"  # nosec B105
RUNTIME_CONFIGURATION_ENABLED = False
