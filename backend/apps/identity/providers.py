"""SMS provider abstraction.

Per ADR 0009, business logic depends on a capability, never on a vendor. The
console and memory adapters remain for development and tests; Arkesel is the
first production adapter and is disabled until Management supplies its key,
approved sender ID, and selects it explicitly.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from apps.operations.configuration import value as configuration_value

logger = logging.getLogger("sms")


@dataclass(frozen=True, slots=True)
class SmsResult:
    accepted: bool
    provider: str
    reference: str = ""
    error: str = ""


@dataclass
class SentMessage:
    to: str
    body: str
    reference: str


class SmsProvider(ABC):
    """Every adapter maps its own errors onto this one contract."""

    name = "abstract"

    @abstractmethod
    def send(self, *, to: str, body: str, reference: str = "") -> SmsResult: ...


class ConsoleSmsProvider(SmsProvider):
    """Development: prints the message so an engineer can read the code."""

    name = "console"

    def send(self, *, to: str, body: str, reference: str = "") -> SmsResult:
        from apps.core.phone import mask

        print(f"\n--- SMS to {to} ---\n{body}\n---\n")  # noqa: T201 — the dev backend *is* the console
        logger.info("sms sent", extra={"event": "sms_send", "provider": self.name})
        del mask
        return SmsResult(accepted=True, provider=self.name, reference=reference or "console")


class MemorySmsProvider(SmsProvider):
    """Tests: keeps messages so assertions can read them."""

    name = "memory"
    outbox: list[SentMessage] = field(default_factory=list)

    def __init__(self) -> None:
        self.outbox = []

    def send(self, *, to: str, body: str, reference: str = "") -> SmsResult:
        self.outbox.append(SentMessage(to=to, body=body, reference=reference))
        return SmsResult(accepted=True, provider=self.name, reference=reference or "memory")


class NullSmsProvider(SmsProvider):
    """Accepts and discards. For load tests and previews."""

    name = "null"

    def send(self, *, to: str, body: str, reference: str = "") -> SmsResult:
        return SmsResult(accepted=True, provider=self.name, reference=reference)


class ArkeselSmsProvider(SmsProvider):
    """Arkesel SMS v2 using the server-generated OTP as ordinary SMS content."""

    name = "arkesel"
    endpoint = "https://sms.arkesel.com/api/v2/sms/send"

    def send(self, *, to: str, body: str, reference: str = "") -> SmsResult:
        api_key = str(configuration_value("ARKESEL_API_KEY", "")).strip()
        sender = str(configuration_value("ARKESEL_SENDER_ID", "")).strip()
        if not api_key or not sender:
            return SmsResult(
                accepted=False,
                provider=self.name,
                error="Arkesel is missing its API key or sender ID.",
            )
        try:
            response = requests.post(
                self.endpoint,
                headers={"api-key": api_key, "Content-Type": "application/json"},
                json={
                    "sender": sender,
                    "message": body,
                    "recipients": [to.lstrip("+")],
                    "sandbox": bool(configuration_value("ARKESEL_SANDBOX", False)),
                },
                timeout=float(getattr(settings, "SMS_TIMEOUT_SECONDS", 10)),
            )
        except requests.RequestException:
            logger.exception("sms provider request failed", extra={"provider": self.name})
            return SmsResult(
                accepted=False, provider=self.name, error="The SMS provider could not be reached."
            )
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if not response.ok or payload.get("status") != "success":
            logger.warning(
                "sms provider rejected message",
                extra={"provider": self.name, "status_code": response.status_code},
            )
            return SmsResult(
                accepted=False, provider=self.name, error="The SMS provider refused the message."
            )
        rows = payload.get("data") if isinstance(payload.get("data"), list) else []
        provider_reference = next(
            (str(row.get("id")) for row in rows if isinstance(row, dict) and row.get("id")),
            reference,
        )
        return SmsResult(accepted=True, provider=self.name, reference=provider_reference)


_PROVIDERS: dict[str, type[SmsProvider]] = {
    "console": ConsoleSmsProvider,
    "memory": MemorySmsProvider,
    "null": NullSmsProvider,
    "arkesel": ArkeselSmsProvider,
}

_instance: SmsProvider | None = None


def get_sms_provider() -> SmsProvider:
    """The configured adapter, or a refusal to start.

    This used to fall back to `ConsoleSmsProvider` for any name it did not
    recognise. That is the worst possible default: production requires
    `SMS_BACKEND` to be set, so the natural mistake is to set it to the vendor
    somebody *intends* to integrate — `hubtel`, `arkesel` — and the fallback
    would then quietly print every one-time code into the production log
    instead of sending it. An unknown name is a deployment error, and it stops
    the process the same way an unknown `STORAGE_BACKEND` does.
    """
    global _instance
    if _instance is None:
        backend = str(configuration_value("SMS_BACKEND", "console")).strip().lower()
        provider = _PROVIDERS.get(backend)
        if provider is None:
            raise ImproperlyConfigured(
                f"Unknown SMS_BACKEND {backend!r}. Choose one of: {', '.join(_PROVIDERS)}. "
                "See docs/deployment/PRODUCTION_DEPLOYMENT.md."
            )
        _instance = provider()
    return _instance


def reset_sms_provider() -> None:
    """Test helper: forget the cached instance."""
    global _instance
    _instance = None
