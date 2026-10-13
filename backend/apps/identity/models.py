"""Identity foundation.

Phase 0 establishes only the user table and the role vocabulary. Sign-up, OTP,
sessions, devices and verification workflows are Phase 1 - but the user model
itself has to land now, because ``AUTH_USER_MODEL`` cannot be changed once there
is production data without a migration nobody wants to write.

Three decisions are baked in here and explained in
``docs/architecture/adr/0004-phone-first-identity.md``:

1. **The phone number is the identifier.** Email is optional. A large share of
   Ghanaian users have no habitual email address, but everyone renting a room has
   a phone number, and that number is also how mobile money reaches them. The
   number says *which account*; a password says *who is signing in*. Those were
   the same thing while sign-in was an OTP, and ADR 0019 separates them.
2. **Roles are not a single column.** One person is a tenant in Accra and a
   landlord in Kumasi. Role is a set, held on ``UserRole`` rows, and permission
   checks are scoped to an object rather than a global role name.
3. **Verification is not a boolean.** ``is_phone_verified`` records only that we
   sent an OTP to this number and it came back. Identity, ownership and agency
   verification are separate, evidenced records built in Phase 1.
"""

from __future__ import annotations

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.core.fields import MoneyField, PhoneNumberField
from apps.core.ids import uuid7
from apps.core.phone import normalise_ghana_msisdn


class Role(models.TextChoices):
    TENANT = "tenant", "Tenant"
    LANDLORD = "landlord", "Landlord"
    AGENT = "agent", "Agent"
    PROPERTY_MANAGER = "property_manager", "Property manager"
    SUPPORT = "support", "Support"
    ADMIN = "admin", "Administrator"


class AccountType(models.TextChoices):
    """What the person said they came here to be, chosen at registration.

    This is a starting point and a default workspace, not an authorization
    grant. ``provider`` here means "asked to operate as a provider", which is
    the question provider verification answers; it never by itself opens the
    provider workspace. Capabilities stay additive on top of it, so the tenant
    who later lets out a room does not need a second account.
    """

    TENANT = "tenant", "Tenant"
    PROVIDER = "provider", "Property provider"


class Intent(models.TextChoices):
    FIND_PROPERTY = "find_property", "Find a property"
    CURRENT_TENANT = "current_tenant", "I am already a tenant"
    MANAGE_PROPERTY = "manage_property", "I own or manage property"


class ChallengePurpose(models.TextChoices):
    CONTINUE = "continue", "Continue with phone"
    SIGN_UP = "sign_up", "Sign up"
    SIGN_IN = "sign_in", "Sign in"
    STEP_UP = "step_up", "Confirm a sensitive action"
    CHANGE_PHONE = "change_phone", "Change phone number"
    RECOVER_ACCOUNT = "recover_account", "Recover account"


class ChallengeStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    VERIFIED = "verified", "Verified"
    EXPIRED = "expired", "Expired"
    FAILED = "failed", "Failed"
    CANCELLED = "cancelled", "Cancelled"


class DevicePlatform(models.TextChoices):
    ANDROID = "android", "Android"
    IOS = "ios", "iOS"
    WEB = "web", "Web"


