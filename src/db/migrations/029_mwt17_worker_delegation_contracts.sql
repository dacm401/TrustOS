-- MWT-17: Worker Delegation Contract v0 (additive)
--
-- Purpose:
--   Store structured, reviewable Worker Delegation Contracts attached to a
--   ManagerConversation. This is the CONTRACT LAYER before controlled
--   execution. It does NOT execute workers, schedule tasks, or mutate Trust
--   Spine / Memory. It only captures intent in a human-reviewable form.
--
-- Safety:
--   - Additive only. No destructive schema changes.
--   - Reversible: DROP TABLE IF EXISTS on down.
--   - References memory_ref_ids / trust_ref_ids as IDs (not payloads).
--   - No raw content/payload/event_hash is stored here.
--   - conversation_id is a logical link to conversations(id); we do not add a
--     FK that could break startup if conversations table shape differs.
--
-- Status vocabulary (enforced by CHECK):
--   draft | ready_for_review | approved | rejected | superseded

CREATE TABLE IF NOT EXISTS worker_delegation_contracts (
  contract_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  title              TEXT NOT NULL,
  objective          TEXT NOT NULL,
  intended_worker    TEXT,
  input_summary      TEXT,
  memory_ref_ids     TEXT[] NOT NULL DEFAULT '{}',
  trust_ref_ids      TEXT[] NOT NULL DEFAULT '{}',
  constraints        TEXT,
  expected_output    TEXT,
  status             TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','ready_for_review','approved','rejected','superseded')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wdc_conversation ON worker_delegation_contracts (conversation_id);
CREATE INDEX IF NOT EXISTS idx_wdc_user ON worker_delegation_contracts (user_id);
CREATE INDEX IF NOT EXISTS idx_wdc_status ON worker_delegation_contracts (status);

-- Down migration (reversible)
-- DROP TABLE IF EXISTS worker_delegation_contracts;
