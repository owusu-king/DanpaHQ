"""A Portfolio paying Danpa HQ for its plan, through the Payments Core.

What is held here, in the order a person meets it:

- the price comes from the server, with credit for unused paid time;
- the plan moves only when the provider's result is confirmed server-side;
- a failed, abandoned or replaced payment leaves the subscription as it was;
- a downgrade takes no money, keeps a paid period, and deletes nothing;
- the same money is never applied twice, and rent never hears about any of it.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import timedelta

import pytest
from django.conf import settings
from django.db import DatabaseError, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.billing.models import (
    LIVE_STATUSES,
    BillingEvent,
    BillingEventType,
    BillingInvoice,
    InvoiceKind,
    InvoiceStatus,
    Plan,
    PlanEntitlement,
    PortfolioPlanOverride,
    Subscription,
    SubscriptionStatus,
)
from apps.billing.services import (
    checkout_service,
    entitlement_service,
    invoice_service,
    lifecycle_service,
    subscription_service,
)
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ProviderUnavailable
from apps.organization import services as organization_services
from apps.organization.models import MembershipRole
from apps.outbox.models import OutboxEvent
from apps.payments import operations, reconciliation
from apps.payments import services as payment_services
from apps.payments.models import (
    IntentStatus,
    LedgerEntry,
    PaymentAllocation,
    PaymentIntent,
    PaymentTransaction,
    ProviderWebhook,
    Receipt,
    Settlement,
    WebhookStatus,
)
from apps.rent.models import RentPayment
from tests.conftest import upgrade_portfolio

pytestmark = pytest.mark.django_db


@pytest.fixture
def portfolio(landlord):
    from tests.conftest import approve_provider_standing

    approve_provider_standing(landlord)
    return organization_services.create_organization(
        user=landlord,
        data={
            "name": "Osu Properties",
            "organization_type": "individual_owner",
            "activities": ["residential"],
        },
    )


def price(code: str, interval: str = "monthly") -> int:
    plan = Plan.objects.get(code=code)
    return plan.annual_price_minor if interval == "annual" else plan.monthly_price_minor


def start(portfolio, user, plan="PRO", interval="monthly", method="mobile_money"):
    return checkout_service.start_checkout(
        organization=portfolio,
        user=user,
        plan_code=plan,
        interval=interval,
        payment_method=method,
    )


def signed(intent, *, event_id="evt-sub-1", status="succeeded", amount_minor=None):
    payload = {
        "event_id": event_id,
        "event_type": "payment.updated",
        "provider_reference": intent.provider_reference,
        "provider_transaction_id": f"txn-{event_id}",
        "status": status,
        "amount_minor": intent.amount_minor if amount_minor is None else amount_minor,
        "currency": intent.amount_currency,
        "payment_method": intent.payment_method,
        "occurred_at": timezone.now().isoformat(),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(
        settings.PAYMENT_TEST_WEBHOOK_SECRET.encode(), raw, hashlib.sha256
    ).hexdigest()
    return raw, {"X-Payment-Signature": signature}


def confirm(intent, **kwargs):
    raw, headers = signed(intent, **kwargs)
    return payment_services.process_webhook(provider_name="memory", raw_body=raw, headers=headers)


def provider_says(intent, status="succeeded", transaction_id="txn-provider"):
    return {
        "payments": {
            intent.provider_reference: {
                "provider_transaction_id": transaction_id,
                "status": status,
                "amount_minor": intent.amount_minor,
                "currency": intent.amount_currency,
                "payment_method": intent.payment_method,
                "occurred_at": timezone.now().isoformat(),
            }
        }
    }


def live(portfolio) -> Subscription:
    return Subscription.objects.select_related("plan").get(
        billing_account__organization=portfolio, status__in=LIVE_STATUSES
    )


def end_the_paid_period(portfolio) -> Subscription:
    """Move the live subscription's paid period into the past, as time would."""
    subscription = live(portfolio)
    ended = timezone.now() - timedelta(minutes=1)
    Subscription.objects.filter(id=subscription.id).update(
        current_period_start=ended - timedelta(days=30), current_period_end=ended
    )
    return live(portfolio)


@pytest.fixture
def paid_pro(portfolio, landlord):
    confirm(start(portfolio, landlord, plan="PRO"), event_id="evt-paid-pro")
    return live(portfolio)


def api_for(sign_in_as, user, fingerprint):
    api = APIClient()
    sign_in_as(api, user=user, device_fingerprint=fingerprint)
    return api


