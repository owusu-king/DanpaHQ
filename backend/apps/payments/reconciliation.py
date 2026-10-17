"""Comparing Danpa HQ's financial record with the provider's, and disagreeing safely.

Every callback-based integration eventually meets the payment whose webhook
never arrived: the worker was down, the network ate it, the provider retried
three times into a 502. That money exists, and until somebody goes and looks it
is invisible.

**The sweep never repairs.** It opens an exception and stops. That is not
timidity — it is the only defensible behaviour, because the entire reason to
compare two ledgers is that you do not know in advance which one is wrong. A
sweep that silently corrected what it found would be a sweep that could silently
corrupt, and it would do so in the one part of the product where a wrong number
is somebody's rent.

The one thing it is allowed to do is *ask*. `query_payment` and
`query_settlement` are reads.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import (
    Conflict,
    NotFound,
    PermissionDenied,
    ProviderUnavailable,
    ValidationFailed,
)
from apps.outbox.services import emit

from . import alerts
from .models import (
    OPEN_EXCEPTION_STATUSES,
    OPEN_INTENT_STATUSES,
    IntentStatus,
    PaymentIntent,
    PaymentTransaction,
    ProviderWebhook,
    ReconciliationException,
    ReconciliationKind,
    ReconciliationStatus,
    Settlement,
    SettlementStatus,
    TransactionStatus,
    WebhookStatus,
)
from .providers import get_payment_provider

logger = logging.getLogger("payments.reconciliation")

#: Alerting is a binding, not a feature: the application states the fact at a
#: severity and with a stable `event` key, and the deployment's log pipeline
#: decides who is woken. What the application owes that pipeline is a signal
#: that gets *louder* rather than one that fires once into an empty room — an
#: exception queue nobody is paged for is a queue nobody reads, and the whole
#: point of these rows is that somebody's rent is in question.
#:
#: See `docs/runbook.md` for the routing and the on-call procedure.
ALERT_EVENT_OPENED = "payment_reconciliation_exception_opened"
ALERT_EVENT_AGEING = "payment_reconciliation_exception_ageing"
ALERT_EVENT_BREACHED = "payment_reconciliation_exception_breached"
#: Acknowledged, and still open past the deadline. Quieter than an
#: unanswered one because somebody has it, but not silent: an investigation
#: that stalls is still a tenant's payment nobody has accounted for.
ALERT_EVENT_STALLED = "payment_reconciliation_exception_stalled"

#: How far back the open-intent sweep also asks about payments Danpa HQ recorded
#: as failed. A payer can still complete the provider transaction a failure was
#: recorded against, and that money is invisible to a sweep of open intents.
FAILED_INTENT_LOOKBACK = timedelta(hours=24)


def _ageing_hours() -> int:
    return int(getattr(settings, "PAYMENT_RECONCILIATION_AGEING_HOURS", 4))


def _breach_hours() -> int:
    return int(getattr(settings, "PAYMENT_RECONCILIATION_BREACH_HOURS", 24))


@transaction.atomic
def open_exception(
    *,
    kind: str,
    provider: str,
    provider_reference: str = "",
    intent=None,
    transaction_row=None,
    settlement=None,
    detail: dict | None = None,
) -> ReconciliationException:
    """Record a disagreement, once.

    A sweep runs repeatedly against the same unresolved problem. Without the
    get-or-create below, one exception nobody has got to yet becomes a hundred
    of them by Friday and the queue stops being something a person can read.
    """
    existing = (
        ReconciliationException.objects.select_for_update()
        .filter(
            kind=kind,
            provider=provider,
            provider_reference=provider_reference,
            status__in=[ReconciliationStatus.OPEN, ReconciliationStatus.INVESTIGATING],
        )
        .first()
    )
    if existing is not None:
        return existing

    row = ReconciliationException.objects.create(
        kind=kind,
        provider=provider,
        provider_reference=provider_reference[:160],
        intent=intent,
        transaction=transaction_row,
        settlement=settlement,
        detail=detail or {},
        detected_at=timezone.now(),
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="reconciliation_exception",
        aggregate_id=row.id,
        actor=None,
        metadata={"kind": kind, "provider": provider, "reference": provider_reference[:160]},
    )
    emit(
        DomainEvent(
            "payment.reconciliation_exception.v1",
            "reconciliation_exception",
            str(row.id),
            {"kind": kind, "provider": provider},
        )
    )
    # Said out loud at the moment it is found, not left for whoever next opens
    # the workspace. No amounts, no names: the reference is enough to find the
    # row, and an alert stream is not a place to put somebody's rent.
    logger.error(
        "payment reconciliation exception opened",
        extra={
            "event": ALERT_EVENT_OPENED,
            "kind": kind,
            "provider": provider,
            "reference": str(row.id),
        },
    )
    # Outside the transaction would be tidier, but this is a best-effort POST
    # with a five-second ceiling that cannot raise, and moving it would mean
    # either an outbox hop — which the worker being down would swallow — or a
    # second scheduled pass before anyone hears about a new exception.
    alerts.deliver(
        alerts.build_payload(
            event=ALERT_EVENT_OPENED,
            severity="error",
            exception_id=str(row.id),
            kind=kind,
            provider=provider,
            status=row.status,
            age_hours=0,
        )
    )
    return row


def alert_open_exceptions() -> dict[str, int]:
    """Re-state every unresolved exception, louder the longer it is ignored.

    A single alert at discovery is the one that gets missed — the worker fires
    it at 03:00, nobody is looking, and the row sits open for a week while a
    tenant's payment is unaccounted for. This re-emits on a schedule so an
    ignored queue becomes progressively harder to ignore, and crosses into
    `critical` once an exception has outlived any reasonable investigation.

    **Acknowledgement is what quietens it, and only for a while.** Moving an
    exception to `investigating` says a person has it, so the paging stops —
    continuing to page somebody who has already answered is how a team learns to
    mute the channel. It drops to `warning`, and only once the row has passed the
    breach window, so an investigation that was opened and then forgotten still
    surfaces. Nothing here closes anything: only a person resolves an exception,
    and until they do it stays in the queue and in the counts.

    Every alert both logs and leaves the process — see `alerts.deliver`.
    """
    now = timezone.now()
    ageing_before = now - timedelta(hours=_ageing_hours())
    breach_before = now - timedelta(hours=_breach_hours())
    ageing = breached = acknowledged = delivered = 0

    rows = ReconciliationException.objects.filter(
        status__in=OPEN_EXCEPTION_STATUSES,
        detected_at__lte=ageing_before,
    ).order_by("detected_at")[:500]

    for row in rows:
        age_hours = int((now - row.detected_at).total_seconds() // 3600)
        breached_now = row.detected_at <= breach_before
        acknowledged_row = row.status == ReconciliationStatus.INVESTIGATING

        if acknowledged_row and not breached_now:
            # Somebody has it and is inside the window. Say nothing.
            continue

        if acknowledged_row:
            acknowledged += 1
            event, severity, level = (
                ALERT_EVENT_STALLED,
                "warning",
                logging.WARNING,
            )
            message = "payment reconciliation exception acknowledged but still open"
        elif breached_now:
            breached += 1
            event, severity, level = (
                ALERT_EVENT_BREACHED,
                "critical",
                logging.CRITICAL,
            )
            message = "payment reconciliation exception unresolved past its deadline"
        else:
            ageing += 1
            event, severity, level = ALERT_EVENT_AGEING, "error", logging.ERROR
            message = "payment reconciliation exception still open"

        logger.log(
            level,
            message,
            extra={
                "event": event,
                "kind": row.kind,
                "provider": row.provider,
                "reference": str(row.id),
                "status": row.status,
                "duration_ms": age_hours * 3_600_000,
            },
        )
        payload = alerts.build_payload(
            event=event,
            severity=severity,
            exception_id=str(row.id),
            kind=row.kind,
            provider=row.provider,
            status=row.status,
            age_hours=age_hours,
        )
        if alerts.deliver(payload):
            delivered += 1

    return {
        "ageing": ageing,
        "breached": breached,
        "acknowledged": acknowledged,
        "delivered": delivered,
    }


@transaction.atomic
def resolve_exception(
    *, exception_id, management_actor, status: str, note: str = ""
) -> ReconciliationException:
    """Close one, with a person's name against it.

    Resolution is a human act. Nothing in this module closes an exception on its
    own, because "the numbers agree now" is not the same as "somebody
    understood why they disagreed".
    """
    from apps.operations.models import ManagementRole, ManagementUser

    if not isinstance(management_actor, ManagementUser) or (
        management_actor.role != ManagementRole.OPERATIONS_ADMIN
    ):
        raise PermissionDenied("Only an Operations Admin can reconcile payments.")
    note = note.strip()
    if not note:
        raise ValidationFailed("Record what was checked before changing this exception.")

    row = ReconciliationException.objects.select_for_update().filter(id=exception_id).first()
    if row is None:
        raise NotFound("We could not find that reconciliation exception.")
    allowed = (
        ReconciliationStatus.RESOLVED,
        ReconciliationStatus.ACCEPTED,
        ReconciliationStatus.INVESTIGATING,
    )
    if status not in allowed:
        raise ValidationFailed("That is not a resolution state.")

    if row.status in (ReconciliationStatus.RESOLVED, ReconciliationStatus.ACCEPTED):
        if row.status == status:
            return row
        raise Conflict("A closed reconciliation exception cannot be reopened or reclassified.")

    previous = row.status
    row.status = status
    row.resolution_note = note[:500]
    if status in (ReconciliationStatus.RESOLVED, ReconciliationStatus.ACCEPTED):
        row.resolved_at = timezone.now()
        row.resolved_by_management_id = management_actor.id
    row.save(
        update_fields=[
            "status",
            "resolution_note",
            "resolved_at",
            "resolved_by_management_id",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="reconciliation_exception",
        aggregate_id=row.id,
        management_actor=management_actor,
        changes={"status": [previous, status]},
        # The exception row carries the latest note; the append-only audit log
        # preserves the complete note for every transition in the investigation.
        metadata={"note": note[:500]},
    )
    return row


def _disagreement_kind(intent: PaymentIntent, state) -> str | None:
    """Which way, if any, the provider's record contradicts Danpa HQ's."""
    if state.amount_minor and state.amount_minor != intent.amount_minor:
        return ReconciliationKind.AMOUNT_MISMATCH
    if state.currency and state.currency != intent.amount_currency:
        return ReconciliationKind.CURRENCY_MISMATCH
    return None


def sweep_open_intents(*, limit: int = 200, min_age_seconds: int = 300) -> dict[str, int]:
    """Find money the provider took that Danpa HQ never heard about, and post it.

    The important one. An intent sitting at `pending` after its window has
    closed is either abandoned — the ordinary case — or paid, with the callback
    lost. Only the provider can tell the two apart, and only if somebody asks.

    **A provider-confirmed success is ingested, not "repaired".** The
    distinction is the whole of this module's rule. Repairing means choosing
    between two records that disagree, which nothing here may do. This is the
    other case: Danpa HQ holds *no* record, and the provider is the sole
    authority on whether a payment happened — so the sweep applies it through
    `services.apply_provider_state`, the identical amount/currency/method,
    transaction, allocation, ledger, receipt and audit boundary a signed webhook
    and a tenant's return-from-checkout both go through. Without this, a lost
    callback left the tenant's rent uncredited until they personally came back
    and tapped refresh, and no operator could put it right either: the exception
    queue is deliberately unable to move money.

    **A recent failure is asked about too.** A payer can still complete the
    provider transaction a failure was recorded against, and a failure can be
    recorded before they have finished. Money the provider took after Danpa HQ
    wrote "failed" is as real as money whose callback was lost, and a sweep of
    open intents never saw it. Failures from the last day are included.

    Anything the confirmation boundary refuses — a mismatched amount, an
    obligation that changed underneath, a transaction id already spent — opens
    an exception and stops, exactly as before: `provider_succeeded_internal_failed`
    when Danpa HQ had recorded a failure, because applying or refunding that
    money is a person's decision.

    ``min_age_seconds`` keeps the sweep off payments whose callback is merely in
    flight, so a perfectly ordinary checkout does not surface as an incident.
    """
    from .services import apply_provider_state

    opened = 0
    recovered = 0
    now = timezone.now()
    cutoff = now - timedelta(seconds=min_age_seconds)
    stale = (
        PaymentIntent.objects.filter(
            Q(status__in=OPEN_INTENT_STATUSES)
            | Q(status=IntentStatus.FAILED, updated_at__gte=now - FAILED_INTENT_LOOKBACK),
            created_at__lte=cutoff,
        )
        .exclude(provider_reference="")
        .order_by("created_at")[:limit]
    )
    for intent in stale:
        try:
            provider = get_payment_provider(intent.provider)
            state = provider.query_payment(provider_reference=intent.provider_reference)
        except (ProviderUnavailable, PermissionDenied) as exc:
            # An unreachable or deconfigured provider is an operational fact,
            # not a financial one. Logged and skipped, never silently dropped:
            # a sweep that hides its own failures is worse than no sweep.
            logger.warning(
                "reconciliation could not reach provider",
                extra={
                    "event": "reconciliation_provider_unavailable",
                    "provider": intent.provider,
                    "detail": str(exc),
                },
            )
            continue
        if not state.found:
            # Nothing there. An intent we never heard about is not yet a
            # problem; it becomes one only if we believed it succeeded.
            continue

        kind = _disagreement_kind(intent, state)
        refusal = ""
        if kind is None and state.status == "succeeded":
            try:
                apply_provider_state(
                    intent=intent,
                    state=state,
                    evidence_source="reconciliation_sweep",
                )
            except (Conflict, NotFound, ValidationFailed, ProviderUnavailable) as exc:
                kind = (
                    ReconciliationKind.PROVIDER_SUCCEEDED_INTERNAL_FAILED
                    if intent.status == IntentStatus.FAILED
                    else ReconciliationKind.PROVIDER_SUCCEEDED_INTERNAL_PENDING
                )
                refusal = str(getattr(exc, "message", "") or exc)[:300]
            else:
                recovered += 1
                record(
                    action=AuditAction.MONEY_MOVEMENT,
                    aggregate_type="payment_intent",
                    aggregate_id=intent.id,
                    actor=None,
                    metadata={
                        "event": "lost_callback_recovered",
                        "provider": intent.provider,
                        "provider_reference": intent.provider_reference,
                        "evidence_source": "reconciliation_sweep",
                    },
                )
                continue
        if kind is None:
            continue

        detail = {
            "danpahq_status": intent.status,
            "provider_status": state.status,
            "danpahq_amount_minor": intent.amount_minor,
            "provider_amount_minor": state.amount_minor,
            "danpahq_currency": intent.amount_currency,
            "provider_currency": state.currency,
        }
        if refusal:
            detail["confirmation_refused"] = refusal
        open_exception(
            kind=kind,
            provider=intent.provider,
            provider_reference=intent.provider_reference,
            intent=intent,
            detail=detail,
        )
        opened += 1
    return {"exceptions": opened, "recovered": recovered}


def sweep_unmatched_provider_events(*, limit: int = 200) -> int:
    """Signed provider evidence that matched nothing Danpa HQ knows about.

    The narrow window this catches is real: an intent whose row was rolled back
    after the provider had already accepted the checkout leaves a payment at the
    PSP that no sweep over *our* intents can ever find, because there is no
    intent to sweep. What does survive is the callback — refused, but recorded
    against `ProviderWebhook`. Until now nothing ever looked at that table, so
    the evidence sat in it silently.
    """
    opened = 0
    rows = ProviderWebhook.objects.filter(
        status__in=[WebhookStatus.FAILED, WebhookStatus.RECEIVED],
        signature_valid=True,
        created_at__lte=timezone.now() - timedelta(minutes=30),
    ).order_by("created_at")[:limit]
    for row in rows:
        already_open = ReconciliationException.objects.filter(
            kind=ReconciliationKind.UNMATCHED_PROVIDER_EVENT,
            provider=row.provider,
            provider_reference=row.event_id[:160],
            status__in=[ReconciliationStatus.OPEN, ReconciliationStatus.INVESTIGATING],
        ).exists()
        open_exception(
            kind=ReconciliationKind.UNMATCHED_PROVIDER_EVENT,
            provider=row.provider,
            provider_reference=row.event_id,
            detail={
                "event_type": row.event_type,
                "webhook_status": row.status,
                "error_message": row.error_message,
                "received_at": row.created_at.isoformat(),
            },
        )
        if not already_open:
            opened += 1
    return opened


def sweep_settlements(*, limit: int = 200) -> int:
    """Ask whether beneficiaries have actually been paid.

    A confirmed payment and a settled payout are different financial events and
    this is the sweep that keeps them different. A settlement that has sat
    `pending` past its expected date is the provider's problem to explain, not
    something to quietly relabel.
    """
    opened = 0
    pending = (
        Settlement.objects.filter(status=SettlementStatus.PENDING)
        .select_related("transaction")
        .order_by("created_at")[:limit]
    )
    for settlement in pending:
        try:
            provider = get_payment_provider(settlement.provider)
            state = provider.query_settlement(
                provider_transaction_id=settlement.transaction.provider_transaction_id
            )
        except (ProviderUnavailable, PermissionDenied) as exc:
            logger.warning(
                "reconciliation could not query settlement",
                extra={
                    "event": "reconciliation_settlement_unavailable",
                    "provider": settlement.provider,
                    "detail": str(exc),
                },
            )
            continue
        if not state.found:
            continue
        if state.status == "settled" and state.net_minor != settlement.net_amount_minor:
            open_exception(
                kind=ReconciliationKind.SETTLEMENT_AMOUNT_MISMATCH,
                provider=settlement.provider,
                provider_reference=state.provider_settlement_reference
                or settlement.transaction.provider_transaction_id,
                settlement=settlement,
                transaction_row=settlement.transaction,
                detail={
                    "danpahq_net_minor": settlement.net_amount_minor,
                    "provider_net_minor": state.net_minor,
                    "provider_fee_minor": state.fee_minor,
                    "provider_status": state.status,
                },
            )
            opened += 1
        elif state.status == "reversed":
            open_exception(
                kind=ReconciliationKind.REVERSAL,
                provider=settlement.provider,
                provider_reference=state.provider_settlement_reference
                or settlement.transaction.provider_transaction_id,
                settlement=settlement,
                transaction_row=settlement.transaction,
                detail={"provider_status": state.status},
            )
            opened += 1
    return opened


def sweep_unallocated_transactions(*, limit: int = 200) -> int:
    """Confirmed money that is not applied to anything.

    Purely internal — no provider call. A succeeded transaction with no
    allocation means Danpa HQ holds a record of money whose purpose it cannot
    state, which is precisely the condition allocation exists to prevent.
    """
    opened = 0
    rows = PaymentTransaction.objects.filter(
        status=TransactionStatus.SUCCEEDED, allocations=None
    ).order_by("created_at")[:limit]
    for transaction_row in rows:
        open_exception(
            kind=ReconciliationKind.UNALLOCATED_TRANSACTION,
            provider=transaction_row.provider,
            provider_reference=transaction_row.provider_transaction_id,
            transaction_row=transaction_row,
            detail={
                "amount_minor": transaction_row.amount_minor,
                "currency": transaction_row.amount_currency,
            },
        )
        opened += 1
    return opened


def run_reconciliation() -> dict[str, int]:
    """Everything, in one pass. Wired to the worker in `tasks.py`."""
    intents = sweep_open_intents()
    return {
        "intents": intents["exceptions"],
        "payments_recovered": intents["recovered"],
        "settlements": sweep_settlements(),
        "unallocated": sweep_unallocated_transactions(),
        "unmatched_events": sweep_unmatched_provider_events(),
    }


__all__ = [
    "ALERT_EVENT_AGEING",
    "ALERT_EVENT_BREACHED",
    "ALERT_EVENT_OPENED",
    "ALERT_EVENT_STALLED",
    "IntentStatus",
    "alert_open_exceptions",
    "open_exception",
    "resolve_exception",
    "run_reconciliation",
    "sweep_open_intents",
    "sweep_settlements",
    "sweep_unallocated_transactions",
    "sweep_unmatched_provider_events",
]
