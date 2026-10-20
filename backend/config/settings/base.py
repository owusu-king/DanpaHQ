"""Settings shared by every environment.

Configuration comes from the environment, never from a per-environment Python
file with secrets in it. ``env()`` fails loudly for required values rather than
falling back to a development default that then reaches production.
"""

from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
APP_VERSION = os.environ.get("APP_VERSION", "0.1.0")
ENVIRONMENT = os.environ.get("ENVIRONMENT", "local")


class ImproperlyConfigured(Exception):
    pass


def env(key: str, default=None, *, required: bool = False, cast=str):
    value = os.environ.get(key, default)
    if value is None:
        if required:
            raise ImproperlyConfigured(f"{key} must be set in the environment.")
        return None
    if cast is bool:
        return str(value).lower() in {"1", "true", "yes", "on"}
    if cast is list:
        return [item.strip() for item in str(value).split(",") if item.strip()]
    return cast(value)


SECRET_KEY = env("DJANGO_SECRET_KEY", "insecure-local-key-change-me")
DEBUG = False
ALLOWED_HOSTS = env("ALLOWED_HOSTS", "localhost,127.0.0.1", cast=list)

# --- Applications -----------------------------------------------------------
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "django.contrib.gis",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
]

# Ordering mirrors the dependency direction: platform apps first, then domain
# apps. A domain app may import from core; core may never import from a domain.
LOCAL_APPS = [
    "apps.core",
    "apps.audit",
    "apps.outbox",
    "apps.idempotency",
    "apps.geo",
    "apps.notifications",
    "apps.files",
    "apps.identity",
    "apps.trust",
    "apps.organization",
    "apps.property",
    "apps.tenancy",
    "apps.occupancy",
    "apps.listing",
    "apps.sale",
    "apps.viewing",
    "apps.application",
    "apps.lease",
    "apps.rent",
    "apps.maintenance",
    "apps.payments",
    "apps.billing",
    "apps.operations",
    "apps.passport",
    "apps.api",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "apps.core.middleware.RequestContextMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.core.middleware.ActorContextMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# --- Data -------------------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": env("POSTGRES_DB", "grp"),
        "USER": env("POSTGRES_USER", "grp"),
        "PASSWORD": env("POSTGRES_PASSWORD", "grp"),
        "HOST": env("POSTGRES_HOST", "localhost"),
        "PORT": env("POSTGRES_PORT", "5432"),
        # Persistent connections: at Ghanaian latencies the TCP+TLS handshake per
        # request is a visible share of p95, and pgbouncer sits in front in prod.
        "CONN_MAX_AGE": env("DB_CONN_MAX_AGE", 60, cast=int),
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {"connect_timeout": 5},
        "ATOMIC_REQUESTS": False,
    }
}
# --- Maps (ADR 0033) --------------------------------------------------------
#: West, south, east, north: Ghana with a margin. Where every map may go, and the
#: window markers are drawn for when a search names no area.
MAP_BOUNDS = [-3.35, 4.6, 1.3, 11.25]
MAP_DEFAULT_VIEW = {"lat": 5.6037, "lng": -0.187, "zoom": 11}

# Location provider (ADR 0034). Suggestions and the chosen place's location are
# looked up by the API on a client's behalf, so no client carries a key that can
# call Places.
#: "google" for Places API (New), or "localities" for Danpa HQ's own neighbourhoods.
#: "google" without a server key falls back to the localities.
LOCATION_PROVIDER = env("LOCATION_PROVIDER", "google")
#: Server-only key for Places API (New). In Google Cloud, restrict it to the API's
#: egress IP addresses and to the Places API (New); it never reaches a client.
GOOGLE_MAPS_SERVER_API_KEY = env("GOOGLE_MAPS_SERVER_API_KEY", "")
#: Countries suggestions may come from. Places API (New) accepts up to fifteen.
GOOGLE_PLACES_REGION_CODES = [
    code.strip().lower()
    for code in env("GOOGLE_PLACES_REGION_CODES", "gh").split(",")
    if code.strip()
]
GOOGLE_PLACES_LANGUAGE = env("GOOGLE_PLACES_LANGUAGE", "en")
GOOGLE_PLACES_TIMEOUT_SECONDS = float(env("GOOGLE_PLACES_TIMEOUT_SECONDS", "4"))
#: Public listing points are snapped to a grid this many degrees across — about
#: 300 m in Ghana — so a published marker cannot be walked back to a door.
LISTING_PUBLIC_CELL_DEGREES = 0.0027

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "identity.User"

