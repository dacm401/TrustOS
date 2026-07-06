-- ══════════════════════════════════════════════════════════════════════════════
-- S100P Phase 1 — Schema Foundation: Loop Separation in UX
-- Migration 024
--
-- Creates three target-schema tables:
--   1. agent_sessions  — independent delegated task sessions
--   2. manager_messages — Manager Loop messages (not Worker events)
--   3. session_events   — all Worker/session events scoped to a Session
--
-- Also adds session_id / action_id to permission_requests.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── S100P-002: Session Data Model ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_sessions (
  id                  VARCHAR(36) PRIMARY KEY,
  user_id             VARCHAR(64) NOT NULL,
  title               VARCHAR(255) NOT NULL,
  goal                TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'planning',
  worker_id           VARCHAR(64),
  delegation_contract JSONB DEFAULT '{}',
  risk_level          VARCHAR(10) DEFAULT 'low',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,

  -- Status constraint: only valid S100P session states
  CONSTRAINT chk_agent_session_status CHECK (
    status IN (
      'planning',
      'delegated',
      'running',
      'waiting_approval',
      'paused',
      'completed',
      'failed',
      'cancelled',
      'rolled_back'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_as_user_time
  ON agent_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_as_status
  ON agent_sessions(user_id, status)
  WHERE status NOT IN ('completed', 'failed', 'cancelled', 'rolled_back');

CREATE INDEX IF NOT EXISTS idx_as_worker
  ON agent_sessions(worker_id, created_at DESC)
  WHERE worker_id IS NOT NULL;


-- ── S100P-003: Manager Messages Separation ──────────────────────────────────

CREATE TABLE IF NOT EXISTS manager_messages (
  id                 VARCHAR(36) PRIMARY KEY,
  user_id            VARCHAR(64) NOT NULL,
  conversation_id    VARCHAR(64) NOT NULL,
  role               VARCHAR(20) NOT NULL,
  content            TEXT NOT NULL,
  related_session_id VARCHAR(36),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Role constraint: only Manager-level roles
  CONSTRAINT chk_manager_message_role CHECK (
    role IN ('user', 'manager', 'system')
  )
);

CREATE INDEX IF NOT EXISTS idx_mm_user_conv_time
  ON manager_messages(user_id, conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_mm_conv_time
  ON manager_messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_mm_session
  ON manager_messages(related_session_id, created_at ASC)
  WHERE related_session_id IS NOT NULL;


-- ── S100P-004: Session Events ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_events (
  id          VARCHAR(36) PRIMARY KEY,
  session_id  VARCHAR(36) NOT NULL,
  type        VARCHAR(50) NOT NULL,
  summary     TEXT,
  severity    VARCHAR(10) DEFAULT 'info',
  visibility  VARCHAR(30) NOT NULL DEFAULT 'session_timeline',
  raw_ref     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Visibility constraint: defines where this event appears
  CONSTRAINT chk_session_event_visibility CHECK (
    visibility IN (
      'silent_audit',
      'session_timeline',
      'approval_required',
      'manager_chat_summary',
      'trust_report_only',
      'critical_alert'
    )
  ),

  -- Severity constraint
  CONSTRAINT chk_session_event_severity CHECK (
    severity IN ('debug', 'info', 'warn', 'error', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS idx_se_session_time
  ON session_events(session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_se_type
  ON session_events(session_id, type, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_se_visibility
  ON session_events(session_id, visibility, created_at ASC)
  WHERE visibility IN ('approval_required', 'critical_alert');


-- ── S100P: Permission Requests Extension ────────────────────────────────────
-- Add action_id and risk_level to permission_requests for session-scoped approvals

ALTER TABLE permission_requests ADD COLUMN IF NOT EXISTS action_id VARCHAR(64);
ALTER TABLE permission_requests ADD COLUMN IF NOT EXISTS risk_level VARCHAR(10) DEFAULT 'low';
ALTER TABLE permission_requests ADD COLUMN IF NOT EXISTS manager_recommendation TEXT;

CREATE INDEX IF NOT EXISTS idx_pr_action
  ON permission_requests(action_id)
  WHERE action_id IS NOT NULL;

COMMIT;
