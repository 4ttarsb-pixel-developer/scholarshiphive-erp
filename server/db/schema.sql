-- ScholarshipHive ERP — fresh database schema (PostgreSQL 13+)
-- Safe to run more than once: every statement is idempotent.
-- No dummy / seed data is inserted. The first person to complete /setup becomes Super Admin.


-- ───────────── Core: users, sessions, permissions ─────────────
CREATE SEQUENCE IF NOT EXISTS employee_code_seq START 1;

CREATE TABLE IF NOT EXISTS users (
  id                BIGSERIAL PRIMARY KEY,
  employee_code     VARCHAR(20) NOT NULL UNIQUE,
  role              VARCHAR(20) NOT NULL DEFAULT 'employee' CHECK (role IN ('super_admin','admin','employee')),
  status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','blocked')),
  full_name         VARCHAR(120) NOT NULL,
  father_name       VARCHAR(120),
  cnic              VARCHAR(15) UNIQUE,
  phone1            VARCHAR(20),
  phone2            VARCHAR(20),
  address           TEXT,
  permanent_address TEXT,
  email             VARCHAR(255) NOT NULL UNIQUE,
  google_sub        VARCHAR(64) UNIQUE,
  google_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash     TEXT NOT NULL,
  photo_file_id     BIGINT,
  cv_file_id        BIGINT,
  education         JSONB NOT NULL DEFAULT '[]'::jsonb,
  family_background TEXT,
  last_job_reason   TEXT,
  about             TEXT,
  designation       VARCHAR(120),
  theme             VARCHAR(10) NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark')),
  font_size         VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (font_size IN ('small','normal','large','xlarge')),
  reject_reason     TEXT,
  approved_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Only one Super Admin can ever exist.
CREATE UNIQUE INDEX IF NOT EXISTS one_super_admin ON users ((role)) WHERE role = 'super_admin';
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    CHAR(64) PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip            VARCHAR(64),
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- module permissions: view = read only, edit = read + write
CREATE TABLE IF NOT EXISTS permissions (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module     VARCHAR(40) NOT NULL,
  level      VARCHAR(10) NOT NULL CHECK (level IN ('view','edit')),
  granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, module)
);

CREATE TABLE IF NOT EXISTS files (
  id            BIGSERIAL PRIMARY KEY,
  owner_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind          VARCHAR(30) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(255) NOT NULL UNIQUE,
  mime          VARCHAR(100) NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        CHAR(64) NOT NULL,
  duplicate_of  BIGINT REFERENCES files(id) ON DELETE SET NULL,
  verify_status VARCHAR(12) NOT NULL DEFAULT 'unverified' CHECK (verify_status IN ('unverified','verified','rejected')),
  verify_note   TEXT,
  verified_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data          BYTEA
);
-- File contents live in the database (Vercel has no permanent disk).
ALTER TABLE files ADD COLUMN IF NOT EXISTS data BYTEA;
CREATE INDEX IF NOT EXISTS idx_files_sha ON files(sha256);

CREATE TABLE IF NOT EXISTS user_documents (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id  BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  label    VARCHAR(120) NOT NULL DEFAULT 'Document'
);

