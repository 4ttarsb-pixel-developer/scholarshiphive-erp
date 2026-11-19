-- 002 — identity: users, credentials, sessions
SET search_path TO marketing, public;

CREATE TABLE marketing.users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL CHECK (role IN ('Admin','Employee')),
  status     TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  initials   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Case-insensitive email uniqueness (emails are always stored lower-cased by the app).
CREATE UNIQUE INDEX users_email_lower_key ON marketing.users (lower(email));

CREATE TABLE marketing.auth_credentials (
  user_id       UUID PRIMARY KEY REFERENCES marketing.users(id) ON DELETE RESTRICT,
  password_hash TEXT NOT NULL,          -- salt:scrypt(hex); no plaintext, ever
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE marketing.user_sessions (
  token_hash TEXT PRIMARY KEY,          -- sha256(opaque random token); never the raw token
  user_id    UUID NOT NULL REFERENCES marketing.users(id) ON DELETE RESTRICT,
  email      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_sessions_user_idx    ON marketing.user_sessions(user_id);
CREATE INDEX user_sessions_expires_idx ON marketing.user_sessions(expires_at);
