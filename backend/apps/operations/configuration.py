"""The small, explicit set of runtime values Management may change.

Environment settings remain the fallback and bootstrap mechanism. A database
override wins only for keys declared here; this is deliberately not an
arbitrary key/value console. Secrets are encrypted at rest and the API exposes
only whether one is present.
"""

from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.core.validators import URLValidator
from django.db import OperationalError, ProgrammingError, transaction

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import ValidationFailed

from .models import ConfigurationValue, ManagementUser


@dataclass(frozen=True, slots=True)
class ConfigurationField:
    key: str
    section: str
    label: str
    description: str
    kind: str = "text"
    secret: bool = False
    choices: tuple[tuple[str, str], ...] = ()
    minimum: int | None = None
    maximum: int | None = None
    max_length: int = 500
    exposed: bool = True


FIELDS = (
    ConfigurationField(
        "PAYMENT_BACKEND",
        "Payments",
        "Payment provider",
        "Keep disabled until Paystack sandbox checks are complete.",
        kind="choice",
        choices=(("", "Disabled"), ("paystack", "Paystack")),
    ),
    ConfigurationField(
        "PAYSTACK_SECRET_KEY",
        "Payments",
        "Legacy Paystack secret key",
        "Compatibility fallback for deployments configured before separate test and live keys.",
        secret=True,
        max_length=300,
        exposed=False,
    ),
    ConfigurationField(
        "PAYSTACK_TEST_SECRET_KEY",
        "Payments",
        "Paystack test secret key",
        "Used for test transactions on the server and never returned after saving.",
        secret=True,
        max_length=300,
    ),
    ConfigurationField(
        "PAYSTACK_TEST_PUBLIC_KEY",
        "Payments",
        "Paystack test public key",
        "The pk_test_ key for test-mode client and mobile integrations.",
        max_length=300,
    ),
    ConfigurationField(
        "PAYSTACK_LIVE_SECRET_KEY",
        "Payments",
        "Paystack live secret key",
        "Used for real transactions on the server and never returned after saving.",
        secret=True,
        max_length=300,
    ),
    ConfigurationField(
        "PAYSTACK_LIVE_PUBLIC_KEY",
        "Payments",
        "Paystack live public key",
        "The pk_live_ key for live client and mobile integrations.",
        max_length=300,
    ),
    ConfigurationField(
        "PAYSTACK_ALLOW_LIVE",
        "Payments",
        "Use live Paystack credentials",
        "When off, payments use the test secret key. Turn on only when real payments should run.",
        kind="boolean",
    ),
    ConfigurationField(
        "PAYSTACK_CALLBACK_URL",
        "Payments",
        "Paystack return URL",
        "The HTTPS page customers return to after hosted checkout.",
        kind="url",
    ),
    ConfigurationField(
        "PAYSTACK_PLATFORM_CHARGE_BPS",
        "Payments",
        "Platform charge (basis points)",
        "For example, 300 is 3%. The value is frozen on each payment.",
        kind="integer",
        minimum=0,
        maximum=9999,
    ),
    ConfigurationField(
        "SMS_BACKEND",
        "Messaging",
        "SMS provider",
        "Console is for development, Null discards messages, and Arkesel sends them.",
        kind="choice",
        choices=(("console", "Console"), ("null", "Null"), ("arkesel", "Arkesel")),
    ),
    ConfigurationField(
        "ARKESEL_API_KEY",
        "Messaging",
        "Arkesel API key",
        "Sent in Arkesel's api-key header and never returned after saving.",
        secret=True,
        max_length=300,
    ),
    ConfigurationField(
        "ARKESEL_SENDER_ID",
        "Messaging",
        "Arkesel sender ID",
        "The approved sender name shown on the message (maximum 11 characters).",
        max_length=11,
    ),
    ConfigurationField(
        "ARKESEL_SANDBOX",
        "Messaging",
        "Use Arkesel sandbox",
        "Sandbox requests appear in Arkesel but are not delivered or billed.",
        kind="boolean",
    ),
    ConfigurationField(
        "STOLEN_DEVICE_REPORTING_ENABLED",
        "Features",
        "Lost or stolen device reporting",
        "When disabled, mobile users can still sign devices out but cannot permanently block them.",
        kind="boolean",
    ),
)

FIELD_BY_KEY = {field.key: field for field in FIELDS}


def _fernet() -> Fernet:
    material = str(
        getattr(settings, "RUNTIME_CONFIG_ENCRYPTION_KEY", "") or settings.SECRET_KEY
    ).encode()
    key = base64.urlsafe_b64encode(hashlib.sha256(material).digest())
    return Fernet(key)


def _encrypt(value: str) -> str:
    return "fernet:" + _fernet().encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    if not value.startswith("fernet:"):
        raise ImproperlyConfigured("A runtime secret is not encrypted.")
    try:
        return _fernet().decrypt(value.removeprefix("fernet:").encode()).decode()
    except InvalidToken as exc:
        raise ImproperlyConfigured(
            "A runtime secret could not be decrypted with this deployment's key."
        ) from exc


def _cast(field: ConfigurationField, raw: str) -> Any:
    if field.kind == "boolean":
        return raw.lower() == "true"
    if field.kind == "integer":
        return int(raw) if raw else ""
    return raw


