"""Lease lifecycle.

    draft ──▶ offered ──▶ awaiting activation ──▶ active ──▶ ended
      │          │  └──▶ declined
      └──────────┴─────▶ cancelled

Activation is the only transition neither party controls alone: it happens when
the second acceptance lands, whichever side that is. Everything that follows
from a lease going live - the unit coming off the market, the other applicants
being told - happens there, once.
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, Gone, NotFound, PermissionDenied, ValidationFailed
from apps.core.policy import enforce
from apps.outbox.services import emit

from . import advance_policy, execution
from .models import (
    OPEN_STATUSES,
    AcceptanceParty,
    Lease,
    LeaseActivationRequirement,
    LeaseStatus,
    LeaseWorkflow,
    TemplateReviewStatus,
)
from .policies import can_accept_offer, can_decline_offer


def get_lease_or_404(pk) -> Lease:
    lease = (
        Lease.objects.filter(id=pk)
        .select_related(
            "unit__property__address__locality",
            "landlord",
            "tenant",
            "listing",
            "agreement",
            "template",
        )
        .prefetch_related("agreement__acceptances__user")
        .first()
    )
    if lease is None:
        raise NotFound("We could not find that agreement.")
    return lease


def assert_participant(lease: Lease, user) -> None:
    is_tenant = str(lease.tenant_id) == str(user.id)
    is_manager = lease.unit.property.is_managed_by(user)
    if not is_tenant and not is_manager:
        raise PermissionDenied("You do not have access to that agreement.")
    if is_tenant and lease.status == LeaseStatus.DRAFT:
        raise PermissionDenied("This agreement has not been sent to you.")


def assert_landlord_side(lease: Lease, user) -> None:
    from apps.property.capabilities import PropertyCapability, assert_property_capability

    assert_property_capability(
        prop=lease.unit.property,
        user=user,
        capability=PropertyCapability.LEASES,
    )


def assert_tenant(lease: Lease, user) -> None:
    if str(lease.tenant_id) != str(user.id):
        raise PermissionDenied("Only the tenant on this agreement can do that.")


def assert_target_is_free(*, unit, bed=None, exclude=None) -> None:
    """Refuse a lease that would clash with one already live.

    Two unique constraints already stop a unit clashing with a unit and a bed
    with the same bed. They cannot express the third case: a whole-unit lease
    conflicts with the beds *inside* it, while the beds do not conflict with
    each other. A single constraint keyed on `unit` would have to say both
    things at once - which is exactly what the old `lease_one_live_per_unit`
    did, and why a four-bed hostel room admitted one live lease in total.

    Same shape as `occupancy.services.assert_space_is_free`, deliberately: the
    rule is the same rule, and two different answers to it would be worse than
    either answer.
    """
    live = Lease.objects.filter(unit=unit, status__in=OPEN_STATUSES)
    if exclude is not None:
        live = live.exclude(pk=exclude.pk)

    if bed is None:
        if live.filter(bed__isnull=True).exists():
            raise Conflict(
                "This unit already has a live agreement. End it before starting another."
            )
        if live.filter(bed__isnull=False).exists():
            raise Conflict("A bed in this unit is already let, so the unit cannot be let whole.")
        return

    if live.filter(bed__isnull=True).exists():
        raise Conflict("The whole unit is already let, so its beds cannot be let separately.")
    if live.filter(bed=bed).exists():
        raise Conflict("That bed already has a live agreement.")


@transaction.atomic
def draft_lease(
    *,
    user,
    unit,
    tenant,
    data: dict,
    application=None,
    listing=None,
    invitation=None,
    join_request=None,
    bed=None,
) -> Lease:
    """Write down what was agreed. Nothing is binding yet.

    Terms are copied, never referenced: the listing may be edited or withdrawn
    tomorrow and that must not change what the parties agreed today.
    """
    from apps.property.capabilities import PropertyCapability, assert_property_capability

    assert_property_capability(
        prop=unit.property,
        user=user,
        capability=PropertyCapability.LEASES,
    )
    # A space above its Portfolio's plan allowance starts no new agreement — not
    # for a new tenant, and not a new period for one already there.
    from apps.billing import enforcement as billing

    billing.assert_open_for_new_activity(unit=unit, action="draft_lease")
    if str(tenant.id) == str(user.id):
        raise ValidationFailed("A landlord cannot lease a place to themselves.")

    if bed is not None and bed.unit_id != unit.id:
        raise ValidationFailed("That bed is not in this unit.")
    if bed is not None:
        from apps.property.space_rules import assert_accepts_bed_spaces

        assert_accepts_bed_spaces(unit=unit)
    if application is not None:
        if application.superseded_by_id is not None:
            raise ValidationFailed("That application is retained as history and cannot be leased.")
        if application.unit_id != unit.id or application.tenant_id != tenant.id:
            raise ValidationFailed("That application does not belong to this tenant and unit.")
    if invitation is not None:
        raise Gone(
            "An invitation cannot authorize a lease. The tenant must send a "
            "tenancy request and the provider must approve it first."
        )
    if join_request is not None:
        from apps.occupancy.models import JoinRequestStatus, PropertyJoinRequest

        join_request = PropertyJoinRequest.objects.select_for_update().get(pk=join_request.pk)
        if join_request.status != JoinRequestStatus.APPROVED:
            raise ValidationFailed("Approve the tenancy request before preparing its lease.")
        if join_request.requester_id != tenant.id:
            raise ValidationFailed("That tenancy request does not belong to this tenant.")
        if (
            join_request.unit_id != unit.id
            or join_request.property_id != unit.property_id
            or join_request.bed_id != (bed.id if bed else None)
        ):
            raise ValidationFailed("That tenancy request does not name this rental space.")
        if join_request.lease_id:
            raise Conflict("A lease has already been created from this tenancy request.")
        if application is not None or listing is not None:
            raise ValidationFailed(
                "A tenancy-request lease cannot also claim another acquisition source."
            )
    assert_target_is_free(unit=unit, bed=bed)

    rent_minor = data.get("rent_minor")
    if not rent_minor or int(rent_minor) <= 0:
        raise ValidationFailed("Set the rent.")
    if not data.get("starts_on"):
        raise ValidationFailed("Set the date the tenancy starts.")

    workflow = data.get("workflow_version", LeaseWorkflow.LEGACY)
    template = None
    if workflow == LeaseWorkflow.CANONICAL:
        from .templates import canonical_template

        template = canonical_template()

    lease = Lease(
        workflow_version=workflow,
        template=template,
        unit=unit,
        bed=bed,
        # This is the verified person signing for the provider. It must not be
        # inferred from the private property's creator or legacy owner field.
        landlord=user,
        tenant=tenant,
        application=application,
        listing=listing,
        rent_minor=int(rent_minor),
        rent_currency=data.get("rent_currency", "GHS"),
        rent_period=data.get("rent_period", "monthly"),
        advance_months=data.get("advance_months", 0),
        deposit_months=data.get("deposit_months", 0),
        agency_fee_months=data.get("agency_fee_months", 0),
        starts_on=data["starts_on"],
        term_months=data.get("term_months", 12),
        conditions=(data.get("conditions") or "")[:2000],
        structured_terms=data.get("structured_terms") or {},
    )
    lease.ends_on = lease.compute_ends_on()
    lease.save()
    if join_request is not None:
        join_request.lease = lease
        join_request.save(update_fields=["lease", "updated_at"])

    record(
        action=AuditAction.CREATE,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=user,
        metadata={
            "unit_id": str(unit.id),
            "rent_minor": lease.rent_minor,
            "advance_months": lease.advance_months,
            "exceeds_statutory_advance": lease.exceeds_statutory_advance,
            "join_request_id": str(join_request.id) if join_request else None,
        },
    )
    return lease


#: What the builder owns. Standard clause wording is not in here and never
#: can be — it belongs to the versioned template, which is the whole point of
#: separating the two.
BUILDER_FIELDS = (
    "rent_minor",
    "rent_currency",
    "rent_period",
    "advance_months",
    "deposit_months",
    "agency_fee_months",
    "starts_on",
    "term_months",
    "conditions",
    "structured_terms",
)


@transaction.atomic
def update_draft(*, lease: Lease, user, data: dict) -> Lease:
    """Update only negotiable fields before an offer has a counterparty."""
    assert_landlord_side(lease, user)
    if lease.workflow_version != LeaseWorkflow.CANONICAL:
        raise Conflict("This older draft does not use the guided agreement builder.")
    if lease.status not in (LeaseStatus.DRAFT, LeaseStatus.READY):
        raise Conflict(
            "The tenant may already be reviewing this agreement. Create an amendment instead."
        )

    for field in BUILDER_FIELDS:
        if field in data:
            setattr(lease, field, data[field])
    lease.ends_on = lease.compute_ends_on()
    previous = lease.status
    lease.status = LeaseStatus.DRAFT
    lease.ready_at = None
    lease.save(update_fields=[*BUILDER_FIELDS, "ends_on", "status", "ready_at", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=user,
        changes={"status": [previous, LeaseStatus.DRAFT]} if previous != LeaseStatus.DRAFT else {},
        metadata={"builder_sections_updated": True},
    )
    return lease


@transaction.atomic
def amend_lease(*, lease: Lease, user, data: dict) -> Lease:
    """Open a replacement for an agreement both parties have already accepted.

    An executed agreement is immutable, so changing the rent is not an edit —
    it is a *second* agreement that supersedes the first, and only once the
    tenant has accepted that one too. Three things follow from saying it that
    way rather than mutating the row:

    - The original stays live and the tenancy is undisturbed while the
      amendment is being negotiated. Nobody loses a home because a renegotiation
      was started and then abandoned.
    - The tenant's renewed acceptance is not a courtesy. The amendment travels
      the same Ready → offer → accept → confirm path as any other agreement,
      because it *is* one.
    - The superseded agreement, its hash, its acceptances and its PDF stay
      exactly as they were. What both parties signed in 2026 is still readable
      after the 2028 amendment, which is the same promise the template registry
      makes about wording.

    The amendment renders against **today's** template release rather than the
    superseded one. It is a new agreement being accepted now, so it should be
    the current wording; the old lease keeps its own version recorded on its own
    snapshot.
    """
    assert_landlord_side(lease, user)
    # An amendment is a new agreement over a new period. The running agreement
    # continues untouched; a replacement waits for plan capacity.
    from apps.billing import enforcement as billing

    billing.assert_open_for_new_activity(unit=lease.unit, action="renew_lease")
    if lease.workflow_version != LeaseWorkflow.CANONICAL:
        raise Conflict("Only a guided agreement can be amended.")
    if lease.status != LeaseStatus.ACTIVE:
        raise Conflict(
            "Only an active agreement is amended. One that has not been accepted "
            "is still a draft, and one that has ended is history."
        )

    # The database refuses a second open amendment of the same version. Ask
    # first anyway, so the provider is told what is in their way rather than
    # being shown a constraint violation.
    open_amendment = Lease.objects.filter(supersedes=lease, status__in=OPEN_STATUSES).first()
    if open_amendment is not None:
        raise Conflict("An amendment to this agreement is already open.")

    from .templates import canonical_template

    amendment = Lease(
        workflow_version=LeaseWorkflow.CANONICAL,
        template=canonical_template(),
        supersedes=lease,
        unit=lease.unit,
        bed=lease.bed,
        # The person amending signs for the provider, exactly as at drafting.
        # It is not inherited from the original, which may have been prepared by
        # somebody who has since left the team.
        landlord=user,
        tenant=lease.tenant,
        application=lease.application,
        listing=lease.listing,
        tenancy=lease.tenancy,
        activation_requirement=lease.activation_requirement,
    )
    # Everything carries over, so an amendment that changes the rent does not
    # quietly drop the utilities, the occupants or the custom terms.
    for field in BUILDER_FIELDS:
        setattr(amendment, field, data[field] if field in data else getattr(lease, field))
    amendment.ends_on = amendment.compute_ends_on()

    # Deliberately no `assert_target_is_free`: the unit is occupied by the very
    # agreement being replaced. The live-lease constraints exempt superseding
    # rows for the same reason.
    amendment.save()

    record(
        action=AuditAction.CREATE,
        aggregate_type="lease",
        aggregate_id=amendment.id,
        actor=user,
        metadata={
            "amends_lease_id": str(lease.id),
            "amends_content_hash": getattr(lease.agreement, "content_hash", ""),
            "template_version": amendment.template.version,
            "unit_id": str(lease.unit_id),
        },
    )
    emit(
        DomainEvent(
            "lease.amendment_opened.v1",
            "lease",
            str(amendment.id),
            {"supersedes_id": str(lease.id), "tenant_id": str(lease.tenant_id)},
        )
    )
    return amendment


def _assert_builder_complete(lease: Lease) -> None:
    if not lease.rent_minor or lease.rent_minor <= 0:
        raise ValidationFailed("Set the rent before reviewing the agreement.")
    if not lease.starts_on or not lease.term_months:
        raise ValidationFailed("Set the term before reviewing the agreement.")
    structured = lease.structured_terms or {}
    required = {
        "utilities": "Record how utilities are handled.",
        "provider_responsibilities": "Choose the provider responsibilities.",
        "tenant_responsibilities": "Choose the tenant responsibilities.",
    }
    for key, message in required.items():
        if not structured.get(key):
            raise ValidationFailed(message)


@transaction.atomic
def ready_lease(*, lease: Lease, user) -> Lease:
    assert_landlord_side(lease, user)
    if lease.workflow_version != LeaseWorkflow.CANONICAL:
        raise Conflict("This older agreement does not have a Ready checkpoint.")
    if lease.status != LeaseStatus.DRAFT:
        raise Conflict("Only a draft can be marked ready.")
    _assert_builder_complete(lease)
    lease.status = LeaseStatus.READY
    lease.ready_at = timezone.now()
    lease.save(update_fields=["status", "ready_at", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=user,
        changes={"status": [LeaseStatus.DRAFT, LeaseStatus.READY]},
        metadata={
            "template_code": lease.template.code,
            "template_version": lease.template.version,
            "legal_review_status": lease.template.review_status,
        },
    )
    return lease


@transaction.atomic
def offer_lease(*, lease: Lease, user, request=None) -> Lease:
    """Send it to the tenant. This is the landlord's acceptance."""
    assert_landlord_side(lease, user)
    # An offer already sent before a restriction can still be accepted — it
    # counts as running. A new one waits for plan capacity.
    from apps.billing import enforcement as billing

    billing.assert_open_for_new_activity(unit=lease.unit, action="offer_lease")
    required_status = (
        LeaseStatus.READY
        if lease.workflow_version == LeaseWorkflow.CANONICAL
        else LeaseStatus.DRAFT
    )
    if lease.status != required_status:
        raise Conflict("That agreement has already been sent.")
    if (
        lease.workflow_version == LeaseWorkflow.CANONICAL
        and getattr(settings, "LEASE_TEMPLATE_REQUIRE_APPROVAL", False)
        and lease.template.review_status != TemplateReviewStatus.APPROVED
    ):
        raise ValidationFailed(
            "This agreement template still requires Ghana-qualified legal approval."
        )

    # The advance is judged before the offer goes out, not after the tenant has
    # read it. Under the default `warn` stance this refuses nothing; an operator
    # who has taken legal advice can set `block` without a code change.
    assessment = advance_policy.assess(
        advance_months=lease.advance_months, rent_period=lease.rent_period
    )
    if assessment.blocks:
        raise ValidationFailed(assessment.message)

    now = timezone.now()
    lease.status = LeaseStatus.OFFERED
    lease.offered_at = now
    if lease.workflow_version == LeaseWorkflow.LEGACY:
        lease.landlord_accepted_at = now
    lease.save(update_fields=["status", "offered_at", "landlord_accepted_at", "updated_at"])

    # The terms are frozen here, as the offer goes out, so that what the tenant
    # is shown and what they accept are the same bytes.
    agreement = execution.execute_offer(
        lease=lease, actor=user, evidence=execution.evidence_from(request)
    )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=user,
        changes={"status": [required_status, LeaseStatus.OFFERED]},
        metadata={
            "content_hash": agreement.content_hash,
            "hash_scope": agreement.hash_scope,
            "template_code": agreement.template_code,
            "template_version": agreement.template_version,
            "advance_stance": assessment.stance,
            "advance_exceeds_threshold": assessment.exceeds,
        },
    )
    emit(
        DomainEvent(
            "lease.offered.v1",
            "lease",
            str(lease.id),
            {"tenant_id": str(lease.tenant_id), "unit_id": str(lease.unit_id)},
        )
    )
    return lease


