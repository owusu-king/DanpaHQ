"""Which properties for sale the public may see, derived rather than stored.

A property for sale is advertised **exactly while** three things hold:

* its seller has it on the market (`SaleStatus.ACTIVE`),
* its authority review — the seller's relationship *and* the title — is current,
* its condition review — the photographs a buyer will see — is current.

The last two are the property's verification, and "current" means approved and
not past its expiry (`VerificationQuerySet.current`). So verification publishes
it the moment it passes, and a revocation or an expiry unpublishes it the moment
it happens, with no job to run and no flag to fall out of step (owner,
2026-09-28: "after verification, it goes straight to public").
"""

from __future__ import annotations

from django.db.models import CharField, Exists, OuterRef, QuerySet
from django.db.models.functions import Cast

from .models import SaleListing, SaleStatus


def _current_checks():
    from apps.trust.models import SubjectType, Verification

    return Verification.objects.current().filter(
        subject_type=SubjectType.PROPERTY,
        subject_id=Cast(OuterRef("property_id"), output_field=CharField()),
    )


def public_sales() -> QuerySet[SaleListing]:
    from apps.trust.models import VerificationKind

    checks = _current_checks()
    return (
        SaleListing.objects.filter(
            status=SaleStatus.ACTIVE,
            property__purpose="sale",
            property__deleted_at__isnull=True,
        )
        .annotate(
            _authority=Exists(checks.filter(kind=VerificationKind.PROPERTY_AUTHORITY)),
            _condition=Exists(checks.filter(kind=VerificationKind.PROPERTY_CONDITION)),
        )
        .filter(_authority=True, _condition=True)
    )


def is_public(sale: SaleListing) -> bool:
    return public_sales().filter(id=sale.id).exists()
