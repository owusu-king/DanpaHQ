"""Provider credentials over existing identity, trust and property records.

Mutable drafts never rewrite evidence reviewed by Management. Every submission
freezes its credential fields and files into the existing Verification envelope.
Provider approval and property verification are deliberately unaffected.
"""

from django.core.validators import RegexValidator
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import Conflict, NotFound, ValidationFailed
from apps.files.models import FilePurpose, StoredFile
from apps.organization.services import assert_can_manage_organization, get_organization_or_404
from apps.trust import services as trust

from .models import ProviderPassport, ProviderPassportDocument

KIND = "provider_credentials"


class PassportInput(serializers.Serializer):
    representative_id = serializers.UUIDField(required=False)
    representative_role = serializers.CharField(max_length=100, required=False, allow_blank=True)
    registered_business = serializers.BooleanField(required=False)
    registration_number = serializers.CharField(max_length=100, required=False, allow_blank=True)
    contact_email = serializers.EmailField(max_length=254, required=False, allow_blank=True)
    contact_phone = serializers.CharField(max_length=32, required=False, allow_blank=True)

    def validate_contact_phone(self, value):
        if not value:
            return value
        # Organization contacts may be fixed lines; the mobile-only OTP
        # validator is appropriate for personal identity, not business phones.
        number = "".join(character for character in value if character not in " -().")
        RegexValidator(r"^\+?[0-9]{9,15}$", "Enter a valid organization phone number.")(number)
        return number


class DocumentInput(serializers.Serializer):
    file_id = serializers.UUIDField()
    evidence_type = serializers.ChoiceField(
        choices=ProviderPassportDocument._meta.get_field("evidence_type").choices
    )


def authorized(pk, user, *, lock=False):
    from apps.organization.models import Organization

    organization = get_organization_or_404(pk, user)
    assert_can_manage_organization(organization, user)
    if lock:
        organization = Organization.objects.select_for_update().get(id=organization.id)
        # Recheck after the lock: membership may have ended while waiting.
        assert_can_manage_organization(organization, user)
    return organization


def draft(organization):
    return (
        ProviderPassport.objects.select_related("representative", "verification")
        .filter(organization=organization)
        .first()
    )


def ensure_draft(organization):
    return ProviderPassport.objects.get_or_create(
        organization=organization,
        defaults={
            "representative": organization.created_by,
            "registered_business": organization.organization_type == "property_company",
        },
    )[0]


def representative(organization, passport):
    return passport.representative if passport else organization.created_by


def identity(person, organization=None):
    from apps.organization.models import OrganizationMembership

    if (
        organization is not None
        and not OrganizationMembership.objects.filter(
            organization=organization,
            user=person,
            ended_at__isnull=True,
            role__in=["owner", "admin"],
            user__is_active=True,
        ).exists()
    ):
        return {
            "id": str(person.id),
            "name": "Former representative",
            "phone": "",
            "email": "",
            "phone_verified": False,
            "email_verified": False,
            "identity_verified": False,
            "identity_verification_id": None,
            "photo_on_record": False,
        }
    check = trust.current_for("user", person.id, "identity")
    photo = getattr(getattr(person, "profile", None), "avatar", None)
    return {
        "id": str(person.id),
        "name": " ".join([person.first_name, person.last_name]).strip(),
        "phone": str(person.phone or ""),
        "phone_verified": bool(person.phone and person.is_phone_verified),
        "email": person.email or "",
        "email_verified": bool(person.email and person.is_email_verified),
        "identity_verified": bool(check),
        "identity_verification_id": str(check.id) if check else None,
        "photo_on_record": bool(photo and photo.is_usable and photo.deleted_at is None),
    }


def values(organization, passport):
    person = representative(organization, passport)
    return {
        "organization_name": organization.name,
        "category": organization.organization_type,
        "representative_id": str(person.id),
        "representative_name": identity(person, organization)["name"],
        **{
            key: getattr(passport, key, default)
            for key, default in (
                ("representative_role", ""),
                ("registered_business", organization.organization_type == "property_company"),
                ("registration_number", ""),
                ("contact_email", ""),
                ("contact_phone", ""),
            )
        },
    }


