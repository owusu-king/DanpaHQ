"""Organization lifecycle and resource-scoped authorization."""

from __future__ import annotations

from datetime import date, timedelta

from django.core import signing
from django.db import transaction
from django.db.models import Q, QuerySet, Sum
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.outbox.services import emit

from .models import (
    MembershipRole,
    Organization,
    OrganizationActivity,
    OrganizationActivityType,
    OrganizationInvitation,
    OrganizationInvitationProperty,
    OrganizationInvitationStatus,
    OrganizationMembership,
    OrganizationPropertyRelationship,
    OrganizationPropertyRole,
    OrganizationType,
    PropertyAssignment,
)

MANAGEMENT_ROLES = {MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.PROPERTY_MANAGER}
FULL_ORGANIZATION_ROLES = {MembershipRole.OWNER, MembershipRole.ADMIN}
ASSIGNABLE_ROLES = {
    MembershipRole.PROPERTY_MANAGER,
    MembershipRole.ACCOUNTANT,
    MembershipRole.STAFF,
}
INVITATION_LIFETIME = timedelta(days=7)
INVITATION_SIGNING_SALT = "organization.portfolio-invitation.v1"


def _shift_month(value: date, offset: int) -> date:
    """Return the first day of a month `offset` months from `value`."""
    month_index = value.year * 12 + value.month - 1 + offset
    return date(month_index // 12, month_index % 12 + 1, 1)


def _rent_collection_series(*, payments, charges: list, today: date) -> dict:
    """A dated, Portfolio-scoped collection projection for Provider Home.

    Confirmed payments are grouped by the day money was received. Outstanding
    is the balance that still exists now, grouped by the obligation's due date.
    This is deliberately not a historical balance reconstruction: the labels in
    both clients say "still outstanding" so a current fact is never presented as
    what the balance used to be at the end of a past month.
    """
    month_starts = [_shift_month(today.replace(day=1), offset) for offset in range(-11, 1)]
    years = list(range(today.year - 5, today.year + 1))

    monthly_collected = {value.strftime("%Y-%m"): 0 for value in month_starts}
    yearly_collected = {str(value): 0 for value in years}
    for row in payments.values("paid_on", "amount_minor"):
        month_key = row["paid_on"].strftime("%Y-%m")
        year_key = str(row["paid_on"].year)
        if month_key in monthly_collected:
            monthly_collected[month_key] += row["amount_minor"] or 0
        if year_key in yearly_collected:
            yearly_collected[year_key] += row["amount_minor"] or 0

    monthly_outstanding = {value: 0 for value in monthly_collected}
    yearly_outstanding = {value: 0 for value in yearly_collected}
    for charge in charges:
        amount = charge.outstanding_minor
        if amount <= 0:
            continue
        month_key = charge.due_on.strftime("%Y-%m")
        year_key = str(charge.due_on.year)
        if month_key in monthly_outstanding:
            monthly_outstanding[month_key] += amount
        if year_key in yearly_outstanding:
            yearly_outstanding[year_key] += amount

    return {
        "currency": "GHS",
        "monthly": [
            {
                "period": key,
                "collected_minor": monthly_collected[key],
                "outstanding_minor": monthly_outstanding[key],
            }
            for key in monthly_collected
        ],
        "yearly": [
            {
                "period": key,
                "collected_minor": yearly_collected[key],
                "outstanding_minor": yearly_outstanding[key],
            }
            for key in yearly_collected
        ],
    }


def active_membership(*, organization: Organization, user) -> OrganizationMembership | None:
    return OrganizationMembership.objects.filter(
        organization=organization,
        organization__is_active=True,
        user=user,
        ended_at__isnull=True,
    ).first()


def get_organization_or_404(pk, user=None) -> Organization:
    organization = Organization.objects.filter(id=pk, is_active=True).first()
    if organization is None:
        raise NotFound("We could not find that organization.")
    if user is not None and active_membership(organization=organization, user=user) is None:
        raise NotFound("We could not find that organization.")
    return organization


def assert_can_manage_organization(organization: Organization, user) -> OrganizationMembership:
    membership = active_membership(organization=organization, user=user)
    if membership is None or membership.role not in FULL_ORGANIZATION_ROLES:
        raise PermissionDenied("You do not have permission to manage this organization.")
    return membership


def _organization_property_memberships(*, prop, user) -> QuerySet:
    return OrganizationMembership.objects.filter(
        user=user,
        ended_at__isnull=True,
        organization__is_active=True,
        organization__property_relationships__property=prop,
        organization__property_relationships__ended_at__isnull=True,
    ).distinct()


def can_access_property(*, prop, user) -> bool:
    if user.is_staff:
        return True
    if (
        str(prop.owner_id) == str(user.id)
        or (prop.managed_by_id and str(prop.managed_by_id) == str(user.id))
        or prop.relationships.filter(user=user, ended_at__isnull=True).exists()
    ):
        return True
    memberships = _organization_property_memberships(prop=prop, user=user)
    if memberships.filter(role__in=FULL_ORGANIZATION_ROLES).exists():
        return True
    return PropertyAssignment.objects.filter(
        membership__in=memberships,
        property=prop,
        ended_at__isnull=True,
    ).exists()


def can_manage_property(*, prop, user) -> bool:
    """Whether this person may work on this property.

    Read by `property_capabilities` for every row of a listing, and again by
    callers that go on to act. Memoized only inside a declared read, keyed on
    the pairing because the answer is about both. See `apps.core.memo`.
    """
    from apps.core.memo import cached

    return cached(
        ("organization.can_manage_property", prop.pk, getattr(user, "pk", None)),
        lambda: _can_manage_property(prop=prop, user=user),
    )


def _can_manage_property(*, prop, user) -> bool:
    if user.is_staff:
        return True
    prepared = getattr(prop, "_property_list_can_manage", None)
    if prepared is not None:
        return bool(prepared)
    if (
        str(prop.owner_id) == str(user.id)
        or (prop.managed_by_id and str(prop.managed_by_id) == str(user.id))
        or prop.relationships.filter(
            user=user,
            ended_at__isnull=True,
            relationship_type__in=[
                "owner",
                "manager",
                "agent",
                "company_representative",
                "listing_manager",
            ],
        ).exists()
    ):
        return True
    memberships = _organization_property_memberships(prop=prop, user=user)
    if memberships.filter(role__in=FULL_ORGANIZATION_ROLES).exists():
        return True
    scoped = memberships.filter(role__in={MembershipRole.PROPERTY_MANAGER, MembershipRole.STAFF})
    return PropertyAssignment.objects.filter(
        membership__in=scoped,
        property=prop,
        ended_at__isnull=True,
    ).exists()


def properties_for_user(user, *, include_archived: bool = False):
    from apps.property.models import Property

    organization_ids = OrganizationMembership.objects.filter(
        user=user,
        ended_at__isnull=True,
        organization__is_active=True,
    ).values_list("organization_id", flat=True)
    full_org_ids = OrganizationMembership.objects.filter(
        user=user,
        ended_at__isnull=True,
        role__in=FULL_ORGANIZATION_ROLES,
    ).values_list("organization_id", flat=True)
    assigned_property_ids = PropertyAssignment.objects.filter(
        membership__user=user,
        membership__organization_id__in=organization_ids,
        membership__ended_at__isnull=True,
        ended_at__isnull=True,
    ).values_list("property_id", flat=True)
    full_org_property_ids = OrganizationPropertyRelationship.objects.filter(
        organization_id__in=full_org_ids,
        ended_at__isnull=True,
    ).values_list("property_id", flat=True)
    manager = Property.all_objects if include_archived else Property.objects
    return manager.filter(
        Q(owner=user)
        | Q(managed_by=user)
        | Q(relationships__user=user, relationships__ended_at__isnull=True)
        | Q(id__in=assigned_property_ids)
        | Q(id__in=full_org_property_ids)
    ).distinct()


def properties_for_organization_member(*, organization: Organization, user):
    from apps.property.models import Property

    membership = active_membership(organization=organization, user=user)
    if membership is None:
        return Property.objects.none()
    rows = Property.objects.filter(
        organization_relationships__organization=organization,
        organization_relationships__ended_at__isnull=True,
    )
    if membership.role not in FULL_ORGANIZATION_ROLES:
        rows = rows.filter(
            member_assignments__membership=membership,
            member_assignments__ended_at__isnull=True,
        )
    return rows.distinct()


def portfolio_summary(*, organization: Organization, user) -> dict:
    """One scoped read model for the mobile owner/manager daily workspace."""
    from apps.lease.models import Lease, LeaseStatus
    from apps.occupancy.models import (
        JoinRequestStatus,
        Occupancy,
        OccupancyStatus,
        PropertyJoinRequest,
    )
    from apps.payments.models import Settlement, SettlementStatus, TransactionStatus
    from apps.property.capabilities import property_capabilities
    from apps.property.models import Unit
    from apps.rent.models import (
        ChargeStatus,
        PaymentStatus,
        PropertyExpense,
        RentCharge,
        RentPayment,
    )

    properties = properties_for_organization_member(
        organization=organization, user=user
    ).select_related("address__locality")
    property_rows = list(properties)
    property_ids = [row.id for row in property_rows]
    units = Unit.objects.filter(property_id__in=property_ids, is_active=True).select_related(
        "property"
    )
    unit_rows = list(units)
    unit_ids = [row.id for row in unit_rows]
    occupancies = list(
        Occupancy.objects.filter(
            property_id__in=property_ids,
            ended_at__isnull=True,
            status="active",
        ).select_related("user", "property", "unit", "bed", "tenancy", "lease")
    )
    # Physical availability starts as soon as possession is recorded, even if
    # the agreement still needs a lease. Keep that boundary aligned with
    # `unit_is_occupied`; active tenant/lease counts below remain deliberately
    # narrower.
    occupied_unit_ids = set(
        Occupancy.objects.filter(
            property_id__in=property_ids,
            ended_at__isnull=True,
            status__in=[OccupancyStatus.PENDING_LEASE, OccupancyStatus.ACTIVE],
        ).values_list("unit_id", flat=True)
    )
    leases = list(
        Lease.objects.filter(unit_id__in=unit_ids).select_related("tenant", "unit__property")
    )
    lease_ids = [row.id for row in leases]
    charges = list(RentCharge.objects.filter(lease_id__in=lease_ids))
    payments = RentPayment.objects.filter(lease_id__in=lease_ids)
    today = timezone.localdate()
    outstanding = sum(row.outstanding_minor for row in charges)
    overdue = sum(
        row.outstanding_minor
        for row in charges
        if row.status in {ChargeStatus.DUE, ChargeStatus.PART_PAID} and row.due_on < today
    )
    confirmed_payments = payments.filter(status=PaymentStatus.CONFIRMED)
    confirmed_total = confirmed_payments.aggregate(total=Sum("amount_minor"))["total"] or 0
    rent_collection = _rent_collection_series(
        payments=confirmed_payments,
        charges=charges,
        today=today,
    )
    settlements = Settlement.objects.filter(
        beneficiary_organization=organization,
        transaction__status=TransactionStatus.SUCCEEDED,
        transaction__intent__lease__unit__property_id__in=property_ids,
        gross_amount_currency="GHS",
    ).select_related(
        "transaction__intent__tenant",
        "transaction__intent__lease__unit__property",
    )
    online_paid_total = settlements.aggregate(total=Sum("transaction__amount_minor"))["total"] or 0
    settled_totals = settlements.filter(status=SettlementStatus.SETTLED).aggregate(
        gross=Sum("gross_amount_minor"),
        fees=Sum("fee_amount_minor"),
        net=Sum("net_amount_minor"),
    )
    awaiting_settlement_total = (
        settlements.filter(
            status__in=[SettlementStatus.PENDING, SettlementStatus.PROCESSING]
        ).aggregate(total=Sum("gross_amount_minor"))["total"]
        or 0
    )
    settlement_attention_total = (
        settlements.filter(
            status__in=[SettlementStatus.FAILED, SettlementStatus.REVERSED]
        ).aggregate(total=Sum("gross_amount_minor"))["total"]
        or 0
    )
    recent_settlements = list(settlements.order_by("-transaction__paid_at", "-created_at")[:20])
    expense_total = (
        PropertyExpense.objects.filter(
            organization=organization, property_id__in=property_ids
        ).aggregate(total=Sum("amount_minor"))["total"]
        or 0
    )
    payment_rows = payments.select_related("lease__tenant", "lease__unit__property", "recorded_by")
    #: A claim the other side recorded is work this user still owes an answer to.
    #: It must never fall off the list because ten newer records exist, so the
    #: awaiting set is taken whole and merged with the recent window.
    awaiting_payments = list(
        payment_rows.filter(status=PaymentStatus.CLAIMED).exclude(recorded_by_id=user.id)
    )
    awaiting_ids = {row.id for row in awaiting_payments}
    recent_payments = awaiting_payments + [
        row for row in payment_rows[:10] if row.id not in awaiting_ids
    ]
    tenancy_request_rows = list(
        PropertyJoinRequest.objects.filter(
            property_id__in=property_ids,
            status__in={JoinRequestStatus.PENDING, JoinRequestStatus.APPROVED},
        ).select_related("requester", "property", "unit", "bed", "lease")
    )

    charges_by_lease: dict[object, list] = {}
    for charge in charges:
        charges_by_lease.setdefault(charge.lease_id, []).append(charge)

    def tenant_row(occupancy) -> dict:
        """Project one active allocation without guessing its agreement.

        A Unit can contain several independently let hostel beds. The previous
        projection indexed live leases by Unit, so every person in such a room
        could be shown against whichever bed lease happened to be read last.
        Active Occupancy already carries the exact Tenancy and Lease; those are
        the only authoritative joins for a provider tenant row.
        """
        lease = occupancy.lease
        tenancy = occupancy.tenancy
        lease_charges = charges_by_lease.get(occupancy.lease_id, [])
        open_charges = [charge for charge in lease_charges if charge.outstanding_minor > 0]
        overdue_charges = [charge for charge in open_charges if charge.due_on < today]
        next_due = min(open_charges, key=lambda charge: charge.due_on, default=None)
        rent_status = "overdue" if overdue_charges else "outstanding" if open_charges else "current"
        return {
            "occupancy_id": str(occupancy.id),
            "tenancy_id": str(tenancy.id) if tenancy else None,
            "tenancy_status": tenancy.status if tenancy else None,
            "user_id": str(occupancy.user_id),
            "name": occupancy.user.display_name,
            "property_id": str(occupancy.property_id),
            "property_title": occupancy.property.title,
            "unit_id": str(occupancy.unit_id),
            "unit_label": occupancy.unit.label or "Unit",
            "bed_id": str(occupancy.bed_id) if occupancy.bed_id else None,
            "bed_label": occupancy.bed.label if occupancy.bed else None,
            "lease_id": str(lease.id) if lease else None,
            "lease_status": lease.status if lease else None,
            "lease_rent_minor": lease.rent_minor if lease else None,
            "lease_rent_currency": lease.rent_currency if lease else None,
            "lease_rent_period": lease.rent_period if lease else None,
            "lease_starts_on": lease.starts_on.isoformat() if lease else None,
            "lease_ends_on": lease.ends_on.isoformat() if lease and lease.ends_on else None,
            "rent": {
                "status": rent_status,
                "outstanding_minor": sum(charge.outstanding_minor for charge in open_charges),
                "overdue_minor": sum(charge.outstanding_minor for charge in overdue_charges),
                "next_due_on": next_due.due_on.isoformat() if next_due else None,
            },
        }

    tenant_rows = [tenant_row(row) for row in occupancies]
    tenant_rows.sort(
        key=lambda row: (
            row["property_title"].casefold(),
            row["unit_label"].casefold(),
            (row["bed_label"] or "").casefold(),
            row["name"].casefold(),
        )
    )
    activities = [
        {
            "id": str(row.id),
            "kind": "tenant_joined",
            "title": f"{row.user.display_name} joined {row.property.title}",
            "at": row.created_at.isoformat(),
        }
        for row in occupancies[:5]
    ] + [
        {
            "id": str(row.id),
            "kind": "property_added",
            "title": f"{row.title} was added privately",
            "at": row.created_at.isoformat(),
        }
        for row in property_rows[:5]
    ]
    activities.sort(key=lambda row: row["at"], reverse=True)

    # One cache across the whole portfolio: the answers that do not vary by
    # property (is there a payment rail, which of this member's Portfolios hold
    # a verified destination) are resolved once rather than per row.
    capability_cache: dict = {}
    capabilities_by_property = {
        str(prop.id): property_capabilities(prop=prop, user=user, cache=capability_cache)
        for prop in property_rows
    }
    capability_rows = list(capabilities_by_property.values())
    for row in tenant_rows:
        # Recording an off-platform payment is `leases`, not `payment_collection`
        # — the same authority the lease-ledger endpoint enforces. It used to
        # read collection readiness, which meant a provider who had not set up
        # a payout destination lost the ability to acknowledge cash they had
        # actually been handed.
        row["can_record_payment"] = bool(
            capabilities_by_property.get(row["property_id"], {})
            .get("leases", {})
            .get("allowed", False)
        )

    tenancy_requests = [
        {
            "id": str(row.id),
            "requester_id": str(row.requester_id),
            "requester_display": row.requester.display_name,
            "property_id": str(row.property_id),
            "property_title": row.property.title,
            "unit_id": str(row.unit_id),
            "unit_label": row.unit.label or "Unit",
            "bed_id": str(row.bed_id) if row.bed_id else None,
            "bed_label": row.bed.label if row.bed else None,
            "status": row.status,
            "message": row.message,
            "decision_note": row.decision_note,
            "lease_id": str(row.lease_id) if row.lease_id else None,
            "lease_status": row.lease.status if row.lease else None,
            "created_at": row.created_at.isoformat(),
            "can_manage": row.property.is_managed_by(user),
        }
        for row in tenancy_request_rows
    ]

    from apps.property import access_codes
    from apps.property.serializers import unit_availability
    from apps.trust.condition import snapshot as condition_snapshot

    tenant_access = []
    for unit in unit_rows:
        code = access_codes.snapshot(unit)
        for field in ("expires_at", "issued_at"):
            if code[field] is not None:
                code[field] = code[field].isoformat()
        allowed = bool(
            capabilities_by_property.get(str(unit.property_id), {})
            .get("tenant_access", {})
            .get("allowed", False)
        )
        code["can_rotate"] = bool(code["can_rotate"] and allowed)
        code["can_revoke"] = bool(code["can_revoke"] and allowed)
        # Same key as the Unit read, so one client component serves both.
        code["can_manage"] = allowed
        tenant_access.append(
            {
                "property_id": str(unit.property_id),
                "property_title": unit.property.title,
                "unit_id": str(unit.id),
                "unit_label": unit.label or "Unit",
                "condition_state": condition_snapshot(unit)["condition_state"],
                "availability": unit_availability(unit),
                "access_code": code,
                "can_manage": allowed,
            }
        )
    tenant_access.sort(
        key=lambda row: (row["property_title"].casefold(), row["unit_label"].casefold())
    )

    return {
        "organization": {"id": str(organization.id), "name": organization.name},
        "counts": {
            "properties": len(property_rows),
            "units": len(unit_rows),
            "occupied_units": len(occupied_unit_ids),
            "vacant_units": max(len(unit_rows) - len(occupied_unit_ids), 0),
            "active_tenants": len(occupancies),
            "active_leases": sum(row.status == LeaseStatus.ACTIVE for row in leases),
            # Compatibility for installed clients. New invitations cannot be
            # created and the retirement migration revokes any that were open.
            "pending_invitations": 0,
            "pending_join_requests": sum(
                row["status"] == JoinRequestStatus.PENDING for row in tenancy_requests
            ),
            "maintenance_alerts": None,
        },
        "rent_collection": rent_collection,
        "money": {
            "outstanding_minor": outstanding,
            "overdue_minor": overdue,
            "confirmed_received_minor": confirmed_total,
            # PSP-confirmed tenant payment and provider payout are deliberately
            # separate. A tenant can have paid while Paystack still owes the
            # Portfolio its batch settlement.
            "online_paid_minor": online_paid_total,
            "settled_gross_minor": settled_totals["gross"] or 0,
            "settled_fee_minor": settled_totals["fees"] or 0,
            "settled_net_minor": settled_totals["net"] or 0,
            "awaiting_settlement_minor": awaiting_settlement_total,
            "settlement_attention_minor": settlement_attention_total,
            "expenses_minor": expense_total,
            #: Every claim still waiting for the other party to agree it.
            "pending_payment_records": RentPayment.objects.filter(
                lease_id__in=lease_ids, status=PaymentStatus.CLAIMED
            ).count(),
            #: Only the claims this user owes an answer to. A record the user
            #: made themselves is waiting on the counterparty, not on them, and
            #: counting it as their work overstates what they have to do.
            "payment_records_awaiting_you": len(awaiting_payments),
        },
        "verification": {
            "tenant_access_ready": sum(row["tenant_access"]["allowed"] for row in capability_rows),
            "payments_ready": sum(row["payment_collection"]["allowed"] for row in capability_rows),
            "properties_total": len(property_rows),
        },
        "tenancy_requests": tenancy_requests,
        "tenant_access": tenant_access,
        "tenants": tenant_rows,
        "recent_payments": [
            {
                "id": str(payment.id),
                "lease_id": str(payment.lease_id),
                "tenant_name": payment.lease.tenant.display_name,
                "property_title": payment.lease.unit.property.title,
                "unit_label": payment.lease.unit.label or "Unit",
                "amount_minor": payment.amount_minor,
                "currency": payment.amount_currency,
                "status": payment.status,
                "paid_on": payment.paid_on.isoformat(),
                "method_display": payment.get_method_display(),
                "recorded_by_tenant": payment.recorded_by_tenant,
                "awaiting_you": payment.status == PaymentStatus.CLAIMED
                and str(payment.recorded_by_id) != str(user.id),
                "verification_source": payment.verification_source,
                "source": payment.payment_source,
                "evidence": payment.payment_evidence,
            }
            for payment in recent_payments
        ],
        "recent_settlements": [
            {
                "id": str(settlement.id),
                "transaction_id": str(settlement.transaction_id),
                "tenant_name": settlement.transaction.intent.tenant.display_name,
                "property_title": settlement.transaction.intent.lease.unit.property.title,
                "unit_label": settlement.transaction.intent.lease.unit.label or "Unit",
                "status": settlement.status,
                "status_display": settlement.get_status_display(),
                "gross_minor": settlement.gross_amount_minor,
                # Pending values do not yet contain Paystack's actual fee. Do
                # not expose an estimate as if it were a final deduction.
                "fee_minor": (
                    settlement.fee_amount_minor
                    if settlement.status == SettlementStatus.SETTLED
                    else None
                ),
                "net_minor": (
                    settlement.net_amount_minor
                    if settlement.status == SettlementStatus.SETTLED
                    else None
                ),
                "currency": settlement.gross_amount_currency,
                "paid_at": (
                    settlement.transaction.paid_at.isoformat()
                    if settlement.transaction.paid_at
                    else None
                ),
                "settled_at": (
                    settlement.settled_at.isoformat() if settlement.settled_at else None
                ),
            }
            for settlement in recent_settlements
        ],
        "recent_activity": activities[:8],
    }


@transaction.atomic
def create_organization(*, user, data: dict) -> Organization:
    name = str(data.get("name", "")).strip()
    organization_type = data.get("organization_type")
    activities = set(data.get("activities") or [])
    if not name:
        raise ValidationFailed("Give your Portfolio a name.")
    if organization_type not in OrganizationType.values:
        raise ValidationFailed("Choose a valid management type.")
    if not activities or not activities.issubset(set(OrganizationActivityType.values)):
        raise ValidationFailed("Choose at least one valid property activity.")

    organization = Organization.objects.create(
        name=name,
        organization_type=organization_type,
        created_by=user,
    )
    OrganizationActivity.objects.bulk_create(
        [OrganizationActivity(organization=organization, activity=value) for value in activities]
    )
    OrganizationMembership.objects.create(
        organization=organization,
        user=user,
        role=MembershipRole.OWNER,
        invited_by=user,
        joined_at=timezone.now(),
    )
    # A Portfolio is the subscriber, so it gets its billing account and its Free
    # subscription in the same transaction that creates it. Nobody is asked for
    # payment details; Free is the plan you are on until you choose otherwise.
    from apps.billing import enforcement as billing

    billing.on_portfolio_created(organization=organization, actor=user)
    record(
        action=AuditAction.CREATE,
        aggregate_type="organization",
        aggregate_id=organization.id,
        actor=user,
        metadata={"organization_type": organization_type, "activities": sorted(activities)},
    )
    emit(
        DomainEvent(
            "organization.created.v1",
            "organization",
            str(organization.id),
            {"owner_id": str(user.id), "organization_type": organization_type},
        )
    )
    return organization


@transaction.atomic
def update_organization(*, organization: Organization, actor, data: dict) -> Organization:
    assert_can_manage_organization(organization, actor)
    changes: dict[str, list] = {}
    if "name" in data:
        name = str(data["name"]).strip()
        if not name:
            raise ValidationFailed("Give your Portfolio a name.")
        if name != organization.name:
            changes["name"] = [organization.name, name]
            organization.name = name
    if "organization_type" in data:
        value = data["organization_type"]
        if value not in OrganizationType.values:
            raise ValidationFailed("Choose a valid Portfolio type.")
        if value != organization.organization_type:
            changes["organization_type"] = [organization.organization_type, value]
            organization.organization_type = value
    if changes:
        organization.save(update_fields=[*changes.keys(), "updated_at"])
    if "activities" in data:
        activities = set(data["activities"])
        if not activities or not activities.issubset(set(OrganizationActivityType.values)):
            raise ValidationFailed("Choose at least one valid property activity.")
        before = set(organization.activities.values_list("activity", flat=True))
        if activities != before:
            OrganizationActivity.objects.filter(organization=organization).exclude(
                activity__in=activities
            ).delete()
            OrganizationActivity.objects.bulk_create(
                [
                    OrganizationActivity(organization=organization, activity=value)
                    for value in activities - before
                ]
            )
            changes["activities"] = [sorted(before), sorted(activities)]
    if changes:
        record(
            action=AuditAction.UPDATE,
            aggregate_type="organization",
            aggregate_id=organization.id,
            actor=actor,
            changes=changes,
            metadata={"action": "portfolio_settings_changed"},
        )
        emit(
            DomainEvent(
                "organization.settings_changed.v1",
                "organization",
                str(organization.id),
                {"changed_fields": sorted(changes)},
            )
        )
    return organization


def invitation_token(invitation: OrganizationInvitation) -> str:
    return signing.dumps(
        {"invitation_id": str(invitation.id), "nonce": invitation.nonce},
        salt=INVITATION_SIGNING_SALT,
        compress=True,
    )


def _assert_invitation_token(invitation: OrganizationInvitation, token: str) -> None:
    try:
        payload = signing.loads(token, salt=INVITATION_SIGNING_SALT, max_age=INVITATION_LIFETIME)
    except signing.BadSignature as exc:
        raise PermissionDenied("That Portfolio invitation link is invalid or has expired.") from exc
    if payload != {"invitation_id": str(invitation.id), "nonce": invitation.nonce}:
        raise PermissionDenied("That Portfolio invitation link is invalid.")


def _record_invitation_event(*, invitation, actor, action: str, event_name: str) -> None:
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="organization",
        aggregate_id=invitation.organization_id,
        actor=actor,
        metadata={
            "action": action,
            "invitation_id": str(invitation.id),
            "role": invitation.role,
            "invitee_user_id": str(invitation.invitee_user_id or ""),
        },
    )
    emit(
        DomainEvent(
            event_name,
            "organization_invitation",
            str(invitation.id),
            {
                "organization_id": str(invitation.organization_id),
                "invitee_user_id": str(invitation.invitee_user_id or ""),
                "role": invitation.role,
            },
        )
    )


