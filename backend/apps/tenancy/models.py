"""Tenancy — the relationship, as distinct from the agreement and the room.

Three things were being conflated, and each of them is a different fact:

* **Lease** is the *agreement*. It has terms, it is offered and accepted, and
  when it is renegotiated a new one supersedes it.
* **Occupancy** is the *allocation*. It says this person is in this space for
  this period, and it is what the exclusion constraints defend.
* **Tenancy** is the *relationship*. It is what survives both of the others.

The distinction earns its keep at renewal. A tenant who has been in the same
room for three years on three successive one-year leases has one tenancy, not
three, and every question worth asking - what have they paid, what has been
repaired, what was disputed - is a question about the tenancy. Hanging those off
the lease would scatter the answer across the renewals; hanging them off the
occupancy would tie them to a room rather than to the arrangement.

### Many per tenant, always

There is no `current_tenancy` here and there must not be one anywhere else. A
person renting a shop in Accra and a room in Kumasi holds two tenancies, both
live, neither primary. Which one is being looked at is a property of the
request, never of the person - see `docs/architecture/property-to-tenancy.md`.

### What deliberately is not here

Rent, payments, maintenance, inspections, notices, renewals and disputes all
belong to the tenancy, and none of them are built here. What this phase
provides is the anchor they attach to, so that when they are built they attach
to the relationship rather than to whichever of the three records happened to
be nearest. `apps.rent` still hangs off `Lease` and is left alone; moving it is
its own phase with its own migration.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel

#: `property` is a field name on `Tenancy` — the right one, and the one
#: `Occupancy` already uses — but it shadows the builtin inside the class body.
#: Captured here so the computed attributes further down can still be properties.
_py_property = property


class TenancyStatus(models.TextChoices):
    #: A real-world or approved relationship recorded for follow-up, but not an
    #: active Danpa HQ tenancy until an accepted lease activates it.
    PENDING_LEASE = "pending_lease", "Lease required"
    #: Agreed, but the start date has not arrived.
    UPCOMING = "upcoming", "Not started yet"
    ACTIVE = "active", "Active"
    ENDED = "ended", "Ended"


LIVE_STATUSES = (TenancyStatus.UPCOMING, TenancyStatus.ACTIVE)
CURRENT_STATUSES = (TenancyStatus.PENDING_LEASE, *LIVE_STATUSES)


class Tenancy(BaseModel):
    """One person's arrangement to live in or use one space."""

    tenant = models.ForeignKey("identity.User", on_delete=models.PROTECT, related_name="tenancies")
    property = models.ForeignKey(
        "property.Property", on_delete=models.PROTECT, related_name="tenancies"
    )
    unit = models.ForeignKey("property.Unit", on_delete=models.PROTECT, related_name="tenancies")
    #: Null when the whole unit is taken. Set for a bed in a shared room, which
    #: is how most student accommodation in this market is actually let.
    bed = models.ForeignKey(
        "property.Bed",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="tenancies",
    )

    #: The accepted agreement that first activated this relationship. A
    #: tenancy may later have renewals, but it can never become active without
    #: this database-backed link to the lease that opened it.
    activation_lease = models.ForeignKey(
        "lease.Lease",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="activated_tenancies",
    )

    status = models.CharField(
        max_length=16,
        choices=TenancyStatus.choices,
        default=TenancyStatus.PENDING_LEASE,
    )

    started_on = models.DateField(null=True, blank=True)
    ended_on = models.DateField(null=True, blank=True)
    #: Why it ended, in the words of whoever ended it. Kept because "the tenant
    #: left" and "we asked them to leave" are not the same fact.
    ended_reason = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = "tenancy_tenancy"
        ordering = ("-started_on", "-created_at")
        constraints = [
            # A person cannot hold two live tenancies of the same space. Split
            # by target for the same reason the lease constraints are: NULL is
            # not equal to NULL in Postgres, so one constraint over a nullable
            # `bed` would silently permit duplicates on whole-unit tenancies.
            #
            # Note what this does *not* say: that two different people cannot
            # both hold the space. That is the occupancy exclusion constraints'
            # job, and stating it twice would mean two places to get it wrong.
            models.UniqueConstraint(
                fields=["tenant", "unit"],
                condition=models.Q(
                    status__in=["pending_lease", "upcoming", "active"],
                    bed__isnull=True,
                ),
                name="tenancy_one_live_per_unit_per_tenant",
            ),
            models.UniqueConstraint(
                fields=["tenant", "unit", "bed"],
                condition=models.Q(
                    status__in=["pending_lease", "upcoming", "active"],
                    bed__isnull=False,
                ),
                name="tenancy_one_live_per_bed_per_tenant",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(status__in=["pending_lease", "ended"])
                    | models.Q(activation_lease__isnull=False)
                ),
                name="tenancy_active_requires_activation_lease",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "-started_on"], name="tenancy_tenant_idx"),
            models.Index(fields=["property", "status"], name="tenancy_property_idx"),
            models.Index(
                fields=["status", "-started_on"],
                name="tenancy_live_idx",
                condition=models.Q(status__in=["pending_lease", "upcoming", "active"]),
            ),
        ]

    def __str__(self) -> str:
        where = self.bed if self.bed_id else self.unit
        return f"tenancy of {where} by {self.tenant_id} ({self.status})"

    @_py_property
    def is_live(self) -> bool:
        return self.status in CURRENT_STATUSES

    @_py_property
    def space_label(self) -> str:
        """What to call the place, at the level it was actually let."""
        if self.bed_id:
            return f"{self.bed.label}, {self.unit.label}"
        return self.unit.label
