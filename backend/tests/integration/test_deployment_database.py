"""Real PostgreSQL role/lock boundaries, exercised only in pytest's database."""

from contextlib import contextmanager
from io import StringIO

import psycopg
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError, connection, transaction
from psycopg import sql

from apps.core.management.commands.run_scheduler import SCHEDULER_LOCK, acquire

pytestmark = pytest.mark.django_db
ROLE = "danpahq_test_runtime"


def provision(settings, monkeypatch):
    settings.DATABASE_RUNTIME_ROLE = ROLE
    monkeypatch.setenv("DATABASE_RUNTIME_PASSWORD", "test-only-runtime-password")
    call_command("provision_runtime_database", stdout=StringIO())


def test_runtime_role_can_read_but_cannot_change_audit_or_create_tables(settings, monkeypatch):
    provision(settings, monkeypatch)
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(ROLE)))
    try:
        call_command("check_runtime_database", stdout=StringIO())
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM audit_log")
        for statement in ["DELETE FROM audit_log WHERE false", "TRUNCATE audit_log",
                          "CREATE TABLE deployment_unwanted(id integer)",
                          "CREATE SCHEMA deployment_unwanted"]:
            with pytest.raises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(statement)
    finally:
        with connection.cursor() as cursor:
            cursor.execute("RESET ROLE")


def test_owner_cannot_start_a_runtime_service(settings):
    settings.DATABASE_RUNTIME_ROLE = ROLE
    with pytest.raises(CommandError, match="non-owner"):
        call_command("check_runtime_database")


def test_provisioning_cannot_turn_the_owner_into_the_runtime_role(settings, monkeypatch):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_user")
        settings.DATABASE_RUNTIME_ROLE = cursor.fetchone()[0]
    monkeypatch.setenv("DATABASE_RUNTIME_PASSWORD", "test-only-runtime-password")
    with pytest.raises(CommandError, match="separate owner"):
        call_command("provision_runtime_database")


def test_provisioning_reapplies_audit_restrictions(settings, monkeypatch):
    provision(settings, monkeypatch)
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL("GRANT UPDATE ON audit_log TO {}").format(sql.Identifier(ROLE)))
    call_command("provision_runtime_database", stdout=StringIO())
    with connection.cursor() as cursor:
        cursor.execute("SELECT has_table_privilege(%s, 'audit_log', 'UPDATE')", [ROLE])
        assert cursor.fetchone()[0] is False


def test_scheduler_deployment_overlap_has_only_one_active_owner():
    params = connection.get_connection_params()
    with (psycopg.connect(**params, autocommit=True) as first,
          psycopg.connect(**params, autocommit=True) as second):
        assert acquire(first) is True
        assert acquire(second) is False
        first.execute("SELECT pg_advisory_unlock(%s)", [SCHEDULER_LOCK])
        assert acquire(second) is True


LEDGER_MODIFICATIONS = ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")


def ledger_privileges():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT privilege, has_table_privilege(%s, 'public.django_migrations', privilege) "
            "FROM unnest(%s::text[]) AS permissions(privilege)",
            [ROLE, ["SELECT", *LEDGER_MODIFICATIONS]],
        )
        return dict(cursor.fetchall())


def assert_read_only_ledger():
    assert ledger_privileges() == {
        "SELECT": True, **dict.fromkeys(LEDGER_MODIFICATIONS, False),
    }
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT has_any_column_privilege(%s, 'public.django_migrations', "
            "'INSERT,UPDATE,REFERENCES')", [ROLE],
        )
        assert cursor.fetchone()[0] is False


@contextmanager
def as_runtime():
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(ROLE)))
    try:
        yield
    finally:
        with connection.cursor() as cursor:
            cursor.execute("RESET ROLE")


