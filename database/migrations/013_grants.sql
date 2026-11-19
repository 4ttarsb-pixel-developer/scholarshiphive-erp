-- 013 — least-privilege runtime grants for the application role (mea_app).
-- The app role gets only DML on the marketing schema; it never owns objects and
-- is never the migration owner or the postgres superuser.
-- Guarded so local setups that reuse a single role still apply cleanly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mea_app') THEN
    GRANT USAGE ON SCHEMA marketing TO mea_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA marketing TO mea_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA marketing TO mea_app;
    -- Future tables/sequences created by the owner are granted automatically.
    ALTER DEFAULT PRIVILEGES IN SCHEMA marketing
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mea_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA marketing
      GRANT USAGE, SELECT ON SEQUENCES TO mea_app;
  END IF;
END $$;