class TestQuote:
    def test_an_upgrade_is_priced_from_the_plan_row(self, portfolio):
        offer = checkout_service.quote(organization=portfolio, plan_code="PRO", interval="monthly")
        assert offer.direction == checkout_service.UPGRADE
        assert offer.requires_payment
        assert offer.list_price_minor == price("PRO")
        assert offer.credit_minor == 0
        assert offer.amount_minor == price("PRO")
        assert offer.blocked_reason == ""

    def test_annual_is_priced_from_the_annual_row(self, portfolio):
        offer = checkout_service.quote(
            organization=portfolio, plan_code="BUSINESS", interval="annual"
        )
        assert offer.amount_minor == price("BUSINESS", "annual")
        assert offer.period_end.year == offer.period_start.year + 1

    def test_the_current_plan_is_not_for_sale(self, portfolio):
        offer = checkout_service.quote(organization=portfolio, plan_code="FREE", interval="monthly")
        assert offer.direction == checkout_service.CURRENT
        assert offer.blocked_code == "current_plan"

    def test_a_downgrade_names_every_limit_it_would_exceed(self, portfolio, landlord, agent, user):
        upgrade_portfolio(portfolio, "BUSINESS")
        for member in (agent, user):
            organization_services.add_membership(
                organization=portfolio, actor=landlord, user=member, role=MembershipRole.STAFF
            )
        offer = checkout_service.quote(organization=portfolio, plan_code="FREE", interval="monthly")
        assert offer.direction == checkout_service.DOWNGRADE
        assert not offer.requires_payment
        assert {"entitlement": "TEAM_MEMBER_LIMIT", "current": 3, "limit": 1} in offer.over_limit

    def test_an_override_is_respected_in_what_a_downgrade_would_exceed(
        self, portfolio, landlord, agent
    ):
        from apps.billing.models import Entitlement

        upgrade_portfolio(portfolio, "BUSINESS")
        organization_services.add_membership(
            organization=portfolio, actor=landlord, user=agent, role=MembershipRole.STAFF
        )
        PortfolioPlanOverride.objects.create(
            organization=portfolio,
            entitlement=Entitlement.objects.get(key="TEAM_MEMBER_LIMIT"),
            value=5,
            reason="Negotiated seats",
            created_by=landlord,
        )
        offer = checkout_service.quote(organization=portfolio, plan_code="FREE", interval="monthly")
        assert offer.over_limit == []

    def test_an_upgrade_from_a_paid_plan_credits_exactly_the_unused_time(self, paid_pro):
        invoice = BillingInvoice.objects.get(subscription=paid_pro, status=InvoiceStatus.PAID)
        halfway = invoice.period_start + (invoice.period_end - invoice.period_start) / 2
        offer = checkout_service.quote(
            organization=paid_pro.billing_account.organization,
            plan_code="BUSINESS",
            interval="monthly",
            now=halfway,
        )
        assert offer.credit_minor == price("PRO") // 2
        assert offer.amount_minor == price("BUSINESS") - price("PRO") // 2

    def test_credit_that_exceeds_the_price_is_refused_not_paid_out(self, portfolio, landlord):
        confirm(start(portfolio, landlord, plan="PRO", interval="annual"), event_id="evt-annual")
        offer = checkout_service.quote(
            organization=portfolio, plan_code="BUSINESS", interval="monthly"
        )
        assert offer.blocked_code == "credit_exceeds_price"
        assert offer.amount_minor == 0