def value(key: str, default: Any = None) -> Any:
    """Return Management's override, falling back to Django settings.

    Database setup and migration commands may run before this table exists, so
    the fallback stays available during bootstrap.
    """

    field = FIELD_BY_KEY.get(key)
    if field is None:
        raise KeyError(f"{key} is not a managed configuration key")
    if not getattr(settings, "RUNTIME_CONFIGURATION_ENABLED", True):
        return getattr(settings, key, default)
    try:
        stored = ConfigurationValue.objects.filter(key=key).only("value", "is_secret").first()
    except (OperationalError, ProgrammingError):
        stored = None
    if stored is None:
        return getattr(settings, key, default)
    raw = _decrypt(stored.value) if stored.is_secret else stored.value
    return _cast(field, raw)


def _normalise(field: ConfigurationField, raw: Any) -> str:
    if field.kind == "boolean":
        if not isinstance(raw, bool):
            raise ValidationFailed(f"{field.label} must be on or off.")
        return "true" if raw else "false"
    text = str(raw if raw is not None else "").strip()
    if len(text) > field.max_length:
        raise ValidationFailed(f"{field.label} is too long.")
    if field.kind == "choice" and text not in {choice[0] for choice in field.choices}:
        raise ValidationFailed(f"Choose a valid value for {field.label}.")
    if field.kind == "integer":
        try:
            number = int(text)
        except (TypeError, ValueError) as exc:
            raise ValidationFailed(f"{field.label} must be a whole number.") from exc
        if field.minimum is not None and number < field.minimum:
            raise ValidationFailed(f"{field.label} must be at least {field.minimum}.")
        if field.maximum is not None and number > field.maximum:
            raise ValidationFailed(f"{field.label} must be at most {field.maximum}.")
        return str(number)
    if field.kind == "url" and text:
        try:
            URLValidator(schemes=["https"])(text)
        except ValidationError as exc:
            raise ValidationFailed(f"{field.label} must be a valid HTTPS URL.") from exc
    prefixes = {
        "PAYSTACK_SECRET_KEY": ("sk_test_", "sk_live_"),
        "PAYSTACK_TEST_SECRET_KEY": ("sk_test_",),
        "PAYSTACK_TEST_PUBLIC_KEY": ("pk_test_",),
        "PAYSTACK_LIVE_SECRET_KEY": ("sk_live_",),
        "PAYSTACK_LIVE_PUBLIC_KEY": ("pk_live_",),
    }
    expected = prefixes.get(field.key)
    if expected and text and not text.startswith(expected):
        raise ValidationFailed(f"{field.label} must start with {expected[0]}.")
    return text


def payload() -> dict:
    try:
        stored = {row.key: row for row in ConfigurationValue.objects.filter(key__in=FIELD_BY_KEY)}
    except (OperationalError, ProgrammingError):
        stored = {}
    sections: list[dict] = []
    visible_fields = tuple(field for field in FIELDS if field.exposed)
    for section_name in dict.fromkeys(field.section for field in visible_fields):
        rows = []
        for field in (item for item in visible_fields if item.section == section_name):
            override = stored.get(field.key)
            effective = value(field.key, "")
            rows.append(
                {
                    "key": field.key,
                    "label": field.label,
                    "description": field.description,
                    "kind": field.kind,
                    "secret": field.secret,
                    "value": "" if field.secret else effective,
                    "is_set": bool(effective) if field.secret else override is not None,
                    "source": "management" if override is not None else "deployment",
                    "choices": [
                        {"value": option, "label": label} for option, label in field.choices
                    ],
                }
            )
        sections.append({"name": section_name, "fields": rows})
    return {"sections": sections}


@transaction.atomic
def apply_updates(*, updates: list[dict], actor: ManagementUser) -> dict:
    seen: set[str] = set()
    for update in updates:
        key = str(update.get("key", "")).strip()
        if key in seen:
            raise ValidationFailed(f"{key or 'A key'} was included more than once.")
        seen.add(key)
        field = FIELD_BY_KEY.get(key)
        if field is None:
            raise ValidationFailed("That setting cannot be changed from Management.")
        previous = ConfigurationValue.objects.filter(key=key).first()
        if bool(update.get("clear")):
            if previous is not None:
                previous.delete()
            record(
                action=AuditAction.UPDATE,
                aggregate_type="runtime_configuration",
                aggregate_id=key,
                management_actor=actor,
                changes={"value": ["[redacted]" if field.secret else "override", "deployment"]},
            )
            continue
        if field.secret and not str(update.get("value", "")).strip():
            # Blank secret inputs mean "keep it". Clearing is always explicit.
            continue
        normalised = _normalise(field, update.get("value"))
        stored_value = _encrypt(normalised) if field.secret else normalised
        ConfigurationValue.objects.update_or_create(
            key=key,
            defaults={"value": stored_value, "is_secret": field.secret, "updated_by": actor},
        )
        record(
            action=AuditAction.UPDATE,
            aggregate_type="runtime_configuration",
            aggregate_id=key,
            management_actor=actor,
            changes={
                "value": [
                    "[redacted]" if field.secret and previous else "deployment",
                    "[redacted]" if field.secret else normalised,
                ]
            },
        )

    # Providers cache their adapter instances. Forget them after a successful
    # transaction so the very next operation observes the new selection.
    from apps.identity.providers import reset_sms_provider
    from apps.payments.providers import reset_payment_provider

    transaction.on_commit(reset_sms_provider)
    transaction.on_commit(reset_payment_provider)
    return payload()