class IncomeBand(models.TextChoices):
    """Bands in cedis per month. Banded because an exact salary is sensitive,
    invites misreporting, and is not what a landlord actually decides on."""

    UNDER_1K = "under_1000", "Under GH\u20b51,000"
    B1K_3K = "1000_3000", "GH\u20b51,000 - 3,000"
    B3K_6K = "3000_6000", "GH\u20b53,000 - 6,000"
    B6K_10K = "6000_10000", "GH\u20b56,000 - 10,000"
    OVER_10K = "over_10000", "Over GH\u20b510,000"
    PREFER_NOT = "prefer_not_to_say", "Prefer not to say"


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, phone: str, password: str | None = None, **extra):
        if not phone:
            raise ValueError("A phone number is required.")
        phone = normalise_ghana_msisdn(phone)
        user = self.model(phone=phone, **extra)
        if password:
            user.set_password(password)
        else:
            # Ordinary users sign in with an OTP, so most accounts never have a
            # usable password. This makes that explicit rather than leaving an
            # empty hash that might accidentally validate.
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, phone: str, password: str, **extra):
        if not extra.get("email"):
            raise ValueError("Administrative users require an email address.")
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_active", True)
        extra.setdefault("is_phone_verified", True)
        extra.setdefault("is_email_verified", True)
        if not extra["is_staff"] or not extra["is_superuser"]:
            raise ValueError("Superusers must have is_staff and is_superuser set.")
        return self.create_user(phone, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)

    phone = PhoneNumberField(unique=True)
    email = models.EmailField(blank=True, null=True, unique=True)

    first_name = models.CharField(max_length=80, blank=True)
    last_name = models.CharField(max_length=80, blank=True)
    #: What the person is actually called day to day. Ghanaian naming does not
    #: always fit first/last, and getting someone's name wrong erodes trust fast.
    preferred_name = models.CharField(max_length=80, blank=True)
    #: Collected at registration. Nullable because accounts created before
    #: registration asked for it are still valid accounts.
    date_of_birth = models.DateField(null=True, blank=True)

    #: Blank until the person chooses during registration. Blank therefore means
    #: "registration unfinished", which is a state the API reports rather than a
    #: value to guess at.
    account_type = models.CharField(
        max_length=16, choices=AccountType.choices, blank=True, default=""
    )

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    is_phone_verified = models.BooleanField(default=False)
    phone_verified_at = models.DateTimeField(null=True, blank=True)
    is_email_verified = models.BooleanField(default=False)

    preferred_language = models.CharField(max_length=12, default="en")
    #: Users on metered data can opt out of image-heavy screens and auto-play.
    data_saver = models.BooleanField(default=False)

    last_seen_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    #: Account closure keeps the row: leases, payments and audit trails reference
    #: it. Personal data is minimised by a separate erasure job (Phase 1).
    deactivated_at = models.DateTimeField(null=True, blank=True)

    #: Authentication and onboarding are separate. A verified, signed-in user
    #: may legitimately have to resume onboarding after closing the app.
    onboarding_completed_at = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS: list[str] = ["email"]

    class Meta:
        db_table = "identity_user"
        indexes = [
            models.Index(fields=["-created_at"], name="user_created_idx"),
            # No index on email: unique=True already builds one, and a second
            # partial index over the same column is dead weight on every write.
        ]

    def __str__(self) -> str:
        return self.display_name

    @property
    def display_name(self) -> str:
        from apps.core.phone import format_national

        return (
            self.preferred_name
            or " ".join(p for p in (self.first_name, self.last_name) if p)
            or format_national(self.phone)
        )

    @property
    def roles(self) -> set[str]:
        """Roles the person holds *now*. Revoked assignments are not roles."""
        return {
            assignment.role
            for assignment in self.role_assignments.all()
            if assignment.revoked_at is None
        }

    @property
    def primary_role(self) -> str | None:
        assignment = (
            self.role_assignments.filter(revoked_at__isnull=True)
            .order_by("-is_primary", "granted_at")
            .first()
        )
        # No grant means no role. Pretending that it means tenant makes an
        # interrupted onboarding indistinguishable from a completed tenant.
        return assignment.role if assignment else None

    def has_role(self, role: str) -> bool:
        return self.role_assignments.filter(role=role, revoked_at__isnull=True).exists()

    def mark_phone_verified(self) -> None:
        self.is_phone_verified = True
        self.phone_verified_at = timezone.now()
        self.save(update_fields=["is_phone_verified", "phone_verified_at", "updated_at"])

    @property
    def registration_state(self) -> str:
        """How far through account creation this person is.

        Registration is finished when we know the number is theirs, what they
        came here to be, what to call them, and they hold a credential they can
        sign back in with. Until all four are true the account exists but cannot
        act, which is what stops a half-finished sign-up from being a usable
        identity.
        """
        if not self.is_phone_verified:
            return "phone_required"
        if not self.account_type:
            return "account_type_required"
        if not (self.first_name.strip() and self.last_name.strip()):
            return "profile_required"
        if not self.has_usable_password():
            return "password_required"
        return "complete"

    @property
    def is_registration_complete(self) -> bool:
        return self.registration_state == "complete"


class UserRole(models.Model):
    """A role a user holds. Revoked rather than deleted, so history survives."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="role_assignments")
    role = models.CharField(max_length=32, choices=Role.choices)
    is_primary = models.BooleanField(default=False)

    granted_at = models.DateTimeField(auto_now_add=True)
    granted_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "identity_user_role"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "role"],
                condition=models.Q(revoked_at__isnull=True),
                name="identity_unique_active_role",
            ),
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(is_primary=True, revoked_at__isnull=True),
                name="identity_single_primary_role",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.role}"


class UserIntent(models.Model):
    """A user's selected product journey, never an authorization grant."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="intent_selections")
    intent = models.CharField(max_length=24, choices=Intent.choices)
    is_primary = models.BooleanField(default=False)
    selected_at = models.DateTimeField(auto_now_add=True)
    last_selected_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "identity_user_intent"
        constraints = [
            models.UniqueConstraint(fields=["user", "intent"], name="identity_unique_intent"),
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(is_primary=True),
                name="identity_single_primary_intent",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.intent}"


