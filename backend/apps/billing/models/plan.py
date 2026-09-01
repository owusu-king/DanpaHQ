"""What a Portfolio can subscribe to, and what that buys.

Three plans, and exactly three. `FREE`, `PRO`, `BUSINESS` are the whole set and
the codes are immutable — a plan's *packaging* changes over time, its identity
does not, and everything that references a plan references the code.

**Prices and limits are rows, not code.** The point of this table and
`PlanEntitlement` is that raising the Pro property limit or changing the price
is a data change, reviewed and audited, not a deploy. Nothing in the application
may branch on a plan code; it asks the entitlement service what this Portfolio
can do. See ADR 0032.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import MoneyField
from apps.core.models import BaseModel


class PlanCode(models.TextChoices):
    """The complete set. Adding a fourth is a product decision, not a config one.

    Deliberately not `STARTER`/`PREMIUM`/`ENTERPRISE`: a plan ladder grows
    hidden rungs the moment the vocabulary allows it, and Business limits are
    configuration, which is what an Enterprise tier would otherwise have been.
    """

    FREE = "FREE", "Free"
    PRO = "PRO", "Pro"
    BUSINESS = "BUSINESS", "Business"


class ValueType(models.TextChoices):
    BOOLEAN = "boolean", "Yes or no"
    INTEGER = "integer", "A count"
    DECIMAL = "decimal", "An exact amount"
    STRING = "string", "A named value"


class Plan(BaseModel):
    code = models.CharField(max_length=16, choices=PlanCode.choices, unique=True)
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=300, blank=True)

    #: Integer minor units, per ADR 0006. A price is money and obeys the same
    #: rule every other amount in this codebase obeys: never a float, always
    #: carrying its currency.
    monthly_price = MoneyField()
    annual_price = MoneyField(null=True)

    is_active = models.BooleanField(default=True)
    #: Whether it appears in the public comparison. An inactive or private plan
    #: still resolves for Portfolios already on it — withdrawing a plan from
    #: sale must never withdraw it from the people paying for it.
    is_public = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "billing_plan"
        ordering = ("display_order", "code")

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):
        if not self._state.adding:
            existing = type(self).objects.filter(pk=self.pk).values_list("code", flat=True).first()
            if existing is not None and existing != self.code:
                raise RuntimeError(
                    "A plan code is immutable; everything that references a plan "
                    "references its code."
                )
        return super().save(*args, **kwargs)


class Entitlement(BaseModel):
    """One capability or limit, named independently of any plan.

    The separation is the whole architecture. `ADVANCED_REPORTING` is a thing
    the product either offers you or does not; which plans include it is a
    commercial decision that changes, and no code should have to change with it.
    """

    key = models.CharField(max_length=48, unique=True)
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True)
    value_type = models.CharField(max_length=12, choices=ValueType.choices)

    class Meta:
        db_table = "billing_entitlement"
        ordering = ("key",)

    def __str__(self) -> str:
        return self.key


class PlanEntitlement(BaseModel):
    """What one plan grants for one entitlement.

    `is_unlimited` is a real column rather than a sentinel number. A limit of
    999999 is a lie that eventually gets compared, printed, or summed, and the
    first person to see "999999 properties" on a billing screen learns something
    false about the product.
    """

    plan = models.ForeignKey(Plan, on_delete=models.CASCADE, related_name="entitlements")
    entitlement = models.ForeignKey(
        Entitlement, on_delete=models.PROTECT, related_name="plan_values"
    )
    #: Typed by `entitlement.value_type` and validated on the way in. JSON
    #: because one column has to hold a boolean, a count and a string; the
    #: type is not lost, it lives on the entitlement.
    value = models.JSONField(null=True, blank=True)
    is_unlimited = models.BooleanField(default=False)

    class Meta:
        db_table = "billing_plan_entitlement"
        ordering = ("plan", "entitlement")
        constraints = [
            models.UniqueConstraint(
                fields=["plan", "entitlement"], name="billing_plan_entitlement_unique"
            ),
            # "Unlimited, and also seventeen" is not a state anything should
            # have to interpret.
            models.CheckConstraint(
                condition=models.Q(is_unlimited=False) | models.Q(value__isnull=True),
                name="billing_unlimited_has_no_value",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.plan.code}:{self.entitlement.key}"
