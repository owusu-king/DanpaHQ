"""Property CRUD services."""

from __future__ import annotations

from django.db import models, transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.core.phone import PhoneNumberError, normalise_ghana_msisdn
from apps.outbox.services import emit

from .models import (
    Bed,
    Property,
    PropertyMedia,
    PropertyProviderApplication,
    PropertyRelationship,
    PropertyRelationshipType,
    ProviderApplicationStatus,
    Unit,
)


def current_identity_verification(user):
    from apps.trust.models import SubjectType, VerificationKind
    from apps.trust.services import current_for

    return current_for(SubjectType.USER, user.id, VerificationKind.IDENTITY)


def provider_readiness(user, *, property_id=None) -> dict:
    """Account identity and property authority progress, never listing progress.

    Identity is global to the account. Authority is scoped to one property.
    Units and draft listings are private inventory and are intentionally absent
    from this workflow; public advertising begins only when the provider later
    invokes the listing publication workflow explicitly.
    """
    from apps.trust.models import SubjectType, Verification, VerificationKind, VerificationStatus
    from apps.trust.services import trust_summary

    identity = current_identity_verification(user)
    latest_identity = (
        Verification.objects.for_subject(SubjectType.USER, user.id)
        .filter(kind=VerificationKind.IDENTITY)
        .exclude(status=VerificationStatus.SUPERSEDED)
        .first()
    )
    application_rows = PropertyProviderApplication.objects.filter(applicant=user)
    if property_id is not None:
        application_rows = application_rows.filter(property_id=property_id)
    applications = list(application_rows.select_related("property", "address__locality"))
    application = applications[0] if applications else None
    if not identity:
        next_step = "identity"
    elif application is None or application.status in {
        ProviderApplicationStatus.REJECTED,
        ProviderApplicationStatus.EXPIRED,
    }:
        next_step = "property"
    elif application.status == ProviderApplicationStatus.NEEDS_MORE:
        next_step = "more_info"
    elif application.status == ProviderApplicationStatus.APPROVED:
        next_step = "approved"
    else:
        next_step = "review"

    return {
        "identity": trust_summary(SubjectType.USER, user.id)[VerificationKind.IDENTITY],
        "identity_verification_id": str(latest_identity.id) if latest_identity else None,
        "identity_status": latest_identity.status if latest_identity else "not_started",
        "identity_decision_note": latest_identity.decision_note if latest_identity else "",
        "status": application.status if application else "not_started",
        "next_step": next_step,
        "application_id": str(application.id) if application else None,
        "property_id": (
            str(application.property_id)
            if application and application.property_id
            else (str(property_id) if property_id is not None else None)
        ),
        "decision_note": application.decision_note if application else "",
        "onboarding_stage": next_step,
        # Kept for one client-release compatibility. Listing state belongs to
        # the listing API and no longer drives verification navigation.
        "unit_id": None,
        "listing_id": None,
        "listing_status": "",
        "listing_review_note": "",
    }


def resolve_property_type(data: dict) -> str:
    """The category, required and checked.

    This used to default to the literal `"house"`. That was survivable while the
    field was only a label, and became a bug the moment it decided what may be
    let inside: a silent default put every property that omitted it into a
    category nobody chose, and `"house"` is not even one of the categories any
    more.

    Asked for, never inferred. There is no sensible default — a hostel is not a
    residential property with extra rooms, and guessing wrong changes what the
    provider is allowed to add.
    """
    from .models import LETTING_TYPES, SALE_TYPES, PropertyPurpose, PropertyType

    purpose = resolve_purpose(data)
    allowed = SALE_TYPES if purpose == PropertyPurpose.SALE else LETTING_TYPES
    readable = ", ".join(label.lower() for value, label in PropertyType.choices if value in allowed)

    value = (data.get("property_type") or "").strip()
    if not value:
        if purpose == PropertyPurpose.SALE:
            raise ValidationFailed("Choose whether this is a house, land or a commercial property.")
        raise ValidationFailed(
            "Choose whether this is a residential, commercial or hostel property."
        )
    if value not in allowed:
        raise ValidationFailed(f"Choose one of: {readable}.")
    return value


def resolve_purpose(data: dict) -> str:
    """Letting unless the caller says sale. Every client that predates sales lets."""
    from .models import PropertyPurpose

    value = (data.get("purpose") or PropertyPurpose.LETTING).strip()
    if value not in PropertyPurpose.values:
        raise ValidationFailed("Choose whether this property is to let or for sale.")
    return value


def assert_is_for_letting(prop: Property) -> None:
    """A property for sale is sold whole: it has no Units or beds."""
    if prop.is_for_sale:
        raise ValidationFailed(
            "This property is for sale, and is sold whole. It does not take Units."
        )


def _assert_may_ask_for_review(user) -> None:
    """What an account must have before a reviewer is asked to spend time on it."""
    from apps.trust import services as trust_services
    from apps.trust.models import SubjectType, VerificationKind

    if not current_identity_verification(user):
        raise PermissionDenied("Verify your identity before submitting a property for review.")
    if trust_services.current_for(SubjectType.USER, user.id, VerificationKind.PHONE) is None:
        raise PermissionDenied("Confirm your account phone number before submitting a property.")


def authority_evidence_type(*, file, declared: dict, relationship_type: str, prop) -> str:
    """Which kind of document one uploaded file is, checked against what is asked.

    A property for sale asks for more than one document — the relationship, the
    title and, for land, the site plan — so each file says which it is, keyed by
    its id. A file that says nothing is the relationship's document, which is
    what every client that predates sales sends. A declared type the review does
    not ask for is refused rather than filed where nobody will look for it.
    """
    from apps.trust.evidence_policy import authority_evidence_types, authority_requirements

    default = authority_requirements(relationship_type, prop)[0].evidence_type
    chosen = (declared or {}).get(str(file.id)) or default
    if chosen not in authority_evidence_types(relationship_type, prop):
        raise ValidationFailed("That document is not one this property's review asks for.")
    return chosen