class AuthChallenge(models.Model):
    """One OTP challenge: a code sent to a number for a stated purpose.

    Never stores the code. Only a peppered HMAC of it, so a database dump does
    not yield a million-guess-wide secret, and the pepper lives in the secret
    store rather than beside the hash.

    A challenge is bound to the purpose it was issued for. A code sent to
    confirm a phone change must not be replayable as a sign-in, so ``purpose``
    is part of what the verifier checks.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)

    phone = PhoneNumberField(db_index=True)
    #: Null for sign-up: we do not create the account until the number is proven.
    user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.CASCADE, related_name="auth_challenges"
    )
    purpose = models.CharField(max_length=32, choices=ChallengePurpose.choices)

    code_hash = models.CharField(max_length=64)
    code_salt = models.CharField(max_length=32)

    status = models.CharField(
        max_length=16, choices=ChallengeStatus.choices, default=ChallengeStatus.PENDING
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    send_count = models.PositiveSmallIntegerField(default=1)

    expires_at = models.DateTimeField(db_index=True)
    last_sent_at = models.DateTimeField(default=timezone.now)
    consumed_at = models.DateTimeField(null=True, blank=True)
    locked_until = models.DateTimeField(null=True, blank=True)

    #: Carried through to the session created on success, so a session records
    #: which device and address proved the number.
    device_fingerprint = models.CharField(max_length=128, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    channel = models.CharField(max_length=16, default="sms")

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "identity_auth_challenge"
        indexes = [
            # The verifier's lookup: the newest live challenge for this number
            # and purpose.
            models.Index(
                fields=["phone", "purpose", "-created_at"],
                name="challenge_lookup_idx",
                condition=models.Q(status="pending"),
            ),
            models.Index(fields=["expires_at"], name="challenge_expiry_idx"),
        ]

    def __str__(self) -> str:
        from apps.core.phone import mask

        return f"{self.purpose} to {mask(self.phone)} ({self.status})"

    @property
    def is_live(self) -> bool:
        return self.status == ChallengeStatus.PENDING and timezone.now() < self.expires_at

    @property
    def age_seconds(self) -> int:
        return int((timezone.now() - self.created_at).total_seconds())

    @property
    def lockout_seconds_remaining(self) -> int:
        if not self.locked_until:
            return 0
        return max(int((self.locked_until - timezone.now()).total_seconds()), 0)


class EmailVerification(models.Model):
    """A six-digit code sent to an email address someone wants on their account.

    The address is not the account's until the code comes back. Until then it
    lives here, and whatever address the account already had stays exactly as
    it was — so a mistyped address, or one belonging to somebody else, never
    replaces a working one.

    Separate from :class:`AuthChallenge`, which is keyed on a phone number and
    carries sign-in semantics; this proves an inbox for an account that is
    already signed in, and nothing else. Like it, it never stores the code: only
    a peppered HMAC.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="email_verifications")
    email = models.EmailField()

    code_hash = models.CharField(max_length=64)
    code_salt = models.CharField(max_length=32)

    status = models.CharField(
        max_length=16, choices=ChallengeStatus.choices, default=ChallengeStatus.PENDING
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    send_count = models.PositiveSmallIntegerField(default=1)

    expires_at = models.DateTimeField()
    last_sent_at = models.DateTimeField(default=timezone.now)
    consumed_at = models.DateTimeField(null=True, blank=True)
    locked_until = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "identity_email_verification"
        indexes = [
            models.Index(
                fields=["user", "-created_at"],
                name="email_verify_lookup_idx",
                condition=models.Q(status="pending"),
            ),
        ]

    def __str__(self) -> str:
        return f"email verification for {self.user_id} ({self.status})"

    @property
    def is_live(self) -> bool:
        return self.status == ChallengeStatus.PENDING and timezone.now() < self.expires_at

    @property
    def age_seconds(self) -> int:
        return int((timezone.now() - self.last_sent_at).total_seconds())

    @property
    def lockout_seconds_remaining(self) -> int:
        if not self.locked_until:
            return 0
        return max(int((self.locked_until - timezone.now()).total_seconds()), 0)


class Device(models.Model):
    """A phone or browser that has signed in.

    Devices are first-class because they are the cheapest available signal
    against SIM swap: an attacker with a reissued SIM almost never also has the
    victim's handset. A first sign-in from an unseen device raises risk, and a
    familiar device is the thing that lets a real user avoid friction.

    The fingerprint is generated by the client and stored in the Keychain or
    Keystore. It identifies an installation, not a person, and is not used for
    tracking across accounts.

    **Removed and blocked are different facts, and conflating them locked people
    out of their own phones.** Both used to set ``blocked_at``, so tidying up a
    device list barred that installation from the account for good — with no way
    back anywhere in the product, because nothing ever cleared the column.

      ``removed_at``  the owner signed this installation out. It leaves the
                      device list and its sessions end, and a fresh sign-in
                      brings it back as an unfamiliar device. Re-authentication
                      is a one-time code to the account's own number, which is
                      the control that was doing the work all along.

      ``blocked_at``  the owner said the handset is lost or stolen. Sign-in is
                      refused, and only Management can lift it.

    A fingerprint ban is a poor lock on its own: an attacker holding the handset
    reinstalls and gets a new one. It is worth keeping for the stolen case, as a
    speed bump and a signal, and worth *not* charging to somebody who only meant
    to sign a spare phone out.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="devices")

    fingerprint = models.CharField(max_length=128)
    platform = models.CharField(max_length=16, choices=DevicePlatform.choices)
    #: What the user sees in their device list: "Samsung Galaxy A14", "iPhone 12".
    label = models.CharField(max_length=120, blank=True)
    os_version = models.CharField(max_length=40, blank=True)
    app_version = models.CharField(max_length=40, blank=True)

    push_token = models.CharField(max_length=255, blank=True)

    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(default=timezone.now)
    trusted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Set once the device has been in good standing long enough to reduce friction.",
    )
    removed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Signed out by its owner. Cleared when the installation signs in again.",
    )
    blocked_at = models.DateTimeField(null=True, blank=True)
    blocked_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "identity_device"
        constraints = [
            models.UniqueConstraint(fields=["user", "fingerprint"], name="identity_unique_device")
        ]
        indexes = [models.Index(fields=["user", "-last_seen_at"], name="device_recent_idx")]

    def __str__(self) -> str:
        return self.label or f"{self.platform} device"

    @property
    def is_blocked(self) -> bool:
        return self.blocked_at is not None

    @property
    def is_removed(self) -> bool:
        return self.removed_at is not None

    @property
    def is_listed(self) -> bool:
        """Whether the owner should see it among their signed-in devices."""
        return self.blocked_at is None and self.removed_at is None

    @property
    def hours_since_first_seen(self) -> float:
        return (timezone.now() - self.first_seen_at).total_seconds() / 3600


class Session(models.Model):
    """A refresh-token session, one per device.

    Access tokens are short-lived signed payloads that the API validates without
    a database read. Refresh tokens are long-lived, stored only as a hash, and
    **rotate on every use**.

    Rotation is what makes theft detectable: if a stolen refresh token is used
    after the real device has already rotated it, the old token is presented
    twice. That is a reuse event, and the whole family is revoked - the attacker
    and the victim are both signed out, and the victim is told why. Signing
    everyone out is the correct response; silently allowing it is not.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sessions")
    device = models.ForeignKey(
        Device, null=True, blank=True, on_delete=models.SET_NULL, related_name="sessions"
    )

    refresh_token_hash = models.CharField(max_length=64, unique=True)
    #: All rotations descending from one sign-in share a family id, so a reuse
    #: event can revoke the lineage rather than a single token.
    family_id = models.UUIDField(default=uuid7, db_index=True)
    generation = models.PositiveIntegerField(default=0)

    issued_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    rotated_at = models.DateTimeField(null=True, blank=True)

    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=64, blank=True)

    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    client = models.CharField(max_length=20, blank=True)

    class Meta:
        db_table = "identity_session"
        constraints = [
            models.UniqueConstraint(
                fields=["device"],
                condition=models.Q(revoked_at__isnull=True),
                name="identity_one_live_device",
            )
        ]
        indexes = [
            models.Index(
                fields=["user", "-issued_at"],
                name="session_active_idx",
                condition=models.Q(revoked_at__isnull=True),
            ),
            models.Index(fields=["family_id", "generation"], name="session_family_idx"),
        ]

    def __str__(self) -> str:
        return f"session for {self.user_id} on {self.device or 'unknown device'}"

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and timezone.now() < self.expires_at