@transaction.atomic
def record_tenant_review(*, lease: Lease, user) -> Lease:
    """Record the first deliberate opening of the complete frozen offer."""
    assert_tenant(lease, user)
    if lease.status not in (LeaseStatus.OFFERED, LeaseStatus.TENANT_ACCEPTED):
        return lease
    if lease.tenant_reviewed_at is not None:
        return lease
    lease.tenant_reviewed_at = timezone.now()
    lease.save(update_fields=["tenant_reviewed_at", "updated_at"])
    record(
        action=AuditAction.VIEW,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=user,
        metadata={
            "content_hash": lease.agreement.content_hash if hasattr(lease, "agreement") else "",
            "complete_agreement_review": True,
        },
    )
    return lease


@transaction.atomic
def accept_lease(
    *,
    lease: Lease,
    user,
    confirmed: bool = True,
    acknowledged: bool = False,
    request=None,
) -> Lease:
    """The tenant's acceptance. The second one activates the agreement.

    Who may accept, and when, is decided by `lease.policies` rather than here,
    so the same answer serves this service and the permitted-actions payload
    the client renders from. See ADR 0021.
    """
    enforce(can_accept_offer(actor=user, target=lease), confirmed=confirmed)

    lease.tenant_accepted_at = timezone.now()

    agreement = getattr(lease, "agreement", None)
    if agreement is not None:
        integrity = execution.verify(agreement)
        if not integrity["hash_matches"] or any(
            not acceptance["matches"] for acceptance in integrity["accepted_by"]
        ):
            raise Conflict(
                "These agreement terms no longer match the offered version. "
                "Do not accept it; ask the provider to send a new offer."
            )
        execution.record_acceptance(
            agreement=agreement,
            party=AcceptanceParty.TENANT,
            user=user,
            evidence=execution.evidence_from(request),
        )
        # Preserve the tenant's exact acknowledgement with the frozen offer.
        # The provider's later confirmation must not be able to choose it on
        # the tenant's behalf.
        agreement.advance_acknowledged = acknowledged
        agreement.save(update_fields=["advance_acknowledged", "updated_at"])

    if lease.workflow_version == LeaseWorkflow.CANONICAL:
        previous = lease.status
        lease.status = LeaseStatus.TENANT_ACCEPTED
        lease.save(update_fields=["status", "tenant_accepted_at", "updated_at"])
        record(
            action=AuditAction.UPDATE,
            aggregate_type="lease",
            aggregate_id=lease.id,
            actor=user,
            changes={"status": [previous, LeaseStatus.TENANT_ACCEPTED]},
            metadata={"content_hash": agreement.content_hash if agreement else ""},
        )
        emit(
            DomainEvent(
                "lease.tenant_accepted.v1",
                "lease",
                str(lease.id),
                {"landlord_id": str(lease.landlord_id), "tenant_id": str(lease.tenant_id)},
            )
        )
        return lease

    if lease.both_accepted:
        previous = lease.status
        lease.status = LeaseStatus.AWAITING_ACTIVATION
        lease.save(update_fields=["status", "tenant_accepted_at", "updated_at"])
        if agreement is not None:
            execution.mark_executed(agreement=agreement, acknowledged=acknowledged)
        record(
            action=AuditAction.UPDATE,
            aggregate_type="lease",
            aggregate_id=lease.id,
            actor=user,
            changes={"status": [previous, LeaseStatus.AWAITING_ACTIVATION]},
            metadata={"activation_requirement": lease.activation_requirement},
        )
        if lease.activation_requirement == LeaseActivationRequirement.LEASE_ACCEPTED:
            lease = activate_lease(
                lease=lease,
                actor=user,
                satisfied_requirement=LeaseActivationRequirement.LEASE_ACCEPTED,
            )
    else:  # pragma: no cover - offered always carries the landlord's acceptance
        lease.save(update_fields=["tenant_accepted_at", "updated_at"])
    return lease