@transaction.atomic
def create_invitation(
    *, organization: Organization, actor, invitee_phone: str, role: str, property_ids=None
) -> OrganizationInvitation:
    from apps.billing import enforcement as billing

    actor_membership = assert_can_manage_organization(organization, actor)
    if role not in MembershipRole.values:
        raise ValidationFailed("Choose a valid Portfolio role.")
    # Told now rather than at the door. Inviting somebody the plan has no seat
    # for turns one person's problem into two people's.
    billing.assert_feature(organization=organization, key="TEAM_MANAGEMENT")
    billing.assert_can_add_team_member(organization=organization)
    if role == MembershipRole.OWNER and actor_membership.role != MembershipRole.OWNER:
        raise PermissionDenied("Only a Portfolio owner can invite another owner.")

    from apps.identity.models import User

    invitee = User.objects.filter(phone=invitee_phone, is_active=True).first()
    if (
        invitee
        and OrganizationMembership.objects.filter(
            organization=organization, user=invitee, ended_at__isnull=True
        ).exists()
    ):
        raise Conflict("That person is already an active Portfolio member.")
    existing_invitation = OrganizationInvitation.objects.filter(
        organization=organization,
        invitee_phone=invitee_phone,
        status=OrganizationInvitationStatus.PENDING,
    ).first()
    if existing_invitation is not None:
        existing_invitation = expire_invitation(existing_invitation)
        if existing_invitation.status == OrganizationInvitationStatus.PENDING:
            raise Conflict("A pending invitation already exists for that phone number.")

    invitation = OrganizationInvitation.objects.create(
        organization=organization,
        invitee_phone=invitee_phone,
        invitee_user=invitee,
        role=role,
        invited_by=actor,
        expires_at=timezone.now() + INVITATION_LIFETIME,
    )
    requested_ids = set(property_ids or [])
    if requested_ids:
        if role not in ASSIGNABLE_ROLES:
            raise ValidationFailed("Owners and administrators already have Portfolio-wide access.")
        valid = list(
            OrganizationPropertyRelationship.objects.filter(
                organization=organization,
                property_id__in=requested_ids,
                ended_at__isnull=True,
            ).values_list("property_id", flat=True)
        )
        if len(set(valid)) != len(requested_ids):
            raise ValidationFailed("Choose only Properties in this Portfolio.")
        OrganizationInvitationProperty.objects.bulk_create(
            [
                OrganizationInvitationProperty(invitation=invitation, property_id=property_id)
                for property_id in valid
            ]
        )
    _record_invitation_event(
        invitation=invitation,
        actor=actor,
        action="invitation_created",
        event_name="organization.invitation_created.v1",
    )
    return invitation