@transaction.atomic
def submit_provider_application(
    *, user, data: dict, files: list, queue: bool = True
) -> PropertyProviderApplication:
    """Record an evidenced claim to own or represent one property.

    ``queue=False`` records it without asking anyone to look at it — the claim
    sits as a `DRAFT` with its document attached, exactly the way a condition
    review holds photographs before `submit_for_review` queues them.

    That flag is the whole of the fix for a real defect. Recording the document
    used to be the same act as asking for a decision, so the second step of
    property creation showed **"Send this claim for review"** and filed it. By
    the time the provider reached the review step there was nothing left of the
    claim to send, so the final button of the creation flow read "Send the
    photographs" — accurate, and nothing to do with creating a property.

    Photographs already worked this way. Documents now do too, and the two
    halves go to the queue together in `submit_property_for_verification`.
    """
    from apps.identity.models import Role
    from apps.identity.services import grant_role
    from apps.trust import services as trust_services
    from apps.trust.models import SubjectType, VerificationKind, VerificationMethod

    # Gated on *sending*, not on recording. Asking somebody to verify their
    # identity before they may save a document into a property they are still
    # creating is the same conflation this flag exists to undo — and it is the
    # reviewer who needs the identity confirmed, so the check belongs where the
    # reviewer does.
    if queue:
        _assert_may_ask_for_review(user)

    relationship_type = data.get("relationship_type")
    allowed = {
        PropertyRelationshipType.OWNER,
        PropertyRelationshipType.AGENT,
        PropertyRelationshipType.MANAGER,
        PropertyRelationshipType.COMPANY_REPRESENTATIVE,
    }
    if relationship_type not in allowed:
        raise ValidationFailed("Choose your relationship to the property.")
    existing_property = None
    organization = None
    if data.get("property_id"):
        from apps.organization.services import can_manage_property, get_organization_or_404

        existing_property = (
            Property.objects.filter(id=data["property_id"]).select_related("address").first()
        )
        if existing_property is None or not can_manage_property(prop=existing_property, user=user):
            raise PermissionDenied("You cannot submit authority for that private property.")
        if data.get("organization_id"):
            organization = get_organization_or_404(data["organization_id"], user)
            if not existing_property.organization_relationships.filter(
                organization=organization, ended_at__isnull=True
            ).exists():
                raise PermissionDenied("That property does not belong to this organization.")
        data = {
            **data,
            "title": existing_property.title,
            "property_type": existing_property.property_type,
            "purpose": existing_property.purpose,
            "address_id": existing_property.address_id,
        }
    else:
        if not data.get("address_id"):
            raise ValidationFailed("Choose the property's address.")
        if not str(data.get("title", "")).strip():
            raise ValidationFailed("Give the property an internal name.")
    if not files:
        raise ValidationFailed("Upload evidence for the authority claim before submitting.")
    if any(not file.is_usable or not file.is_owned_by(user) for file in files):
        raise PermissionDenied("Every evidence file must be ready and uploaded by you.")

    owner_phone = ""
    if relationship_type != PropertyRelationshipType.OWNER:
        if not str(data.get("owner_name", "")).strip() or not data.get("owner_phone"):
            raise ValidationFailed("Provide the property owner's name and phone number.")
        try:
            owner_phone = normalise_ghana_msisdn(str(data["owner_phone"]))
        except PhoneNumberError as exc:
            raise ValidationFailed(str(exc)) from exc
    if (
        relationship_type == PropertyRelationshipType.COMPANY_REPRESENTATIVE
        and not str(data.get("company_name", "")).strip()
    ):
        raise ValidationFailed("Provide the company or organisation name.")

    # One open claim per *property*, not per person.
    #
    # It used to be per person, which made sense when this ran once during
    # onboarding for a provider's first property. Properties are created freely
    # now and each needs its own claim, so an account-wide rule meant a landlord
    # with four buildings had to claim them one at a time, waiting for a review
    # between each — and the refusal they got while trying named no property, so
    # there was no way to tell which one was blocking.
    # `WITHDRAWN` is deliberately absent: a claim the provider took back is not
    # in progress, and counting it would make withdrawal a trap rather than a
    # way out.
    # `PropertyProviderApplication.property` is a `OneToOneField`: one claim per
    # property, permanently. So a property that already has one is *revised*
    # rather than given a second, and the row is reused.
    #
    # This is also why withdrawal returns the claim to `DRAFT` rather than
    # marking it `WITHDRAWN`. A withdrawn row still occupies the property's one
    # slot, so a provider who took a claim back could never file another —
    # withdrawal was a database-level dead end, and the test that said otherwise
    # only checked the open-claims query and never tried to insert.
    existing_claim = None
    if existing_property is not None:
        existing_claim = PropertyProviderApplication.objects.filter(
            property=existing_property
        ).first()
        if existing_claim is not None and existing_claim.status in {
            ProviderApplicationStatus.PENDING_REVIEW,
            ProviderApplicationStatus.NEEDS_MORE,
        }:
            raise Conflict(
                "There is already a review in progress for this property. "
                "We will let you know the outcome."
            )
        if existing_claim is not None and existing_claim.status == (
            ProviderApplicationStatus.APPROVED
        ):
            raise Conflict("This property has already been confirmed as yours to let.")

    open_claims = PropertyProviderApplication.objects.filter(
        applicant=user,
        status__in=[
            ProviderApplicationStatus.PENDING_REVIEW,
            ProviderApplicationStatus.NEEDS_MORE,
        ],
    )
    if existing_property is not None:
        open_claims = open_claims.filter(property=existing_property)
    else:
        # A claim that names no property yet cannot be told apart from another
        # of the same shape, so those stay one at a time.
        open_claims = open_claims.filter(property__isnull=True)

    if open_claims.exists():
        raise Conflict(
            "There is already a review in progress for this property. "
            "We will let you know the outcome."
            if existing_property is not None
            else "You already have a property authority review in progress."
        )

    if not user.has_role(Role.LANDLORD):
        grant_role(user=user, role=Role.LANDLORD, granted_by=user)

    fields = {
        "applicant": user,
        "organization": organization,
        "relationship_type": relationship_type,
        "title": str(data["title"]).strip(),
        "property_type": resolve_property_type(data),
        "address_id": data["address_id"],
        "owner_name": str(data.get("owner_name", "")).strip(),
        "owner_phone": owner_phone,
        "company_name": str(data.get("company_name", "")).strip(),
        "status": (
            ProviderApplicationStatus.PENDING_REVIEW if queue else ProviderApplicationStatus.DRAFT
        ),
        "submitted_at": timezone.now() if queue else None,
        "decision_note": "",
    }
    if existing_claim is not None:
        for name, value in fields.items():
            setattr(existing_claim, name, value)
        existing_claim.save()
        application = existing_claim
        # The previous document steps aside so a fresh review can open: a
        # revised claim is a different claim, and stacking evidence from both
        # would show a reviewer two answers to one question.
        _supersede_claim_verification(application)
    else:
        application = PropertyProviderApplication.objects.create(
            property=existing_property, **fields
        )
    verification = trust_services.start_verification(
        subject_type=SubjectType.PROVIDER_APPLICATION,
        subject_id=application.id,
        kind=VerificationKind.PROPERTY_AUTHORITY,
        method=VerificationMethod.DOCUMENT_REVIEW,
        submitted_by=user,
        queue=queue,
    )
    # The policy decides what this relationship has to show, rather than a
    # literal map that could not vary by anything and had no way to express an
    # acceptable alternative. See `trust.evidence_policy`.
    from apps.trust.evidence_policy import POLICY_VERSION

    declared = data.get("evidence_types") or {}
    for file in files:
        evidence_type = authority_evidence_type(
            file=file,
            declared=declared,
            relationship_type=relationship_type,
            prop=existing_property,
        )
        trust_services.attach_evidence(
            verification,
            evidence_type=evidence_type,
            file=file,
            collected_by=user,
            notes=(
                "Submitted with property provider application. "
                f"Evidence policy {POLICY_VERSION}, filed as {evidence_type}."
            ),
        )
    application.authority_verification_id = verification.id
    application.save(update_fields=["authority_verification_id", "updated_at"])
    return application


