-- 005 — expenses, document metadata (3 slots), immutable expense events
SET search_path TO marketing, public;

CREATE TABLE marketing.expenses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID NOT NULL REFERENCES marketing.users(id) ON DELETE RESTRICT,
  subcategory_id        UUID NOT NULL REFERENCES marketing.subcategories(id) ON DELETE RESTRICT,
  employee_allocation_id UUID REFERENCES marketing.employee_allocations(id) ON DELETE RESTRICT,
  title                 TEXT NOT NULL,
  vendor                TEXT NOT NULL DEFAULT '',
  reference             TEXT NOT NULL DEFAULT '',
  description           TEXT NOT NULL DEFAULT '',
  occurred_on           DATE NOT NULL,
  amount_pkr            NUMERIC(20,2) NOT NULL CHECK (amount_pkr > 0),
  status                TEXT NOT NULL DEFAULT 'Pending'
                          CHECK (status IN ('Pending','In Review','Approved','Rejected')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expenses_owner_idx       ON marketing.expenses(owner_id);
CREATE INDEX expenses_subcategory_idx ON marketing.expenses(subcategory_id);
CREATE INDEX expenses_status_idx      ON marketing.expenses(status);
CREATE INDEX expenses_occurred_idx    ON marketing.expenses(occurred_on);

-- Exactly three supporting document slots (1,2,3). Bytes are stored OUTSIDE the
-- database (object store / DOCUMENT_STORE_PATH); only metadata + checksum here.
CREATE TABLE marketing.expense_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  UUID NOT NULL REFERENCES marketing.expenses(id) ON DELETE RESTRICT,
  slot        SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 3),
  name        TEXT NOT NULL,
  file_key    TEXT NOT NULL,           -- path/key in the protected object store
  sha256      TEXT NOT NULL,
  mime_type   TEXT NOT NULL CHECK (mime_type IN ('application/pdf','image/png','image/jpeg')),
  bytes_size  BIGINT NOT NULL CHECK (bytes_size > 0),
  uploaded_by UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  uploaded_by_name TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (expense_id, slot)
);

-- Immutable, append-only audit trail (status transitions + document changes).
CREATE TABLE marketing.expense_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id     UUID NOT NULL REFERENCES marketing.expenses(id) ON DELETE RESTRICT,
  actor_id       UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  reviewer_name  TEXT,                 -- preserves the acting user's display name
  action         TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  note           TEXT,
  happened_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expense_events_expense_idx ON marketing.expense_events(expense_id);
CREATE INDEX expense_events_time_idx    ON marketing.expense_events(happened_at DESC);
