"""Where a Portfolio's settled rent is sent, and who may change it.

The most dangerous write in the product. Everything else in payments moves
money *towards* Rooomly's records; this decides where it leaves to. An attacker
who can change a payout destination does not need to break anything else.

Three properties, therefore, and none of them optional:

- **It belongs to the Portfolio, not to a person.** A Portfolio outlives
  whichever member is signed in, and rent must not follow a team member out of
  the door.
- **Only an owner or an admin may change it.** Deliberately narrower than the
  capability that lets somebody *collect* rent: taking payments and redirecting
  them are different powers, and a manager who can do the first should not
  silently acquire the second.
- **Every change is attributable.** Before and after, actor, time — in the
  audit log, with the destination recorded as its masked form so the log is
  useful without becoming a second copy of the account number.

**Nothing stored here is a credential.** Rooomly holds an opaque provider token
and a masked string. PINs, OTPs and card credentials are always refused. The
dedicated Paystack provisioning function receives a bank account number only
long enough to create the subaccount; it never stores or logs the raw value.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import connection, transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import (
    Conflict,
    NotFound,
    PermissionDenied,
    ProviderUnavailable,
    ValidationFailed,
)
from apps.outbox.services import emit

from .models import (
    PayoutMethod,
    PayoutProfile,
    PayoutProfileStatus,
    PayoutProvisioningOperation,
    PayoutProvisioningStatus,
)
from .providers import get_payment_provider

#: Never accepted, never stored, never logged. Listed so the refusal below is a
#: named rule rather than an implicit one.
FORBIDDEN_KEYS = frozenset(
    {
        "pin",
        "otp",
        "cvv",
        "cvc",
        "card_number",
        "pan",
        "account_number",
        "password",
        "secret",
        "expiry",
        "expiry_month",
        "expiry_year",
    }
)

PROVISIONING_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$")


def _ensure_provider_available(provider) -> None:
    """Use the explicit preflight while tolerating established local adapters."""
    ensure = getattr(provider, "ensure_available", None)
    if callable(ensure):
        ensure()
        return
    # Legacy test/local adapters used this sentinel. Real Paystack implements
    # `ensure_available`, so no fake initialization reaches the network.
    provider.initiate(intent=None)


def assert_may_manage_payouts(*, organization, user) -> None:
    """Owner or admin only.

    Read from the existing membership roles rather than a new permission: the
    organization already knows who runs it, and a second answer to that question
    is a second thing to keep in step.
    """
    from apps.organization.models import MembershipRole
    from apps.organization.services import active_membership

    membership = active_membership(organization=organization, user=user)
    if membership is None:
        raise PermissionDenied("You do not have access to that Portfolio.")
    if membership.role not in (MembershipRole.OWNER, MembershipRole.ADMIN):
        raise PermissionDenied("Only a Portfolio owner or admin can change where rent is settled.")


def _reject_credentials(data: dict) -> None:
    for key in data:
        if str(key).strip().lower() in FORBIDDEN_KEYS:
            # Deliberately does not echo the value, or the key's contents, into
            # the message or the log.
            raise ValidationFailed(
                "Account credentials are never sent to Rooomly. "
                "Complete the destination with your payment provider instead."
            )


def payout_profile_for(*, organization, user) -> PayoutProfile | None:
    assert_may_manage_payouts(organization=organization, user=user)
    return PayoutProfile.objects.filter(
        organization=organization,
        is_active=True,
    ).first()


def payout_destination_state(
    *, organization, user
) -> tuple[PayoutProfile | None, list[PayoutProfile], PayoutProvisioningOperation | None]:
    """Selected destination, saved destinations and latest setup operation."""
    assert_may_manage_payouts(organization=organization, user=user)
    profiles = list(
        PayoutProfile.objects.filter(organization=organization)
        .exclude(status=PayoutProfileStatus.DISABLED)
        .order_by("-is_active", "-created_at")
    )
    profile = next((row for row in profiles if row.is_active), None)
    operation = (
        PayoutProvisioningOperation.objects.filter(organization=organization)
        .select_related("payout_profile")
        .first()
    )
    return profile, profiles, operation


def refresh_payout_verification(*, organization, user, profile_id=None) -> PayoutProfile:
    """Pull the provider's current subaccount decision into Rooomly.

    A client can ask for the check, but cannot supply or decide the result. The
    only fact that moves this profile to verified is the PSP's authenticated
    response for the exact immutable subaccount reference Rooomly stored.
    """
    assert_may_manage_payouts(organization=organization, user=user)
    profiles = PayoutProfile.objects.filter(organization=organization).exclude(
        status=PayoutProfileStatus.DISABLED
    )
    profile = (
        profiles.filter(id=profile_id).first()
        if profile_id is not None
        else profiles.filter(is_active=True).first() or profiles.first()
    )
    if profile is None:
        raise NotFound("That Portfolio has no settlement account to verify.")
    if profile.status == PayoutProfileStatus.VERIFIED:
        return profile

    provider = get_payment_provider(profile.provider)
    if provider.name != profile.provider:
        raise ProviderUnavailable("That settlement provider is not enabled.")
    _ensure_provider_available(provider)
    destination = provider.get_payout_destination(
        provider_reference=profile.token_reference,
    )
    if destination.token_reference != profile.token_reference or (
        profile.provider_account_id
        and destination.provider_account_id != profile.provider_account_id
    ):
        raise ProviderUnavailable(
            "Paystack returned a different settlement account. Nothing was changed."
        )
    if destination.verified:
        return mark_payout_verified(
            profile=profile,
            provider_reference="paystack_subaccount_status",
        )
    return profile


def payout_institutions(*, organization, user, method: str) -> list[dict]:
    """Paystack's active Ghana institutions, cached as non-sensitive reference data."""
    assert_may_manage_payouts(organization=organization, user=user)
    method = str(method or "").strip()
    if method not in PayoutMethod.values:
        raise ValidationFailed("Choose Mobile Money or a bank account.")
    cache_key = f"payments:payout-institutions:paystack:ghana:{method}:v1"
    cached = cache.get(cache_key)
    if isinstance(cached, list):
        return cached
    provider = get_payment_provider("paystack")
    if provider.name != "paystack":
        raise ProviderUnavailable("Paystack payout setup is not enabled.")
    _ensure_provider_available(provider)
    rows = [
        {"code": row.code, "name": row.name, "method": row.method}
        for row in provider.list_payout_institutions(method=method)
    ]
    cache.set(
        cache_key,
        rows,
        timeout=int(getattr(settings, "PAYOUT_INSTITUTION_CACHE_SECONDS", 21600)),
    )
    return rows