@transaction.atomic
def confirm_lease(*, lease: Lease, user, request=None) -> Lease:
    """Provider's final acceptance after the tenant has accepted the frozen offer."""
    assert_landlord_side(lease, user)
    if lease.workflow_version != LeaseWorkflow.CANONICAL:
        raise Conflict("This older agreement was confirmed when it was sent.")
    if lease.status != LeaseStatus.TENANT_ACCEPTED:
        raise Conflict("The tenant has not accepted this agreement for confirmation.")
    agreement = lease.agreement
    integrity = execution.verify(agreement)
    if not integrity["hash_matches"] or any(
        not acceptance["matches"] for acceptance in integrity["accepted_by"]
    ):
        raise Conflict("The frozen agreement no longer matches its acceptance record.")

    execution.record_acceptance(
        agreement=agreement,
        party=AcceptanceParty.LANDLORD,
        user=user,
        evidence=execution.evidence_from(request),
    )
    now = timezone.now()
    lease.landlord_accepted_at = now
    lease.provider_confirmed_at = now
    lease.status = LeaseStatus.AWAITING_ACTIVATION
    lease.save(
        update_fields=[
            "landlord_accepted_at",
            "provider_confirmed_at",
            "status",
            "updated_at",
        ]
    )
    execution.mark_executed(
        agreement=agreement,
        acknowledged=agreement.advance_acknowledged,
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=user,
        changes={"status": [LeaseStatus.TENANT_ACCEPTED, LeaseStatus.AWAITING_ACTIVATION]},
        metadata={
            "content_hash": agreement.content_hash,
            "final_pdf_hash": agreement.final_pdf_hash,
            "activation_requirement": lease.activation_requirement,
        },
    )
    if lease.activation_requirement == LeaseActivationRequirement.LEASE_ACCEPTED:
        lease = activate_lease(
            lease=lease,
            actor=user,
            satisfied_requirement=LeaseActivationRequirement.LEASE_ACCEPTED,
        )
    return lease


