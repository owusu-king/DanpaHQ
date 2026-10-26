"""Reading a passport out of the records that own each fact.

One function, `assemble`, serves both readers — the tenant looking at their own
passport and a recipient opening a share link — so the preview a tenant is shown
before sharing is, by construction, what the recipient will see. The audience
changes only the wording of a dispute ("you asked" / "the tenant asked") and
whether correction controls are offered; the scope decides everything else.

The vocabulary, used on every record and nowhere softened:

* ``verified``   — checked by Danpa HQ or a payment provider against something
  outside the parties' word: a reviewed Ghana Card, a one-time code, a payment
  the provider confirmed server-side.
* ``confirmed``  — agreed by both parties on Danpa HQ: an agreement both accepted,
  a payment the other side confirmed.
* ``pending``    — waiting on the other party or on a review.
* ``disputed``   — a party disagrees, or the tenant has asked for a correction.
* ``unverified`` — recorded, or claimed, but not checked.
* ``expired``    — a check that held and has lapsed.

Cross-domain reads go through each domain's own functions where one exists and
function-scoped model imports where the read is a plain lookup, as the tenancy
portfolio view does; see ADR 0002.
"""

from __future__ import annotations

from datetime import date, datetime

from django.utils import timezone

from apps.core.money import Money

#: Things a landlord might reasonably look for that Danpa HQ does not record
#: yet. Said out loud on every passport so their absence is never read as a
#: tenant having none.
NOT_RECORDED = ("inspections", "references")

_OPEN_CASE = {"open", "in_review"}


# --- scope ------------------------------------------------------------------


def full_scope() -> dict:
    """The owner's own view: everything, amounts included."""
    return {"identity": True, "tenancy_ids": None, "payments": True, "amounts": True}


def eligible_tenancies(user):
    """The tenancies a passport may speak about.

    Live ones in any state, and ended ones that were real Danpa HQ tenancies —
    opened by an accepted agreement. A provider's pending record that ended
    without one never became a tenancy and is not history.
    """
    from django.db.models import Q

    from apps.tenancy.models import Tenancy, TenancyStatus

    return (
        Tenancy.objects.filter(tenant=user)
        .filter(
            Q(
                status__in=[
                    TenancyStatus.PENDING_LEASE,
                    TenancyStatus.UPCOMING,
                    TenancyStatus.ACTIVE,
                ]
            )
            | Q(status=TenancyStatus.ENDED, activation_lease__isnull=False)
        )
        .select_related(
            "property",
            "property__address__locality__district",
            "unit",
            "bed",
            "activation_lease",
        )
        .prefetch_related("leases")
        .order_by("-started_on", "-created_at")
    )


# --- corrections --------------------------------------------------------------


def correction_states(user) -> dict[tuple[str, str], dict]:
    """The latest correction per record, with its review state, newest first."""
    from apps.operations.services import support_case_states

    from .models import PassportCorrection

    rows = list(PassportCorrection.objects.filter(owner=user).order_by("-created_at"))
    cases = support_case_states(user=user, case_ids=[row.support_case_id for row in rows])
    latest: dict[tuple[str, str], dict] = {}
    for row in rows:
        key = (row.record_type, row.record_id)
        if key in latest:
            continue
        case = cases.get(str(row.support_case_id)) if row.support_case_id else None
        case_status = case["status"] if case else "open"
        latest[key] = {
            "id": str(row.id),
            "state": (
                "under_review"
                if case_status in _OPEN_CASE
                else "resolved"
                if case_status == "resolved"
                else "closed"
            ),
            "reported_on": row.created_at.date(),
            "closed_on": (case or {}).get("resolved_at") or None,
            "reason": row.reason,
            "support_case_id": str(row.support_case_id) if row.support_case_id else None,
        }
    return latest


def _review(correction: dict | None, audience: str) -> dict | None:
    """What a reader is told about an open correction on a record."""
    if not correction or correction["state"] != "under_review":
        return None
    return {
        "since": correction["reported_on"],
        "note": (
            "You asked Danpa HQ to review this record."
            if audience == "owner"
            else "The tenant has asked Danpa HQ to review this record."
        ),
    }