def resolve_payout_account(
    *, organization, user, method: str, bank_code: str, account_number: str
) -> dict:
    """Confirm a Ghana bank account name while retaining only masked output."""
    assert_may_manage_payouts(organization=organization, user=user)
    method, bank_code, account_number = _validate_provisioning_details(
        method=method,
        bank_code=bank_code,
        account_number=account_number,
    )
    if method != PayoutMethod.BANK:
        raise ValidationFailed(
            "Account-name confirmation is currently available for bank accounts only."
        )
    if not account_number.replace(" ", "").isdigit():
        raise ValidationFailed("Enter a numeric bank account number.")
    fingerprint = _provisioning_fingerprint(
        method=method,
        bank_code=bank_code,
        account_number=account_number,
    )
    cache_key = f"payments:payout-resolution:paystack:{fingerprint}:v1"
    cached = cache.get(cache_key)
    if isinstance(cached, dict):
        return cached
    provider = get_payment_provider("paystack")
    if provider.name != "paystack":
        raise ProviderUnavailable("Paystack payout setup is not enabled.")
    _ensure_provider_available(provider)
    result = provider.resolve_payout_account(
        method=method,
        bank_code=bank_code,
        account_number=account_number,
    )
    response = {
        "account_name": result.account_name,
        "masked_account": result.masked_account,
    }
    cache.set(
        cache_key,
        response,
        timeout=int(getattr(settings, "PAYOUT_ACCOUNT_RESOLUTION_CACHE_SECONDS", 3600)),
    )
    return response


