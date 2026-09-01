"""The starting plan configuration, in one readable place.

**This is a default, not the source of truth.** Once seeded, the rows are the
truth and they are meant to be changed — raising the Pro property limit or
moving a capability between plans is a data change with an audit trail, not a
deploy. What lives here is the shape and the first values, so a fresh
environment starts coherent and so a reviewer can see the whole packaging at
once instead of reading nine migrations.

`sync_catalogue` is idempotent and additive: it creates what is missing and
leaves what exists alone. Re-running it must never quietly reset a limit
somebody deliberately raised.
"""

from __future__ import annotations

from decimal import Decimal

# --- entitlement keys ---------------------------------------------------------
#
# Named as constants so nothing in the application types a string. A typo in a
# feature check is a feature silently switched off, and it fails open or closed
# depending on the caller — which is the worst kind of bug to find in billing.

PROPERTY_LIMIT = "PROPERTY_LIMIT"
UNIT_LIMIT = "UNIT_LIMIT"
TEAM_MEMBER_LIMIT = "TEAM_MEMBER_LIMIT"

AUTOMATED_RENT_REMINDERS = "AUTOMATED_RENT_REMINDERS"
ADVANCED_REPORTING = "ADVANCED_REPORTING"
REPORT_EXPORTS = "REPORT_EXPORTS"
PORTFOLIO_ANALYTICS = "PORTFOLIO_ANALYTICS"

TEAM_MANAGEMENT = "TEAM_MANAGEMENT"
PROPERTY_ASSIGNMENTS = "PROPERTY_ASSIGNMENTS"
ACCOUNTANT_ACCESS = "ACCOUNTANT_ACCESS"

BULK_OPERATIONS = "BULK_OPERATIONS"
ADVANCED_PAYMENT_ANALYTICS = "ADVANCED_PAYMENT_ANALYTICS"
PRIORITY_SUPPORT = "PRIORITY_SUPPORT"
API_ACCESS = "API_ACCESS"

BOOLEAN = "boolean"
INTEGER = "integer"

ENTITLEMENTS: list[dict] = [
    {
        "key": PROPERTY_LIMIT,
        "name": "Properties",
        "value_type": INTEGER,
        "description": "How many properties this Portfolio may hold at once.",
    },
    {
        "key": UNIT_LIMIT,
        "name": "Units",
        "value_type": INTEGER,
        "description": "How many rentable spaces this Portfolio may hold at once.",
    },
    {
        "key": TEAM_MEMBER_LIMIT,
        "name": "Team members",
        "value_type": INTEGER,
        "description": "How many people may belong to this Portfolio at once.",
    },
    {
        "key": AUTOMATED_RENT_REMINDERS,
        "name": "Automated rent reminders",
        "value_type": BOOLEAN,
        "description": "Remind tenants automatically before and after rent is due.",
    },
    {
        "key": ADVANCED_REPORTING,
        "name": "Advanced reporting",
        "value_type": BOOLEAN,
        "description": "Financial reporting beyond the standard Portfolio summary.",
    },
    {
        "key": REPORT_EXPORTS,
        "name": "Report exports",
        "value_type": BOOLEAN,
        "description": "Download statements and reports.",
    },
    {
        "key": PORTFOLIO_ANALYTICS,
        "name": "Portfolio analytics",
        "value_type": BOOLEAN,
        "description": "Occupancy, arrears and collection trends across the Portfolio.",
    },
    {
        "key": TEAM_MANAGEMENT,
        "name": "Team management",
        "value_type": BOOLEAN,
        "description": "Invite people into the Portfolio and give them roles.",
    },
    {
        "key": PROPERTY_ASSIGNMENTS,
        "name": "Property assignments",
        "value_type": BOOLEAN,
        "description": "Scope a manager or staff member to particular properties.",
    },
    {
        "key": ACCOUNTANT_ACCESS,
        "name": "Accountant access",
        "value_type": BOOLEAN,
        "description": "A finance-only role that sees money without operational control.",
    },
    {
        "key": BULK_OPERATIONS,
        "name": "Bulk operations",
        "value_type": BOOLEAN,
        "description": "Act on many properties, units or tenancies at once.",
    },
    {
        "key": ADVANCED_PAYMENT_ANALYTICS,
        "name": "Payment analytics",
        "value_type": BOOLEAN,
        "description": "Collection performance, settlement timing and payment mix.",
    },
    {
        "key": PRIORITY_SUPPORT,
        "name": "Priority support",
        "value_type": BOOLEAN,
        "description": "Faster response from the Rooomly team.",
    },
    {
        "key": API_ACCESS,
        "name": "API access",
        "value_type": BOOLEAN,
        "description": "Programmatic access for integrations.",
    },
]