@transaction.atomic
def expire_invitation(invitation: OrganizationInvitation) -> OrganizationInvitation:
    invitation = OrganizationInvitation.objects.select_for_update().get(id=invitation.id)
    if invitation.status != OrganizationInvitationStatus.PENDING:
        return invitation
    if invitation.expires_at > timezone.now():
        return invitation
    invitation.status = OrganizationInvitationStatus.EXPIRED
    invitation.responded_at = timezone.now()
    invitation.save(update_fields=["status", "responded_at", "updated_at"])
    _record_invitation_event(
        invitation=invitation,
        actor=None,
        action="invitation_expired",
        event_name="organization.invitation_expired.v1",
    )
    return invitation


def invitations_for_invitee(user):
    rows = list(
        OrganizationInvitation.objects.filter(
            invitee_phone=user.phone,
            status=OrganizationInvitationStatus.PENDING,
        ).select_related("organization", "invited_by")
    )
    pending = []
    for row in rows:
        refreshed = expire_invitation(row)
        if refreshed.status == OrganizationInvitationStatus.PENDING:
            pending.append(refreshed)
    return pending


@transaction.atomic
def accept_invitation(*, invitation: OrganizationInvitation, actor, token: str):
    invitation = (
        OrganizationInvitation.objects.select_for_update()
        .select_related("organization")
        .get(id=invitation.id)
    )
    _assert_invitation_token(invitation, token)
    invitation = expire_invitation(invitation)
    if invitation.status != OrganizationInvitationStatus.PENDING:
        raise Conflict("That Portfolio invitation is no longer pending.")
    if actor.phone != invitation.invitee_phone:
        raise PermissionDenied("This Portfolio invitation belongs to another phone number.")
    if OrganizationMembership.objects.filter(
        organization=invitation.organization, user=actor, ended_at__isnull=True
    ).exists():
        raise Conflict("You already belong to this Portfolio.")

    # The authoritative seat check, inside the transaction that takes the seat.
    # The invitation was checked too, but a plan can change or another invitee
    # can accept between the two, and this is the moment the seat exists.
    from apps.billing import enforcement as billing

    billing.assert_can_add_team_member(organization=invitation.organization)

    membership = OrganizationMembership.objects.create(
        organization=invitation.organization,
        user=actor,
        role=invitation.role,
        invited_by=invitation.invited_by,
        joined_at=timezone.now(),
    )
    activated_assignments = []
    if invitation.role in ASSIGNABLE_ROLES:
        activated_assignments = [
            PropertyAssignment(
                membership=membership,
                property_id=selection.property_id,
                assigned_by=invitation.invited_by,
            )
            for selection in invitation.property_selections.all()
        ]
        PropertyAssignment.objects.bulk_create(activated_assignments)
    invitation.status = OrganizationInvitationStatus.ACCEPTED
    invitation.invitee_user = actor
    invitation.responded_at = timezone.now()
    invitation.save(update_fields=["status", "invitee_user", "responded_at", "updated_at"])
    _record_invitation_event(
        invitation=invitation,
        actor=actor,
        action="invitation_accepted",
        event_name="organization.invitation_accepted.v1",
    )
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="organization",
        aggregate_id=invitation.organization_id,
        actor=actor,
        metadata={
            "action": "membership_activated",
            "membership_id": str(membership.id),
            "role": membership.role,
        },
    )
    emit(
        DomainEvent(
            "organization.membership_activated.v1",
            "organization_membership",
            str(membership.id),
            {
                "organization_id": str(invitation.organization_id),
                "user_id": str(actor.id),
                "role": membership.role,
            },
        )
    )
    for assignment in activated_assignments:
        record(
            action=AuditAction.PERMISSION_CHANGE,
            aggregate_type="property",
            aggregate_id=assignment.property_id,
            actor=actor,
            metadata={
                "action": "property_assigned",
                "membership_id": str(membership.id),
                "invitation_id": str(invitation.id),
            },
        )
        emit(
            DomainEvent(
                "organization.property_assigned.v1",
                "property_assignment",
                str(assignment.id),
                {
                    "organization_id": str(invitation.organization_id),
                    "membership_id": str(membership.id),
                    "property_id": str(assignment.property_id),
                },
            )
        )
    return membership