REDIS_URL = env("REDIS_URL", "redis://localhost:6379/0")
PAYMENT_BACKEND = env("PAYMENT_BACKEND", "")
PAYMENT_INTENT_TTL_MINUTES = env("PAYMENT_INTENT_TTL_MINUTES", 30, cast=int)
# Development may exercise an explicitly watermarked template before counsel
# approves its wording. Production overrides this to True and cannot offer it.
# Paystack. Absent by default: `PAYMENT_BACKEND` empty means no adapter, and no
# client is offered a checkout that cannot move money.
#
# `PAYSTACK_ALLOW_LIVE` selects between separately stored test and live credentials.
# `PAYSTACK_SECRET_KEY` remains only as a compatibility fallback for deployments
# configured before the credentials were separated. See `apps/payments/paystack.py`.
PAYSTACK_SECRET_KEY = env("PAYSTACK_SECRET_KEY", "")
PAYSTACK_TEST_SECRET_KEY = env("PAYSTACK_TEST_SECRET_KEY", "")
PAYSTACK_TEST_PUBLIC_KEY = env("PAYSTACK_TEST_PUBLIC_KEY", "")
PAYSTACK_LIVE_SECRET_KEY = env("PAYSTACK_LIVE_SECRET_KEY", "")
PAYSTACK_LIVE_PUBLIC_KEY = env("PAYSTACK_LIVE_PUBLIC_KEY", "")
PAYSTACK_ALLOW_LIVE = env("PAYSTACK_ALLOW_LIVE", False, cast=bool)
PAYSTACK_CALLBACK_URL = env("PAYSTACK_CALLBACK_URL", "")
# The commercial platform share remains explicit configuration. Basis points
# become a per-transaction flat `transaction_charge`, freezing the split even if
# a Paystack subaccount default changes later. Paystack's own transaction fee is
# always borne by the provider subaccount; that is product policy, not config.
PAYSTACK_PLATFORM_CHARGE_BPS = env("PAYSTACK_PLATFORM_CHARGE_BPS", "")
PAYOUT_INSTITUTION_CACHE_SECONDS = env("PAYOUT_INSTITUTION_CACHE_SECONDS", 21600, cast=int)
PAYOUT_ACCOUNT_RESOLUTION_CACHE_SECONDS = env(
    "PAYOUT_ACCOUNT_RESOLUTION_CACHE_SECONDS", 3600, cast=int
)
PAYMENT_RECEIPT_EMAIL_DOMAIN = env("PAYMENT_RECEIPT_EMAIL_DOMAIN", "receipts.danpahq.com")

# Outgoing email: today, only the code that confirms an address on an account.
# SMTP by default; a deployment sets EMAIL_HOST and credentials (or swaps the
# backend for a provider's) — local development prints to the console instead.
EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "localhost")
EMAIL_PORT = env("EMAIL_PORT", 587, cast=int)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env("EMAIL_USE_TLS", "true").lower() == "true"
EMAIL_TIMEOUT = env("EMAIL_TIMEOUT", 10, cast=int)
RESEND_API_KEY = env("RESEND_API_KEY", "")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "Danpa HQ <no-reply@danpahq.com>")
# The floor under a part payment, in pesewas. It exists because the receiving
# Portfolio bears the processor's transaction fee, so unbounded micro-payments
# are a cost transfer onto the person owed the money. Settling the entire
# remaining balance is always permitted however small it is.
PAYMENT_MINIMUM_PART_MINOR = env("PAYMENT_MINIMUM_PART_MINOR", 5000, cast=int)
# How long a reconciliation exception may stay open before the worker starts
# saying so, and how long before it says so at `critical`. Alert routing itself
# is a deployment binding on the `event` keys — see docs/runbook.md.
PAYMENT_RECONCILIATION_AGEING_HOURS = env("PAYMENT_RECONCILIATION_AGEING_HOURS", 4, cast=int)
PAYMENT_RECONCILIATION_BREACH_HOURS = env("PAYMENT_RECONCILIATION_BREACH_HOURS", 24, cast=int)
# Where a financial exception goes when it leaves the process. Slack, PagerDuty,
# Opsgenie and every log platform accept an incoming webhook, so this binds to
# whatever the deployment uses without Danpa HQ picking a vendor. Empty means the
# structured log line is the only alert path, which is a decision to make
# deliberately rather than by omission — see docs/runbook.md.
PAYMENT_ALERT_WEBHOOK_URL = env("PAYMENT_ALERT_WEBHOOK_URL", "")
# Who owns these. Stated in every alert, because one addressed to nobody is one
# everybody assumes somebody else has.
PAYMENT_ALERT_OWNER = env("PAYMENT_ALERT_OWNER", "")
PAYMENT_ALERT_TIMEOUT_SECONDS = env("PAYMENT_ALERT_TIMEOUT_SECONDS", 5, cast=int)

