-- ══════════════════════════════════════════════════════════════════════════════
-- S99P — Feedback Triage: status, severity, notes (Migration 022)
-- ══════════════════════════════════════════════════════════════════════════════
-- Strategy: Extend feedback_events.raw_data JSONB with a "triage" sub-object.
-- This avoids ALTER TABLE ADD COLUMN and keeps triage metadata co-located
-- with the feedback event it describes.
--
-- raw_data structure after migration:
-- {
--   "reason": "用户填写的差评原因",
--   "triage": {
--     "status": "open",          // open | investigating | resolved | wontfix
--     "severity": "medium",      // low | medium | high | blocker
--     "notes": [
--       { "author": "pm", "text": "...", "at": "2026-07-01T10:00:00Z" }
--     ],
--     "updated_at": "2026-07-01T10:00:00Z",
--     "updated_by": "pm"
--   }
-- }
--
-- Migration is idempotent: sets default triage on rows that don't have it yet.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Backfill: set default triage status for all existing feedback_events
-- that don't already have a triage object in raw_data.
-- Uses jsonb_set to merge a default triage into raw_data.
-- Only affects rows where raw_data->'triage' IS NULL.
UPDATE feedback_events
SET raw_data = raw_data || jsonb_build_object(
  'triage', jsonb_build_object(
    'status', 'open',
    'severity', CASE
      WHEN event_type = 'thumbs_down' THEN 'medium'
      ELSE 'low'
    END,
    'notes', '[]'::jsonb,
    'updated_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updated_by', 'system'
  )
)
WHERE raw_data->'triage' IS NULL;

-- Create index for querying feedback by triage status (JSONB path)
CREATE INDEX IF NOT EXISTS idx_feedback_triage_status
  ON feedback_events ((raw_data->'triage'->>'status'))
  WHERE raw_data->'triage'->>'status' IS NOT NULL;

-- Create index for querying feedback by severity
CREATE INDEX IF NOT EXISTS idx_feedback_triage_severity
  ON feedback_events ((raw_data->'triage'->>'severity'))
  WHERE raw_data->'triage'->>'severity' IS NOT NULL;

COMMIT;