@transaction.atomic
def submit_provider_application_more_info(
    *, application, user, files: list, evidence_types: dict | None = None
):
    from apps.trust import services as trust_services
    from apps.trust.models import (
        ReviewQueueEntry,
        Verification,
        VerificationStatus,
    )

    if application.applicant_id != user.id:
        raise PermissionDenied("You cannot update another person's provider application.")
    if application.status != ProviderApplicationStatus.NEEDS_MORE:
        raise Conflict("This application is not waiting for more information.")
    if not files or any(not file.is_usable or not file.is_owned_by(user) for file in files):
        raise ValidationFailed("Upload at least one ready evidence file from your account.")
    verification = (
        Verification.objects.select_for_update()
        .filter(
            id=application.authority_verification_id,
            status=VerificationStatus.NEEDS_MORE,
        )
        .first()
    )
    if verification is None:
        raise Conflict("The linked review is not waiting for more information.")
    for file in files:
        trust_services.attach_evidence(
            verification,
            evidence_type=authority_evidence_type(
                file=file,
                declared=evidence_types or {},
                relationship_type=application.relationship_type,
                prop=application.property,
            ),
            file=file,
            collected_by=user,
            notes="Additional information requested by the reviewer.",
        )
    verification.status = VerificationStatus.PENDING
    verification.decision_note = ""
    verification.save(update_fields=["status", "decision_note", "updated_at"])
    ReviewQueueEntry.objects.filter(verification=verification).update(
        claimed_by=None,
        claimed_by_management_id=None,
        claimed_at=None,
        claim_expires_at=None,
    )
    application.status = ProviderApplicationStatus.PENDING_REVIEW
    application.decision_note = ""
    application.submitted_at = timezone.now()
    application.save(update_fields=["status", "decision_note", "submitted_at", "updated_at"])
    return application


@transaction.atomic
def apply_provider_application_decision(
    *, verification, approved: bool, reviewer, note: str, management_actor=None
):
    """Apply a trust decision without ever inventing an owner."""
    application = (
        PropertyProviderApplication.objects.select_for_update()
        .select_related("applicant", "address")
        .filter(
            id=verification.subject_id,
            authority_verification_id=verification.id,
        )
        .first()
    )
    if application is None:
        raise ValidationFailed("The provider application linked to this review no longer exists.")

    application.reviewed_by = reviewer
    application.reviewed_by_management_id = getattr(management_actor, "id", None)
    application.reviewed_at = timezone.now()
    application.decision_note = note
    if not approved:
        application.status = ProviderApplicationStatus.REJECTED
        application.save(
            update_fields=[
                "status",
                "reviewed_by",
                "reviewed_by_management_id",
                "reviewed_at",
                "decision_note",
                "updated_at",
            ]
        )
        return

    if not current_identity_verification(application.applicant):
        raise ValidationFailed(
            "The applicant's identity verification is no longer current. "
            "Request a new identity check."
        )

    owner = application.applicant
    if (
        application.relationship_type != PropertyRelationshipType.OWNER
        and not application.property_id
    ):
        from apps.identity.models import User

        owner = User.objects.filter(
            phone=application.owner_phone,
            is_active=True,
            is_phone_verified=True,
        ).first()
        if owner is None:
            raise ValidationFailed(
                "The named owner must first confirm a phone-verified account before this "
                "representative can be approved. Request more information instead."
            )
        from apps.trust.models import SubjectType, VerificationKind
        from apps.trust.services import current_for

        if current_for(SubjectType.USER, owner.id, VerificationKind.PHONE) is None:
            raise ValidationFailed(
                "The named owner's phone verification is not current. "
                "Request more information instead."
            )

    prop = application.property
    if prop is None:
        prop = Property.objects.create(
            owner=owner,
            # `managed_by` is a legacy shortcut that has no verification state.
            # New authority always lives in the evidenced relationship below so a
            # revocation actually removes access.
            managed_by=None,
            created_by=application.applicant,
            title=application.title,
            property_type=application.property_type,
            address=application.address,
        )
        application.property = prop

    if application.organization_id:
        from apps.organization.models import OrganizationPropertyRelationship

        organization_relation = OrganizationPropertyRelationship.objects.filter(
            organization_id=application.organization_id,
            property=prop,
            ended_at__isnull=True,
        ).first()
        if organization_relation is None:
            raise ValidationFailed("The organization no longer has authority over this property.")
        organization_relation.authority_verification_id = verification.id
        organization_relation.authority_verified_at = timezone.now()
        organization_relation.granted_by = reviewer
        organization_relation.note = "Approved through property provider review."
        organization_relation.save(
            update_fields=[
                "authority_verification_id",
                "authority_verified_at",
                "granted_by",
                "note",
                "updated_at",
            ]
        )
    else:
        relationship, _ = PropertyRelationship.objects.get_or_create(
            property=prop,
            user=application.applicant,
            relationship_type=application.relationship_type,
            ended_at=None,
            defaults={
                "granted_by": reviewer,
                "granted_by_management_id": getattr(management_actor, "id", None),
            },
        )
        relationship.authority_verification_id = verification.id
        relationship.authority_verified_at = timezone.now()
        relationship.note = "Approved through property provider review."
        relationship.save(
            update_fields=[
                "authority_verification_id",
                "authority_verified_at",
                "note",
                "updated_at",
            ]
        )
    application.status = ProviderApplicationStatus.APPROVED
    application.save(
        update_fields=[
            "property",
            "status",
            "reviewed_by",
            "reviewed_by_management_id",
            "reviewed_at",
            "decision_note",
            "updated_at",
        ]
    )

    # Authority is one evidence check inside current property-created-first
    # submissions. Establish the evidenced relationship, but do not let that
    # internal approval become the property's final result while condition
    # photographs are still pending.
    if application.condition_verification_id:
        sync_property_submission_status(application=application, note=note)

    from apps.trust.models import SubjectType

    verification.subject_type = SubjectType.PROPERTY
    verification.subject_id = str(prop.id)
    verification.save(update_fields=["subject_type", "subject_id", "updated_at"])
    if (
        application.relationship_type == PropertyRelationshipType.OWNER
        and not application.organization_id
    ):
        from apps.organization.services import ensure_personal_organization_for_property

        ensure_personal_organization_for_property(
            owner=application.applicant,
            prop=prop,
            actor=reviewer or application.applicant,
        )


