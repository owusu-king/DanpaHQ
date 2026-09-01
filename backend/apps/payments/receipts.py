"""Versioned payment-receipt snapshots and their frozen printable document."""

from __future__ import annotations

import io
from datetime import UTC, date, datetime
from decimal import Decimal
from html import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

SNAPSHOT_VERSION = "rooomly.payment_receipt.v1"
STAMP_NOTICE = (
    "Any stamping requirement has not been assessed by Rooomly. This document records a "
    "processor-confirmed payment and is not a certification of legal compliance."
)


def build_snapshot(*, transaction_row, obligation, receipt_number: str, issued_at) -> dict:
    """Copy every receipt fact from mutable domain records at issue time."""

    intent = transaction_row.intent
    lease = intent.lease
    unit = lease.unit
    prop = unit.property
    address = prop.address
    locality = address.locality
    district = locality.district
    region = district.region
    organization = intent.beneficiary_organization
    bed = lease.bed
    address_display = str(address)
    if address.digital_address:
        address_display = (
            f"{address_display} · {address.digital_address}"
            if address_display
            else address.digital_address
        )

    return {
        "schema_version": SNAPSHOT_VERSION,
        "receipt_number": receipt_number,
        "issued_at": issued_at.isoformat(),
        "tenant": {
            "account_id": str(lease.tenant_id),
            "name": lease.tenant.display_name,
        },
        "provider": {
            "signer_account_id": str(lease.landlord_id),
            "signer_name": lease.landlord.display_name,
            "organization_id": str(organization.id) if organization else None,
            "organization_name": organization.name if organization else "",
        },
        "premises": {
            "property_id": str(prop.id),
            "property_title": prop.title,
            "unit_id": str(unit.id),
            "unit_label": unit.label,
            "bed_id": str(bed.id) if bed else None,
            "bed_label": bed.label if bed else "",
            "space_type": unit.space_type,
            "space_type_label": unit.get_space_type_display(),
            "is_furnished": unit.is_furnished,
            "address": {
                "display": address_display,
                "house_number": address.house_number,
                "street": address.street,
                "landmark": address.landmark,
                "digital_address": address.digital_address,
                "locality": locality.name,
                "district": district.name,
                "region": region.name,
            },
        },
        "obligation": {
            "id": str(obligation.id),
            "kind": obligation.kind,
            "kind_label": obligation.get_kind_display(),
            "due_on": obligation.due_on.isoformat(),
            "period_start": (
                obligation.period_start.isoformat() if obligation.period_start else None
            ),
            "period_end": obligation.period_end.isoformat() if obligation.period_end else None,
        },
        "payment": {
            "amount_minor": transaction_row.amount_minor,
            "currency": transaction_row.amount_currency,
            "method": transaction_row.payment_method,
            "method_label": transaction_row.get_payment_method_display(),
            "paid_at": (transaction_row.paid_at or issued_at).isoformat(),
            "source": "PLATFORM_PSP",
            "source_label": "Processed through Rooomly",
        },
        "processor": {
            "name": transaction_row.provider,
            "transaction_id": transaction_row.provider_transaction_id,
            "provider_reference": intent.provider_reference,
        },
        "evidence": {"status": "PSP_CONFIRMED", "label": "Processor confirmed"},
        "stamp": {"status": "not_assessed", "notice": STAMP_NOTICE},
    }


def build_external_snapshot(*, payment, receipt_number: str, issued_at) -> dict:
    """Freeze a mutually confirmed external payment without inventing a PSP event."""

    lease = payment.lease
    unit = lease.unit
    prop = unit.property
    address = prop.address
    locality = address.locality
    district = locality.district
    region = district.region
    bed = lease.bed
    evidence_file = payment.evidence_file
    address_display = str(address)
    if address.digital_address:
        address_display = (
            f"{address_display} · {address.digital_address}"
            if address_display
            else address.digital_address
        )
    obligation = payment.charge
    return {
        "schema_version": SNAPSHOT_VERSION,
        "receipt_number": receipt_number,
        "issued_at": issued_at.isoformat(),
        "tenant": {"account_id": str(lease.tenant_id), "name": lease.tenant.display_name},
        "provider": {
            "signer_account_id": str(lease.landlord_id),
            "signer_name": lease.landlord.display_name,
            "organization_id": None,
            "organization_name": "",
        },
        "premises": {
            "property_id": str(prop.id),
            "property_title": prop.title,
            "unit_id": str(unit.id),
            "unit_label": unit.label,
            "bed_id": str(bed.id) if bed else None,
            "bed_label": bed.label if bed else "",
            "space_type": unit.space_type,
            "space_type_label": unit.get_space_type_display(),
            "is_furnished": unit.is_furnished,
            "address": {
                "display": address_display,
                "house_number": address.house_number,
                "street": address.street,
                "landmark": address.landmark,
                "digital_address": address.digital_address,
                "locality": locality.name,
                "district": district.name,
                "region": region.name,
            },
        },
        "obligation": {
            "id": str(obligation.id) if obligation else None,
            "kind": obligation.kind if obligation else "",
            "kind_label": obligation.get_kind_display() if obligation else "Rental payment",
            "due_on": obligation.due_on.isoformat() if obligation else None,
            "period_start": (
                obligation.period_start.isoformat()
                if obligation and obligation.period_start
                else None
            ),
            "period_end": (
                obligation.period_end.isoformat() if obligation and obligation.period_end else None
            ),
        },
        "payment": {
            "amount_minor": payment.amount_minor,
            "currency": payment.amount_currency,
            "method": payment.payment_channel,
            "method_label": payment.get_method_display(),
            "paid_at": payment.paid_on.isoformat(),
            "source": "EXTERNAL",
            "source_label": "Paid externally and recorded through Rooomly",
            "reference": payment.reference,
            "note": payment.note,
        },
        "processor": {"name": "NONE", "transaction_id": "", "provider_reference": ""},
        "evidence": {
            "status": "COUNTERPARTY_CONFIRMED",
            "label": "Confirmed by the other party",
            "recorded_by_id": str(payment.recorded_by_id),
            "recorded_by_name": payment.recorded_by.display_name,
            "confirmed_by_id": str(payment.confirmed_by_id),
            "confirmed_at": payment.confirmed_at.isoformat(),
            "file_id": str(evidence_file.id) if evidence_file else None,
            "filename": evidence_file.original_filename if evidence_file else "",
            "file_hash": evidence_file.checksum_sha256 if evidence_file else "",
        },
        "stamp": {
            "status": "not_assessed",
            "notice": (
                "This receipt records an external payment confirmed by both parties through "
                "Rooomly. Rooomly did not process or independently verify the transfer."
            ),
        },
    }