@transaction.atomic
def decline_invitation(*, invitation: OrganizationInvitation, actor, token: str):
    invitation = OrganizationInvitation.objects.select_for_update().get(id=invitation.id)
    _assert_invitation_token(invitation, token)
    invitation = expire_invitation(invitation)
    if invitation.status != OrganizationInvitationStatus.PENDING:
        raise Conflict("That Portfolio invitation is no longer pending.")
    if actor.phone != invitation.invitee_phone:
        raise PermissionDenied("This Portfolio invitation belongs to another phone number.")
    invitation.status = OrganizationInvitationStatus.DECLINED
    invitation.invitee_user = actor
    invitation.responded_at = timezone.now()
    invitation.save(update_fields=["status", "invitee_user", "responded_at", "updated_at"])
    _record_invitation_event(
        invitation=invitation,
        actor=actor,
        action="invitation_declined",
        event_name="organization.invitation_declined.v1",
    )
    return invitation


@transaction.atomic
def revoke_invitation(*, invitation: OrganizationInvitation, actor):
    assert_can_manage_organization(invitation.organization, actor)
    invitation = expire_invitation(invitation)
    if invitation.status != OrganizationInvitationStatus.PENDING:
        raise Conflict("That Portfolio invitation is no longer pending.")
    invitation.status = OrganizationInvitationStatus.REVOKED
    invitation.revoked_by = actor
    invitation.responded_at = timezone.now()
    invitation.save(update_fields=["status", "revoked_by", "responded_at", "updated_at"])
    _record_invitation_event(
        invitation=invitation,
        actor=actor,
        action="invitation_revoked",
        event_name="organization.invitation_revoked.v1",
    )
    return invitation


