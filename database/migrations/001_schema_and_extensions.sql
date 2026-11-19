-- 001 — schema + extensions
-- Applied by the migration runner as the migration OWNER role (mea_owner), never
-- as the postgres superuser in deployed environments. Never edit an applied
-- migration in place; add a new numbered migration instead.

CREATE EXTENSION IF NOT EXISTS pgcrypto;          -- gen_random_uuid()

CREATE SCHEMA IF NOT EXISTS marketing AUTHORIZATION CURRENT_USER;

-- Make unqualified object creation land in the marketing schema for this session.
SET search_path TO marketing, public;
