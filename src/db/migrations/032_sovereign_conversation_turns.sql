-- ══════════════════════════════════════════════════════════════════════════════
-- Sovereign Data Layer — Phase 1 (RFC-001)
-- Migration 032
--
-- Adds `conversation_turns`: the L1 "raw intent" layer — the original prompt and
-- conversation text, retained on the LOCAL machine.
--
-- WHY THIS TABLE EXISTS
-- ────────────────────
-- ADR-001 amended the old "raw content is not persisted" guardrail to:
--     ingress  → local-first, retain the original prompt
--     egress   → anything sent to a cloud model MUST be processed
-- ADR-002 established why: processing reduces LEAKAGE, retention determines
-- OWNERSHIP. Without local retention the sole complete copy of the user's data
-- lives in the cloud — where they have no control.
--
-- DESIGN CONSTRAINTS
-- ─────────────────
--   1. Local retention only. This table is never read by the egress path.
--      Raw content reaching a provider can only come from
--      `src/services/egress/egress-processor.ts` output.
--   2. Secrets are never persisted. Writes are filtered by the same pattern
--      library used for egress (`SECRET_PATTERNS`). A turn whose content
--      contains a secret is dropped, not stored redacted — storing a redacted
--      copy would silently degrade the sovereign record.
--   3. Hot layer is unencrypted BY DECISION (ADR-002 / RFC-001 hot-cold split):
--      active data must stay searchable and readable by local models.
--      Protection for data at rest is provided by:
--        - OS full-disk encryption (recommended to users)
--        - the archiving path (Phase 2), which encrypts with a
--          passphrase-derived key
--   4. Additive + reversible. CREATE TABLE IF NOT EXISTS only; no ALTER of
--      existing tables. Down migration: DROP TABLE IF EXISTS conversation_turns;
--
-- NO RETENTION POLICY: rows are kept indefinitely. Archiving (Phase 2) moves
-- older turns into encrypted bundles but must never delete them — sovereign
-- data is an accumulating asset, not a disposable log.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS conversation_turns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     VARCHAR(128) NOT NULL,
  turn_index     INTEGER      NOT NULL,
  role           VARCHAR(16)  NOT NULL,          -- user | assistant | system | tool
  content        TEXT         NOT NULL,          -- L1 raw text (hot layer, unencrypted by design)
  user_id        VARCHAR(64)  NOT NULL,
  content_hash   VARCHAR(64),                    -- SHA-256 of content, for integrity + dedupe
  sensitivity    VARCHAR(16)  NOT NULL DEFAULT 'normal',  -- normal | sensitive
  -- Phase 2 archiving: NULL = still in the hot layer; set = id of the encrypted
  -- bundle this turn was moved into.
  archive_id     VARCHAR(64),
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast session-scoped retrieval (primary read path).
CREATE INDEX IF NOT EXISTS idx_convturns_session
  ON conversation_turns(session_id, turn_index);

-- Per-user scoping.
CREATE INDEX IF NOT EXISTS idx_convturns_user
  ON conversation_turns(user_id);

-- Chronological sweep for archiving (Phase 2).
CREATE INDEX IF NOT EXISTS idx_convturns_created
  ON conversation_turns(created_at);

-- Partial index: only un-archived rows need to be scanned for the next batch.
CREATE INDEX IF NOT EXISTS idx_convturns_hot
  ON conversation_turns(created_at)
  WHERE archive_id IS NULL;

COMMIT;
