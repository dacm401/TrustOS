-- Migration 018: task_worker_results.archive_id 索引
-- 原因：getByArchiveId() 是 SSE 轮询热路径，archive_id 无索引会导致全表扫描
-- 参考：task-archive-repo.ts TaskWorkerResultRepo.getByArchiveId()

CREATE INDEX IF NOT EXISTS idx_twr_archive_id
  ON task_worker_results(archive_id);

-- 同时确保 task_archive_events.archive_id 索引存在（010 中未显式建）
-- 已在 011 中建立 idx_tae_archive_id，此处跳过

-- 复合索引：按 archive_id + completed_at 排序查询最新结果
CREATE INDEX IF NOT EXISTS idx_twr_archive_completed
  ON task_worker_results(archive_id, completed_at DESC);