# --- identity ----------------------------------------------------------------


def _identity(user, *, review: dict | None) -> dict:
    from apps.trust.services import trust_summary

    summary = trust_summary("user", user.id)

    def stamp(kind: str, title: str, detail: str, words: dict[str, str]) -> dict:
        row = summary.get(kind) or {}
        state = row.get("state") or "unverified"
        return {
            "key": kind,
            "title": title,
            "detail": detail,
            "status": state,
            "basis": words.get(state, words["unverified"]),
            "as_of": _day(row.get("decided_at")) if state in {"verified", "expired"} else None,
            "valid_until": _day(row.get("expires_at")) if state == "verified" else None,
        }

    credentials = [
        stamp(
            "identity",
            "Identity",
            "Ghana Card",
            {
                "verified": "Ghana Card reviewed by Danpa HQ",
                "pending": "Submitted and waiting for Danpa HQ review",
                "expired": "Checked by Danpa HQ; the check has lapsed",
                "unverified": "Not verified by Danpa HQ",
            },
        ),
    ]
    face = summary.get("selfie_match") or {}
    if (face.get("state") or "unverified") != "unverified":
        credentials.append(
            stamp(
                "selfie_match",
                "Face match",
                "Matches the Ghana Card photo",
                {
                    "verified": "Compared with the Ghana Card by Danpa HQ",
                    "pending": "Waiting for Danpa HQ review",
                    "expired": "Checked by Danpa HQ; the check has lapsed",
                    "unverified": "Not verified",
                },
            )
        )
    credentials.append(
        stamp(
            "phone",
            "Phone number",
            "Ghana mobile number",
            {
                "verified": "Confirmed by one-time code",
                "pending": "Waiting for a one-time code",
                "expired": "Confirmed by one-time code; due to be confirmed again",
                "unverified": "Not confirmed",
            },
        )
    )
    credentials.append(
        {
            "key": "email",
            "title": "Email address",
            "detail": "Contact email",
            "status": "verified" if user.is_email_verified else "unverified",
            "basis": "Confirmed by emailed code" if user.is_email_verified else "Not confirmed",
            "as_of": None,
            "valid_until": None,
        }
    )
    # A correction about identity is about the group, not each check: someone
    # saying their name is wrong has not cast doubt on their phone number.
    return {"credentials": credentials, "review": review}


# --- tenancies -----------------------------------------------------------------


def _accepted_leases(tenancy) -> list:
    """The agreements both parties accepted for this tenancy, oldest first."""
    from apps.lease.models import LeaseStatus

    accepted = [
        lease
        for lease in tenancy.leases.all()
        if lease.status not in {LeaseStatus.DECLINED, LeaseStatus.CANCELLED}
        and (lease.tenant_accepted_at or lease.activated_at)
    ]
    return sorted(accepted, key=lambda lease: lease.tenant_accepted_at or lease.activated_at)