def _validate_provisioning_details(*, method, bank_code, account_number) -> tuple[str, str, str]:
    method = str(method or "").strip()
    if method not in PayoutMethod.values:
        raise ValidationFailed("Choose Mobile Money or a bank account.")
    bank_code = str(bank_code or "").strip()
    account_number = str(account_number or "").strip()
    if not bank_code or not account_number:
        raise ValidationFailed("The settlement institution and account number are required.")
    compact_account = account_number.replace(" ", "")
    if len(compact_account) > 32 or not compact_account.isalnum():
        raise ValidationFailed("Enter a valid settlement account number.")
    return method, bank_code, account_number


def _provisioning_fingerprint(*, method: str, bank_code: str, account_number: str) -> str:
    """Keyed fingerprint: detects key misuse without storing an enumerable hash."""
    canonical = json.dumps(
        {
            "method": method,
            "bank_code": bank_code,
            "account_number": account_number.replace(" ", ""),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    key = str(settings.SECRET_KEY).encode()
    return hmac.new(key, canonical, hashlib.sha256).hexdigest()


@transaction.atomic
def _claim_provisioning_operation(
    *, organization, user, method: str, idempotency_key: str, request_fingerprint: str
) -> tuple[PayoutProvisioningOperation, bool]:
    """Commit the external-side-effect claim before making the network call."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
            [f"payout-provisioning:{organization.id}"],
        )

    existing = (
        PayoutProvisioningOperation.objects.select_for_update()
        .filter(
            organization=organization,
            idempotency_key=idempotency_key,
        )
        .first()
    )
    if existing is not None:
        if existing.request_fingerprint != request_fingerprint:
            raise Conflict("That Idempotency-Key was already used for different payout details.")
        if existing.status == PayoutProvisioningStatus.FAILED:
            raise ValidationFailed(
                existing.failure_message or "Paystack could not create that settlement account."
            )
        return existing, True

    open_operation = (
        PayoutProvisioningOperation.objects.select_for_update()
        .filter(
            organization=organization,
            status__in=(
                PayoutProvisioningStatus.PENDING,
                PayoutProvisioningStatus.NEEDS_RECONCILIATION,
            ),
        )
        .first()
    )
    if open_operation is not None:
        raise Conflict(
            "A settlement account is already being checked. Wait for it before trying again."
        )

    return (
        PayoutProvisioningOperation.objects.create(
            organization=organization,
            requested_by=user,
            idempotency_key=idempotency_key,
            request_fingerprint=request_fingerprint,
            provider="paystack",
            method=method,
        ),
        False,
    )


@transaction.atomic
def _mark_provisioning_failed(*, operation_id, message: str) -> None:
    operation = PayoutProvisioningOperation.objects.select_for_update().get(id=operation_id)
    if operation.status != PayoutProvisioningStatus.PENDING:
        return
    operation.status = PayoutProvisioningStatus.FAILED
    operation.failure_code = "provider_rejected"
    operation.failure_message = str(message or "Paystack could not create that account.")[:300]
    operation.completed_at = timezone.now()
    operation.save(
        update_fields=[
            "status",
            "failure_code",
            "failure_message",
            "completed_at",
            "updated_at",
        ]
    )


@transaction.atomic
def _mark_provisioning_ambiguous(*, operation_id) -> PayoutProvisioningOperation:
    operation = PayoutProvisioningOperation.objects.select_for_update().get(id=operation_id)
    if operation.status == PayoutProvisioningStatus.PENDING:
        operation.status = PayoutProvisioningStatus.NEEDS_RECONCILIATION
        operation.save(update_fields=["status", "updated_at"])
    return operation


@transaction.atomic
def _complete_provisioning_operation(*, operation_id, destination, request=None):
    operation = (
        PayoutProvisioningOperation.objects.select_for_update(of=("self",))
        .select_related("organization", "requested_by", "payout_profile")
        .get(id=operation_id)
    )
    if operation.status == PayoutProvisioningStatus.SUCCEEDED:
        return operation, operation.payout_profile
    if operation.status == PayoutProvisioningStatus.FAILED:
        raise Conflict("That payout setup operation has already failed.")

    profile = _store_provider_destination(
        organization=operation.organization,
        user=operation.requested_by,
        method=operation.method,
        provider=operation.provider,
        destination=destination,
        request=request,
    )
    operation.status = PayoutProvisioningStatus.SUCCEEDED
    operation.payout_profile = profile
    operation.failure_code = ""
    operation.failure_message = ""
    operation.completed_at = timezone.now()
    operation.save(
        update_fields=[
            "status",
            "payout_profile",
            "failure_code",
            "failure_message",
            "completed_at",
            "updated_at",
        ]
    )
    return operation, profile


def provision_paystack_subaccount_idempotently(
    *,
    organization,
    user,
    method: str,
    bank_code: str,
    account_number: str,
    idempotency_key: str,
    request=None,
) -> tuple[PayoutProvisioningOperation, PayoutProfile | None, bool]:
    """Safely create or replay one Paystack subaccount provisioning operation.

    A timeout is never retried as a create. The committed operation id is in
    Paystack metadata, so reconciliation can search for the first call's result.
    """
    assert_may_manage_payouts(organization=organization, user=user)
    if not PROVISIONING_KEY_PATTERN.fullmatch(str(idempotency_key or "").strip()):
        raise ValidationFailed(
            "Idempotency-Key must be 16 to 128 letters, numbers, dots, colons, "
            "underscores or hyphens."
        )
    idempotency_key = str(idempotency_key).strip()
    method, bank_code, account_number = _validate_provisioning_details(
        method=method,
        bank_code=bank_code,
        account_number=account_number,
    )

    request_fingerprint = _provisioning_fingerprint(
        method=method,
        bank_code=bank_code,
        account_number=account_number,
    )
    # Replaying a committed result must not depend on Paystack being reachable
    # now. This unlocked read is only a fast path; `_claim` still locks and
    # rechecks before deciding whether any outbound call may happen.
    if PayoutProvisioningOperation.objects.filter(
        organization=organization,
        idempotency_key=idempotency_key,
    ).exists():
        operation, replayed = _claim_provisioning_operation(
            organization=organization,
            user=user,
            method=method,
            idempotency_key=idempotency_key,
            request_fingerprint=request_fingerprint,
        )
        return operation, operation.payout_profile, replayed

    # Configuration is checked before creating a new durable claim. A missing
    # or forbidden key cannot have created anything and is not ambiguous.
    provider = get_payment_provider("paystack")
    if provider.name != "paystack":
        raise ProviderUnavailable("Paystack payout setup is not enabled.")
    _ensure_provider_available(provider)

    operation, replayed = _claim_provisioning_operation(
        organization=organization,
        user=user,
        method=method,
        idempotency_key=idempotency_key,
        request_fingerprint=request_fingerprint,
    )
    if replayed:
        return operation, operation.payout_profile, True

    try:
        destination = provider.provision_payout_destination(
            business_name=organization.name,
            bank_code=bank_code,
            account_number=account_number,
            provisioning_reference=str(operation.id),
        )
    except ValidationFailed as exc:
        # Provider validation text is not persisted or returned verbatim: some
        # PSPs echo submitted account details in errors. The stable public
        # message is useful without risking that disclosure.
        safe_message = (
            "Paystack could not verify that settlement account. "
            "Check the institution and account details."
        )
        _mark_provisioning_failed(operation_id=operation.id, message=safe_message)
        raise ValidationFailed(safe_message) from exc
    except ProviderUnavailable:
        operation = _mark_provisioning_ambiguous(operation_id=operation.id)
        return operation, None, False

    operation, profile = _complete_provisioning_operation(
        operation_id=operation.id,
        destination=destination,
        request=request,
    )
    return operation, profile, False


@transaction.atomic
def _begin_provisioning_check(*, operation_id) -> PayoutProvisioningOperation | None:
    operation = (
        PayoutProvisioningOperation.objects.select_for_update()
        .filter(
            id=operation_id,
            status__in=(
                PayoutProvisioningStatus.PENDING,
                PayoutProvisioningStatus.NEEDS_RECONCILIATION,
            ),
        )
        .first()
    )
    if operation is None:
        return None
    operation.status = PayoutProvisioningStatus.NEEDS_RECONCILIATION
    operation.last_checked_at = timezone.now()
    operation.check_count += 1
    operation.save(update_fields=["status", "last_checked_at", "check_count", "updated_at"])
    return operation


def reconcile_payout_provisioning(*, limit: int = 50, minimum_age_seconds: int = 60) -> int:
    """Recover ambiguous Paystack creates by metadata lookup only.

    Absence is not permission to retry creation. Paystack could be eventually
    consistent, so an unmatched operation stays visible for another lookup or
    deliberate operations review.
    """
    cutoff = timezone.now() - timedelta(seconds=max(0, minimum_age_seconds))
    operation_ids = list(
        PayoutProvisioningOperation.objects.filter(
            provider="paystack",
            status__in=(
                PayoutProvisioningStatus.PENDING,
                PayoutProvisioningStatus.NEEDS_RECONCILIATION,
            ),
            created_at__lte=cutoff,
        )
        .order_by("created_at")
        .values_list("id", flat=True)[:limit]
    )
    if not operation_ids:
        return 0
    provider = get_payment_provider("paystack")
    recovered = 0
    for operation_id in operation_ids:
        operation = _begin_provisioning_check(operation_id=operation_id)
        if operation is None:
            continue
        try:
            destination = provider.find_payout_destination(provisioning_reference=str(operation.id))
        except ProviderUnavailable:
            continue
        if destination is None:
            continue
        _complete_provisioning_operation(
            operation_id=operation.id,
            destination=destination,
        )
        recovered += 1
    return recovered


@transaction.atomic
def set_payout_destination(*, organization, user, data: dict, request=None) -> PayoutProfile:
    """Save a distinct provider-tokenized destination for a Portfolio.

    The first destination is selected automatically. Later destinations remain
    inactive until the provider verifies them and an owner/admin deliberately
    selects one. Existing rows are never rewritten into a different account.
    """
    assert_may_manage_payouts(organization=organization, user=user)
    _reject_credentials(data)

    method = str(data.get("method", "")).strip()
    if method not in PayoutMethod.values:
        raise ValidationFailed("Choose Mobile Money or a bank account.")

    token = str(data.get("token_reference", "")).strip()
    masked = str(data.get("masked_account", "")).strip()
    account_name = str(data.get("account_name", "")).strip()
    provider = str(data.get("provider", "")).strip()
    if not token:
        raise ValidationFailed("A tokenized destination from the payment provider is required.")
    if not masked or not account_name or not provider:
        raise ValidationFailed("The provider, account name and masked account are all required.")

    type(organization).objects.select_for_update().get(pk=organization.pk)
    selected_exists = PayoutProfile.objects.filter(
        organization=organization,
        is_active=True,
    ).exists()
    profile = PayoutProfile.objects.create(
        organization=organization,
        method=method,
        provider=provider[:40],
        token_reference=token[:180],
        provider_account_id=str(data.get("provider_account_id", "")).strip()[:80],
        masked_account=masked[:40],
        account_name=account_name[:160],
        institution=str(data.get("institution", "")).strip()[:80],
        status=PayoutProfileStatus.UNVERIFIED,
        verified_at=None,
        is_active=not selected_exists,
        updated_by=user,
    )

    record(
        action=AuditAction.CREATE,
        aggregate_type="payout_profile",
        aggregate_id=profile.id,
        actor=user,
        changes={},
        metadata={
            "organization_id": str(organization.id),
            "method": profile.method,
            "provider": profile.provider,
            # The masked form only. The token is a bearer reference to somebody's
            # bank account and does not belong in an audit row.
            "masked_account": profile.masked_account,
            "selected_for_new_payments": profile.is_active,
            "ip": getattr(request, "META", {}).get("REMOTE_ADDR") if request else None,
        },
    )
    emit(
        DomainEvent(
            "payout_destination.added.v1",
            "payout_profile",
            str(profile.id),
            {"organization_id": str(organization.id), "actor_id": str(user.id)},
        )
    )
    return profile


def provision_paystack_subaccount(
    *,
    organization,
    user,
    method: str,
    bank_code: str,
    account_number: str,
    request=None,
) -> PayoutProfile:
    """Low-level create primitive retained for internal compatibility tests.

    HTTP callers must use `provision_paystack_subaccount_idempotently`, which
    writes the recovery operation and provider metadata before this external
    side effect. Calling this primitive directly is not retry-safe because
    Paystack subaccount creation has no documented idempotency key.

    A bank account number is sensitive personal data, but it is not an account
    credential such as a PIN or OTP. It is sent directly to Paystack, never
    written to Rooomly's database or audit log, and only the returned ACCT code,
    numeric id and masked display value survive this call.
    """
    assert_may_manage_payouts(organization=organization, user=user)
    if method not in PayoutMethod.values:
        raise ValidationFailed("Choose Mobile Money or a bank account.")
    bank_code = str(bank_code or "").strip()
    account_number = str(account_number or "").strip()
    if not bank_code or not account_number:
        raise ValidationFailed("The settlement institution and account number are required.")
    if len(account_number) > 32 or not account_number.replace(" ", "").isalnum():
        raise ValidationFailed("Enter a valid settlement account number.")

    provider = get_payment_provider("paystack")
    destination = provider.provision_payout_destination(
        business_name=organization.name,
        bank_code=bank_code,
        account_number=account_number,
    )
    return _store_provider_destination(
        organization=organization,
        user=user,
        method=method,
        provider=provider.name,
        destination=destination,
        request=request,
    )


@transaction.atomic
def _store_provider_destination(
    *, organization, user, method, provider, destination, request=None
) -> PayoutProfile:
    type(organization).objects.select_for_update().get(pk=organization.pk)
    selected_exists = PayoutProfile.objects.filter(
        organization=organization,
        is_active=True,
    ).exists()
    profile = PayoutProfile.objects.create(
        organization=organization,
        method=method,
        provider=provider,
        token_reference=destination.token_reference[:180],
        provider_account_id=destination.provider_account_id[:80],
        masked_account=destination.masked_account[:40],
        account_name=destination.account_name[:160],
        institution=destination.institution[:80],
        status=(
            PayoutProfileStatus.VERIFIED if destination.verified else PayoutProfileStatus.UNVERIFIED
        ),
        verified_at=timezone.now() if destination.verified else None,
        is_active=not selected_exists,
        updated_by=user,
    )

    record(
        action=AuditAction.CREATE,
        aggregate_type="payout_profile",
        aggregate_id=profile.id,
        actor=user,
        changes={},
        metadata={
            "organization_id": str(organization.id),
            "method": profile.method,
            "provider": profile.provider,
            "masked_account": profile.masked_account,
            "provider_verified": destination.verified,
            "selected_for_new_payments": profile.is_active,
            "ip": getattr(request, "META", {}).get("REMOTE_ADDR") if request else None,
        },
    )
    emit(
        DomainEvent(
            "payout_destination.added.v1",
            "payout_profile",
            str(profile.id),
            {"organization_id": str(organization.id), "actor_id": str(user.id)},
        )
    )
    return profile


@transaction.atomic
def mark_payout_verified(
    *, profile: PayoutProfile | None = None, organization=None, provider_reference: str = ""
) -> PayoutProfile:
    """Record the provider's confirmation that the destination is real.

    Called from an adapter or an operations task, never from a client request.
    Rooomly does not get to decide that an account it has never contacted is
    verified.
    """
    if profile is not None:
        profile = PayoutProfile.objects.select_for_update().filter(id=profile.id).first()
    elif organization is not None:
        profile = (
            PayoutProfile.objects.select_for_update()
            .filter(organization=organization, is_active=True)
            .first()
        )
    if profile is None:
        raise NotFound("That Portfolio has no payout destination.")
    organization = profile.organization
    if profile.status == PayoutProfileStatus.DISABLED:
        raise Conflict("That payout destination has been removed.")
    if profile.status == PayoutProfileStatus.VERIFIED:
        return profile

    profile.status = PayoutProfileStatus.VERIFIED
    profile.verified_at = timezone.now()
    profile.save(update_fields=["status", "verified_at", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="payout_profile",
        aggregate_id=profile.id,
        actor=None,
        changes={"status": [PayoutProfileStatus.UNVERIFIED, PayoutProfileStatus.VERIFIED]},
        metadata={
            "organization_id": str(organization.id),
            "provider_reference": provider_reference[:120],
        },
    )
    return profile


@transaction.atomic
def activate_payout_destination(*, organization, user, profile_id, request=None) -> PayoutProfile:
    """Select one verified destination for payment intents created from now on."""
    assert_may_manage_payouts(organization=organization, user=user)
    type(organization).objects.select_for_update().get(pk=organization.pk)
    profile = (
        PayoutProfile.objects.select_for_update()
        .filter(
            id=profile_id,
            organization=organization,
        )
        .first()
    )
    if profile is None or profile.status == PayoutProfileStatus.DISABLED:
        raise NotFound("That payout destination is not available.")
    if profile.status != PayoutProfileStatus.VERIFIED:
        raise Conflict("Verify that payout destination before using it for rent payments.")
    if profile.is_active:
        return profile

    previous = (
        PayoutProfile.objects.select_for_update()
        .filter(
            organization=organization,
            is_active=True,
        )
        .first()
    )
    if previous is not None:
        previous.is_active = False
        previous.updated_by = user
        previous.save(update_fields=["is_active", "updated_by", "updated_at"])
    profile.is_active = True
    profile.updated_by = user
    profile.save(update_fields=["is_active", "updated_by", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="payout_profile",
        aggregate_id=profile.id,
        actor=user,
        changes={"is_active": [False, True]},
        metadata={
            "organization_id": str(organization.id),
            "previous_profile_id": str(previous.id) if previous else None,
            "masked_account": profile.masked_account,
            "ip": getattr(request, "META", {}).get("REMOTE_ADDR") if request else None,
        },
    )
    emit(
        DomainEvent(
            "payout_destination.activated.v1",
            "payout_profile",
            str(profile.id),
            {"organization_id": str(organization.id), "actor_id": str(user.id)},
        )
    )
    return profile


@transaction.atomic
def remove_payout_destination(*, organization, user, profile_id, request=None) -> PayoutProfile:
    """Remove a destination from future use without deleting financial evidence."""
    assert_may_manage_payouts(organization=organization, user=user)
    type(organization).objects.select_for_update().get(pk=organization.pk)
    profile = (
        PayoutProfile.objects.select_for_update()
        .filter(
            id=profile_id,
            organization=organization,
        )
        .first()
    )
    if profile is None or profile.status == PayoutProfileStatus.DISABLED:
        raise NotFound("That payout destination is not available.")

    previous_status = profile.status
    was_active = profile.is_active
    profile.is_active = False
    profile.status = PayoutProfileStatus.DISABLED
    profile.updated_by = user
    profile.save(update_fields=["is_active", "status", "updated_by", "updated_at"])
    record(
        action=AuditAction.DELETE,
        aggregate_type="payout_profile",
        aggregate_id=profile.id,
        actor=user,
        changes={
            "is_active": [was_active, False],
            "status": [previous_status, PayoutProfileStatus.DISABLED],
        },
        metadata={
            "organization_id": str(organization.id),
            "masked_account": profile.masked_account,
            "in_flight_routing_preserved": True,
            "ip": getattr(request, "META", {}).get("REMOTE_ADDR") if request else None,
        },
    )
    emit(
        DomainEvent(
            "payout_destination.removed.v1",
            "payout_profile",
            str(profile.id),
            {"organization_id": str(organization.id), "actor_id": str(user.id)},
        )
    )
    return profile


def _verified_destinations():
    """The one queryset that decides where rent may be collected to.

    Written once because two callers must never be allowed to disagree about
    it: the routing an intent freezes at checkout, and the readiness a provider
    is shown on their dashboard. They used to answer from different sources —
    routing from this Portfolio-owned, provider-verified destination, and the
    dashboard from a *person's* `BANK_ACCOUNT` trust stamp — so a provider could
    be told payments were not ready while checkout worked, or the reverse.
    """
    return PayoutProfile.objects.filter(
        organization__property_relationships__ended_at__isnull=True,
        organization__memberships__ended_at__isnull=True,
        organization__is_active=True,
        status=PayoutProfileStatus.VERIFIED,
        is_active=True,
    )


def eligible_payout_profiles(*, prop, member, provider_name: str, limit: int = 2) -> list:
    """Every destination that could receive this property's rent for this member.

    Returns up to ``limit`` so a caller can tell "none" from "more than one"
    without counting the whole table. Two is not an error here — it is a
    question only the provider can answer, and both callers refuse rather than
    guess which Portfolio should be paid.
    """
    return list(
        _verified_destinations()
        .filter(
            organization__property_relationships__property=prop,
            organization__memberships__user=member,
            provider=provider_name,
        )
        .select_related("organization")
        .distinct()[:limit]
    )


def ready_payout_organization_ids(*, user, provider_name: str) -> set[str]:
    """This member's Portfolios that hold a usable destination, in one query.

    The set form exists for the capability layer, which is called once per
    property in a prepared list and must stay constant-cost as a portfolio
    grows. Same filter as `eligible_payout_profiles`, minus the property.
    """
    rows = (
        _verified_destinations()
        .filter(organization__memberships__user=user, provider=provider_name)
        .exclude(token_reference="")
        .exclude(provider_account_id="")
        .values_list("organization_id", flat=True)
        .distinct()
    )
    return {str(row) for row in rows}


def collection_rail() -> tuple[object | None, str]:
    """The configured rail, or why rent cannot be collected through Rooomly.

    Returns ``(provider, "")`` when checkout could honestly be offered by some
    Portfolio, or ``(None, reason_token)`` when no rail exists at all. Deciding
    this in one place keeps "we have no PSP" from being reported as "your
    account is incomplete", which is a different thing and not the provider's
    fault.
    """
    try:
        provider = get_payment_provider()
        provider.ensure_available()
    except (ProviderUnavailable, PermissionDenied):
        return None, "payment_rail"
    return provider, ""


def assert_can_receive_settlement(*, organization) -> PayoutProfile:
    """The gate a real settlement run must pass before sending anything.

    Not called anywhere yet — settlement is still recorded as pending and no
    money moves. It exists now so the first PSP integration has one obvious
    place to ask the question, rather than inventing its own answer under
    deadline.
    """
    profile = PayoutProfile.objects.filter(
        organization=organization,
        is_active=True,
    ).first()
    if profile is None:
        raise Conflict("That Portfolio has not set a payout destination.")
    if not profile.can_receive_settlement:
        raise Conflict("That Portfolio's payout destination has not been verified.")
    return profile