class TestCheckout:
    def test_starting_checkout_opens_a_payment_and_changes_nothing(self, portfolio, landlord):
        intent = start(portfolio, landlord, plan="PRO")

        assert intent.status == IntentStatus.PENDING
        assert intent.is_subscription
        assert intent.tenant_id is None and intent.lease_id is None
        invoice = intent.billing_invoice
        assert invoice.status == InvoiceStatus.OPEN
        assert invoice.kind == InvoiceKind.PLAN_CHANGE
        assert intent.amount_minor == invoice.amount_minor == price("PRO")
        assert live(portfolio).plan.code == "FREE"
        assert entitlement_service.limit(organization=portfolio, key="PROPERTY_LIMIT") == 1
        assert not PaymentTransaction.objects.exists()

    def test_a_confirmed_payment_moves_the_plan_and_records_the_money_once(
        self, portfolio, landlord
    ):
        intent = start(portfolio, landlord, plan="PRO")
        raw, headers = signed(intent)
        result = payment_services.process_webhook(
            provider_name="memory", raw_body=raw, headers=headers
        )
        # A provider redelivering the identical callback changes nothing.
        payment_services.process_webhook(provider_name="memory", raw_body=raw, headers=headers)

        assert result.status == IntentStatus.SUCCEEDED
        subscription = live(portfolio)
        assert subscription.plan.code == "PRO"
        assert subscription.status == SubscriptionStatus.ACTIVE
        assert subscription.provider == "memory"
        assert invoice_service.funding(subscription) == "paid"
        assert entitlement_service.limit(organization=portfolio, key="PROPERTY_LIMIT") == 10

        invoice = BillingInvoice.objects.get(id=intent.billing_invoice_id)
        assert invoice.status == InvoiceStatus.PAID
        assert invoice.period_start == subscription.current_period_start
        assert invoice.period_end == subscription.current_period_end

        transaction_row = PaymentTransaction.objects.get(intent=intent)
        assert transaction_row.rent_record_id is None
        allocation = PaymentAllocation.objects.get(transaction=transaction_row)
        assert allocation.billing_invoice_id == invoice.id
        assert allocation.obligation_id is None
        lines = list(LedgerEntry.objects.filter(transaction=transaction_row))
        assert [(line.direction, line.account_reference) for line in lines] == [
            ("debit", "psp_settlement_in_transit:memory"),
            ("credit", f"subscription_invoice:{invoice.id}"),
        ]
        receipt = Receipt.objects.get(transaction=transaction_row)
        assert receipt.breakdown["schema_version"] == "danpahq.subscription_receipt.v1"
        assert receipt.breakdown["portfolio"]["name"] == "Osu Properties"
        assert receipt.breakdown["invoice"]["plan_name"] == "Pro"
        assert bytes(receipt.final_pdf).startswith(b"%PDF")

        # Danpa HQ's own revenue: no beneficiary payout, and nothing in rent.
        assert not Settlement.objects.filter(transaction=transaction_row).exists()
        assert not RentPayment.objects.exists()
        assert BillingEvent.objects.filter(
            event_type=BillingEventType.PLAN_CHANGED, from_plan_code="FREE", to_plan_code="PRO"
        ).exists()
        assert OutboxEvent.objects.filter(
            name="billing.subscription_payment_succeeded.v1", aggregate_id=str(transaction_row.id)
        ).exists()
        assert not OutboxEvent.objects.filter(name="payment.succeeded.v1").exists()

    def test_the_payer_is_told_and_rent_handlers_never_run(self, portfolio, landlord):
        from apps.notifications.models import Notification
        from apps.outbox.tasks import dispatch_pending

        confirm(start(portfolio, landlord, plan="PRO"))
        dispatch_pending()
        notice = Notification.objects.get(
            user=landlord, kind="billing.subscription_payment_succeeded"
        )
        assert "Pro" in notice.title
        assert not Notification.objects.filter(kind="payment.succeeded").exists()

    def test_a_failed_payment_leaves_the_subscription_exactly_as_it_was(self, portfolio, landlord):
        intent = start(portfolio, landlord, plan="PRO")
        result = confirm(intent, status="failed")

        assert result.status == IntentStatus.FAILED
        assert BillingInvoice.objects.get(id=intent.billing_invoice_id).status == InvoiceStatus.OPEN
        assert live(portfolio).plan.code == "FREE"
        assert entitlement_service.limit(organization=portfolio, key="PROPERTY_LIMIT") == 1
        assert OutboxEvent.objects.filter(
            name="billing.subscription_payment_failed.v1", aggregate_id=str(intent.id)
        ).exists()
        assert not OutboxEvent.objects.filter(name="payment.failed.v1").exists()

    def test_a_retry_after_failure_pays_the_same_invoice(self, portfolio, landlord):
        intent = start(portfolio, landlord, plan="PRO")
        confirm(intent, status="failed", event_id="evt-declined")

        retried = checkout_service.retry_checkout(
            organization=portfolio, user=landlord, intent_id=intent.id
        )
        assert retried.status == IntentStatus.PENDING
        confirm(retried, event_id="evt-approved")

        assert live(portfolio).plan.code == "PRO"
        assert PaymentTransaction.objects.filter(intent=intent, status="succeeded").count() == 1
        assert BillingInvoice.objects.filter(billing_account__organization=portfolio).count() == 1

    def test_a_checkout_nobody_has_paid_yet_is_not_a_failure(self, portfolio, landlord):
        """The status check that runs as checkout opens always finds it unpaid.

        Treating that as a failure failed every upgrade before the payer could
        approve it, and the money that arrived moments later was never applied.
        """
        intent = start(portfolio, landlord, plan="PRO")
        with override_settings(PAYMENT_TEST_STATE=provider_says(intent, status="pending")):
            asked = checkout_service.refresh_checkout(
                organization=portfolio, user=landlord, intent_id=intent.id
            )
        assert asked.status == IntentStatus.PROCESSING
        assert BillingInvoice.objects.get(id=intent.billing_invoice_id).status == InvoiceStatus.OPEN
        assert live(portfolio).plan.code == "FREE"

        with override_settings(PAYMENT_TEST_STATE=provider_says(intent)):
            paid = checkout_service.refresh_checkout(
                organization=portfolio, user=landlord, intent_id=intent.id
            )
        assert paid.status == IntentStatus.SUCCEEDED
        assert live(portfolio).plan.code == "PRO"

    def test_trying_again_after_the_provider_took_the_money_does_not_charge_twice(
        self, portfolio, landlord
    ):
        intent = start(portfolio, landlord, plan="PRO")
        confirm(intent, status="failed", event_id="evt-declined")

        with override_settings(
            PAYMENT_TEST_STATE=provider_says(intent, transaction_id="txn-approved")
        ):
            result = checkout_service.retry_checkout(
                organization=portfolio, user=landlord, intent_id=intent.id
            )

        assert result.status == IntentStatus.SUCCEEDED
        assert live(portfolio).plan.code == "PRO"
        assert PaymentTransaction.objects.filter(intent=intent, status="succeeded").count() == 1

    def test_trying_again_waits_while_the_payment_is_still_being_confirmed(
        self, portfolio, landlord
    ):
        intent = start(portfolio, landlord, plan="PRO")
        confirm(intent, status="failed", event_id="evt-declined")

        with (
            override_settings(PAYMENT_TEST_STATE=provider_says(intent, status="processing")),
            pytest.raises(Conflict, match="still being confirmed"),
        ):
            checkout_service.retry_checkout(
                organization=portfolio, user=landlord, intent_id=intent.id
            )

        intent.refresh_from_db()
        assert intent.status == IntentStatus.FAILED
        assert live(portfolio).plan.code == "FREE"

    def test_starting_the_same_checkout_twice_resumes_it(self, portfolio, landlord):
        first = start(portfolio, landlord, plan="PRO")
        second = start(portfolio, landlord, plan="PRO")
        assert first.id == second.id
        assert BillingInvoice.objects.filter(billing_account__organization=portfolio).count() == 1

    def test_another_plan_cannot_be_started_while_a_payment_is_live(self, portfolio, landlord):
        start(portfolio, landlord, plan="PRO")
        with pytest.raises(Conflict) as refused:
            start(portfolio, landlord, plan="BUSINESS")
        assert refused.value.details["reason"] == "checkout_in_progress"

    def test_cancelling_asks_the_provider_and_then_frees_the_checkout(self, portfolio, landlord):
        intent = start(portfolio, landlord, plan="PRO")
        with override_settings(PAYMENT_TEST_STATE={"payments": {}}):
            cancelled = checkout_service.cancel_checkout(
                organization=portfolio, user=landlord, intent_id=intent.id
            )
        assert cancelled.status == IntentStatus.CANCELLED
        assert BillingInvoice.objects.get(id=intent.billing_invoice_id).status == InvoiceStatus.VOID

        replacement = start(portfolio, landlord, plan="BUSINESS")
        assert replacement.billing_invoice.plan.code == "BUSINESS"

    def test_cancelling_refuses_when_the_provider_cannot_say_nothing_was_taken(
        self, portfolio, landlord
    ):
        intent = start(portfolio, landlord, plan="PRO")
        with pytest.raises(Conflict):
            checkout_service.cancel_checkout(
                organization=portfolio, user=landlord, intent_id=intent.id
            )
        intent.refresh_from_db()
        assert intent.status == IntentStatus.PENDING

    def test_cancelling_a_payment_the_provider_already_took_applies_it(self, portfolio, landlord):
        intent = start(portfolio, landlord, plan="PRO")
        with override_settings(PAYMENT_TEST_STATE=provider_says(intent)):
            result = checkout_service.cancel_checkout(
                organization=portfolio, user=landlord, intent_id=intent.id
            )
        assert result.status == IntentStatus.SUCCEEDED
        assert live(portfolio).plan.code == "PRO"

    @override_settings(PAYMENT_BACKEND="")
    def test_no_payment_rail_means_no_invoice_and_no_attempt(self, portfolio, landlord):
        with pytest.raises(ProviderUnavailable):
            start(portfolio, landlord, plan="PRO")
        assert not BillingInvoice.objects.exists()
        assert not PaymentIntent.objects.exists()

    def test_money_for_a_replaced_checkout_is_refused_and_surfaced(self, portfolio, landlord):
        intent = start(portfolio, landlord, plan="PRO")
        with override_settings(PAYMENT_TEST_STATE={"payments": {}}):
            checkout_service.cancel_checkout(
                organization=portfolio, user=landlord, intent_id=intent.id
            )
        intent.refresh_from_db()

        with pytest.raises(Conflict):
            confirm(intent, event_id="evt-late")

        assert live(portfolio).plan.code == "FREE"
        assert not PaymentTransaction.objects.exists()
        webhook = ProviderWebhook.objects.get(event_id="evt-late")
        assert webhook.status == WebhookStatus.FAILED

    def test_an_administrative_change_during_payment_is_not_overwritten(self, portfolio, landlord):
        intent = start(portfolio, landlord, plan="PRO")
        subscription_service.change_plan(
            organization=portfolio, plan_code="BUSINESS", actor=None, reason="Support grant"
        )
        with pytest.raises(Conflict):
            confirm(intent)
        assert live(portfolio).plan.code == "BUSINESS"
        assert not PaymentTransaction.objects.exists()

    def test_reconciliation_recovers_a_payment_whose_callback_was_lost(self, portfolio, landlord):
        intent = start(portfolio, landlord, plan="PRO")
        with override_settings(PAYMENT_TEST_STATE=provider_says(intent)):
            outcome = reconciliation.sweep_open_intents(min_age_seconds=0)
        assert outcome["recovered"] == 1
        assert live(portfolio).plan.code == "PRO"

    def test_money_taken_after_danpahq_recorded_a_failure_is_found(self, portfolio, landlord):
        intent = start(portfolio, landlord, plan="PRO")
        confirm(intent, status="failed", event_id="evt-declined")

        with override_settings(
            PAYMENT_TEST_STATE=provider_says(intent, transaction_id="txn-approved")
        ):
            outcome = reconciliation.sweep_open_intents(min_age_seconds=0)

        assert outcome["recovered"] == 1
        assert live(portfolio).plan.code == "PRO"

    def test_money_after_a_failure_that_cannot_be_applied_reaches_a_person(
        self, portfolio, landlord
    ):
        from apps.payments.models import ReconciliationException, ReconciliationKind

        intent = start(portfolio, landlord, plan="PRO")
        confirm(intent, status="failed", event_id="evt-declined")
        # Told the payment failed, the payer moved on to another plan.
        start(portfolio, landlord, plan="BUSINESS")

        with override_settings(
            PAYMENT_TEST_STATE=provider_says(intent, transaction_id="txn-approved")
        ):
            outcome = reconciliation.sweep_open_intents(min_age_seconds=0)

        assert outcome["exceptions"] == 1
        exception = ReconciliationException.objects.get(
            provider_reference=intent.provider_reference
        )
        assert exception.kind == ReconciliationKind.PROVIDER_SUCCEEDED_INTERNAL_FAILED
        assert live(portfolio).plan.code == "FREE"

    def test_confirmed_subscription_money_is_never_called_unallocated(self, paid_pro):
        assert reconciliation.sweep_unallocated_transactions() == 0

    def test_the_operations_workspace_reads_a_subscription_payment(self, paid_pro):
        snapshot = operations.payment_operations_snapshot()
        row = snapshot["transactions"][0]
        assert row["purpose"] == "subscription_invoice"
        assert row["portfolio"] == "Osu Properties"
        assert row["tenant"] == ""

    def test_a_subscription_payment_is_not_reachable_as_rent(self, portfolio, landlord):
        intent = start(portfolio, landlord, plan="PRO")
        with pytest.raises(NotFound):
            payment_services.get_intent_or_404(intent.id, user=landlord)

    def test_a_paid_invoice_is_final_at_the_engine(self, paid_pro):
        invoice = BillingInvoice.objects.get(subscription=paid_pro, status=InvoiceStatus.PAID)
        with pytest.raises(DatabaseError), transaction.atomic():
            BillingInvoice.objects.filter(id=invoice.id).update(void_reason="tampered")

    def test_an_upgrade_from_a_paid_plan_charges_less_the_credit(self, paid_pro, landlord):
        portfolio = paid_pro.billing_account.organization
        intent = start(portfolio, landlord, plan="BUSINESS")
        invoice = intent.billing_invoice
        assert 0 < invoice.credit_minor <= price("PRO")
        assert invoice.amount_minor == price("BUSINESS") - invoice.credit_minor

        confirm(intent, event_id="evt-business")
        subscription = live(portfolio)
        assert subscription.plan.code == "BUSINESS"
        assert (
            subscription.current_period_start
            == BillingInvoice.objects.get(id=invoice.id).period_start
        )