@transaction.atomic
def activate_lease(*, lease: Lease, actor, satisfied_requirement: str) -> Lease:
    """Activate an accepted agreement after its configured gate is satisfied.

    Today acceptance is the only configured production gate. Payment Core can
    later select ``initial_payment`` and call this same boundary from a trusted
    payment-confirmed event without changing lease acceptance or tenancy code.
    """
    from apps.property.capabilities import PropertyCapability, assert_property_capability

    lease = Lease.objects.select_for_update().get(pk=lease.pk)
    if lease.status == LeaseStatus.ACTIVE:
        return lease
    if lease.status != LeaseStatus.AWAITING_ACTIVATION or not lease.both_accepted:
        raise Conflict("This agreement has not been accepted by both parties.")
    if satisfied_requirement != lease.activation_requirement:
        raise Conflict("The required activation condition has not been confirmed.")

    # Authority may be revoked after an offer but before tenant acceptance.
    assert_property_capability(
        prop=lease.unit.property,
        user=lease.landlord,
        capability=PropertyCapability.LEASES,
    )
    now = timezone.now()
    previous = lease.status
    lease.status = LeaseStatus.ACTIVE
    lease.activated_at = now
    lease.save(update_fields=["status", "tenant_accepted_at", "activated_at", "updated_at"])

    from apps.occupancy.services import ensure_for_lease

    # The occupancy follows the live agreement and the tenancy does not move:
    # one home, one relationship, successive agreements over it.
    ensure_for_lease(lease=lease, actor=lease.landlord)

    # An amendment only retires what it replaces once it is itself live, so an
    # abandoned renegotiation leaves the original exactly as it was.
    if lease.supersedes_id is not None:
        replaced = Lease.objects.select_for_update().get(pk=lease.supersedes_id)
        if replaced.status == LeaseStatus.ACTIVE:
            replaced.status = LeaseStatus.SUPERSEDED
            replaced.superseded_at = now
            replaced.save(update_fields=["status", "superseded_at", "updated_at"])
            record(
                action=AuditAction.UPDATE,
                aggregate_type="lease",
                aggregate_id=replaced.id,
                actor=actor,
                changes={"status": [LeaseStatus.ACTIVE, LeaseStatus.SUPERSEDED]},
                metadata={"superseded_by_lease_id": str(lease.id)},
            )
            # Rent listens for this and closes the replaced schedule. Announced
            # rather than called, so lease still knows nothing about rent.
            emit(
                DomainEvent(
                    "lease.superseded.v1",
                    "lease",
                    str(replaced.id),
                    {
                        "superseded_by_lease_id": str(lease.id),
                        "tenant_id": str(lease.tenant_id),
                    },
                )
            )

    _close_out_the_market(lease, actor=actor)

    record(
        action=AuditAction.UPDATE,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=actor,
        changes={"status": [previous, LeaseStatus.ACTIVE]},
        metadata={
            "advance_months": lease.advance_months,
            "move_in_total_minor": lease.move_in_total_minor,
            "exceeds_statutory_advance": lease.exceeds_statutory_advance,
        },
    )
    emit(
        DomainEvent(
            "lease.activated.v1",
            "lease",
            str(lease.id),
            {
                "tenant_id": str(lease.tenant_id),
                "landlord_id": str(lease.landlord_id),
                "unit_id": str(lease.unit_id),
            },
        )
    )
    return lease


