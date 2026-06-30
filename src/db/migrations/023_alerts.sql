-- ══════════════════════════════════════════════════════════════════════════════
-- S99P — Operational Alerts Table (Migration 023)
-- ══════════════════════════════════════════════════════════════════════════════
-- Lightweight alert storage for beta operations.
-- Alert types: high_cost | error_spike | negative_feedback_burst
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS alerts (
  id            VARCHAR(36) PRIMARY KEY,
  type          VARCHAR(50) NOT NULL,
  severity      VARCHAR(20) NOT NULL DEFAULT 'warning',
  title         TEXT NOT NULL,
  detail        JSONB DEFAULT '{}',
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by VARCHAR(64),
  acknowledged_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_type_time ON alerts(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_ack ON alerts(acknowledged, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);

COMMIT;
