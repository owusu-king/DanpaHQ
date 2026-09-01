import pytest

from apps.core.context import RequestContext, set_context


@pytest.fixture(autouse=True)
def request_context():
    """Tests run with a known request context so audit assertions are stable."""
    set_context(RequestContext(request_id="test-request", source="test"))
    yield
    set_context(RequestContext())


@pytest.fixture(autouse=True)
def clear_throttles():
    """Give every test a fresh rate-limit budget.

    The throttles key on the phone number and the client IP and count in the
    default cache, which is process-wide and outlives a test. Two tests that
    happened to use the same fixture number were therefore sharing one budget,
    so adding a third request anywhere could push an unrelated test into a 429 —
    and only under some orderings, which is the worst way to find out.
    """
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def sms(settings):
    """Every test gets a fresh in-memory SMS provider.

    Autouse because a test that accidentally hits the console provider would
    print one-time codes into the test output.
    """
    from apps.identity.providers import get_sms_provider, reset_sms_provider

    settings.SMS_BACKEND = "memory"
    reset_sms_provider()
    provider = get_sms_provider()
    yield provider
    reset_sms_provider()


#: Long enough and odd enough to satisfy the configured validators, so tests
#: exercise the real password path rather than a relaxed one.
TEST_PASSWORD = "correct-horse-battery-staple"


def make_account(
    phone, *, first_name="Ama", last_name="Mensah", account_type="tenant", tenant_role=True, **extra
):
    """A registered account: proved number, declared type, name, credential.

    Test users go through this rather than ``create_user`` because a bare row is
    no longer a usable account — it is an abandoned sign-up, and the API refuses
    it. Building them half-made would mean every test asserting the registration
    gate instead of what it is about.
    """
    from datetime import date

    from django.utils import timezone

    from apps.identity.models import User
    from apps.trust.services import record_phone_verification

    user = User.objects.create_user(
        phone=phone,
        password=TEST_PASSWORD,
        first_name=first_name,
        last_name=last_name,
        account_type=account_type,
        date_of_birth=date(1990, 6, 15),
        is_phone_verified=True,
        phone_verified_at=timezone.now(),
        **extra,
    )
    # The real registration path leaves a dated phone verification behind, not
    # just the boolean, and grants the tenant role to a tenant account. Tests
    # that read either should see what a genuine account looks like.
    record_phone_verification(user, challenge_id="test-registration")
    if account_type == "tenant" and tenant_role:
        from apps.identity.models import Role, UserRole

        UserRole.objects.get_or_create(
            user=user, role=Role.TENANT, revoked_at=None, defaults={"is_primary": True}
        )
    return user


def sign_in(api=None, phone=None, *, user=None, device_fingerprint="test-device", **account):
    """Open a session the way a finished account now gets one: with a password.

    Tests used to reach for the OTP flow because it both created the account and
    signed it in. It no longer signs anyone in, so this does the two jobs
    explicitly — registering the account if it does not exist, then
    authenticating it — and attaches the bearer token to ``api`` if given.
    """
    from apps.core.phone import normalise_ghana_msisdn
    from apps.identity import services
    from apps.identity.models import User

    if user is None:
        user = User.objects.filter(phone=normalise_ghana_msisdn(phone)).first() or make_account(
            phone, **account
        )
    result = services.sign_in_with_password(
        raw_phone=user.phone,
        password=TEST_PASSWORD,
        device_fingerprint=device_fingerprint,
    )
    if api is not None:
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {result['access_token']}")
    return result


@pytest.fixture
def sign_in_as(db):
    """Injectable form of :func:`sign_in`, so tests need no import path."""
    return sign_in


@pytest.fixture
def registered(db):
    """Injectable form of :func:`make_account`."""
    return make_account


@pytest.fixture
def provider_standing(db):
    """Injectable form of :func:`approve_provider_standing`."""
    return approve_provider_standing


def approve_provider_standing(user):
    """Approve the account to operate as a provider, and say nothing about any
    property. Tests that want the property side too use ``approve_provider``."""
    from django.utils import timezone

    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    verification, _ = Verification.objects.get_or_create(
        subject_type=SubjectType.USER,
        subject_id=str(user.id),
        kind=VerificationKind.PROVIDER,
        status=VerificationStatus.APPROVED,
        defaults={
            "method": VerificationMethod.DOCUMENT_REVIEW,
            "submitted_by": user,
            "decided_at": timezone.now(),
        },
    )
    return verification


@pytest.fixture
def user(db):
    return make_account("0201234567", first_name="Ama")


@pytest.fixture
def landlord(db):
    from apps.identity.models import Role, UserRole

    user = make_account("0551234567", first_name="Yaw", account_type="provider")
    UserRole.objects.create(user=user, role=Role.LANDLORD, is_primary=True)
    approve_provider_standing(user)
    return user


@pytest.fixture
def agent(db):
    from apps.identity.models import Role, UserRole

    user = make_account("0271234567", first_name="Kofi", account_type="provider")
    UserRole.objects.create(user=user, role=Role.AGENT, is_primary=True)
    approve_provider_standing(user)
    return user


