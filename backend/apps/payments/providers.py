"""Provider contract for payment initiation and authenticated callbacks.

No production adapter is selected in source control. A licensed PSP and its
verified payout-destination contract are commercial/security configuration,
not something the application may guess. The memory adapter exists only for
tests and exercises the same signed-webhook boundary.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime

from django.conf import settings
from django.utils.dateparse import parse_datetime

from apps.core.exceptions import PermissionDenied, ProviderUnavailable, ValidationFailed
from apps.operations.configuration import value as configuration_value


class UnhandledProviderEvent(Exception):
    """An authenticated callback about something Danpa HQ's payment flow ignores.

    Distinct from `ValidationFailed`, which means *this should have been a
    payment and was malformed*. A PSP sends events for the whole account —
    transfers, disputes, customer identification, subscriptions — and answering
    those with a 4xx makes a provider retry them, then eventually suspend the
    endpoint that Danpa HQ's actual payment confirmation depends on. They are
    acknowledged and recorded as ignored instead.
    """

    def __init__(self, event_type: str = "", event_id: str = ""):
        self.event_type = event_type
        self.event_id = event_id
        super().__init__(f"unhandled provider event: {event_type or 'unknown'}")


@dataclass(frozen=True, slots=True)
class InitiationResult:
    provider_reference: str
    status: str = "pending"
    next_action: dict = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class VerifiedProviderEvent:
    event_id: str
    event_type: str
    provider_reference: str
    provider_transaction_id: str
    status: str
    amount_minor: int
    currency: str
    payment_method: str
    occurred_at: datetime
    raw_status: str = ""


@dataclass(frozen=True, slots=True)
class ProviderPaymentState:
    """What the provider says about a payment when *we* ask, not when they tell us.

    The difference matters. A webhook is the provider volunteering news; this is
    Danpa HQ going to look. Every callback-based integration eventually meets the
    payment whose webhook never arrived — the worker was down, the network ate
    it, the provider retried three times into a 502 — and without a way to ask,
    that money is invisible until somebody complains.
    """

    found: bool
    provider_transaction_id: str = ""
    status: str = ""
    amount_minor: int = 0
    currency: str = ""
    payment_method: str = ""
    occurred_at: datetime | None = None
    raw_status: str = ""


@dataclass(frozen=True, slots=True)
class ProviderRefundResult:
    provider_refund_reference: str
    status: str
    failure_message: str = ""


@dataclass(frozen=True, slots=True)
class ProviderSettlementState:
    """What the provider says it has actually paid out, and when."""

    found: bool
    provider_settlement_reference: str = ""
    status: str = ""
    gross_minor: int = 0
    fee_minor: int = 0
    net_minor: int = 0
    currency: str = ""
    settled_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class ProviderSettlementTransaction:
    """One provider transaction included in a settlement batch."""

    provider_transaction_id: str
    provider_reference: str
    amount_minor: int
    provider_fee_minor: int
    currency: str


@dataclass(frozen=True, slots=True)
class ProviderSettlementBatch:
    """A payout batch exactly as the provider reports it."""

    provider_settlement_reference: str
    status: str
    currency: str
    settled_at: datetime | None
    transactions: tuple[ProviderSettlementTransaction, ...] = ()


@dataclass(frozen=True, slots=True)
class ProviderPayoutDestination:
    """A provider-created destination, stripped of raw account details."""

    token_reference: str
    provider_account_id: str
    masked_account: str
    account_name: str
    institution: str
    verified: bool


@dataclass(frozen=True, slots=True)
class ProviderPayoutInstitution:
    code: str
    name: str
    method: str


@dataclass(frozen=True, slots=True)
class ProviderResolvedPayoutAccount:
    account_name: str
    masked_account: str


class PaymentProvider(ABC):
    """The whole of what Danpa HQ asks a payment provider to do.

    Five operations, and vendor vocabulary stops here. A provider's own statuses,
    payload shapes and identifiers are translated into the types above before
    anything in `services` sees them, which is what keeps the rent domain free
    of any particular PSP.

    `initiate` and `verify_webhook` are required. The other three raise
    `ProviderUnavailable` by default rather than being abstract: a sandbox or a
    partially-integrated provider should be usable for the flows it does
    support, and an honest refusal is better than an adapter that cannot be
    written until every operation exists.
    """

    name = "abstract"
    uses_subaccounts = False
    settlement_mode = "transaction"

    @abstractmethod
    def initiate(self, *, intent) -> InitiationResult: ...

    @abstractmethod
    def verify_webhook(self, *, raw_body: bytes, headers) -> VerifiedProviderEvent: ...

    def ensure_available(self) -> None:
        """Fail before a financial row is written when this rail cannot run."""

        return None

    def query_payment(self, *, provider_reference: str) -> ProviderPaymentState:
        """Ask the provider what became of a payment we started."""
        del provider_reference
        raise ProviderUnavailable("This payment provider cannot be queried directly.")

    def refund_payment(
        self, *, provider_transaction_id: str, amount_minor: int, currency: str, reason: str
    ) -> ProviderRefundResult:
        del provider_transaction_id, amount_minor, currency, reason
        raise ProviderUnavailable("This payment provider does not support refunds.")

    def query_settlement(self, *, provider_transaction_id: str) -> ProviderSettlementState:
        """Ask whether the beneficiary has actually been paid."""
        del provider_transaction_id
        raise ProviderUnavailable("This payment provider does not report settlement.")

    def list_settlement_batches(
        self, *, since: datetime, provider_account_id: str
    ) -> tuple[ProviderSettlementBatch, ...]:
        """List complete payout batches for one provider-owned destination."""
        del since, provider_account_id
        raise ProviderUnavailable("This payment provider does not report settlement batches.")

    def provision_payout_destination(
        self,
        *,
        business_name: str,
        bank_code: str,
        account_number: str,
        provisioning_reference: str = "",
    ) -> ProviderPayoutDestination:
        """Create a provider-side payout destination from transient bank details."""
        del business_name, bank_code, account_number, provisioning_reference
        raise ProviderUnavailable("This payment provider cannot provision payout destinations.")

    def find_payout_destination(
        self, *, provisioning_reference: str
    ) -> ProviderPayoutDestination | None:
        """Find a prior create by Danpa HQ's provider-metadata reference.

        This is recovery, not ordinary lookup. Providers without a searchable
        creation reference must refuse so callers never turn an ambiguous create
        into a blind retry.
        """
        del provisioning_reference
        raise ProviderUnavailable("This payment provider cannot reconcile payout setup.")

    def get_payout_destination(self, *, provider_reference: str) -> ProviderPayoutDestination:
        """Fetch the provider's current state for an already-created destination."""
        del provider_reference
        raise ProviderUnavailable("This payment provider cannot refresh payout verification.")

    def list_payout_institutions(self, *, method: str) -> tuple[ProviderPayoutInstitution, ...]:
        del method
        raise ProviderUnavailable("This payment provider cannot list payout institutions.")

    def resolve_payout_account(
        self, *, method: str, bank_code: str, account_number: str
    ) -> ProviderResolvedPayoutAccount:
        del method, bank_code, account_number
        raise ProviderUnavailable("This payment provider cannot confirm payout accounts.")


