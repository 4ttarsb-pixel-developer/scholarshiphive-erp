-- PG-only durable event count metadata; no mutation of historical facts.
ALTER TABLE marketing.ad_accounts ADD COLUMN IF NOT EXISTS new_ads_detected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketing.ad_accounts ADD COLUMN IF NOT EXISTS new_campaigns_detected INTEGER NOT NULL DEFAULT 0;
