"""GRA preparation schedules, never a tax assessment or an electronic return."""

import base64
import csv
import io
from collections import defaultdict
from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

SOURCES = (
    "https://gra.gov.gh/domestic-tax/returns/",
    "https://gra.gov.gh/portfolio/rent-tax/",
    "https://gra.gov.gh/wp-content/uploads/2020/09/Practice-Note-on-Withholding-of-Tax.pdf",
)
NOTES = (
    "Supporting schedules only: not an official GRA return, tax assessment or proof of filing.",
    (
        "Scope: currently authorised Portfolio properties, including archived properties "
        "and inactive Units. Other holdings and off-platform records must be added "
        "separately."
    ),
    (
        "Rent uses confirmed receipts on paid-on dates, not monthly spreading of advance "
        "payments. Deposits, agency fees and unallocated payments are separately identified "
        "and excluded from gross rent."
    ),
    (
        "Completed refunds restate the original receipt period, including refunds completed "
        "after that period. Refund completion dates are not available; this is not a refund "
        "cash-flow statement."
    ),
    (
        "Expenses use their recorded incurred dates, not verified payment dates. Fees "
        "include settled processing fees only. Payouts are transfers and are excluded."
    ),
    (
        "Recorded costs are not automatically allowable tax deductions. Refunds are not "
        "automatically reductions of taxable rent."
    ),
    (
        "Tax withheld, certificates, GRA payments, capital allowances, reliefs, residency, "
        "beneficial ownership shares and external adjustments are not recorded here. "
        "Missing values are not zero."
    ),
    (
        "Individual investment rent and income from a letting business can have different "
        "treatment. Review the applicable GRA return, rates and tax credits before filing; "
        "no tax payable is calculated."
    ),
)


class RentTaxReportSerializer(serializers.Serializer):
    # Existing installed clients expect CSV when no format is supplied.
    format = serializers.ChoiceField(choices=("pdf", "csv"), default="csv")
    property_id = serializers.UUIDField(required=False, allow_null=True)
    period_start = serializers.DateField()
    period_end = serializers.DateField()
    taxpayer_type = serializers.ChoiceField(choices=("individual", "business"))
    taxpayer_name = serializers.CharField(max_length=200)
    taxpayer_tin = serializers.CharField(max_length=40, required=False, allow_blank=True)
    tax_office = serializers.CharField(max_length=120, required=False, allow_blank=True)

    def validate(self, attrs):
        days = (attrs["period_end"] - attrs["period_start"]).days
        if days < 0 or days > 365:
            raise serializers.ValidationError(
                "Choose a reporting period of up to 366 days, with the end on or after the start."
            )
        return attrs


def safe_cell(value):
    """Stop names, notes and references becoming spreadsheet formulas."""
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def amount(minor):
    return (Decimal(minor) / 100).quantize(Decimal("0.01"))


def schedule_totals(*, receipts, refunds, expenses, fees):
    columns = ("gross_rent", "rent_refunds", "other_receipts", "other_refunds", "expenses", "fees")
    totals = defaultdict(lambda: dict.fromkeys(columns, 0))
    for item in receipts:
        totals[item["currency"]]["gross_rent" if item["is_rent"] else "other_receipts"] += item[
            "minor"
        ]
    for item in refunds:
        totals[item["currency"]]["rent_refunds" if item["is_rent"] else "other_refunds"] += item[
            "minor"
        ]
    for key, items in (("expenses", expenses), ("fees", fees)):
        for item in items:
            totals[item["currency"]][key] += item["minor"]
    for sums in totals.values():
        sums["net_income"] = (
            sums["gross_rent"] - sums["rent_refunds"] - sums["expenses"] - sums["fees"]
        )
    return dict(totals)


