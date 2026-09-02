-- ══════════════════════════════════════════════════════════════════════════════
-- memory_entries.sensitivity (ADR-004 — Stage B0: visibility & control)
-- Migration 034
--
-- WHY
-- ──
-- The memory governance layer (`services/mwt6/memory-governance-core.ts`) already
-- defines a four-tier classification:
--
--     public | internal | sensitive | restricted | unknown
--
-- with a deliberate fail-closed rule: `unknown` is NEVER treated as public.
--
-- But `memory_entries` had no column to hold that value, so every entry was
-- hardcoded to `unknown` at the API boundary (`api/memory.ts`):
--   "Memory has no sensitivity field -> unknown"
-- The classification was therefore decorative — it always received the same
-- input.
--
-- That made "default deny" meaningless in practice: with 100% of rows `unknown`,
-- filtering on the field would reject everything, which is exactly what the
-- system already does by not using memory at all.
--
-- This column makes the tier REAL and, crucially, USER-SETTABLE:
--   · Stage B0 lets the user see every entry (including the ~64% the system
--     auto-learned from conversation) and label each one.
--   · Stage B1 then filters on this value, where `unknown` means
--     "user has not reviewed/authorised this yet" rather than
--     "the system cannot tell" — so denied entries can be unblocked by the
--     owner instead of being permanently dead.
--
-- DEFAULT = 'unknown' is load-bearing: an entry must never be treated as
-- shareable just because nobody classified it yet.
--
-- Additive + reversible:
--   Down migration: ALTER TABLE memory_entries DROP COLUMN IF EXISTS sensitivity;
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE memory_entries
  ADD COLUMN IF NOT EXISTS sensitivity VARCHAR(20) NOT NULL DEFAULT 'unknown';

-- Constrain to the governance tier list. Guards against typos from the API
-- layer and keeps the DB and the type definition from drifting apart.
ALTER TABLE memory_entries
  DROP CONSTRAINT IF EXISTS memory_entries_sensitivity_check;

ALTER TABLE memory_entries
  ADD CONSTRAINT memory_entries_sensitivity_check
  CHECK (sensitivity IN ('public', 'internal', 'sensitive', 'restricted', 'unknown'));

-- Stage B1 will filter on (user_id, sensitivity) when selecting memories to
-- send to a cloud model.
CREATE INDEX IF NOT EXISTS idx_memory_entries_user_sensitivity
  ON memory_entries (user_id, sensitivity);

COMMIT;
