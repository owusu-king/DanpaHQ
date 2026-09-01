"""The tenant's tenancies, as a portfolio.

`GET /me/occupancies/` has always returned every open occupancy, and both
clients collapsed the list to one — `find(active) ?? [0] ?? null` — so a tenant
renting two places saw one of them, chosen arbitrarily, with nothing on screen
saying the other existed.

The clients were also stitching: occupancies from here, leases from there,
charges per lease, joined in the browser. That stitching is where the
collapse lived, and three round trips per tenancy is a poor deal on a Ghanaian
mobile connection. This returns each tenancy whole, so there is nothing to
collapse and nothing to join.

P8 made `Tenancy` a real record, and this now reads it. The shape below is
unchanged from when it was a read model over occupancies — that was the point
of naming the fields for the tenancy rather than the occupancy at the time, and
neither client needs a change.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.money import Money
from apps.tenancy.models import CURRENT_STATUSES, Tenancy


class MyTenanciesView(APIView):
    """GET /me/tenancies/ — every tenancy this person holds, with its context.

    Ordered so the most recently started comes first; a tenant who has just
    moved is almost always asking about the new place.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        statuses = list(CURRENT_STATUSES)
        if request.query_params.get("include_ended") in {"1", "true", "yes"}:
            statuses.append("ended")
        rows = (
            Tenancy.objects.filter(tenant=request.user, status__in=statuses)
            .select_related(
                "property",
                "property__address__locality__district",
                "unit",
                "bed",
            )
            .prefetch_related("occupancies", "leases", "unit__media__file")
            .order_by("-started_on", "-created_at")
        )
        return Response([_tenancy(row) for row in rows])


def _tenancy(tenancy) -> dict:
    """One tenancy, with everything a portfolio row or a detail page needs."""
    # Function scope, not module scope: which statuses count as live is the
    # lease domain's vocabulary, and importing its models at the top of this
    # file would put an edge into the module graph that ADR 0002 forbids.
    from apps.lease.models import LeaseStatus

    # The live agreement, not merely the newest: a tenancy that has ended one
    # lease and not yet started another should show no terms rather than the
    # terms of something that is over.
    leases = list(tenancy.leases.all())
    lease = next(
        (
            row
            for row in leases
            if row.status
            in {
                LeaseStatus.OFFERED,
                LeaseStatus.AWAITING_ACTIVATION,
                LeaseStatus.ACTIVE,
            }
        ),
        None,
    )
    if lease is None and tenancy.status == "ended":
        lease = next((row for row in leases if row.status == LeaseStatus.ENDED), None)
    occupancy = next(
        (row for row in tenancy.occupancies.all() if row.ended_at is None),
        None,
    )
    address = getattr(tenancy.property, "address", None)

    return {
        "id": str(tenancy.id),
        # Kept because the clients already read it, and because the allocation
        # is still a separate fact worth naming — it is what a maintenance
        # request or an inspection is actually about.
        "occupancy_id": str(occupancy.id) if occupancy else None,
        "status": tenancy.status,
        "status_display": tenancy.get_status_display(),
        "starts_on": tenancy.started_on,
        "ends_on": occupancy.ends_on if occupancy else tenancy.ended_on,
        "property": {
            "id": str(tenancy.property_id),
            "title": tenancy.property.title,
            # Locality and district come through the address relation; there are
            # no denormalised name columns on Address.
            "locality": address.locality.name if address else "",
            "district": address.locality.district.name if address else "",
        },
        "space": {
            "unit_id": str(tenancy.unit_id),
            "unit_label": tenancy.unit.label,
            "space_type_label": tenancy.unit.get_space_type_display(),
            "bed_id": str(tenancy.bed_id) if tenancy.bed_id else None,
            "bed_label": tenancy.bed.label if tenancy.bed_id else None,
        },
        # Somebody's home should be recognizable on their own front door. A
        # tenancy may never have been advertised, so this is the Unit's own
        # primary photograph rather than any campaign cover.
        "photo_url": _photo(tenancy.unit),
        "lease": _lease(lease) if lease else None,
        "rent": _rent(lease) if lease else None,
    }


def _photo(unit) -> str | None:
    from apps.listing.serializers import participant_cover_url

    return participant_cover_url(unit=unit)


def _lease(lease) -> dict:
    return {
        "id": str(lease.id),
        "status": lease.status,
        "status_display": lease.get_status_display(),
        "rent_formatted": str(lease.rent) if lease.rent_minor else None,
        "rent_period": lease.rent_period,
        "starts_on": lease.starts_on,
        "ends_on": lease.ends_on,
    }


def _rent(lease) -> dict | None:
    """What is owed, soonest first.

    Overdue is counted separately rather than folded into a balance: a single
    figure hides whether the money is late, and late is the part that changes
    what someone does today.
    """
    from apps.rent.models import RentCharge

    charges = list(RentCharge.objects.filter(lease=lease).order_by("due_on"))
    unpaid = [c for c in charges if c.outstanding_minor > 0]
    if not unpaid:
        return {
            "outstanding_count": 0,
            "overdue_count": 0,
            "outstanding_minor": 0,
            "outstanding_currency": "GHS",
            "outstanding_formatted": str(Money(0, "GHS")),
            "next_due": None,
        }

    overdue = [c for c in unpaid if c.is_overdue]
    soonest = unpaid[0]
    currency = soonest.amount_currency or "GHS"
    # The integers as well as the sentence. A client that has to add two
    # tenancies together cannot do it from "GH\u20b51,500.00" — money is summed
    # in minor units or it is not summed at all (ADR 0006), and parsing our own
    # display string back into a number is how rounding bugs get in.
    outstanding_minor = sum(c.outstanding_minor for c in unpaid)

    return {
        "outstanding_count": len(unpaid),
        "overdue_count": len(overdue),
        "outstanding_minor": outstanding_minor,
        "outstanding_currency": currency,
        "outstanding_formatted": str(Money(outstanding_minor, currency)),
        "next_due": {
            "id": str(soonest.id),
            "kind_display": soonest.get_kind_display(),
            "due_on": soonest.due_on,
            "amount_minor": soonest.outstanding_minor,
            "amount_currency": currency,
            "amount_formatted": (
                str(Money(soonest.outstanding_minor, currency))
                if soonest.outstanding_minor
                else None
            ),
            "is_overdue": soonest.is_overdue,
        },
    }
