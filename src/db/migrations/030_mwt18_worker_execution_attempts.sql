-- MWT-18: Controlled Worker Execution Harness v0 (additive)
--
-- Purpose:
--   Record CONTROLLED execution ATTEMPTS created from an APPROVED Worker
--   Delegation Contract. This is the FIRST controlled execution-attempt layer.
--
-- Safety invariants (PM MWT-18):
--   - An attempt is created ONLY from a contract with status = 'approved'.
--   - The harness executes NOTHING real externally. No live gateway, no network,
--     no external tool, no background scheduling, no autonomous loop.
--   - execution_mode is one of: deterministic_local | dry_run | manual_placeholder.
--   - result_summary / error_summary are LOCAL harness output, explicitly NOT
--     live evidence and NOT proof of real-world completion.
--   - References contract_id / conversation_id by ID. No raw memory/trust payload.
--   - No Trust Spine / Memory mutation. Only this additive record is written.
--
-- Status vocabulary (CHECK):
--   queued | running | completed | failed | cancelled
--
-- Reversible: DROP TABLE IF EXISTS on down.

CREATE TABLE IF NOT EXISTS worker_execution_attempts (
  attempt_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   TEXT NOT NULL,
  contract_id       TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  worker_label      TEXT,
  input_summary     TEXT,
  constraints       TEXT,
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','completed','failed','cancelled')),
  result_summary    TEXT,
  error_summary     TEXT,
  execution_mode    TEXT NOT NULL DEFAULT 'deterministic_local'
                    CHECK (execution_mode IN ('deterministic_local','dry_run','manual_placeholder')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wea_conversation ON worker_execution_attempts (conversation_id);
CREATE INDEX IF NOT EXISTS idx_wea_contract ON worker_execution_attempts (contract_id);
CREATE INDEX IF NOT EXISTS idx_wea_user ON worker_execution_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_wea_status ON worker_execution_attempts (status);

-- Down migration (reversible)
-- DROP TABLE IF EXISTS worker_execution_attempts;
