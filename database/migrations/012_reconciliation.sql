-- 012 — finance reconciliation. Manual expense <-> API-delivered ad spend are
-- SEPARATE ledgers; a reviewed link records a relationship, never a second spend.
SET search_path TO marketing, public;

CREATE TABLE marketing.expense_reconciliations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id           UUID REFERENCES marketing.expenses(id) ON DELETE RESTRICT,
  ad_account_id        UUID REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  period_start         DATE,
  period_end           DATE,
  source_reference     TEXT,            -- invoice / top-up reference
  decision             TEXT NOT NULL,   -- 'linked' | 'adjusted' | 'rejected'
  reconciled_amount_pkr NUMERIC(20,2),
  reason               TEXT,
  approved_by          UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expense_reconciliations_expense_idx ON marketing.expense_reconciliations(expense_id);
CREATE INDEX expense_reconciliations_account_idx ON marketing.expense_reconciliations(ad_account_id);
