-- SmartRouter Pro v1.0 - Database Schema

CREATE TABLE IF NOT EXISTS decision_logs (
  id                VARCHAR(36) PRIMARY KEY,
  user_id           VARCHAR(36) NOT NULL,
  session_id        VARCHAR(36) NOT NULL,
  query_preview     TEXT,
  intent            VARCHAR(50),
  complexity_score  SMALLINT,
  input_token_count INTEGER,
  has_code          BOOLEAN DEFAULT FALSE,
  has_math          BOOLEAN DEFAULT FALSE,
  router_version    VARCHAR(20),
  fast_score        REAL,
  slow_score        REAL,
  confidence        REAL,
  selected_model    VARCHAR(100),
  selected_role     VARCHAR(10),
  selection_reason  TEXT,
  context_original_tokens   INTEGER,
  context_compressed_tokens INTEGER,
  compression_level VARCHAR(5),
  compression_ratio REAL,
  model_used        VARCHAR(100),
  exec_input_tokens INTEGER,
  exec_output_tokens INTEGER,
  total_cost_usd    DECIMAL(10, 6),
  latency_ms        INTEGER,
  did_fallback      BOOLEAN DEFAULT FALSE,
  fallback_reason   TEXT,
  feedback_type     VARCHAR(50),
  feedback_score    NUMERIC(4,1),  -- supports fractional values (e.g. "edited" = -0.5)
  routing_correct   BOOLEAN,
  cost_saved_vs_slow DECIMAL(10, 6),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_events (
  id              VARCHAR(36) PRIMARY KEY,
  decision_id    VARCHAR(36) NOT NULL,
  user_id        VARCHAR(36) NOT NULL,
  event_type     VARCHAR(50) NOT NULL,
  signal_level   SMALLINT NOT NULL,  -- 1=L1(strong), 2=L2(weak), 3=L3(noise)
  source         VARCHAR(20) NOT NULL, -- 'ui' | 'auto_detect' | 'system'
  raw_data       JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_user_time ON feedback_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_events_decision ON feedback_events(decision_id);

CREATE TABLE IF NOT EXISTS execution_results (
  id                  VARCHAR(36) PRIMARY KEY,
  task_id             VARCHAR(36),
  user_id             VARCHAR(36) NOT NULL,
  session_id          VARCHAR(36) NOT NULL,
  final_content       TEXT,
  steps_summary       JSONB,
  memory_entries_used TEXT[]     DEFAULT '{}',
  model_used          VARCHAR(100),
  tool_count          INTEGER    DEFAULT 0,
  duration_ms         INTEGER,
  reason              VARCHAR(50),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_er_user_time  ON execution_results(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_er_task       ON execution_results(task_id);

CREATE TABLE IF NOT EXISTS behavioral_memories (
  id                  VARCHAR(36) PRIMARY KEY,
  user_id             VARCHAR(36) NOT NULL,
  trigger_pattern     TEXT NOT NULL,
  observation         TEXT NOT NULL,
  learned_action      TEXT NOT NULL,
  strength            REAL DEFAULT 0.5,
  reinforcement_count INTEGER DEFAULT 1,
  last_activated      TIMESTAMPTZ,
  source_decision_ids TEXT[],
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bm_user ON behavioral_memories(user_id);

CREATE TABLE IF NOT EXISTS identity_memories (
  user_id              VARCHAR(36) PRIMARY KEY,
  response_style       VARCHAR(20) DEFAULT 'balanced',
  expertise_level      VARCHAR(20) DEFAULT 'intermediate',
  domains              TEXT[] DEFAULT '{}',
  quality_sensitivity  REAL DEFAULT 0.5,
  cost_sensitivity     REAL DEFAULT 0.5,
  preferred_fast_model VARCHAR(100),
  preferred_slow_model VARCHAR(100),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS growth_milestones (
  id              VARCHAR(36) PRIMARY KEY,
  user_id         VARCHAR(36) NOT NULL,
  milestone_type  VARCHAR(50),
  title           TEXT NOT NULL,
  description     TEXT,
  metric_value    REAL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gm_user ON growth_milestones(user_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id              VARCHAR(36) PRIMARY KEY,
  user_id         VARCHAR(36) NOT NULL,
  active_topic    TEXT,
  total_requests  INTEGER DEFAULT 0,
  fast_count      INTEGER DEFAULT 0,
  slow_count      INTEGER DEFAULT 0,
  fallback_count  INTEGER DEFAULT 0,
  total_tokens    INTEGER DEFAULT 0,
  total_cost      DECIMAL(10, 6) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id              VARCHAR(36) PRIMARY KEY,
  user_id         VARCHAR(36) NOT NULL,
  session_id      VARCHAR(36) NOT NULL,
  title           VARCHAR(255),
  mode            VARCHAR(20) DEFAULT 'direct',
  status          VARCHAR(20) DEFAULT 'completed',
  complexity      VARCHAR(10) DEFAULT 'low',
  risk            VARCHAR(10) DEFAULT 'low',
  goal            TEXT,
  budget_profile  JSONB DEFAULT '{}',
  tokens_used     INTEGER DEFAULT 0,
  tool_calls_used INTEGER DEFAULT 0,
  steps_used      INTEGER DEFAULT 0,
  summary_ref     VARCHAR(36),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_session ON tasks(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(user_id, updated_at DESC);

-- Task summaries (FC-002)
CREATE TABLE IF NOT EXISTS task_summaries (
  id              VARCHAR(36) PRIMARY KEY,
  task_id         VARCHAR(36) NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  goal            TEXT,
  confirmed_facts TEXT[] DEFAULT '{}',
  completed_steps TEXT[] DEFAULT '{}',
  blocked_by      TEXT[] DEFAULT '{}',
  next_step       TEXT,
  summary_text    TEXT,
  version         INTEGER DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ts_task ON task_summaries(task_id);

-- Task traces (FC-003)
CREATE TABLE IF NOT EXISTS task_traces (
  id        VARCHAR(36) PRIMARY KEY,
  task_id   VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type      VARCHAR(30) NOT NULL,
  detail    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tt_task ON task_traces(task_id, created_at);

-- Memory entries (MC-001)
CREATE TABLE IF NOT EXISTS memory_entries (
  id          VARCHAR(36) PRIMARY KEY,
  user_id     VARCHAR(36) NOT NULL,
  category    VARCHAR(50) NOT NULL,        -- "preference" | "fact" | "context" | "instruction"
  content     TEXT NOT NULL,
  importance  INTEGER NOT NULL DEFAULT 3, -- 1–5, higher = more important
  tags        TEXT[] DEFAULT '{}',
  source      VARCHAR(50) NOT NULL DEFAULT 'manual',  -- "manual" | "extracted" | "feedback"
  relevance_score REAL DEFAULT 0.5,  -- M2: 0.0–1.0, higher = more relevant
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_me_user ON memory_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_me_user_importance ON memory_entries(user_id, importance DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_me_user_category ON memory_entries(user_id, category);

-- Sprint 25: pgvector extension for semantic memory retrieval
CREATE EXTENSION IF NOT EXISTS vector;

-- memory_entries 加 embedding 列（1536维，兼容 OpenAI text-embedding-3-small）
ALTER TABLE memory_entries
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW 索引（比 IVFFlat 更适合小数据集，无需预训练）
CREATE INDEX IF NOT EXISTS memory_entries_embedding_idx
  ON memory_entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Layer 6 / E1: Evidence table
-- Stores provenance of external information retrieved during task execution.
-- Distinct from memory_entries (user-level, editable) — evidence is task-level
-- and tied to the specific source that produced it (read-only provenance).
CREATE TABLE IF NOT EXISTS evidence (
  evidence_id     VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id         VARCHAR(36) NOT NULL,
  source          VARCHAR(50) NOT NULL DEFAULT 'manual',
  content         TEXT NOT NULL,
  source_metadata JSONB,
  relevance_score REAL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evidence_task_id ON evidence(task_id);
CREATE INDEX IF NOT EXISTS idx_evidence_user_id ON evidence(user_id);

-- O-005: Delegation Archive（慢模型任务档案）
-- 快模型委托慢模型时，每个任务的完整记录存入档案
-- 慢模型每个任务独立对话，共享知识靠档案，不靠上下文累积
CREATE TABLE IF NOT EXISTS delegation_archive (
  id                  VARCHAR(36) PRIMARY KEY,
  task_id             VARCHAR(36) NOT NULL,
  user_id             VARCHAR(36) NOT NULL,
  session_id          VARCHAR(36) NOT NULL,
  original_message    TEXT NOT NULL,
  delegation_prompt   TEXT NOT NULL,  -- 委托时发给慢模型的 prompt（任务卡片）
  slow_result         TEXT,
  related_task_ids    TEXT[] DEFAULT '{}',  -- 相关历史任务 ID（从档案查询得到）
  status              VARCHAR(20) DEFAULT 'pending',  -- pending | completed | failed
  processing_ms       INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_da_user_session ON delegation_archive(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_da_task ON delegation_archive(task_id);
CREATE INDEX IF NOT EXISTS idx_da_user_time ON delegation_archive(user_id, created_at DESC);

-- LLM-Native Routing: Task Archive（Fast/Slow 共享工作台）
CREATE TABLE IF NOT EXISTS task_archives (
  id              VARCHAR(36) PRIMARY KEY,
  session_id      VARCHAR(64) NOT NULL,
  turn_id         INTEGER NOT NULL DEFAULT 0,

  -- 任务命令（Fast → Slow 的结构化指令）
  command         JSONB NOT NULL,
  -- { action, task, constraints, query_keys, relevant_facts, user_preference_summary, priority, max_execution_time_ms }

  -- 原始用户输入（供 Slow 查询）
  user_input      TEXT NOT NULL,
  constraints     TEXT[] DEFAULT '{}',

  -- Phase 1.5: 任务类型 + 任务卡片 JSONB
  task_type       VARCHAR(20) DEFAULT 'analysis',
  -- research | analysis | code | creative | comparison

  task_brief      JSONB DEFAULT '{}',
  -- Phase 1.5: 完整任务卡片，包含 relevant_facts / user_preference_summary / priority 等

  -- Fast 模型写入：执行过程中的观察
  fast_observations JSONB DEFAULT '[]',
  -- [{timestamp: number, observation: string}]

  -- Slow 模型写入：执行轨迹
  slow_execution  JSONB DEFAULT '{}',
  -- {started_at: string, deviations: string[], result: string, errors: string[]}

  -- Phase 1.5: 状态机
  state           VARCHAR(20) DEFAULT 'chattering',
  -- chattering | clarifying | task_ready | executing | done | failed | cancelled

  status          VARCHAR(16) DEFAULT 'pending',
  -- pending → running → done | failed | cancelled

  delivered       BOOLEAN DEFAULT FALSE,
  -- 结果是否已推送给用户

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ta_session ON task_archives(session_id);
CREATE INDEX IF NOT EXISTS idx_ta_status ON task_archives(status) WHERE status != 'done';
CREATE INDEX IF NOT EXISTS idx_ta_command ON task_archives USING GIN (command);
CREATE INDEX IF NOT EXISTS idx_ta_task_brief ON task_archives USING GIN (task_brief);
CREATE INDEX IF NOT EXISTS idx_ta_state ON task_archives(state);

-- ── Migration 010: Phase 3.0 Manager-Worker Runtime ────────────────────────────
BEGIN;

ALTER TABLE task_archives ADD COLUMN IF NOT EXISTS manager_decision JSONB;
ALTER TABLE task_archives ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);

CREATE TABLE IF NOT EXISTS task_commands (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            VARCHAR(36),  -- FK to tasks(id) — NOTE: no FK constraint (tasks.id is VARCHAR)
  archive_id         VARCHAR(36),   -- FK to task_archives(id) — no FK constraint
  user_id            VARCHAR(64) NOT NULL,
  issuer_role        VARCHAR(50) NOT NULL DEFAULT 'fast_manager',
  command_type       VARCHAR(50) NOT NULL,
  worker_hint        VARCHAR(50),
  priority           VARCHAR(20) NOT NULL DEFAULT 'normal',
  status             VARCHAR(20) NOT NULL DEFAULT 'queued',
  payload_json       JSONB NOT NULL,
  idempotency_key    VARCHAR(120),
  timeout_sec        INTEGER,
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  error_message      TEXT
);

CREATE INDEX IF NOT EXISTS task_commands_task_id_idx ON task_commands(task_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS task_commands_archive_id_idx ON task_commands(archive_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS task_commands_status_idx ON task_commands(status);
CREATE UNIQUE INDEX IF NOT EXISTS task_commands_idempotency_key_idx ON task_commands(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_worker_results (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            VARCHAR(36),
  archive_id         VARCHAR(36),
  command_id         UUID,
  user_id            VARCHAR(64) NOT NULL,
  worker_role        VARCHAR(50) NOT NULL,
  result_type        VARCHAR(50) NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'completed',
  summary            TEXT NOT NULL DEFAULT '',
  result_json        JSONB NOT NULL DEFAULT '{}',
  confidence         REAL,
  tokens_input       INTEGER,
  tokens_output      INTEGER,
  cost_usd           REAL,
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message      TEXT
);

CREATE INDEX IF NOT EXISTS task_worker_results_task_id_idx ON task_worker_results(task_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS task_worker_results_command_id_idx ON task_worker_results(command_id);

COMMIT;

-- ── Migration 011: Archive Events + Audit Trail ───────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS task_archive_events (
  id          VARCHAR(36) PRIMARY KEY,
  archive_id  VARCHAR(36),
  task_id     VARCHAR(36),
  event_type  VARCHAR(50) NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  actor       VARCHAR(50),
  user_id     VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tae_archive_id ON task_archive_events(archive_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_tae_task_id ON task_archive_events(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tae_event_type ON task_archive_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tae_actor ON task_archive_events(actor, created_at DESC) WHERE actor IS NOT NULL;

COMMIT;

-- ── Migration 012: G4 Delegation Learning Loop ──────────────────────────────────
-- Gated Delegation v2 事实表：G1(系统置信度) → G2(Policy校准) → G3(Rerank) → 执行结果
-- 用途：离线分析、benchmark 改进、用户层面行为学习
BEGIN;

CREATE TABLE IF NOT EXISTS delegation_logs (
  -- PK
  id                VARCHAR(36) PRIMARY KEY,

  -- 决策上下文
  user_id           VARCHAR(64) NOT NULL,
  session_id        VARCHAR(64) NOT NULL,
  turn_id           INTEGER     NOT NULL DEFAULT 0,
  task_id           VARCHAR(64),

  -- Pipeline 版本（用于回溯不同版本的 gate 行为）
  routing_version   VARCHAR(20) NOT NULL DEFAULT 'v2',

  -- G0: LLM 原始输出
  llm_scores        JSONB NOT NULL,
  -- { direct_answer, ask_clarification, delegate_to_slow, execute_task }
  llm_confidence    REAL  NOT NULL,

  -- G1: System Confidence
  system_confidence  REAL  NOT NULL,

  -- G2: Policy Calibration
  calibrated_scores  JSONB NOT NULL,
  -- { direct_answer, ask_clarification, delegate_to_slow, execute_task }
  policy_overrides   JSONB NOT NULL DEFAULT '[]',
  -- [{ rule, action, target, original_score, adjusted_score, reason }]
  g2_final_action    VARCHAR(30),

  -- G3: Rerank
  did_rerank         BOOLEAN NOT NULL DEFAULT FALSE,
  rerank_gap         REAL,
  rerank_rules       JSONB   NOT NULL DEFAULT '[]',
  g3_final_action    VARCHAR(30),

  -- 最终路由决策
  routed_action      VARCHAR(30) NOT NULL,
  routing_reason     TEXT,

  -- 执行结果（异步回写，可为 NULL 表示尚未执行完）
  execution_status   VARCHAR(20),   -- pending | success | failed | timeout
  execution_correct  BOOLEAN,
  error_message      TEXT,
  model_used         VARCHAR(100),
  latency_ms         INTEGER,
  cost_usd           DECIMAL(10, 6),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dl_user_time     ON delegation_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dl_session      ON delegation_logs(session_id, turn_id DESC);
CREATE INDEX IF NOT EXISTS idx_dl_routed_action ON delegation_logs(routed_action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dl_execution    ON delegation_logs(execution_status) WHERE execution_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dl_g2_final      ON delegation_logs(g2_final_action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dl_g3_final      ON delegation_logs(g3_final_action, created_at DESC) WHERE g3_final_action IS NOT NULL;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- Sprint 62 — Prompt Template System (Migration 014)
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS prompt_templates (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT DEFAULT '',
  version     INTEGER NOT NULL DEFAULT 1,
  content     TEXT NOT NULL,
  scope       VARCHAR(20) NOT NULL DEFAULT 'global',
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  VARCHAR(64) DEFAULT 'system',
  tags        TEXT[] DEFAULT '{}',
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pt_active ON prompt_templates(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pt_scope  ON prompt_templates(scope);
CREATE INDEX IF NOT EXISTS idx_pt_name   ON prompt_templates(name);

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- Sprint 63 — Memory / Cross-Session Context (Migration 015)
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS session_summaries (
  id              VARCHAR(36) PRIMARY KEY,
  session_id      VARCHAR(64) NOT NULL UNIQUE,
  user_id         VARCHAR(64) NOT NULL,
  topic           TEXT,
  topic_keywords  TEXT[] DEFAULT '{}',
  summary_text    TEXT,
  key_facts       TEXT[] DEFAULT '{}',
  decisions_made  TEXT[] DEFAULT '{}',
  open_questions  TEXT[] DEFAULT '{}',
  preferences     TEXT[] DEFAULT '{}',
  turn_count      INTEGER DEFAULT 0,
  fast_count      INTEGER DEFAULT 0,
  slow_count      INTEGER DEFAULT 0,
  generated_by    VARCHAR(20) DEFAULT 'auto',
  model_used      VARCHAR(100),
  version         INTEGER DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ss_user_time  ON session_summaries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ss_session    ON session_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_ss_topic      ON session_summaries USING GIN (topic_keywords);

-- sessions 表扩展字段
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_topic TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_topic_updated TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS turn_count INTEGER DEFAULT 0;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- Sprint 63 — Delegation Logs Success Fields (Migration 013)
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE delegation_logs ADD COLUMN IF NOT EXISTS routing_success BOOLEAN;
ALTER TABLE delegation_logs ADD COLUMN IF NOT EXISTS value_success VARCHAR(20)
  CHECK (value_success IS NULL OR value_success IN ('better', 'same', 'worse'));
ALTER TABLE delegation_logs ADD COLUMN IF NOT EXISTS user_success BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_dl_routing_success ON delegation_logs(routing_success, created_at DESC)
  WHERE routing_success IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dl_value_success   ON delegation_logs(value_success, created_at DESC)
  WHERE value_success IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dl_user_success     ON delegation_logs(user_success, created_at DESC)
  WHERE user_success IS NOT NULL;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- Sprint 64 — Permission-Gated Worker Architecture (Migration 016)
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS permission_requests (
  id              VARCHAR(64)  PRIMARY KEY,
  task_id         VARCHAR(64)  NOT NULL,
  worker_id       VARCHAR(64)  NOT NULL,
  user_id         VARCHAR(64)  NOT NULL,
  session_id      VARCHAR(64)  NOT NULL,
  field_name      VARCHAR(128) NOT NULL,
  field_key       VARCHAR(128) NOT NULL,
  purpose         TEXT         NOT NULL,
  value_preview   VARCHAR(256),
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
  expires_in      INTEGER      NOT NULL DEFAULT 300,
  approved_scope  VARCHAR(256),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_pr_user_pending ON permission_requests(user_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pr_task         ON permission_requests(task_id);
CREATE INDEX IF NOT EXISTS idx_pr_session      ON permission_requests(session_id);

CREATE TABLE IF NOT EXISTS task_workspaces (
  id            VARCHAR(64)  PRIMARY KEY,
  task_id       VARCHAR(64)  NOT NULL UNIQUE,
  user_id       VARCHAR(64)  NOT NULL,
  session_id    VARCHAR(64)  NOT NULL,
  objective     TEXT         NOT NULL,
  constraints   TEXT[]      NOT NULL DEFAULT '{}',
  shared_outputs JSONB       NOT NULL DEFAULT '{}',
  access_log    JSONB       NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tw_task ON task_workspaces(task_id);
CREATE INDEX IF NOT EXISTS idx_tw_user ON task_workspaces(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS scoped_tokens (
  id           VARCHAR(64)  PRIMARY KEY,
  token        VARCHAR(128) NOT NULL UNIQUE,
  task_id      VARCHAR(64)  NOT NULL,
  worker_id    VARCHAR(64)  NOT NULL,
  user_id      VARCHAR(64)  NOT NULL,
  scope        TEXT[]       NOT NULL,
  expires_at   TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_st_token   ON scoped_tokens(token);
CREATE INDEX IF NOT EXISTS idx_st_task    ON scoped_tokens(task_id);
CREATE INDEX IF NOT EXISTS idx_st_expires ON scoped_tokens(expires_at) WHERE expires_at > NOW();

COMMIT;





