import base64
import csv
import io
from datetime import date, datetime
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.organization.tax_reports import (
    RentTaxReportSerializer,
    collect_rental_report,
    render_schedule,
)
from apps.rent.models import PaymentStatus, PropertyExpense, RentCharge, RentPayment

from .test_rent import _active_lease
from .test_rent import address as address
from .test_rent import portfolio as portfolio

__all__ = ["address", "portfolio"]

pytestmark = pytest.mark.django_db


def report_input(**extra):
    return {
        "period_start": "2026-01-01",
        "period_end": "2026-12-31",
        "taxpayer_type": "individual",
        "taxpayer_name": "Example Landlord",
        "taxpayer_tin": "",
        "tax_office": "",
        **extra,
    }


@pytest.mark.parametrize("kind", ["individual", "business"])
def test_report_separates_rent_deposits_and_unallocated_money(
    portfolio,
    landlord,
    user,
    sign_in_as,
    kind,
):
    organization, unit = portfolio
    lease = _active_lease(landlord, user, unit, starts_on=date(2026, 1, 1))
    advance = RentCharge.objects.create(
        lease=lease,
        kind="advance",
        amount_minor=100000,
        amount_currency="GHS",
        due_on=date(2026, 1, 1),
        period_start=date(2026, 1, 1),
        period_end=date(2026, 6, 30),
    )
    deposit = RentCharge.objects.create(
        lease=lease,
        kind="deposit",
        amount_minor=10000,
        amount_currency="GHS",
        due_on=date(2026, 1, 1),
    )
    for charge, minor, status in [
        (advance, 100000, "confirmed"),
        (deposit, 10000, "confirmed"),
        (None, 5000, "confirmed"),
        (advance, 90000, "claimed"),
    ]:
        RentPayment.objects.create(
            lease=lease,
            charge=charge,
            amount_minor=minor,
            amount_currency="GHS",
            paid_on=date(2026, 1, 5),
            method="cash",
            status=status,
            recorded_by=landlord,
            reference="=HYPERLINK(unsafe)",
        )
    PropertyExpense.objects.create(
        organization=organization,
        property=unit.property,
        amount_minor=2000,
        amount_currency="GHS",
        incurred_on=date(2026, 2, 1),
        category="maintenance",
        recorded_by=landlord,
        note="Repair",
    )
    api = APIClient()
    sign_in_as(api, user=landlord)
    response = api.post(
        f"/api/v1/organizations/{organization.id}/finance/rent-tax-report/",
        report_input(taxpayer_type=kind),
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response["Cache-Control"] == "private, no-store"
    rows = list(csv.reader(io.StringIO(response.data["csv"].lstrip("\ufeff"))))
    summary = next(row for row in rows if row and row[0] == "GHS")
    assert summary[1:] == ["1000.00", "0.00", "150.00", "0.00", "20.00", "0.00", "980.00"]
    assert ["Taxpayer type", kind] in rows
    assert ["Tax payable", "Not calculated"] in rows
    assert "'=HYPERLINK(unsafe)" in response.data["csv"]
    assert "900.00" not in response.data["csv"]


def test_report_requires_membership_and_valid_period(portfolio, landlord, user, sign_in_as):
    organization, _ = portfolio
    api = APIClient()
    url = f"/api/v1/organizations/{organization.id}/finance/rent-tax-report/"
    assert api.post(url, report_input(), format="json").status_code == 401
    sign_in_as(api, user=user)
    assert api.post(url, report_input(), format="json").status_code in (403, 404)
    sign_in_as(api, user=landlord)
    for invalid in [
        report_input(period_end="2025-01-01"),
        report_input(period_end="2030-01-01"),
        report_input(taxpayer_type="other"),
        report_input(taxpayer_name=""),
    ]:
        assert api.post(url, invalid, format="json").status_code in (400, 422)


def test_report_includes_historical_archived_property_and_inactive_unit(
    portfolio,
    landlord,
    user,
    sign_in_as,
):
    organization, unit = portfolio
    lease = _active_lease(landlord, user, unit, starts_on=date(2026, 1, 1))
    charge = RentCharge.objects.create(
        lease=lease,
        kind="rent",
        amount_minor=12345,
        amount_currency="USD",
        due_on=date(2026, 1, 1),
    )
    RentPayment.objects.create(
        lease=lease,
        charge=charge,
        amount_minor=12345,
        amount_currency="USD",
        paid_on=date(2026, 1, 2),
        method="cash",
        status=PaymentStatus.CONFIRMED,
        recorded_by=landlord,
    )
    from apps.property.models import Property, Unit

    Unit.objects.filter(pk=unit.pk).update(is_active=False)
    Property.all_objects.filter(pk=unit.property_id).update(deleted_at=timezone.now())
    api = APIClient()
    sign_in_as(api, user=landlord)
    response = api.post(
        f"/api/v1/organizations/{organization.id}/finance/rent-tax-report/",
        report_input(),
        format="json",
    )
    assert response.status_code == 200, response.data
    assert "123.45" in response.data["csv"]
    assert "USD" in response.data["csv"]


def test_csv_preserves_refunds_and_currency_separation_without_inventing_tax_credits():
    output = render_schedule(
        identity=report_input(taxpayer_name="\t=unsafe"),
        organization_name="Portfolio",
        receipts=[
            {"currency": "GHS", "minor": 30000, "is_rent": True, "detail": []},
            {"currency": "USD", "minor": 123, "is_rent": True, "detail": []},
        ],
        refunds=[{"currency": "GHS", "minor": 5000, "is_rent": True, "detail": []}],
        expenses=[],
        fees=[{"currency": "GHS", "minor": 1000, "detail": []}],
    )
    rows = list(csv.reader(io.StringIO(output.lstrip("\ufeff"))))
    assert next(row for row in rows if row and row[0] == "GHS")[1:] == [
        "300.00",
        "50.00",
        "0.00",
        "0.00",
        "0.00",
        "10.00",
        "240.00",
    ]
    assert next(row for row in rows if row and row[0] == "USD")[1] == "1.23"
    assert "'\t=unsafe" in output
    assert "Not recorded" in output


def test_period_supports_leap_year_and_business_fiscal_year():
    for start, end in [("2024-01-01", "2024-12-31"), ("2025-04-01", "2026-03-31")]:
        serializer = RentTaxReportSerializer(data=report_input(period_start=start, period_end=end))
        assert serializer.is_valid(), serializer.errors


def test_pdf_has_actual_income_expenses_and_adjusted_outstanding(
    portfolio, landlord, user, sign_in_as, tmp_path
):
    from apps.organization import financial_pdf
    from apps.rent.models import ObligationAdjustment

    organization, unit = portfolio
    lease = _active_lease(landlord, user, unit, starts_on=date(2026, 1, 1))
    charge = RentCharge.objects.create(
        lease=lease,
        kind="rent",
        amount_minor=110000,
        amount_currency="GHS",
        amount_paid_minor=100000,
        amount_paid_currency="GHS",
        status="part_paid",
        due_on=date(2026, 1, 1),
    )
    RentPayment.objects.create(
        lease=lease,
        charge=charge,
        amount_minor=100000,
        amount_currency="GHS",
        paid_on=date(2026, 1, 1),
        method="cash",
        status="confirmed",
        recorded_by=landlord,
    )
    ObligationAdjustment.objects.create(
        obligation=charge,
        kind="waiver",
        amount_minor=3000,
        amount_currency="GHS",
        reason="Agreed waiver",
        actor=landlord,
        effective_at=timezone.now(),
    )
    PropertyExpense.objects.create(
        organization=organization,
        property=unit.property,
        amount_minor=2000,
        amount_currency="GHS",
        incurred_on=date(2026, 2, 1),
        category="maintenance",
        recorded_by=landlord,
    )
    RentCharge.objects.create(
        lease=lease,
        kind="rent",
        amount_minor=999999,
        amount_currency="GHS",
        status="cancelled",
        due_on=date(2026, 1, 1),
    )
    api = APIClient()
    sign_in_as(api, user=landlord)
    with patch.object(financial_pdf, "Paragraph", wraps=financial_pdf.Paragraph) as paragraphs:
        response = api.post(
            f"/api/v1/organizations/{organization.id}/finance/rent-tax-report/",
            report_input(format="pdf", property_id=str(unit.property_id)),
            format="json",
        )
    assert response.status_code == 200, response.data
    assert response["Cache-Control"] == "private, no-store"
    assert response.data["mime_type"] == "application/pdf"
    assert response.data["filename"].endswith(".pdf")
    assert base64.b64decode(response.data["pdf_base64"]).startswith(b"%PDF-")
    (tmp_path / "financial-positive-test.pdf").write_bytes(
        base64.b64decode(response.data["pdf_base64"])
    )
    texts = [str(call.args[0]) for call in paragraphs.call_args_list]
    assert unit.property.title in texts
    assert "1,000.00" in texts and "20.00" in texts and "980.00" in texts
    assert "70.00" in texts
    assert "9,999.99" not in texts
    assert "Net rental income / (loss)" in texts
    assert any("Reporting period: 01 Jan 2026 to 31 Dec 2026" in text for text in texts)


def test_property_filter_obeys_financial_scope(portfolio, landlord, user, sign_in_as):
    from uuid import uuid4

    organization, _ = portfolio
    api = APIClient()
    sign_in_as(api, user=landlord)
    response = api.post(
        f"/api/v1/organizations/{organization.id}/finance/rent-tax-report/",
        report_input(format="pdf", property_id=str(uuid4())),
        format="json",
    )
    assert response.status_code == 404


def test_pdf_paginates_long_platform_records(portfolio, landlord, user, tmp_path):
    from datetime import timedelta

    from apps.organization.financial_pdf import render_financial_pdf

    organization, unit = portfolio
    lease = _active_lease(landlord, user, unit, starts_on=date(2026, 1, 1))
    for index in range(45):
        RentCharge.objects.create(
            lease=lease,
            kind="rent",
            amount_minor=10000 + index,
            amount_currency="GHS",
            due_on=date(2026, 1, 1) + timedelta(days=index),
        )
    unit.property.title = "Long property title & courtyard " * 3
    unit.property.save(update_fields=["title"])
    unit.label = "A long unit name for layout review"
    unit.save(update_fields=["label"])
    RentPayment.objects.create(
        lease=lease,
        amount_minor=50000,
        amount_currency="GHS",
        paid_on=date(2026, 1, 2),
        method="cash",
        status="confirmed",
        recorded_by=landlord,
    )
    PropertyExpense.objects.create(
        organization=organization,
        property=unit.property,
        amount_minor=4500,
        amount_currency="GHS",
        incurred_on=date(2026, 1, 3),
        category="maintenance",
        recorded_by=landlord,
    )
    serializer = RentTaxReportSerializer(data=report_input(format="pdf"))
    assert serializer.is_valid(), serializer.errors
    records = collect_rental_report(
        organization=organization, user=landlord, identity=serializer.validated_data
    )
    pdf = render_financial_pdf(records)
    assert pdf.startswith(b"%PDF-")
    assert pdf.count(b"/Type /Page\n") > 1
    (tmp_path / "financial-layout-test.pdf").write_bytes(pdf)


def test_staff_report_excludes_unassigned_properties(portfolio, landlord, user, sign_in_as):
    from apps.organization.models import OrganizationMembership, PropertyAssignment

    organization, unit = portfolio
    membership = OrganizationMembership.objects.create(
        organization=organization,
        user=user,
        role="staff",
        joined_at=timezone.now(),
    )
    PropertyExpense.objects.create(
        organization=organization,
        property=unit.property,
        amount_minor=4321,
        amount_currency="GHS",
        incurred_on=date(2026, 1, 1),
        category="other",
        recorded_by=landlord,
    )
    api = APIClient()
    sign_in_as(api, user=user)
    url = f"/api/v1/organizations/{organization.id}/finance/rent-tax-report/"
    before = api.post(url, report_input(), format="json")
    assert before.status_code == 200, before.data
    assert "43.21" not in before.data["csv"]
    PropertyAssignment.objects.create(membership=membership, property=unit.property)
    after = api.post(url, report_input(), format="json")
    assert "43.21" in after.data["csv"]


def test_only_completed_refunds_and_settled_fees_are_exported(
    portfolio,
    landlord,
    user,
    sign_in_as,
):
    from apps.payments.models import PaymentIntent, PaymentTransaction, Refund, Settlement

    organization, unit = portfolio
    lease = _active_lease(landlord, user, unit, starts_on=date(2026, 1, 1))
    charge = RentCharge.objects.create(
        lease=lease,
        kind="rent",
        amount_minor=10000,
        amount_currency="GHS",
        due_on=date(2026, 1, 1),
    )
    payment = RentPayment.objects.create(
        lease=lease,
        charge=charge,
        amount_minor=10000,
        amount_currency="GHS",
        paid_on=date(2026, 1, 5),
        method="cash",
        status="confirmed",
        recorded_by=landlord,
    )
    intent = PaymentIntent.objects.create(
        lease=lease,
        tenant=user,
        obligation=charge,
        amount_minor=10000,
        amount_currency="GHS",
        status="succeeded",
        payment_method="momo",
        provider="test",
        client_reference="report-test",
        expires_at=timezone.now(),
    )
    transaction = PaymentTransaction.objects.create(
        intent=intent,
        rent_record=payment,
        provider="test",
        provider_transaction_id="report-test",
        amount_minor=10000,
        amount_currency="GHS",
        payment_method="momo",
        status="succeeded",
    )
    Refund.objects.create(
        transaction=transaction,
        amount_minor=1000,
        amount_currency="GHS",
        requested_by=landlord,
        status="completed",
        reason="Partial refund",
    )
    Refund.objects.create(
        transaction=transaction,
        amount_minor=2000,
        amount_currency="GHS",
        requested_by=landlord,
        status="requested",
        reason="Not completed",
    )
    settlement = Settlement.objects.create(
        transaction=transaction,
        beneficiary=landlord,
        beneficiary_organization=organization,
        provider="test",
        gross_amount_minor=10000,
        gross_amount_currency="GHS",
        fee_amount_minor=80,
        fee_amount_currency="GHS",
        net_amount_minor=9920,
        net_amount_currency="GHS",
        status="pending",
        settled_at=timezone.make_aware(datetime(2026, 1, 6)),
    )
    api = APIClient()
    sign_in_as(api, user=landlord)
    url = f"/api/v1/organizations/{organization.id}/finance/rent-tax-report/"
    before = api.post(url, report_input(), format="json")
    assert before.status_code == 200, before.data
    rows = list(csv.reader(io.StringIO(before.data["csv"].lstrip("\ufeff"))))
    summary = next(row for row in rows if row and row[0] == "GHS")
    assert summary[2] == "10.00"
    assert summary[6] == "0.00"
    settlement.status = "settled"
    settlement.save(update_fields=["status"])
    after = api.post(url, report_input(), format="json")
    rows = list(csv.reader(io.StringIO(after.data["csv"].lstrip("\ufeff"))))
    assert next(row for row in rows if row and row[0] == "GHS")[6] == "0.80"
