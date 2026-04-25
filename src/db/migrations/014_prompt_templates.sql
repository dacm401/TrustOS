-- Sprint 62: Prompt Template System
-- 模板存储于数据库，支持运行时编辑/切换
BEGIN;

CREATE TABLE IF NOT EXISTS prompt_templates (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT DEFAULT '',
  version     INTEGER NOT NULL DEFAULT 1,

  -- 模板内容（YAML 结构）
  content     TEXT NOT NULL,
  -- 结构：
  --   core_rules: string[]
  --   mode_policy: Record<scenario, directive>
  --   decision_schema: { fields, format }
  --   authorization_rules: { fast: string[], slow: string[] }
  --   hooks: Record<hook_name, handler>
  --   variable_definitions: { name, source, description }

  -- 适用范围
  scope       VARCHAR(20) NOT NULL DEFAULT 'global',
  -- global | user_id | session_id

  -- 激活状态
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,

  -- 元数据
  created_by  VARCHAR(64) DEFAULT 'system',
  tags        TEXT[] DEFAULT '{}',
  metadata    JSONB DEFAULT '{}',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pt_active    ON prompt_templates(is_active)     WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pt_scope     ON prompt_templates(scope);
CREATE INDEX IF NOT EXISTS idx_pt_name      ON prompt_templates(name);

COMMIT;
