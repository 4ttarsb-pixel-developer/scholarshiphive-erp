-- 011 — external ingestion (Calling + Revenue). MEA owns read-only shadow tables;
-- external teams remain the source of truth. Upsert by (source_system, external_id);
-- never physically delete financial/audit history — status-change instead.
SET search_path TO marketing, public;

CREATE TABLE marketing.integration_sources (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name         TEXT NOT NULL UNIQUE,     -- 'calling' | 'revenue'
  api_contract_version TEXT,
  auth_reference      TEXT,                      -- name of the secret, NOT the secret
  polling_interval_seconds INT,
  enabled             BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE marketing.external_leads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system        TEXT NOT NULL,
  external_lead_id     TEXT NOT NULL,
  external_campaign_id TEXT,
  source_platform      TEXT,
  source_account_id    TEXT,
  counsellor_ref_id    UUID REFERENCES marketing.counsellor_refs(id) ON DELETE RESTRICT,
  status               TEXT,
  qualified_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ,
  ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_lead_id)
);

CREATE TABLE marketing.external_lead_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system    TEXT NOT NULL,
  external_lead_id TEXT NOT NULL,
  counsellor_external_id TEXT NOT NULL,
  assigned_at      TIMESTAMPTZ,
  unassigned_at    TIMESTAMPTZ,
  assignment_status TEXT,
  updated_at       TIMESTAMPTZ,
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX external_lead_assignments_lead_idx
  ON marketing.external_lead_assignments(source_system, external_lead_id);

CREATE TABLE marketing.external_sales (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system    TEXT NOT NULL,
  external_sale_id TEXT NOT NULL,
  external_lead_id TEXT,
  counsellor_external_id TEXT,
  amount_original  NUMERIC(20,2),
  currency         CHAR(3),
  status           TEXT,
  sold_at          TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ,
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_sale_id)
);

CREATE TABLE marketing.ingest_runs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_system TEXT NOT NULL,
  cursor        TEXT,
  attempt       INT NOT NULL DEFAULT 1,
  row_count     INT,
  failure_count INT,
  payload_hash  TEXT,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

-- Immutable mapping of an external source id to the local MEA UUID (provenance).
CREATE TABLE marketing.external_id_links (
  source_system TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  entity_type   TEXT NOT NULL,          -- 'lead' | 'sale' | 'counsellor'
  local_id      UUID NOT NULL,
  linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, external_id, entity_type)
);
