-- 009 — company-approved monthly FX reference rates + audit history.
-- One active rate per (currency, month). PKR is never converted against itself.
SET search_path TO marketing, public;

CREATE TABLE marketing.fx_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency    CHAR(3) NOT NULL CHECK (currency <> 'PKR' AND currency ~ '^[A-Z]{3}$'),
  month       DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  rate_pkr    NUMERIC(20,6) NOT NULL CHECK (rate_pkr > 0),
  source      TEXT NOT NULL,
  version     INT NOT NULL DEFAULT 1,
  approved_by UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (currency, month)
);

CREATE TABLE marketing.fx_rate_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  currency    CHAR(3) NOT NULL,
  month       DATE NOT NULL,
  old_rate    NUMERIC(20,6),
  new_rate    NUMERIC(20,6) NOT NULL,
  source      TEXT,
  actor_id    UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fx_rate_events_cm_idx ON marketing.fx_rate_events(currency, month);
