-- ══════════════════════════════════════════════════════════════════════════════
-- MWT-13: ManagerConversation Backend Wiring v0
-- Migration 026
--
-- Adds the `conversations` table — the Manager Loop conversation lifecycle.
-- manager_messages already exists (024) and references conversation_id as a
-- free-form string; this table gives conversations a first-class, ownable
-- entity without altering existing message semantics.
--
-- Additive + reversible:
--   - CREATE TABLE IF NOT EXISTS only; no ALTER on existing tables.
--   - No raw content, no secrets, no Trust Spine / Memory changes.
--   - Down migration: DROP TABLE IF EXISTS conversations;
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS conversations (
  id          VARCHAR(36) PRIMARY KEY,
  user_id     VARCHAR(64) NOT NULL,
  title       VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_user_time
  ON conversations(user_id, created_at DESC);

COMMIT;