def render_schedule(
    *,
    identity,
    organization_name,
    receipts,
    refunds,
    expenses,
    fees,
    outstanding=(),
    property_names=(),
    generated_at=None,
):
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)

    def row(*values):
        writer.writerow([safe_cell(value) for value in values])

    row("GRA rental-income supporting schedules", "Danpa HQ")
    for key, label in (
        ("taxpayer_type", "Taxpayer type"),
        ("taxpayer_name", "Taxpayer / registered name"),
        ("taxpayer_tin", "TIN / Ghana Card PIN"),
        ("tax_office", "Tax office"),
        ("period_start", "Period start"),
        ("period_end", "Period end"),
    ):
        row(label, identity.get(key) or "Not provided")
    row("Portfolio", organization_name)
    if property_names:
        row("Properties", "; ".join(property_names))
    row("Generated at (UTC)", (generated_at or timezone.now()).isoformat())
    row()
    row("SUMMARY — currencies are separate; amounts are major units")
    columns = ("gross_rent", "rent_refunds", "other_receipts", "other_refunds", "expenses", "fees")
    totals = schedule_totals(receipts=receipts, refunds=refunds, expenses=expenses, fees=fees)
    row(
        "Currency",
        "Recorded rent receipts (withholding untracked)",
        "Completed rent refunds (review tax treatment)",
        "Other receipts excluded from rent",
        "Other refunds",
        "Recorded expenses",
        "Settled processing fees",
        "Rent less refunds and recorded costs (not taxable income)",
    )
    for currency, sums in sorted(totals.items()):
        row(currency, *(amount(sums[key]) for key in columns), amount(sums["net_income"]))
    if not totals:
        row("No recorded activity in this period")
    row("Tax payable", "Not calculated")
    row(
        "Gross rent for tax purposes",
        "Not determined — reconcile any withholding and non-cash amounts",
    )
    row(
        "Tax withheld / tax credits / GRA payments",
        "Not recorded — reconcile certificates and receipts separately",
    )
    row()
    row("CONFIRMED RECEIPTS — recorded amounts before refunds and fees; withholding untracked")
    row(
        "Receipt ID",
        "Paid on",
        "Property",
        "Property ID",
        "Address",
        "Recorded property category",
        "Unit",
        "Unit type",
        "Tenant",
        "Lease ID",
        "Charge kind",
        "Period from",
        "Period to",
        "Method",
        "Reference",
        "Currency",
        "Amount",
        "Included in recorded rent receipts",
    )
    for item in receipts:
        row(
            *item["detail"],
            item["currency"],
            amount(item["minor"]),
            "Yes" if item["is_rent"] else "No — review separately",
        )
    for title, headers, items in (
        (
            "COMPLETED REFUNDS — attributed to original receipt period",
            (
                "Refund ID",
                "Receipt ID",
                "Original paid-on date",
                "Property",
                "Unit",
                "Charge kind",
                "Provider refund reference",
            ),
            refunds,
        ),
        (
            "RECORDED EXPENSES — deductibility not determined",
            ("Expense ID", "Incurred on", "Property", "Category", "Note"),
            expenses,
        ),
        (
            "SETTLED PROCESSING FEES — payouts excluded",
            ("Settlement ID", "Settled at", "Property", "Unit", "Provider reference"),
            fees,
        ),
    ):
        row()
        row(title)
        row(*headers, "Currency", "Amount")
        for item in items:
            row(*item["detail"], item["currency"], amount(item["minor"]))
    row()
    row("OUTSTANDING CHARGES — due within the period, current balances at generation")
    row("Property", "Unit", "Tenant", "Charge kind", "Due on", "Currency", "Outstanding")
    for item in outstanding:
        row(
            item["property_name"],
            item["unit"],
            item["tenant"],
            item["kind"],
            item["due_on"],
            item["currency"],
            amount(item["minor"]),
        )
    row()
    row("REVIEW BEFORE FILING")
    for note in NOTES:
        row(note)
    for source in SOURCES:
        row("Official GRA guidance", source)
    return "\ufeff" + buffer.getvalue()


