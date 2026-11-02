"""Owner-only release step; serving processes never need these credentials."""

import os
import re

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from psycopg import sql


class Command(BaseCommand):
    help = "Provision a least-privilege runtime role, then protect the audit log."

    def handle(self, *args, **options):
        role = settings.DATABASE_RUNTIME_ROLE
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", role):
            raise CommandError("DATABASE_RUNTIME_ROLE must be a simple PostgreSQL identifier.")
        # Only the one-off owner environment supplies this. Never accept a
        # password on the command line or print it in command output.
        password = os.environ.pop("DATABASE_RUNTIME_PASSWORD", "")
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("SELECT current_user, current_schema(), current_database()")
            owner, schema, database = cursor.fetchone()
            if role == owner or schema != "public":
                raise CommandError("Use a separate owner credential and the public schema.")
            cursor.execute(
                "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole "
                "FROM pg_roles WHERE rolname = %s", [role],
            )
            existing = cursor.fetchone()
            if existing and any(existing):
                raise CommandError("The runtime role has privileged role attributes; refusing it.")
            cursor.execute(
                "SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member "
                "WHERE r.rolname=%s", [role],
            )
            if cursor.fetchone():
                raise CommandError("Remove runtime role memberships before provisioning.")
            cursor.execute(
                "SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner "
                "JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE r.rolname=%s AND n.nspname='public' LIMIT 1", [role],
            )
            if cursor.fetchone():
                raise CommandError("The runtime role must not own application objects.")
            if not existing:
                if not password:
                    raise CommandError("Set DATABASE_RUNTIME_PASSWORD when creating the role.")
                cursor.execute(sql.SQL(
                    "CREATE ROLE {} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE"
                ).format(sql.Identifier(role)))
            if password:
                cursor.execute(sql.SQL("ALTER ROLE {} PASSWORD {}").format(
                    sql.Identifier(role), sql.Literal(password),
                ))
            cursor.execute(sql.SQL("REVOKE CREATE ON SCHEMA public FROM PUBLIC"))
            cursor.execute(sql.SQL("REVOKE CREATE ON DATABASE {} FROM PUBLIC, {}").format(
                sql.Identifier(database), sql.Identifier(role),
            ))
            cursor.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                sql.Identifier(database), sql.Identifier(role),
            ))
            cursor.execute(sql.SQL("REVOKE ALL ON SCHEMA public FROM {}").format(
                sql.Identifier(role),
            ))
            cursor.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(
                sql.Identifier(role),
            ))
            tables = set(connection.introspection.django_table_names(only_existing=True))
            tables.add("django_migrations")
            for table in sorted(tables):
                privileges = (
                    "SELECT" if table == "django_migrations"
                    else "SELECT, INSERT, UPDATE, DELETE"
                )
                cursor.execute(sql.SQL("GRANT {} ON TABLE {} TO {}").format(
                    sql.SQL(privileges), sql.Identifier("public", table), sql.Identifier(role),
                ))
                self._allow_runtime_rows(cursor, table, role)
                for sequence in connection.introspection.get_sequences(cursor, table):
                    cursor.execute(sql.SQL("GRANT USAGE, SELECT ON SEQUENCE {} TO {}").format(
                        sql.Identifier("public", sequence["name"]), sql.Identifier(role),
                    ))
            # Future migrations can add tables/sequences; hardening is reapplied
            # after every migration, so audit permissions remain narrower.
            for objects, privileges in [
                ("TABLES", "SELECT, INSERT, UPDATE, DELETE"), ("SEQUENCES", "USAGE, SELECT"),
            ]:
                cursor.execute(sql.SQL(
                    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT {} ON {} TO {}"
                ).format(sql.SQL(privileges), sql.SQL(objects), sql.Identifier(role)))
            self._restrict_migration_history(cursor, role)
            call_command("harden_database", app_role=role, stdout=self.stdout)
        self.stdout.write(self.style.SUCCESS(f"Runtime grants configured for {role}."))

    def _allow_runtime_rows(self, cursor, table, role):
        # Supabase may enable RLS without policies. Grants alone then expose no
        # rows to Django's non-owner connection. Only fill that empty-policy gap;
        # preserve custom policies and the separately hardened audit boundary.
        if table == "audit_log":
            return
        cursor.execute(
            "SELECT c.relrowsecurity, EXISTS(SELECT 1 FROM pg_policy p "
            "WHERE p.polrelid=c.oid) FROM pg_class c "
            "JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='public' AND c.relname=%s", [table],
        )
        enabled, has_policies = cursor.fetchone()
        if not enabled or has_policies:
            return
        command = "SELECT" if table == "django_migrations" else "ALL"
        cursor.execute(sql.SQL(
            "CREATE POLICY danpahq_runtime_access ON {} FOR {} TO {} USING (true){}"
        ).format(
            sql.Identifier("public", table), sql.SQL(command), sql.Identifier(role),
            sql.SQL("" if command == "SELECT" else " WITH CHECK (true)"),
        ))


    def _restrict_migration_history(self, cursor, role):
        # Table revokes do not remove column grants. PUBLIC grants also apply
        # to NOINHERIT roles, so remove both paths on this table only.
        cursor.execute(sql.SQL(
            "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER "
            "ON TABLE public.django_migrations FROM PUBLIC, {}"
        ).format(sql.Identifier(role)))
        cursor.execute(
            "SELECT attname FROM pg_attribute "
            "WHERE attrelid='public.django_migrations'::regclass "
            "AND attnum > 0 AND NOT attisdropped ORDER BY attnum"
        )
        columns = sql.SQL(", ").join(sql.Identifier(row[0]) for row in cursor.fetchall())
        cursor.execute(sql.SQL(
            "REVOKE INSERT ({columns}), UPDATE ({columns}), REFERENCES ({columns}) "
            "ON TABLE public.django_migrations FROM PUBLIC, {role}"
        ).format(columns=columns, role=sql.Identifier(role)))
        cursor.execute(
            "SELECT has_table_privilege(%s, 'public.django_migrations', "
            "'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR "
            "has_any_column_privilege(%s, 'public.django_migrations', "
            "'INSERT,UPDATE,REFERENCES')", [role, role],
        )
        if cursor.fetchone()[0]:
            raise CommandError(
                "Migration history remains writable; remove inherited or external grants."
            )
