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