class TestDowngradesAndPeriods:
    def test_a_paid_period_that_ends_enters_grace_and_keeps_its_plan(self, paid_pro):
        portfolio = paid_pro.billing_account.organization
        ended = end_the_paid_period(portfolio).current_period_end

        counts = lifecycle_service.advance_subscriptions()

        subscription = live(portfolio)
        assert counts["entered_grace"] == 1
        assert subscription.status == SubscriptionStatus.GRACE_PERIOD
        assert subscription.grace_expires_at == ended + timedelta(days=7)
        assert subscription.current_period_start == ended
        # Grace still grants what was bought.
        assert entitlement_service.limit(organization=portfolio, key="PROPERTY_LIMIT") == 10

    def test_grace_that_runs_out_is_past_due_and_creation_follows_free(self, paid_pro, landlord):
        portfolio = paid_pro.billing_account.organization
        end_the_paid_period(portfolio)
        lifecycle_service.advance_subscriptions()
        Subscription.objects.filter(id=paid_pro.id).update(
            grace_expires_at=timezone.now() - timedelta(minutes=1)
        )

        counts = lifecycle_service.advance_subscriptions()

        assert counts["past_due"] == 1
        assert live(portfolio).status == SubscriptionStatus.PAST_DUE
        assert entitlement_service.limit(organization=portfolio, key="PROPERTY_LIMIT") == 1
        snapshot = entitlement_service.snapshot(organization=portfolio)
        assert snapshot["subscription"]["plan"]["code"] == "PRO"
        assert snapshot["plan"]["code"] == "FREE"

    def test_renewing_during_grace_pays_for_the_period_grace_covered(self, paid_pro, landlord):
        portfolio = paid_pro.billing_account.organization
        ended = end_the_paid_period(portfolio).current_period_end
        lifecycle_service.advance_subscriptions()

        intent = start(portfolio, landlord, plan="PRO")
        assert intent.billing_invoice.kind == InvoiceKind.RENEWAL
        confirm(intent, event_id="evt-renewal")

        subscription = live(portfolio)
        assert subscription.status == SubscriptionStatus.ACTIVE
        assert subscription.current_period_start == ended
        assert BillingEvent.objects.filter(event_type=BillingEventType.RENEWED).exists()

    def test_downgrading_mid_period_keeps_the_paid_plan_until_it_ends(self, paid_pro, landlord):
        portfolio = paid_pro.billing_account.organization
        subscription = checkout_service.change_plan_without_payment(
            organization=portfolio, user=landlord, plan_code="FREE"
        )
        assert subscription.plan.code == "PRO"
        assert subscription.cancel_at_period_end is True

        end_the_paid_period(portfolio)
        counts = lifecycle_service.advance_subscriptions()

        assert counts["moved_to_free"] == 1
        subscription = live(portfolio)
        assert subscription.plan.code == "FREE"
        assert subscription.current_period_end is None

    def test_a_scheduled_move_to_a_cheaper_paid_plan_applies_at_period_end(
        self, portfolio, landlord
    ):
        confirm(start(portfolio, landlord, plan="BUSINESS"), event_id="evt-business")
        checkout_service.change_plan_without_payment(
            organization=portfolio, user=landlord, plan_code="PRO"
        )
        assert live(portfolio).scheduled_plan.code == "PRO"

        end_the_paid_period(portfolio)
        counts = lifecycle_service.advance_subscriptions()

        subscription = live(portfolio)
        assert counts["plan_changed"] == 1
        assert subscription.plan.code == "PRO"
        assert subscription.scheduled_plan_id is None
        assert subscription.status == SubscriptionStatus.GRACE_PERIOD

    def test_keeping_the_plan_undoes_a_scheduled_change(self, paid_pro, landlord):
        portfolio = paid_pro.billing_account.organization
        checkout_service.change_plan_without_payment(
            organization=portfolio, user=landlord, plan_code="FREE"
        )
        subscription = checkout_service.keep_current_plan(organization=portfolio, user=landlord)
        assert subscription.cancel_at_period_end is False
        assert BillingEvent.objects.filter(
            event_type=BillingEventType.SCHEDULED_CHANGE_CANCELLED
        ).exists()

    def test_a_complimentary_plan_is_never_billed_and_downgrades_now(self, portfolio, landlord):
        upgrade_portfolio(portfolio, "BUSINESS")
        assert invoice_service.funding(live(portfolio)) == "complimentary"
        assert lifecycle_service.advance_subscriptions() == {
            "moved_to_free": 0,
            "plan_changed": 0,
            "entered_grace": 0,
            "past_due": 0,
        }

        subscription = checkout_service.change_plan_without_payment(
            organization=portfolio, user=landlord, plan_code="PRO"
        )
        assert subscription.plan.code == "PRO"

    def test_a_downgrade_never_removes_records(self, portfolio, landlord, agent, user):
        upgrade_portfolio(portfolio, "BUSINESS")
        for member in (agent, user):
            organization_services.add_membership(
                organization=portfolio, actor=landlord, user=member, role=MembershipRole.STAFF
            )
        checkout_service.change_plan_without_payment(
            organization=portfolio, user=landlord, plan_code="FREE"
        )
        snapshot = entitlement_service.snapshot(organization=portfolio)
        assert snapshot["usage"]["TEAM_MEMBER_COUNT"] == 3
        assert {"entitlement": "TEAM_MEMBER_LIMIT", "current": 3, "limit": 1} in snapshot[
            "over_limit"
        ]

    def test_a_downgrade_waits_for_a_live_payment(self, paid_pro, landlord):
        portfolio = paid_pro.billing_account.organization
        end_the_paid_period(portfolio)
        lifecycle_service.advance_subscriptions()
        start(portfolio, landlord, plan="PRO")
        with pytest.raises(Conflict):
            checkout_service.change_plan_without_payment(
                organization=portfolio, user=landlord, plan_code="FREE"
            )


