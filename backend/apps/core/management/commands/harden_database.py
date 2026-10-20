"""Apply database-level protections that migrations cannot express.

Run after ``migrate``, as a database owner. These are defence in depth: the
application already refuses to update or delete audit rows, and this makes the
database refuse too, so a bug, a shell session or a compromised app credential
cannot quietly rewrite history.
"""

from __future__ import annotations

import re
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

SQL_DIR = Path(settings.BASE_DIR) / "apps" / "core" / "sql"


class Command(BaseCommand):
    help = "Apply append-only rules and least-privilege grants."

    def add_arguments(self, parser):
        parser.add_argument(
            "--app-role", default="grp_app", help="Database role the application connects as."
        )

    def handle(self, *args, **options):
        sql_path = SQL_DIR / "audit_append_only.sql"
        if not sql_path.exists():
            raise CommandError(f"Missing database hardening SQL: {sql_path}")

        app_role = options["app_role"]
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", app_role):
            raise CommandError("--app-role must be a simple PostgreSQL role identifier")
        statements = sql_path.read_text().replace("{{APP_ROLE}}", app_role)
        with connection.cursor() as cursor:
            cursor.execute(statements)
        self.stdout.write(self.style.SUCCESS("Database hardening applied."))

        self._report_effectiveness(app_role)

    def _report_effectiveness(self, app_role: str) -> None:
        """Say plainly whether the rules just applied actually bite.

        Row-level security is bypassed by superusers and by roles with
        BYPASSRLS. The default local setup connects as the database owner,
        which is a superuser, so the rules apply to a role that ignores them.
        Reporting success without saying so would be exactly the false
        assurance this project is meant not to give.
        """
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT current_user, rolsuper, rolbypassrls "
                "FROM pg_roles WHERE rolname = current_user"
            )
            current, is_super, bypasses = cursor.fetchone()
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [app_role])
            role_exists = cursor.fetchone() is not None

        if is_super or bypasses:
            self.stdout.write(
                self.style.WARNING(
                    f"  Not enforced for this connection: {current} "
                    f"{'is a superuser' if is_super else 'has BYPASSRLS'}, so it ignores "
                    "row-level security. The append-only rules are in place but this "
                    "role can still UPDATE and DELETE audit rows.\n"
                    f"  To enforce them, connect the application as a separate "
                    f"least-privilege role ({app_role}) and keep the owner for "
                    "migrations only. See docs/security.md."
                )
            )
        if not role_exists:
            self.stdout.write(
                self.style.WARNING(f"  Role {app_role} does not exist, so its grants were skipped.")
            )
