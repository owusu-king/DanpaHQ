"""The Paystack adapter.

Paystack is licensed in Ghana, settles in GHS, and supports the three channels
this product needs — mobile money, card and bank. This module translates it into
the five operations `providers.PaymentProvider` defines, and **nothing Paystack
says about a payment escapes past this file**: statuses, channel names, payload
shapes and identifiers are all mapped here so that `services` and
`reconciliation` never learn which vendor is on the other end.

Two decisions in here are security decisions rather than integration ones.

**Danpa HQ never sees a PIN, an OTP or a card number.** Every method goes through
`transaction/initialize`, which hands the payer to Paystack's own checkout. That
is not the shortest integration — the Charge API can drive mobile money
step-by-step from our own screens — but it is the one where a credential never
touches Danpa HQ's infrastructure, and that is worth more than a screen.

**A live secret key does nothing unless somebody has said so out loud.** The
adapter selects the live credential only when `PAYSTACK_ALLOW_LIVE` is explicitly
true. Going live is a decision, not a configuration accident.

Verified against Paystack's published integration guidance in August 2026.
Anything not confirmed there is marked below rather than assumed.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re

import requests
from django.conf import settings
from django.utils.dateparse import parse_datetime

from apps.core.exceptions import PermissionDenied, ProviderUnavailable, ValidationFailed
from apps.operations.configuration import value as configuration_value

from .providers import (
    InitiationResult,
    PaymentProvider,
    ProviderPaymentState,
    ProviderPayoutDestination,
    ProviderPayoutInstitution,
    ProviderRefundResult,
    ProviderResolvedPayoutAccount,
    ProviderSettlementBatch,
    ProviderSettlementState,
    ProviderSettlementTransaction,
    UnhandledProviderEvent,
    VerifiedProviderEvent,
)

logger = logging.getLogger("payments.paystack")

API_ROOT = "https://api.paystack.co"

#: Outbound calls happen inside request and worker paths. A provider having a
#: bad afternoon must not become Danpa HQ having one.
TIMEOUT_SECONDS = 20

#: Paystack's channel names, in our vocabulary. `ussd` and `bank_transfer` are
#: both bank rails from a tenant's point of view.
CHANNEL_TO_METHOD = {
    "mobile_money": "mobile_money",
    "card": "card",
    "bank": "bank_transfer",
    "bank_transfer": "bank_transfer",
    "ussd": "bank_transfer",
}

METHOD_TO_CHANNELS = {
    "mobile_money": ["mobile_money"],
    "card": ["card"],
    "bank_transfer": ["bank", "bank_transfer", "ussd"],
}

#: Paystack's transaction statuses, in ours. Anything unlisted is deliberately
#: left unmapped so it reaches reconciliation instead of being guessed at.
#:
#: `abandoned` is not a failure. It is what Paystack reports for a transaction
#: that was opened and not completed — including one the payer is completing
#: in the checkout window right now. Read as `failed`, the status check that
#: runs as checkout opens failed every payment before anybody could make it,
#: and the money that arrived seconds later had nothing left to settle. It
#: stays payable until Danpa HQ's own intent window closes, which is what ends
#: an unpaid checkout (`services.expire_due_intents`).
STATUS_MAP = {
    "success": "succeeded",
    "failed": "failed",
    "abandoned": "pending",
    "reversed": "reversed",
    "pending": "pending",
    "ongoing": "processing",
    "processing": "processing",
    "queued": "processing",
    "send_otp": "processing",
    "send_pin": "processing",
    "open": "pending",
}

#: The only Paystack events that describe the outcome of a Danpa HQ rent payment.
#: Everything else on the account — transfers, disputes, customer identification,
#: subscriptions — is acknowledged and recorded as ignored rather than refused,
#: because a provider retries a 4xx and eventually disables the endpoint.
#:
#: `charge.failed` is here even though Paystack's documentation does not promise
#: it for hosted checkout (`PAYSTACK_INTEGRATION.md` assumption 2). Handling an
#: event that never arrives costs nothing; ignoring one that does costs the
#: tenant the wait until their intent expires, on a payment the provider has
#: already declined — and the domain has a complete failure path that would
#: simply not be reached. `charge.dispute.*` is deliberately absent: those carry
#: a different payload shape and are not a transaction outcome.
HANDLED_EVENTS = frozenset({"charge.success", "charge.failed"})

SETTLEMENT_STATUS_MAP = {
    "success": "settled",
    "processing": "processing",
    "pending": "pending",
    "failed": "failed",
}


class PaystackPaymentProvider(PaymentProvider):
    name = "paystack"
    uses_subaccounts = True
    settlement_mode = "batch"

    def ensure_available(self) -> None:
        self._secret_key()

    # --- configuration -------------------------------------------------------

    def _secret_key(self) -> str:
        """Select the test or live server key, with a legacy fallback.

        Older deployments used one ``PAYSTACK_SECRET_KEY`` value. It remains a
        fallback only when its prefix matches the explicitly selected mode.
        """
        live = bool(configuration_value("PAYSTACK_ALLOW_LIVE", False))
        selected_key = "PAYSTACK_LIVE_SECRET_KEY" if live else "PAYSTACK_TEST_SECRET_KEY"
        expected_prefix = "sk_live_" if live else "sk_test_"
        key = str(configuration_value(selected_key, "")).strip()
        if not key:
            legacy_key = str(configuration_value("PAYSTACK_SECRET_KEY", "")).strip()
            if legacy_key.startswith("sk_live_") and not live:
                raise ProviderUnavailable(
                    "A live Paystack key is present but live mode has not been enabled. "
                    "No money was requested or moved."
                )
            if legacy_key.startswith(expected_prefix):
                key = legacy_key
        if not key:
            mode = "live" if live else "test"
            raise ProviderUnavailable(
                f"Paystack {mode} mode is selected but its secret key is not configured."
            )
        if not key.startswith(expected_prefix):
            raise ProviderUnavailable("The selected Paystack secret key does not match its mode.")
        return key

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._secret_key()}",
            "Content-Type": "application/json",
        }

    def _call(
        self,
        method: str,
        path: str,
        *,
        payload: dict | None = None,
        params: dict | None = None,
    ) -> dict:
        """One outbound call, with the failure modes named.

        Never logs the body of a request or a response: both carry customer
        detail, and a response carries authorization data. What is logged is the
        path and the status, which is what an operator actually needs.
        """
        url = f"{API_ROOT}{path}"
        try:
            response = requests.request(
                method,
                url,
                headers=self._headers(),
                json=payload,
                params=params,
                timeout=TIMEOUT_SECONDS,
            )
        except requests.Timeout as exc:
            # Deliberately distinct from a refusal. A timeout means Paystack may
            # well have accepted the request, so the caller must treat the
            # payment as possibly in flight rather than as failed.
            raise ProviderUnavailable(
                "The payment provider did not respond in time. "
                "If money was taken it will be confirmed shortly."
            ) from exc
        except requests.RequestException as exc:
            raise ProviderUnavailable("The payment provider could not be reached.") from exc

        if response.status_code >= 500:
            logger.warning(
                "paystack server error",
                extra={"event": "paystack_5xx", "path": path, "status": response.status_code},
            )
            raise ProviderUnavailable("The payment provider is unavailable.")
        if response.status_code in (401, 403):
            raise ProviderUnavailable("Danpa HQ's payment provider credentials were refused.")

        try:
            body = response.json()
        except ValueError as exc:
            raise ProviderUnavailable(
                "The payment provider returned an unreadable response."
            ) from exc

        if not isinstance(body, dict):
            raise ProviderUnavailable("The payment provider returned an unreadable response.")
        return body

    # --- the five operations -------------------------------------------------

    def initiate(self, *, intent) -> InitiationResult:
        """Open a hosted checkout for one intent, or hand back the one already open.

        `reference` is our own `client_reference`, the outbound idempotency key.
        Paystack refuses a second initialize for a reference it already holds
        ("Duplicate Transaction Reference") rather than returning the same
        transaction, so an intent that already has a hosted checkout gets that
        checkout back — the same reference, page and access code — and nothing
        is sent. That is the property `retry_intent` depends on: a retry lands on
        the same provider transaction, and nothing can be charged twice.

        `channels` is restricted to the method the tenant chose. Without it, a
        payer offered every channel could pay by card against an intent that
        says mobile money, and the confirmation would then fail its own
        method check on a payment that really happened.
        """
        if intent is None:
            # The pre-flight probe `services.create_intent` uses to refuse a
            # checkout that cannot work, before any row is written.
            self._secret_key()
            return InitiationResult(provider_reference="", status="pending")

        held = str(getattr(intent, "provider_reference", "") or "")
        opened = dict(getattr(intent, "next_action", None) or {})
        if held and opened.get("url"):
            return InitiationResult(provider_reference=held, status="pending", next_action=opened)

        if intent.amount_currency != "GHS":
            raise ValidationFailed("Paystack settlement for Danpa HQ is configured for GHS only.")

        subscription = _is_subscription(intent)
        payload = {
            "email": _payer_email(intent),
            # Already in pesewas. Danpa HQ's `amount_minor` and Paystack's
            # subunit are the same number, which is why nothing converts here —
            # and why nothing should start.
            "amount": int(intent.amount_minor),
            "currency": intent.amount_currency,
            "reference": intent.client_reference,
            "channels": METHOD_TO_CHANNELS.get(intent.payment_method, []),
            "metadata": (
                {
                    "danpahq_intent_id": str(intent.id),
                    "danpahq_purpose": "subscription_invoice",
                    "danpahq_billing_invoice_id": str(intent.billing_invoice_id),
                }
                if subscription
                else {
                    "danpahq_intent_id": str(intent.id),
                    "danpahq_obligation_id": str(intent.obligation_id),
                    "danpahq_lease_id": str(intent.lease_id),
                }
            ),
        }
        if not subscription:
            # Rent settles to the receiving Portfolio's subaccount. A Danpa HQ
            # subscription does not: Danpa HQ is the merchant, so the whole
            # amount stays in the platform account with no split, no subaccount
            # and no transaction charge.
            subaccount = str(getattr(intent, "provider_subaccount_reference", "") or "").strip()
            bearer = str(getattr(intent, "provider_fee_bearer", "") or "").strip()
            if not subaccount:
                raise ValidationFailed("This payment has no verified provider settlement account.")
            if bearer not in {"account", "subaccount"}:
                raise ValidationFailed("This payment has no configured transaction-fee policy.")
            payload.update(
                {
                    "subaccount": subaccount,
                    # An explicit flat amount freezes the commercial split for
                    # this intent even if the subaccount default changes later.
                    "transaction_charge": int(intent.platform_charge_minor),
                    "bearer": bearer,
                }
            )
        callback = str(configuration_value("PAYSTACK_CALLBACK_URL", "")).strip()
        if callback:
            payload["callback_url"] = callback

        body = self._call("POST", "/transaction/initialize", payload=payload)
        if not body.get("status"):
            raise ValidationFailed(
                str(body.get("message") or "The payment provider refused this payment.")
            )
        data = body.get("data") or {}
        reference = str(data.get("reference") or intent.client_reference)
        authorization_url = str(data.get("authorization_url") or "")
        if not authorization_url:
            raise ProviderUnavailable("The payment provider did not return a checkout.")
        access_code = str(data.get("access_code") or "").strip()

        return InitiationResult(
            provider_reference=reference,
            status="pending",
            # Keep the hosted URL for mobile and resilience, while web uses the
            # access code with Paystack Popup so the tenant remains on Danpa HQ.
            # It is intentionally the short-lived transaction access code, not
            # an authorization code and never a Paystack secret key.
            next_action={
                "type": "redirect",
                "url": authorization_url,
                **({"access_code": access_code} if access_code else {}),
            },
        )

    def verify_webhook(self, *, raw_body: bytes, headers) -> VerifiedProviderEvent:
        """Authenticate a callback.

        HMAC-SHA512, hex, over the exact raw body, keyed with the secret key —
        note SHA-512, not the SHA-256 most providers use. Compared in constant
        time, and against the bytes as received: re-serialising the JSON first
        would change the signature and is the commonest way this check is got
        wrong.
        """
        supplied = str(
            headers.get("X-Paystack-Signature") or headers.get("x-paystack-signature") or ""
        )
        expected = hmac.new(self._secret_key().encode(), raw_body, hashlib.sha512).hexdigest()
        if not supplied or not hmac.compare_digest(supplied, expected):
            raise PermissionDenied("The payment callback signature is invalid.")

        try:
            payload = json.loads(raw_body)
            event_type = str(payload["event"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValidationFailed("The payment callback payload is invalid.") from exc

        if event_type not in HANDLED_EVENTS:
            raise UnhandledProviderEvent(event_type=event_type)

        try:
            data = payload["data"]
            provider_transaction_id = str(data["id"])
            raw_status = str(data.get("status") or "")
            channel = str(data.get("channel") or "")
            occurred_at = parse_datetime(
                str(data.get("paid_at") or data.get("paidAt") or data.get("created_at") or "")
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValidationFailed("The payment callback payload is invalid.") from exc

        status = STATUS_MAP.get(raw_status.lower())
        if status is None:
            # An unmapped status is not guessed at. Refusing sends it to
            # reconciliation, which is where an unfamiliar financial state
            # belongs.
            raise ValidationFailed(
                f"Paystack reported a state Danpa HQ does not map: {raw_status[:40]}"
            )
        method = CHANNEL_TO_METHOD.get(channel.lower())
        if method is None:
            raise ValidationFailed(f"Paystack reported an unknown channel: {channel[:40]}")
        if status == "succeeded" and occurred_at is None:
            # A confirmed payment without a time is not a confirmed payment: the
            # receipt, the ledger line and the allocation all date from it. An
            # unparseable timestamp used to arrive here as `None` and fail much
            # later with an AttributeError, which reached Paystack as a 500 and
            # was retried forever. Refuse it here, where it is recorded and
            # rejected like any other malformed callback.
            raise ValidationFailed("Paystack confirmed a payment without a usable completion time.")

        return VerifiedProviderEvent(
            # Paystack does not send a distinct event id, so one is composed
            # from the event and the transaction. `ProviderWebhook` is unique on
            # (provider, event_id), which is what makes a redelivery a no-op.
            event_id=f"{event_type}:{provider_transaction_id}",
            event_type=event_type,
            provider_reference=str(data.get("reference") or ""),
            provider_transaction_id=provider_transaction_id,
            status=status,
            amount_minor=int(data.get("amount") or 0),
            currency=str(data.get("currency") or "").upper(),
            payment_method=method,
            occurred_at=occurred_at,
            raw_status=raw_status,
        )

    def query_payment(self, *, provider_reference: str) -> ProviderPaymentState:
        """Ask Paystack what became of a payment, rather than waiting to be told.

        Paystack's own guidance is to verify through this endpoint before
        granting value, and it is also the only way to find a payment whose
        webhook was lost. `services.process_webhook` calls it as a cross-check;
        `reconciliation` calls it to find money nobody told us about.
        """
        if not provider_reference:
            return ProviderPaymentState(found=False)

        body = self._call("GET", f"/transaction/verify/{provider_reference}")
        if not body.get("status"):
            return ProviderPaymentState(found=False)
        data = body.get("data") or {}
        raw_status = str(data.get("status") or "")
        return ProviderPaymentState(
            found=True,
            provider_transaction_id=str(data.get("id") or ""),
            status=STATUS_MAP.get(raw_status.lower(), ""),
            amount_minor=int(data.get("amount") or 0),
            currency=str(data.get("currency") or "").upper(),
            payment_method=CHANNEL_TO_METHOD.get(str(data.get("channel") or "").lower(), ""),
            occurred_at=parse_datetime(str(data.get("paid_at") or "")),
            raw_status=raw_status,
        )

    def refund_payment(
        self, *, provider_transaction_id: str, amount_minor: int, currency: str, reason: str
    ) -> ProviderRefundResult:
        payload = {
            "transaction": provider_transaction_id,
            "amount": int(amount_minor),
            "merchant_note": reason[:200],
        }
        body = self._call("POST", "/refund", payload=payload)
        if not body.get("status"):
            return ProviderRefundResult(
                provider_refund_reference="",
                status="failed",
                failure_message=str(body.get("message") or "The refund was refused."),
            )
        data = body.get("data") or {}
        return ProviderRefundResult(
            provider_refund_reference=str(data.get("id") or ""),
            status=str(data.get("status") or "processing"),
        )

    def query_settlement(self, *, provider_transaction_id: str) -> ProviderSettlementState:
        """Not supported, and deliberately not faked.

        Paystack settles in **batches**: the API lists settlements and then the
        transactions that made up each one. There is no "what happened to this
        one transaction's payout" lookup, and building one out of the batch
        endpoints would mean listing every settlement and searching it, once per
        pending row — the wrong shape and a lot of calls to discover it.

        The honest answer is that the provider contract needs a batch operation
        (`list_settlements(since)`), and that reconciliation should import
        settlements rather than interrogate them one at a time. Until that
        exists this raises, `reconciliation.sweep_settlements` logs and skips,
        and settlements stay `pending` — which is true, and is the safe thing
        for them to say.
        """
        del provider_transaction_id
        raise ProviderUnavailable(
            "Paystack reports settlements in batches; per-transaction settlement "
            "lookup is not available."
        )

    def provision_payout_destination(
        self,
        *,
        business_name: str,
        bank_code: str,
        account_number: str,
        provisioning_reference: str = "",
    ) -> ProviderPayoutDestination:
        """Create a Paystack subaccount without retaining the raw bank number."""
        metadata = None
        if provisioning_reference:
            metadata = json.dumps(
                {
                    "danpahq_provisioning_reference": provisioning_reference,
                    "custom_fields": [
                        {
                            "display_name": "Danpa HQ provisioning reference",
                            "variable_name": "danpahq_provisioning_reference",
                            "value": provisioning_reference,
                        }
                    ],
                },
                separators=(",", ":"),
            )
        payload = {
            "business_name": business_name,
            # Paystack's bank-resolution endpoint calls this `bank_code`, but
            # the create-subaccount contract deliberately names the same value
            # `settlement_bank`.
            "settlement_bank": bank_code,
            "account_number": account_number,
            # Every Danpa HQ transaction supplies `transaction_charge`, so
            # the subaccount default is deliberately neutral.
            "percentage_charge": 0,
            "description": "Danpa HQ provider rent settlement",
        }
        if metadata is not None:
            payload["metadata"] = metadata
        body = self._call(
            "POST",
            "/subaccount",
            payload=payload,
        )
        if not body.get("status"):
            raise ValidationFailed(
                str(body.get("message") or "Paystack could not create that settlement account.")
            )
        return _payout_destination(
            body.get("data") or {},
            fallback_account=account_number,
            fallback_name=business_name,
        )

    def find_payout_destination(
        self, *, provisioning_reference: str
    ) -> ProviderPayoutDestination | None:
        """Recover a create whose response was lost, without creating twice."""
        if not provisioning_reference:
            raise ValidationFailed("A payout provisioning reference is required.")
        for row in self._paginate("/subaccount", params={"perPage": 50}):
            if _metadata_reference(row.get("metadata")) != provisioning_reference:
                continue
            id_or_code = str(row.get("subaccount_code") or row.get("id") or "")
            if not id_or_code:
                raise ProviderUnavailable(
                    "Paystack found the payout destination without a usable reference."
                )
            body = self._call("GET", f"/subaccount/{id_or_code}")
            if not body.get("status"):
                raise ProviderUnavailable("Paystack could not return the payout destination.")
            return _payout_destination(body.get("data") or {})
        return None

    def get_payout_destination(self, *, provider_reference: str) -> ProviderPayoutDestination:
        """Fetch Paystack's current verification state for one subaccount."""
        provider_reference = str(provider_reference or "").strip()
        if not re.fullmatch(r"ACCT_[A-Za-z0-9]+", provider_reference):
            raise ValidationFailed("That Paystack subaccount reference is invalid.")
        body = self._call("GET", f"/subaccount/{provider_reference}")
        if not body.get("status"):
            raise ProviderUnavailable("Paystack could not return the settlement account.")
        return _payout_destination(body.get("data") or {})

    def list_payout_institutions(self, *, method: str) -> tuple[ProviderPayoutInstitution, ...]:
        channel_type = {"bank": "ghipss", "mobile_money": "mobile_money"}.get(method)
        if channel_type is None:
            raise ValidationFailed("Choose Mobile Money or a bank account.")
        body = self._call(
            "GET",
            "/bank",
            params={
                "country": "ghana",
                "currency": "GHS",
                "type": channel_type,
                "perPage": 100,
            },
        )
        if not body.get("status"):
            raise ProviderUnavailable("Paystack could not return Ghana payout institutions.")
        rows = body.get("data") or []
        if not isinstance(rows, list):
            raise ProviderUnavailable("Paystack returned unreadable payout institutions.")
        institutions = {
            str(row.get("code") or ""): ProviderPayoutInstitution(
                code=str(row.get("code") or ""),
                name=str(row.get("name") or "")[:120],
                method=method,
            )
            for row in rows
            if isinstance(row, dict)
            and str(row.get("code") or "")
            and str(row.get("name") or "")
            and row.get("active", True) is not False
        }
        return tuple(sorted(institutions.values(), key=lambda item: item.name.casefold()))

    def resolve_payout_account(
        self, *, method: str, bank_code: str, account_number: str
    ) -> ProviderResolvedPayoutAccount:
        if method != "bank":
            raise ValidationFailed(
                "Account-name confirmation is currently available for bank accounts only."
            )
        body = self._call(
            "GET",
            "/bank/resolve",
            params={"account_number": account_number, "bank_code": bank_code},
        )
        if not body.get("status"):
            raise ValidationFailed(
                "Paystack could not confirm that account. Check the bank and account number."
            )
        data = body.get("data") or {}
        account_name = str(data.get("account_name") or "").strip()
        if not account_name:
            raise ProviderUnavailable("Paystack confirmed the account without returning its name.")
        return ProviderResolvedPayoutAccount(
            account_name=account_name[:160],
            masked_account=_mask_account(str(data.get("account_number") or account_number)),
        )

    def list_settlement_batches(
        self, *, since, provider_account_id: str
    ) -> tuple[ProviderSettlementBatch, ...]:
        """Import Paystack's batch-shaped settlement report, fully paginated."""
        if not provider_account_id:
            raise ValidationFailed("The payout destination has no Paystack subaccount id.")

        batches: list[ProviderSettlementBatch] = []
        for row in self._paginate(
            "/settlement",
            params={
                "subaccount": provider_account_id,
                "from": since.date().isoformat(),
                "perPage": 50,
            },
        ):
            raw_status = str(row.get("status") or "").lower()
            status = SETTLEMENT_STATUS_MAP.get(raw_status)
            if status is None:
                raise ValidationFailed(
                    f"Paystack reported a settlement state Danpa HQ does not map: {raw_status[:40]}"
                )
            reference = str(row.get("id") or "")
            if not reference:
                raise ProviderUnavailable("Paystack returned a settlement without an id.")
            transactions: tuple[ProviderSettlementTransaction, ...] = ()
            if status == "settled":
                transactions = tuple(
                    ProviderSettlementTransaction(
                        provider_transaction_id=str(item.get("id") or ""),
                        provider_reference=str(item.get("reference") or ""),
                        amount_minor=int(item.get("amount") or 0),
                        provider_fee_minor=int(item.get("fees") or 0),
                        currency=str(item.get("currency") or row.get("currency") or "").upper(),
                    )
                    for item in self._paginate(
                        f"/settlement/{reference}/transactions", params={"perPage": 50}
                    )
                )
            batches.append(
                ProviderSettlementBatch(
                    provider_settlement_reference=reference,
                    status=status,
                    currency=str(row.get("currency") or "").upper(),
                    settled_at=parse_datetime(str(row.get("settlement_date") or "")),
                    transactions=transactions,
                )
            )
        return tuple(batches)

    def _paginate(self, path: str, *, params: dict) -> list[dict]:
        """Read every advertised page, with a hard stop against bad metadata."""
        rows: list[dict] = []
        page = 1
        while page <= 100:
            query = {**params, "page": page}
            body = self._call("GET", path, params=query)
            if not body.get("status"):
                raise ProviderUnavailable("Paystack could not return the requested records.")
            data = body.get("data") or []
            if not isinstance(data, list):
                raise ProviderUnavailable("Paystack returned unreadable records.")
            rows.extend(item for item in data if isinstance(item, dict))
            meta = body.get("meta") or {}
            page_count = int(meta.get("pageCount") or meta.get("page_count") or page)
            if page >= page_count:
                return rows
            page += 1
        raise ProviderUnavailable("Paystack returned too many pages in one request.")


