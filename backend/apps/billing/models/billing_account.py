"""Who Danpa HQ bills, and the state of that relationship.

**The Portfolio is the subscriber, never the User.** An individual landlord's
personal Portfolio can hold Pro; a property company can hold Business; several
people can work inside one paid Portfolio; and handing the Portfolio to a new
owner does not disturb what it pays for. Putting a plan on a `User` would break
every one of those, and it is the single most expensive thing to get wrong here
because unwinding it means migrating live subscriptions.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel


class BillingAccountStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    #: Premium *creation* is closed; nothing already recorded is withheld.
    #: A provider whose card failed still reaches their leases, their tenants,
    #: their rent history and their receipts. Those are records people have a
    #: legal and practical need for, and a billing dispute is not a reason to
    #: take them away.
    RESTRICTED = "restricted", "Restricted"
    CLOSED = "closed", "Closed"


class BillingAccount(BaseModel):
    organization = models.OneToOneField(
        "organization.Organization",
        on_delete=models.PROTECT,
        related_name="billing_account",
    )
    #: Where invoices go. Blank until somebody buys something — a Free Portfolio
    #: is never asked for billing details, and asking would be the first lie in
    #: a "free" plan.
    billing_email = models.EmailField(blank=True)
    currency = models.CharField(max_length=3, default="GHS")
    status = models.CharField(
        max_length=16,
        choices=BillingAccountStatus.choices,
        default=BillingAccountStatus.ACTIVE,
    )

    class Meta:
        db_table = "billing_account"
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"billing:{self.organization_id}"