def missing(organization, passport):
    from apps.organization.models import OrganizationMembership

    person = representative(organization, passport)
    credentials = identity(person, organization)
    data = values(organization, passport)
    result = []
    if passport and any(
        not row.file.is_usable or row.file.deleted_at is not None
        for row in passport.documents.select_related("file")
    ):
        result.append(
            {"field": "documents", "message": "Remove or replace unavailable supporting documents."}
        )
    if not trust.current_for("user", organization.created_by_id, "provider"):
        result.append(
            {
                "field": "provider_account",
                "message": "Provider account approval is required before Passport submission.",
            }
        )
    for key, ok, message in (
        (
            "legal_name",
            bool(person.first_name and person.last_name),
            "Complete the representative's legal name in Profile.",
        ),
        ("phone", credentials["phone_verified"], "Verify the representative's phone number."),
        ("email", credentials["email_verified"], "Verify the representative's email address."),
        (
            "identity",
            credentials["identity_verified"],
            "Complete the representative's identity document review.",
        ),
        (
            "photo",
            credentials["photo_on_record"],
            "Add a profile photograph for the representative.",
        ),
        (
            "representative",
            OrganizationMembership.objects.filter(
                organization=organization,
                user=person,
                role__in=["owner", "admin"],
                ended_at__isnull=True,
            ).exists()
            and person.is_active,
            "Choose an active Portfolio owner or administrator as representative.",
        ),
    ):
        if not ok:
            result.append({"field": key, "message": message})
    if organization.organization_type != "individual_owner":
        for key in ("representative_role", "contact_email", "contact_phone"):
            if not data[key]:
                result.append({"field": key, "message": f"Add {key.replace('_', ' ')}."})
    business = organization.organization_type == "property_company" or data["registered_business"]
    if business:
        if not data["registration_number"]:
            result.append(
                {"field": "registration_number", "message": "Add the business registration number."}
            )
        if (
            not passport
            or not passport.documents.filter(
                evidence_type="business_certificate",
                file__upload_status="ready",
                file__scan_status="clean",
                file__deleted_at__isnull=True,
            ).exists()
        ):
            result.append(
                {
                    "field": "business_certificate",
                    "message": "Upload a business registration document.",
                }
            )
    return result


def matches(organization, passport):
    if not passport or not passport.verification_id:
        return False
    snapshot = passport.verification.provider_response or {}
    return snapshot.get("revision") == passport.revision and snapshot.get("credentials") == values(
        organization, passport
    )


def status(organization, passport, requirements):
    from apps.trust.models import ReviewQueueEntry

    if not passport:
        return "not_started"
    check = passport.verification if passport else None
    if check and matches(organization, passport):
        if check.status == "pending":
            reviewing = ReviewQueueEntry.objects.filter(
                verification=check,
                resolved_at__isnull=True,
                claimed_at__isnull=False,
                claim_expires_at__gt=timezone.now(),
            ).exists()
            return "under_review" if reviewing else "submitted"
        if check.status in ("needs_more_info", "rejected"):
            return check.status
        if check.is_current and not requirements:
            return "verified"
    if check and check.status == "needs_more_info":
        return "needs_more_info"
    return "incomplete" if requirements else "ready" if passport else "not_started"


def require_editable(organization, passport):
    if (
        passport
        and passport.verification
        and passport.verification.status == "pending"
        and matches(organization, passport)
    ):
        raise Conflict(
            "This Passport is being reviewed. Wait for a decision before changing credentials."
        )


def changed(passport, user, action):
    passport.revision += 1
    passport.save()
    record(
        action=AuditAction.UPDATE,
        aggregate_type="provider_passport",
        aggregate_id=passport.id,
        actor=user,
        metadata={"action": action, "revision": passport.revision},
    )


@transaction.atomic
def update(pk, user, data):
    from apps.organization.models import OrganizationMembership

    organization = authorized(pk, user, lock=True)
    passport = ensure_draft(organization)
    require_editable(organization, passport)
    if "representative_id" in data:
        membership = (
            OrganizationMembership.objects.select_related("user")
            .filter(
                organization=organization,
                user_id=data["representative_id"],
                role__in=["owner", "admin"],
                ended_at__isnull=True,
                user__is_active=True,
            )
            .first()
        )
        if not membership:
            raise ValidationFailed(
                "The representative must be an active Portfolio owner or administrator."
            )
        passport.representative = membership.user
    for key, value in data.items():
        if key != "representative_id":
            setattr(passport, key, value)
    if organization.organization_type == "property_company":
        passport.registered_business = True
    changed(passport, user, "credentials_updated")
    return organization


@transaction.atomic
def add_document(pk, user, data):
    organization = authorized(pk, user, lock=True)
    passport = ensure_draft(organization)
    require_editable(organization, passport)
    stored = StoredFile.objects.filter(id=data["file_id"]).first()
    if not stored or not stored.is_owned_by(user):
        raise NotFound("We could not find that upload.")
    if (
        not stored.is_usable
        or stored.purpose != FilePurpose.PROPERTY_DOCUMENT
        or not stored.is_sensitive
    ):
        raise ValidationFailed("Upload a checked, private provider document before attaching it.")
    document, created = ProviderPassportDocument.objects.get_or_create(
        passport=passport, file=stored, defaults={"evidence_type": data["evidence_type"]}
    )
    if not created and document.evidence_type != data["evidence_type"]:
        raise Conflict("This document is already attached under another category.")
    if created:
        changed(passport, user, "document_attached")
    return organization