def _close_out_the_market(lease: Lease, *, actor) -> None:
    """The room is taken: stop advertising it and tell the other applicants.

    This is the moment the application slice deliberately left alone. Rejecting
    people on a landlord's behalf is only defensible once the unit is actually
    gone, and now it is.
    """
    from apps.application.models import OPEN_STATUSES as APPLICATION_OPEN
    from apps.application.models import ApplicationStatus, RentalApplication

    # Listing withdrawal is centralized in occupancy creation so private
    # invitations, join approvals and bed leases cannot leave a Unit advert up.
    # Listings are Unit-level, so any allocation also closes Unit-level open
    # applications; a future bed-specific marketplace must model that target.

    others = RentalApplication.objects.filter(
        listing__unit=lease.unit, status__in=APPLICATION_OPEN
    ).exclude(id=lease.application_id or "00000000-0000-0000-0000-000000000000")

    for application in others.select_related("tenant"):
        application.status = ApplicationStatus.REJECTED
        application.decided_by = actor
        application.decided_at = timezone.now()
        application.decision_note = "The place has been let to someone else."
        application.save(
            update_fields=[
                "status",
                "decided_by",
                "decided_at",
                "decision_note",
                "updated_at",
            ]
        )
        emit(
            DomainEvent(
                "application.rejected.v1",
                "application",
                str(application.id),
                {
                    "tenant_id": str(application.tenant_id),
                    "listing_id": str(application.listing_id),
                },
            )
        )