class TestWhoMayChangeThePlan:
    def test_an_accountant_cannot_start_a_checkout(self, portfolio, landlord, agent):
        upgrade_portfolio(portfolio, "BUSINESS")
        organization_services.add_membership(
            organization=portfolio, actor=landlord, user=agent, role=MembershipRole.ACCOUNTANT
        )
        with pytest.raises(PermissionDenied):
            checkout_service.change_plan_without_payment(
                organization=portfolio, user=agent, plan_code="PRO"
            )

    def test_a_stranger_cannot_act_on_a_portfolios_payment(self, portfolio, landlord, agent):
        intent = start(portfolio, landlord, plan="PRO")
        with pytest.raises(PermissionDenied):
            payment_services.retry_intent(intent=intent, user=agent)


class TestBillingApi:
    def test_checkout_requires_an_idempotency_key(self, portfolio, landlord, sign_in_as):
        api = api_for(sign_in_as, landlord, "billing-key-missing")
        response = api.post(
            f"/api/v1/organizations/{portfolio.id}/billing/checkout/",
            {"plan_code": "PRO", "billing_interval": "monthly", "payment_method": "mobile_money"},
            format="json",
        )
        assert response.status_code == 422, response.data
        assert not BillingInvoice.objects.exists()

    def test_an_owner_starts_checkout_and_the_billing_read_shows_it_pending(
        self, portfolio, landlord, sign_in_as
    ):
        api = api_for(sign_in_as, landlord, "billing-owner-checkout")
        body = {"plan_code": "PRO", "billing_interval": "monthly", "payment_method": "card"}
        url = f"/api/v1/organizations/{portfolio.id}/billing/checkout/"
        first = api.post(url, body, format="json", HTTP_IDEMPOTENCY_KEY="billing-checkout-0001")
        replay = api.post(url, body, format="json", HTTP_IDEMPOTENCY_KEY="billing-checkout-0001")

        assert first.status_code == 201, first.data
        assert first.data["status"] == "pending"
        assert first.data["invoice"]["plan"]["code"] == "PRO"
        assert first.data["amount_minor"] == price("PRO")
        assert replay.data["id"] == first.data["id"]
        assert replay["X-Idempotent-Replay"] == "true"

        billing = api.get(f"/api/v1/organizations/{portfolio.id}/billing/")
        assert billing.status_code == 200
        assert billing.data["checkout"]["open"]["id"] == first.data["id"]
        assert billing.data["viewer"]["can_change_plan"] is True
        assert billing.data["subscription"]["plan"]["code"] == "FREE"

        status = api.get(
            f"/api/v1/organizations/{portfolio.id}/billing/checkout/{first.data['id']}/"
        )
        assert status.data["status"] == "pending"

    def test_the_quote_endpoint_prices_without_changing_anything(
        self, portfolio, landlord, sign_in_as
    ):
        api = api_for(sign_in_as, landlord, "billing-quote")
        response = api.get(
            f"/api/v1/organizations/{portfolio.id}/billing/quote/?plan=BUSINESS&interval=annual"
        )
        assert response.status_code == 200, response.data
        assert response.data["direction"] == "upgrade"
        assert response.data["amount_minor"] == price("BUSINESS", "annual")
        assert response.data["blocked"] is None
        assert not BillingInvoice.objects.exists()

    def test_an_accountant_reads_billing_and_invoices_but_cannot_change_them(
        self, portfolio, landlord, agent, sign_in_as
    ):
        confirm(start(portfolio, landlord, plan="PRO"))
        upgrade_portfolio(portfolio, "BUSINESS")
        organization_services.add_membership(
            organization=portfolio, actor=landlord, user=agent, role=MembershipRole.ACCOUNTANT
        )
        api = api_for(sign_in_as, agent, "billing-accountant")

        billing = api.get(f"/api/v1/organizations/{portfolio.id}/billing/")
        assert billing.status_code == 200
        assert billing.data["viewer"] == {"can_change_plan": False, "can_view_invoices": True}
        assert billing.data["invoices"][0]["payment"]["status"] == "succeeded"
        assert billing.data["checkout"]["open"] is None

        refused = api.post(
            f"/api/v1/organizations/{portfolio.id}/billing/plan-change/",
            {"plan_code": "FREE"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="billing-accountant-0001",
        )
        assert refused.status_code == 403

    def test_downgrade_and_keep_plan_answer_with_the_new_billing_state(
        self, paid_pro, landlord, sign_in_as
    ):
        portfolio = paid_pro.billing_account.organization
        api = api_for(sign_in_as, landlord, "billing-downgrade")
        scheduled = api.post(
            f"/api/v1/organizations/{portfolio.id}/billing/plan-change/",
            {"plan_code": "FREE"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="billing-downgrade-0001",
        )
        assert scheduled.status_code == 200, scheduled.data
        assert scheduled.data["subscription"]["cancel_at_period_end"] is True
        assert scheduled.data["subscription"]["plan"]["code"] == "PRO"

        kept = api.post(
            f"/api/v1/organizations/{portfolio.id}/billing/keep-plan/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="billing-keep-plan-0001",
        )
        assert kept.status_code == 200, kept.data
        assert kept.data["subscription"]["cancel_at_period_end"] is False

    def test_the_customer_timeline_never_carries_staff_notes(self, portfolio, landlord, sign_in_as):
        subscription_service.change_plan(
            organization=portfolio,
            plan_code="PRO",
            actor=None,
            reason="Internal: goodwill after a support complaint",
        )
        api = api_for(sign_in_as, landlord, "billing-history")
        billing = api.get(f"/api/v1/organizations/{portfolio.id}/billing/")
        assert billing.data["history"]
        assert all("reason" not in event for event in billing.data["history"])
        assert "goodwill" not in json.dumps(billing.data)

    def test_a_subscription_receipt_is_the_portfolios_and_nobody_elses(
        self, paid_pro, landlord, agent, sign_in_as
    ):
        receipt = Receipt.objects.get(transaction__intent__billing_invoice__subscription=paid_pro)
        owner = api_for(sign_in_as, landlord, "billing-receipt-owner")
        stranger = api_for(sign_in_as, agent, "billing-receipt-stranger")

        assert owner.get(f"/api/v1/payments/receipts/{receipt.id}/").status_code == 200
        document = owner.get(f"/api/v1/payments/receipts/{receipt.id}/document.pdf")
        assert document.status_code == 200
        assert stranger.get(f"/api/v1/payments/receipts/{receipt.id}/").status_code == 404

    def test_the_catalogue_leads_with_highlights_each_plan_grants(self):
        response = APIClient().get("/api/v1/plans/")
        plans = {row["code"]: row for row in response.data["plans"]}

        assert response.data["recommended_plan"] == "PRO"
        assert plans["FREE"]["highlights"] == []
        assert plans["PRO"]["highlights"]
        for code in ("PRO", "BUSINESS"):
            for key in plans[code]["highlights"]:
                assert plans[code]["entitlements"][key]["value"] is True

        PlanEntitlement.objects.filter(plan__code="PRO", entitlement__key="TEAM_MANAGEMENT").update(
            value=False
        )
        moved = APIClient().get("/api/v1/plans/")
        pro = next(row for row in moved.data["plans"] if row["code"] == "PRO")
        assert "TEAM_MANAGEMENT" not in pro["highlights"]
