"""What a Portfolio's plan still runs in full, when it holds more than the plan includes.

A plan's limits cap what a Portfolio *operates*, not what it keeps. When the
limits in force fall below what it holds — a downgrade, a cancellation taking
effect, a renewal left past due — nothing is deleted, and nothing about a
property's or a unit's own lifecycle changes. The resources above the allowance
are given a restricted access state instead, recorded here:

* **full** — within the allowance. The default, and never stored: a resource
  with no row is fully active.
* **wind_down** — above the allowance, with a tenancy or an agreement still
  running. That arrangement continues to its end — rent, payments, receipts,
  documents, ending it — and nothing new starts.
* **read_only** — above the allowance, with nothing running. Everything stays
  readable and exportable; nothing new starts and the details stay as they are.

This is billing's record about a resource, not the resource's own state.
`Property` and `Unit` never learn about plans (ADR 0032 §5): domain services ask
`billing.enforcement`, and only `services.resource_access_service` writes here.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel


class AccessState(models.TextChoices):
    FULL = "full", "Fully active"
    WIND_DOWN = "wind_down", "Winding down"
    READ_ONLY = "read_only", "Read-only"


#: The only states a row holds. `FULL` is the absence of a row.
RESTRICTED_STATES = (AccessState.WIND_DOWN, AccessState.READ_ONLY)


class ResourceKind(models.TextChoices):
    PROPERTY = "property", "Property"
    UNIT = "unit", "Unit"


class ResourceAccess(BaseModel):
    """One property or unit held above the plan's allowance."""

    organization = models.ForeignKey(
        "organization.Organization", on_delete=models.CASCADE, related_name="resource_access"
    )
    kind = models.CharField(max_length=12, choices=ResourceKind.choices)
    #: Set for both kinds. A unit's row names its property too, so everything
    #: restricted about one property is one indexed read.
    property = models.ForeignKey(
        "property.Property", on_delete=models.CASCADE, related_name="billing_access"
    )
    unit = models.ForeignKey(
        "property.Unit",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="billing_access",
    )
    state = models.CharField(max_length=12, choices=AccessState.choices)
    #: The plan whose limits put it here — for the record, never for a decision.
    plan_code = models.CharField(max_length=16, blank=True)
    restricted_at = models.DateTimeField()
    state_changed_at = models.DateTimeField()

    class Meta:
        db_table = "billing_resource_access"
        ordering = ("restricted_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["property"],
                condition=models.Q(kind="property"),
                name="billing_one_access_row_per_property",
            ),
            models.UniqueConstraint(
                fields=["unit"],
                condition=models.Q(kind="unit"),
                name="billing_one_access_row_per_unit",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(kind="property", unit__isnull=True)
                    | models.Q(kind="unit", unit__isnull=False)
                ),
                name="billing_access_names_its_resource",
            ),
            # A fully active resource has no row, so a row saying `full` would
            # be a second answer to a question its absence already answers.
            models.CheckConstraint(
                condition=models.Q(state__in=["wind_down", "read_only"]),
                name="billing_access_rows_are_restrictions",
            ),
        ]
        indexes = [
            models.Index(
                fields=["organization", "kind", "state"], name="billing_access_org_kind_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind}:{self.unit_id or self.property_id} {self.state}"


class KeepActiveChoice(BaseModel):
    """A resource a Portfolio chose to keep fully active if its limits fall.

    Made on the downgrade review, before the change takes effect, and read when
    it does. A choice naming something archived since is ignored rather than
    refused: the choice is a preference, and the allowance is the rule.
    """

    organization = models.ForeignKey(
        "organization.Organization", on_delete=models.CASCADE, related_name="keep_active_choices"
    )
    kind = models.CharField(max_length=12, choices=ResourceKind.choices)
    property = models.ForeignKey("property.Property", on_delete=models.CASCADE, related_name="+")
    unit = models.ForeignKey(
        "property.Unit", null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    #: Order of preference, for when fewer can be kept than were chosen.
    position = models.PositiveSmallIntegerField(default=0)
    chosen_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "billing_keep_active_choice"
        ordering = ("position", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "property"],
                condition=models.Q(kind="property"),
                name="billing_one_choice_per_property",
            ),
            models.UniqueConstraint(
                fields=["organization", "unit"],
                condition=models.Q(kind="unit"),
                name="billing_one_choice_per_unit",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(kind="property", unit__isnull=True)
                    | models.Q(kind="unit", unit__isnull=False)
                ),
                name="billing_choice_names_its_resource",
            ),
        ]
