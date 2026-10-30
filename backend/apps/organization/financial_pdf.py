"""Financial statements rendered exclusively from the scoped accounting report."""

import io
from collections import defaultdict

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    CondPageBreak,
    KeepTogether,
    LongTable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from apps.core.pdf_fonts import DOCUMENT_FONT, DOCUMENT_FONT_BOLD, pdf_escape

from .tax_reports import NOTES, SOURCES, amount, schedule_totals


def render_financial_pdf(report):
    buffer = io.BytesIO()
    ink, green = colors.HexColor("#203B32"), colors.HexColor("#12503B")
    muted, rule = colors.HexColor("#64736D"), colors.HexColor("#DDE5E0")
    wash = colors.HexColor("#F2F6F3")
    styles = {
        "title": ParagraphStyle(
            "Title",
            fontName=DOCUMENT_FONT_BOLD,
            fontSize=24,
            leading=29,
            textColor=ink,
            spaceAfter=8,
        ),
        "heading": ParagraphStyle(
            "Heading",
            fontName=DOCUMENT_FONT_BOLD,
            fontSize=12,
            leading=17,
            textColor=green,
            spaceBefore=17,
            spaceAfter=8,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "Body", fontName=DOCUMENT_FONT, fontSize=9, leading=14, textColor=ink, spaceAfter=5
        ),
        "small": ParagraphStyle(
            "Small", fontName=DOCUMENT_FONT, fontSize=8, leading=12, textColor=muted, spaceAfter=5
        ),
        "cell": ParagraphStyle(
            "Cell", fontName=DOCUMENT_FONT, fontSize=8.5, leading=12, textColor=ink
        ),
        "number": ParagraphStyle(
            "Number",
            fontName=DOCUMENT_FONT,
            fontSize=8.5,
            leading=12,
            textColor=ink,
            alignment=TA_RIGHT,
        ),
        "label": ParagraphStyle(
            "Label", fontName=DOCUMENT_FONT_BOLD, fontSize=8, leading=12, textColor=muted
        ),
        "metric": ParagraphStyle(
            "Metric", fontName=DOCUMENT_FONT_BOLD, fontSize=17, leading=24, textColor=green
        ),
    }

    styles["metric_loss"] = ParagraphStyle(
        "MetricLoss", parent=styles["metric"], textColor=colors.HexColor("#A24736")
    )
    styles["table_heading"] = ParagraphStyle(
        "TableHeading", parent=styles["heading"], keepWithNext=False
    )

    def text(value, style="body"):
        return Paragraph(pdf_escape(str(value)).replace("\n", "<br/>"), styles[style])

    def money(value):
        return f"({amount(-value):,.2f})" if value < 0 else f"{amount(value):,.2f}"

    def table(headers, rows, widths, *, total=False):
        content = [[text(label, "label") for label in headers], *rows]
        result = LongTable(
            content, colWidths=[width * mm for width in widths], repeatRows=1, hAlign="LEFT"
        )
        commands = [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BACKGROUND", (0, 0), (-1, 0), wash),
            ("LINEBELOW", (0, 0), (-1, 0), 0.6, rule),
            ("LINEBELOW", (0, 1), (-1, -1), 0.3, rule),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]
        if total:
            commands += [
                ("BACKGROUND", (0, -1), (-1, -1), wash),
                ("LINEABOVE", (0, -1), (-1, -1), 0.8, green),
            ]
        result.setStyle(TableStyle(commands))
        return result

    def table_section(title, headers, rows, widths, *, total=False):
        heading = text(title, "table_heading")
        _, heading_height = heading.wrap(174 * mm, 800 * mm)
        _, first_rows_height = table(headers, rows[:1], widths).wrap(174 * mm, 800 * mm)
        required = (
            heading_height + heading.getSpaceBefore() + heading.getSpaceAfter() + first_rows_height
        )
        return [CondPageBreak(required), heading, table(headers, rows, widths, total=total)]

    generated = report["generated_at"]
    identity = report["identity"]
    start, end = identity["period_start"], identity["period_end"]
    story = [
        text("DANPA HQ  /  FINANCIAL REPORT", "label"),
        Spacer(1, 7 * mm),
        text("Property financial statement", "title"),
        text(report["organization_name"]),
    ]
    story += [
        text(f"Reporting period: {start:%d %b %Y} to {end:%d %b %Y}", "small"),
        text(f"Generated: {generated:%d %b %Y, %H:%M} UTC", "small"),
    ]
    names = report["property_names"]
    if len(names) == 1:
        story.append(text(f"Property: {names[0]}"))
    else:
        story.append(
            text(
                f"Property scope: {len(names)} authorised properties; names are listed below.",
                "small",
            )
        )
    taxpayer_type = (
        "Registered business" if identity["taxpayer_type"] == "business" else "Individual landlord"
    )
    story.append(text(f"Prepared for: {identity['taxpayer_name']} | {taxpayer_type}", "small"))
    if identity.get("taxpayer_tin"):
        story.append(text(f"TIN / Ghana Card PIN: {identity['taxpayer_tin']}", "small"))
    if identity.get("tax_office"):
        story.append(text(f"Tax office: {identity['tax_office']}", "small"))

    totals = schedule_totals(
        **{key: report[key] for key in ("receipts", "refunds", "expenses", "fees")}
    )
    outstanding = defaultdict(int)
    for item in report["outstanding"]:
        outstanding[item["currency"]] += item["minor"]
    currencies = sorted(set(totals) | set(outstanding))
    if not currencies:
        story += [
            text("Summary", "heading"),
            text(
                "No recorded income, expenses or outstanding charges were found "
                "in this scope and period."
            ),
        ]
        if names:
            story.append(text("Properties: " + "; ".join(names)))

    for currency in currencies:
        sums = totals.get(
            currency,
            dict.fromkeys(
                (
                    "gross_rent",
                    "rent_refunds",
                    "other_receipts",
                    "other_refunds",
                    "expenses",
                    "fees",
                    "net_income",
                ),
                0,
            ),
        )
        income = sums["gross_rent"] - sums["rent_refunds"]
        cost = sums["expenses"] + sums["fees"]
        cards = []
        for label, value in (
            ("NET RENT RECEIVED", income),
            ("RECORDED COSTS", cost),
            ("NET RENTAL INCOME", sums["net_income"]),
        ):
            cards.append(
                [text(label, "label"), text(money(value), "metric_loss" if value < 0 else "metric")]
            )
        metrics = Table([cards], colWidths=[58 * mm] * 3, hAlign="LEFT")
        metrics.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), wash),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 12),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ]
            )
        )
        story.append(KeepTogether([text(f"Financial summary | {currency}", "heading"), metrics]))
        lines = [
            ("Confirmed rent and advance rent received", sums["gross_rent"]),
            ("Less: completed rent refunds", -sums["rent_refunds"]),
            ("Net rent received", income),
            ("Less: recorded property expenses", -sums["expenses"]),
            ("Less: settled processing fees", -sums["fees"]),
            ("Net rental income / (loss)", sums["net_income"]),
        ]
        story += table_section(
            "Income and expenditure",
            ["Description", f"Amount ({currency})"],
            [[text(label, "cell"), text(money(value), "number")] for label, value in lines],
            [124, 50],
            total=True,
        )
        story.append(
            text(
                f"Other receipts excluded from rental income: {currency} "
                f"{money(sums['other_receipts'])}. Other completed refunds: "
                f"{currency} {money(sums['other_refunds'])}. Deposits, agency fees "
                "and unallocated payments are kept separate. Outstanding charges "
                "are not included in income received.",
                "small",
            )
        )
        story.append(
            text(f"Outstanding charges: {currency} {money(outstanding[currency])}", "heading")
        )
        story.append(
            text(
                (
                    "Charges due within the reporting period, excluding future due "
                    "dates. Balances reflect confirmations and adjustments at "
                    "generation, not a reconstructed historical period-end balance."
                ),
                "small",
            )
        )

        grouped = defaultdict(lambda: {"receipts": [], "refunds": [], "expenses": [], "fees": []})
        for key in ("receipts", "refunds", "expenses", "fees"):
            for item in report[key]:
                if item["currency"] == currency:
                    grouped[item["property_id"]][key].append(item)
        property_outstanding = defaultdict(int)
        for item in report["outstanding"]:
            if item["currency"] == currency:
                property_outstanding[item["property_id"]] += item["minor"]
        property_rows = []
        for prop in report["properties"]:
            figures = schedule_totals(**grouped[prop["id"]]).get(currency, {})
            net_rent = figures.get("gross_rent", 0) - figures.get("rent_refunds", 0)
            costs = figures.get("expenses", 0) + figures.get("fees", 0)
            property_rows.append(
                [
                    text(prop["title"], "cell"),
                    *[
                        text(money(value), "number")
                        for value in (
                            net_rent,
                            costs,
                            net_rent - costs,
                            property_outstanding[prop["id"]],
                        )
                    ],
                ]
            )
        if property_rows:
            story += table_section(
                f"Property performance | {currency}",
                ["Property", "Net rent", "Costs", "Net income", "Outstanding"],
                property_rows,
                [62, 28, 28, 28, 28],
            )
        expense_groups = defaultdict(lambda: [0, 0])
        for item in report["expenses"]:
            if item["currency"] == currency:
                expense_groups[item["detail"][3]][0] += 1
                expense_groups[item["detail"][3]][1] += item["minor"]
        if expense_groups:
            story += table_section(
                f"Expense breakdown | {currency}",
                ["Category", "Records", "Recorded amount"],
                [
                    [
                        text(category, "cell"),
                        text(count, "number"),
                        text(money(value), "number"),
                    ]
                    for category, (count, value) in sorted(expense_groups.items())
                ],
                [104, 25, 45],
            )
        unpaid = [item for item in report["outstanding"] if item["currency"] == currency]
        if unpaid:
            story += table_section(
                f"Outstanding payment detail | {currency}",
                ["Property / unit / charge", "Tenant", "Due date", "Balance"],
                [
                    [
                        text(f"{item['property_name']}\n{item['unit']} | {item['kind']}", "cell"),
                        text(item["tenant"], "cell"),
                        text(item["due_on"].strftime("%d %b %Y"), "cell"),
                        text(money(item["minor"]), "number"),
                    ]
                    for item in unpaid
                ],
                [74, 43, 29, 28],
            )

    story.append(text("Basis of preparation", "heading"))
    story.append(
        text(
            (
                "Prepared from actual platform records in the provider's authorised "
                "scope. Income is received rent less completed rent refunds. Net "
                "rental income deducts recorded property expenses and settled "
                "processing fees; it is not a tax assessment or a statement of all "
                "business income."
            ),
            "small",
        )
    )
    for note in NOTES[1:]:
        story.append(text(note.replace("\u2014", "-"), "small"))
    guidance = [text("Official guidance", "heading")]
    for label, source in zip(
        ("GRA return requirements", "GRA rent tax guidance", "GRA withholding guidance"),
        SOURCES,
        strict=True,
    ):
        guidance.append(
            Paragraph(
                f'<link href="{pdf_escape(source, quote=True)}" color="#12503B">{label}</link>',
                styles["small"],
            )
        )
    story.append(KeepTogether(guidance))

    def page(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(rule)
        canvas.line(18 * mm, 17 * mm, 192 * mm, 17 * mm)
        canvas.setFont(DOCUMENT_FONT, 8)
        canvas.setFillColor(muted)
        canvas.drawString(18 * mm, 12 * mm, "Confidential financial records | Danpa HQ")
        canvas.drawRightString(192 * mm, 12 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=23 * mm,
        title="Property financial statement",
        author="Danpa HQ",
    )
    document.build(story, onFirstPage=page, onLaterPages=page)
    return buffer.getvalue()