@transaction.atomic
def add_membership(*, organization: Organization, actor, user, role: str):
    """Internal compatibility helper; public APIs must use invitations."""
    assert_can_manage_organization(organization, actor)
    if role not in MembershipRole.values:
        raise ValidationFailed("Choose a valid Portfolio role.")
    if OrganizationMembership.objects.filter(
        organization=organization, user=user, ended_at__isnull=True
    ).exists():
        raise Conflict("That person already belongs to this Portfolio.")
    return OrganizationMembership.objects.create(
        organization=organization,
        user=user,
        role=role,
        invited_by=actor,
        joined_at=timezone.now(),
    )


@transaction.atomic
def assign_property(*, organization: Organization, property, membership, actor):
    assert_can_manage_organization(organization, actor)
    if membership.organization_id != organization.id or membership.ended_at is not None:
        raise ValidationFailed("Choose an active member of this organization.")
    if membership.role not in ASSIGNABLE_ROLES:
        raise ValidationFailed("Owners and administrators already have Portfolio-wide access.")
    if not OrganizationPropertyRelationship.objects.filter(
        organization=organization, property=property, ended_at__isnull=True
    ).exists():
        raise PermissionDenied("This property does not belong to this Portfolio.")
    assignment, created = PropertyAssignment.objects.get_or_create(
        membership=membership,
        property=property,
        ended_at=None,
        defaults={"assigned_by": actor},
    )
    if not created:
        raise Conflict("That member is already assigned to this property.")
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="property",
        aggregate_id=property.id,
        actor=actor,
        metadata={"membership_id": str(membership.id), "action": "property_assigned"},
    )
    emit(
        DomainEvent(
            "organization.property_assigned.v1",
            "property_assignment",
            str(assignment.id),
            {
                "organization_id": str(organization.id),
                "membership_id": str(membership.id),
                "property_id": str(property.id),
            },
        )
    )
    return assignment