def render_pdf(snapshot: dict) -> bytes:
    """Render from the stored snapshot only; no mutable domain record is read."""

    buffer = io.BytesIO()
    receipt_number = str(snapshot.get("receipt_number", "Rooomly receipt"))
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=18 * mm,
        title=f"Rooomly receipt {receipt_number}",
        author="Rooomly",
        subject="Rental payment receipt",
    )
    styles = getSampleStyleSheet()
    ink = colors.HexColor("#17352C")
    muted = colors.HexColor("#64736D")
    rule = colors.HexColor("#D7DFDB")
    kola = colors.HexColor("#176B50")
    title_style = ParagraphStyle(
        "ReceiptTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=27,
        textColor=ink,
        spaceAfter=2 * mm,
    )
    amount_style = ParagraphStyle(
        "ReceiptAmount",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=24,
        leading=29,
        textColor=kola,
        spaceBefore=7 * mm,
        spaceAfter=7 * mm,
    )
    body = ParagraphStyle(
        "ReceiptBody",
        parent=styles["BodyText"],
        fontSize=9,
        leading=13,
        textColor=ink,
    )
    small = ParagraphStyle(
        "ReceiptSmall",
        parent=body,
        fontSize=8,
        leading=11,
        textColor=muted,
    )
    payment = snapshot.get("payment", {})
    amount = Decimal(int(payment.get("amount_minor", 0))) / Decimal(100)
    amount_label = f"{payment.get('currency', 'GHS')} {amount:,.2f}"
    premises = snapshot.get("premises", {})
    obligation = snapshot.get("obligation", {})
    provider = snapshot.get("provider", {})
    tenant = snapshot.get("tenant", {})
    processor = snapshot.get("processor", {})
    evidence = snapshot.get("evidence", {})
    address = premises.get("address", {})
    period = "Not applicable"
    if obligation.get("period_start") and obligation.get("period_end"):
        period = (
            f"{_date_label(obligation['period_start'])} to "
            f"{_date_label(obligation['period_end'])}"
        )
    home = f"{premises.get('property_title', '')} · {premises.get('unit_label', '')}"
    if premises.get("bed_label"):
        home += f" · {premises['bed_label']}"
    received_by = provider.get("organization_name") or provider.get("signer_name") or "Provider"

    def cell(value, style=body):
        return Paragraph(escape(str(value or "—"), quote=False), style)

    rows = [
        [cell("Tenant", small), cell(tenant.get("name"))],
        [cell("Received by", small), cell(received_by)],
        [cell("Premises", small), cell(home)],
        [cell("Address", small), cell(address.get("display"))],
        [
            cell("Furnishing", small),
            cell("Furnished" if premises.get("is_furnished") else "Unfurnished"),
        ],
        [cell("Payment for", small), cell(obligation.get("kind_label"))],
        [cell("Period covered", small), cell(period)],
        [cell("Paid", small), cell(_datetime_label(payment.get("paid_at")))],
        [cell("Method", small), cell(payment.get("method_label"))],
        [cell("Payment source", small), cell(payment.get("source_label"))],
        [cell("Evidence", small), cell(evidence.get("label"))],
    ]
    if payment.get("source") == "PLATFORM_PSP":
        rows.extend(
            [
                [cell("Processor", small), cell(str(processor.get("name", "")).title())],
                [cell("Transaction reference", small), cell(processor.get("transaction_id"))],
            ]
        )
    elif payment.get("reference"):
        rows.append([cell("External reference", small), cell(payment.get("reference"))])
    table = Table(rows, colWidths=[42 * mm, 124 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -2), 0.35, rule),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story = [
        Paragraph("Rooomly payment receipt", title_style),
        Paragraph(f"Receipt {escape(receipt_number, quote=False)}", small),
        Paragraph(amount_label, amount_style),
        table,
        Spacer(1, 7 * mm),
        Paragraph(escape(str(snapshot.get("stamp", {}).get("notice", STAMP_NOTICE))), small),
    ]

    def footer(canvas, doc_instance):
        canvas.saveState()
        canvas.setStrokeColor(rule)
        canvas.line(20 * mm, 13 * mm, A4[0] - 20 * mm, 13 * mm)
        canvas.setFillColor(muted)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(20 * mm, 8 * mm, f"Rooomly · {receipt_number}")
        canvas.drawRightString(A4[0] - 20 * mm, 8 * mm, f"Page {doc_instance.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def _date_label(value) -> str:
    try:
        parsed = date.fromisoformat(str(value))
    except ValueError:
        return str(value or "—")
    return f"{parsed.day} {parsed:%B %Y}"


def _datetime_label(value) -> str:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return str(value or "—")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC)
    hour = parsed.strftime("%I").lstrip("0") or "0"
    return f"{parsed.day} {parsed:%B %Y} at {hour}:{parsed:%M %p} GMT"