CREATE TABLE IF NOT EXISTS user_requests (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(20) NOT NULL DEFAULT 'access' CHECK (type IN ('access','profile','other')),
  module      VARCHAR(40),
  level       VARCHAR(10),
  message     TEXT NOT NULL DEFAULT '',
  status      VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','declined')),
  response    TEXT,
  handled_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  handled_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ───────────── Revenue ─────────────
CREATE TABLE IF NOT EXISTS customers (
  id         BIGSERIAL PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  phone      VARCHAR(20),
  email      VARCHAR(255),
  country    VARCHAR(80) NOT NULL DEFAULT 'Pakistan',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(lower(name));

CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
CREATE TABLE IF NOT EXISTS sales (
  id           BIGSERIAL PRIMARY KEY,
  invoice_no   VARCHAR(20) NOT NULL UNIQUE,
  customer_id  BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  employee_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  package      VARCHAR(80) NOT NULL,
  destination  VARCHAR(80),
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
  sale_date    DATE NOT NULL,
  due_date     DATE,
  notes        TEXT NOT NULL DEFAULT '',
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_employee ON sales(employee_id);

CREATE TABLE IF NOT EXISTS sale_payments (
  id           BIGSERIAL PRIMARY KEY,
  sale_id      BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method       VARCHAR(40) NOT NULL,
  payment_date DATE NOT NULL,
  reference    VARCHAR(120),
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_date ON sale_payments(payment_date);

CREATE TABLE IF NOT EXISTS sale_refunds (
  id          BIGSERIAL PRIMARY KEY,
  sale_id     BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  refund_date DATE NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refunds_date ON sale_refunds(refund_date);

-- ───────────── Salary / payroll ─────────────
CREATE TABLE IF NOT EXISTS salary_terms (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_month CHAR(7) NOT NULL CHECK (effective_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  base_salary     NUMERIC(14,2) NOT NULL CHECK (base_salary >= 0),
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  updated_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, effective_month)
);

CREATE SEQUENCE IF NOT EXISTS slip_seq START 1;
CREATE TABLE IF NOT EXISTS payroll_months (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month             CHAR(7) NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status            VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_process','approved','paid')),
  bonus             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (bonus >= 0),
  deductions        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  adjustment_note   TEXT NOT NULL DEFAULT '',
  commission_pct    NUMERIC(5,2),          -- month-specific override (NULL = use salary_terms)
  -- snapshot (filled at approval, never changes afterwards)
  snap_base         NUMERIC(14,2),
  snap_sales        NUMERIC(14,2),
  snap_commission_pct NUMERIC(5,2),
  snap_commission   NUMERIC(14,2),
  snap_net          NUMERIC(14,2),
  slip_no           VARCHAR(30) UNIQUE,
  approved_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  paid_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  paid_at           TIMESTAMPTZ,
  payment_method    VARCHAR(40),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month)
);

-- ───────────── Expenses & petty cash ─────────────
CREATE SEQUENCE IF NOT EXISTS expense_seq START 1;
CREATE TABLE IF NOT EXISTS expenses (
  id             BIGSERIAL PRIMARY KEY,
  ref_no         VARCHAR(20) NOT NULL UNIQUE,
  title          VARCHAR(160) NOT NULL,
  category       VARCHAR(60) NOT NULL,
  location       VARCHAR(120) NOT NULL DEFAULT '',
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  expense_date   DATE NOT NULL,
  paid_to        VARCHAR(160) NOT NULL DEFAULT '',
  payment_method VARCHAR(40) NOT NULL DEFAULT 'Cash',
  description    TEXT NOT NULL DEFAULT '',
  receipt_file_id BIGINT REFERENCES files(id) ON DELETE SET NULL,
  status         VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  is_petty_topup BOOLEAN NOT NULL DEFAULT FALSE,
  review_note    TEXT,
  reviewed_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  created_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

CREATE SEQUENCE IF NOT EXISTS petty_seq START 1;
CREATE TABLE IF NOT EXISTS petty_cash_entries (
  id              BIGSERIAL PRIMARY KEY,
  ref_no          VARCHAR(20) NOT NULL UNIQUE,
  title           VARCHAR(160) NOT NULL,
  category        VARCHAR(60) NOT NULL,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  entry_date      DATE NOT NULL,
  purchased_by    VARCHAR(160) NOT NULL,
  vendor          VARCHAR(160) NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  receipt_file_id BIGINT REFERENCES files(id) ON DELETE SET NULL,
  status          VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  review_note     TEXT,
  reviewed_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_petty_date ON petty_cash_entries(entry_date);

-- ───────────── Assets, liabilities, capital ─────────────
CREATE TABLE IF NOT EXISTS assets (
  id            BIGSERIAL PRIMARY KEY,
  name          VARCHAR(160) NOT NULL,
  category      VARCHAR(60) NOT NULL,
  asset_type    VARCHAR(20) NOT NULL DEFAULT 'fixed' CHECK (asset_type IN ('fixed','current','intangible')),
  purchase_date DATE NOT NULL,
  cost          NUMERIC(14,2) NOT NULL CHECK (cost >= 0),
  current_value NUMERIC(14,2) NOT NULL CHECK (current_value >= 0),
  location      VARCHAR(120) NOT NULL DEFAULT '',
  serial_no     VARCHAR(120) NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  status        VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disposed')),
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS liabilities (
  id            BIGSERIAL PRIMARY KEY,
  title         VARCHAR(160) NOT NULL,
  type          VARCHAR(20) NOT NULL CHECK (type IN ('loan','payable','other')),
  lender        VARCHAR(160) NOT NULL,
  principal     NUMERIC(14,2) NOT NULL CHECK (principal > 0),
  interest_type VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (interest_type IN ('none','simple','compound')),
  annual_rate   NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (annual_rate >= 0 AND annual_rate <= 100),
  compounding   VARCHAR(10) NOT NULL DEFAULT 'monthly' CHECK (compounding IN ('monthly','quarterly','yearly')),
  start_date    DATE NOT NULL,
  term_months   INTEGER NOT NULL DEFAULT 12 CHECK (term_months BETWEEN 1 AND 600),
  notes         TEXT NOT NULL DEFAULT '',
  status        VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS liability_payments (
  id           BIGSERIAL PRIMARY KEY,
  liability_id BIGINT NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  method       VARCHAR(40) NOT NULL DEFAULT 'Bank Transfer',
  note         TEXT NOT NULL DEFAULT '',
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capital_entries (
  id          BIGSERIAL PRIMARY KEY,
  type        VARCHAR(12) NOT NULL CHECK (type IN ('investment','drawing')),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  entry_date  DATE NOT NULL,
  party       VARCHAR(160) NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ───────────── Announcements ─────────────
CREATE TABLE IF NOT EXISTS announcements (
  id         BIGSERIAL PRIMARY KEY,
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL,
  link_url   TEXT,
  link_label VARCHAR(120),
  pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS announcement_replies (
  id              BIGSERIAL PRIMARY KEY,
  announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

-- ───────────── System ─────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(60) PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_log (
  id         BIGSERIAL PRIMARY KEY,
  to_email   VARCHAR(255) NOT NULL,
  subject    VARCHAR(255) NOT NULL,
  status     VARCHAR(12) NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  user_name  VARCHAR(120),
  action     VARCHAR(80) NOT NULL,
  entity     VARCHAR(60),
  entity_id  VARCHAR(60),
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);


-- ════════════════════════════════════════════════════════════════════════════
--  v2 (Oct 2026) — Expenses & Petty Cash module
--  • hierarchical categories (type → category → expense item, plus "Other")
--  • constant (recurring monthly / quarterly / yearly) and variable expenses
--  • monthly cycles generated from recurring templates, with approvals
--  • optimistic locking (version), audit IP, indexes for server-side paging
--  Everything below is idempotent and keeps all existing data.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS expense_categories (
  id           BIGSERIAL PRIMARY KEY,
  scope        VARCHAR(10) NOT NULL CHECK (scope IN ('constant','variable','petty')),
  parent_id    BIGINT REFERENCES expense_categories(id) ON DELETE CASCADE,
  name         VARCHAR(120) NOT NULL CHECK (length(btrim(name)) >= 2),
  description  VARCHAR(300) NOT NULL DEFAULT '',
  allow_custom BOOLEAN NOT NULL DEFAULT FALSE,      -- "Others": the user types the expense name
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,      -- shipped with the ERP (can be disabled, not deleted)
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_cat_name ON expense_categories (scope, COALESCE(parent_id, 0), lower(name));
CREATE INDEX IF NOT EXISTS idx_expense_cat_parent ON expense_categories(parent_id);

-- A sub-category must sit under a top-level category of the same type (only two levels).
CREATE OR REPLACE FUNCTION expense_cat_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM expense_categories p WHERE p.id = NEW.parent_id AND p.parent_id IS NULL AND p.scope = NEW.scope) THEN
    RAISE EXCEPTION 'Expense item must belong to a top-level category of the same type' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expense_cat_guard') THEN
    CREATE TRIGGER trg_expense_cat_guard BEFORE INSERT OR UPDATE ON expense_categories FOR EACH ROW EXECUTE FUNCTION expense_cat_guard();
  END IF;
END $$;

-- ── Constant (recurring) expense templates: entered once, a cycle is created every period ──
CREATE SEQUENCE IF NOT EXISTS recurring_seq START 1;
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id              BIGSERIAL PRIMARY KEY,
  ref_no          VARCHAR(20) NOT NULL UNIQUE,
  title           VARCHAR(160) NOT NULL,
  category_id     BIGINT NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  sub_category_id BIGINT REFERENCES expense_categories(id) ON DELETE SET NULL,
  category        VARCHAR(60) NOT NULL,              -- name snapshots (reports stay readable if a category is renamed)
  sub_category    VARCHAR(120) NOT NULL DEFAULT '',
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  frequency       VARCHAR(12) NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','quarterly','half_yearly','yearly')),
  billing_day     SMALLINT NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
  start_month     CHAR(7) NOT NULL CHECK (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  end_month       CHAR(7) CHECK (end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  paid_to         VARCHAR(160) NOT NULL DEFAULT '',
  payment_method  VARCHAR(40) NOT NULL DEFAULT 'Bank Transfer',
  location        VARCHAR(120) NOT NULL DEFAULT '',
  reference_no    VARCHAR(80) NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  auto_approve    BOOLEAN NOT NULL DEFAULT FALSE,     -- every new cycle is approved automatically
  status          VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  state           VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused','ended')),
  paused_from     CHAR(7),
  review_note     TEXT,
  reviewed_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_month IS NULL OR end_month >= start_month)
);
CREATE INDEX IF NOT EXISTS idx_recurring_status_state ON recurring_expenses(status, state);
CREATE INDEX IF NOT EXISTS idx_recurring_category ON recurring_expenses(category_id);

-- Future-cycle changes: skip one period or use a different amount for it.
CREATE TABLE IF NOT EXISTS recurring_overrides (
  recurring_id BIGINT NOT NULL REFERENCES recurring_expenses(id) ON DELETE CASCADE,
  cycle_month  CHAR(7) NOT NULL CHECK (cycle_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  action       VARCHAR(8) NOT NULL CHECK (action IN ('skip','amount')),
  amount       NUMERIC(14,2) CHECK (amount IS NULL OR amount > 0),
  note         VARCHAR(300) NOT NULL DEFAULT '',
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (recurring_id, cycle_month),
  CHECK (action <> 'amount' OR amount IS NOT NULL)
);

-- ── Expenses: constant cycles + variable (daily / ad-hoc) entries ──
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS expense_type      VARCHAR(10) NOT NULL DEFAULT 'variable',
  ADD COLUMN IF NOT EXISTS category_id       BIGINT REFERENCES expense_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sub_category_id   BIGINT REFERENCES expense_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sub_category      VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS recurring_id      BIGINT REFERENCES recurring_expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cycle_month       CHAR(7),
  ADD COLUMN IF NOT EXISTS due_date          DATE,
  ADD COLUMN IF NOT EXISTS reference_no      VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS no_receipt_reason VARCHAR(300),
  ADD COLUMN IF NOT EXISTS version           INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_type_check') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_type_check CHECK (expense_type IN ('constant','variable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_cycle_month_check') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_cycle_month_check CHECK (cycle_month IS NULL OR cycle_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_cycle ON expenses(recurring_id, cycle_month) WHERE recurring_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_type_date ON expenses(expense_type, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON expenses(created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_cycle_month ON expenses(cycle_month) WHERE cycle_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_topup ON expenses(expense_date) WHERE is_petty_topup;

-- ── Petty cash: same category tree, more detail, optional receipt with a reason ──
ALTER TABLE petty_cash_entries
  ADD COLUMN IF NOT EXISTS category_id       BIGINT REFERENCES expense_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sub_category_id   BIGINT REFERENCES expense_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sub_category      VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_mode      VARCHAR(40) NOT NULL DEFAULT 'Cash',
  ADD COLUMN IF NOT EXISTS location          VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS related_to        VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS no_receipt_reason VARCHAR(300),
  ADD COLUMN IF NOT EXISTS version           INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_petty_status ON petty_cash_entries(status);
CREATE INDEX IF NOT EXISTS idx_petty_category ON petty_cash_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_petty_created_by ON petty_cash_entries(created_by);

-- ── Audit trail: who, what, when and from which IP ──
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id, created_at DESC);

-- ── Users list: fast server-side search / sort / paging ──
CREATE INDEX IF NOT EXISTS idx_users_name ON users(lower(full_name));
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ── Default categories for a study-abroad consultancy (runs once; admin can add / rename / disable) ──
DO $$
DECLARE
  seed jsonb := $json$[
  {"t":"constant","c":"Office & Utilities","d":"Rent, bills and office running costs","s":["Office Rent","Electricity Bill","Gas Bill","Water Bill","Internet & Broadband","Telephone & Mobile (Postpaid)","Generator / UPS Fuel & Service","Building Maintenance & Service Charges","Security Guard Services","Cleaning & Janitorial Contract"]},
  {"t":"constant","c":"Salaries & HR","d":"Staff NOT paid through Salary Manager (contract, part-time) and HR costs","s":["Counsellors & Advisors","Back Office & Admin Staff","Management & Accounts","Marketing Team","Visa & Documentation Officers","Front Desk / Reception","Office Assistant / Support Staff","EOBI / Social Security","Staff Health Insurance","Provident Fund / Gratuity","Staff Training & Development","Recruitment & Hiring"]},
  {"t":"constant","c":"Software & Tech Subscriptions","d":"Monthly / yearly software, hosting and IT plans","s":["CRM Software","Website Hosting & Domain","Google Workspace / Microsoft 365","Cloud Server & Database (Vercel / Neon)","Accounting Software","Design Tools (Canva / Adobe)","WhatsApp Business API (Fixed Plan)","Video Conferencing (Zoom / Meet)","Antivirus & IT Security","Cloud Storage & Backup","IT Support / AMC"]},
  {"t":"constant","c":"Legal & Compliance","d":"Licences, registrations, tax and legal retainers","s":["Licenses & Registration","SECP Annual Return & Corporate Fees","FBR / Professional Tax","Auditor & Tax Advisor Fees","Legal Retainer / Lawyer Fees","Trademark & IP Renewal","Education Consultant Registration","Stamp Paper & Notary (Contracts)"]},
  {"t":"constant","c":"Insurance","d":"Business, property, staff and vehicle insurance","s":["Office / Property Insurance","Professional Indemnity Insurance","Group Health Insurance","Vehicle Insurance","Equipment & Electronics Insurance","Fire & Theft Insurance"]},
  {"t":"constant","c":"University Partnerships & Memberships","d":"Representation fees, accreditations and memberships","s":["University Representation Fees","ICEF / Agent Accreditation","British Council / IDP Agent Training","Chamber of Commerce Membership","Professional Associations","Education Portal Listings"]},
  {"t":"constant","c":"Marketing Retainers","d":"Fixed monthly marketing contracts","s":["Digital Agency Retainer","SEO & Website Maintenance","Social Media Management","Billboard / Signboard Rent","Lead Platform Subscription","Monthly Photography & Content"]},
  {"t":"constant","c":"Transport & Vehicle (Fixed)","d":"Vehicle lease, contract driver and fixed fuel","s":["Vehicle Lease / Rent","Driver (Contract)","Fixed Fuel Allowance","Vehicle Maintenance Contract","Monthly Parking Pass","Tracker Subscription"]},
  {"t":"constant","c":"Equipment Lease & Maintenance","d":"Leases and maintenance contracts (AMC)","s":["Photocopier / Printer Lease","AC Maintenance Contract","Water Dispenser Service","CCTV & Access Control Maintenance","Furniture Rental","Generator Maintenance Contract"]},
  {"t":"constant","c":"Banking & Finance Charges","d":"Fixed bank and payment-platform charges","s":["Bank Account Maintenance","POS / Card Machine Rental","Payment Gateway Monthly Fee","SMS / Internet Banking Charges","Cheque Book & Bank Certificates"]},
  {"t":"constant","c":"Others","d":"Write the expense name yourself","x":true,"s":[]},

  {"t":"variable","c":"Marketing & Lead Generation","d":"Ads, expos, seminars and campaigns","s":["Facebook & Instagram Ads","Google Ads","TikTok / YouTube Ads","Education Expos & Fairs","Seminars & Workshops","Print Media (Flyers, Brochures, Banners)","Influencers & Content Creators","SMS & Email Campaigns","Event Sponsorships","Photography & Video Shoots","Promotional Giveaways","Lead Purchase / Lead Portals"]},
  {"t":"variable","c":"Commission & Payouts","d":"Sub-agents, referrals and partner payouts","s":["Sub-agent Commissions","Student Referral Bonuses","B2B Partner Payouts","Staff Incentives (Non-payroll)","Counsellor Performance Bonus","Commission Adjustments / Clawbacks"]},
  {"t":"variable","c":"Courier & Documentation","d":"Crucial for study abroad files","s":["International Courier (DHL / FedEx)","Domestic Courier (TCS / Leopards)","Attestation & Verification (HEC / IBCC / MOFA)","Translation Services","Notary & Stamp Paper","Embassy / VFS Service Charges","Credential Evaluation (WES / ECE)","Document Printing & Scanning","Police Character Certificate","Medical Tests (on behalf of student)"]},
  {"t":"variable","c":"Communication & Tech Usage","d":"Pay-as-you-go messaging, calls and API usage","s":["WhatsApp API / Bulk SMS","International Calls","Mobile Packages & Top-ups","API & Cloud Usage Charges","Pay-per-use Software Credits","Video Call Credits"]},
  {"t":"variable","c":"Payment Gateway & Transaction Fees","d":"Bank, wallet, wire and exchange charges","s":["Bank Transfer Charges","Payment Gateway Fees","JazzCash / EasyPaisa Charges","International Wire (SWIFT) Fees","Currency Exchange / Forex Charges","Card Processing Fees","University Fee Transfer Charges"]},
  {"t":"variable","c":"Student Pre / Post-Departure Services","d":"Kits, briefings and arrival support","s":["Welcome / Departure Kits","Pre-departure Briefing Session","Airport Pickup Arrangement","Accommodation Booking Deposit","Travel Insurance (Student)","Air Ticket Booking (on behalf)","SIM / Forex Card for Students","Post-arrival Support"]},
  {"t":"variable","c":"Operations & Travel","d":"Business travel, stays and client meals","s":["Business Travel (Domestic)","Business Travel (International)","Hotel & Accommodation","Client Meals & Entertainment","Staff Visa Fees (Business Travel)","Travel / Daily Allowance (TA / DA)","Fuel & Mileage"]},
  {"t":"variable","c":"Maintenance & Repairs","d":"One-time repairs and renovation","s":["IT Equipment Repair","Furniture Repair","Electrical / Plumbing Repairs","AC Repair (Non-contract)","Vehicle Repair","Painting & Renovation","Office Shifting / Setup"]},
  {"t":"variable","c":"Test Prep & Training Materials","d":"IELTS / PTE classes and materials","s":["IELTS / PTE Books & Materials","Mock Test Fees","Trainer Honorarium","Online Course Subscriptions","Classroom Supplies"]},
  {"t":"variable","c":"Office Supplies & Equipment","d":"Bulk supplies and small equipment","s":["Stationery (Bulk Purchase)","Printer Toner & Ink","Computer Accessories","Small Equipment Purchase","Furniture (Small Items)"]},
  {"t":"variable","c":"Others","d":"Write the expense name yourself","x":true,"s":[]},

  {"t":"petty","c":"Office Refreshments & Hospitality","d":"Tea, water and snacks for staff, students and clients","s":["Tea, Coffee & Water","Student / Client Snacks","Milk, Sugar & Tea Supplies","Guest Lunch / Meals","Mineral Water Bottles","Disposable Cups & Cutlery","Staff Meeting Refreshments","Festival / Celebration Treats"]},
  {"t":"petty","c":"Office Maintenance & Supplies","d":"Stationery, cleaning and minor repairs","s":["Stationery & Printing","Cleaning & Janitorial Supplies","Minor Repairs","Photocopy & Binding","Toner / Ink Refill","Electrical Items (Bulbs, Extensions)","Batteries & Small Hardware","Toiletries & Washroom Supplies","First-aid Supplies","Pest Control"]},
  {"t":"petty","c":"Local Conveyance / Daily Travel","d":"Fuel, fares and document-submission trips","s":["Bike Fuel & Transport Allowance","Rickshaw / Taxi / Ride-hailing","Bus / Metro Fare","Parking & Toll","Bank / Embassy / VFS Visits","Document Submission Travel (HEC / IBCC / MOFA)"]},
  {"t":"petty","c":"Postage & Local Courier","d":"Small courier and postage","s":["Local Courier (TCS / Leopards)","Postage & Stamps","Document Delivery to Student","Courier Packaging"]},
  {"t":"petty","c":"Small Fees & Charges","d":"Attestation counter fees, challans and stamp paper","s":["Photocopy Attestation Fee","Stamp Paper","Government Challan / Token Fee","Bank Small Charges","Mobile Load (Official)"]},
  {"t":"petty","c":"Miscellaneous","d":"Gifts, donations and emergency buys","s":["Gifts for Clients / Partners","Donations / Charity","Newspapers & Magazines","Emergency Purchase"]},
  {"t":"petty","c":"Others","d":"Write the expense name yourself","x":true,"s":[]}
  ]$json$;
  r jsonb; s text; cid bigint; i int := 0; j int;
BEGIN
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'seed:expense_categories_v1') THEN RETURN; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(seed) LOOP
    i := i + 1;
    SELECT id INTO cid FROM expense_categories WHERE scope = r->>'t' AND parent_id IS NULL AND lower(name) = lower(r->>'c');
    IF cid IS NULL THEN
      INSERT INTO expense_categories(scope, name, description, allow_custom, is_system, sort_order)
      VALUES (r->>'t', r->>'c', COALESCE(r->>'d', ''), COALESCE((r->>'x')::boolean, FALSE), TRUE, CASE WHEN r->>'c' = 'Others' THEN 999 ELSE i * 10 END)
      RETURNING id INTO cid;
    END IF;
    j := 0;
    FOR s IN SELECT value FROM jsonb_array_elements_text(r->'s') LOOP
      j := j + 1;
      INSERT INTO expense_categories(scope, parent_id, name, is_system, sort_order)
      VALUES (r->>'t', cid, s, TRUE, j * 10) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  INSERT INTO app_settings(key, value) VALUES ('seed:expense_categories_v1', jsonb_build_object('at', NOW())) ON CONFLICT (key) DO NOTHING;
END $$;

-- ── One-time: move existing (v1) expenses / petty entries onto the new category tree ──
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'migrate:expenses_v2') THEN RETURN; END IF;

  UPDATE expenses e
     SET expense_type = m.t, category_id = c.id, category = c.name, sub_category_id = s.id,
         sub_category = COALESCE(s.name, CASE WHEN m.keep THEN e.category ELSE '' END),
         cycle_month = CASE WHEN m.t = 'constant' THEN to_char(e.expense_date, 'YYYY-MM') END
    FROM (VALUES
      ('Rent','constant','Office & Utilities','Office Rent',FALSE),
      ('Electricity Bill','constant','Office & Utilities','Electricity Bill',FALSE),
      ('Water Bill','constant','Office & Utilities','Water Bill',FALSE),
      ('Gas Bill','constant','Office & Utilities','Gas Bill',FALSE),
      ('Internet','constant','Office & Utilities','Internet & Broadband',FALSE),
      ('Utilities','constant','Office & Utilities',NULL,FALSE),
      ('Software & Subscriptions','constant','Software & Tech Subscriptions',NULL,FALSE),
      ('Office Fees','constant','Others',NULL,TRUE),
      ('Marketing','variable','Marketing & Lead Generation',NULL,FALSE),
      ('Transport','variable','Operations & Travel',NULL,FALSE),
      ('Maintenance','variable','Maintenance & Repairs',NULL,FALSE),
      ('Office Supplies','variable','Office Supplies & Equipment',NULL,FALSE)
    ) AS m(old, t, cat, sub, keep)
    JOIN expense_categories c ON c.scope = m.t AND c.parent_id IS NULL AND c.name = m.cat
    LEFT JOIN expense_categories s ON s.parent_id = c.id AND s.name = m.sub
   WHERE e.category = m.old AND NOT e.is_petty_topup AND e.category_id IS NULL;

  UPDATE expenses e SET expense_type = 'variable', category_id = c.id, category = c.name, sub_category = left(e.category, 120)
    FROM expense_categories c
   WHERE c.scope = 'variable' AND c.parent_id IS NULL AND c.name = 'Others'
     AND NOT e.is_petty_topup AND e.category_id IS NULL;

  UPDATE petty_cash_entries p
     SET category_id = c.id, category = c.name, sub_category_id = s.id, sub_category = COALESCE(s.name, '')
    FROM (VALUES
      ('Stationery','Office Maintenance & Supplies','Stationery & Printing'),
      ('Groceries','Office Refreshments & Hospitality','Milk, Sugar & Tea Supplies'),
      ('Refreshments','Office Refreshments & Hospitality','Tea, Coffee & Water'),
      ('Transport','Local Conveyance / Daily Travel',NULL),
      ('Office Supplies','Office Maintenance & Supplies',NULL),
      ('Cleaning','Office Maintenance & Supplies','Cleaning & Janitorial Supplies'),
      ('Repairs','Office Maintenance & Supplies','Minor Repairs'),
      ('Courier','Postage & Local Courier','Local Courier (TCS / Leopards)'),
      ('Printing','Office Maintenance & Supplies','Photocopy & Binding')
    ) AS m(old, cat, sub)
    JOIN expense_categories c ON c.scope = 'petty' AND c.parent_id IS NULL AND c.name = m.cat
    LEFT JOIN expense_categories s ON s.parent_id = c.id AND s.name = m.sub
   WHERE p.category = m.old AND p.category_id IS NULL;

  UPDATE petty_cash_entries p SET category_id = c.id, category = c.name, sub_category = left(p.category, 120)
    FROM expense_categories c
   WHERE c.scope = 'petty' AND c.parent_id IS NULL AND c.name = 'Others' AND p.category_id IS NULL;

  INSERT INTO app_settings(key, value) VALUES ('migrate:expenses_v2', jsonb_build_object('at', NOW())) ON CONFLICT (key) DO NOTHING;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
--  v3 (29 Oct 2026) — Revenue upgrade (categories, services, installment schedule,
--  sale documents, reminders, targets), in-app notifications, password reset,
--  per-user language. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS language       VARCHAR(8)    NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS monthly_target NUMERIC(14,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_language_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_language_check CHECK (language IN ('en','roman','ur'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_monthly_target_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_monthly_target_check CHECK (monthly_target >= 0);
  END IF;
END $$;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS revenue_category  VARCHAR(40)  NOT NULL DEFAULT 'Operating Revenue',
  ADD COLUMN IF NOT EXISTS service           VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reminder_days     SMALLINT     NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS reminder_channels TEXT[]       NOT NULL DEFAULT '{app}',
  ADD COLUMN IF NOT EXISTS notes_type        VARCHAR(80)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_reminder_days_check') THEN
    ALTER TABLE sales ADD CONSTRAINT sales_reminder_days_check CHECK (reminder_days BETWEEN 0 AND 30);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sales_category    ON sales(revenue_category);
CREATE INDEX IF NOT EXISTS idx_sales_package     ON sales(package);
CREATE INDEX IF NOT EXISTS idx_sales_destination ON sales(destination);
CREATE INDEX IF NOT EXISTS idx_sales_customer    ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_sale     ON sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_refunds_sale      ON sale_refunds(sale_id);
ALTER TABLE customers ALTER COLUMN country TYPE VARCHAR(80);

-- Payment plan: seq 0 = advance, 1..n = installments. Payments are allocated oldest-first,
-- so an installment is "paid" when all payments together cover it.
CREATE TABLE IF NOT EXISTS sale_installments (
  id               BIGSERIAL PRIMARY KEY,
  sale_id          BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  seq              SMALLINT NOT NULL CHECK (seq BETWEEN 0 AND 60),
  due_date         DATE NOT NULL,
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  last_reminded_on DATE,
  UNIQUE (sale_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_installments_due ON sale_installments(due_date);

CREATE TABLE IF NOT EXISTS sale_documents (
  id          BIGSERIAL PRIMARY KEY,
  sale_id     BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  file_id     BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  doc_type    VARCHAR(20) NOT NULL DEFAULT 'other' CHECK (doc_type IN ('passport','transcript','offer_letter','other')),
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sale_documents_sale ON sale_documents(sale_id);

-- In-app notifications (payment reminders, approvals …)
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       VARCHAR(30) NOT NULL DEFAULT 'info',
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       VARCHAR(300),
  dedupe_key VARCHAR(120),
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- One-time password reset links (only the SHA-256 of the token is stored)
CREATE TABLE IF NOT EXISTS password_resets (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   CHAR(64) NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ip           VARCHAR(64),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);


-- ════════════════════════════════════════════════════════════════════════════
--  v4 (Nov 2026) — Assets by liquidity, liability categories, capital classes,
--  admin-managed form fields (master → sub options + custom fields on every form),
--  password policy. Idempotent, keeps every existing row.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE assets ALTER COLUMN category TYPE VARCHAR(120);
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS liquidity         VARCHAR(10)   NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS sub_category      VARCHAR(120)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vendor            VARCHAR(160)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_method    VARCHAR(40)   NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reference_no      VARCHAR(120)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS quantity          INTEGER       NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS depreciation_rate NUMERIC(6,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warranty_until    DATE,
  ADD COLUMN IF NOT EXISTS custodian         VARCHAR(120)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS disposed_date     DATE,
  ADD COLUMN IF NOT EXISTS disposal_value    NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS custom_fields     JSONB         NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_liquidity_check') THEN
    ALTER TABLE assets ADD CONSTRAINT assets_liquidity_check CHECK (liquidity IN ('high','medium','low'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_quantity_check') THEN
    ALTER TABLE assets ADD CONSTRAINT assets_quantity_check CHECK (quantity BETWEEN 1 AND 100000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_dep_rate_check') THEN
    ALTER TABLE assets ADD CONSTRAINT assets_dep_rate_check CHECK (depreciation_rate BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_disposal_value_check') THEN
    ALTER TABLE assets ADD CONSTRAINT assets_disposal_value_check CHECK (disposal_value IS NULL OR disposal_value >= 0);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_assets_liquidity ON assets(liquidity, status);
CREATE INDEX IF NOT EXISTS idx_assets_purchase ON assets(purchase_date);

ALTER TABLE liabilities
  ADD COLUMN IF NOT EXISTS category      VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sub_category  VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reference_no  VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS purpose       VARCHAR(300) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS collateral    VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS custom_fields JSONB        NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_liability_payments_loan ON liability_payments(liability_id, payment_date);

ALTER TABLE capital_entries
  ADD COLUMN IF NOT EXISTS capital_class VARCHAR(12)  NOT NULL DEFAULT 'equity',
  ADD COLUMN IF NOT EXISTS source_type   VARCHAR(60)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS method        VARCHAR(40)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reference_no  VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS share_pct     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS custom_fields JSONB        NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capital_class_check') THEN
    ALTER TABLE capital_entries ADD CONSTRAINT capital_class_check CHECK (capital_class IN ('equity','debt','fixed','working'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capital_share_check') THEN
    ALTER TABLE capital_entries ADD CONSTRAINT capital_share_check CHECK (share_pct IS NULL OR share_pct BETWEEN 0 AND 100);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_capital_date ON capital_entries(entry_date);

-- Extra (admin-added) fields are stored per record here, so new fields never need a table change.
ALTER TABLE sales              ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE expenses           ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE petty_cash_entries ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── Form fields: built-in option lists (master → sub) and admin-added custom fields ──
CREATE TABLE IF NOT EXISTS form_fields (
  id          BIGSERIAL PRIMARY KEY,
  form_key    VARCHAR(40)  NOT NULL,
  field_key   VARCHAR(60)  NOT NULL,
  label       VARCHAR(120) NOT NULL,
  input_type  VARCHAR(16)  NOT NULL DEFAULT 'text'
              CHECK (input_type IN ('text','textarea','number','money','date','select','multiselect','checkbox','email','phone','url')),
  depends_on  VARCHAR(60),
  required    BOOLEAN      NOT NULL DEFAULT FALSE,
  is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  help        VARCHAR(200) NOT NULL DEFAULT '',
  placeholder VARCHAR(120) NOT NULL DEFAULT '',
  max_length  INTEGER      CHECK (max_length IS NULL OR max_length BETWEEN 1 AND 2000),
  sort_order  INTEGER      NOT NULL DEFAULT 100,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (form_key, field_key)
);
CREATE TABLE IF NOT EXISTS form_field_options (
  id               BIGSERIAL PRIMARY KEY,
  field_id         BIGINT NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,
  parent_option_id BIGINT REFERENCES form_field_options(id) ON DELETE CASCADE,
  value            VARCHAR(120) NOT NULL,
  label            VARCHAR(120) NOT NULL,
  meta             JSONB        NOT NULL DEFAULT '{}'::jsonb,
  is_system        BOOLEAN      NOT NULL DEFAULT FALSE,
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order       INTEGER      NOT NULL DEFAULT 100,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_form_option ON form_field_options(field_id, COALESCE(parent_option_id, 0), lower(value));
CREATE INDEX IF NOT EXISTS idx_form_option_parent ON form_field_options(parent_option_id);

-- Seed built-in option lists once (admin can rename / disable / add more later).
DO $$
DECLARE
  seed jsonb := $json$[
  {"f":"assets","k":"liquidity","l":"Liquidity","o":[
    {"v":"high","l":"High liquid assets","m":{"hint":"Cash or turns into cash within days"}},
    {"v":"medium","l":"Medium liquid assets","m":{"hint":"Turns into cash within weeks or months"}},
    {"v":"low","l":"Low / illiquid assets","m":{"hint":"Long-term — hard to sell quickly"}}]},
  {"f":"assets","k":"category","l":"Category","d":"liquidity","o":[
    {"p":"high","v":"Cash in Hand","m":{"asset_type":"current"},"s":["Office cash","Petty cash box","Cash in safe"]},
    {"p":"high","v":"Bank Account","m":{"asset_type":"current"},"s":["Current account","Savings account","Foreign currency account"]},
    {"p":"high","v":"Mobile Wallet","m":{"asset_type":"current"},"s":["JazzCash","EasyPaisa","SadaPay / NayaPay"]},
    {"p":"high","v":"Short-term Deposit","m":{"asset_type":"current"},"s":["Call deposit","Term deposit (up to 3 months)"]},
    {"p":"high","v":"Marketable Securities","m":{"asset_type":"current"},"s":["Shares / stocks","Treasury bills","Money-market fund"]},
    {"p":"medium","v":"Receivable","m":{"asset_type":"current"},"s":["Student fee receivable","University commission receivable","Agent / partner receivable","Other receivable"]},
    {"p":"medium","v":"Advance to Staff","m":{"asset_type":"current"},"s":["Salary advance","Travel advance","Loan to employee"]},
    {"p":"medium","v":"Prepaid Expense","m":{"asset_type":"current"},"s":["Prepaid rent","Prepaid insurance","Prepaid software / subscription","Advance to supplier"]},
    {"p":"medium","v":"Security Deposit","m":{"asset_type":"current"},"s":["Rent deposit","Utility deposit","Other refundable deposit"]},
    {"p":"medium","v":"Investment","m":{"asset_type":"current"},"s":["Mutual fund","Term deposit (3–12 months)","Gold"]},
    {"p":"medium","v":"Stock / Inventory","m":{"asset_type":"current"},"s":["Stationery stock","Marketing material","Welcome kits"]},
    {"p":"low","v":"Building / Office","m":{"asset_type":"fixed"},"s":["Office building","Shop / branch","Renovation & improvements"]},
    {"p":"low","v":"Land","m":{"asset_type":"fixed"},"s":["Commercial plot","Residential plot"]},
    {"p":"low","v":"Vehicle","m":{"asset_type":"fixed"},"s":["Car","Motorbike","Van"]},
    {"p":"low","v":"Furniture & Fixtures","m":{"asset_type":"fixed"},"s":["Office chairs","Desks / workstations","Reception furniture","Cabinets & racks"]},
    {"p":"low","v":"Computers & IT","m":{"asset_type":"fixed"},"s":["Laptops","Desktops","Printers & scanners","Servers & network","Mobile phones / tablets"]},
    {"p":"low","v":"Office Equipment","m":{"asset_type":"fixed"},"s":["Air conditioners","Generator / UPS","CCTV & security","Photocopier","Water dispenser"]},
    {"p":"low","v":"Software / License","m":{"asset_type":"intangible"},"s":["CRM licence","Accounting software","Design software"]},
    {"p":"low","v":"Website / Domain","m":{"asset_type":"intangible"},"s":["Website","Domain name","Mobile app"]},
    {"p":"low","v":"Brand / Trademark","m":{"asset_type":"intangible"},"s":["Trademark","Brand name / logo rights"]},
    {"p":"low","v":"Long-term Investment","m":{"asset_type":"fixed"},"s":["Shares in a company","Property investment"]},
    {"p":"low","v":"Other","m":{"asset_type":"fixed"},"s":[]}]},
  {"f":"liabilities","k":"category","l":"Liability category","o":[
    {"v":"Bank Loan","m":{"type":"loan"},"s":["Running finance","Term loan","Vehicle loan","SME loan"]},
    {"v":"Owner / Personal Loan","m":{"type":"loan"},"s":["Loan from owner","Loan from partner","Loan from friends / family"]},
    {"v":"Trade Payables","m":{"type":"payable"},"s":["Supplier payable","Vendor bills payable","University payable"]},
    {"v":"Accrued Expenses","m":{"type":"payable"},"s":["Salaries payable","Rent payable","Utilities payable","Commission payable"]},
    {"v":"Tax Payable","m":{"type":"payable"},"s":["Income tax","Sales tax","Withholding tax"]},
    {"v":"Customer Advances","m":{"type":"other"},"s":["Student fee received in advance","Refunds payable"]},
    {"v":"Credit Card","m":{"type":"loan"},"s":["Business credit card"]},
    {"v":"Lease / Installment Purchase","m":{"type":"loan"},"s":["Vehicle lease","Equipment lease","Installment purchase"]},
    {"v":"Other Liabilities","m":{"type":"other"},"s":[]}]},
  {"f":"capital","k":"capital_class","l":"Capital type","o":[
    {"v":"equity","l":"Equity capital","m":{"hint":"Money the owners / partners put in (or take out)"}},
    {"v":"debt","l":"Debt capital","m":{"hint":"Borrowed money used to run the business"}},
    {"v":"fixed","l":"Fixed capital","m":{"hint":"Money locked in long-term assets"}},
    {"v":"working","l":"Working capital","m":{"hint":"Money kept for day-to-day running"}}]},
  {"f":"capital","k":"source_type","l":"Source","o":[
    {"v":"Owner"},{"v":"Partner"},{"v":"Investor"},{"v":"Bank / financial institution"},{"v":"Retained earnings"},{"v":"Other"}]}
  ]$json$;
  f jsonb; o jsonb; s text; fid bigint; pid bigint; oid bigint; dfid bigint; i int; j int;
BEGIN
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'seed:form_fields_v1') THEN RETURN; END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(seed) LOOP
    INSERT INTO form_fields(form_key, field_key, label, input_type, depends_on, required, is_system)
    VALUES (f->>'f', f->>'k', f->>'l', 'select', f->>'d', TRUE, TRUE)
    ON CONFLICT (form_key, field_key) DO UPDATE SET is_system = TRUE
    RETURNING id INTO fid;
    dfid := NULL;
    IF f->>'d' IS NOT NULL THEN SELECT id INTO dfid FROM form_fields WHERE form_key = f->>'f' AND field_key = f->>'d'; END IF;
    i := 0;
    FOR o IN SELECT value FROM jsonb_array_elements(f->'o') LOOP
      i := i + 1;
      pid := NULL;
      IF o ? 'p' AND dfid IS NOT NULL THEN SELECT id INTO pid FROM form_field_options WHERE field_id = dfid AND parent_option_id IS NULL AND value = o->>'p'; END IF;
      INSERT INTO form_field_options(field_id, parent_option_id, value, label, meta, is_system, sort_order)
      VALUES (fid, pid, o->>'v', COALESCE(o->>'l', o->>'v'), COALESCE(o->'m', '{}'::jsonb), TRUE, i * 10)
      ON CONFLICT DO NOTHING;
      SELECT id INTO oid FROM form_field_options WHERE field_id = fid AND COALESCE(parent_option_id, 0) = COALESCE(pid, 0) AND value = o->>'v';
      IF o ? 's' AND jsonb_array_length(o->'s') > 0 THEN
        -- sub-items live in a separate "sub_category" field of the same form
        INSERT INTO form_fields(form_key, field_key, label, input_type, depends_on, required, is_system)
        VALUES (f->>'f', 'sub_category', 'Sub-category', 'select', f->>'k', FALSE, TRUE)
        ON CONFLICT (form_key, field_key) DO NOTHING;
        j := 0;
        FOR s IN SELECT value FROM jsonb_array_elements_text(o->'s') LOOP
          j := j + 1;
          INSERT INTO form_field_options(field_id, parent_option_id, value, label, is_system, sort_order)
          SELECT id, oid, s, s, TRUE, j * 10 FROM form_fields WHERE form_key = f->>'f' AND field_key = 'sub_category'
          ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
  INSERT INTO app_settings(key, value) VALUES ('seed:form_fields_v1', jsonb_build_object('at', NOW())) ON CONFLICT (key) DO NOTHING;
END $$;

-- One-time: put existing assets / liabilities into the new structure.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'migrate:finance_v4') THEN RETURN; END IF;
  UPDATE assets SET liquidity = CASE
      WHEN category IN ('Cash in Hand','Bank Account','Mobile Wallet','Short-term Deposit','Marketable Securities') THEN 'high'
      WHEN category IN ('Receivable','Security Deposit','Investment','Advance to Staff','Prepaid Expense','Stock / Inventory') THEN 'medium'
      ELSE 'low' END;
  UPDATE assets SET disposed_date = updated_at::date WHERE status = 'disposed' AND disposed_date IS NULL;
  UPDATE liabilities SET category = CASE type WHEN 'loan' THEN 'Bank Loan' WHEN 'payable' THEN 'Trade Payables' ELSE 'Other Liabilities' END WHERE category = '';
  INSERT INTO app_settings(key, value) VALUES ('migrate:finance_v4', jsonb_build_object('at', NOW())) ON CONFLICT (key) DO NOTHING;
END $$;

-- Password length rule (admin can change in Admin Settings → Security)
INSERT INTO app_settings(key, value) VALUES ('password_policy', '{"min":12,"max":12}'::jsonb) ON CONFLICT (key) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════════════
--  v5 (Nov 2026) — Cash Flow Manager for a study-abroad consultancy:
--  employee expense budgets (cash allotment, like a personal petty cash),
--  petty-cash top-ups managed from the same "Budget allotment" screen,
--  payment control (hold / release / bulk approve constant expenses),
--  treasury & banking (bank / cash / wallet accounts, overdraft & running finance lines),
--  planned cash items for the cash budget, and cash-flow settings. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Budget wallet: one per employee. While "active", the employee can add variable
--    expenses against the allotted cash and sees ONLY his / her own entries. ──
CREATE TABLE IF NOT EXISTS budget_wallets (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state        VARCHAR(10)   NOT NULL DEFAULT 'active' CHECK (state IN ('active','closed')),
  purpose      VARCHAR(200)  NOT NULL DEFAULT '',
  valid_until  DATE,
  max_entry    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (max_entry >= 0),       -- 0 = no limit per expense
  category_ids BIGINT[]      NOT NULL DEFAULT '{}',                           -- empty = every variable category
  opened_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  opened_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  closed_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  closed_at    TIMESTAMPTZ,
  close_note   VARCHAR(300),
  version      INTEGER       NOT NULL DEFAULT 1,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_budget_wallets_state ON budget_wallets(state);

-- Money given to (allot) or taken back from (return) an employee's budget.
CREATE SEQUENCE IF NOT EXISTS budget_seq START 1;
CREATE TABLE IF NOT EXISTS budget_entries (
  id             BIGSERIAL PRIMARY KEY,
  ref_no         VARCHAR(20)   NOT NULL UNIQUE,
  user_id        BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           VARCHAR(8)    NOT NULL DEFAULT 'allot' CHECK (kind IN ('allot','return')),
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  entry_date     DATE          NOT NULL,
  title          VARCHAR(160)  NOT NULL DEFAULT '',
  payment_method VARCHAR(40)   NOT NULL DEFAULT 'Cash',
  reference_no   VARCHAR(80)   NOT NULL DEFAULT '',
  note           TEXT          NOT NULL DEFAULT '',
  status         VARCHAR(12)   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  review_note    TEXT,
  reviewed_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  version        INTEGER       NOT NULL DEFAULT 1,
  created_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_budget_entries_user ON budget_entries(user_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_entries_date ON budget_entries(entry_date);

-- Expenses: which budget paid it, and "on hold" (payment postponed) for the payment-control screen.
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS budget_holder_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS on_hold          BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hold_note        VARCHAR(300),
  ADD COLUMN IF NOT EXISTS hold_until       DATE,
  ADD COLUMN IF NOT EXISTS held_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS held_at          TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_expenses_budget ON expenses(budget_holder_id) WHERE budget_holder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_hold ON expenses(on_hold) WHERE on_hold;

-- ── Treasury & banking: bank / cash / wallet / deposit accounts and credit lines ──
CREATE TABLE IF NOT EXISTS treasury_accounts (
  id            BIGSERIAL PRIMARY KEY,
  name          VARCHAR(120)  NOT NULL,
  kind          VARCHAR(20)   NOT NULL CHECK (kind IN ('bank','cash','wallet','deposit','overdraft','running_finance','loan_facility')),
  institution   VARCHAR(120)  NOT NULL DEFAULT '',
  account_ref   VARCHAR(40)   NOT NULL DEFAULT '',          -- last digits / IBAN tail only
  currency      VARCHAR(3)    NOT NULL DEFAULT 'PKR',
  fx_rate       NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),   -- PKR per 1 unit of the currency
  balance       NUMERIC(16,2) NOT NULL DEFAULT 0,            -- money in the account; for credit lines = amount used
  credit_limit  NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  interest_rate NUMERIC(6,3)  NOT NULL DEFAULT 0 CHECK (interest_rate >= 0 AND interest_rate <= 100),
  maturity_date DATE,
  as_of         DATE          NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT          NOT NULL DEFAULT '',
  active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Planned cash items for the cash budget (university commissions, tax, owner money, big payments…) ──
CREATE TABLE IF NOT EXISTS cash_plan_items (
  id          BIGSERIAL PRIMARY KEY,
  direction   VARCHAR(3)    NOT NULL CHECK (direction IN ('in','out')),
  category    VARCHAR(60)   NOT NULL,
  title       VARCHAR(160)  NOT NULL,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  start_month CHAR(7)       NOT NULL CHECK (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  repeat      VARCHAR(10)   NOT NULL DEFAULT 'once' CHECK (repeat IN ('once','monthly','quarterly','yearly')),
  end_month   CHAR(7)       CHECK (end_month IS NULL OR end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  day         SMALLINT      NOT NULL DEFAULT 15 CHECK (day BETWEEN 1 AND 28),
  probability SMALLINT      NOT NULL DEFAULT 100 CHECK (probability BETWEEN 1 AND 100),
  note        TEXT          NOT NULL DEFAULT '',
  active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (end_month IS NULL OR end_month >= start_month)
);
CREATE INDEX IF NOT EXISTS idx_cash_plan_month ON cash_plan_items(start_month) WHERE active;

-- Users: faster search by CNIC (digits only) and phone
CREATE INDEX IF NOT EXISTS idx_users_cnic_digits ON users ((regexp_replace(COALESCE(cnic,''), '\D', '', 'g')));


-- v6 (Nov 2026) — bulk constant expenses + configurable reminders.
-- Existing recurring expense records remain intact; defaults make old records compatible.
ALTER TABLE recurring_expenses
  ADD COLUMN IF NOT EXISTS reminder_days SMALLINT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS reminder_channels TEXT[] NOT NULL DEFAULT '{app,email}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_expenses_reminder_days_check') THEN
    ALTER TABLE recurring_expenses ADD CONSTRAINT recurring_expenses_reminder_days_check CHECK (reminder_days BETWEEN 0 AND 30);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS expense_reminder_sends (
  id BIGSERIAL PRIMARY KEY,
  recurring_id BIGINT NOT NULL REFERENCES recurring_expenses(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  channels TEXT[] NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recurring_id, due_date)
);
CREATE INDEX IF NOT EXISTS idx_expense_reminder_sends_date ON expense_reminder_sends(due_date DESC);

-- Additional fixed-cost items commonly used by study-abroad consultancies.
INSERT INTO expense_categories(scope,parent_id,name,description,allow_custom,is_system,sort_order)
SELECT 'constant',NULL,'Study Abroad Consultancy Operations',
       'Fixed platforms, partner subscriptions and recurring student-service operations.',FALSE,TRUE,110
WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE scope='constant' AND parent_id IS NULL AND lower(name)=lower('Study Abroad Consultancy Operations'));
WITH parent AS (
  SELECT id FROM expense_categories WHERE scope='constant' AND parent_id IS NULL AND lower(name)=lower('Study Abroad Consultancy Operations') LIMIT 1
), items(name, sort_order) AS (VALUES
  ('Student CRM / Case Management Subscription',10),
  ('University Agent Portal / Partner Platform Subscription',20),
  ('Visa & Application Management Platform',30),
  ('Student Document Storage & Cloud Archive',40),
  ('Fixed SMS / Email Notification Package',50),
  ('Fixed WhatsApp Business Platform Plan',60),
  ('University / Recruitment Partner Retainer',70),
  ('Sub-agent / Regional Representative Retainer',80),
  ('Education Agent Accreditation / Annual Membership',90),
  ('Fixed IELTS / PTE Learning Platform Licence',100),
  ('Student Support / After-arrival Service Retainer',110),
  ('Fixed Translation / Documentation Service Retainer',120)
)
INSERT INTO expense_categories(scope,parent_id,name,description,allow_custom,is_system,sort_order)
SELECT 'constant', parent.id, items.name, 'Recurring study-abroad consultancy operating cost.',FALSE,TRUE,items.sort_order
FROM parent CROSS JOIN items
WHERE NOT EXISTS (SELECT 1 FROM expense_categories c WHERE c.parent_id=parent.id AND lower(c.name)=lower(items.name));
