-- 003 — marketing taxonomy: categories + subcategories (stable FK UUIDs)
SET search_path TO marketing, public;

CREATE TABLE marketing.categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_lower_key ON marketing.categories (lower(name));

CREATE TABLE marketing.subcategories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES marketing.categories(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, name)
);
CREATE INDEX subcategories_category_idx ON marketing.subcategories(category_id);
