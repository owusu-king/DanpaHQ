"""Production settings.

Everything here fails to start rather than starting insecurely. A missing secret
should stop a deploy, not produce a running service with a default key.
"""

from .base import *
from .base import env

DEBUG = False
SECRET_KEY = env("DJANGO_SECRET_KEY", required=True)
ALLOWED_HOSTS = env("ALLOWED_HOSTS", required=True, cast=list)

SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31_536_000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS", required=True, cast=list)
# `base` defaults this to http://localhost:3000 so development works with no
# configuration. In production that default is a browser origin allowed to make
# credentialed cross-origin calls to the API, so it must be stated deliberately
# rather than inherited — and `CORS_ALLOW_CREDENTIALS` is on.
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS", required=True, cast=list)

DATABASES["default"]["OPTIONS"]["sslmode"] = env("DB_SSLMODE", "require")

# Authentication secrets must be set explicitly in production. Falling back to
# SECRET_KEY here would couple OTP and token rotation to the Django key, which is
# exactly what the separation exists to avoid.
OTP_PEPPER = env("OTP_PEPPER", required=True)
ACCESS_TOKEN_KEY = env("ACCESS_TOKEN_KEY", required=True)
NATIONAL_ID_PEPPER = env("NATIONAL_ID_PEPPER", required=True)
UNIT_ACCESS_CODE_PEPPER = env("UNIT_ACCESS_CODE_PEPPER", required=True)
MANAGEMENT_CSRF_KEY = env("MANAGEMENT_CSRF_KEY", required=True)

# No SMS provider is integrated yet. Starting production with the console backend
# would silently print one-time codes to the logs, so this must be set to a real
# adapter before launch.
SMS_BACKEND = env("SMS_BACKEND", required=True)
STORAGE_BACKEND = env("STORAGE_BACKEND", "s3")
STORAGE_SIGNING_KEY = env("STORAGE_SIGNING_KEY", required=True)
FILE_SCAN_MODE = env("FILE_SCAN_MODE", "strict")
LEASE_TEMPLATE_REQUIRE_APPROVAL = True

# An empty backend keeps checkout unavailable. The deterministic memory adapter
# is for signed integration tests only and must never become a production rail.
PAYMENT_BACKEND = env("PAYMENT_BACKEND", "")
if PAYMENT_BACKEND == "memory":
    raise ImproperlyConfigured("PAYMENT_BACKEND=memory is forbidden in production")

# Production storage: always S3, always strict scanning.
STORAGE_BACKEND = "s3"
FILE_SCAN_MODE = env("FILE_SCAN_MODE", "strict")
# A separate signing key for presigned local-backend URLs. Only needed if
# STORAGE_BACKEND=local ever reaches production (unlikely but possible for
# a private deployment without object storage).
STORAGE_SIGNING_KEY = env("STORAGE_SIGNING_KEY", required=True)
