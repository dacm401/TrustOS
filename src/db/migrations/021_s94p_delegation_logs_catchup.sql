-- S94P: Delegation Logs Catch-up Migration (idempotent)
-- 
-- Background: Migrations 019 (grayzone_shortcut) and 020 (selected_role, exec_input_tokens, cost_saved_vs_slow)
-- were created as standalone files but never integrated into an automatic migration runner.
-- schema.sql already includes these columns in CREATE TABLE (for clean installs),
-- but existing databases created before these migrations may be missing them.
--
-- This migration is idempotent — safe to run repeatedly on any DB state.
-- Run: psql -U postgres -d smartrouter -f src/db/migrations/021_s94p_delegation_logs_catchup.sql
--
-- Column types match delegation.ts INSERT/updateExecution code and schema.sql CREATE TABLE definition:
--   grayzone_shortcut  VARCHAR(100) — from migration 019, written as d.grayzone_shortcut ?? null
--   selected_role      TEXT         — from migration 020/schema.sql, written as d.selected_role ?? null
--   exec_input_tokens  INTEGER      — from migration 020/schema.sql, written as update.exec_input_tokens ?? null
--   cost_saved_vs_slow DECIMAL(10,6)— from schema.sql, written as update.cost_saved_vs_slow ?? null

BEGIN;

-- Migration 019: grayzone_shortcut
ALTER TABLE delegation_logs
  ADD COLUMN IF NOT EXISTS grayzone_shortcut VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_dl_grayzone_shortcut
  ON delegation_logs(grayzone_shortcut) WHERE grayzone_shortcut IS NOT NULL;

-- Migration 020: stats fields
ALTER TABLE delegation_logs
  ADD COLUMN IF NOT EXISTS selected_role TEXT;

ALTER TABLE delegation_logs
  ADD COLUMN IF NOT EXISTS exec_input_tokens INTEGER DEFAULT 0;

ALTER TABLE delegation_logs
  ADD COLUMN IF NOT EXISTS cost_saved_vs_slow DECIMAL(10, 6);

COMMIT;