#: `None` means unlimited and is written as `is_unlimited=True`. It is never a
#: large number standing in for infinity.
#: How a plan comparison is laid out: which section each entitlement sits in and
#: the order they appear in it.
#:
#: Presentation, so it lives here rather than on the model. Moving a row on a
#: page is not a migration, and a `display_order` column would make it one. Any
#: entitlement missing from this list still renders — it falls to the end under
#: "More" — so adding one to the catalogue can never make it invisible.
ENTITLEMENT_GROUPS: list[tuple[str, list[str]]] = [
    ("Portfolio size", [PROPERTY_LIMIT, UNIT_LIMIT, TEAM_MEMBER_LIMIT]),
    ("Automation", [AUTOMATED_RENT_REMINDERS, BULK_OPERATIONS]),
    (
        "Reporting",
        [ADVANCED_REPORTING, PORTFOLIO_ANALYTICS, ADVANCED_PAYMENT_ANALYTICS, REPORT_EXPORTS],
    ),
    ("Team", [TEAM_MANAGEMENT, PROPERTY_ASSIGNMENTS, ACCOUNTANT_ACCESS]),
    ("Support and access", [PRIORITY_SUPPORT, API_ACCESS]),
]

#: The three limits a provider actually watches, in the order a screen shows
#: them. Named once so the API, the provider page and the console agree.
HEADLINE_LIMITS = [PROPERTY_LIMIT, UNIT_LIMIT, TEAM_MEMBER_LIMIT]


def entitlement_layout(keys) -> list[dict]:
    """Assign every known key to a group, in display order.

    Takes the keys that actually exist rather than assuming the catalogue and
    the database agree — a row added directly to the database still appears.
    """
    remaining = list(keys)
    ordered = []
    for group, group_keys in ENTITLEMENT_GROUPS:
        for key in group_keys:
            if key in remaining:
                remaining.remove(key)
                ordered.append({"key": key, "group": group})
    ordered.extend({"key": key, "group": "More"} for key in sorted(remaining))
    return ordered


UNLIMITED = object()