def _assert_actor_may_manage_target(*, organization, actor_membership, target_membership) -> None:
    if (
        target_membership.role == MembershipRole.OWNER
        and actor_membership.role != MembershipRole.OWNER
    ):
        raise PermissionDenied("Only a Portfolio owner can change another owner's access.")


@transaction.atomic
def change_membership_role(*, organization, membership, actor, role: str):
    actor_membership = assert_can_manage_organization(organization, actor)
    if membership.organization_id != organization.id or membership.ended_at is not None:
        raise NotFound("We could not find that active Portfolio member.")
    if role not in MembershipRole.values:
        raise ValidationFailed("Choose a valid Portfolio role.")
    _assert_actor_may_manage_target(
        organization=organization,
        actor_membership=actor_membership,
        target_membership=membership,
    )
    if role == MembershipRole.OWNER and actor_membership.role != MembershipRole.OWNER:
        raise PermissionDenied("Only a Portfolio owner can grant owner access.")
    previous = membership.role
    if previous == role:
        return membership
    if previous == MembershipRole.OWNER and role != MembershipRole.OWNER:
        remaining = organization.memberships.filter(
            role=MembershipRole.OWNER, ended_at__isnull=True
        ).exclude(id=membership.id)
        if not remaining.exists():
            raise Conflict("A Portfolio must always have at least one owner.")
    membership.role = role
    membership.save(update_fields=["role", "updated_at"])
    if role in FULL_ORGANIZATION_ROLES:
        membership.property_assignments.filter(ended_at__isnull=True).update(
            ended_at=timezone.now(), note="Ended because the role now has Portfolio-wide access."
        )
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="organization",
        aggregate_id=organization.id,
        actor=actor,
        changes={"role": [previous, role]},
        metadata={"action": "role_changed", "membership_id": str(membership.id)},
    )
    emit(
        DomainEvent(
            "organization.member_role_changed.v1",
            "organization_membership",
            str(membership.id),
            {"organization_id": str(organization.id), "from": previous, "to": role},
        )
    )
    return membership


