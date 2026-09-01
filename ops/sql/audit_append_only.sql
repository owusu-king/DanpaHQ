-- Append-only protection for the audit log.
--
-- Rationale: the audit log is evidence. The application enforces append-only in
-- Python, but Python is not the only thing that can reach the database. These
-- rules make UPDATE and DELETE fail at the engine for the application role.
--
-- Applied by `python manage.py harden_database` after migrate, as the owner.
-- Superusers and the owner role bypass RLS, so backup, restore and lawful
-- redaction (a GDPR/Data Protection Act erasure order) remain possible through
-- an explicit, logged operational procedure rather than an application bug.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'audit_log') THEN

        ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
        ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS audit_log_insert ON audit_log;
        DROP POLICY IF EXISTS audit_log_select ON audit_log;

        CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (true);
        CREATE POLICY audit_log_select ON audit_log FOR SELECT USING (true);
        -- No UPDATE or DELETE policy exists, so both are denied by default.

        REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;

        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{{APP_ROLE}}') THEN
            GRANT SELECT, INSERT ON audit_log TO {{APP_ROLE}};
            REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM {{APP_ROLE}};
        END IF;

    END IF;
END
$$;

-- The outbox is not append-only (status transitions are the point), but a dead
-- letter should never be silently removed while an operator is investigating.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'outbox_event') THEN
        REVOKE TRUNCATE ON outbox_event FROM PUBLIC;
    END IF;
END
$$;