def collect_rental_report(*, organization, user, identity):
    from apps.core.exceptions import NotFound
    from apps.payments.models import (
        Refund,
        RefundStatus,
        Settlement,
        SettlementStatus,
        TransactionStatus,
    )
    from apps.rent.models import (
        ChargeKind,
        ChargeStatus,
        PaymentStatus,
        PropertyExpense,
        RentCharge,
        RentPayment,
    )

    from .services import properties_for_organization_member

    properties = properties_for_organization_member(
        organization=organization, user=user, include_archived=True
    )
    if identity.get("property_id"):
        properties = properties.filter(pk=identity["property_id"])
        if not properties.exists():
            raise NotFound("That Property is not in your financial reporting scope.")
    property_rows = list(properties.values("id", "title").order_by("title", "id"))
    start, end = identity["period_start"], identity["period_end"]
    payments = RentPayment.objects.filter(
        lease__unit__property__in=properties,
        status=PaymentStatus.CONFIRMED,
        paid_on__range=(start, end),
    )
    receipts, refunds, expenses, fees = [], [], [], []
    rent_kinds = {ChargeKind.RENT, ChargeKind.ADVANCE}
    for payment in (
        payments.select_related(
            "charge",
            "lease__tenant",
            "lease__unit__property__address__locality",
        )
        .order_by("paid_on", "id")
        .iterator()
    ):
        lease, charge = payment.lease, payment.charge
        unit, prop = lease.unit, lease.unit.property
        address = prop.address
        place = (
            ", ".join(filter(None, [address.digital_address, address.locality.name]))
            if address
            else "Not recorded"
        )
        kind = charge.kind if charge else "unallocated"
        receipts.append(
            {
                "currency": payment.amount_currency,
                "minor": payment.amount_minor,
                "is_rent": kind in rent_kinds,
                "property_id": str(prop.id),
                "property_name": prop.title,
                "detail": [
                    str(payment.id),
                    payment.paid_on,
                    prop.title,
                    str(prop.id),
                    place,
                    prop.get_property_type_display(),
                    unit.label,
                    unit.space_type,
                    lease.tenant.display_name,
                    str(lease.id),
                    kind,
                    charge.period_start if charge else "",
                    charge.period_end if charge else "",
                    payment.method,
                    payment.reference,
                ],
            }
        )
    for refund in (
        Refund.objects.filter(transaction__rent_record__in=payments, status=RefundStatus.COMPLETED)
        .select_related(
            "transaction__rent_record__charge",
            "transaction__rent_record__lease__unit__property",
        )
        .order_by("id")
        .iterator()
    ):
        payment = refund.transaction.rent_record
        kind = payment.charge.kind if payment.charge else "unallocated"
        refunds.append(
            {
                "currency": refund.amount_currency,
                "minor": refund.amount_minor,
                "is_rent": kind in rent_kinds,
                "property_id": str(payment.lease.unit.property_id),
                "property_name": payment.lease.unit.property.title,
                "detail": [
                    str(refund.id),
                    str(payment.id),
                    payment.paid_on,
                    payment.lease.unit.property.title,
                    payment.lease.unit.label,
                    kind,
                    refund.provider_refund_reference,
                ],
            }
        )
    for expense in (
        PropertyExpense.objects.filter(
            organization=organization, property__in=properties, incurred_on__range=(start, end)
        )
        .select_related("property")
        .order_by("incurred_on", "id")
        .iterator()
    ):
        expenses.append(
            {
                "currency": expense.amount_currency,
                "minor": expense.amount_minor,
                "property_id": str(expense.property_id),
                "property_name": expense.property.title,
                "detail": [
                    str(expense.id),
                    expense.incurred_on,
                    expense.property.title,
                    expense.get_category_display(),
                    expense.note,
                ],
            }
        )
    for fee in (
        Settlement.objects.filter(
            beneficiary_organization=organization,
            transaction__intent__lease__unit__property__in=properties,
            transaction__status=TransactionStatus.SUCCEEDED,
            status=SettlementStatus.SETTLED,
            settled_at__date__range=(start, end),
        )
        .select_related("transaction__intent__lease__unit__property")
        .order_by("settled_at", "id")
        .iterator()
    ):
        unit = fee.transaction.intent.lease.unit
        fees.append(
            {
                "currency": fee.fee_amount_currency,
                "minor": fee.fee_amount_minor,
                "property_id": str(unit.property_id),
                "property_name": unit.property.title,
                "detail": [
                    str(fee.id),
                    fee.settled_at.isoformat(),
                    unit.property.title,
                    unit.label,
                    fee.provider_settlement_reference,
                ],
            }
        )
    outstanding = []
    charges = (
        RentCharge.objects.filter(
            lease__unit__property__in=properties,
            due_on__range=(start, min(end, timezone.localdate())),
            status__in=(ChargeStatus.DUE, ChargeStatus.PART_PAID),
        )
        .select_related("lease__unit__property", "lease__tenant")
        .prefetch_related("adjustments")
        .order_by("due_on", "id")
    )
    for charge in charges:
        balance = charge.outstanding_minor
        if balance:
            outstanding.append(
                {
                    "property_id": str(charge.lease.unit.property_id),
                    "property_name": charge.lease.unit.property.title,
                    "unit": charge.lease.unit.label,
                    "tenant": charge.lease.tenant.display_name,
                    "kind": charge.get_kind_display(),
                    "due_on": charge.due_on,
                    "currency": charge.amount_currency,
                    "minor": balance,
                }
            )
    return {
        "identity": identity,
        "organization_name": organization.name,
        "generated_at": timezone.now(),
        "property_names": [row["title"] for row in property_rows],
        "properties": [{"id": str(row["id"]), "title": row["title"]} for row in property_rows],
        "receipts": receipts,
        "refunds": refunds,
        "expenses": expenses,
        "fees": fees,
        "outstanding": outstanding,
    }


def rental_tax_schedule(*, organization, user, identity):
    report = collect_rental_report(organization=organization, user=user, identity=identity)
    start, end = identity["period_start"], identity["period_end"]
    if identity.get("format") == "pdf":
        from .financial_pdf import render_financial_pdf

        return {
            "filename": f"property-financial-report-{start}_{end}.pdf",
            "mime_type": "application/pdf",
            "pdf_base64": base64.b64encode(render_financial_pdf(report)).decode("ascii"),
        }
    return {
        "filename": f"gra-rental-schedule-{start}_{end}.csv",
        "mime_type": "text/csv",
        "csv": render_schedule(
            **{key: value for key, value in report.items() if key != "properties"}
        ),
    }