@transaction.atomic
def remove_membership(*, organization, membership, actor, reason: str = "Access revoked"):
    actor_membership = assert_can_manage_organization(organization, actor)
    if membership.organization_id != organization.id or membership.ended_at is not None:
        raise NotFound("We could not find that active Portfolio member.")
    _assert_actor_may_manage_target(
        organization=organization,
        actor_membership=actor_membership,
        target_membership=membership,
    )
    if membership.role == MembershipRole.OWNER:
        remaining = organization.memberships.filter(
            role=MembershipRole.OWNER, ended_at__isnull=True
        ).exclude(id=membership.id)
        if not remaining.exists():
            raise Conflict("A Portfolio must always have at least one owner.")
    now = timezone.now()
    membership.ended_at = now
    membership.ended_reason = reason.strip()[:200] or "Access revoked"
    membership.save(update_fields=["ended_at", "ended_reason", "updated_at"])
    membership.property_assignments.filter(ended_at__isnull=True).update(
        ended_at=now, note="Ended when Portfolio membership was revoked."
    )
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="organization",
        aggregate_id=organization.id,
        actor=actor,
        metadata={
            "action": "member_removed",
            "membership_id": str(membership.id),
            "member_id": str(membership.user_id),
            "reason": membership.ended_reason,
        },
    )
    emit(
        DomainEvent(
            "organization.member_removed.v1",
            "organization_membership",
            str(membership.id),
            {"organization_id": str(organization.id), "user_id": str(membership.user_id)},
        )
    )
    return membership


