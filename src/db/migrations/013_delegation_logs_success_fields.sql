-- SmartRouter Pro — G4 Delegation Learning Loop Migration
-- Migration: 013_delegation_logs_success_fields
-- Phase: Phase D — Gated Delegation v2 (G4 数据质量补全)
-- Date: 2026-04-24
-- Purpose:
--   补全 delegation_logs 四层成功标准字段（routing/execution/value/user_success）
--   与 GATED-DELEGATION-v2.md 四层定义对齐
--
-- 四层成功标准定义（GATED-DELEGATION-v2.md §成功标准）：
--   routing_success:   manager 选对了动作（ground truth = expected_mode 映射）
--   execution_success:  Worker 真完成了任务（execution_status = success）
--   value_success:      Worker 产出比 direct_answer 有增益（better/same/worse）
--   user_success:       用户未追问/未改写（turn 维度分析）
--
-- 注意：
--   execution_correct（单体布尔）保留，向后兼容现有写入点
--   四层字段均为 nullable — 异步回填，不阻塞主流程写入

BEGIN;

-- ── 四层成功标准字段 ───────────────────────────────────────────────────────────

-- routing_success: manager 是否选对了动作
-- 计算方式：benchmark 离线跑完后回填，或通过 expected_mode 离线分析脚本回填
-- 枚举：无 → true → false（初始为空，完成后回填）
ALTER TABLE delegation_logs
  ADD COLUMN IF NOT EXISTS routing_success BOOLEAN;

-- value_success: Worker 产出是否比 Fast 直答有增益
-- 计算方式：Fast/Slow 双跑对比分析（由分析脚本批量回填）
-- 枚举：无 → 'better' → 'same' → 'worse'
ALTER TABLE delegation_logs
  ADD COLUMN IF NOT EXISTS value_success VARCHAR(20)
  CHECK (value_success IS NULL OR value_success IN ('better', 'same', 'worse'));

-- user_success: 用户是否未追问/未改写（turn 维度）
-- 计算方式：同 session 内后续 turn 分析
-- 枚举：无 → true → false
ALTER TABLE delegation_logs
  ADD COLUMN IF NOT EXISTS user_success BOOLEAN;

-- ── 新增索引 ──────────────────────────────────────────────────────────────────

-- 索引：按 routing_success 分析路由准确率（离线分析查询）
CREATE INDEX IF NOT EXISTS idx_dl_routing_success
  ON delegation_logs(routing_success, created_at DESC)
  WHERE routing_success IS NOT NULL;

-- 索引：按 value_success 分析 Worker 产出增益率
CREATE INDEX IF NOT EXISTS idx_dl_value_success
  ON delegation_logs(value_success, created_at DESC)
  WHERE value_success IS NOT NULL;

-- 索引：按 user_success 分析用户体验持续性
CREATE INDEX IF NOT EXISTS idx_dl_user_success
  ON delegation_logs(user_success, created_at DESC)
  WHERE user_success IS NOT NULL;

COMMIT;