def test_migration_history_is_read_only_for_runtime_but_owner_can_record(settings, monkeypatch):
    from django.db.migrations.recorder import MigrationRecorder

    provision(settings, monkeypatch)
    assert_read_only_ledger()
    with as_runtime():
        call_command("check_runtime_database", stdout=StringIO())
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM django_migrations")
            assert cursor.fetchone()[0] > 0
        statements = [
            "INSERT INTO django_migrations(app, name, applied) "
            "VALUES ('permission_probe', 'forbidden', now())",
            "UPDATE django_migrations SET name=name WHERE false",
            "DELETE FROM django_migrations WHERE false",
            "TRUNCATE django_migrations",
        ]
        for statement in statements:
            with (
                pytest.raises(DatabaseError) as denied,
                transaction.atomic(),
                connection.cursor() as cursor,
            ):
                cursor.execute(statement)
            assert denied.value.__cause__.sqlstate == "42501"

    recorder = MigrationRecorder(connection)
    recorder.record_applied("permission_probe", "owner_write")
    assert recorder.migration_qs.filter(app="permission_probe", name="owner_write").exists()
    assert recorder.migration_qs.filter(app="permission_probe").update(name="owner_updated") == 1
    recorder.record_unapplied("permission_probe", "owner_updated")
    assert not recorder.migration_qs.filter(app="permission_probe").exists()
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT has_table_privilege(%s, 'identity_user', 'SELECT') "
            "AND has_table_privilege(%s, 'identity_user', 'INSERT') "
            "AND has_table_privilege(%s, 'identity_user', 'UPDATE') "
            "AND has_table_privilege(%s, 'identity_user', 'DELETE')", [ROLE] * 4,
        )
        assert cursor.fetchone()[0] is True


@pytest.mark.parametrize("recipient", ["runtime", "public"])
def test_provisioning_repairs_table_and_column_ledger_grants(settings, monkeypatch, recipient):
    provision(settings, monkeypatch)
    grantee = sql.Identifier(ROLE) if recipient == "runtime" else sql.SQL("PUBLIC")
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL(
            "GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER "
            "ON TABLE public.django_migrations TO {}"
        ).format(grantee))
        cursor.execute(sql.SQL(
            "GRANT INSERT (app), UPDATE (name), REFERENCES (id) "
            "ON TABLE public.django_migrations TO {}"
        ).format(grantee))
    assert all(ledger_privileges().values())
    for _ in range(2):
        provision(settings, monkeypatch)
        assert_read_only_ledger()


@pytest.mark.parametrize("recipient,column", [
    ("runtime", False), ("public", False), ("runtime", True), ("public", True),
])
def test_runtime_check_rejects_effective_ledger_writes(
    settings, monkeypatch, recipient, column,
):
    provision(settings, monkeypatch)
    grantee = sql.Identifier(ROLE) if recipient == "runtime" else sql.SQL("PUBLIC")
    privilege = sql.SQL("UPDATE (name)" if column else "UPDATE")
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL("GRANT {} ON TABLE public.django_migrations TO {}").format(
            privilege, grantee,
        ))
    with as_runtime(), pytest.raises(CommandError, match="SELECT-only"):
        call_command("check_runtime_database", stdout=StringIO())


def test_switchable_ledger_writer_membership_is_rejected(settings, monkeypatch):
    provision(settings, monkeypatch)
    group = "danpahq_test_ledger_writer"
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(group)))
        cursor.execute(sql.SQL(
            "GRANT UPDATE ON TABLE public.django_migrations TO {}"
        ).format(sql.Identifier(group)))
        cursor.execute(sql.SQL("GRANT {} TO {}").format(
            sql.Identifier(group), sql.Identifier(ROLE),
        ))
        cursor.execute("SELECT pg_has_role(%s, %s, 'MEMBER')", [ROLE, group])
        assert cursor.fetchone()[0] is True
    with pytest.raises(CommandError, match="memberships"):
        provision(settings, monkeypatch)
    with as_runtime(), pytest.raises(CommandError, match="unsafe"):
        call_command("check_runtime_database", stdout=StringIO())
