-- ══════════════════════════════════════════════════════════════════════════════
-- MWT-16: Manager ↔ Trust Evidence Bridge v0
-- Migration 028
--
-- Adds the `conversation_trust_refs` table — a join/reference table linking a
-- manager conversation to EXISTING Trust evidence / trace / event / task references
-- by reference id only.
--
-- Design constraints (PM MWT-16 hard boundaries):
--   - References only. No raw event payload, no raw evidence content, no trace JSON
--     is stored here. Only (ref_kind, ref_id) + safe metadata.
--   - Read-only bridge: this table records that a conversation "references" a trust
--     artifact; it NEVER mutates the referenced evidence record, event envelope, or
--     Trust Spine semantics (event_hash, hashing logic, validation gates untouched).
--   - Additive + reversible: CREATE TABLE IF NOT EXISTS only; no ALTER on existing
--     tables; no Trust Spine semantic change.
--   - Down migration: DROP TABLE IF EXISTS conversation_trust_refs;
--
-- ref_kind values (controlled vocabulary):
--   'evidence' | 'trace' | 'event' | 'task' | 'run'
-- Ownership: user_id denormalized for fast scoping + 404-on-cross-user, matching the
-- conversations table convention. Unique (conversation_id, ref_kind, ref_id) prevents
-- duplicate references of the same kind+id.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS conversation_trust_refs (
  conversation_id VARCHAR(36) NOT NULL,
  ref_kind       VARCHAR(16) NOT NULL,
  ref_id         VARCHAR(128) NOT NULL,
  user_id        VARCHAR(64) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, ref_kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_trustref_user
  ON conversation_trust_refs(user_id);

CREATE INDEX IF NOT EXISTS idx_conv_trustref_conv
  ON conversation_trust_refs(conversation_id);

COMMIT;
