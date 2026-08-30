-- ══════════════════════════════════════════════════════════════════════════════
-- Evidence Bundle persistence (PLAN-P1 Task 3)
-- Migration 033
--
-- WHY
-- ──
-- `evidence-bundle-service.ts` could already BUILD a signed bundle, but only
-- on demand and never stored it — so there was no way to look back at what was
-- proven at a given point in time. Evidence you cannot retrieve later is not
-- really evidence.
--
-- PRIVACY INVARIANT (unchanged)
-- ─────────────────────────────
-- The stored bundle contains hash-only metadata. It MUST NOT carry raw prompt
-- or response content. `evidence-bundle-service.ts` guarantees this at build
-- time (13 hash-only fields + forbidden-key scan); this table merely persists
-- what that service produced. Storing it does not widen the privacy surface.
--
-- Additive + reversible:
--   Down migration: DROP TABLE IF EXISTS evidence_bundles;
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS evidence_bundles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        VARCHAR(64)  NOT NULL,
  trace_id       VARCHAR(128),
  session_id     VARCHAR(128),
  schema_version VARCHAR(64)  NOT NULL,
  -- Hash-only metadata bundle (no raw content — see header).
  bundle         JSONB        NOT NULL,
  -- HMAC digest from the signing service (NULL when no signing key configured).
  digest         VARCHAR(128),
  signed         BOOLEAN      NOT NULL DEFAULT false,
  -- Hash-chain validity at generation time (NULL if the chain was not checked).
  chain_valid    BOOLEAN,
  event_count    INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_bundles_user
  ON evidence_bundles(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_bundles_trace
  ON evidence_bundles(trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_bundles_session
  ON evidence_bundles(session_id)
  WHERE session_id IS NOT NULL;

COMMIT;