@transaction.atomic
def remove_document(pk, document_id, user):
    organization = authorized(pk, user, lock=True)
    passport = draft(organization)
    require_editable(organization, passport)
    document = ProviderPassportDocument.objects.filter(passport=passport, id=document_id).first()
    if not document:
        raise NotFound("We could not find that document.")
    document.delete()  # Submission evidence retains its immutable file reference.
    changed(passport, user, "document_removed")
    return organization


@transaction.atomic
def submit(pk, user):
    from apps.trust.models import ReviewQueueEntry

    organization = authorized(pk, user, lock=True)
    passport = ensure_draft(organization)
    requirements = missing(organization, passport)
    if requirements:
        raise ValidationFailed(
            details={"fields": {row["field"]: [row["message"]] for row in requirements}}
        )
    old = passport.verification
    if (
        old
        and matches(organization, passport)
        and old.status in ("pending", "approved")
        and (old.status == "pending" or old.is_current)
    ):
        return organization
    if old:
        ReviewQueueEntry.objects.filter(verification=old, resolved_at__isnull=True).update(
            resolved_at=timezone.now()
        )
    if old and old.status in ("approved", "pending", "needs_more_info"):
        check = trust.supersede_and_restart(old, method="document_review", submitted_by=user)
    else:
        check = trust.start_verification(
            subject_type="organisation",
            subject_id=organization.id,
            kind=KIND,
            method="document_review",
            submitted_by=user,
        )
        check.supersedes = old
    check.provider_response = {
        "revision": passport.revision,
        "credentials": values(organization, passport),
    }
    check.save(update_fields=["supersedes", "provider_response", "updated_at"])
    trust.attach_evidence(
        check,
        evidence_type="provider_response",
        reference=identity(passport.representative)["identity_verification_id"],
        collected_by=user,
        notes="Existing identity review; provider credentials only, not property authority.",
    )
    for document in passport.documents.select_related("file"):
        if not document.file.is_usable:
            raise ValidationFailed(
                "A supporting document is no longer available. Remove or replace it."
            )
        trust.attach_evidence(
            check, evidence_type=document.evidence_type, file=document.file, collected_by=user
        )
    passport.verification = check
    passport.save(update_fields=["verification", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="provider_passport",
        aggregate_id=passport.id,
        actor=user,
        metadata={"action": "submitted", "verification_id": str(check.id)},
    )
    return organization


def guard_review(check, *, approved=False):
    """Called inside trust's transaction; changed credentials cannot be approved."""
    from apps.organization.models import Organization
    from apps.trust.models import Verification

    organization = (
        Organization.objects.select_for_update().filter(id=check.subject_id, is_active=True).first()
    )
    if not organization:
        raise Conflict("This Portfolio is no longer active.")
    passport = draft(organization)
    locked = Verification.objects.select_for_update().get(id=check.id)
    if (
        not passport
        or passport.verification_id != check.id
        or locked.status not in ("pending", "needs_more_info")
    ):
        raise Conflict("This Passport submission is no longer open.")
    if approved and (not matches(organization, passport) or missing(organization, passport)):
        raise ValidationFailed(
            "The submitted credentials or identity checks have changed. "
            "Request an updated Passport."
        )
    return locked


def property_records(organization):
    from apps.organization.models import OrganizationPropertyRelationship
    from apps.property.models import Property, PropertyRelationship
    from apps.property.read_models import prepare_property_list_rows, property_list_queryset
    from apps.property.verification import lifecycle
    from apps.trust.models import Verification

    rows = list(
        OrganizationPropertyRelationship.objects.filter(
            organization=organization,
            ended_at__isnull=True,
        ).select_related("property")
    )
    properties = {
        str(prop.id): prop
        for prop in prepare_property_list_rows(
            property_list_queryset(
                Property.objects.filter(id__in=[row.property_id for row in rows]),
                user=organization.created_by,
            )
        )
    }
    personal = {
        str(row.property_id): row
        for row in PropertyRelationship.objects.filter(
            property_id__in=[row.property_id for row in rows],
            user=organization.created_by,
            ended_at__isnull=True,
            authority_verification_id__isnull=False,
        ).order_by("authority_verified_at")
    }
    checks = {
        check.id: check
        for check in Verification.objects.filter(
            id__in=[
                row.authority_verification_id
                for row in [*rows, *personal.values()]
                if row.authority_verification_id
            ],
            kind__in=["ownership", "property_authority"],
        )
    }
    result = []
    for row in rows:
        prop = properties.get(str(row.property_id))
        if prop is None:
            continue
        state = lifecycle(prop)
        verification_id = row.authority_verification_id
        relationship = personal.get(str(prop.id))
        # Personal Portfolios predate organization-scoped authority pointers.
        # Reuse their exact person/property relationship, never another owner's
        # document as proof of a manager's authorization.
        matching_roles = {
            "owner": {"owner"},
            "manager": {"manager", "company_representative"},
            "listing_agent": {"agent", "listing_manager"},
        }
        if (
            not verification_id
            and relationship
            and relationship.relationship_type in matching_roles.get(row.relationship_type, set())
        ):
            verification_id = relationship.authority_verification_id
        check = checks.get(verification_id)
        authority = bool(check and check.is_current)
        if (
            not verification_id
            and row.relationship_type == "owner"
            and prop.owner_id == organization.created_by_id
        ):
            authority = state["authority"]["state"] == "verified"
        result.append(
            {
                "id": str(prop.id),
                "name": prop.title,
                "relationship": row.relationship_type,
                "relationship_label": row.get_relationship_type_display(),
                "authority_verified": authority,
                "authority_verification_id": str(verification_id) if verification_id else None,
                "property_verified": state["review_state"] == "verified",
            }
        )
    return result


def assemble(organization):
    from apps.maintenance.models import MaintenanceRequest
    from apps.organization.models import OrganizationMembership, OrganizationPropertyRelationship
    from apps.tenancy.models import Tenancy
    from apps.trust.models import Verification

    passport = draft(organization)
    requirements = missing(organization, passport)
    person = representative(organization, passport)
    properties = property_records(organization)
    # Count activity only while the relationship was in effect, so acquiring a
    # building never gives a provider somebody else's historical reputation.
    from django.db.models import F

    relationships = OrganizationPropertyRelationship.objects.filter(
        organization=organization, ended_at__isnull=True
    )
    tenancies = Tenancy.objects.filter(
        property__organization_relationships__in=relationships,
        created_at__gte=F("property__organization_relationships__created_at"),
        activation_lease__isnull=False,
    )
    maintenance = MaintenanceRequest.objects.filter(
        property__organization_relationships__in=relationships,
        created_at__gte=F("property__organization_relationships__created_at"),
    )
    check = passport.verification if passport else None
    history = (
        Verification.objects.for_subject("organisation", organization.id)
        .filter(kind=KIND)
        .order_by("-created_at")
    )
    return {
        "organization_id": str(organization.id),
        "name": organization.name,
        "category": organization.organization_type,
        "category_label": organization.get_organization_type_display(),
        "credentials": values(organization, passport),
        "identity": identity(person, organization),
        "representatives": [
            {"id": str(row.user_id), "name": row.user.display_name}
            for row in OrganizationMembership.objects.filter(
                organization=organization,
                ended_at__isnull=True,
                role__in=["owner", "admin"],
                user__is_active=True,
            ).select_related("user")
        ],
        "status": status(organization, passport, requirements),
        "missing": requirements,
        "editable": not (check and check.status == "pending" and matches(organization, passport)),
        "decision_note": check.decision_note if check else "",
        "documents": [
            {
                "id": str(row.id),
                "evidence_type": row.evidence_type,
                "filename": row.file.original_filename,
                "download_path": (
                    f"/organizations/{organization.id}/provider-passport/"
                    f"documents/{row.id}/download/"
                ),
            }
            for row in passport.documents.select_related("file")
        ]
        if passport
        else [],
        "properties": properties,
        "activity": {
            "completed_tenancies": tenancies.filter(status="ended").distinct().count(),
            "active_tenancies": tenancies.filter(status="active").distinct().count(),
            "completed_maintenance": maintenance.filter(status="completed").distinct().count(),
            "not_recorded": [
                "Verified provider reviews and ratings",
                "Enquiry response times",
                "Maintenance response times",
            ],
        },
        "history": [
            {
                "id": str(row.id),
                "status": row.status,
                "submitted_at": row.created_at,
                "decided_at": row.decided_at,
                "decision_note": row.decision_note,
            }
            for row in history[:30]
        ],
    }


def public_credentials(organization):
    """Explicit allowlist. Never return identity contacts, files or financial data."""
    passport = draft(organization)
    current = bool(
        passport
        and passport.verification
        and passport.verification.is_current
        and matches(organization, passport)
        and not missing(organization, passport)
    )
    return {
        "name": organization.name,
        "category": organization.organization_type,
        "verified": current,
        "verified_at": passport.verification.decided_at if current else None,
        "valid_until": passport.verification.expires_at if current else None,
    }


def public_for_property(prop):
    from apps.organization.models import Organization

    organizations = Organization.objects.filter(
        is_active=True,
        provider_passport__isnull=False,
        property_relationships__property=prop,
        property_relationships__ended_at__isnull=True,
    ).distinct()
    return [
        credential
        for organization in organizations
        if (credential := public_credentials(organization))["verified"]
    ]