class Profile(models.Model):
    """Shared profile, one per user, whatever roles they hold.

    Not one profile table per role. A person who lets one room while renting
    another is normal here, and duplicating their name and photo across a tenant
    row and a landlord row guarantees the two drift apart. Role-specific detail
    lives in the role profiles below, which are optional and additive.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")

    avatar = models.ForeignKey(
        "files.StoredFile", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    bio = models.TextField(blank=True, max_length=600)
    address = models.ForeignKey(
        "geo.Address", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    #: Where the person wants to rent or operate. Drives search defaults and, for
    #: agents, the area they are shown as covering.
    preferred_localities = models.ManyToManyField(
        "geo.Locality", blank=True, related_name="interested_users"
    )

    #: Set only by the verification flow, never by the user. Hashed so a database
    #: dump does not yield a national ID register; last4 so support can confirm
    #: which card is being discussed without seeing the whole number.
    national_id_hash = models.CharField(max_length=64, blank=True, db_index=True)
    national_id_last4 = models.CharField(max_length=4, blank=True)

    contact_preference = models.CharField(max_length=16, default="in_app")
    whatsapp_number = PhoneNumberField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "identity_profile"

    def __str__(self) -> str:
        return f"profile of {self.user_id}"

    @property
    def completeness(self) -> int:
        """Percentage complete, used to nudge without nagging.

        Deliberately excludes verification: a complete profile is not a verified
        one, and conflating the two is exactly the false confidence this product
        is meant to remove.
        """
        checks = [
            bool(self.user.first_name or self.user.preferred_name),
            bool(self.user.last_name),
            bool(self.avatar_id),
            bool(self.bio),
            bool(self.address_id),
            self.user.is_phone_verified,
        ]
        return round(100 * sum(checks) / len(checks))


class TenantProfile(models.Model):
    """What a landlord actually wants to know about a prospective tenant.

    Every field is optional and self-declared. Nothing here is presented as
    verified unless a verification record backs it - an employer name a tenant
    typed is a claim, and the UI says so.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="tenant_profile")

    occupation = models.CharField(max_length=120, blank=True)
    employer = models.CharField(max_length=160, blank=True)
    #: Banded rather than exact. An exact salary is sensitive, invites lying, and
    #: is not what a landlord decides on.
    income_band = models.CharField(max_length=24, blank=True, choices=IncomeBand.choices)

    household_size = models.PositiveSmallIntegerField(null=True, blank=True)
    move_in_from = models.DateField(null=True, blank=True)
    budget_max = MoneyField(null=True)
    #: The number of months' advance a tenant can actually raise. This is the
    #: single biggest determinant of whether a Ghanaian rental goes ahead.
    advance_months_affordable = models.PositiveSmallIntegerField(null=True, blank=True)

    has_pets = models.BooleanField(null=True, blank=True)
    smoker = models.BooleanField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "identity_tenant_profile"

    def __str__(self) -> str:
        return f"Tenant profile for {self.user}"


