-- 006 — ad catalog: accounts, assignments, campaigns, groups, ads, status events
-- Historical ad records are NEVER cascade-deleted. "Missing from a sync" is an
-- availability state (UNAVAILABLE), not a deletion.
SET search_path TO marketing, public;

CREATE TABLE marketing.ad_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            TEXT NOT NULL CHECK (platform IN ('meta','google','tiktok')),
  external_account_id TEXT NOT NULL,
  display_name        TEXT NOT NULL,
  currency_code       CHAR(3),
  account_timezone    TEXT,
  integration_status  TEXT NOT NULL DEFAULT 'Not connected',
  connected_by        UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  verified_at         TIMESTAMPTZ,
  last_synced_at      TIMESTAMPTZ,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_account_id)
);

CREATE TABLE marketing.ad_account_assignments (
  ad_account_id UUID NOT NULL REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  user_id       UUID NOT NULL REFERENCES marketing.users(id) ON DELETE RESTRICT,
  assigned_by   UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  PRIMARY KEY (ad_account_id, user_id)
);
CREATE INDEX ad_assignments_user_idx ON marketing.ad_account_assignments(user_id);

CREATE TABLE marketing.ad_campaigns (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  external_campaign_id TEXT NOT NULL,
  name                 TEXT,
  last_known_status    TEXT,
  availability_status  TEXT NOT NULL DEFAULT 'AVAILABLE',
  first_seen_at        TIMESTAMPTZ,
  last_seen_at         TIMESTAMPTZ,
  missing_sync_count   INT NOT NULL DEFAULT 0,
  UNIQUE (account_id, external_campaign_id)
);

CREATE TABLE marketing.ad_groups (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  campaign_id          UUID REFERENCES marketing.ad_campaigns(id) ON DELETE RESTRICT,
  external_group_id    TEXT NOT NULL,
  external_campaign_id TEXT,
  name                 TEXT,
  last_known_status    TEXT,
  availability_status  TEXT NOT NULL DEFAULT 'AVAILABLE',
  first_seen_at        TIMESTAMPTZ,
  last_seen_at         TIMESTAMPTZ,
  missing_sync_count   INT NOT NULL DEFAULT 0,
  UNIQUE (account_id, external_group_id)
);

CREATE TABLE marketing.ads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  group_id             UUID REFERENCES marketing.ad_groups(id) ON DELETE RESTRICT,
  external_ad_id       TEXT NOT NULL,
  external_campaign_id TEXT,
  external_group_id    TEXT,
  name                 TEXT,
  last_known_status    TEXT,
  availability_status  TEXT NOT NULL DEFAULT 'AVAILABLE',
  first_seen_at        TIMESTAMPTZ,
  last_seen_at         TIMESTAMPTZ,
  missing_sync_count   INT NOT NULL DEFAULT 0,
  UNIQUE (account_id, external_ad_id)
);
CREATE INDEX ads_account_idx ON marketing.ads(account_id);

-- Append-only platform status history (ACTIVE/PAUSED/ARCHIVED/DELETED/UNAVAILABLE).
CREATE TABLE marketing.ad_status_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ad_id       UUID NOT NULL REFERENCES marketing.ads(id) ON DELETE RESTRICT,
  old_status  TEXT,
  new_status  TEXT NOT NULL,
  source      TEXT,
  verified    BOOLEAN NOT NULL DEFAULT false,
  event_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ad_status_events_ad_idx ON marketing.ad_status_events(ad_id);