@transaction.atomic
def decline_lease(*, lease: Lease, user, reason: str = "", confirmed: bool = True) -> Lease:
    # The policy requires a reason here: the landlord reads it, and it is often
    # the difference between a lost tenant and a revised offer.
    enforce(
        can_decline_offer(actor=user, target=lease),
        reason=reason,
        confirmed=confirmed,
    )

    previous = lease.status
    lease.status = LeaseStatus.DECLINED
    lease.declined_at = timezone.now()
    lease.decline_reason = reason[:300]
    lease.save(update_fields=["status", "declined_at", "decline_reason", "updated_at"])

    # The offer no longer counts as running, so a space winding down on a
    # restricted plan may now be read-only.
    from apps.billing import enforcement as billing

    billing.rental_activity_ended(unit=lease.unit, actor=user)

    # The application behind this is no longer a live claim on the Unit.
    # Local import: `lease` and `application` are separate domains and must
    # not import each other at module scope.
    from apps.application.services import conclude_for_lease

    conclude_for_lease(lease)

    record(
        action=AuditAction.UPDATE,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=user,
        changes={"status": [previous, lease.status]},
    )
    emit(
        DomainEvent(
            "lease.declined.v1", "lease", str(lease.id), {"landlord_id": str(lease.landlord_id)}
        )
    )
    return lease