@pytest.fixture
def staff(db):
    """A reviewer. Staff rather than a customer role, because approving
    verifications is deliberately not available to any customer-facing role."""
    from apps.identity.models import Role, UserRole

    user = make_account("0501234567", first_name="Adjoa", tenant_role=False)
    user.is_staff = True
    user.save(update_fields=["is_staff"])
    UserRole.objects.create(user=user, role=Role.SUPPORT, is_primary=True)
    return user


@pytest.fixture
def approve_space(db):
    """Mark a rentable space as checked.

    Inviting a tenant now requires it: a person invited into an unverified room
    is the one least able to check it themselves. Tests that put somebody into a
    space go through here, so the precondition is stated rather than assumed.
    """
    from django.utils import timezone

    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    def _approve(unit):
        verification, _ = Verification.objects.get_or_create(
            subject_type=SubjectType.SPACE,
            subject_id=str(unit.id),
            kind=VerificationKind.SPACE_CONDITION,
            status=VerificationStatus.APPROVED,
            defaults={
                "method": VerificationMethod.DOCUMENT_REVIEW,
                "decided_at": timezone.now(),
            },
        )
        unit.refresh_from_db()
        return verification

    return _approve


@pytest.fixture
def approve_provider(db):
    """Establish the reviewed preconditions for listing-domain tests.

    Provider-application tests exercise the human workflow itself. Listing
    tests start after that boundary so they can focus on listing behaviour.
    """
    from django.utils import timezone

    from apps.property.models import PropertyRelationship, PropertyRelationshipType
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    def approve(user, prop, relationship_type=PropertyRelationshipType.OWNER):
        user.is_phone_verified = True
        user.phone_verified_at = timezone.now()
        user.save(update_fields=["is_phone_verified", "phone_verified_at", "updated_at"])
        # Authority over a property presupposes standing to operate at all, and
        # a fixture that granted one without the other would describe a state
        # the product cannot reach.
        approve_provider_standing(user)
        Verification.objects.get_or_create(
            subject_type=SubjectType.USER,
            subject_id=str(user.id),
            kind=VerificationKind.PHONE,
            status=VerificationStatus.APPROVED,
            defaults={
                "method": VerificationMethod.AUTOMATED_OTP,
                "submitted_by": user,
                "decided_at": timezone.now(),
            },
        )
        Verification.objects.get_or_create(
            subject_type=SubjectType.USER,
            subject_id=str(user.id),
            kind=VerificationKind.IDENTITY,
            status=VerificationStatus.APPROVED,
            defaults={
                "method": VerificationMethod.DOCUMENT_REVIEW,
                "submitted_by": user,
                "decided_at": timezone.now(),
            },
        )
        Verification.objects.get_or_create(
            subject_type=SubjectType.USER,
            subject_id=str(user.id),
            kind=VerificationKind.BANK_ACCOUNT,
            status=VerificationStatus.APPROVED,
            defaults={
                "method": VerificationMethod.PROVIDER_API,
                "submitted_by": user,
                "decided_at": timezone.now(),
            },
        )
        authority, _ = Verification.objects.get_or_create(
            subject_type=SubjectType.PROPERTY,
            subject_id=str(prop.id),
            kind=VerificationKind.PROPERTY_AUTHORITY,
            status=VerificationStatus.APPROVED,
            defaults={
                "method": VerificationMethod.DOCUMENT_REVIEW,
                "submitted_by": user,
                "decided_at": timezone.now(),
            },
        )
        Verification.objects.get_or_create(
            subject_type=SubjectType.PROPERTY,
            subject_id=str(prop.id),
            kind=VerificationKind.PROPERTY_CONDITION,
            status=VerificationStatus.APPROVED,
            defaults={
                "method": VerificationMethod.SITE_VISIT,
                "submitted_by": user,
                "decided_at": timezone.now(),
            },
        )
        relation, _ = PropertyRelationship.objects.get_or_create(
            property=prop,
            user=user,
            relationship_type=relationship_type,
            ended_at=None,
        )
        relation.authority_verification_id = authority.id
        relation.authority_verified_at = timezone.now()
        relation.save(
            update_fields=[
                "authority_verification_id",
                "authority_verified_at",
                "updated_at",
            ]
        )
        return relation

    return approve


def upgrade_portfolio(organization, code="BUSINESS"):
    """Put a Portfolio on a plan with room, for tests that are not about billing.

    Most of this suite predates monetization and exercises several properties,
    units or team members inside one Portfolio. Those tests are about property
    authority, invitations and occupancy — not about plan limits — and a new
    Portfolio now starts on Free, which includes one property and one seat.

    Stating the plan in the test is deliberate rather than making the default
    generous: Free's limits stay real everywhere, and a test that needs headroom
    says so in one readable line. Billing's own tests set the plan they mean.
    """
    from apps.billing.services import subscription_service

    return subscription_service.change_plan(
        organization=organization,
        plan_code=code,
        actor=None,
        reason="test fixture",
    )


@pytest.fixture
def on_plan(db):
    """Injectable form of :func:`upgrade_portfolio`."""
    return upgrade_portfolio
