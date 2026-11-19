-- 007 — ad performance facts (date-granular). Nullable metrics preserve meaning:
--   0  = measured zero,  NULL = not reported / unavailable.
-- Upsert on the natural key; never delete+insert. Never cascade-delete history.
SET search_path TO marketing, public;

CREATE TABLE marketing.ad_daily_metrics (
  ad_id          UUID NOT NULL REFERENCES marketing.ads(id) ON DELETE RESTRICT,
  report_date    DATE NOT NULL,
  currency       CHAR(3),
  spend_original NUMERIC(20,4),
  impressions    BIGINT,
  clicks         BIGINT,
  leads          BIGINT,
  conversions    NUMERIC(20,4),
  source         TEXT NOT NULL DEFAULT 'live_api',
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_id, report_date)
);
CREATE INDEX ad_daily_metrics_date_idx ON marketing.ad_daily_metrics(report_date);

-- Account-level daily totals, kept separate so ad-level and account-level spend
-- are NEVER summed together into a double count.
CREATE TABLE marketing.ad_account_daily_metrics (
  account_id     UUID NOT NULL REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  report_date    DATE NOT NULL,
  currency       CHAR(3),
  spend_original NUMERIC(20,4),
  impressions    BIGINT,
  clicks         BIGINT,
  leads          BIGINT,
  conversions    NUMERIC(20,4),
  coverage_id    BIGINT,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, report_date)
);
CREATE INDEX ad_account_daily_metrics_date_idx ON marketing.ad_account_daily_metrics(report_date);
