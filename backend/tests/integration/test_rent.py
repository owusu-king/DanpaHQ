"""Rent: what is owed, what was paid, and who agrees it was.

The rule everything else rests on: a payment one party asserts is a claim, and
only a payment both parties have agreed is a receipt. If a claim could settle a
debt, either side could clear their own balance by saying so.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict, PermissionDenied, ValidationFailed
from apps.lease import services as lease_services
from apps.rent import services
from apps.rent.models import (
    ChargeKind,
    ChargeStatus,
    ObligationAdjustment,
    ObligationAdjustmentKind,
    PaymentStatus,
    RentCharge,
    RentReminder,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


@pytest.fixture
def unit(landlord, address, approve_provider):
    from apps.property.models import Property, Unit

    prop = Property.objects.create(
        owner=landlord, address=address, title="Osu block", property_type="apartment"
    )
    approve_provider(landlord, prop)
    return Unit.objects.create(property=prop, label="Flat A", bedrooms=1, bathrooms=1)


@pytest.fixture
def portfolio(landlord, address, approve_provider):
    """An organization holding one Property and one Unit.

    Built through the product's own creation path rather than by writing rows,
    because a portfolio read is scoped by organization membership and a
    Property assembled by hand is not in anybody's portfolio.
    """
    from apps.organization import services as organization_services
    from apps.property import services as property_services
    from tests.conftest import approve_provider_standing

    organization = organization_services.create_organization(
        user=landlord,
        data={
            "name": "Osu Properties",
            "organization_type": "individual_owner",
            "activities": ["residential"],
        },
    )
    approve_provider_standing(landlord)
    prop = property_services.create_private_property(
        user=landlord,
        organization=organization,
        data={
            "title": "Osu block",
            "property_type": "residential",
            "address_id": address.id,
        },
    )
    approve_provider(landlord, prop)
    space = property_services.add_unit(
        prop=prop,
        user=landlord,
        data={"label": "Flat A", "space_type": "apartment", "bedrooms": 1},
    )
    return organization, space


def _active_lease(landlord, tenant, unit, **overrides):
    terms = {
        "rent_minor": 150000,
        "advance_months": 6,
        "deposit_months": 1,
        "agency_fee_months": 1,
        "starts_on": date.today(),
        "term_months": 12,
    }
    terms.update(overrides)
    lease = lease_services.draft_lease(user=landlord, unit=unit, tenant=tenant, data=terms)
    lease = lease_services.offer_lease(lease=lease, user=landlord)
    return lease_services.accept_lease(lease=lease, user=tenant)


class TestTheSchedule:
    def test_it_follows_how_tenancies_here_actually_run(self, landlord, user, unit):
        """A block up front covering several months, then the next block -
        not twelve monthly invoices."""
        lease = _active_lease(landlord, user, unit)
        charges = services.build_schedule(lease)

        kinds = [charge.kind for charge in charges]
        assert ChargeKind.ADVANCE in kinds
        assert ChargeKind.DEPOSIT in kinds
        assert ChargeKind.AGENCY_FEE in kinds

        advance = next(c for c in charges if c.kind == ChargeKind.ADVANCE)
        assert advance.amount_minor == 150000 * 6
        assert advance.due_on == lease.starts_on

        # Six months of a twelve-month term are covered; the rest follows.
        rent_blocks = [c for c in charges if c.kind == ChargeKind.RENT]
        assert sum(c.amount_minor for c in rent_blocks) == 150000 * 6

    def test_an_advance_covering_the_whole_term_leaves_nothing_further(self, landlord, user, unit):
        """The common case for a one-year advance on a one-year term."""
        lease = _active_lease(landlord, user, unit, advance_months=12, term_months=12)
        charges = services.build_schedule(lease)
        assert [c for c in charges if c.kind == ChargeKind.RENT] == []

    def test_it_is_built_once(self, landlord, user, unit):
        lease = _active_lease(landlord, user, unit)
        first = services.build_schedule(lease)
        second = services.build_schedule(lease)
        assert len(first) == len(second)
        assert RentCharge.objects.filter(lease=lease).count() == len(first)

    def test_it_is_built_when_the_tenancy_goes_live(self, landlord, user, unit):
        """Via the outbox, so leases know nothing about rent."""
        from apps.outbox.tasks import dispatch_pending

        lease = _active_lease(landlord, user, unit)
        dispatch_pending()
        assert RentCharge.objects.filter(lease=lease).exists()


class TestRentReminders:
    """Automated reminders are a Pro capability, so these tests say so.

    The plain `unit` fixture builds a Property that belongs to no Portfolio,
    which resolves to no entitlement. These tests are about reminder mechanics —
    grouping, idempotence, wording, suppression — so they state the plan in one
    line and get on with it, the same way the rest of the suite handles limits.
    """

    @pytest.fixture
    def unit(self, portfolio):
        from tests.conftest import upgrade_portfolio

        organization, space = portfolio
        upgrade_portfolio(organization, "PRO")
        return space

    def _charges_due_in(self, *, landlord, tenant, unit, days):
        lease = _active_lease(landlord, tenant, unit)
        charges = services.build_schedule(lease)
        due_on = timezone.localdate() + timedelta(days=days)
        RentCharge.objects.filter(id__in=[charge.id for charge in charges]).update(due_on=due_on)
        return lease, list(RentCharge.objects.filter(lease=lease)), due_on

    def test_charges_due_together_produce_one_idempotent_reminder(self, landlord, user, unit):
        from apps.notifications.models import Notification
        from apps.outbox.tasks import dispatch_pending
        from apps.rent.tasks import emit_due_reminders

        lease, charges, due_on = self._charges_due_in(
            landlord=landlord, tenant=user, unit=unit, days=7
        )
        assert len(charges) > 1, "the scenario must contain a grouped move-in balance"

        assert emit_due_reminders()["emitted"] == 1
        assert emit_due_reminders()["emitted"] == 0
        dispatch_pending()

        reminder = RentReminder.objects.get(lease=lease, due_on=due_on)
        assert reminder.stage == "due_in_7_days"
        notification = Notification.objects.get(user=user, kind="rent.payment_due_soon")
        assert notification.target_type == "payment"
        assert notification.target_id == str(lease.id)
        assert f"{len(charges)} scheduled items" in notification.body
        assert not Notification.objects.filter(
            user=landlord, kind__startswith="rent.payment"
        ).exists()

    @pytest.mark.parametrize(
        ("days", "expected_kind"),
        [
            (1, "rent.payment_due_now"),
            (0, "rent.payment_due_now"),
            (-1, "rent.payment_overdue"),
            (-7, "rent.payment_overdue"),
        ],
    )
    def test_due_and_overdue_checkpoints_use_actionable_language(
        self, landlord, user, unit, days, expected_kind
    ):
        from apps.notifications.models import Notification
        from apps.outbox.tasks import dispatch_pending
        from apps.rent.tasks import emit_due_reminders

        self._charges_due_in(landlord=landlord, tenant=user, unit=unit, days=days)
        assert emit_due_reminders()["emitted"] == 1
        dispatch_pending()

        notification = Notification.objects.get(user=user, kind=expected_kind)
        assert notification.target_type == "payment"

    def test_a_payment_before_delivery_suppresses_the_stale_reminder(self, landlord, user, unit):
        from apps.notifications.models import Notification
        from apps.outbox.tasks import dispatch_pending
        from apps.rent.tasks import emit_due_reminders

        lease, _, _ = self._charges_due_in(landlord=landlord, tenant=user, unit=unit, days=3)
        assert emit_due_reminders()["emitted"] == 1
        RentCharge.objects.filter(lease=lease).update(
            status=ChargeStatus.PAID,
            amount_paid_minor=150000,
            amount_paid_currency="GHS",
            settled_at=timezone.now(),
        )
        dispatch_pending()

        assert not Notification.objects.filter(user=user, kind__startswith="rent.payment").exists()

    def test_days_outside_the_policy_do_not_create_reminders(self, landlord, user, unit):
        from apps.rent.tasks import emit_due_reminders

        self._charges_due_in(landlord=landlord, tenant=user, unit=unit, days=5)
        assert emit_due_reminders()["emitted"] == 0
        assert not RentReminder.objects.exists()


class TestRentRemindersArePaid:
    """The capability gate, from the outside.

    `AUTOMATED_RENT_REMINDERS` is a Pro capability. These assert the behaviour a
    provider would actually see, not the catalogue row — the row can move
    between plans without any of this changing.
    """

    def _due_in_7_days(self, *, landlord, tenant, unit):
        lease = _active_lease(landlord, tenant, unit)
        charges = services.build_schedule(lease)
        due_on = timezone.localdate() + timedelta(days=7)
        RentCharge.objects.filter(id__in=[charge.id for charge in charges]).update(due_on=due_on)
        return lease

    def test_a_free_portfolio_sends_none(self, landlord, user, portfolio):
        from apps.rent.tasks import emit_due_reminders

        _, space = portfolio
        lease = self._due_in_7_days(landlord=landlord, tenant=user, unit=space)

        result = emit_due_reminders()

        assert result["emitted"] == 0
        assert result["unentitled"] == 1
        assert not RentReminder.objects.filter(lease=lease).exists()

    def test_a_pro_portfolio_sends_them(self, landlord, user, portfolio):
        from apps.rent.tasks import emit_due_reminders
        from tests.conftest import upgrade_portfolio

        organization, space = portfolio
        upgrade_portfolio(organization, "PRO")
        lease = self._due_in_7_days(landlord=landlord, tenant=user, unit=space)

        assert emit_due_reminders()["emitted"] == 1
        assert RentReminder.objects.filter(lease=lease).exists()

    def test_upgrading_starts_reminding_at_the_next_run_not_the_next_checkpoint(
        self, landlord, user, portfolio
    ):
        """The reason a skipped checkpoint writes no reminder row.

        Recording the skip would mark the checkpoint delivered, and the provider
        who upgraded *because* they wanted reminders would get nothing until the
        following one. They paid; it works now.
        """
        from apps.rent.tasks import emit_due_reminders
        from tests.conftest import upgrade_portfolio

        organization, space = portfolio
        lease = self._due_in_7_days(landlord=landlord, tenant=user, unit=space)
        assert emit_due_reminders()["emitted"] == 0

        upgrade_portfolio(organization, "PRO")

        assert emit_due_reminders()["emitted"] == 1
        assert RentReminder.objects.filter(lease=lease).exists()

    def test_a_property_in_no_portfolio_sends_none(self, landlord, user, unit):
        """A personal property has no subscriber, so it has nobody on Pro.

        This is a real behaviour change for a landlord who holds property
        outside a Portfolio, and it is the same answer the entitlement service
        gives any Portfolio without a subscription.
        """
        from apps.rent.tasks import emit_due_reminders

        lease = self._due_in_7_days(landlord=landlord, tenant=user, unit=unit)

        assert emit_due_reminders()["emitted"] == 0
        assert not RentReminder.objects.filter(lease=lease).exists()

    def test_the_ledger_itself_is_never_gated(self, landlord, user, portfolio):
        """§21: billing may withhold the reminder, never the debt.

        A Free Portfolio's charges are still built, still owed, still visible
        and still payable. Only the automated nudge is paid for.
        """
        _, space = portfolio
        lease = self._due_in_7_days(landlord=landlord, tenant=user, unit=space)

        charges = RentCharge.objects.filter(lease=lease)
        assert charges.exists()
        assert all(charge.outstanding_minor > 0 for charge in charges)


class TestRecordingAPayment:
    def test_either_party_can_record_one(self, landlord, user, unit):
        lease = _active_lease(landlord, user, unit)
        payment = services.record_payment(
            lease=lease,
            user=user,
            data={
                "amount_minor": 900000,
                "paid_on": date.today(),
                "method": "momo",
                "reference": "MP240814.1234.A56789",
            },
        )
        assert payment.status == PaymentStatus.CLAIMED
        assert payment.recorded_by_tenant

    def test_a_stranger_cannot(self, landlord, user, agent, unit):
        lease = _active_lease(landlord, user, unit)
        with pytest.raises(PermissionDenied):
            services.record_payment(
                lease=lease,
                user=agent,
                data={"amount_minor": 1000, "paid_on": date.today()},
            )

    def test_a_future_date_is_refused(self, landlord, user, unit):
        lease = _active_lease(landlord, user, unit)
        with pytest.raises(ValidationFailed):
            services.record_payment(
                lease=lease,
                user=user,
                data={
                    "amount_minor": 1000,
                    "paid_on": timezone.localdate() + timedelta(days=1),
                },
            )


class TestConfirmation:
    def _claimed(self, landlord, tenant, unit):
        lease = _active_lease(landlord, tenant, unit)
        charge = services.build_schedule(lease)[0]
        payment = services.record_payment(
            lease=lease,
            user=tenant,
            data={
                "amount_minor": charge.amount_minor,
                "paid_on": date.today(),
                "charge_id": charge.id,
                "method": "momo",
            },
        )
        return lease, charge, payment

    def test_the_person_who_recorded_it_cannot_confirm_it(self, landlord, user, unit):
        """A receipt is two people agreeing, not one person asserting twice."""
        _, _, payment = self._claimed(landlord, user, unit)
        with pytest.raises(PermissionDenied):
            services.confirm_payment(payment=payment, user=user)

    def test_the_other_party_confirms_and_the_charge_settles(self, landlord, user, unit):
        _, charge, payment = self._claimed(landlord, user, unit)
        payment = services.confirm_payment(payment=payment, user=landlord)

        assert payment.is_confirmed
        charge.refresh_from_db()
        assert charge.status == ChargeStatus.PAID
        assert charge.outstanding_minor == 0

    def test_a_claim_alone_never_settles_a_debt(self, landlord, user, unit):
        """Otherwise either side could clear their own balance by saying so."""
        _, charge, _ = self._claimed(landlord, user, unit)
        charge.refresh_from_db()
        assert charge.status == ChargeStatus.DUE
        assert charge.outstanding_minor == charge.amount_minor

    def test_a_part_payment_leaves_the_rest_outstanding(self, landlord, user, unit):
        lease = _active_lease(landlord, user, unit)
        charge = services.build_schedule(lease)[0]
        payment = services.record_payment(
            lease=lease,
            user=user,
            data={"amount_minor": 300000, "paid_on": date.today(), "charge_id": charge.id},
        )
        services.confirm_payment(payment=payment, user=landlord)

        charge.refresh_from_db()
        assert charge.status == ChargeStatus.PART_PAID
        assert charge.outstanding_minor == charge.amount_minor - 300000

    def test_confirming_twice_is_refused(self, landlord, user, unit):
        _, _, payment = self._claimed(landlord, user, unit)
        services.confirm_payment(payment=payment, user=landlord)
        with pytest.raises(Conflict):
            services.confirm_payment(payment=payment, user=landlord)


class TestExternalProviderPayments:
    def _provider_claim(self, landlord, tenant, unit, **overrides):
        lease = _active_lease(landlord, tenant, unit)
        charge = services.build_schedule(lease)[0]
        data = {
            "amount_minor": charge.amount_minor,
            "paid_on": timezone.localdate(),
            "charge_id": charge.id,
            "method": "cash",
            "reference": "CASH-SEP-01",
            "note": "Received at the Property office",
        }
        data.update(overrides)
        return lease, charge, services.record_payment(lease=lease, user=landlord, data=data)

    def test_provider_recording_is_external_and_does_not_require_a_psp_payout_account(
        self, landlord, user, unit
    ):
        from apps.trust.models import SubjectType, Verification, VerificationKind

        Verification.objects.filter(
            subject_type=SubjectType.USER,
            subject_id=str(landlord.id),
            kind=VerificationKind.BANK_ACCOUNT,
        ).delete()
        _, charge, payment = self._provider_claim(landlord, user, unit)

        assert payment.payment_source == "EXTERNAL"
        assert payment.payment_provider == "NONE"
        assert payment.payment_channel == "CASH"
        assert payment.payment_evidence == "AWAITING_COUNTERPARTY_CONFIRMATION"
        assert payment.lifecycle_status == "AWAITING_TENANT_CONFIRMATION"
        charge.refresh_from_db()
        assert charge.status == ChargeStatus.DUE
        assert charge.amount_paid_minor is None

    def test_provider_external_record_must_name_an_outstanding_obligation(
        self, landlord, user, unit
    ):
        lease = _active_lease(landlord, user, unit)
        with pytest.raises(ValidationFailed, match="Choose the outstanding obligation"):
            services.record_payment(
                lease=lease,
                user=landlord,
                data={"amount_minor": 150000, "paid_on": timezone.localdate(), "method": "cash"},
            )

    def test_tenant_is_notified_and_confirmation_issues_a_non_psp_receipt(
        self, landlord, user, unit
    ):
        from apps.audit.models import AuditLog
        from apps.notifications.models import Notification
        from apps.payments.models import Receipt
        from apps.rent.serializers import RentPaymentSerializer

        lease, charge, payment = self._provider_claim(landlord, user, unit)
        _dispatch()
        notice = Notification.objects.get(user=user, kind="rent.external_payment_recorded")
        assert notice.target_type == "payment"
        assert notice.target_id == str(lease.id)
        assert landlord.display_name in notice.body
        assert "Cash" in notice.body

        payment = services.confirm_payment(payment=payment, user=user)
        charge.refresh_from_db()
        receipt = Receipt.objects.get(rent_record=payment)

        assert charge.status == ChargeStatus.PAID
        assert payment.payment_evidence == "COUNTERPARTY_CONFIRMED"
        assert receipt.transaction_id is None
        assert receipt.breakdown["payment"]["source"] == "EXTERNAL"
        assert receipt.breakdown["evidence"]["status"] == "COUNTERPARTY_CONFIRMED"
        assert bytes(receipt.final_pdf).startswith(b"%PDF")
        payload = RentPaymentSerializer(
            payment,
            context={"request": SimpleNamespace(user=user)},
        ).data
        assert payload["source"] == "EXTERNAL"
        assert payload["provider"] == "NONE"
        assert payload["channel"] == "CASH"
        assert payload["evidence"] == "COUNTERPARTY_CONFIRMED"
        assert payload["receipt_id"] == str(receipt.id)
        assert AuditLog.objects.filter(
            aggregate_type="rent_payment",
            aggregate_id=str(payment.id),
            metadata__evidence="COUNTERPARTY_CONFIRMED",
        ).exists()

    def test_tenant_dispute_preserves_the_claim_and_does_not_issue_a_receipt(
        self, landlord, user, unit
    ):
        from apps.notifications.models import Notification
        from apps.payments.models import Receipt

        _, charge, payment = self._provider_claim(landlord, user, unit)
        payment = services.dispute_payment(
            payment=payment,
            user=user,
            reason="I did not make this cash payment",
        )
        _dispatch()
        charge.refresh_from_db()

        assert payment.payment_evidence == "DISPUTED"
        assert charge.status == ChargeStatus.DUE
        assert not Receipt.objects.filter(rent_record=payment).exists()
        assert Notification.objects.filter(
            user=landlord, kind="rent.external_payment_disputed"
        ).exists()

    def test_private_uploaded_evidence_is_visible_to_both_payment_parties(
        self, landlord, user, unit
    ):
        from apps.files.models import FilePurpose, ScanStatus, StoredFile, UploadStatus
        from apps.files.services import can_read

        stored = StoredFile.objects.create(
            storage_key="payment_evidence/2026/08/provider/cash-proof.png",
            bucket="test",
            storage_backend="local",
            original_filename="cash-proof.png",
            declared_content_type="image/png",
            content_type="image/png",
            size_bytes=128,
            checksum_sha256="a" * 64,
            purpose=FilePurpose.PAYMENT_EVIDENCE,
            is_sensitive=True,
            upload_status=UploadStatus.READY,
            scan_status=ScanStatus.CLEAN,
            uploaded_by=landlord,
            owner_id_snapshot=str(landlord.id),
        )
        _, _, payment = self._provider_claim(landlord, user, unit, evidence_file_id=stored.id)

        assert payment.evidence_file == stored
        assert can_read(user=user, stored=stored)


class TestDispute:
    def test_the_other_party_can_dispute_and_the_claim_survives(self, landlord, user, unit):
        """Disputing never deletes the claim. Both positions stay readable."""
        lease = _active_lease(landlord, user, unit)
        charge = services.build_schedule(lease)[0]
        payment = services.record_payment(
            lease=lease,
            user=user,
            data={
                "amount_minor": charge.amount_minor,
                "paid_on": date.today(),
                "charge_id": charge.id,
            },
        )
        payment = services.dispute_payment(
            payment=payment,
            user=landlord,
            reason="Nothing reached my account",
        )
        assert payment.status == PaymentStatus.DISPUTED
        assert payment.dispute_reason == "Nothing reached my account"

        charge.refresh_from_db()
        assert charge.status == ChargeStatus.DUE

    def test_disputing_a_confirmed_payment_reopens_the_charge(self, landlord, user, unit):
        lease = _active_lease(landlord, user, unit)
        charge = services.build_schedule(lease)[0]
        payment = services.record_payment(
            lease=lease,
            user=user,
            data={
                "amount_minor": charge.amount_minor,
                "paid_on": date.today(),
                "charge_id": charge.id,
            },
        )
        services.confirm_payment(payment=payment, user=landlord)
        services.dispute_payment(payment=payment, user=landlord, reason="Reversed")

        charge.refresh_from_db()
        assert charge.status == ChargeStatus.DUE

    def test_you_cannot_dispute_your_own_record(self, landlord, user, unit):
        lease = _active_lease(landlord, user, unit)
        payment = services.record_payment(
            lease=lease,
            user=user,
            data={"amount_minor": 1000, "paid_on": date.today()},
        )
        with pytest.raises(PermissionDenied):
            services.dispute_payment(payment=payment, user=user)


class TestWaiving:
    def test_only_the_landlord_side_can_forgive_a_debt_after_tenancy_end(
        self, landlord, user, unit
    ):
        lease = _active_lease(landlord, user, unit)
        charge = services.build_schedule(lease)[0]

        with pytest.raises(PermissionDenied):
            services.waive_charge(charge=charge, user=user)

        with pytest.raises(Conflict, match="only after the tenancy has ended"):
            services.waive_charge(charge=charge, user=landlord, reason="Goodwill")
        assert charge.adjustments.count() == 0

        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        _dispatch()
        charge = services.waive_charge(charge=charge, user=landlord, reason="Goodwill")
        assert charge.status == ChargeStatus.WAIVED
        assert charge.outstanding_minor == 0


class TestPostTenancyBalance:
    def _ended(self, landlord, tenant, space):
        lease = _active_lease(
            landlord,
            tenant,
            space,
            advance_months=1,
            deposit_months=1,
            agency_fee_months=1,
            term_months=12,
        )
        charges = services.build_schedule(lease)
        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        _dispatch()
        lease.refresh_from_db()
        return lease, list(RentCharge.objects.filter(id__in=[row.id for row in charges]))

    def test_ended_tenancy_can_have_zero_balance(self, landlord, user, unit):
        lease = _active_lease(landlord, user, unit, advance_months=1, term_months=12)
        charges = services.build_schedule(lease)
        for charge in [row for row in charges if row.due_on <= timezone.localdate()]:
            payment = services.record_payment(
                lease=lease,
                user=user,
                data={
                    "charge_id": charge.id,
                    "amount_minor": charge.amount_minor,
                    "paid_on": timezone.localdate(),
                    "method": "momo",
                },
            )
            services.confirm_payment(payment=payment, user=landlord)
        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        _dispatch()

        assert services.closing_financial_summary(lease=lease)["outstanding_balance_minor"] == 0

    def test_multiple_incurred_obligations_survive_and_are_classified(self, landlord, user, unit):
        lease, charges = self._ended(landlord, user, unit)
        incurred = [row for row in charges if row.status != ChargeStatus.CANCELLED]
        summary = services.closing_financial_summary(lease=lease)

        assert len(incurred) == 3
        assert summary["unpaid_rent_minor"] == 150000
        assert summary["other_charges_minor"] == 300000
        assert summary["outstanding_balance_minor"] == 450000

    def test_payment_after_end_still_settles_the_historical_obligation(self, landlord, user, unit):
        lease, charges = self._ended(landlord, user, unit)
        charge = next(row for row in charges if row.status != ChargeStatus.CANCELLED)
        payment = services.record_payment(
            lease=lease,
            user=user,
            data={
                "charge_id": charge.id,
                "amount_minor": charge.amount_minor,
                "paid_on": timezone.localdate(),
                "method": "bank",
                "reference": "POST-END-001",
            },
        )
        services.confirm_payment(payment=payment, user=landlord)

        charge.refresh_from_db()
        assert charge.status == ChargeStatus.PAID
        assert charge.outstanding_minor == 0

    def test_partial_and_full_waivers_are_additive_and_never_paid(self, landlord, user, unit):
        lease, charges = self._ended(landlord, user, unit)
        charge = next(row for row in charges if row.status != ChargeStatus.CANCELLED)
        original = charge.amount_minor

        services.waive_charge(
            charge=charge,
            user=landlord,
            amount_minor=50000,
            reason="Agreed move-out concession",
        )
        charge.refresh_from_db()
        assert charge.amount_minor == original
        assert charge.status == ChargeStatus.DUE
        assert charge.outstanding_minor == original - 50000

        services.waive_charge(
            charge=charge,
            user=landlord,
            amount_minor=charge.outstanding_minor,
            reason="Release remaining balance",
        )
        charge.refresh_from_db()
        assert charge.status == ChargeStatus.WAIVED
        assert charge.status != ChargeStatus.PAID
        assert charge.adjustments.count() == 2
        assert sum(row.amount_minor for row in charge.adjustments.all()) == original

    def test_write_off_preserves_the_debt_and_actor_history(self, landlord, user, unit):
        from apps.audit.models import AuditLog

        _, charges = self._ended(landlord, user, unit)
        charge = next(row for row in charges if row.status != ChargeStatus.CANCELLED)
        original = charge.amount_minor
        services.write_off_charge(
            charge=charge,
            user=landlord,
            amount_minor=original,
            reason="Collection exhausted",
        )

        charge.refresh_from_db()
        adjustment = ObligationAdjustment.objects.get(obligation=charge)
        assert adjustment.kind == ObligationAdjustmentKind.WRITE_OFF
        assert adjustment.actor == landlord
        assert adjustment.reason == "Collection exhausted"
        assert charge.amount_minor == original
        assert charge.status == ChargeStatus.WRITTEN_OFF
        assert charge.status != ChargeStatus.PAID
        audit = AuditLog.objects.get(
            aggregate_type="rent_obligation_adjustment",
            aggregate_id=str(adjustment.id),
        )
        assert audit.actor == landlord
        assert audit.metadata["non_cash_adjustment"] is True
        adjustment.reason = "Rewritten history"
        with pytest.raises(RuntimeError):
            adjustment.save()
        with pytest.raises(RuntimeError):
            adjustment.delete()

    def test_ordinary_portfolio_staff_cannot_forgive_or_write_off_debt(
        self, landlord, user, agent, portfolio
    ):
        from apps.organization.models import MembershipRole, OrganizationMembership

        organization, space = portfolio
        OrganizationMembership.objects.create(
            organization=organization,
            user=agent,
            role=MembershipRole.STAFF,
            joined_at=timezone.now(),
        )
        _, charges = self._ended(landlord, user, space)
        charge = next(row for row in charges if row.status != ChargeStatus.CANCELLED)

        with pytest.raises(PermissionDenied):
            services.waive_charge(
                charge=charge, user=agent, amount_minor=1000, reason="Not mine to waive"
            )
        with pytest.raises(PermissionDenied):
            services.write_off_charge(
                charge=charge, user=agent, amount_minor=1000, reason="Not mine to write off"
            )

    def test_dispute_and_claim_survive_the_tenancy_end(self, landlord, user, unit):
        lease, charges = self._ended(landlord, user, unit)
        charge = next(row for row in charges if row.status != ChargeStatus.CANCELLED)
        payment = services.record_payment(
            lease=lease,
            user=user,
            data={
                "charge_id": charge.id,
                "amount_minor": 10000,
                "paid_on": timezone.localdate(),
                "method": "cash",
            },
        )
        services.dispute_payment(payment=payment, user=landlord, reason="Cash was not received")
        charge.refresh_from_db()

        assert charge.has_dispute
        assert charge.effective_status == "disputed"
        assert charge.outstanding_minor == charge.amount_minor

    def test_live_refund_credit_survives_end_and_reduces_net_closing_position(
        self, landlord, user, unit
    ):
        from apps.payments.models import (
            IntentStatus,
            PaymentIntent,
            PaymentTransaction,
            Refund,
            RefundStatus,
            TransactionStatus,
        )

        lease, charges = self._ended(landlord, user, unit)
        charge = next(row for row in charges if row.status != ChargeStatus.CANCELLED)
        intent = PaymentIntent.objects.create(
            tenant=user,
            lease=lease,
            obligation=charge,
            amount_minor=50000,
            amount_currency="GHS",
            status=IntentStatus.SUCCEEDED,
            payment_method="mobile_money",
            provider="memory",
            client_reference="post_end_credit",
            provider_reference="post_end_credit_provider",
            expires_at=timezone.now() + timedelta(hours=1),
        )
        transaction = PaymentTransaction.objects.create(
            intent=intent,
            provider="memory",
            provider_transaction_id="post_end_credit_txn",
            amount_minor=50000,
            amount_currency="GHS",
            payment_method="mobile_money",
            status=TransactionStatus.SUCCEEDED,
            paid_at=timezone.now(),
            raw_provider_status="success",
        )
        Refund.objects.create(
            transaction=transaction,
            amount_minor=10000,
            amount_currency="GHS",
            reason="Tenant credit after close-out review",
            status=RefundStatus.APPROVED,
            requested_by=landlord,
            decided_by=landlord,
            decided_at=timezone.now(),
        )

        summary = services.closing_financial_summary(lease=lease)
        assert summary["credits_minor"] == 10000
        assert summary["outstanding_balance_minor"] == 440000

    def test_an_ended_lease_cannot_generate_a_new_schedule(self, landlord, user, unit):
        lease, _ = self._ended(landlord, user, unit)
        RentCharge.objects.filter(lease=lease).delete()
        with pytest.raises(Conflict):
            services.build_schedule(lease)

    def test_a_contract_past_its_end_cannot_generate_late_obligations(self, landlord, user, unit):
        lease = _active_lease(
            landlord,
            user,
            unit,
            starts_on=timezone.localdate() - timedelta(days=400),
            advance_months=1,
            term_months=12,
        )
        assert lease.ends_on < timezone.localdate()
        with pytest.raises(Conflict):
            services.build_schedule(lease)

    def test_an_active_future_period_cannot_be_waived_and_is_cancelled_on_end(
        self, landlord, user, unit
    ):
        lease = _active_lease(landlord, user, unit, advance_months=1, term_months=12)
        future = next(
            row for row in services.build_schedule(lease) if row.due_on > timezone.localdate()
        )
        with pytest.raises(Conflict, match="only after the tenancy has ended"):
            services.waive_charge(
                charge=future,
                user=landlord,
                amount_minor=1000,
                reason="Early provisional concession",
            )
        assert future.adjustments.count() == 0

        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        _dispatch()
        future.refresh_from_db()

        assert future.status == ChargeStatus.CANCELLED
        assert future.outstanding_minor == 0


def _canonical_lease(landlord, tenant, space, **overrides):
    """A guided-workflow lease, carried all the way to active."""
    terms = {
        "rent_minor": 150000,
        "advance_months": 1,
        "deposit_months": 1,
        "agency_fee_months": 0,
        "starts_on": date.today(),
        "term_months": 12,
        "workflow_version": "canonical_v1",
        "structured_terms": {
            "utilities": {"water": "included"},
            "provider_responsibilities": ["structural_repairs"],
            "tenant_responsibilities": ["routine_cleaning"],
        },
    }
    terms.update(overrides)
    lease = lease_services.draft_lease(user=landlord, unit=space, tenant=tenant, data=terms)
    return _accept_and_confirm(lease, landlord, tenant)


def _accept_and_confirm(lease, landlord, tenant):
    """Ready, send, review, accept, confirm — the whole canonical path."""
    lease = lease_services.ready_lease(lease=lease, user=landlord)
    lease = lease_services.offer_lease(lease=lease, user=landlord)
    lease_services.record_tenant_review(lease=lease, user=tenant)
    lease = lease_services.accept_lease(lease=lease, user=tenant, acknowledged=True)
    return lease_services.confirm_lease(lease=lease, user=landlord)


def _dispatch():
    """Run the outbox the way the worker does."""
    from apps.outbox.tasks import dispatch_pending

    dispatch_pending()


def _settle(lease):
    """Let the schedule be built by the event that builds it in production."""
    _dispatch()
    return list(RentCharge.objects.filter(lease=lease))


class TestWhatTheProviderIsToldTheyAreOwed:
    """The three figures on the payments page: received, outstanding, overdue.

    They are the closest thing the product has to a financial statement, so a
    figure that includes money nobody owes is worse than showing no figure.
    """

    def _money(self, landlord, organization):
        from apps.organization import services as organization_services

        return organization_services.portfolio_summary(organization=organization, user=landlord)[
            "money"
        ]

    def test_portfolio_collection_series_uses_confirmed_payments_and_current_obligations(
        self, landlord, user, portfolio
    ):
        from apps.organization import services as organization_services

        organization, space = portfolio
        lease = _canonical_lease(landlord, user, space)
        charges = _settle(lease)
        charge = next(row for row in charges if row.outstanding_minor > 0)
        amount = min(50000, charge.outstanding_minor)
        payment = services.record_payment(
            lease=lease,
            user=user,
            data={
                "charge_id": charge.id,
                "amount_minor": amount,
                "paid_on": timezone.localdate(),
                "method": "momo",
            },
        )

        # A claim is not collection. Only the provider's confirmation moves it
        # into the dashboard's authoritative series.
        before = organization_services.portfolio_summary(
            organization=organization,
            user=landlord,
        )["rent_collection"]
        current_month = timezone.localdate().strftime("%Y-%m")
        assert (
            next(row for row in before["monthly"] if row["period"] == current_month)[
                "collected_minor"
            ]
            == 0
        )

        services.confirm_payment(payment=payment, user=landlord)
        collection = organization_services.portfolio_summary(
            organization=organization,
            user=landlord,
        )["rent_collection"]

        assert collection["currency"] == "GHS"
        assert len(collection["monthly"]) == 12
        assert len(collection["yearly"]) == 6
        assert (
            next(row for row in collection["monthly"] if row["period"] == current_month)[
                "collected_minor"
            ]
            == amount
        )
        assert (
            next(
                row
                for row in collection["yearly"]
                if row["period"] == str(timezone.localdate().year)
            )["collected_minor"]
            == amount
        )

    def test_a_cancelled_charge_can_never_be_late(self, landlord, user, portfolio):
        """A month nobody lived through cannot be overdue.

        Cancelling only removes a charge from `outstanding`. If it is not also
        *settled*, a past-dated cancelled charge keeps ageing, and the provider
        is shown an overdue balance for a period the agreement itself replaced.
        Superseding is where this bites, because it closes past-due charges too.
        """
        organization, space = portfolio
        started = date.today() - timedelta(days=200)
        lease = _canonical_lease(landlord, user, space, starts_on=started)
        _settle(lease)
        assert self._money(landlord, organization)["overdue_minor"] > 0

        amendment = lease_services.amend_lease(
            lease=lease, user=landlord, data={"rent_minor": 160000}
        )
        _accept_and_confirm(amendment, landlord, user)
        _dispatch()

        superseded = RentCharge.objects.filter(
            lease=lease, status=ChargeStatus.CANCELLED, due_on__lt=timezone.localdate()
        )
        assert superseded.exists(), "the scenario no longer produces a past-dated closure"
        assert not any(charge.is_overdue for charge in superseded)

        owed_now = RentCharge.objects.filter(lease=amendment)
        assert self._money(landlord, organization)["overdue_minor"] == sum(
            charge.outstanding_minor for charge in owed_now if charge.is_overdue
        )

    def test_a_part_paid_charge_survives_the_tenancy_ending(self, landlord, user, portfolio):
        """Money that changed hands is never swept away by a lifecycle event.

        Closing the unrun remainder must not touch a charge somebody has paid
        into: the balance on it is real, the payment against it is evidence,
        and cancelling it would erase both.
        """
        _, space = portfolio
        lease = _active_lease(landlord, user, space, advance_months=1, term_months=12)
        _settle(lease)
        charge = (
            RentCharge.objects.filter(lease=lease, due_on__gt=timezone.localdate())
            .order_by("due_on")
            .first()
        )
        assert charge is not None

        payment = services.record_payment(
            lease=lease,
            user=user,
            data={
                "amount_minor": charge.amount_minor // 3,
                "paid_on": date.today(),
                "charge_id": charge.id,
                "method": "momo",
            },
        )
        services.confirm_payment(payment=payment, user=landlord)

        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        _dispatch()

        charge.refresh_from_db()
        assert (
            charge.status != ChargeStatus.CANCELLED
        ), "a charge with money against it was swept away"
        assert charge.outstanding_minor > 0

    def test_ending_a_tenancy_stops_billing_for_months_nobody_will_live_there(
        self, landlord, user, portfolio
    ):
        """A tenancy ended in month three does not leave nine months owing.

        The schedule is written in full the moment a tenancy goes live, because
        that is when the term is known. One that stops early therefore leaves
        the rest of its year sitting in the database marked `due`, ageing into
        "overdue" on the provider's dashboard for a room somebody has already
        moved out of.

        What survives is only what had genuinely fallen due — see the arrears
        test below, which is the other half of the same rule.
        """
        organization, space = portfolio
        lease = _active_lease(landlord, user, space, advance_months=1, term_months=12)
        _settle(lease)
        before = self._money(landlord, organization)["outstanding_minor"]

        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        _dispatch()

        arrears = sum(
            charge.outstanding_minor
            for charge in RentCharge.objects.filter(lease=lease, due_on__lte=timezone.localdate())
        )
        money = self._money(landlord, organization)
        assert (
            money["outstanding_minor"] == arrears
        ), "an ended tenancy is still being billed for months it will not run"
        assert money["outstanding_minor"] < before
        # Nothing in the future can be late.
        assert money["overdue_minor"] == 0

    def test_the_charges_of_a_finished_tenancy_are_closed_not_deleted(
        self, landlord, user, portfolio
    ):
        """Closing is not forgetting.

        The unrun remainder is marked closed rather than removed: the tenancy
        happened, and its record is the tenant's evidence as much as the
        provider's.
        """
        _, space = portfolio
        lease = _active_lease(landlord, user, space, advance_months=1, term_months=12)
        built = _settle(lease)
        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        _dispatch()

        remaining = RentCharge.objects.filter(lease=lease)
        assert remaining.count() == len(built), "charges were deleted rather than closed"
        assert remaining.filter(status=ChargeStatus.CANCELLED).exists()
        # Nothing still expected for a period that will never be lived through.
        assert not remaining.filter(
            status__in=[ChargeStatus.DUE, ChargeStatus.PART_PAID],
            due_on__gt=timezone.localdate(),
        ).exists()

    def test_arrears_left_behind_are_still_owed(self, landlord, user, portfolio):
        """A tenant who left owing two months still owes them.

        Only the *unrun* remainder is closed. A charge whose due date had
        already passed is a real debt, and clearing it because the tenancy
        ended would quietly forgive it.
        """
        _, space = portfolio
        lease = _active_lease(landlord, user, space, advance_months=1, term_months=12)
        _settle(lease)
        already_due = RentCharge.objects.filter(
            lease=lease, due_on__lte=timezone.localdate()
        ).count()
        assert already_due, "the fixture no longer produces a charge that has come due"

        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        _dispatch()

        still_owed = RentCharge.objects.filter(
            lease=lease, status__in=[ChargeStatus.DUE, ChargeStatus.PART_PAID]
        )
        assert still_owed.count() == already_due

    def test_a_re_let_unit_does_not_inherit_the_last_tenants_balance(
        self, landlord, user, agent, portfolio
    ):
        """The case that surfaced this: the same room, let twice.

        The portfolio read collected every lease that had ever touched a Unit,
        so the moment a room was re-let the previous tenancy's charges were
        added to the current figures.
        """
        organization, space = portfolio
        first = _active_lease(landlord, user, space, advance_months=1, term_months=12)
        _settle(first)
        lease_services.end_lease(lease=first, user=landlord, confirmed=True)
        _dispatch()

        second = _active_lease(landlord, agent, space, advance_months=1, term_months=12)
        _settle(second)

        owed_by_the_new_tenant = sum(
            charge.outstanding_minor for charge in RentCharge.objects.filter(lease=second)
        )
        left_behind = sum(
            charge.outstanding_minor for charge in RentCharge.objects.filter(lease=first)
        )
        # The old tenancy contributes only what it actually left unpaid, never
        # the remainder of a term nobody is living out.
        assert left_behind < owed_by_the_new_tenant
        assert (
            self._money(landlord, organization)["outstanding_minor"]
            == owed_by_the_new_tenant + left_behind
        )

    def test_an_amendment_does_not_double_what_is_owed(self, landlord, user, portfolio):
        """A superseded agreement and its replacement both have a schedule.

        Counting both bills the tenant twice for one tenancy — the same defect
        as the re-let case wearing different clothes.
        """
        organization, space = portfolio
        terms = {
            "rent_minor": 150000,
            "advance_months": 1,
            "deposit_months": 1,
            "agency_fee_months": 0,
            "starts_on": date.today(),
            "term_months": 12,
            "workflow_version": "canonical_v1",
            "structured_terms": {
                "utilities": {"water": "included"},
                "provider_responsibilities": ["structural_repairs"],
                "tenant_responsibilities": ["routine_cleaning"],
            },
        }
        lease = lease_services.draft_lease(user=landlord, unit=space, tenant=user, data=terms)
        lease = lease_services.ready_lease(lease=lease, user=landlord)
        lease = lease_services.offer_lease(lease=lease, user=landlord)
        lease_services.record_tenant_review(lease=lease, user=user)
        lease = lease_services.accept_lease(lease=lease, user=user, acknowledged=True)
        lease = lease_services.confirm_lease(lease=lease, user=landlord)
        _settle(lease)

        amendment = lease_services.amend_lease(
            lease=lease, user=landlord, data={"rent_minor": 160000}
        )
        amendment = lease_services.ready_lease(lease=amendment, user=landlord)
        amendment = lease_services.offer_lease(lease=amendment, user=landlord)
        lease_services.record_tenant_review(lease=amendment, user=user)
        amendment = lease_services.accept_lease(lease=amendment, user=user, acknowledged=True)
        amendment = lease_services.confirm_lease(lease=amendment, user=landlord)
        _dispatch()
        _settle(amendment)

        owed_under_the_amendment = sum(
            charge.outstanding_minor for charge in RentCharge.objects.filter(lease=amendment)
        )
        assert (
            self._money(landlord, organization)["outstanding_minor"] == owed_under_the_amendment
        ), "the superseded agreement is still being counted"


class TestRentalHistory:
    def test_it_counts_only_confirmed_payments(self, landlord, user, unit):
        """A record padded with one-sided claims is worth what the claims are."""
        lease = _active_lease(landlord, user, unit)
        charge = services.build_schedule(lease)[0]

        claimed = services.record_payment(
            lease=lease,
            user=user,
            data={"amount_minor": 100000, "paid_on": date.today(), "charge_id": charge.id},
        )
        history = services.rental_history(user=user)
        assert history["payments_confirmed"] == 0
        assert history["total_confirmed_minor"] == 0

        services.confirm_payment(payment=claimed, user=landlord)
        history = services.rental_history(user=user)
        assert history["payments_confirmed"] == 1
        assert history["total_confirmed_minor"] == 100000

    def test_it_distinguishes_on_time_from_late(self, landlord, user, unit):
        lease = _active_lease(landlord, user, unit)
        charge = services.build_schedule(lease)[0]
        payment = services.record_payment(
            lease=lease,
            user=user,
            data={
                "amount_minor": charge.amount_minor,
                "paid_on": charge.due_on,
                "charge_id": charge.id,
            },
        )
        services.confirm_payment(payment=payment, user=landlord)

        history = services.rental_history(user=user)
        assert history["charges_settled_on_time"] == 1
        assert history["charges_settled_late"] == 0

    def test_it_reports_what_is_still_owed(self, landlord, user, unit):
        lease = _active_lease(landlord, user, unit)
        charges = services.build_schedule(lease)
        total = sum(c.amount_minor for c in charges)

        history = services.rental_history(user=user)
        assert history["outstanding_minor"] == total
        assert history["tenancies_total"] == 1
        assert history["tenancies_active"] == 1


class TestApi:
    @pytest.fixture
    def signed_in(self, sms, sign_in_as):
        def _sign_in(person, label):
            client = APIClient()
            sign_in_as(client, user=person, device_fingerprint=label)
            return client

        return _sign_in

    def test_record_then_confirm_over_http(self, signed_in, landlord, user, unit):
        lease = _active_lease(landlord, user, unit)
        services.build_schedule(lease)

        tenant_api = signed_in(user, "t")
        host_api = signed_in(landlord, "h")

        schedule = tenant_api.get(f"/api/v1/leases/{lease.id}/charges/")
        assert schedule.status_code == 200
        advance = next(c for c in schedule.data["charges"] if c["kind"] == "advance")
        assert advance["outstanding_formatted"]

        recorded = tenant_api.post(
            "/api/v1/rent/payments/",
            {
                "lease_id": str(lease.id),
                "charge_id": advance["id"],
                "amount_minor": advance["amount_minor"],
                "paid_on": str(date.today()),
                "method": "momo",
                "reference": "MP240814.1234.A56789",
            },
            format="json",
        )
        assert recorded.status_code == 201, recorded.data
        assert recorded.data["status"] == "claimed"

        # The landlord sees it as needing their answer; the tenant does not.
        host_view = host_api.get(f"/api/v1/leases/{lease.id}/charges/")
        assert host_view.data["payments"][0]["awaiting_you"] is True
        tenant_view = tenant_api.get(f"/api/v1/leases/{lease.id}/charges/")
        assert tenant_view.data["payments"][0]["awaiting_you"] is False

        confirmed = host_api.post(
            f"/api/v1/rent/payments/{recorded.data['id']}/confirm/", {}, format="json"
        )
        assert confirmed.data["status"] == "confirmed"

        history = tenant_api.get("/api/v1/me/rental-history/")
        assert history.data["payments_confirmed"] == 1
        assert history.data["total_confirmed_formatted"]

    def test_a_stranger_cannot_see_a_tenancys_money(self, signed_in, landlord, user, agent, unit):
        lease = _active_lease(landlord, user, unit)
        stranger = signed_in(agent, "s")
        response = stranger.get(f"/api/v1/leases/{lease.id}/charges/")
        assert response.status_code in (403, 404)


class TestPostTenancyApi:
    @pytest.fixture
    def signed_in(self, sms, sign_in_as):
        def _sign_in(person, label):
            client = APIClient()
            sign_in_as(client, user=person, device_fingerprint=label)
            return client

        return _sign_in

    def _ended(self, landlord, tenant, unit):
        lease = _active_lease(landlord, tenant, unit, advance_months=1, term_months=12)
        charges = services.build_schedule(lease)
        lease_services.end_lease(lease=lease, user=landlord, confirmed=True)
        _dispatch()
        return lease, next(
            row
            for row in RentCharge.objects.filter(id__in=[item.id for item in charges])
            if row.status != ChargeStatus.CANCELLED
        )

    def test_active_tenancy_hides_and_rejects_waiver_and_write_off(
        self, signed_in, landlord, user, unit
    ):
        lease = _active_lease(landlord, user, unit, advance_months=1, term_months=12)
        charge = services.build_schedule(lease)[0]
        provider_api = signed_in(landlord, "provider-active-adjustment")

        ledger = provider_api.get(f"/api/v1/leases/{lease.id}/charges/")
        assert ledger.status_code == 200
        assert ledger.data["permissions"]["waive"] is False
        assert ledger.data["permissions"]["write_off"] is False

        for action in ("waive", "write-off"):
            refused = provider_api.post(
                f"/api/v1/rent/charges/{charge.id}/{action}/",
                {"amount_minor": 10000, "reason": "Not during tenancy", "confirmed": True},
                format="json",
            )
            assert refused.status_code == 409
            assert "only after the tenancy has ended" in refused.data["error"]["message"]
        assert charge.adjustments.count() == 0

    def test_adjustment_endpoint_requires_confirmation_amount_reason_and_authority(
        self, signed_in, landlord, user, unit
    ):
        lease, charge = self._ended(landlord, user, unit)
        tenant_api = signed_in(user, "tenant-post-end")
        refused = tenant_api.post(
            f"/api/v1/rent/charges/{charge.id}/waive/",
            {"amount_minor": 10000, "reason": "Self waiver", "confirmed": True},
            format="json",
        )
        assert refused.status_code == 403

        provider_api = signed_in(landlord, "provider-post-end")
        missing_confirmation = provider_api.post(
            f"/api/v1/rent/charges/{charge.id}/write-off/",
            {"amount_minor": 10000, "reason": "Collection review", "confirmed": False},
            format="json",
        )
        assert missing_confirmation.status_code == 422

        adjusted = provider_api.post(
            f"/api/v1/rent/charges/{charge.id}/write-off/",
            {"amount_minor": 10000, "reason": "Collection review", "confirmed": True},
            format="json",
        )
        assert adjusted.status_code == 200
        assert adjusted.data["amount_minor"] == charge.amount_minor
        assert adjusted.data["written_off_minor"] == 10000
        assert adjusted.data["status"] == ChargeStatus.DUE
        assert adjusted.data["adjustments"][0]["actor_name"] == landlord.display_name

        ledger = provider_api.get(f"/api/v1/leases/{lease.id}/charges/")
        assert ledger.status_code == 200
        assert ledger.data["context"]["lease_status"] == "ended"
        assert ledger.data["permissions"]["write_off"] is True
        assert ledger.data["financial_summary"]["written_off_minor"] == 10000

    def test_tenant_payment_portfolio_can_explicitly_include_ended_accounts(
        self, signed_in, landlord, user, unit
    ):
        lease, _ = self._ended(landlord, user, unit)
        api = signed_in(user, "tenant-ended-portfolio")

        assert all(
            row["lease"]["id"] != str(lease.id)
            for row in api.get("/api/v1/me/tenancies/").data
            if row["lease"]
        )
        included = api.get("/api/v1/me/tenancies/?include_ended=1")
        assert included.status_code == 200
        account = next(row for row in included.data if row["lease"]["id"] == str(lease.id))
        assert account["status"] == "ended"
        assert account["rent"]["outstanding_count"] > 0
