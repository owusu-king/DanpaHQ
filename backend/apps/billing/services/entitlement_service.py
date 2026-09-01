"""The one place the application asks what a Portfolio may do.

Every feature check in Rooomly goes through `can`, `limit` or
`assert_within_limit`. Nothing anywhere compares a plan code — the whole reason
this module exists is that `if portfolio.plan == "PRO"` scattered through a
codebase makes packaging impossible to change and impossible to audit, and it
is wrong the moment an override, a grace period or a fourth plan appears.

**Resolution order**, most specific first:

1. a live `PortfolioPlanOverride` — the deliberate exception, with a reason and
   usually an expiry;
2. the entitled subscription's plan;
3. the `FREE` plan, when a Portfolio has no live subscription at all.

Falling back to Free rather than to "deny everything" matters: a Portfolio whose
billing row is missing is a Rooomly bug, and the person on the other end should
lose the paid extras, never their tenants.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from apps.core.exceptions import DomainError

from ..catalogue import UPGRADE_ORDER
from ..models import (
    ENTITLED_STATUSES,
    Entitlement,
    Plan,
    PlanEntitlement,
    PortfolioPlanOverride,
    Subscription,
)


class PlanLimitReached(DomainError):
    """A refusal that tells the client exactly what to offer next.

    Carried in `details` rather than at the top level because this codebase has
    one error envelope and every client parses it — see `core.exceptions`. The
    fields are the ones the spec named, so the upgrade prompt can be built
    without a second request.
    """

    code = "plan_limit_reached"
    status_code = 409
    message = "That would go past this Portfolio's plan limit."


class PlanFeatureUnavailable(DomainError):
    code = "plan_feature_unavailable"
    status_code = 403
    message = "That is not included in this Portfolio's plan."


@dataclass(frozen=True, slots=True)
class Grant:
    """What a Portfolio is granted for one entitlement, and where it came from.

    `source` is here so a billing screen, a support conversation and a test can
    all tell a plan value from an override without inferring it.
    """

    key: str
    value: object | None
    is_unlimited: bool
    source: str  # "override" | "plan" | "default"
    plan_code: str

    @property
    def allowed(self) -> bool:
        return bool(self.is_unlimited or self.value)


def _free_plan() -> Plan:
    return Plan.objects.get(code="FREE")


def active_subscription(*, organization) -> Subscription | None:
    """The subscription that currently decides entitlements, if there is one.

    Grace counts. A renewal that failed this morning has not taken away what the
    Portfolio bought — that is what §16 of the monetization spec is about, and
    it is why `ENTITLED_STATUSES` exists rather than a bare `ACTIVE` check.
    """
    return (
        Subscription.objects.filter(
            billing_account__organization=organization,
            status__in=ENTITLED_STATUSES,
        )
        .select_related("plan", "billing_account")
        .order_by("-created_at")
        .first()
    )


def current_plan(*, organization) -> Plan:
    subscription = active_subscription(organization=organization)
    return subscription.plan if subscription is not None else _free_plan()


def _plan_values(plan: Plan) -> dict[str, PlanEntitlement]:
    """Plan values, cached briefly.

    A plan's packaging changes rarely and is read on nearly every write, so this
    is the one thing worth caching. Keyed on the plan and invalidated by time
    only — a limit raised through the admin is visible within the window, and
    the window is short enough that nobody notices except under load.
    """
    key = f"billing:plan-values:{plan.pk}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    values = {
        row.entitlement.key: row
        for row in PlanEntitlement.objects.filter(plan=plan).select_related("entitlement")
    }
    cache.set(key, values, 60)
    return values


def _override(*, organization, key: str) -> PortfolioPlanOverride | None:
    now = timezone.now()
    return (
        PortfolioPlanOverride.objects.filter(
            organization=organization,
            entitlement__key=key,
            revoked_at__isnull=True,
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        .select_related("entitlement")
        .first()
    )


def grant(*, organization, key: str) -> Grant:
    """Resolve one entitlement for one Portfolio."""
    plan = current_plan(organization=organization)

    override = _override(organization=organization, key=key)
    if override is not None:
        return Grant(
            key=key,
            value=override.value,
            is_unlimited=override.is_unlimited,
            source="override",
            plan_code=plan.code,
        )

    row = _plan_values(plan).get(key)
    if row is None:
        # An entitlement the plan says nothing about. Denied rather than
        # allowed: a capability that reaches production before its packaging
        # does should be invisible, not free for everybody.
        return Grant(key=key, value=None, is_unlimited=False, source="default", plan_code=plan.code)
    return Grant(
        key=key,
        value=row.value,
        is_unlimited=row.is_unlimited,
        source="plan",
        plan_code=plan.code,
    )


def can(*, organization, key: str) -> bool:
    """Whether a boolean capability is available. The everyday call."""
    return grant(organization=organization, key=key).allowed


def limit(*, organization, key: str) -> int | None:
    """The ceiling for a counted entitlement. `None` means unlimited."""
    resolved = grant(organization=organization, key=key)
    if resolved.is_unlimited:
        return None
    if resolved.value is None:
        return 0
    return int(resolved.value)


def assert_can(*, organization, key: str) -> None:
    if can(organization=organization, key=key):
        return
    entitlement = Entitlement.objects.filter(key=key).first()
    raise PlanFeatureUnavailable(
        f"{entitlement.name if entitlement else key} is not included in this Portfolio's plan.",
        details={
            "entitlement": key,
            "current_plan": current_plan(organization=organization).code,
            "recommended_plan": recommended_plan(key=key, needed=1),
        },
    )


def assert_within_limit(*, organization, key: str, metric: str, adding: int = 1) -> int:
    """Refuse if adding `adding` more would pass the limit. Returns the new count.

    The count is read here, at the moment of the decision, and the caller is
    expected to be inside the same transaction that creates the resource with
    the Portfolio row locked — see `enforcement.py`. Checking a limit and then
    creating outside one transaction is how two concurrent requests both find
    one slot free.
    """
    from . import usage_service

    ceiling = limit(organization=organization, key=key)
    current = usage_service.current(organization=organization, metric=metric)
    if ceiling is None or current + adding <= ceiling:
        return current + adding

    entitlement = Entitlement.objects.filter(key=key).first()
    raise PlanLimitReached(
        _limit_message(entitlement.name if entitlement else key, ceiling),
        details={
            "entitlement": key,
            "current": current,
            "limit": ceiling,
            "current_plan": current_plan(organization=organization).code,
            "recommended_plan": recommended_plan(key=key, needed=current + adding),
        },
    )


def _limit_message(name: str, ceiling: int) -> str:
    thing = name.lower()
    if ceiling == 1:
        return f"This Portfolio's plan includes 1 of your {thing}."
    return f"This Portfolio's plan includes {ceiling} {thing}."


def recommended_plan(*, key: str, needed: int) -> str | None:
    """The cheapest plan that would actually clear this.

    Recommending Business for a second property would be the sort of upsell that
    makes people distrust the whole screen, so this walks the ladder and stops
    at the first plan that genuinely helps. `None` when nothing does — which is
    the honest answer for a Business Portfolio at its ceiling, and the point at
    which a person rather than a banner should be involved.
    """
    plans = {plan.code: plan for plan in Plan.objects.filter(is_active=True)}
    for code in UPGRADE_ORDER:
        plan = plans.get(code)
        if plan is None:
            continue
        row = _plan_values(plan).get(key)
        if row is None:
            continue
        if row.is_unlimited:
            return code
        if row.value is True:
            return code
        if isinstance(row.value, int) and not isinstance(row.value, bool) and row.value >= needed:
            return code
    return None


def snapshot(*, organization) -> dict:
    """Everything a billing screen needs, in one read.

    The same data the backend enforces with. The client renders from it and
    **never decides with it** — every one of these checks is repeated on the
    server at the moment of the write.
    """
    from . import usage_service

    plan = current_plan(organization=organization)
    subscription = active_subscription(organization=organization)
    keys = list(Entitlement.objects.values_list("key", flat=True))
    usage = usage_service.snapshot(organization=organization)

    entitlements = {}
    for key in keys:
        resolved = grant(organization=organization, key=key)
        entitlements[key] = {
            "value": None if resolved.is_unlimited else resolved.value,
            "unlimited": resolved.is_unlimited,
            "source": resolved.source,
        }

    return {
        "plan": {
            "code": plan.code,
            "name": plan.name,
            "description": plan.description,
            "monthly_price_minor": plan.monthly_price_minor,
            "currency": plan.monthly_price_currency,
        },
        "subscription": (
            {
                "status": subscription.status,
                "billing_interval": subscription.billing_interval,
                "current_period_end": (
                    subscription.current_period_end.isoformat()
                    if subscription.current_period_end
                    else None
                ),
                "cancel_at_period_end": subscription.cancel_at_period_end,
            }
            if subscription is not None
            else None
        ),
        "entitlements": entitlements,
        "usage": usage,
        "limits": {
            "PROPERTY_LIMIT": limit(organization=organization, key="PROPERTY_LIMIT"),
            "UNIT_LIMIT": limit(organization=organization, key="UNIT_LIMIT"),
            "TEAM_MEMBER_LIMIT": limit(organization=organization, key="TEAM_MEMBER_LIMIT"),
        },
        "over_limit": over_limit(organization=organization),
    }


def over_limit(*, organization) -> list[dict]:
    """Where this Portfolio currently sits above what its plan includes.

    A downgrade never deletes anything, so a Portfolio can legitimately hold
    more than its plan allows. That is a state to describe, not an error: it
    stops new creation and nothing else.
    """
    from . import usage_service

    pairs = [
        ("PROPERTY_LIMIT", usage_service.PROPERTY_COUNT),
        ("UNIT_LIMIT", usage_service.UNIT_COUNT),
        ("TEAM_MEMBER_LIMIT", usage_service.TEAM_MEMBER_COUNT),
    ]
    exceeded = []
    for key, metric in pairs:
        ceiling = limit(organization=organization, key=key)
        if ceiling is None:
            continue
        current = usage_service.current(organization=organization, metric=metric)
        if current > ceiling:
            exceeded.append({"entitlement": key, "current": current, "limit": ceiling})
    return exceeded
