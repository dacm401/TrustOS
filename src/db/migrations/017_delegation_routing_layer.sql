-- Sprint 68 — Migration 017: delegation_logs.routing_layer
-- 用途：显式记录本次路由命中哪个 Layer（L0/L1/L2/L3）
--       用于 Phase 2.0 L2 灰度监控和离线分层分析
--       routing_layer 可从 routed_action 推断（direct/clarify=L0, delegate=L2, execute=L3）
--       但显式列更利于索引和 dashboard 查询
BEGIN;

ALTER TABLE delegation_logs ADD COLUMN IF NOT EXISTS routing_layer VARCHAR(5);

-- 为历史记录补填 routing_layer（从 routed_action 推断）
UPDATE delegation_logs
SET routing_layer =
  CASE
    WHEN routed_action IN ('direct_answer', 'ask_clarification') THEN 'L0'
    WHEN routed_action = 'delegate_to_slow' THEN 'L2'
    WHEN routed_action = 'execute_task' THEN 'L3'
    ELSE 'L1'
  END
WHERE routing_layer IS NULL;

-- 分层路由索引：用于按 Layer 统计 routing_success / value_success
CREATE INDEX IF NOT EXISTS idx_dl_routing_layer ON delegation_logs(routing_layer, created_at DESC)
  WHERE routing_layer IS NOT NULL;

-- Layer 2 专项索引：用于 L2 灰度期间监控
CREATE INDEX IF NOT EXISTS idx_dl_layer2_success ON delegation_logs(routing_layer, routing_success, created_at DESC)
  WHERE routing_layer = 'L2';

COMMIT;