def _is_subscription(intent) -> bool:
    # Read loosely: an intent built before purposes existed is a rent intent.
    return str(getattr(intent, "purpose", "") or "") == "subscription_invoice"


def _payer_email(intent) -> str:
    """Paystack requires an email; Danpa HQ's accounts are phone-first.

    A payer who has given an email gets theirs, so their own receipt from
    Paystack reaches them. Anybody else gets a routable address on Danpa HQ's
    domain rather than a shared placeholder, so a bounce or a dispute can still
    be traced — to one tenant for rent, and to one Portfolio for a subscription,
    because the Portfolio is what pays for a plan.
    """
    domain = str(getattr(settings, "PAYMENT_RECEIPT_EMAIL_DOMAIN", "receipts.danpahq.com"))
    if _is_subscription(intent):
        account = intent.billing_invoice.billing_account
        email = (account.billing_email or getattr(intent.initiated_by, "email", "") or "").strip()
        return email or f"portfolio-{account.organization_id}@{domain}"
    email = (getattr(intent.tenant, "email", "") or "").strip()
    if email:
        return email
    return f"tenant-{intent.tenant_id}@{domain}"


def _mask_account(account_number: str) -> str:
    compact = "".join(character for character in account_number if character.isalnum())
    if len(compact) <= 4:
        return "*" * len(compact)
    return f"{'*' * min(8, len(compact) - 4)} {compact[-4:]}"