def property_submission_for_verification(verification):
    """Return the property submission package containing ``verification``.

    Legacy authority-only applications intentionally return their application
    too; callers distinguish them by the absence of a condition verification.
    """

    return (
        PropertyProviderApplication.objects.select_related("property", "applicant")
        .filter(
            models.Q(authority_verification_id=verification.id)
            | models.Q(condition_verification_id=verification.id)
        )
        .first()
    )


def sync_property_submission_status(*, application, note: str = ""):
    """Synchronise the envelope with the one property-verification result.

    The linked verification rows remain immutable evidence-check history. An
    authority approval alone is never a verified property once a condition
    check is part of the package.
    """

    from apps.trust.models import Verification, VerificationStatus

    if not application.condition_verification_id:
        return application
    checks = list(
        Verification.objects.filter(
            id__in=[application.authority_verification_id, application.condition_verification_id]
        )
    )
    if len(checks) != 2:
        return application

    statuses = {row.status for row in checks}
    if VerificationStatus.REVOKED in statuses:
        status = ProviderApplicationStatus.SUSPENDED
    elif VerificationStatus.REJECTED in statuses:
        status = ProviderApplicationStatus.REJECTED
    elif VerificationStatus.NEEDS_MORE in statuses:
        status = ProviderApplicationStatus.NEEDS_MORE
    elif VerificationStatus.EXPIRED in statuses:
        status = ProviderApplicationStatus.EXPIRED
    elif statuses == {VerificationStatus.APPROVED}:
        status = ProviderApplicationStatus.APPROVED
    else:
        status = ProviderApplicationStatus.PENDING_REVIEW

    update_fields = ["status", "updated_at"]
    application.status = status
    if note:
        application.decision_note = note[:600]
        update_fields.append("decision_note")
    application.save(update_fields=update_fields)
    return application


