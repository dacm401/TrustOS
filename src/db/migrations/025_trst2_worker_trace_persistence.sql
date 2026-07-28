-- TRST-2: Worker Trace Persistence
-- Correlate Phase — persist Gateway trace headers with task_archives
-- so Worker model calls can carry parent trace_id/session_id/run_id.
--
-- Column stores only IDs (trace_id, session_id, run_id).
-- No raw prompts, messages, responses, or content.
ALTER TABLE task_archives ADD COLUMN IF NOT EXISTS gateway_trace_headers JSONB;