def _metadata_reference(value) -> str:
    """Read our recovery marker from either Paystack metadata representation."""
    metadata = value
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (TypeError, ValueError):
            return ""
    if not isinstance(metadata, dict):
        return ""
    direct = str(metadata.get("danpahq_provisioning_reference") or "")
    if direct:
        return direct
    for field in metadata.get("custom_fields") or []:
        if not isinstance(field, dict):
            continue
        if field.get("variable_name") == "danpahq_provisioning_reference":
            return str(field.get("value") or "")
    return ""


def _payout_destination(
    data: dict,
    *,
    fallback_account: str = "",
    fallback_name: str = "",
) -> ProviderPayoutDestination:
    token = str(data.get("subaccount_code") or "")
    provider_id = str(data.get("id") or "")
    if not token or not provider_id:
        raise ProviderUnavailable("Paystack did not return a complete subaccount reference.")
    raw_account = str(data.get("account_number") or fallback_account)
    return ProviderPayoutDestination(
        token_reference=token,
        provider_account_id=provider_id,
        masked_account=_mask_account(raw_account),
        account_name=str(data.get("account_name") or fallback_name)[:160],
        institution=str(data.get("settlement_bank") or "")[:80],
        verified=bool(data.get("is_verified")) and bool(data.get("active", True)),
    )
