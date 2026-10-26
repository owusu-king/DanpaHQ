"""Unicode-safe fonts and text escaping shared by generated PDFs."""

from __future__ import annotations

from html import escape as _escape
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


def _document_fonts() -> tuple[str, str, bool]:
    candidates = (
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ),
        (Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
        (
            Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
            Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        ),
    )
    for regular_path, bold_path in candidates:
        if not regular_path.is_file() or not bold_path.is_file():
            continue
        regular = TTFont("DanpaHQDocument", str(regular_path))
        bold = TTFont("DanpaHQDocument-Bold", str(bold_path))
        if 0x20B5 not in regular.face.charToGlyph or 0x20B5 not in bold.face.charToGlyph:
            continue
        pdfmetrics.registerFont(regular)
        pdfmetrics.registerFont(bold)
        pdfmetrics.registerFontFamily(
            "DanpaHQDocument",
            normal="DanpaHQDocument",
            bold="DanpaHQDocument-Bold",
        )
        return "DanpaHQDocument", "DanpaHQDocument-Bold", True
    return "Helvetica", "Helvetica-Bold", False


DOCUMENT_FONT, DOCUMENT_FONT_BOLD, FONT_SUPPORTS_CEDI = _document_fonts()


def pdf_escape(value: str, *, quote: bool = False) -> str:
    """Escape ReportLab markup and avoid a broken cedi glyph on fallback hosts."""

    if not FONT_SUPPORTS_CEDI:
        value = value.replace("GH₵", "GHS ")
    return _escape(value, quote=quote)