@transaction.atomic
def decide_property_verification(
    *,
    application,
    approved: bool,
    reviewer=None,
    management_actor=None,
    note: str = "",
    internal_note: str = "",
    validity_days: int | None = None,
):
    """Decide one property package, including both evidence checks.

    The condition check is decided first and authority second. The outer
    transaction makes that ordering invisible: relationship creation, both
    decisions, audit records and outbox events all commit or all roll back.
    """

    from apps.trust import services as trust_services
    from apps.trust.models import Verification, VerificationStatus

    application = PropertyProviderApplication.objects.select_for_update().get(id=application.id)
    ids = [application.condition_verification_id, application.authority_verification_id]
    if any(value is None for value in ids):
        raise Conflict("This property does not have one complete verification package.")
    checks = {row.id: row for row in Verification.objects.select_for_update().filter(id__in=ids)}
    if len(checks) != 2:
        raise Conflict("One of the property's verification checks is missing.")

    decision_changed = False
    for verification_id in ids:
        verification = checks[verification_id]
        if verification.status in {VerificationStatus.PENDING, VerificationStatus.NEEDS_MORE}:
            trust_services.decide(
                verification,
                approved=approved,
                decided_by=reviewer,
                management_actor=management_actor,
                note=note,
                internal_note=internal_note,
                validity_days=validity_days,
            )
            decision_changed = True
            continue
        expected = VerificationStatus.APPROVED if approved else VerificationStatus.REJECTED
        if verification.status != expected:
            raise Conflict("This property package already contains a different decision.")

    application.refresh_from_db()
    if not decision_changed:
        # Older management clients submitted one request for each visible
        # evidence check. The first request now decides the whole package; the
        # second must be a harmless retry, not a duplicate audit/event.
        sync_property_submission_status(application=application)
        return application
    sync_property_submission_status(application=application, note=note)
    application.reviewed_by = reviewer
    application.reviewed_by_management_id = getattr(management_actor, "id", None)
    application.reviewed_at = timezone.now()
    application.save(
        update_fields=[
            "reviewed_by",
            "reviewed_by_management_id",
            "reviewed_at",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.VERIFICATION_DECISION,
        aggregate_type="property",
        aggregate_id=application.property_id,
        actor=reviewer,
        management_actor=management_actor,
        changes={"verification": [ProviderApplicationStatus.PENDING_REVIEW, application.status]},
        metadata={
            "submission_id": str(application.id),
            "authority_verification_id": str(application.authority_verification_id),
            "condition_verification_id": str(application.condition_verification_id),
        },
    )
    emit(
        DomainEvent(
            "property.verification_decided.v1",
            "property",
            str(application.property_id),
            {
                "submission_id": str(application.id),
                "verified": application.status == ProviderApplicationStatus.APPROVED,
            },
        )
    )
    return application


@transaction.atomic
def request_property_verification_more_information(
    *, application, reviewer=None, management_actor=None, note: str
):
    """Request changes to the package as one property-level outcome."""

    from apps.trust import services as trust_services
    from apps.trust.models import Verification, VerificationStatus

    application = PropertyProviderApplication.objects.select_for_update().get(id=application.id)
    ids = [application.condition_verification_id, application.authority_verification_id]
    if any(value is None for value in ids):
        raise Conflict("This property does not have one complete verification package.")
    checks = list(Verification.objects.select_for_update().filter(id__in=ids))
    if len(checks) != 2:
        raise Conflict("One of the property's verification checks is missing.")
    for verification in checks:
        if verification.status == VerificationStatus.PENDING:
            trust_services.request_more_information(
                verification,
                note=note,
                decided_by=reviewer,
                management_actor=management_actor,
            )
        elif verification.status == VerificationStatus.NEEDS_MORE:
            # Treat a repeated package request from a legacy per-check client
            # as idempotent.
            continue
        elif verification.status != VerificationStatus.APPROVED:
            raise Conflict("This property package already contains a final decision.")
    application.refresh_from_db()
    sync_property_submission_status(application=application, note=note)
    return application


def mark_provider_application_needs_more(
    *, verification, reviewer, note: str, management_actor=None
):
    PropertyProviderApplication.objects.filter(
        id=verification.subject_id,
        authority_verification_id=verification.id,
    ).update(
        status=ProviderApplicationStatus.NEEDS_MORE,
        reviewed_by=reviewer,
        reviewed_by_management_id=getattr(management_actor, "id", None),
        reviewed_at=timezone.now(),
        decision_note=note,
        updated_at=timezone.now(),
    )


def suspend_property_authority(*, verification, expired: bool = False):
    """Revoke the relationship that was backed by this exact decision."""
    now = timezone.now()
    PropertyRelationship.objects.filter(
        property_id=verification.subject_id,
        authority_verification_id=verification.id,
        ended_at__isnull=True,
    ).update(ended_at=now, updated_at=now)
    from apps.organization.models import OrganizationPropertyRelationship

    OrganizationPropertyRelationship.objects.filter(
        property_id=verification.subject_id,
        authority_verification_id=verification.id,
        ended_at__isnull=True,
    ).update(ended_at=now, updated_at=now)
    PropertyProviderApplication.objects.filter(authority_verification_id=verification.id).update(
        status=(
            ProviderApplicationStatus.EXPIRED if expired else ProviderApplicationStatus.SUSPENDED
        ),
        updated_at=now,
    )


def get_property_or_404(pk, user) -> Property:
    prop = (
        Property.objects.filter(id=pk)
        # Down to region: the serializer names the whole chain, and without this
        # every property read is four queries instead of one.
        .select_related("address__locality__district__region", "owner")
        .first()
    )
    if prop is None or prop.deleted_at is not None:
        raise NotFound("We could not find that property.")
    return prop


def assert_can_manage(prop: Property, user) -> None:
    if not prop.is_managed_by(user):
        raise PermissionDenied("You do not have access to that property.")


@transaction.atomic
def create_property(*, user, data: dict) -> Property:
    if not user.is_staff:
        # A self-selected role is intent, not evidence of ownership. Customer
        # property rows are materialised only by an approved provider review.
        raise PermissionDenied(
            "Submit the property through provider verification before creating listings."
        )

    address_id = data.get("address_id")
    if not address_id:
        raise ValidationFailed("Choose an address for the property.")

    prop = Property.objects.create(
        owner=user,
        created_by=user,
        title=data.get("title", ""),
        property_type=resolve_property_type(data),
        address_id=address_id,
        water_source=data.get("water_source", "unknown"),
        power_meter_type=data.get("power_meter_type", "unknown"),
        compound_type=data.get("compound_type", "unknown"),
        notes=data.get("notes", ""),
    )
    PropertyRelationship.objects.create(
        property=prop,
        user=user,
        relationship_type=PropertyRelationshipType.OWNER,
        granted_by=user,
    )

    record(
        action=AuditAction.CREATE,
        aggregate_type="property",
        aggregate_id=prop.id,
        actor=user,
        metadata={"type": prop.property_type},
    )
    emit(
        DomainEvent(
            "property.created.v1",
            "property",
            str(prop.id),
            {"owner_id": str(user.id), "type": prop.property_type},
        )
    )
    return prop


def assert_can_create_property(user) -> None:
    """A property may only be created by an approved provider.

    This is the one gate that moved. Creation used to be open to anyone with a
    workspace, on the reasoning that private inventory reaches nobody — but a
    property is the root every building, unit, tenancy and listing hangs from,
    and letting an unreviewed account create one meant the review queue filled
    with structures nobody had yet stood behind.

    Enforced here, in the service, so it applies to every caller. A client that
    hides the button is being helpful; it is not the boundary.
    """
    from apps.identity.services import account_capabilities

    if user.is_staff:
        return
    if not account_capabilities(user)["provider"]["can_create_property"]:
        raise PermissionDenied(
            "Your provider verification is still being reviewed. You can create "
            "properties once it is approved."
        )


def assert_can_create_property_for(*, user, organization, membership=None) -> None:
    """Whether this person may add a Property to *this* Portfolio.

    Two bases, and the second is what a Team administrator works on. An approved
    provider creates on their own standing, anywhere they have authority. Inside
    a Portfolio that an approved provider already owns, an administrator creates
    on that Portfolio's standing plus their own identity verification — which is
    what being invited as an administrator means, and why joining a Team never
    asks anybody to open an independent provider account of their own.

    The account-level gate stays the rule where there is no Portfolio behind the
    person yet: creating their first Property, or creating a Portfolio at all.
    """
    from apps.identity.services import account_capabilities
    from apps.organization.services import elevated_authority_missing, has_portfolio_standing

    if user.is_staff:
        return
    if account_capabilities(user)["provider"]["can_create_property"]:
        return
    if has_portfolio_standing(organization):
        if not elevated_authority_missing(user):
            return
        raise PermissionDenied(
            "Verify your identity before adding a Property to this Portfolio.",
            details={"reason": "verification_required", "requirements": ["identity"]},
        )
    # Nobody stands behind this Portfolio yet. For its owner that is their own
    # review, and it is the same sentence they have always been given, because
    # it is still the same thing they have to do.
    from apps.organization.models import MembershipRole

    if membership is None or membership.role == MembershipRole.OWNER:
        assert_can_create_property(user)
        return
    raise PermissionDenied(
        "This Portfolio's provider verification is not current, so no Property can be added "
        "to it right now."
    )


@transaction.atomic
def create_private_property(*, user, organization, data: dict) -> Property:
    """Create an operational property without claiming it is verified or public."""
    from apps.billing import enforcement as billing
    from apps.organization.models import (
        MembershipRole,
        OrganizationActivity,
        OrganizationMembership,
        OrganizationPropertyRelationship,
        OrganizationPropertyRole,
        OrganizationType,
    )

    # Membership first: the role is what makes this person's business this
    # Portfolio's business, and only then does it matter who stands behind it.
    membership = OrganizationMembership.objects.filter(
        organization=organization,
        user=user,
        ended_at__isnull=True,
    ).first()
    if membership is None or membership.role not in {
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
    }:
        raise PermissionDenied("Only a Portfolio owner or administrator can create Properties.")
    assert_can_create_property_for(user=user, organization=organization, membership=membership)

    # Inside this transaction, and after the permission check so that a stranger
    # learns nothing about somebody else's plan. `billing.enforcement` locks the
    # Portfolio row and counts live, which is why two concurrent creates cannot
    # both take the last slot. This module must never learn a plan code.
    billing.assert_can_add_property(organization=organization)

    address_id = data.get("address_id")
    if not address_id:
        raise ValidationFailed("Choose an address for the property.")
    title = str(data.get("title", "")).strip()
    if not title:
        raise ValidationFailed("Give the property an internal name.")

    purpose = resolve_purpose(data)
    property_type = resolve_property_type(data)
    prop = Property.objects.create(
        # The creator is a claimant. Ownership remains empty until a reviewed
        # authority workflow establishes it; private setup is not proof.
        owner=None,
        managed_by=None,
        created_by=user,
        title=title,
        property_type=property_type,
        purpose=purpose,
        address_id=address_id,
        water_source=data.get("water_source", "unknown"),
        power_meter_type=data.get("power_meter_type", "unknown"),
        compound_type=data.get("compound_type", "unknown"),
        notes=data.get("notes", ""),
    )
    relationship_type = (
        OrganizationPropertyRole.MANAGER
        if organization.organization_type == OrganizationType.PROPERTY_MANAGER
        else OrganizationPropertyRole.OWNER
    )
    OrganizationPropertyRelationship.objects.create(
        organization=organization,
        property=prop,
        relationship_type=relationship_type,
        granted_by=user,
        note="Private operational property; public advertising requires verification.",
    )
    # Portfolio activities describe the work this Portfolio currently does;
    # they are not an allow-list for Property creation. If a provider adds a
    # valid category outside the activities chosen during setup, keep the
    # descriptive metadata aligned with the inventory instead of forcing the
    # clients to hide a category the domain accepts.
    OrganizationActivity.objects.get_or_create(
        organization=organization,
        activity=_activity_for(prop),
    )
    if prop.is_for_sale:
        # Its sale record is part of the property from the start, so the setup
        # checklist can say what is missing from it. Nothing is public yet —
        # that waits for verification (see `apps.sale.read_models`).
        from apps.sale import services as sale_services

        sale_services.start_sale(prop=prop, user=user, data=data.get("sale") or {})
    record(
        action=AuditAction.CREATE,
        aggregate_type="property",
        aggregate_id=prop.id,
        actor=user,
        metadata={
            "type": prop.property_type,
            "purpose": prop.purpose,
            "organization_id": str(organization.id),
            "visibility": "private",
        },
    )
    emit(
        DomainEvent(
            "property.created.v1",
            "property",
            str(prop.id),
            {
                "organization_id": str(organization.id),
                "type": prop.property_type,
                "purpose": prop.purpose,
                "visibility": "private",
            },
        )
    )
    return prop


def _activity_for(prop: Property) -> str:
    """What this property says the Portfolio does: its category, or selling."""
    from apps.organization.models import OrganizationActivityType

    return OrganizationActivityType.SALES if prop.is_for_sale else prop.property_type


@transaction.atomic
def create_personal_property(*, user, data: dict) -> Property:
    """Create a first Property without making an individual build a workspace first."""

    from apps.organization.models import OrganizationActivityType
    from apps.organization.services import ensure_personal_organization

    from .models import PropertyPurpose

    property_type = resolve_property_type(data)
    purpose = resolve_purpose(data)
    organization = ensure_personal_organization(
        owner=user,
        actor=user,
        activity=OrganizationActivityType.SALES
        if purpose == PropertyPurpose.SALE
        else property_type,
    )
    return create_private_property(
        user=user,
        organization=organization,
        data={**data, "property_type": property_type, "purpose": purpose},
    )


#: Details a reviewer's decision rests on.
#:
#: `trust.evidence_policy` reads the water source, the meter and the compound
#: type to decide what a property must photograph. Changing one after approval
#: moves the checklist under a decision already made — a property approved on
#: three views would silently become one that should have shown five.
CHECKED_DETAILS = frozenset({"property_type", "water_source", "power_meter_type", "compound_type"})

#: Labels and notes. They change nothing a reviewer looked at.
FREE_DETAILS = frozenset({"title", "notes"})


@transaction.atomic
def update_property(*, prop: Property, user, data: dict) -> Property:
    """Correct a property's details, on the terms its state allows.

    The policy in `policies.can_edit_property` describes this and the clients
    render it; this is where it is enforced, so hiding a field is a courtesy and
    not the boundary.
    """
    from apps.billing import enforcement as billing
    from apps.core.policy import enforce

    from .policies import can_edit_property

    assert_can_manage(prop, user)
    prop = Property.objects.select_for_update().get(id=prop.id)
    # Read-only on its Portfolio's plan: the record stays, the details stay put.
    billing.assert_details_editable(prop=prop)

    # One gate, and it is the policy. `can_edit_property` refuses outright once a
    # property is verified or with a reviewer, so there is no partial write left
    # to describe here — see the policy for why a verified name is as fixed as a
    # verified water source.
    enforce(can_edit_property(actor=user, target=prop))

    # A category is structural, not a display label. Moving a hostel to another
    # category must not leave its rooms or beds in a shape the destination
    # category could never create through the API.
    if "property_type" in data:
        from .models import PropertyType
        from .space_rules import assert_space_type_allowed

        next_property_type = resolve_property_type(
            {"property_type": data.get("property_type"), "purpose": prop.purpose}
        )
        if next_property_type != prop.property_type:
            units = list(Unit.objects.select_for_update().filter(property=prop).order_by("id"))
            if (
                next_property_type != PropertyType.HOSTEL
                and Bed.objects.filter(unit__property=prop).exists()
            ):
                raise ValidationFailed("This property has bed records and must remain a hostel.")
            for unit in units:
                assert_space_type_allowed(
                    property_type=next_property_type,
                    space_type=unit.space_type,
                )
        data = {**data, "property_type": next_property_type}

    allowed = FREE_DETAILS | CHECKED_DETAILS
    before = {k: getattr(prop, k) for k in data if k in allowed}
    for key, value in data.items():
        if key in allowed:
            setattr(prop, key, value)
    prop.save()

    changes = {k: [before[k], data[k]] for k in data if k in allowed and data[k] != before[k]}
    if changes:
        record(
            action=AuditAction.UPDATE,
            aggregate_type="property",
            aggregate_id=prop.id,
            actor=user,
            changes=changes,
        )
    return prop


@transaction.atomic
def add_unit(*, prop: Property, user, data: dict) -> Unit:
    """Add a rentable space, of a kind this property may actually contain."""
    from apps.billing import enforcement as billing

    from .space_rules import (
        assert_interior_is_coherent,
        assert_space_type_allowed,
        normalise_interior,
    )

    assert_can_manage(prop, user)
    assert_is_for_letting(prop)
    # An unattached property has no Portfolio and therefore no plan to enforce;
    # `portfolio_for_property` returns None and billing declines to be the thing
    # that makes a pre-billing property unusable.
    portfolio = billing.portfolio_for_property(prop)
    if portfolio is not None:
        # Room for another fully active unit, in a property that is not itself
        # restricted above the plan's allowance.
        billing.assert_can_add_unit(organization=portfolio, prop=prop)

    space_type = data.get("space_type") or ""
    if not space_type:
        raise ValidationFailed("Choose what is being let here.")

    # Enforced here rather than in the serializer so that no caller — a form, a
    # script, a future endpoint — can reach `Unit.objects.create` without it. A
    # rule that only exists in a form is a rule the API does not have.
    assert_space_type_allowed(property_type=prop.property_type, space_type=space_type)
    # A shop sent with a form's "1 bedroom" default stores none.
    data = normalise_interior(space_type=space_type, data=data)

    bedrooms = data.get("bedrooms", 0)
    bathrooms = data.get("bathrooms", 1)
    assert_interior_is_coherent(space_type=space_type, bedrooms=bedrooms, bathrooms=bathrooms)

    unit = Unit.objects.create(
        property=prop,
        label=data.get("label", ""),
        # Both clients have always sent these three, and creation dropped them:
        # the description and the directions written in the form were gone by
        # the time the Unit was opened. Bounded the way the model bounds them.
        description=str(data.get("description") or "").strip()[:1500],
        wing=str(data.get("wing") or "").strip()[:40],
        entrance_note=str(data.get("entrance_note") or "").strip()[:200],
        space_type=space_type,
        bedrooms=bedrooms,
        bathrooms=bathrooms,
        floor_area_sqm=data.get("floor_area_sqm"),
        floor_level=data.get("floor_level"),
        has_private_bathroom=data.get("has_private_bathroom", True),
        has_private_toilet=data.get("has_private_toilet", True),
        has_private_kitchen=data.get("has_private_kitchen", True),
        is_furnished=data.get("is_furnished", False),
        has_air_conditioning=data.get("has_air_conditioning", False),
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="unit",
        aggregate_id=unit.id,
        actor=user,
        metadata={
            "property_id": str(prop.id),
            "space_type": unit.space_type,
            "bedrooms": unit.bedrooms,
        },
    )
    return unit


@transaction.atomic
def add_bed(*, unit: Unit, user, data: dict) -> Bed:
    """Add one bed space inside a room.

    The rule is checked here because a bed on the wrong kind of space is not a
    correctable typo: occupancy, leases and the exclusion constraints all read
    it, and by the time anyone notices, somebody may be living under it.
    """
    from apps.core.policy import enforce

    from .policies import can_add_bed_to_space
    from .space_rules import assert_accepts_bed_spaces

    # Authority first, then the domain rule. Reversed, a stranger could learn
    # what kind of space this is from which refusal came back.
    unit = Unit.objects.select_for_update().select_related("property").get(id=unit.id)
    assert_can_manage(unit.property, user)
    # Another bed is another place to let, which a restricted space does not take.
    from apps.billing import enforcement as billing

    billing.assert_open_for_new_activity(unit=unit, action="add_bed")
    enforce(can_add_bed_to_space(actor=user, target=unit))
    assert_accepts_bed_spaces(unit=unit)

    label = str(data.get("label", "")).strip()
    if not label:
        raise ValidationFailed("Give the bed a label.")
    bed = Bed.objects.create(
        unit=unit,
        label=label,
        sort_order=int(data.get("sort_order", 0)),
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="bed",
        aggregate_id=bed.id,
        actor=user,
        metadata={"unit_id": str(unit.id), "property_id": str(unit.property_id)},
    )
    return bed


@transaction.atomic
def attach_media(
    *, prop: Property, user, file, kind: str = "exterior", caption: str = "", sort_order: int = 0
) -> PropertyMedia:
    assert_can_manage(prop, user)
    from apps.billing import enforcement as billing

    billing.assert_details_editable(prop=prop)
    if not file.is_usable:
        raise ValidationFailed("That file is not ready yet — wait a moment and try again.")
    if not file.is_owned_by(user):
        raise PermissionDenied("That file was not uploaded by you.")
    return PropertyMedia.objects.create(
        property=prop, file=file, kind=kind, caption=caption, sort_order=sort_order
    )


@transaction.atomic
def _supersede_claim_verification(application) -> None:
    """Retire the review behind a claim that has just been revised.

    Superseded, not deleted: what somebody previously claimed, and what they
    showed for it, stays readable. `start_verification` also refuses to open a
    second live review for the same subject and kind, so without this a provider
    correcting their document would be told a review already existed.
    """
    from apps.trust.models import ReviewQueueEntry, Verification, VerificationStatus

    if not application.authority_verification_id:
        return
    ReviewQueueEntry.objects.filter(verification_id=application.authority_verification_id).delete()
    Verification.objects.filter(id=application.authority_verification_id).update(
        status=VerificationStatus.SUPERSEDED
    )


def record_property_claim(*, user, prop: Property, data: dict, files: list):
    """Keep the document with the property being created. Ask nobody to read it yet.

    The creation flow's Documents step. It is an input to the property, the same
    way its photographs are, and neither is a submission — see
    `submit_property_for_verification`, which is.

    **Unless a reviewer has asked for more.** Then the document is an answer to a
    question somebody is holding open, and it has to reach the case they are
    holding rather than start a fresh one beside it. That is exactly what
    `submit_provider_application_more_info` does, and this routes to it — the
    same exception `condition.attach` makes for photographs under `NEEDS_MORE`.

    Without this the flow dead-ended: the Documents step offered the form, and
    sending it came back "There is already a review in progress for this
    property. We will let you know the outcome" — to the provider the reviewer
    was waiting on. The only code that could answer a `NEEDS_MORE` claim lived on
    a standalone screen nothing linked to any more.
    """
    answering = (
        PropertyProviderApplication.objects.filter(
            property=prop,
            applicant=user,
            status=ProviderApplicationStatus.NEEDS_MORE,
        )
        .order_by("-created_at")
        .first()
    )
    if answering is not None:
        return submit_provider_application_more_info(
            application=answering,
            user=user,
            files=files,
            evidence_types=data.get("evidence_types") or {},
        )

    return submit_provider_application(
        user=user,
        data={**data, "property_id": str(prop.id)},
        files=files,
        queue=False,
    )


@transaction.atomic
def submit_property_for_verification(*, prop: Property, user, note: str = "") -> dict:
    """Send the whole property to the review team. One action, both halves.

    The document and the photographs are two reviews and they go together. A
    reviewer holding photographs of a building nobody has claimed cannot decide
    anything, and a provider asked to send the same property twice reasonably
    concludes the first one failed.

    Refused unless `can_submit_property` allows it, so a direct API call meets
    the rule a hidden button would have implied.
    """
    from apps.core.policy import enforce
    from apps.trust import condition
    from apps.trust import services as trust_services
    from apps.trust.models import ReviewQueueEntry, Verification

    from .policies import can_submit_property

    assert_can_manage(prop, user)
    _assert_may_ask_for_review(user)
    enforce(can_submit_property(actor=user, target=prop), confirmed=True)

    sent = []

    application = (
        PropertyProviderApplication.objects.filter(
            property=prop,
            status__in=[
                ProviderApplicationStatus.DRAFT,
                ProviderApplicationStatus.WITHDRAWN,
            ],
        )
        .order_by("-created_at")
        .first()
    )
    if application is not None:
        application.status = ProviderApplicationStatus.PENDING_REVIEW
        application.submitted_at = timezone.now()
        application.save(update_fields=["status", "submitted_at", "updated_at"])
        verification = Verification.objects.filter(id=application.authority_verification_id).first()
        if verification is not None:
            ReviewQueueEntry.objects.get_or_create(
                verification=verification,
                defaults={"priority": trust_services.PRIORITY_BY_KIND.get(verification.kind, 50)},
            )
        sent.append("authority")

    # Photographs. Already unqueued-but-collected, so this is only the queueing.
    condition_review = condition.current_review(prop)
    if condition_review is not None and condition.lifecycle_state(prop) not in {
        "submitted",
        "under_review",
    }:
        condition_review = condition.submit_for_review(subject=prop, actor=user)
        sent.append("condition")

    if application is not None and condition_review is not None:
        application.condition_verification_id = condition_review.id
        application.save(update_fields=["condition_verification_id", "updated_at"])

    if not sent:
        raise Conflict("There is nothing here to send yet.")

    record(
        action=AuditAction.UPDATE,
        aggregate_type="property",
        aggregate_id=prop.id,
        actor=user,
        changes={"verification": ["not_submitted", "submitted"]},
        metadata={"action": "submit_for_verification", "halves": sent, "note": note.strip()},
    )
    return {"submitted": True, "halves": sent}


def withdraw_provider_application(*, application, user, reason: str = ""):
    """Take an authority claim back before anyone has decided it.

    The other half of withdrawing a property submission — `condition` handles the
    photographs, this handles the document.

    The application returns to `DRAFT` and its verification stays `PENDING` with
    its evidence attached — only the queue entry goes. That is deliberately the
    same mechanism `condition.withdraw_submission` uses for the photographs, so
    both halves of a withdrawn property behave identically: still here, still
    yours, editable, and one action from being sent again.

    It is **not** marked `WITHDRAWN`. That would discard the document, and a
    provider who withdrew to correct a typo in the owner's name would have to
    photograph and upload the indenture a second time — which makes withdrawal
    worse than waiting, and nobody would use it. `WITHDRAWN` stays the word for
    a claim genuinely set aside, as when a different document replaces it during
    setup.

    The row and its history survive either way: the transition is recorded, and
    ADR 0021's rule is that what a counterparty has seen is preserved.
    """
    from apps.trust.models import ReviewQueueEntry

    if not application.property_id:
        raise ValidationFailed("This claim is not attached to a property.")
    prop = application.property
    assert_can_manage(prop, user)

    if application.status not in {
        ProviderApplicationStatus.PENDING_REVIEW,
        ProviderApplicationStatus.NEEDS_MORE,
    }:
        raise Conflict("This claim is not with our team.")

    previous = application.status
    application.status = ProviderApplicationStatus.WITHDRAWN
    application.submitted_at = None
    application.decision_note = reason.strip()[:600]
    application.save(update_fields=["status", "submitted_at", "decision_note", "updated_at"])

    if application.authority_verification_id:
        # Out of the queue, not out of existence. The verification stays
        # `PENDING` with its evidence, which is what makes resubmission a button
        # rather than a repeat of the whole step.
        ReviewQueueEntry.objects.filter(
            verification_id=application.authority_verification_id
        ).delete()

    record(
        action=AuditAction.UPDATE,
        aggregate_type="property_provider_application",
        aggregate_id=application.id,
        actor=user,
        changes={"status": [previous, application.status]},
        metadata={"reason": reason.strip(), "property_id": str(prop.id)},
    )
    return application
