"""Professional, immutable PDF rendering for a frozen agreement snapshot."""

from __future__ import annotations

import io
from html import escape as _escape

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def escape(value: str) -> str:
    """Make text safe for ReportLab's mini-markup.

    `html.escape` rather than `xml.sax.saxutils.escape`. The two are identical
    for the three characters that matter here, and this one is not on bandit's
    blacklist — a blacklist about the `xml.sax` *parser* being unsafe on
    untrusted input, where nothing in this file parses anything.

    `quote=False` keeps the behaviour exactly as it was: an apostrophe in a
    clause stays an apostrophe rather than becoming an entity.
    """
    return _escape(value, quote=False)


def render_final_pdf(agreement) -> bytes:
    """Render only from the stored document and acceptance evidence."""
    buffer = io.BytesIO()
    document = agreement.rendered_document
    reference = agreement.reference_number or str(agreement.lease_id)
    generated = agreement.executed_at or agreement.final_pdf_generated_at or timezone.now()

    class AgreementDoc(SimpleDocTemplate):
        pass

    doc = AgreementDoc(
        buffer,
        pagesize=A4,
        rightMargin=19 * mm,
        leftMargin=19 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title=str(document.get("title", "Rooomly tenancy agreement")),
        author="Rooomly",
        subject=f"Agreement {reference}",
    )
    styles = getSampleStyleSheet()
    ink = colors.HexColor("#17352C")
    muted = colors.HexColor("#64736D")
    rule = colors.HexColor("#D7DFDB")
    kola = colors.HexColor("#176B50")
    title = ParagraphStyle(
        "RooomlyTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=27,
        textColor=ink,
        alignment=TA_CENTER,
        spaceAfter=8 * mm,
    )
    reference_style = ParagraphStyle(
        "Reference",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
        textColor=muted,
        alignment=TA_CENTER,
        spaceAfter=7 * mm,
    )
    heading = ParagraphStyle(
        "Clause",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=15,
        textColor=kola,
        spaceBefore=5 * mm,
        spaceAfter=2 * mm,
    )
    body = ParagraphStyle(
        "AgreementBody",
        parent=styles["BodyText"],
        fontSize=9.5,
        leading=14,
        textColor=ink,
        spaceAfter=2 * mm,
    )
    small = ParagraphStyle(
        "Small",
        parent=styles["BodyText"],
        fontSize=8,
        leading=11,
        textColor=muted,
    )

    story = [
        Paragraph(
            escape(str(document.get("title", "Rooomly Ghana Residential Tenancy Agreement"))),
            title,
        ),
        Paragraph(
            f"Agreement reference <b>{escape(str(reference))}</b><br/>Template "
            f"{escape(str(document.get('template', {}).get('version', 'legacy')))}",
            reference_style,
        ),
    ]
    notice = document.get("production_notice")
    if notice:
        story.extend(
            [
                Table(
                    [[Paragraph(escape(str(notice)), small)]],
                    colWidths=[167 * mm],
                    style=TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF4E6")),
                            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#C87931")),
                            ("LEFTPADDING", (0, 0), (-1, -1), 8),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                            ("TOPPADDING", (0, 0), (-1, -1), 7),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                        ]
                    ),
                ),
                Spacer(1, 5 * mm),
            ]
        )
    for section in document.get("sections", []):
        story.extend(
            [
                Paragraph(escape(str(section.get("title", "Agreement term"))), heading),
                Paragraph(escape(str(section.get("body", ""))).replace("\n", "<br/>"), body),
            ]
        )

    story.extend([PageBreak(), Paragraph("Recorded acceptance evidence", title)])
    acceptance_rows = [["Party", "Account", "Accepted", "Method"]]
    for acceptance in agreement.acceptances.select_related("user").order_by("accepted_at"):
        acceptance_rows.append(
            [
                acceptance.get_party_display(),
                acceptance.user.display_name,
                acceptance.accepted_at.strftime("%d %b %Y, %H:%M UTC"),
                acceptance.get_method_display(),
            ]
        )
    table = Table(acceptance_rows, repeatRows=1, colWidths=[28 * mm, 49 * mm, 52 * mm, 38 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), ink),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("LEADING", (0, 0), (-1, -1), 11),
                ("GRID", (0, 0), (-1, -1), 0.35, rule),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.extend(
        [
            table,
            Spacer(1, 6 * mm),
            Paragraph(f"Content SHA-256: {escape(agreement.content_hash)}", small),
            Paragraph(f"PDF generated from the frozen agreement on {generated:%d %B %Y}.", small),
        ]
    )

    def footer(canvas, doc_instance):
        canvas.saveState()
        canvas.setStrokeColor(rule)
        canvas.line(19 * mm, 14 * mm, A4[0] - 19 * mm, 14 * mm)
        canvas.setFillColor(muted)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(19 * mm, 9 * mm, f"Rooomly · {reference}")
        canvas.drawRightString(A4[0] - 19 * mm, 9 * mm, f"Page {doc_instance.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
