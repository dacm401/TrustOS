-- ══════════════════════════════════════════════════════════════════════════════
-- MWT-15: Manager ↔ Memory Context Bridge v0
-- Migration 027
--
-- Adds the `conversation_memory_refs` table — a join/reference table that links
-- a manager conversation to EXISTING memory entries by reference (id only).
--
-- Design constraints (PM MWT-15 hard boundaries):
--   - References only. No raw memory content is stored here. No copy, no denormalized
--     content, no automatic memory write / mutation.
--   - Read-only bridge: this table records that a conversation "references" a memory
--     entry; it never mutates the referenced memory entry or Memory Governance state.
--   - Additive + reversible: CREATE TABLE IF NOT EXISTS only; no ALTER on existing
--     tables; no Trust Spine / Memory semantics change.
--   - Down migration: DROP TABLE IF EXISTS conversation_memory_refs;
--
-- Ownership: user_id is denormalized for fast scoping + 404-on-cross-user, matching
-- the conversations table convention. The unique (conversation_id, memory_id) pair
-- prevents duplicate references.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS conversation_memory_refs (
  conversation_id VARCHAR(36) NOT NULL,
  memory_id       VARCHAR(36) NOT NULL,
  user_id         VARCHAR(64) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, memory_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_memref_user
  ON conversation_memory_refs(user_id);

CREATE INDEX IF NOT EXISTS idx_conv_memref_conv
  ON conversation_memory_refs(conversation_id);

COMMIT;
