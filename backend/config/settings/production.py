"""Production settings.

Everything here fails to start rather than starting insecurely. A missing secret
should stop a deploy, not produce a running service with a default key.
"""

from django.core.exceptions import ImproperlyConfigured

from .base import *
from .base import env

DEBUG = False
# The settings module, not an optional hosting environment variable, defines
# the runtime classification surfaced by /readyz and operational logs.
ENVIRONMENT = "production"
SECRET_KEY = env("DJANGO_SECRET_KEY", required=True)

# Render names the service's own public host (`<name>.onrender.com`) in
# RENDER_EXTERNAL_HOSTNAME. It is trusted without being repeated by hand; any
# custom domain still has to be listed. With neither, the deploy stops here.
_RENDER_HOST = env("RENDER_EXTERNAL_HOSTNAME", "")
ALLOWED_HOSTS = [host for host in env("ALLOWED_HOSTS", "", cast=list) if host]
if _RENDER_HOST and _RENDER_HOST not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(_RENDER_HOST)
if not ALLOWED_HOSTS:
    raise ImproperlyConfigured("Set ALLOWED_HOSTS (or deploy on Render, which names the host).")

SECURE_SSL_REDIRECT = True
# The platform's health probe speaks plain HTTP inside the network; a redirect
# to HTTPS would read as an unhealthy deploy. Nothing else is exempt.
SECURE_REDIRECT_EXEMPT = [r"^healthz$", r"^api/v1/healthz/$"]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31_536_000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
CSRF_TRUSTED_ORIGINS = [origin for origin in env("CSRF_TRUSTED_ORIGINS", "", cast=list) if origin]
if _RENDER_HOST and f"https://{_RENDER_HOST}" not in CSRF_TRUSTED_ORIGINS:
    CSRF_TRUSTED_ORIGINS.append(f"https://{_RENDER_HOST}")
if not CSRF_TRUSTED_ORIGINS:
    raise ImproperlyConfigured(
        "Set CSRF_TRUSTED_ORIGINS (or deploy on Render, which names the host)."
    )
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
# Set by the blueprint for new services. An existing Render service keeps the
# variables it was created with, so this falls back to the (required) Django
# key rather than refusing to boot; set it in the dashboard to separate them.
PASSPORT_SHARE_PEPPER = env("PASSPORT_SHARE_PEPPER", SECRET_KEY)
MANAGEMENT_CSRF_KEY = env("MANAGEMENT_CSRF_KEY", required=True)
RUNTIME_CONFIG_ENCRYPTION_KEY = env("RUNTIME_CONFIG_ENCRYPTION_KEY", required=True)

# Start fail-closed until an operations administrator selects and configures the
# Arkesel adapter in Management. Never default production to the console adapter,
# because it writes one-time codes to application logs.
SMS_BACKEND = env("SMS_BACKEND", "null")
STORAGE_SIGNING_KEY = env("STORAGE_SIGNING_KEY", required=True)
LEASE_TEMPLATE_REQUIRE_APPROVAL = True

# An empty backend keeps checkout unavailable. The deterministic memory adapter
# is for signed integration tests only and must never become a production rail.
PAYMENT_BACKEND = env("PAYMENT_BACKEND", "")
if PAYMENT_BACKEND == "memory":
    raise ImproperlyConfigured("PAYMENT_BACKEND=memory is forbidden in production")

# Production storage is private S3. Scanning may be held closed until a real
# provider is configured; the development bypass is never allowed here.
STORAGE_BACKEND = "s3"
FILE_SCAN_MODE = env("FILE_SCAN_MODE", "strict")
if FILE_SCAN_MODE not in {"strict", "cloudmersive"}:
    raise ImproperlyConfigured(
        "Production FILE_SCAN_MODE must be strict or cloudmersive; permissive is unsafe."
    )
CLOUDMERSIVE_API_KEY = env("CLOUDMERSIVE_API_KEY", "")
if FILE_SCAN_MODE == "cloudmersive" and not CLOUDMERSIVE_API_KEY:
    raise ImproperlyConfigured("Set CLOUDMERSIVE_API_KEY to enable Cloudmersive scanning.")

# Render Free blocks SMTP egress. Use a transactional HTTPS provider instead.
EMAIL_BACKEND = env("EMAIL_BACKEND", "apps.identity.email_backend.ResendEmailBackend")
RESEND_API_KEY = env("RESEND_API_KEY", "")
if EMAIL_BACKEND in {
    "django.core.mail.backends.console.EmailBackend",
    "django.core.mail.backends.dummy.EmailBackend",
    "django.core.mail.backends.locmem.EmailBackend",
    "django.core.mail.backends.filebased.EmailBackend",
}:
    raise ImproperlyConfigured("Production email must use a real delivery backend.")
if EMAIL_BACKEND == "apps.identity.email_backend.ResendEmailBackend" and not RESEND_API_KEY:
    raise ImproperlyConfigured("Set RESEND_API_KEY to enable production email delivery.")
if EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend" and EMAIL_HOST in {
    "localhost",
    "127.0.0.1",
}:
    raise ImproperlyConfigured("Set a real EMAIL_HOST for production SMTP.")
