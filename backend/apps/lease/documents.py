"""Render a complete agreement from one template release and structured terms."""

from __future__ import annotations

from datetime import date
from string import Template

from apps.core.money import Money

from .terms_templates import fill_placeholders

RESPONSIBILITY_LABELS = {
    "structural_repairs": "structural repairs",
    "shared_areas": "shared-area upkeep",
    "property_rates": "property rates assigned to the Provider",
    "routine_cleaning": "routine cleaning",
    "minor_consumables": "minor consumables",
    "report_damage": "promptly reporting damage or needed repair",
    "respect_neighbours": "avoiding nuisance to neighbours",
    "residential_use": "using the premises only as agreed",
}

UTILITY_LABELS = {
    "water": "Water",
    "electricity": "Electricity",
    "internet": "Internet",
    "refuse": "Refuse collection",
    "gas": "Gas",
}

UTILITY_PARTY_LABELS = {
    "tenant": "Tenant pays",
    "provider": "Provider pays",
    "included": "included in rent",
    "shared": "shared as recorded",
    "not_applicable": "not applicable",
}


def reference_for(lease) -> str:
    """A reference somebody can quote, unique by construction.

    Drawn from the *tail* of the identifier, deliberately. These ids are
    UUIDv7, whose leading 48 bits are a millisecond timestamp — so a slice off
    the front is a clock reading, and any two agreements prepared in the same
    quarter-second produced the *same* reference against a unique column. That
    is not rare in practice: an amendment is executed moments after the
    original, and two providers sending at once is an ordinary Tuesday. The
    tail is entropy, which is what a reference number actually needs.
    """
    return f"RLY-GH-{lease.created_at:%Y}-{lease.id.hex[-12:].upper()}"


def _date(value: date | None) -> str:
    return value.strftime("%d %B %Y").lstrip("0") if value else "not recorded"


def _list(values: list[str] | None, labels: dict[str, str] | None = None) -> str:
    values = values or []
    if labels:
        values = [labels.get(value, value.replace("_", " ")) for value in values]
    return ", ".join(values) if values else "none recorded"


def _utilities(values: dict | None) -> str:
    values = values or {}
    if not values:
        return "none recorded"
    return "; ".join(
        f"{UTILITY_LABELS.get(key, key.title())}: {UTILITY_PARTY_LABELS.get(value, value)}"
        for key, value in sorted(values.items())
    )


def _occupants(values: list | None) -> str:
    values = values or []
    labels = []
    for value in values:
        if isinstance(value, dict):
            name = str(value.get("name") or "").strip()
            relationship = str(value.get("relationship") or "").strip()
            if name:
                labels.append(f"{name} ({relationship})" if relationship else name)
        elif str(value).strip():
            labels.append(str(value).strip())
    return ", ".join(labels) if labels else "the Tenant only"


def render_agreement(*, lease, template, terms: dict) -> tuple[dict, str]:
    """Return the exact structured document and plain-text representation."""
    structured = terms.get("negotiated", {})
    money = terms["money"]
    term = terms["term"]
    premises = " · ".join(
        value
        for value in [
            terms["property"]["title"],
            terms["space"]["unit_label"],
            terms["space"].get("bed_label"),
        ]
        if value
    )
    rent = str(Money(money["rent_minor"], money["rent_currency"]))
    move_in = str(Money(money["move_in_total_minor"], money["rent_currency"]))
    ends_on = term.get("ends_on")
    term_description = (
        f"{term['term_months']} month(s), ending {ends_on}"
        if ends_on
        else f"{term['term_months']} month(s)"
    )
    context = {
        "provider_name": terms["parties"]["landlord"]["name"],
        "tenant_name": terms["parties"]["tenant"]["name"],
        "premises": premises,
        "address": terms["property"]["address"] or "the address recorded above",
        "starts_on": term.get("starts_on") or "the recorded start date",
        "term_description": term_description,
        "rent": rent,
        "rent_period": "year" if money["rent_period"] == "yearly" else "month",
        "payment_due": structured.get("payment_due", "on the agreed due date"),
        "move_in_total": move_in,
        "advance_months": str(money["advance_months"]),
        "deposit_months": str(money["deposit_months"]),
        "utilities": _utilities(structured.get("utilities")),
        "occupants": _occupants(structured.get("occupants")),
        "provider_responsibilities": _list(
            structured.get("provider_responsibilities"), RESPONSIBILITY_LABELS
        ),
        "tenant_responsibilities": _list(
            structured.get("tenant_responsibilities"), RESPONSIBILITY_LABELS
        ),
        "notice_channels": _list(structured.get("notice_channels")),
    }

    sections = []
    for clause in template.clauses:
        sections.append(
            {
                "id": clause["id"],
                "title": clause["title"],
                "kind": "standard",
                "body": Template(clause["body"]).substitute(context),
            }
        )
    for index, custom in enumerate(structured.get("additional_terms") or [], start=1):
        title = str(custom.get("title") or f"Additional term {index}").strip()
        # Saved terms templates carry ${placeholders}; they are filled from the
        # same facts as the standard clauses, and only those facts.
        body = fill_placeholders(str(custom.get("body") or "").strip(), context)
        if body:
            sections.append(
                {
                    "id": f"custom_{index}",
                    "title": f"Custom term — {title}",
                    "kind": "custom",
                    "body": body,
                }
            )

    reference = reference_for(lease)
    document = {
        "title": template.title,
        "reference_number": reference,
        "jurisdiction": template.jurisdiction,
        "template": {
            "code": template.code,
            "version": template.version,
            "review_status": template.review_status,
        },
        "production_notice": (
            "Template wording requires Ghana-qualified legal review before production use."
            if template.review_status != "approved_for_production"
            else ""
        ),
        "parties": terms["parties"],
        "property": terms["property"],
        "space": terms["space"],
        "money": money,
        "term": term,
        "sections": sections,
    }
    lines = [template.title, f"Reference {reference}"]
    if document["production_notice"]:
        lines.extend(["", document["production_notice"]])
    for section in sections:
        lines.extend(["", section["title"], section["body"]])
    return document, "\n".join(lines).strip()
