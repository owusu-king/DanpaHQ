"""SMS provider abstraction.

Per ADR 0009, business logic depends on a capability, never on a vendor. Phase 1
ships the interface, a console adapter for development, an in-memory adapter for
tests, and a stub that records what *would* have been sent.

No real gateway is integrated. Ghanaian delivery goes through providers like
Hubtel, Arkesel, or an operator's own bulk-SMS API, and each has its own sender
ID registration, delivery-report format and failure taxonomy. Choosing one is a
commercial decision that also needs measured delivery rates per network - none of
which exists yet, so no adapter here pretends otherwise.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

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


_PROVIDERS: dict[str, type[SmsProvider]] = {
    "console": ConsoleSmsProvider,
    "memory": MemorySmsProvider,
    "null": NullSmsProvider,
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
        backend = getattr(settings, "SMS_BACKEND", "console")
        provider = _PROVIDERS.get(backend)
        if provider is None:
            raise ImproperlyConfigured(
                f"Unknown SMS_BACKEND {backend!r}. Choose one of: {', '.join(_PROVIDERS)}. "
                "No production SMS adapter is integrated yet; see "
                "docs/deployment/PRODUCTION_DEPLOYMENT.md."
            )
        _instance = provider()
    return _instance


def reset_sms_provider() -> None:
    """Test helper: forget the cached instance."""
    global _instance
    _instance = None