@transaction.atomic
def cancel_lease(*, lease: Lease, user, reason: str = "") -> Lease:
    """Withdraw an agreement before it is live. Never after."""
    assert_landlord_side(lease, user)
    if lease.status not in (LeaseStatus.DRAFT, LeaseStatus.READY, LeaseStatus.OFFERED):
        raise Conflict("An agreement that is already live cannot be cancelled. End it instead.")

    previous = lease.status
    lease.status = LeaseStatus.CANCELLED
    lease.cancelled_at = timezone.now()
    lease.decline_reason = reason[:300]
    lease.save(update_fields=["status", "cancelled_at", "decline_reason", "updated_at"])

    # A withdrawn offer no longer counts as running on a restricted space.
    from apps.billing import enforcement as billing

    billing.rental_activity_ended(unit=lease.unit, actor=user)

    # The application behind this is no longer a live claim on the Unit.
    # Local import: `lease` and `application` are separate domains and must
    # not import each other at module scope.
    from apps.application.services import conclude_for_lease

    conclude_for_lease(lease)

    record(
        action=AuditAction.UPDATE,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=user,
        changes={"status": [previous, lease.status]},
    )
    emit(
        DomainEvent(
            "lease.cancelled.v1", "lease", str(lease.id), {"tenant_id": str(lease.tenant_id)}
        )
    )
    return lease