class UnconfiguredPaymentProvider(PaymentProvider):
    name = "unconfigured"

    def ensure_available(self) -> None:
        raise ProviderUnavailable(
            "Digital payments are not enabled yet. No money was requested or moved."
        )

    def initiate(self, *, intent) -> InitiationResult:
        del intent
        raise ProviderUnavailable(
            "Digital payments are not enabled yet. No money was requested or moved."
        )

    def verify_webhook(self, *, raw_body: bytes, headers) -> VerifiedProviderEvent:
        del raw_body, headers
        raise PermissionDenied("That payment provider is not configured.")


class MemoryPaymentProvider(PaymentProvider):
    """Signed deterministic adapter for tests; never a production payment rail."""

    name = "memory"

    def _secret(self) -> bytes:
        secret = str(getattr(settings, "PAYMENT_TEST_WEBHOOK_SECRET", ""))
        if not secret:
            raise ProviderUnavailable("The test payment provider is not configured.")
        return secret.encode()

    def ensure_available(self) -> None:
        self._secret()

    def initiate(self, *, intent) -> InitiationResult:
        return InitiationResult(
            provider_reference=intent.client_reference,
            next_action={"type": "test_only", "reference": intent.client_reference},
        )

    def verify_webhook(self, *, raw_body: bytes, headers) -> VerifiedProviderEvent:
        supplied = str(headers.get("X-Payment-Signature", ""))
        expected = hmac.new(self._secret(), raw_body, hashlib.sha256).hexdigest()
        if not supplied or not hmac.compare_digest(supplied, expected):
            raise PermissionDenied("The payment callback signature is invalid.")
        try:
            payload = json.loads(raw_body)
            occurred_at = parse_datetime(str(payload["occurred_at"]))
            if occurred_at is None:
                raise ValueError("invalid occurred_at")
            return VerifiedProviderEvent(
                event_id=str(payload["event_id"]),
                event_type=str(payload["event_type"]),
                provider_reference=str(payload["provider_reference"]),
                provider_transaction_id=str(payload["provider_transaction_id"]),
                status=str(payload["status"]),
                amount_minor=int(payload["amount_minor"]),
                currency=str(payload["currency"]).upper(),
                payment_method=str(payload["payment_method"]),
                occurred_at=occurred_at,
                raw_status=str(payload.get("raw_status", payload["status"])),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValidationFailed("The payment callback payload is invalid.") from exc

    # The three below are deterministic and driven by whatever a test has put
    # in `PAYMENT_TEST_STATE`. They exist so the reconciliation and settlement
    # paths can be exercised end to end against the same contract a real
    # provider will implement — the point of a sandbox adapter is that the code
    # above it never learns it was talking to a fake.

    def _state(self) -> dict:
        return dict(getattr(settings, "PAYMENT_TEST_STATE", {}) or {})

    def query_payment(self, *, provider_reference: str) -> ProviderPaymentState:
        """ "Cannot answer" and "says no" are different, and must stay different.

        A sandbox with no payment state configured has no opinion, and saying
        `found=False` would let it deny a payment it was never told about — a
        serious claim about somebody's money. It refuses instead, which callers
        already handle as "ask again later".
        """
        state = self._state()
        if "payments" not in state:
            raise ProviderUnavailable("The sandbox has no payment state configured.")
        row = state["payments"].get(provider_reference)
        if row is None:
            return ProviderPaymentState(found=False)
        occurred_at = row.get("occurred_at")
        return ProviderPaymentState(
            found=True,
            provider_transaction_id=str(row.get("provider_transaction_id", "")),
            status=str(row.get("status", "")),
            amount_minor=int(row.get("amount_minor", 0)),
            currency=str(row.get("currency", "GHS")).upper(),
            payment_method=str(row.get("payment_method", "")),
            occurred_at=(
                parse_datetime(occurred_at) if isinstance(occurred_at, str) else occurred_at
            ),
            raw_status=str(row.get("raw_status", row.get("status", ""))),
        )

    def refund_payment(
        self, *, provider_transaction_id: str, amount_minor: int, currency: str, reason: str
    ) -> ProviderRefundResult:
        del reason
        row = self._state().get("refunds", {}).get(provider_transaction_id)
        if row is None:
            return ProviderRefundResult(
                provider_refund_reference="",
                status="failed",
                failure_message="The sandbox has no refund configured for that transaction.",
            )
        return ProviderRefundResult(
            provider_refund_reference=str(row.get("reference", f"rf_{provider_transaction_id}")),
            status=str(row.get("status", "completed")),
            failure_message=str(row.get("failure_message", "")),
        )

    def query_settlement(self, *, provider_transaction_id: str) -> ProviderSettlementState:
        row = self._state().get("settlements", {}).get(provider_transaction_id)
        if row is None:
            return ProviderSettlementState(found=False)
        settled_at = row.get("settled_at")
        return ProviderSettlementState(
            found=True,
            provider_settlement_reference=str(row.get("reference", "")),
            status=str(row.get("status", "settled")),
            gross_minor=int(row.get("gross_minor", 0)),
            fee_minor=int(row.get("fee_minor", 0)),
            net_minor=int(row.get("net_minor", 0)),
            currency=str(row.get("currency", "GHS")).upper(),
            settled_at=parse_datetime(settled_at) if isinstance(settled_at, str) else settled_at,
        )


def _paystack():
    # Imported lazily: the adapter pulls in `requests`, and the registry is read
    # at import time by modules that may never make an outbound call.
    from .paystack import PaystackPaymentProvider

    return PaystackPaymentProvider


_PROVIDERS = {"memory": MemoryPaymentProvider, "paystack": _paystack}
_instance: PaymentProvider | None = None


def get_payment_provider(name: str | None = None) -> PaymentProvider:
    global _instance
    configured = str(configuration_value("PAYMENT_BACKEND", "")).strip().lower()
    if not configured:
        return UnconfiguredPaymentProvider()
    if name is not None and str(name).strip().lower() != configured:
        raise PermissionDenied("That payment provider is not configured.")
    if configured not in _PROVIDERS:
        raise ProviderUnavailable("The configured payment provider is unavailable.")
    if _instance is None or _instance.name != configured:
        factory = _PROVIDERS[configured]
        # Entries are either a class or a callable returning one, so an adapter
        # with heavier imports can stay out of the module graph until used.
        _instance = factory()() if not isinstance(factory, type) else factory()
    return _instance


def reset_payment_provider() -> None:
    global _instance
    _instance = None
