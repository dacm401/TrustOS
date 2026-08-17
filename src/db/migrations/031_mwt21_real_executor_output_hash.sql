-- MWT-21: real execution seam (additive, non-breaking)
-- Adds output_hash to worker_execution_attempts so a REAL worker run can record
-- a hash-only SHA-256 of its final output (red line: raw content is never stored).
-- Safe to apply on top of migration 030; no column drop / type change.

ALTER TABLE worker_execution_attempts
  ADD COLUMN IF NOT EXISTS output_hash text;

-- Index for evidence lookups by hash (hash-only evidence graph friendly).
CREATE INDEX IF NOT EXISTS idx_worker_attempts_output_hash
  ON worker_execution_attempts (output_hash)
  WHERE output_hash IS NOT NULL;

-- Relax the execution_mode CHECK constraint to permit the new 'real' mode.
-- Migration 030 only allowed deterministic_local | dry_run | manual_placeholder;
-- MWT-21 introduces 'real' (genuine worker execution, hash-only recorded output).
-- Drop the auto-generated constraint (named by Postgres) and re-add with 'real'.
-- This is additive/non-destructive: existing rows keep their modes unchanged.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'worker_execution_attempts_execution_mode_check'
  ) THEN
    ALTER TABLE worker_execution_attempts
      DROP CONSTRAINT worker_execution_attempts_execution_mode_check;
  END IF;
END $$;

ALTER TABLE worker_execution_attempts
  ADD CONSTRAINT worker_execution_attempts_execution_mode_check
  CHECK (execution_mode IN ('deterministic_local','dry_run','manual_placeholder','real'));

