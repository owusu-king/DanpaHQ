"""Deliberate exceptions to what a plan grants.

An override is how a launch cohort, a negotiated Business limit or a support
resolution happens **without somebody editing the database**. That is the whole
point: the alternative to this table is a UPDATE run by hand at 11pm that
nothing records and nobody can find six months later.

Every override names a reason and an author, and every override can expire. A
promotion that never ends is a price change nobody decided.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class PortfolioPlanOverride(BaseModel):
    organization = models.ForeignKey(
        "organization.Organization",
        on_delete=models.PROTECT,
        related_name="plan_overrides",
    )
    entitlement = models.ForeignKey(
        "billing.Entitlement", on_delete=models.PROTECT, related_name="overrides"
    )
    value = models.JSONField(null=True, blank=True)
    is_unlimited = models.BooleanField(default=False)

    reason = models.CharField(max_length=300)
    #: Null means indefinite, which should be rare and is visible as such.
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    created_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_by_management_id = models.UUIDField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "billing_portfolio_plan_override"
        ordering = ("-created_at",)
        constraints = [
            # One live override per (Portfolio, entitlement). Two would mean two
            # answers, and the resolver would have to pick — which is a policy
            # nobody wrote down.
            models.UniqueConstraint(
                fields=["organization", "entitlement"],
                condition=models.Q(revoked_at__isnull=True),
                name="billing_one_live_override_per_entitlement",
            ),
            models.CheckConstraint(
                condition=models.Q(is_unlimited=False) | models.Q(value__isnull=True),
                name="billing_override_unlimited_has_no_value",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.organization_id}:{self.entitlement_id}"

    @property
    def is_live(self) -> bool:
        if self.revoked_at is not None:
            return False
        return self.expires_at is None or self.expires_at > timezone.now()
