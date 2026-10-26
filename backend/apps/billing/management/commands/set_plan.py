"""Put a Portfolio on a plan from the command line.

There is no billing screen in the management console yet — admin billing
controls are a later phase — and testing the paid experience before then needs
some way to say "this Portfolio is on Business". This is that way.

It goes through `subscription_service.change_plan` rather than writing the row,
which is the whole point: an administrative grant leaves the same `BillingEvent`
and audit record as any other plan change. A plan that moved with no trace is
exactly what the audit trail exists to prevent, and a test grant is still a
grant.

    python manage.py set_plan --list
    python manage.py set_plan --portfolio "Osu Properties" --plan BUSINESS
    python manage.py set_plan --phone +233201234567 --plan PRO
    python manage.py set_plan --portfolio <uuid> --plan FREE
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from apps.billing.models import LIVE_STATUSES, Plan, Subscription
from apps.billing.services import subscription_service, usage_service


class Command(BaseCommand):
    help = "Show or change the plan a Portfolio is on. Development and support use."

    def add_arguments(self, parser):
        parser.add_argument(
            "--portfolio",
            help="Portfolio id, or an unambiguous part of its name.",
        )
        parser.add_argument(
            "--phone",
            help="Act on the Portfolios this person is a live member of.",
        )
        parser.add_argument(
            "--plan",
            help="FREE, PRO or BUSINESS. Omit to only show the current state.",
        )
        parser.add_argument(
            "--list",
            action="store_true",
            help="List every Portfolio with its plan and usage.",
        )
        parser.add_argument(
            "--reason",
            default="Set from the command line",
            help="Recorded on the billing event and the audit log.",
        )

    def handle(self, *args, **options):
        from apps.organization.models import Organization

        if options["list"]:
            self._show(Organization.objects.filter(is_active=True))
            return

        organizations = self._resolve(options)
        if not organizations:
            raise CommandError("No Portfolio matched. Run with --list to see what exists.")

        plan_code = options["plan"]
        if not plan_code:
            self._show(organizations)
            return

        plan_code = plan_code.upper()
        # Checked here so the error names the three plans instead of surfacing
        # `change_plan`'s customer-facing wording to an operator.
        known = set(Plan.objects.values_list("code", flat=True))
        if plan_code not in known:
            raise CommandError(
                f"Unknown plan {plan_code!r}. Choose one of: {', '.join(sorted(known))}."
            )

        for organization in organizations:
            before = _current_code(organization)
            subscription_service.change_plan(
                organization=organization,
                plan_code=plan_code,
                # No actor: nobody signed in ran this. The reason and the audit
                # record carry what happened, and inventing a user would put a
                # name against an act they did not perform.
                actor=None,
                reason=options["reason"],
            )
            self.stdout.write(self.style.SUCCESS(f"{organization.name}: {before} -> {plan_code}"))

    def _resolve(self, options):
        from apps.organization.models import Organization, OrganizationMembership

        if options["phone"]:
            from apps.core.phone import PhoneNumberError, normalise_ghana_msisdn
            from apps.identity.models import User

            try:
                phone = normalise_ghana_msisdn(options["phone"])
            except PhoneNumberError as error:
                raise CommandError(str(error)) from error
            user = User.objects.filter(phone_number=phone).first()
            if user is None:
                raise CommandError(f"No account with phone {phone}.")
            ids = OrganizationMembership.objects.filter(
                user=user, ended_at__isnull=True
            ).values_list("organization_id", flat=True)
            return list(Organization.objects.filter(id__in=ids))

        term = options["portfolio"]
        if not term:
            raise CommandError("Give --portfolio, --phone or --list.")

        query = Q(name__icontains=term)
        if _looks_like_uuid(term):
            query = query | Q(id=term)
        return list(Organization.objects.filter(query, is_active=True))

    def _show(self, organizations):
        rows = list(organizations)
        if not rows:
            self.stdout.write("No Portfolios.")
            return
        for organization in rows:
            usage = usage_service.snapshot(organization=organization)
            counts = ", ".join(f"{key} {value}" for key, value in sorted(usage.items()))
            self.stdout.write(
                f"{_current_code(organization):<9} {organization.name}  "
                f"[{organization.id}]  {counts}"
            )


def _current_code(organization) -> str:
    subscription = (
        Subscription.objects.filter(
            billing_account__organization=organization, status__in=LIVE_STATUSES
        )
        .select_related("plan")
        .first()
    )
    return subscription.plan.code if subscription else "none"


def _looks_like_uuid(value: str) -> bool:
    import uuid

    try:
        uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return False
    return True
