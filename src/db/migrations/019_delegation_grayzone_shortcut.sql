-- Sprint 76 — Migration 019: delegation_logs.grayzone_shortcut
-- grayZone 短路埋点字段：当 rerank 被 grayZone 短路时写入原因，
-- 用于上线后监控 grayZone 命中率与 changeRate 变化。
--
-- 使用场景（上线后持续监控）：
--   SELECT COUNT(*) WHERE grayzone_shortcut IS NOT NULL;
--   SELECT COUNT(*) WHERE did_rerank = false AND grayzone_shortcut IS NOT NULL;
--   SELECT grayzone_shortcut, COUNT(*)
--     FROM delegation_logs WHERE grayzone_shortcut IS NOT NULL
--     GROUP BY 1 ORDER BY 2 DESC;

ALTER TABLE delegation_logs
  ADD COLUMN IF NOT EXISTS grayzone_shortcut VARCHAR(100);

COMMENT ON COLUMN delegation_logs.grayzone_shortcut IS
  'grayZone 短路原因，如 "grayZone: delegate_to_slow conf∈[0.60, 0.70)"。' ||
  '当 shouldRerank 返回 should=false 且由 grayZone 触发时写入，用于监控埋点。';

CREATE INDEX IF NOT EXISTS idx_dl_grayzone_shortcut
  ON delegation_logs(grayzone_shortcut) WHERE grayzone_shortcut IS NOT NULL;
