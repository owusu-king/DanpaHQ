"""Fail closed if an owner or broadly privileged credential reaches a service."""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection


class Command(BaseCommand):
    help = "Verify runtime identity, restricted schema access and append-only audit grants."

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT current_user, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole "
                "FROM pg_roles WHERE rolname=current_user"
            )
            role, *privileged = cursor.fetchone()
            if role != settings.DATABASE_RUNTIME_ROLE or any(privileged):
                raise CommandError("Use the configured non-owner runtime database role.")
            cursor.execute(
                "SELECT (has_schema_privilege(current_user, 'public', 'CREATE') OR "
                "has_database_privilege(current_user, current_database(), 'CREATE')), "
                "has_table_privilege(current_user, 'audit_log', 'UPDATE,DELETE,TRUNCATE'), "
                "has_table_privilege(current_user, 'audit_log', 'SELECT'), "
                "has_table_privilege(current_user, 'audit_log', 'INSERT')"
            )
            create, mutate_audit, read_audit, append_audit = cursor.fetchone()
            cursor.execute(
                "SELECT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r "
                "ON r.oid=m.member WHERE r.rolname=current_user), "
                "EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) "
                "AND n.nspname='public')"
            )
            membership, owns_objects = cursor.fetchone()
            if (create or mutate_audit or membership or owns_objects
                    or not (read_audit and append_audit)):
                raise CommandError("Runtime grants are unsafe; rerun owner provisioning.")
            cursor.execute(
                "SELECT has_table_privilege(current_user, 'public.django_migrations', 'SELECT'), "
                "(has_table_privilege(current_user, 'public.django_migrations', "
                "'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR "
                "has_any_column_privilege(current_user, 'public.django_migrations', "
                "'INSERT,UPDATE,REFERENCES'))"
            )
            read_history, modify_history = cursor.fetchone()
            if not read_history or modify_history:
                raise CommandError(
                    "Runtime migration history must be SELECT-only; rerun owner provisioning."
                )
        self.stdout.write(self.style.SUCCESS("Runtime database privileges verified."))