class LandlordProfile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="landlord_profile")

    is_company = models.BooleanField(default=False)
    company_name = models.CharField(max_length=160, blank=True)
    #: Registrar-General's Department number. Format is not validated here;
    #: verification against the register is a reviewed evidence step.
    company_registration_number = models.CharField(max_length=40, blank=True)

    properties_declared = models.PositiveSmallIntegerField(null=True, blank=True)
    manages_own_properties = models.BooleanField(default=True)
    #: How a landlord wants rent to reach them. The destination itself is a
    #: payout record in Phase 5; this is only the stated preference.
    preferred_payout_method = models.CharField(max_length=24, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "identity_landlord_profile"

    def __str__(self) -> str:
        # The company where there is one, because that is how a landlord who
        # lets through a company is actually referred to.
        return f"Landlord profile for {self.company_name or self.user}"


class AgentProfile(models.Model):
    """Agents are the trust problem in Ghanaian renting, so they carry the most.

    ``agency_name`` and ``licence_number`` are claims until a verification record
    with evidence says otherwise. ``commission_policy`` is stated up front
    because opaque and shifting agent fees are one of the loudest complaints in
    this market.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="agent_profile")

    agency_name = models.CharField(max_length=160, blank=True)
    licence_number = models.CharField(max_length=60, blank=True)
    years_active = models.PositiveSmallIntegerField(null=True, blank=True)

    operating_localities = models.ManyToManyField(
        "geo.Locality", blank=True, related_name="operating_agents"
    )
    commission_policy = models.TextField(
        blank=True,
        max_length=600,
        help_text="What the agent charges and when, in their own words. Shown to tenants.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "identity_agent_profile"

    def __str__(self) -> str:
        return f"Agent profile for {self.agency_name or self.user}"
