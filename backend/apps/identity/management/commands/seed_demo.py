"""Seed demo accounts for local development.

These accounts sign in with a **password**, because that is the only way an
existing account can. ``/auth/verify`` refuses a one-time code for a number that
already has an account — "sign in with your password, or reset it" — so a seeded
account with no password set cannot get in by either route. That was the first
version of this command, and it produced four accounts nobody could use.

What it creates is the state that is tedious to reach by hand: verified phone
numbers, a known password, the roles each side needs, and — for the provider —
an approved provider verification, without which the provider workspace stays
shut and the account is a demo of a waiting room.

Nothing here weakens the OTP path or plants a fixed code. A development-only
authentication bypass is still an authentication bypass living in the
repository, one settings mistake away from production; a password on a throwaway
account is just a password.

Idempotent. Re-running repairs an account that has drifted — a revoked role, a
verification that lapsed — rather than duplicating it or failing on the unique
phone number.

    python manage.py seed_demo

Refuses to run outside DEBUG unless ``--force`` is passed, because the whole
point of these rows is that anybody who can read this file can sign in as them.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.billing.services.entitlement_service import PlanLimitReached
from apps.geo.models import Address, Locality
from apps.identity.models import AccountType, Role, User, UserRole
from apps.property import services as property_services
from apps.property.models import Property
from apps.trust.models import (
    SubjectType,
    Verification,
    VerificationKind,
    VerificationMethod,
    VerificationStatus,
)

#: The shared password.
#:
#: `S105` is correct — this is a hardcoded credential in source. It is
#: deliberate and it is the point: these four numbers are published in this file
#: too, so the password protects nothing and pretending otherwise by generating
#: one would only mean nobody could log in. The guard in `handle` is what keeps
#: it out of anywhere it would matter.
DEMO_PASSWORD = "demo-rentals-2026"  # noqa: S105

#: phone, first, last, account type, roles, whether to approve as a provider
DEMO_ACCOUNTS: list[tuple[str, str, str, str, list[str], bool]] = [
    (
        "0241000001",
        "Ama",
        "Mensah",
        AccountType.TENANT,
        [Role.TENANT],
        False,
    ),
    (
        "0241000002",
        "Kwabena",
        "Owusu",
        AccountType.PROVIDER,
        [Role.LANDLORD],
        True,
    ),
    (
        "0241000003",
        "Akosua",
        "Boateng",
        AccountType.PROVIDER,
        [Role.AGENT],
        True,
    ),
    # Holds both sides, because the account that lets out a room while renting
    # one is the case the workspace switcher exists for and the easiest to
    # forget to test.
    (
        "0241000004",
        "Yaw",
        "Darko",
        AccountType.TENANT,
        [Role.TENANT, Role.LANDLORD],
        True,
    ),
]


#: title, street, [(label, space type, bedrooms, bathrooms)]
DEMO_PROPERTIES: list[tuple[str, str, list[tuple[str, str, int, int]]]] = [
    (
        "Adabraka Court",
        "12 Kojo Thompson Road",
        [
            ("Flat 1", "apartment", 2, 1),
            ("Flat 2", "apartment", 2, 1),
            ("Flat 3", "apartment", 1, 1),
            ("Flat 4", "apartment", 3, 2),
            ("Room 1", "room", 1, 1),
        ],
    ),
    (
        "Ring Road Annex",
        "48 Ring Road Central",
        [
            ("Studio A", "studio", 0, 1),
            ("Studio B", "studio", 0, 1),
        ],
    ),
]


class Command(BaseCommand):
    help = "Create demo accounts for local development (phone-and-code sign-in)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Run even when DEBUG is off. You almost certainly do not want this.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError(
                "seed_demo refuses to run with DEBUG off. These accounts are "
                "published in the repository and anybody could sign in as them. "
                "Pass --force only if you are certain this is a throwaway "
                "environment."
            )

        rows = []
        for phone, first, last, account_type, roles, provider in DEMO_ACCOUNTS:
            user, created = User.objects.get_or_create(
                phone=phone,
                defaults={
                    "first_name": first,
                    "last_name": last,
                    "account_type": account_type,
                },
            )

            # Repair rather than skip: an existing row may have drifted since it
            # was seeded, and "already there" is not the same as "usable".
            user.first_name = first
            user.last_name = last
            user.account_type = account_type
            user.is_active = True
            # Reset every run. A demo account whose password has drifted is
            # indistinguishable, from the sign-in screen, from one that was
            # never seeded.
            user.set_password(DEMO_PASSWORD)
            if not user.is_phone_verified:
                user.mark_phone_verified()
            user.save(
                update_fields=[
                    "first_name",
                    "last_name",
                    "account_type",
                    "is_active",
                    "password",
                    "updated_at",
                ]
            )

            for index, role in enumerate(roles):
                assignment, _ = UserRole.objects.get_or_create(
                    user=user,
                    role=role,
                    defaults={"is_primary": index == 0},
                )
                # A revoked assignment still matches `get_or_create`, and
                # `has_role` ignores it — which is how a re-seeded account can
                # look correct in the table and still be refused at the door.
                if assignment.revoked_at is not None:
                    assignment.revoked_at = None
                    assignment.save(update_fields=["revoked_at"])

            if provider:
                self._approve_provider(user)

            rows.append((phone, user.display_name, account_type, ", ".join(roles), created))

        portfolio = self._seed_portfolio()
        self._report(rows, portfolio)

    def _seed_portfolio(self) -> list[str]:
        """Give the provider something to manage.

        A provider account with an approved verification and no property lands
        on an empty dashboard, which demos the empty state and nothing else.
        This builds the smallest graph that makes the Properties, Units and Home
        screens show real rows.

        Built through `apps.property.services` rather than by writing model rows
        directly. The services own the invariants — the personal organization,
        the billing slot check, the "creator is a claimant, not an owner" rule —
        and a seed that bypasses them produces a property the rest of the code
        does not believe in.
        """
        owner = User.objects.filter(phone="+233241000002").first()
        if owner is None:
            return ["provider account missing, skipped the portfolio"]

        locality = Locality.objects.filter(name="Adabraka").first() or Locality.objects.first()
        if locality is None:
            return ["no localities — run `seed_geo` first, skipped the portfolio"]

        notes = []
        for title, street, units in DEMO_PROPERTIES:
            existing = Property.objects.filter(created_by=owner, title=title).first()
            if existing is not None:
                notes.append(f"{title}: already present ({existing.units.count()} units)")
                continue

            house_number, _, street_name = street.partition(" ")
            address, _ = Address.objects.get_or_create(
                locality=locality,
                house_number=house_number,
                street=street_name,
            )
            try:
                prop = property_services.create_personal_property(
                    user=owner,
                    data={
                        "title": title,
                        # One of residential / commercial / hostel — the activity
                        # the personal organization is created around.
                        "property_type": "residential",
                        "address_id": str(address.id),
                    },
                )
            except PlanLimitReached as limit:
                # The default plan includes one property. That is a real product
                # rule and not something a seed should route around by handing
                # itself a bigger plan — so it stops at the limit and says so,
                # rather than failing the whole command and rolling back the
                # accounts along with it.
                notes.append(f"{title}: skipped — {limit}")
                continue
            # `enumerate` rather than a counter: the index at the point of a
            # break is exactly the number added before it, because the failing
            # unit is the one that raised.
            for added, (label, space_type, beds, baths) in enumerate(units):
                try:
                    property_services.add_unit(
                        prop=prop,
                        user=owner,
                        data={
                            "label": label,
                            "space_type": space_type,
                            "bedrooms": beds,
                            "bathrooms": baths,
                        },
                    )
                except PlanLimitReached as limit:
                    # Same rule as properties: the plan caps units, and the seed
                    # stops at the cap rather than helping itself to a larger
                    # plan or taking the accounts down with it.
                    notes.append(f"{title}: stopped at {added} units — {limit}")
                    break
            else:
                notes.append(f"{title}: created with {len(units)} units")

        return notes

    def _approve_provider(self, user) -> None:
        """Give the provider a current, approved provider verification.

        Without this the account reaches the provider journey and stops: the
        workspace opens on approval, so a seeded provider with no verification
        can see the verification screen and nothing else.

        Any earlier PROVIDER row is superseded rather than edited, which is the
        shape the rest of the trust code expects to read.
        """
        existing = Verification.objects.for_subject(SubjectType.USER, user.id).filter(
            kind=VerificationKind.PROVIDER
        )
        if existing.current().exists():
            return

        existing.exclude(status=VerificationStatus.SUPERSEDED).update(
            status=VerificationStatus.SUPERSEDED
        )
        Verification.objects.create(
            subject_type=SubjectType.USER,
            subject_id=str(user.id),
            kind=VerificationKind.PROVIDER,
            status=VerificationStatus.APPROVED,
            method=VerificationMethod.MANUAL_OVERRIDE,
            decided_at=timezone.now(),
            # No expiry: a demo account that stops working after ninety days is
            # a support question nobody will connect to this file.
            expires_at=None,
            decision_note="Seeded for local development by seed_demo.",
        )

    def _report(self, rows, portfolio: list[str]) -> None:
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Demo accounts"))
        self.stdout.write(f"  {'Phone':<14}{'Name':<20}{'Type':<10}{'Roles':<28}Status")
        for phone, name, account_type, roles, created in rows:
            state = "created" if created else "updated"
            self.stdout.write(f"  {phone:<14}{name:<20}{account_type:<10}{roles:<28}{state}")

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Portfolio for 0241000002"))
        for note in portfolio:
            self.stdout.write(f"  {note}")

        self.stdout.write("")
        self.stdout.write(f"  Password for all of them: {DEMO_PASSWORD}")
        self.stdout.write("")
        self.stdout.write("  Sign in at /sign-in with the number and that password.")
        self.stdout.write("  A one-time code will not work: /auth/verify refuses an OTP for a")
        self.stdout.write("  number that already has an account and asks for the password instead.")
        self.stdout.write("")
