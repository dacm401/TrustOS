-- Sprint 63: Memory 对话管理 — 跨会话上下文 + Session Summary
-- 支持：
-- 1. session_summaries: session 结束时自动生成摘要，供后续会话引用
-- 2. sessions 表扩展: 添加 active_topic（用于跨会话主题关联）
-- 3. task_summaries: 自动生成/更新（与 tasks 表已有字段对应，这里补充全文索引）
BEGIN;

-- Session Summary：每个 session 结束时生成的结构化摘要
CREATE TABLE IF NOT EXISTS session_summaries (
  id              VARCHAR(36) PRIMARY KEY,
  session_id      VARCHAR(64) NOT NULL UNIQUE,
  user_id         VARCHAR(64) NOT NULL,

  -- 主题
  topic           TEXT,           -- 会话主题（一句话）
  topic_keywords   TEXT[] DEFAULT '{}',

  -- 结构化摘要
  summary_text    TEXT,           -- LLM 生成的对话摘要
  key_facts       TEXT[] DEFAULT '{}',   -- 关键事实
  decisions_made  TEXT[] DEFAULT '{}',   -- 已做决策
  open_questions  TEXT[] DEFAULT '{}',   -- 未解决问题

  -- 用户偏好（从本次会话中提取）
  preferences     TEXT[] DEFAULT '{}',

  -- 统计
  turn_count      INTEGER DEFAULT 0,
  fast_count      INTEGER DEFAULT 0,
  slow_count      INTEGER DEFAULT 0,

  -- 摘要生成状态
  generated_by    VARCHAR(20) DEFAULT 'auto',  -- auto | manual
  model_used      VARCHAR(100),

  version         INTEGER DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ss_user_time   ON session_summaries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ss_session     ON session_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_ss_topic      ON session_summaries USING GIN (topic_keywords);

-- sessions 表补充：active_topic（跨会话主题关联）
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS active_topic TEXT,
  ADD COLUMN IF NOT EXISTS last_topic_updated TIMESTAMPTZ;

-- sessions 表补充：对话轮次统计（session 内快速查询）
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS turn_count INTEGER DEFAULT 0;

COMMIT;
