-- 010 — counsellor attribution (reporting allocation only; NOT an expense).
-- Share basis points per mapping MUST sum to exactly 10000 (100%).
SET search_path TO marketing, public;

CREATE TABLE marketing.counsellor_refs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system      TEXT NOT NULL DEFAULT 'manual_pending_calling_sync',
  external_id        TEXT NOT NULL,       -- stable Calling counsellor_id
  name               TEXT NOT NULL,
  department         TEXT NOT NULL DEFAULT 'Calling',
  work_contact_number TEXT,
  status             TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  manual_mapping_flag BOOLEAN NOT NULL DEFAULT true,
  created_by         UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);
CREATE UNIQUE INDEX counsellor_refs_external_lower_key
  ON marketing.counsellor_refs (lower(external_id));

CREATE TABLE marketing.campaign_mappings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              UUID NOT NULL REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  campaign_id             TEXT NOT NULL,   -- external campaign id (stable join key)
  campaign_label          TEXT,
  campaign_tracking_number TEXT,
  effective_start         DATE,
  effective_end           DATE,
  status                  TEXT NOT NULL DEFAULT 'Confirmed',
  mapping_version         INT NOT NULL DEFAULT 1,
  mapped_by               UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, campaign_id)
);

CREATE TABLE marketing.campaign_mapping_shares (
  mapping_id       UUID NOT NULL REFERENCES marketing.campaign_mappings(id) ON DELETE RESTRICT,
  counsellor_ref_id UUID NOT NULL REFERENCES marketing.counsellor_refs(id) ON DELETE RESTRICT,
  basis_points     INT NOT NULL CHECK (basis_points BETWEEN 0 AND 10000),
  PRIMARY KEY (mapping_id, counsellor_ref_id)
);

CREATE TABLE marketing.mapping_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   UUID REFERENCES marketing.ad_accounts(id) ON DELETE RESTRICT,
  campaign_id  TEXT,
  counsellor_ref_id UUID REFERENCES marketing.counsellor_refs(id) ON DELETE RESTRICT,
  actor_id     UUID REFERENCES marketing.users(id) ON DELETE RESTRICT,
  action       TEXT NOT NULL,
  before_after JSONB,
  happened_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
