-- 004 — budgets: company monthly budgets, employee allocations, budget audit
-- All money is NUMERIC with explicit PKR meaning. Month is the first day of the month.
SET search_path TO marketing, public;

CREATE TABLE marketing.monthly_budgets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month          DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  subcategory_id UUID NOT NULL REFERENCES marketing.subcategories(id) ON DELETE RESTRICT,
  amount_pkr     NUMERIC(20,2) NOT NULL CHECK (amount_pkr >= 0),
  version        INT  NOT NULL DEFAULT 1,
  created_by     UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (month, subcategory_id)
);
CREATE INDEX monthly_budgets_month_idx ON marketing.monthly_budgets(month);

CREATE TABLE marketing.employee_allocations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month          DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  subcategory_id UUID NOT NULL REFERENCES marketing.subcategories(id) ON DELETE RESTRICT,
  user_id        UUID NOT NULL REFERENCES marketing.users(id) ON DELETE RESTRICT,
  amount_pkr     NUMERIC(20,2) NOT NULL CHECK (amount_pkr >= 0),
  created_by     UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (month, subcategory_id, user_id)
);
CREATE INDEX employee_allocations_month_user_idx ON marketing.employee_allocations(month, user_id);

-- Append-only history for budget/allocation changes.
CREATE TABLE marketing.budget_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope       TEXT NOT NULL CHECK (scope IN ('company','employee')),
  budget_id   UUID,
  actor_id    UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  action      TEXT NOT NULL,
  old_amount  NUMERIC(20,2),
  new_amount  NUMERIC(20,2),
  note        TEXT,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
