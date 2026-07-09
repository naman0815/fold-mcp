-- Run once against the Turso database this server points at, e.g.:
--   turso db shell <db-name> < fold-mcp/schema/turso.sql
--
-- Note: `account_id` (bare) is Fold's OWN internal bank-account identifier —
-- a transaction's column already carries that meaning (see unfold_cli's GORM
-- model). `fold_account_id` (this schema's addition) is a DIFFERENT concept:
-- which LINKED FOLD LOGIN a row belongs to, for multi-account support. Do not
-- conflate the two — they intentionally have different names to avoid exactly
-- that confusion.

CREATE TABLE IF NOT EXISTS fold_accounts (
  id             TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  phone          TEXT NOT NULL,
  fold_user_uuid TEXT,
  status         TEXT NOT NULL DEFAULT 'pending_otp', -- pending_otp | active | error
  is_active      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS fold_account_secrets (
  fold_account_id TEXT PRIMARY KEY REFERENCES fold_accounts(id),
  access_token    TEXT,
  refresh_token   TEXT,
  device_hash     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  fold_account_id         TEXT NOT NULL REFERENCES fold_accounts(id),
  uuid                    TEXT NOT NULL,
  amount                  REAL,
  current_balance         REAL,
  timestamp               TEXT,
  type                    TEXT,
  account                 TEXT,
  merchant                TEXT,
  merchant_address        TEXT,
  narration               TEXT,
  category                TEXT,
  category_id             TEXT,
  subcategory             TEXT,
  tags                    TEXT,
  kind                    TEXT,
  mode                    TEXT,
  reference               TEXT,
  notes                   TEXT,
  excluded_from_cash_flow INTEGER,
  is_bookmarked           INTEGER,
  summary                 TEXT,
  transaction_id          TEXT,
  refund_status           TEXT,
  refund_received_on      TEXT,
  before_fold_account     INTEGER,
  via                     TEXT,
  account_in              TEXT,
  contact_id              TEXT,
  group_ids               TEXT,
  f1_predicted_category   INTEGER,
  f1_predicted_merchant   INTEGER,
  account_id              TEXT, -- Fold's own bank-account id (NOT the same as fold_account_id above)
  PRIMARY KEY (fold_account_id, uuid)
);
CREATE INDEX IF NOT EXISTS idx_tx_fold_account_ts ON transactions(fold_account_id, timestamp DESC);

-- MCP-level OAuth (Phase 4)
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     TEXT PRIMARY KEY,
  client_secret TEXT,
  metadata_json TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code           TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes         TEXT,
  expires_at     INTEGER NOT NULL,
  used           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  access_token  TEXT PRIMARY KEY,
  refresh_token TEXT UNIQUE,
  client_id     TEXT NOT NULL,
  scopes        TEXT,
  expires_at    INTEGER NOT NULL
);
