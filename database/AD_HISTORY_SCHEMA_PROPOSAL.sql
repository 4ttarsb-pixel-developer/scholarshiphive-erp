-- DESIGN REFERENCE ONLY — not applied to the company database.
-- DB Team must merge this with its own approved marketing schema, migrations and roles.
CREATE SCHEMA IF NOT EXISTS marketing;

CREATE TABLE IF NOT EXISTS marketing.ad_accounts (
  id UUID PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('meta','google','tiktok')),
  external_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  currency_code TEXT,
  reporting_timezone TEXT,
  last_verified_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  UNIQUE(platform, external_account_id)
);
CREATE TABLE IF NOT EXISTS marketing.ad_campaigns (
  id BIGSERIAL PRIMARY KEY,
  ad_account_id UUID NOT NULL REFERENCES marketing.ad_accounts(id),
  external_campaign_id TEXT NOT NULL,
  name TEXT,
  last_known_platform_status TEXT,
  last_seen_at TIMESTAMPTZ,
  availability_status TEXT NOT NULL DEFAULT 'AVAILABLE',
  UNIQUE(ad_account_id, external_campaign_id)
);
CREATE TABLE IF NOT EXISTS marketing.ad_groups (
  id BIGSERIAL PRIMARY KEY,
  ad_account_id UUID NOT NULL REFERENCES marketing.ad_accounts(id),
  external_group_id TEXT NOT NULL,
  external_campaign_id TEXT,
  name TEXT,
  last_known_platform_status TEXT,
  last_seen_at TIMESTAMPTZ,
  availability_status TEXT NOT NULL DEFAULT 'AVAILABLE',
  UNIQUE(ad_account_id, external_group_id)
);
CREATE TABLE IF NOT EXISTS marketing.ads (
  id BIGSERIAL PRIMARY KEY,
  ad_account_id UUID NOT NULL REFERENCES marketing.ad_accounts(id),
  external_ad_id TEXT NOT NULL,
  external_campaign_id TEXT,
  external_group_id TEXT,
  name TEXT,
  last_known_platform_status TEXT,
  availability_status TEXT NOT NULL DEFAULT 'AVAILABLE',
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  missing_sync_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(ad_account_id, external_ad_id)
);
CREATE TABLE IF NOT EXISTS marketing.ad_performance_daily (
  ad_id BIGINT NOT NULL REFERENCES marketing.ads(id),
  report_date DATE NOT NULL,
  currency_code TEXT,
  spend NUMERIC(20,4),
  clicks BIGINT,
  impressions BIGINT,
  leads BIGINT,
  conversions NUMERIC(20,4),
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(ad_id, report_date)
);
CREATE TABLE IF NOT EXISTS marketing.ad_account_performance_daily (
  ad_account_id UUID NOT NULL REFERENCES marketing.ad_accounts(id),
  report_date DATE NOT NULL,
  spend NUMERIC(20,4),
  clicks BIGINT,
  impressions BIGINT,
  leads BIGINT,
  conversions NUMERIC(20,4),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(ad_account_id, report_date)
);
CREATE TABLE IF NOT EXISTS marketing.ad_sync_history (
  id BIGSERIAL PRIMARY KEY,
  ad_account_id UUID NOT NULL REFERENCES marketing.ad_accounts(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  sync_status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_summary TEXT,
  CHECK(period_start <= period_end)
);
-- Never cascade delete ad history merely because Meta removes a campaign/ad.
-- Use ON CONFLICT...DO UPDATE for daily metric re-reporting, not delete+insert.
-- Budget allocation and counsellor attribution tables are separate and unchanged.
