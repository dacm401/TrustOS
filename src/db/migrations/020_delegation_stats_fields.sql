-- Migration 020: Add stats fields to delegation_logs
-- Allows unified statistics from delegation_logs (replacing decision_logs joins)

BEGIN;

ALTER TABLE delegation_logs
  ADD COLUMN IF NOT EXISTS cost_saved_vs_slow float DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exec_input_tokens int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selected_role text DEFAULT NULL;

COMMIT;