@transaction.atomic
def end_lease(*, lease: Lease, user, reason: str = "", confirmed: bool = False) -> Lease:
    """Close a live tenancy. Either party; the record says who."""
    if str(lease.tenant_id) == str(user.id):
        assert_tenant(lease, user)
    else:
        assert_landlord_side(lease, user)
    if lease.status != LeaseStatus.ACTIVE:
        raise Conflict("Only a live agreement can be ended.")
    if not confirmed:
        raise ValidationFailed(
            "Confirm that you want to end this tenancy. This ends the active occupancy "
            "and does not automatically relist the space."
        )

    lease.status = LeaseStatus.ENDED
    lease.ended_on = timezone.now().date()
    lease.decline_reason = reason[:300]
    lease.save(update_fields=["status", "ended_on", "decline_reason", "updated_at"])

    # The application behind this is no longer a live claim on the Unit.
    # Local import: `lease` and `application` are separate domains and must
    # not import each other at module scope.
    from apps.application.services import conclude_for_lease

    conclude_for_lease(lease)

    from apps.occupancy.services import end_for_lease

    end_for_lease(lease=lease, actor=user)

    record(
        action=AuditAction.UPDATE,
        aggregate_type="lease",
        aggregate_id=lease.id,
        actor=user,
        changes={"status": [LeaseStatus.ACTIVE, LeaseStatus.ENDED]},
        metadata={"by": "tenant" if str(lease.tenant_id) == str(user.id) else "landlord"},
    )
    emit(
        DomainEvent(
            "lease.ended.v1",
            "lease",
            str(lease.id),
            {"tenant_id": str(lease.tenant_id), "landlord_id": str(lease.landlord_id)},
        )
    )
    return lease
