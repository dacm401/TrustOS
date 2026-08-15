-- MWT-19: Manager Review / Approve Loop v0
--
-- Adds a minimal, additive, reversible review-record table so the Manager surface
-- can record explicit human/manager review decisions for Worker Delegation Contracts
-- and Worker Execution Attempts (both introduced by MWT-17 / MWT-18).
--
-- Scope guard (MWT-19):
--   - additive only; no destructive schema change; no production data migration
--   - review records are append-only / auditable; never rewrite execution results
--   - NOT external beta reviewer evidence; NOT live readiness proof
--   - does NOT mutate Trust Spine / Memory

CREATE TABLE IF NOT EXISTS manager_review_records (
  review_id        TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  target_type      TEXT NOT NULL
                    CHECK (target_type IN ('delegation_contract', 'execution_attempt')),
  target_id        TEXT NOT NULL,
  decision         TEXT NOT NULL
                    CHECK (decision IN (
                      'approve', 'reject', 'request_changes',
                      'accept_result', 'reject_result', 'request_rerun'
                    )),
  reason           TEXT,
  reviewer_label   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reversible: DROP TABLE IF EXISTS manager_review_records;

CREATE INDEX IF NOT EXISTS idx_mrr_conversation
  ON manager_review_records (conversation_id);
CREATE INDEX IF NOT EXISTS idx_mrr_target
  ON manager_review_records (target_type, target_id);
