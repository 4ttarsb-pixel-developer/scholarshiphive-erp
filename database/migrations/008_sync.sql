-- 008 — durable synchronization: jobs, runs, coverage.
-- Replaces the in-process setInterval scheduler with a persistent, leased,
-- de-duplicated job model so multiple workers cannot process the same work twice.
SET search_path TO marketing, public;

CREATE TABLE marketing.ad_sync_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  reason          TEXT,                 -- 'scheduled' | 'on_demand' | 'backfill'
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  due_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count   INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  locked_by       TEXT,
  idempotency_key TEXT NOT NULL,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date),
  UNIQUE (idempotency_key)
);
CREATE INDEX ad_sync_jobs_due_idx    ON marketing.ad_sync_jobs(status, due_at);
CREATE INDEX ad_sync_jobs_account_idx ON marketing.ad_sync_jobs(account_id);

CREATE TABLE marketing.ad_sync_runs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id       UUID REFERENCES marketing.ad_sync_jobs(id) ON DELETE RESTRICT,
  account_id   UUID NOT NULL REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  source       TEXT,
  status       TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error        TEXT
);
CREATE INDEX ad_sync_runs_account_idx ON marketing.ad_sync_runs(account_id);

-- Which exact dates have been successfully synced for an account (coverage),
-- so missing coverage is never rendered as zero spend.
CREATE TABLE marketing.ad_sync_coverage (
  account_id  UUID NOT NULL REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  report_date DATE NOT NULL,
  source      TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, report_date)
);