def _tenancy(tenancy, *, payments: bool, amounts: bool, corrections: dict, audience: str, today):
    from apps.lease.models import LeaseStatus
    from apps.property.verification import lifecycle
    from apps.rent.services import payment_record

    leases = _accepted_leases(tenancy)
    opened = tenancy.activation_lease or (leases[0] if leases else None)
    live = next(
        (
            row
            for row in leases
            if row.status in {LeaseStatus.ACTIVE, LeaseStatus.AWAITING_ACTIVATION}
        ),
        None,
    )
    address = getattr(tenancy.property, "address", None)

    if tenancy.status == "pending_lease" or opened is None:
        credential = {
            "status": "pending",
            "basis": "Recorded by the provider; no agreement accepted on Danpa HQ yet",
            "as_of": None,
        }
    else:
        credential = {
            "status": "confirmed",
            "basis": "Agreement accepted by the tenant and the provider on Danpa HQ",
            "as_of": _day(opened.tenant_accepted_at or opened.activated_at),
        }

    review = _review(corrections.get(("tenancy", str(tenancy.id))), audience)
    if review:
        credential["status_before_review"] = credential["status"]
        credential["status"] = "disputed"

    standing = lifecycle(tenancy.property)
    started = tenancy.started_on
    ended = tenancy.ended_on if tenancy.status == "ended" else None

    row = {
        "id": str(tenancy.id),
        "place": {
            "title": tenancy.property.title,
            "space": tenancy.space_label,
            "space_type": tenancy.unit.get_space_type_display(),
            "locality": address.locality_label if address else "",
            "district": address.district_label if address else "",
        },
        "status": tenancy.status,
        "started_on": started,
        "ended_on": ended,
        "agreed_until": live.ends_on if live else None,
        "months": _months(started, ended or today) if started and started <= today else 0,
        "agreements": len(leases),
        "credential": credential,
        "review": review,
        "property": {
            "verified": standing["review_state"] == "verified",
            "as_of": _day(standing.get("decided_at"))
            if standing["review_state"] == "verified"
            else None,
        },
        "rent": None,
        "payments": None,
    }

    if amounts and (live or opened):
        lease = live or leases[-1]
        row["rent"] = {"formatted": str(lease.rent), "period": lease.rent_period}

    if payments:
        record = payment_record(lease_ids=[lease.id for lease in leases], today=today)
        row["payments"] = _payments(
            record,
            amounts=amounts,
            review=_review(corrections.get(("payments", str(tenancy.id))), audience),
        )
    return row


def _payments(record: dict, *, amounts: bool, review: dict | None) -> dict:
    confirmed = record["confirmed_count"]
    if record["disputed_count"]:
        status, basis = "disputed", "A recorded payment is disputed between the parties"
    elif confirmed and record["provider_confirmed_count"] == confirmed:
        status, basis = "verified", "Confirmed by the payment provider"
    elif confirmed and record["provider_confirmed_count"]:
        status, basis = "confirmed", "Confirmed by the payment provider or by both parties"
    elif confirmed:
        status, basis = "confirmed", "Confirmed by both parties on Danpa HQ"
    elif record["awaiting_confirmation_count"]:
        status, basis = "pending", "Recorded and waiting for the other party to confirm"
    else:
        status, basis = "none", "No rent payments recorded on Danpa HQ for this tenancy"

    out = {
        "status": status,
        "basis": basis,
        "confirmed": confirmed,
        "provider_confirmed": record["provider_confirmed_count"],
        "on_time": record["charges_on_time"],
        "late": record["charges_late"],
        "overdue": record["charges_overdue"],
        "awaiting": record["awaiting_confirmation_count"],
        "disputed": record["disputed_count"],
        "first_paid_on": record["first_paid_on"],
        "last_paid_on": record["last_paid_on"],
        "total_formatted": str(Money(record["confirmed_total_minor"], "GHS")) if amounts else None,
        "review": review,
    }
    if review:
        out["status_before_review"] = out["status"]
        out["status"] = "disputed"
    return out


# --- the whole -------------------------------------------------------------------


def assemble(user, *, scope: dict, audience: str = "owner") -> dict:
    """The passport as one reader may see it.

    ``scope`` is ``{identity, tenancy_ids, payments, amounts}``; ``tenancy_ids``
    of ``None`` means every eligible tenancy, and any id that is not one of this
    person's eligible tenancies is silently not there.
    """
    today = timezone.localdate()
    corrections = correction_states(user)

    rows = list(eligible_tenancies(user))
    wanted = scope.get("tenancy_ids")
    if wanted is not None:
        wanted = {str(value) for value in wanted}
        rows = [row for row in rows if str(row.id) in wanted]

    tenancies = [
        _tenancy(
            row,
            payments=bool(scope.get("payments")),
            amounts=bool(scope.get("amounts")),
            corrections=corrections,
            audience=audience,
            today=today,
        )
        for row in rows
    ]

    identity = (
        _identity(user, review=_review(corrections.get(("identity", "")), audience))
        if scope.get("identity")
        else None
    )

    return {
        "holder": _holder(user),
        "sections": {
            "identity": bool(scope.get("identity")),
            "tenancies": len(tenancies),
            "payments": bool(scope.get("payments")),
            "amounts": bool(scope.get("amounts")),
        },
        "summary": _summary(tenancies, today, payments=bool(scope.get("payments"))),
        "identity": identity,
        "tenancies": tenancies,
        "timeline": _timeline(user, identity, tenancies, rows, today),
        "not_recorded": list(NOT_RECORDED),
    }