LEASE_TEMPLATE_REQUIRE_APPROVAL = env("LEASE_TEMPLATE_REQUIRE_APPROVAL", False, cast=bool)
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
        "TIMEOUT": 300,
    }
}
SESSION_ENGINE = "django.contrib.sessions.backends.cache"

# --- Celery -----------------------------------------------------------------
CELERY_BROKER_URL = env("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", REDIS_URL)
CELERY_TASK_ACKS_LATE = True  # redeliver if a worker dies mid-task
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1  # fair dispatch for uneven task durations
CELERY_TASK_TIME_LIMIT = 300
CELERY_TASK_SOFT_TIME_LIMIT = 240
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_TASK_ROUTES = {
    # Money and notifications must not queue behind image processing.
    "payments.*": {"queue": "payments"},
    "rent.*": {"queue": "payments"},
    "notifications.*": {"queue": "notifications"},
    "media.*": {"queue": "media"},
    "outbox.*": {"queue": "default"},
}
CELERY_BEAT_SCHEDULE = {
    "outbox-dispatch": {
        "task": "outbox.dispatch_pending",
        "schedule": timedelta(seconds=5),
    },
    # Verifications age. These jobs keep the stored status honest and warn people
    # before a stamp lapses, rather than after.
    # Money the provider took that no callback ever told us about is invisible
    # until somebody goes and looks. Hourly is a compromise between finding it
    # the same working day and not hammering a provider's query API.
    "payments-reconcile": {
        "task": "payments.reconcile",
        "schedule": timedelta(hours=1),
    },
    "trust-expire": {
        "task": "trust.expire_verifications",
        "schedule": timedelta(hours=1),
    },
    "trust-warn-expiring": {
        "task": "trust.warn_expiring_verifications",
        "schedule": timedelta(days=1),
    },
    "trust-release-claims": {
        "task": "trust.release_stale_claims",
        "schedule": timedelta(minutes=10),
    },
    "identity-purge-challenges": {
        "task": "identity.purge_expired_challenges",
        "schedule": timedelta(hours=6),
    },
    "idempotency-purge-expired": {
        "task": "idempotency.purge_expired",
        "schedule": timedelta(hours=1),
    },
    "payments-expire-intents": {
        "task": "payments.expire_intents",
        "schedule": timedelta(minutes=5),
    },
    # Unread notifications weeks old are history: marked read, then pruned.
    "notifications-age-out": {
        "task": "notifications.age_out_stale",
        "schedule": timedelta(days=1),
    },
    # Separate from the sweep so alerting survives the sweep failing, and more
    # frequent than it so a breach is noticed within the half hour rather than
    # on the next hourly pass.
    "payments-alert-open-exceptions": {
        "task": "payments.alert_open_exceptions",
        "schedule": timedelta(minutes=30),
    },
    # A paid period that has ended is moved on: to Free if it was cancelled, to
    # the plan chosen for it, or into grace while renewal is due. Fifteen
    # minutes keeps "renews on the 30th" true on the 30th without a job per
    # subscription.
    "billing-advance-subscriptions": {
        "task": "billing.advance_subscriptions",
        "schedule": timedelta(minutes=15),
    },
    # Restrictions are applied inside the transaction that lowers a limit. This
    # catches what time alone changes: a wind-down whose last tenancy ended by a
    # path that did not say so, and an override that ran out.
    "billing-reconcile-resource-access": {
        "task": "billing.reconcile_resource_access",
        "schedule": timedelta(minutes=15),
    },
    "rent-due-reminders": {
        "task": "rent.emit_due_reminders",
        # Ghana has no daylight-saving shift. Hourly keeps the task tolerant of
        # worker downtime without sending the same checkpoint twice.
        "schedule": timedelta(hours=1),
    },
    "lease-expiry-alerts": {
        "task": "lease.emit_expiry_alerts",
        # Each checkpoint is deduplicated per person, so running often only
        # makes a missed run cheap to recover from.
        "schedule": timedelta(hours=6),
    },
    "viewing-due-notifications": {
        "task": "viewing.emit_due_notifications",
        "schedule": timedelta(minutes=5),
    },
    "media-expire-abandoned": {
        "task": "media.expire_abandoned_uploads",
        "schedule": timedelta(hours=1),
    },
    "media-purge-expired": {
        "task": "media.purge_expired_files",
        "schedule": timedelta(days=1),
    },
}