@transaction.atomic
def unassign_property(*, organization, assignment, actor):
    assert_can_manage_organization(organization, actor)
    if assignment.membership.organization_id != organization.id or assignment.ended_at is not None:
        raise NotFound("We could not find that active Property assignment.")
    assignment.ended_at = timezone.now()
    assignment.note = "Unassigned by a Portfolio owner or administrator."
    assignment.save(update_fields=["ended_at", "note", "updated_at"])
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="property",
        aggregate_id=assignment.property_id,
        actor=actor,
        metadata={
            "action": "property_unassigned",
            "membership_id": str(assignment.membership_id),
            "assignment_id": str(assignment.id),
        },
    )
    emit(
        DomainEvent(
            "organization.property_unassigned.v1",
            "property_assignment",
            str(assignment.id),
            {
                "organization_id": str(organization.id),
                "membership_id": str(assignment.membership_id),
                "property_id": str(assignment.property_id),
            },
        )
    )
    return assignment


def organization_contexts_for_user(user) -> list[dict]:
    memberships = OrganizationMembership.objects.filter(
        user=user,
        ended_at__isnull=True,
        organization__is_active=True,
    ).select_related("organization")
    return [
        {
            "id": f"organization:{membership.organization_id}",
            "type": "organization",
            "label": membership.organization.name,
            "subtitle": (
                "Personal Portfolio"
                if membership.organization.organization_type == OrganizationType.INDIVIDUAL_OWNER
                else "Property business"
            ),
            "organization_id": str(membership.organization_id),
            "organization_type": membership.organization.organization_type,
            "role": membership.role,
            "mobile_route": "/(app)/(provider-tabs)",
            "web_route": "/properties",
        }
        for membership in memberships
    ]


@transaction.atomic
def ensure_personal_organization(*, owner, actor=None, activity=None) -> Organization:
    membership = (
        OrganizationMembership.objects.filter(
            user=owner,
            role=MembershipRole.OWNER,
            ended_at__isnull=True,
            organization__organization_type=OrganizationType.INDIVIDUAL_OWNER,
            organization__is_active=True,
        )
        .select_related("organization")
        .first()
    )
    if membership:
        organization = membership.organization
    else:
        organization = Organization.objects.create(
            name=f"{owner.display_name} Portfolio",
            organization_type=OrganizationType.INDIVIDUAL_OWNER,
            created_by=owner,
        )
        OrganizationMembership.objects.create(
            organization=organization,
            user=owner,
            role=MembershipRole.OWNER,
            invited_by=actor or owner,
            joined_at=timezone.now(),
        )
        record(
            action=AuditAction.CREATE,
            aggregate_type="organization",
            aggregate_id=organization.id,
            actor=actor or owner,
            metadata={
                "action": "personal_portfolio_created",
                "organization_type": OrganizationType.INDIVIDUAL_OWNER,
            },
        )
        emit(
            DomainEvent(
                "organization.personal_portfolio_created.v1",
                "organization",
                str(organization.id),
                {"owner_id": str(owner.id)},
            )
        )
    chosen_activity = (
        activity
        if activity in OrganizationActivityType.values
        else OrganizationActivityType.RESIDENTIAL
    )
    OrganizationActivity.objects.get_or_create(organization=organization, activity=chosen_activity)
    return organization


@transaction.atomic
def ensure_personal_organization_for_property(*, owner, prop, actor=None) -> Organization:
    """Compatibility bridge for a verified individual-owner property.

    It is safe to retry and intentionally does not infer representative or team
    memberships from legacy direct property relationships.
    """
    relationship = (
        OrganizationPropertyRelationship.objects.filter(
            property=prop,
            relationship_type=OrganizationPropertyRole.OWNER,
            ended_at__isnull=True,
            organization__organization_type=OrganizationType.INDIVIDUAL_OWNER,
        )
        .select_related("organization")
        .first()
    )
    if relationship:
        return relationship.organization

    organization = ensure_personal_organization(
        owner=owner,
        actor=actor,
        activity=prop.property_type,
    )
    OrganizationPropertyRelationship.objects.get_or_create(
        organization=organization,
        property=prop,
        relationship_type=OrganizationPropertyRole.OWNER,
        ended_at=None,
        defaults={"granted_by": actor or owner, "note": "Legacy individual owner bridge."},
    )
    return organization
