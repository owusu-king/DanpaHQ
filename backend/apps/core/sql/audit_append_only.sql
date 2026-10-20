-- Append-only protection for the audit log. Applied by harden_database.
-- The application must connect with a separate, non-BYPASSRLS role for this
-- to protect against a compromised application credential.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'audit_log') THEN
        ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
        ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS audit_log_insert ON audit_log;
        DROP POLICY IF EXISTS audit_log_select ON audit_log;

        CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (true);
        CREATE POLICY audit_log_select ON audit_log FOR SELECT USING (true);

        REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;

        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{{APP_ROLE}}') THEN
            GRANT SELECT, INSERT ON audit_log TO {{APP_ROLE}};
            REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM {{APP_ROLE}};
        END IF;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'outbox_event') THEN
        REVOKE TRUNCATE ON outbox_event FROM PUBLIC;
    END IF;
END
$$;