# --- API --------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # Bearer tokens only. SessionAuthentication used to sit here too, and it
        # was a trap: a Django admin session cookie is set for the whole host,
        # ports included, so a browser that had visited /admin/ sent it to the
        # API as well. DRF then authenticated it and enforced CSRF, and every
        # POST from the console on :3000 failed with "CSRF Failed: Origin
        # checking failed" - reported to the user as "You do not have access to
        # this." on the sign-in screen.
        #
        # It bought nothing in exchange: the browsable API is off (JSON renderer
        # only) and both clients are token-authenticated. The Django admin is
        # unaffected - it uses Django's own auth middleware, not DRF's.
        "apps.identity.authentication.AccessTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        # Deny by default. Every public endpoint opts out explicitly, so
        # forgetting a permission class fails closed instead of open.
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardCursorPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "EXCEPTION_HANDLER": "apps.api.exception_handler.handle",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/min",
        "user": "600/min",
        "otp": "5/hour",
        "otp_verify": "30/hour",
        "google_auth": "30/min",
        "payment": "20/min",
        "payment_webhook": "120/min",
        "access_code_user": "10/min",
        "access_code_ip": "30/min",
        "viewing_checkin_user": "12/min",
        "viewing_checkin_ip": "30/min",
        # Opening Housing Passport share links, per address.
        "passport_view_ip": "60/min",
        # Suggestions and resolves together. A cost control: generous, because
        # a phone network puts many tenants behind one address.
        "places": "240/min",
    },
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}

# Django admin is a separate credential boundary from consumer phone OTP.
# DRF does not use this backend; it continues to use the bearer-token class
# above. The admin login form accepts only an email-verified staff principal.
AUTHENTICATION_BACKENDS = ["apps.identity.admin_auth.AdminEmailBackend"]
# An unguessable path keeps scanners off the admin password form; the attempt
# cap in `admin_auth` is the control, this only cuts the noise.
ADMIN_URL = (env("ADMIN_URL", "admin/").strip("/") or "admin") + "/"

# `check --deploy --fail-level WARNING` exists to catch security
# misconfiguration before a release. drf-spectacular's completeness notices are
# not that: W002 says it could not infer a serializer for a plain `APIView` and
# is "graceful fallback handling" by its own description, and W001 reports
# operationId collisions it then resolves with numeral suffixes. 136 of them
# buried the one warning that mattered, which is how a deployment gate stops
# being read.
#
# Silenced for the *check*, not hidden: `manage.py spectacular` still prints
# every one, which is where somebody improving the schema would be looking.
# Annotating the views so the schema describes real request and response bodies
# is outstanding work — see `docs/known-limitations.md`.
SILENCED_SYSTEM_CHECKS = ["drf_spectacular.W001", "drf_spectacular.W002"]