PLANS: list[dict] = [
    {
        "code": "FREE",
        "name": "Free",
        "description": "For individual landlords getting started.",
        "monthly_price": Decimal("0"),
        "annual_price": Decimal("0"),
        "display_order": 1,
        "entitlements": {
            PROPERTY_LIMIT: 1,
            UNIT_LIMIT: 5,
            TEAM_MEMBER_LIMIT: 1,
            AUTOMATED_RENT_REMINDERS: False,
            ADVANCED_REPORTING: False,
            REPORT_EXPORTS: False,
            PORTFOLIO_ANALYTICS: False,
            TEAM_MANAGEMENT: False,
            PROPERTY_ASSIGNMENTS: False,
            ACCOUNTANT_ACCESS: False,
            BULK_OPERATIONS: False,
            ADVANCED_PAYMENT_ANALYTICS: False,
            PRIORITY_SUPPORT: False,
            API_ACCESS: False,
        },
    },
    {
        "code": "PRO",
        "name": "Pro",
        "description": "For landlords managing a growing portfolio.",
        "monthly_price": Decimal("89"),
        "annual_price": Decimal("890"),
        "display_order": 2,
        "entitlements": {
            PROPERTY_LIMIT: 10,
            UNIT_LIMIT: 50,
            TEAM_MEMBER_LIMIT: 3,
            AUTOMATED_RENT_REMINDERS: True,
            ADVANCED_REPORTING: True,
            REPORT_EXPORTS: True,
            PORTFOLIO_ANALYTICS: True,
            TEAM_MANAGEMENT: True,
            PROPERTY_ASSIGNMENTS: False,
            ACCOUNTANT_ACCESS: False,
            BULK_OPERATIONS: False,
            ADVANCED_PAYMENT_ANALYTICS: True,
            PRIORITY_SUPPORT: True,
            API_ACCESS: False,
        },
    },
    {
        "code": "BUSINESS",
        "name": "Business",
        "description": "For professional property operations and teams.",
        "monthly_price": Decimal("299"),
        "annual_price": Decimal("2990"),
        "display_order": 3,
        "entitlements": {
            # High rather than unlimited by default: a Business Portfolio with
            # a stated ceiling can be raised deliberately by an override or a
            # configuration change, and a real number is something a salesperson
            # and a customer can both point at.
            PROPERTY_LIMIT: 100,
            UNIT_LIMIT: 1000,
            TEAM_MEMBER_LIMIT: 25,
            AUTOMATED_RENT_REMINDERS: True,
            ADVANCED_REPORTING: True,
            REPORT_EXPORTS: True,
            PORTFOLIO_ANALYTICS: True,
            TEAM_MANAGEMENT: True,
            PROPERTY_ASSIGNMENTS: True,
            ACCOUNTANT_ACCESS: True,
            BULK_OPERATIONS: True,
            ADVANCED_PAYMENT_ANALYTICS: True,
            PRIORITY_SUPPORT: True,
            API_ACCESS: True,
        },
    },
]

#: What to suggest when a limit is reached. Ordered, so the recommendation is
#: the next plan that actually clears the limit rather than the most expensive.
UPGRADE_ORDER = ["FREE", "PRO", "BUSINESS"]


def sync_catalogue(apps=None) -> None:
    """Create any missing plan, entitlement or plan value. Change nothing else.

    Usable from a migration (pass `apps`) or from a management command. The
    additive rule is deliberate: a re-run after somebody raises a customer's
    limit must not put it back.
    """
    if apps is not None:
        Plan = apps.get_model("billing", "Plan")
        Entitlement = apps.get_model("billing", "Entitlement")
        PlanEntitlement = apps.get_model("billing", "PlanEntitlement")
    else:  # pragma: no cover - exercised through the migration
        from .models import Entitlement, Plan, PlanEntitlement

    by_key = {}
    for spec in ENTITLEMENTS:
        row, _ = Entitlement.objects.get_or_create(
            key=spec["key"],
            defaults={
                "name": spec["name"],
                "value_type": spec["value_type"],
                "description": spec.get("description", ""),
            },
        )
        by_key[spec["key"]] = row

    for spec in PLANS:
        plan, _ = Plan.objects.get_or_create(
            code=spec["code"],
            defaults={
                "name": spec["name"],
                "description": spec.get("description", ""),
                "monthly_price_minor": int(spec["monthly_price"] * 100),
                "monthly_price_currency": "GHS",
                "annual_price_minor": int(spec["annual_price"] * 100),
                "annual_price_currency": "GHS",
                "display_order": spec["display_order"],
            },
        )
        for key, value in spec["entitlements"].items():
            unlimited = value is UNLIMITED
            PlanEntitlement.objects.get_or_create(
                plan=plan,
                entitlement=by_key[key],
                defaults={
                    "value": None if unlimited else value,
                    "is_unlimited": unlimited,
                },
            )