def _holder(user) -> dict:
    name = " ".join(part for part in (user.first_name, user.last_name) if part).strip()
    name = name or user.display_name
    initials = "".join(part[0] for part in name.split()[:2]).upper() or "D"
    return {
        "name": name,
        "initials": initials,
        "member_since": user.created_at.date(),
    }


def _summary(tenancies: list[dict], today, *, payments: bool) -> dict:
    """The few numbers worth reading first. Counts, never a score."""
    agreed = [row for row in tenancies if row["credential"].get("as_of")]
    starts = [row["started_on"] for row in agreed if row["started_on"]]
    ends = [row["ended_on"] or today for row in agreed if row["started_on"]]
    ongoing = any(row["status"] in {"active", "upcoming"} for row in agreed)
    ledgers = [row["payments"] for row in tenancies if row["payments"]]
    return {
        "tenancies": len(agreed),
        "current": sum(1 for row in agreed if row["status"] == "active"),
        "months": sum(row["months"] for row in agreed),
        "period": {
            "from": min(starts) if starts else None,
            "to": None if ongoing else (max(ends) if ends else None),
            "ongoing": ongoing,
        },
        # Null only when payments are outside the scope; zero is a real count.
        "payments_confirmed": sum(row["confirmed"] for row in ledgers) if payments else None,
        "payments_on_time": sum(row["on_time"] for row in ledgers) if payments else None,
        "payments_late": sum(row["late"] for row in ledgers) if payments else None,
    }


def _timeline(user, identity, tenancies: list[dict], rows, today) -> list[dict]:
    """The milestones, newest first. Each one is a fact with its own source."""
    events: list[dict] = []
    if identity:
        first = identity["credentials"][0]
        if first["status"] in {"verified", "expired"} and first["as_of"]:
            events.append(
                {
                    "on": first["as_of"],
                    "kind": "identity",
                    "title": "Identity verified",
                    "detail": "Ghana Card reviewed by Danpa HQ",
                }
            )

    by_id = {str(row.id): row for row in rows}
    for item in tenancies:
        place = " · ".join(
            part for part in (item["place"]["title"], item["place"]["space"]) if part
        )
        leases = _accepted_leases(by_id[item["id"]])
        for index, lease in enumerate(leases):
            accepted = _day(lease.tenant_accepted_at or lease.activated_at)
            if accepted:
                events.append(
                    {
                        "on": accepted,
                        "kind": "agreement",
                        "title": "Agreement accepted" if index == 0 else "Agreement renewed",
                        "detail": place,
                        "tenancy_id": item["id"],
                    }
                )
        if item["started_on"] and item["credential"].get("as_of"):
            events.append(
                {
                    "on": item["started_on"],
                    "kind": "moved_in" if item["started_on"] <= today else "upcoming",
                    "title": "Tenancy began" if item["started_on"] <= today else "Tenancy starts",
                    "detail": place,
                    "tenancy_id": item["id"],
                }
            )
        if item["ended_on"]:
            events.append(
                {
                    "on": item["ended_on"],
                    "kind": "ended",
                    "title": "Tenancy ended",
                    "detail": place,
                    "tenancy_id": item["id"],
                }
            )

    events.append(
        {"on": user.created_at.date(), "kind": "joined", "title": "Joined Danpa HQ", "detail": ""}
    )
    events.sort(key=lambda event: (event["on"], _ORDER.get(event["kind"], 0)), reverse=True)
    return events


#: Same-day ties, latest in the story first when read newest-first.
_ORDER = {"joined": 0, "identity": 1, "agreement": 2, "moved_in": 3, "upcoming": 3, "ended": 4}


def _day(value) -> date | None:
    if isinstance(value, datetime):
        return timezone.localtime(value).date() if timezone.is_aware(value) else value.date()
    return value


def _months(start: date, end: date) -> int:
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day < start.day:
        months -= 1
    return max(months, 0)