SPECTACULAR_SETTINGS = {
    "TITLE": "Danpa HQ API",
    "VERSION": APP_VERSION,
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS", "http://localhost:3000", cast=list)
CORS_ALLOW_CREDENTIALS = True
# django-cors-headers' default allowlist does not include our own headers, and a
# header the preflight does not permit blocks the request that follows. Both web
# and mobile send X-Request-ID and X-Client on *every* call, so without these
# two entries no browser request to this API succeeds at all.
CORS_ALLOW_HEADERS = [
    "accept",
    "authorization",
    "content-type",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "x-request-id",
    "x-client",
    "idempotency-key",
    "x-management-csrf",
]

MANAGEMENT_SESSION_TTL_SECONDS = 12 * 60 * 60
MANAGEMENT_CSRF_KEY = env("MANAGEMENT_CSRF_KEY", SECRET_KEY)

# --- Storage ----------------------------------------------------------------
STORAGES = {
    "default": {"BACKEND": "storages.backends.s3.S3Storage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
AWS_STORAGE_BUCKET_NAME = env("S3_BUCKET", "grp-local")
AWS_S3_ENDPOINT_URL = env("S3_ENDPOINT_URL", "http://localhost:9000")
#: The endpoint a *client* can reach, which is not always the one the server
#: uses. In docker-compose the API talks to http://minio:9000 over the compose
#: network, but a presigned URL carrying that hostname is useless to a browser
#: or a phone - neither can resolve it. Set this to the address clients see.
AWS_S3_PUBLIC_ENDPOINT_URL = env("S3_PUBLIC_ENDPOINT_URL", AWS_S3_ENDPOINT_URL)
#: Take the *host* from the request and the scheme and port from the setting
#: above, so one deployment serves a browser, an emulator and a handset without
#: anyone editing an address.
#:
#: Off by default. In production `ALLOWED_HOSTS` is an explicit list and the
#: storage endpoint is a real CDN or bucket host that has nothing to do with the
#: host the API answers on, so following the request there would be wrong. It is
#: for development, where MinIO sits on the same machine as the API and the
#: right address depends on which device is asking.
AWS_S3_PUBLIC_ENDPOINT_FOLLOWS_REQUEST = env("S3_PUBLIC_ENDPOINT_FOLLOWS_REQUEST", False, cast=bool)
AWS_S3_REGION_NAME = env("S3_REGION", "us-east-1")
AWS_ACCESS_KEY_ID = env("S3_ACCESS_KEY", "minioadmin")
AWS_SECRET_ACCESS_KEY = env("S3_SECRET_KEY", "minioadmin")
AWS_DEFAULT_ACL = None
AWS_QUERYSTRING_AUTH = True  # signed URLs only; no public objects
AWS_QUERYSTRING_EXPIRE = 300
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --- Storage backend ---------------------------------------------------------
# "s3"    — S3-compatible object storage (MinIO locally, real S3 in production).
#            Default. The same code runs locally and in production.
# "local" — Filesystem under MEDIA_ROOT with self-signed URLs.
#            For Windows developers who cannot run Docker easily, or for
#            environments where MinIO is unavailable.
# "memory"— In-process store. Tests only; data is lost between requests.
STORAGE_BACKEND = env("STORAGE_BACKEND", "s3")

# Where the local backend stores files on disk.
LOCAL_STORAGE_ROOT = BASE_DIR / "media"
LOCAL_STORAGE_BASE_URL = env("LOCAL_STORAGE_BASE_URL", "http://localhost:8000/api/v1/storage")

# Signing key for local-backend presigned URLs and downloads.
# Separate from SECRET_KEY so a key rotation does not invalidate in-flight
# uploads. Falls back to SECRET_KEY in development where separation is less
# important, because leaking a dev file is less bad than making setup harder.
STORAGE_SIGNING_KEY = env("STORAGE_SIGNING_KEY", None)

# "strict" — refuse new uploads until an approved scanner is configured.
# "cloudmersive" — scan through the Cloudmersive API (3.5 MB file limit).
# "permissive" — development-only bypass after magic-byte validation.
FILE_SCAN_MODE = env("FILE_SCAN_MODE", "strict")
CLOUDMERSIVE_API_KEY = env("CLOUDMERSIVE_API_KEY", "")

# --- Authentication secrets -------------------------------------------------
# Separate from SECRET_KEY so they can be rotated independently: rotating the
# OTP pepper invalidates live codes only, while rotating SECRET_KEY would also
# break sessions, signed cookies and password reset links.
OTP_PEPPER = env("OTP_PEPPER", SECRET_KEY)
ACCESS_TOKEN_KEY = env("ACCESS_TOKEN_KEY", SECRET_KEY)
# OAuth client identifiers are public identifiers, not secrets. The backend
# still owns this copy because it is the audience every Google ID token must
# match; an empty value keeps the feature fail-closed until configured.
GOOGLE_OAUTH_CLIENT_ID = env("GOOGLE_OAUTH_CLIENT_ID", "")
NATIONAL_ID_PEPPER = env("NATIONAL_ID_PEPPER", SECRET_KEY)
UNIT_ACCESS_CODE_PEPPER = env("UNIT_ACCESS_CODE_PEPPER", SECRET_KEY)
UNIT_ACCESS_CODE_TTL_DAYS = env("UNIT_ACCESS_CODE_TTL_DAYS", 30, cast=int)
# Derives Housing Passport share-link tokens from their stored salts; see
# `apps.passport.tokens`. Rotating it invalidates every live share link.
PASSPORT_SHARE_PEPPER = env("PASSPORT_SHARE_PEPPER", SECRET_KEY)
IDEMPOTENCY_TTL_HOURS = env("IDEMPOTENCY_TTL_HOURS", 24, cast=int)

SMS_BACKEND = env("SMS_BACKEND", "console")
SMS_TIMEOUT_SECONDS = env("SMS_TIMEOUT_SECONDS", 10, cast=int)
ARKESEL_API_KEY = env("ARKESEL_API_KEY", "")
ARKESEL_SENDER_ID = env("ARKESEL_SENDER_ID", "")
ARKESEL_SANDBOX = env("ARKESEL_SANDBOX", False, cast=bool)

# Operations can turn this high-impact device action off without requiring a
# mobile release. The server also enforces the switch, so an older app cannot
# keep calling the endpoint after it has been disabled.
STOLEN_DEVICE_REPORTING_ENABLED = env("STOLEN_DEVICE_REPORTING_ENABLED", True, cast=bool)
# Prefer a key independent from Django's session/signing key in production. The
# fallback keeps local development bootstrappable.
RUNTIME_CONFIG_ENCRYPTION_KEY = env("RUNTIME_CONFIG_ENCRYPTION_KEY", "")
RUNTIME_CONFIGURATION_ENABLED = True

# --- Locale -----------------------------------------------------------------
LANGUAGE_CODE = "en-gb"
TIME_ZONE = "Africa/Accra"  # UTC+0, no DST
USE_I18N = True
USE_TZ = True  # store UTC, render local

# --- Security ---------------------------------------------------------------
#: Eight characters, not a known-common password, and not the phone number the
#: account is keyed on.
#:
#: It was ten, which is longer than Django's own default and long enough to be
#: the main reason people abandoned the form. The numeric rule is deliberately
#: kept: a market used to four-digit PINs will otherwise choose eight digits,
#: and an all-numeric password on an account holding tenancy records and rent
#: history is worth the small friction of saying no.
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
#: Stated in one place so the API, the web form and the mobile form cannot drift
#: from what the validators above actually enforce.
PASSWORD_MIN_LENGTH = 8
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

# --- Logging ----------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {"()": "apps.core.logging.JsonFormatter"},
        "console": {"format": "%(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "stdout": {
            "class": "logging.StreamHandler",
            "formatter": env("LOG_FORMAT", "json"),
        }
    },
    "root": {"handlers": ["stdout"], "level": env("LOG_LEVEL", "INFO")},
    "loggers": {
        "django.db.backends": {"level": "WARNING", "handlers": ["stdout"], "propagate": False},
        "api": {"level": "INFO", "handlers": ["stdout"], "propagate": False},
        "outbox": {"level": "INFO", "handlers": ["stdout"], "propagate": False},
    },
}
