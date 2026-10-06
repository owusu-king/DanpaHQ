"""A Portfolio's reusable additional-terms wording.

Rooomly's standard clauses are controlled (see ``templates``): a provider sets
the values that go into them and never their text. What a provider *does* write
is the custom section of an agreement, and they tend to write the same thing
for every home - the gate hours, the borehole, the generator. A terms template
is that wording saved once per Portfolio and offered when an agreement is
prepared.

Placeholders use the standard clauses' own ``${name}`` form and the same facts,
so a template reads like the agreement it lands in. Only the names below are
accepted: an unknown one is refused when the template is saved rather than
printed literally into somebody's tenancy agreement.
"""

from __future__ import annotations

import re

from django.db import transaction

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import PermissionDenied, ValidationFailed

from .models import TermsTemplate

#: ``(name, label, example)`` - every fact ``documents.render_agreement`` fills.
PLACEHOLDERS: list[tuple[str, str, str]] = [
    ("tenant_name", "Tenant's name", "Nana Ofori"),
    ("provider_name", "Provider's name", "Ama Mensah"),
    ("premises", "Property and Unit", "Adenta Court · Flat 6B"),
    ("address", "Property address", "14 Sunflower Street, Adenta"),
    ("starts_on", "Start date", "2026-10-01"),
    ("term_description", "Term", "12 month(s), ending 2027-09-30"),
    ("rent", "Rent", "GHS 1,500.00"),
    ("rent_period", "Rent period", "month"),
    ("payment_due", "When rent is due", "on the first day of each rental period"),
    ("move_in_total", "Move-in total", "GHS 10,500.00"),
    ("advance_months", "Advance (months)", "6"),
    ("deposit_months", "Deposit (months)", "1"),
    ("utilities", "Utilities", "Electricity: Tenant pays; Water: Tenant pays"),
    ("occupants", "Occupants", "the Tenant only"),
    ("notice_channels", "Notice channels", "Rooomly, written notice"),
]

PLACEHOLDER_NAMES = frozenset(name for name, _, _ in PLACEHOLDERS)

_PLACEHOLDER = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")

NAME_LIMIT = 120
BODY_LIMIT = 6000


def placeholder_catalogue() -> list[dict]:
    return [
        {"name": name, "label": label, "example": example} for name, label, example in PLACEHOLDERS
    ]


def unknown_placeholders(text: str) -> list[str]:
    seen: list[str] = []
    for name in _PLACEHOLDER.findall(text or ""):
        if name not in PLACEHOLDER_NAMES and name not in seen:
            seen.append(name)
    return seen


def fill_placeholders(text: str, context: dict) -> str:
    """Replace ``${name}`` for the known facts only; leave every other ``$`` be.

    ``string.Template`` would also rewrite ``$$`` and bare ``$name``, which a
    provider typing prices into free text did not mean as syntax.
    """
    return _PLACEHOLDER.sub(
        lambda match: str(context[match.group(1)])
        if match.group(1) in PLACEHOLDER_NAMES and match.group(1) in context
        else match.group(0),
        text or "",
    )


def assert_may_manage(*, organization, user) -> None:
    """The people who prepare agreements are the ones who keep their wording."""
    from apps.organization.services import active_membership, membership_access

    membership = active_membership(organization=organization, user=user)
    if membership is None or not membership_access(membership)["can"]["operate_properties"]:
        raise PermissionDenied("You cannot manage agreement templates for this Portfolio.")


def _clean(data: dict, *, partial: bool) -> dict:
    cleaned: dict = {}
    if "name" in data or not partial:
        name = str(data.get("name") or "").strip()
        if not name:
            raise ValidationFailed("Give the template a name.")
        if len(name) > NAME_LIMIT:
            raise ValidationFailed(f"Keep the name under {NAME_LIMIT} characters.")
        cleaned["name"] = name
    if "body" in data or not partial:
        body = str(data.get("body") or "").strip()
        if not body:
            raise ValidationFailed("Write the terms this template adds.")
        if len(body) > BODY_LIMIT:
            raise ValidationFailed(f"Keep the terms under {BODY_LIMIT} characters.")
        unknown = unknown_placeholders(body)
        if unknown:
            listed = ", ".join(f"${{{name}}}" for name in unknown)
            verb = "is not a placeholder" if len(unknown) == 1 else "are not placeholders"
            raise ValidationFailed(f"{listed} {verb} Rooomly can fill. Choose from the list.")
        cleaned["body"] = body
    if "is_default" in data:
        cleaned["is_default"] = bool(data["is_default"])
    return cleaned


def list_templates(*, organization, user):
    assert_may_manage(organization=organization, user=user)
    return TermsTemplate.objects.filter(organization=organization)


@transaction.atomic
def create_template(*, organization, user, data: dict) -> TermsTemplate:
    assert_may_manage(organization=organization, user=user)
    cleaned = _clean(data, partial=False)
    if cleaned.get("is_default"):
        TermsTemplate.objects.filter(organization=organization, is_default=True).update(
            is_default=False
        )
    template = TermsTemplate.objects.create(organization=organization, created_by=user, **cleaned)
    record(
        action=AuditAction.CREATE,
        aggregate_type="terms_template",
        aggregate_id=template.id,
        actor=user,
        metadata={"organization_id": str(organization.id), "is_default": template.is_default},
    )
    return template


@transaction.atomic
def update_template(*, template: TermsTemplate, user, data: dict) -> TermsTemplate:
    assert_may_manage(organization=template.organization, user=user)
    cleaned = _clean(data, partial=True)
    if cleaned.get("is_default"):
        TermsTemplate.objects.filter(organization=template.organization, is_default=True).exclude(
            id=template.id
        ).update(is_default=False)
    for field, value in cleaned.items():
        setattr(template, field, value)
    template.save()
    record(
        action=AuditAction.UPDATE,
        aggregate_type="terms_template",
        aggregate_id=template.id,
        actor=user,
        metadata={"fields": sorted(cleaned)},
    )
    return template


@transaction.atomic
def delete_template(*, template: TermsTemplate, user) -> None:
    assert_may_manage(organization=template.organization, user=user)
    record(
        action=AuditAction.DELETE,
        aggregate_type="terms_template",
        aggregate_id=template.id,
        actor=user,
        metadata={"organization_id": str(template.organization_id)},
    )
    template.delete()
