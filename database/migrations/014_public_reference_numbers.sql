-- 014 — Stable, human-readable sequence numbers; UUIDs remain internal primary keys.
-- Safe for existing data. Never renumber assigned references.
SET search_path TO marketing, public;
ALTER TABLE marketing.users ADD COLUMN IF NOT EXISTS display_number BIGINT;
CREATE SEQUENCE IF NOT EXISTS marketing.users_reference_seq;
ALTER SEQUENCE marketing.users_reference_seq OWNED BY marketing.users.display_number;
ALTER TABLE marketing.users ALTER COLUMN display_number SET DEFAULT nextval('marketing.users_reference_seq'::regclass);
UPDATE marketing.users SET display_number=nextval('marketing.users_reference_seq'::regclass) WHERE display_number IS NULL;
SELECT setval('marketing.users_reference_seq'::regclass, GREATEST(COALESCE((SELECT max(display_number) FROM marketing.users),0),1), true);
ALTER TABLE marketing.users ALTER COLUMN display_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_display_number_unique ON marketing.users(display_number);
ALTER TABLE marketing.ad_accounts ADD COLUMN IF NOT EXISTS display_number BIGINT;
CREATE SEQUENCE IF NOT EXISTS marketing.ad_accounts_reference_seq;
ALTER SEQUENCE marketing.ad_accounts_reference_seq OWNED BY marketing.ad_accounts.display_number;
ALTER TABLE marketing.ad_accounts ALTER COLUMN display_number SET DEFAULT nextval('marketing.ad_accounts_reference_seq'::regclass);
UPDATE marketing.ad_accounts SET display_number=nextval('marketing.ad_accounts_reference_seq'::regclass) WHERE display_number IS NULL;
SELECT setval('marketing.ad_accounts_reference_seq'::regclass, GREATEST(COALESCE((SELECT max(display_number) FROM marketing.ad_accounts),0),1), true);
ALTER TABLE marketing.ad_accounts ALTER COLUMN display_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ad_accounts_display_number_unique ON marketing.ad_accounts(display_number);
ALTER TABLE marketing.expenses ADD COLUMN IF NOT EXISTS display_number BIGINT;
CREATE SEQUENCE IF NOT EXISTS marketing.expenses_reference_seq;
ALTER SEQUENCE marketing.expenses_reference_seq OWNED BY marketing.expenses.display_number;
ALTER TABLE marketing.expenses ALTER COLUMN display_number SET DEFAULT nextval('marketing.expenses_reference_seq'::regclass);
UPDATE marketing.expenses SET display_number=nextval('marketing.expenses_reference_seq'::regclass) WHERE display_number IS NULL;
SELECT setval('marketing.expenses_reference_seq'::regclass, GREATEST(COALESCE((SELECT max(display_number) FROM marketing.expenses),0),1), true);
ALTER TABLE marketing.expenses ALTER COLUMN display_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_display_number_unique ON marketing.expenses(display_number);
ALTER TABLE marketing.monthly_budgets ADD COLUMN IF NOT EXISTS display_number BIGINT;
CREATE SEQUENCE IF NOT EXISTS marketing.monthly_budgets_reference_seq;
ALTER SEQUENCE marketing.monthly_budgets_reference_seq OWNED BY marketing.monthly_budgets.display_number;
ALTER TABLE marketing.monthly_budgets ALTER COLUMN display_number SET DEFAULT nextval('marketing.monthly_budgets_reference_seq'::regclass);
UPDATE marketing.monthly_budgets SET display_number=nextval('marketing.monthly_budgets_reference_seq'::regclass) WHERE display_number IS NULL;
SELECT setval('marketing.monthly_budgets_reference_seq'::regclass, GREATEST(COALESCE((SELECT max(display_number) FROM marketing.monthly_budgets),0),1), true);
ALTER TABLE marketing.monthly_budgets ALTER COLUMN display_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS monthly_budgets_display_number_unique ON marketing.monthly_budgets(display_number);
ALTER TABLE marketing.employee_allocations ADD COLUMN IF NOT EXISTS display_number BIGINT;
CREATE SEQUENCE IF NOT EXISTS marketing.employee_allocations_reference_seq;
ALTER SEQUENCE marketing.employee_allocations_reference_seq OWNED BY marketing.employee_allocations.display_number;
ALTER TABLE marketing.employee_allocations ALTER COLUMN display_number SET DEFAULT nextval('marketing.employee_allocations_reference_seq'::regclass);
UPDATE marketing.employee_allocations SET display_number=nextval('marketing.employee_allocations_reference_seq'::regclass) WHERE display_number IS NULL;
SELECT setval('marketing.employee_allocations_reference_seq'::regclass, GREATEST(COALESCE((SELECT max(display_number) FROM marketing.employee_allocations),0),1), true);
ALTER TABLE marketing.employee_allocations ALTER COLUMN display_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employee_allocations_display_number_unique ON marketing.employee_allocations(display_number);
ALTER TABLE marketing.counsellor_refs ADD COLUMN IF NOT EXISTS display_number BIGINT;
CREATE SEQUENCE IF NOT EXISTS marketing.counsellor_refs_reference_seq;
ALTER SEQUENCE marketing.counsellor_refs_reference_seq OWNED BY marketing.counsellor_refs.display_number;
ALTER TABLE marketing.counsellor_refs ALTER COLUMN display_number SET DEFAULT nextval('marketing.counsellor_refs_reference_seq'::regclass);
UPDATE marketing.counsellor_refs SET display_number=nextval('marketing.counsellor_refs_reference_seq'::regclass) WHERE display_number IS NULL;
SELECT setval('marketing.counsellor_refs_reference_seq'::regclass, GREATEST(COALESCE((SELECT max(display_number) FROM marketing.counsellor_refs),0),1), true);
ALTER TABLE marketing.counsellor_refs ALTER COLUMN display_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS counsellor_refs_display_number_unique ON marketing.counsellor_refs(display_number);
-- Runtime-role grants only when the optional least-privilege role exists (same guard as 013).
-- Railway / Neon single-role setups do not have mea_app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mea_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE marketing.users_reference_seq TO mea_app;
    GRANT USAGE, SELECT ON SEQUENCE marketing.ad_accounts_reference_seq TO mea_app;
    GRANT USAGE, SELECT ON SEQUENCE marketing.expenses_reference_seq TO mea_app;
    GRANT USAGE, SELECT ON SEQUENCE marketing.monthly_budgets_reference_seq TO mea_app;
    GRANT USAGE, SELECT ON SEQUENCE marketing.employee_allocations_reference_seq TO mea_app;
    GRANT USAGE, SELECT ON SEQUENCE marketing.counsellor_refs_reference_seq TO mea_app;
  END IF;
END $$;
