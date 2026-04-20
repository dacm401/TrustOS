# SmartRouter Pro — Task Archive 实现指南

> 版本：v1.0 | 日期：2026-04-19 | 状态：**PROPOSED — 可直接落 SQL / 落代码**
> 对应：`PHASE-3-MANAGER-WORKER-SPEC.md` / `docs/MANAGER-DECISION-TYPES.md`
> 关联：`backend/src/db/schema.sql`（现有） / `backend/src/db/repositories.ts`（现有）

---

## 1. 设计决策记录（已在 Review 中确认）

| 决策 | 结论 | 理由 |
|------|------|------|
| 四表结构 | ✅ 采纳 | 分工清晰 |
| `task_archives` ↔ `tasks` 一对一 FK | ✅ 采纳 | archive 是工作台，非主表 |
| `idempotency_key` 防重 | ✅ 采纳 | 命令幂等性关键 |
| Archive JSONB 字段精简 | ✅ 采纳 | constraints/confirmed_facts → 直接放 command payload |
| `task_archive_events` 表 | ❌ Phase 2+再加 | Phase 0 先跑通核心读写 |
| JSON Schema Draft 2020-12 | ❌ 改用简化版 + ajv | 轻量运行时校验足够 |

---

## 2. SQL 建表脚本（可直接执行）

保存为：`backend/src/db/migrations/009_task_archive.sql`

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- SmartRouter Pro — Task Archive Schema
-- Migration: 009_task_archive
-- Phase: Phase 3.0 Manager-Worker Runtime
-- Date: 2026-04-19
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 2.1 task_archives ──────────────────────────────────────────────────────
-- 任务级共享工作台主记录。
-- 与 tasks 一对一关联（task_id FK），每个任务对应一个 Archive。
-- Phase 0: 精简版，只存标量字段 + 最新 summary，结构化数据放 command/result 表。

CREATE TABLE IF NOT EXISTS task_archives (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  user_id               VARCHAR(64) NOT NULL,
  session_id            VARCHAR(64),

  -- Manager 写入（Phase 0 核心字段）
  state                 VARCHAR(30) NOT NULL DEFAULT 'new',
  manager_decision_json JSONB NOT NULL DEFAULT '{}',
  task_brief            TEXT NOT NULL DEFAULT '',
  goal                  TEXT NOT NULL DEFAULT '',

  -- Clarifying（复用 Phase 1.5）
  clarification_json    JSONB,
  confirmed_facts        TEXT[] NOT NULL DEFAULT '{}',

  -- 当前 command 引用
  current_command_id     UUID,

  -- Manager 最终汇总摘要（Worker 结果经 Manager 表达后写入）
  latest_manager_summary TEXT NOT NULL DEFAULT '',

  -- Archive 版本号（每次 archive 更新 +1，用于乐观锁）
  revision              INTEGER NOT NULL DEFAULT 1,

  -- 审计
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_archives_user_id_idx
  ON task_archives(user_id);

CREATE INDEX IF NOT EXISTS task_archives_state_idx
  ON task_archives(state);

CREATE INDEX IF NOT EXISTS task_archives_created_at_idx
  ON task_archives(created_at DESC);

-- updated_at 自动更新触发器
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_archives_updated_at ON task_archives;
CREATE TRIGGER trg_task_archives_updated_at
BEFORE UPDATE ON task_archives
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 2.2 task_commands ───────────────────────────────────────────────────────
-- Manager 发出的结构化命令。
-- 每个 Archive 可发出多个 Command（串行委托场景）。

CREATE TABLE IF NOT EXISTS task_commands (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  archive_id         UUID NOT NULL REFERENCES task_archives(id) ON DELETE CASCADE,
  user_id            VARCHAR(64) NOT NULL,

  -- 发行者（Phase 0 固定为 fast_manager，后续可扩展）
  issuer_role        VARCHAR(50) NOT NULL DEFAULT 'fast_manager',

  -- Command 核心
  command_type       VARCHAR(50) NOT NULL,
  worker_hint        VARCHAR(50),
  priority           VARCHAR(20) NOT NULL DEFAULT 'normal',
  status             VARCHAR(20) NOT NULL DEFAULT 'queued',

  -- Command payload（完整 CommandPayload JSONB）
  payload_json        JSONB NOT NULL,

  -- 幂等键（同一 turn_id + command_type 只允许一个 pending 命令）
  idempotency_key     VARCHAR(120),

  -- 超时
  timeout_sec         INTEGER,

  -- 时间戳
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,

  -- 错误信息
  error_message       TEXT
);

CREATE INDEX IF NOT EXISTS task_commands_task_id_idx
  ON task_commands(task_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS task_commands_archive_id_idx
  ON task_commands(archive_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS task_commands_status_idx
  ON task_commands(status);

CREATE UNIQUE INDEX IF NOT EXISTS task_commands_idempotency_key_idx
  ON task_commands(idempotency_key)
  WHERE idempotency_key IS NOT NULL;


-- ── 2.3 task_worker_results ────────────────────────────────────────────────
-- Worker 完成后的结构化结果。
-- 每个 Command 对应一个 Result（1:1）。

CREATE TABLE IF NOT EXISTS task_worker_results (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  archive_id         UUID NOT NULL REFERENCES task_archives(id) ON DELETE CASCADE,
  command_id         UUID NOT NULL REFERENCES task_commands(id) ON DELETE CASCADE,
  user_id            VARCHAR(64) NOT NULL,

  worker_role        VARCHAR(50) NOT NULL,
  result_type        VARCHAR(50) NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'completed',

  -- Worker 产出的核心内容
  summary            TEXT NOT NULL DEFAULT '',
  result_json        JSONB NOT NULL DEFAULT '{}',
  confidence         REAL,

  -- 资源消耗
  tokens_input       INTEGER,
  tokens_output      INTEGER,
  cost_usd           REAL,

  -- 时间
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  error_message       TEXT
);

CREATE INDEX IF NOT EXISTS task_worker_results_task_id_idx
  ON task_worker_results(task_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS task_worker_results_command_id_idx
  ON task_worker_results(command_id);


-- ── 2.4 task_archives FK 补充 ──────────────────────────────────────────────
-- 将 current_command_id / latest_result_id 的 FK 约束补充到已创建的表

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'task_archives_current_command_fk'
  ) THEN
    ALTER TABLE task_archives
      ADD CONSTRAINT task_archives_current_command_fk
      FOREIGN KEY (current_command_id)
      REFERENCES task_commands(id)
      ON DELETE SET NULL;
  END IF;
END $$;


COMMIT;
```

---

## 3. TypeScript Repository 接口设计

保存为：`backend/src/db/task-archive-repo.ts`

```typescript
// backend/src/db/task-archive-repo.ts

import { query, uuid } from "../db";
import type {
  ManagerDecision,
  CommandPayload,
  WorkerResult,
} from "../types";

// ── 类型定义 ─────────────────────────────────────────────────────────────────

export interface TaskArchiveRecord {
  id: string;
  task_id: string;
  user_id: string;
  session_id: string | null;
  state: ArchiveState;
  manager_decision_json: ManagerDecision;
  task_brief: string;
  goal: string;
  clarification_json: ManagerDecision["clarification"] | null;
  confirmed_facts: string[];
  current_command_id: string | null;
  latest_manager_summary: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface TaskCommandRecord {
  id: string;
  task_id: string;
  archive_id: string;
  user_id: string;
  issuer_role: string;
  command_type: string;
  worker_hint: string | null;
  priority: string;
  status: CommandStatus;
  payload_json: CommandPayload;
  idempotency_key: string | null;
  timeout_sec: number | null;
  issued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

export interface TaskWorkerResultRecord {
  id: string;
  task_id: string;
  archive_id: string;
  command_id: string;
  user_id: string;
  worker_role: string;
  result_type: string;
  status: string;
  summary: string;
  result_json: Record<string, unknown>;
  confidence: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
  started_at: string | null;
  completed_at: string;
  error_message: string | null;
}

// ── 枚举 ─────────────────────────────────────────────────────────────────────

export type ArchiveState =
  | "new"
  | "clarifying"
  | "ready"
  | "delegated"
  | "executing"
  | "waiting_result"
  | "synthesizing"
  | "completed"
  | "failed"
  | "cancelled";

export type CommandStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

// ── TaskArchiveRepo ───────────────────────────────────────────────────────────

export const TaskArchiveRepo = {
  /**
   * 创建 Archive 记录。
   * 在 ManagerDecision 生成后立即调用。
   */
  async create(input: {
    task_id: string;
    user_id: string;
    session_id?: string;
    decision: ManagerDecision;
    task_brief: string;
    goal: string;
  }): Promise<TaskArchiveRecord> {
    const id = uuid();
    const result = await query(
      `INSERT INTO task_archives
        (id, task_id, user_id, session_id, state, manager_decision_json,
         task_brief, goal, confirmed_facts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}')
       RETURNING *`,
      [
        id,
        input.task_id,
        input.user_id,
        input.session_id ?? null,
        "delegated",
        JSON.stringify(input.decision),
        input.task_brief,
        input.goal,
      ]
    );
    return mapArchiveRow(result.rows[0]);
  },

  /**
   * 按 task_id 读取 Archive（Phase 0 主要读取路径）。
   */
  async getByTaskId(taskId: string, userId: string): Promise<TaskArchiveRecord | null> {
    const result = await query(
      `SELECT * FROM task_archives WHERE task_id = $1 AND user_id = $2 LIMIT 1`,
      [taskId, userId]
    );
    return result.rows[0] ? mapArchiveRow(result.rows[0]) : null;
  },

  /**
   * 更新 state 和 revision（乐观锁）。
   */
  async updateState(
    archiveId: string,
    userId: string,
    newState: ArchiveState,
    expectedRevision: number
  ): Promise<boolean> {
    const result = await query(
      `UPDATE task_archives
       SET state = $1, revision = revision + 1
       WHERE id = $2 AND user_id = $3 AND revision = $4
       RETURNING id`,
      [newState, archiveId, userId, expectedRevision]
    );
    return result.rowCount > 0;
  },

  /**
   * 更新 Manager 汇总摘要（Manager 表达完成后调用）。
   */
  async setManagerSummary(
    archiveId: string,
    userId: string,
    summary: string
  ): Promise<void> {
    await query(
      `UPDATE task_archives
       SET latest_manager_summary = $1, state = 'completed', revision = revision + 1
       WHERE id = $2 AND user_id = $3`,
      [summary, archiveId, userId]
    );
  },

  /**
   * 设置当前 active command_id（每次新 command 发出时调用）。
   */
  async setCurrentCommand(
    archiveId: string,
    commandId: string
  ): Promise<void> {
    await query(
      `UPDATE task_archives SET current_command_id = $1 WHERE id = $2`,
      [commandId, archiveId]
    );
  },

  /**
   * 设置 Clarification（ask_clarification 时调用）。
   */
  async setClarification(
    archiveId: string,
    clarification: ManagerDecision["clarification"]
  ): Promise<void> {
    await query(
      `UPDATE task_archives
       SET clarification_json = $1, state = 'clarifying', revision = revision + 1
       WHERE id = $2`,
      [JSON.stringify(clarification), archiveId]
    );
  },

  /**
   * 追加 confirmed fact（用户回答澄清问题后调用）。
   */
  async appendConfirmedFact(
    archiveId: string,
    fact: string
  ): Promise<void> {
    await query(
      `UPDATE task_archives
       SET confirmed_facts = array_append(confirmed_facts, $1),
           state = 'ready', revision = revision + 1
       WHERE id = $2`,
      [fact, archiveId]
    );
  },
} as const;

// ── TaskCommandRepo ────────────────────────────────────────────────────────────

export const TaskCommandRepo = {
  /**
   * 创建 Command 记录（幂等插入）。
   */
  async create(input: {
    task_id: string;
    archive_id: string;
    user_id: string;
    command_type: string;
    worker_hint?: string;
    priority?: string;
    payload: CommandPayload;
    idempotency_key?: string;
    timeout_sec?: number;
  }): Promise<TaskCommandRecord> {
    const id = uuid();
    const result = await query(
      `INSERT INTO task_commands
        (id, task_id, archive_id, user_id, command_type, worker_hint,
         priority, payload_json, idempotency_key, timeout_sec)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        id,
        input.task_id,
        input.archive_id,
        input.user_id,
        input.command_type,
        input.worker_hint ?? null,
        input.priority ?? "normal",
        JSON.stringify(input.payload),
        input.idempotency_key ?? null,
        input.timeout_sec ?? null,
      ]
    );
    return mapCommandRow(result.rows[0]);
  },

  /**
   * 按 ID 读取 Command。
   */
  async getById(id: string, userId: string): Promise<TaskCommandRecord | null> {
    const result = await query(
      `SELECT * FROM task_commands WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [id, userId]
    );
    return result.rows[0] ? mapCommandRow(result.rows[0]) : null;
  },

  /**
   * 取任务最新 Command（用于 Worker 拉取）。
   */
  async getLatestByTask(taskId: string): Promise<TaskCommandRecord | null> {
    const result = await query(
      `SELECT * FROM task_commands
       WHERE task_id = $1 AND status = 'queued'
       ORDER BY issued_at DESC LIMIT 1`,
      [taskId]
    );
    return result.rows[0] ? mapCommandRow(result.rows[0]) : null;
  },

  /**
   * 更新 Command status（Worker 启动/完成/失败时调用）。
   */
  async updateStatus(
    id: string,
    status: CommandStatus,
    patch?: {
      started_at?: Date;
      finished_at?: Date;
      error_message?: string;
    }
  ): Promise<void> {
    await query(
      `UPDATE task_commands
       SET status = $1,
           started_at = COALESCE($2, started_at),
           finished_at = COALESCE($3, finished_at),
           error_message = $4
       WHERE id = $5`,
      [
        status,
        patch?.started_at?.toISOString() ?? null,
        patch?.finished_at?.toISOString() ?? null,
        patch?.error_message ?? null,
        id,
      ]
    );
  },
} as const;

// ── TaskWorkerResultRepo ──────────────────────────────────────────────────────

export const TaskWorkerResultRepo = {
  /**
   * 创建 Worker Result（Worker 完成后调用）。
   */
  async create(input: {
    task_id: string;
    archive_id: string;
    command_id: string;
    user_id: string;
    worker_role: string;
    result: WorkerResult;
    tokens_input?: number;
    tokens_output?: number;
    cost_usd?: number;
    started_at?: Date;
  }): Promise<TaskWorkerResultRecord> {
    const id = uuid();
    const result = await query(
      `INSERT INTO task_worker_results
        (id, task_id, archive_id, command_id, user_id, worker_role,
         result_type, status, summary, result_json, confidence,
         tokens_input, tokens_output, cost_usd, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        id,
        input.task_id,
        input.archive_id,
        input.command_id,
        input.user_id,
        input.worker_role,
        input.result.structured_result ? Object.keys(input.result.structured_result)[0] ?? "analysis" : "analysis",
        input.result.status,
        input.result.summary,
        JSON.stringify(input.result.structured_result),
        input.result.confidence ?? null,
        input.tokens_input ?? null,
        input.tokens_output ?? null,
        input.cost_usd ?? null,
        input.started_at?.toISOString() ?? null,
      ]
    );
    return mapResultRow(result.rows[0]);
  },

  /**
   * 按 Command ID 读取结果（Manager 汇总时调用）。
   */
  async getByCommandId(commandId: string): Promise<TaskWorkerResultRecord | null> {
    const result = await query(
      `SELECT * FROM task_worker_results WHERE command_id = $1 LIMIT 1`,
      [commandId]
    );
    return result.rows[0] ? mapResultRow(result.rows[0]) : null;
  },

  /**
   * 按 task_id 读取所有结果（Manager 汇总时调用）。
   */
  async listByTask(taskId: string): Promise<TaskWorkerResultRecord[]> {
    const result = await query(
      `SELECT * FROM task_worker_results
       WHERE task_id = $1 ORDER BY completed_at ASC`,
      [taskId]
    );
    return result.rows.map(mapResultRow);
  },
} as const;

// ── 行列映射 ──────────────────────────────────────────────────────────────────

function mapArchiveRow(row: Record<string, unknown>): TaskArchiveRecord {
  return {
    ...row,
    manager_decision_json: typeof row.manager_decision_json === "string"
      ? JSON.parse(row.manager_decision_json as string)
      : row.manager_decision_json,
  } as TaskArchiveRecord;
}

function mapCommandRow(row: Record<string, unknown>): TaskCommandRecord {
  return {
    ...row,
    payload_json: typeof row.payload_json === "string"
      ? JSON.parse(row.payload_json as string)
      : row.payload_json,
  } as TaskCommandRecord;
}

function mapResultRow(row: Record<string, unknown>): TaskWorkerResultRecord {
  return {
    ...row,
    result_json: typeof row.result_json === "string"
      ? JSON.parse(row.result_json as string)
      : row.result_json,
  } as TaskWorkerResultRecord;
}
```

---

## 4. chat.ts 接入伪代码（Phase 2 主链路）

```typescript
// backend/src/api/chat.ts — Phase 3.0 Manager-Worker 主链路（伪代码）

import {
  validateManagerDecision,
  validateManagerDecisionSemantic,
} from "../orchestrator/decision-validator";
import { TaskArchiveRepo, TaskCommandRepo, TaskWorkerResultRepo } from "../db/task-archive-repo";
import { MANAGER_SYSTEM_PROMPT } from "../prompt/manager-prompt";
import type { ManagerDecision, WorkerResult } from "../types";

// ── Phase 2: chat.ts 新增 Manager-Worker 分支 ────────────────────────────────

async function handleManagerWorkerFlow(
  ctx: Context,
  req: ChatRequest,
  fastMessages: ChatMessage[],
  taskId: string,
  userId: string,
  emitSSE: (event: SSEEvent) => Promise<void>,
  emitComfort: () => Promise<void>
): Promise<string> {
  // ── Step 1: Fast Manager 生成决策 ────────────────────────────────────────
  emitSSE({ type: "manager_thinking" });

  const managerOutput = await callModelFull({
    model: config.fast_model,
    messages: buildManagerMessages(fastMessages, req),
    system: MANAGER_SYSTEM_PROMPT,
    // Phase 1: 注入 manager tools
    // Phase 2: 改为 function_calling
  });

  // ── Step 2: 校验 ManagerDecision ───────────────────────────────────────────
  const rawDecision = parseManagerDecisionText(managerOutput);
  const decision = validateManagerDecision(rawDecision);

  if (!decision || !validateManagerDecisionSemantic(decision)) {
    console.warn("[ManagerWorker] decision invalid, fallback to old path");
    // → fallback 到 Phase 2.0 旧路由
    return handleFallback(ctx, req, taskId);
  }

  emitSSE({ type: "manager_decision", decision });

  // ── Step 3: 分支处理 ──────────────────────────────────────────────────────

  switch (decision.decision_type) {
    case "direct_answer":
      return decision.direct_response!.content;

    case "ask_clarification":
      return handleClarification(ctx, req, decision, taskId, userId, emitSSE);

    case "delegate_to_slow":
      return handleDelegateToSlow(
        ctx, req, decision, taskId, userId, emitSSE, emitComfort
      );

    case "execute_task":
      return handleExecuteTask(
        ctx, req, decision, taskId, userId, emitSSE, emitComfort
      );
  }
}

// ── delegate_to_slow 完整流程 ─────────────────────────────────────────────────

async function handleDelegateToSlow(
  ctx: Context,
  req: ChatRequest,
  decision: ManagerDecision,
  taskId: string,
  userId: string,
  emitSSE: (event: SSEEvent) => Promise<void>,
  emitComfort: () => Promise<void>
): Promise<string> {
  // ── Step 3a: 写入 Archive ─────────────────────────────────────────────────
  const archive = await TaskArchiveRepo.create({
    task_id: taskId,
    user_id: userId,
    session_id: req.session_id,
    decision,
    task_brief: decision.command!.task_brief,
    goal: decision.command!.goal,
  });

  // ── Step 3b: 写入 Command（幂等） ──────────────────────────────────────────
  const idempotencyKey = `${req.session_id}:${req.message}:${decision.command!.command_type}`;
  const command = await TaskCommandRepo.create({
    task_id: taskId,
    archive_id: archive.id,
    user_id: userId,
    command_type: decision.command!.command_type,
    worker_hint: decision.command!.worker_hint ?? "slow_analyst",
    priority: decision.command!.priority ?? "normal",
    payload: decision.command!,
    idempotency_key: idempotencyKey,
    timeout_sec: decision.command!.timeout_sec ?? 120,
  });

  await TaskArchiveRepo.setCurrentCommand(archive.id, command.id);
  await TaskArchiveRepo.updateState(archive.id, userId, "delegated", archive.revision);

  emitSSE({
    type: "command_issued",
    command_id: command.id,
    delegated_to: command.worker_hint as WorkerHint,
    task_id: taskId,
    timestamp: new Date().toISOString(),
  });

  // ── Step 3c: 立即安抚用户（Phase 2.0 自适应安抚复用） ──────────────────────
  emitComfort(); // 立即发出 "让我想想..."

  // ── Step 3d: 启动 Slow Worker（后台，Phase 2.0 复用现有 slowFlow） ──────────
  // Slow Worker 在后台：
  //   1. 拉取 Command
  //   2. 消费 Command.payload（不读 history）
  //   3. 执行分析
  //   4. 写入 WorkerResult
  //   5. 更新 Archive state
  triggerSlowWorkerBackground(taskId, command.id, userId);

  // ── Step 3e: 自适应轮询等待结果 ───────────────────────────────────────────
  const workerResult = await pollWorkerResult({
    commandId: command.id,
    timeoutMs: (decision.command!.timeout_sec ?? 120) * 1000,
    pollIntervals: [2000, 3000, 5000], // 自适应轮询
    onProgress: (elapsed) => {
      if (elapsed > 30000) emitSSE({ type: "worker_progress", message: "正在分析..." });
      if (elapsed > 60000) emitSSE({ type: "worker_progress", message: "资料已找到，正在整理..." });
    },
  });

  if (!workerResult) {
    return "抱歉，分析超时了，能换个方式问吗？";
  }

  // ── Step 3f: Manager 汇总 + 表达（Phase 3） ─────────────────────────────────
  const managerSynthesis = await synthesizeAndExpress({
    decision,
    workerResult,
    userId,
    req,
  });

  // ── Step 3g: Archive 最终写入 ───────────────────────────────────────────────
  await TaskArchiveRepo.setManagerSummary(
    archive.id,
    userId,
    managerSynthesis.summary
  );

  emitSSE({
    type: "manager_synthesized",
    summary: managerSynthesis.summary,
    timestamp: new Date().toISOString(),
  });

  return managerSynthesis.response;
}

// ── 轮询辅助（Phase 2.0 自适应轮询复用）──────────────────────────────────────

async function pollWorkerResult(opts: {
  commandId: string;
  timeoutMs: number;
  pollIntervals: number[];
  onProgress: (elapsedMs: number) => void;
}): Promise<TaskWorkerResultRecord | null> {
  const start = Date.now();
  let intervalIndex = 0;

  while (Date.now() - start < opts.timeoutMs) {
    await sleep(opts.pollIntervals[Math.min(intervalIndex, opts.pollIntervals.length - 1)]);
    intervalIndex++;

    // 自适应：随时间推移，轮询间隔拉长
    if (Date.now() - start > 60000 && intervalIndex < opts.pollIntervals.length) {
      intervalIndex = opts.pollIntervals.length - 1; // 稳定在最大间隔
    }

    opts.onProgress(Date.now() - start);

    const result = await TaskWorkerResultRepo.getByCommandId(opts.commandId);
    if (result) return result;
  }
  return null;
}

// ── Manager 汇总 + 表达（Phase 3）────────────────────────────────────────────

async function synthesizeAndExpress(opts: {
  decision: ManagerDecision;
  workerResult: TaskWorkerResultRecord;
  userId: string;
  req: ChatRequest;
}): Promise<{ summary: string; response: string }> {
  // Phase 3 实现：
  // Fast Manager 读取 WorkerResult，
  // 按用户风格/人格生成最终回复，
  // 返回 { summary, response }
  //
  // Phase 2 先简单实现：
  // summary = workerResult.summary
  // response = workerResult.summary（直接透出）

  return {
    summary: opts.workerResult.summary,
    response: opts.workerResult.summary,
  };
}

// ── Fallback（Phase 0/1 新架构不合法时走旧链路）────────────────────────────────

async function handleFallback(
  ctx: Context,
  req: ChatRequest,
  taskId: string
): Promise<string> {
  // 直接复用 Phase 2.0 的 orchestratorFlow
  return orchestratorFlow(ctx, req, taskId);
}

// ── 辅助：解析 Manager 文本输出为 Decision ──────────────────────────────────────

function parseManagerDecisionText(text: string): unknown {
  // Phase 0: 特殊标记解析
  // Phase 1: 正则找 JSON 块
  const match = text.match(/```json\s*([\s\S]*?)\s*```|(\{[\s\S]*\})/);
  if (match) {
    const jsonStr = match[1] ?? match[2];
    try {
      return JSON.parse(jsonStr.trim());
    } catch {
      return null;
    }
  }
  return null;
}
```

---

## 5. 迁移策略（4 阶段）

| 阶段 | 内容 | 影响范围 | 风险 |
|------|------|---------|------|
| **阶段 1：只建表，不接主链路** | 执行 `009_task_archive.sql` | 无 | 低 |
| **阶段 2：L2 路径写 Archive（部分流量）** | `delegate_to_slow` 走新链路，direct_answer 走旧链路 | 仅 L2 委托 | 中 |
| **阶段 3：Clarifying + Execute 接入** | ask_clarification / execute_task 接入 Archive | Clarifying / Execute | 低 |
| **阶段 4：Manager 汇总表达** | Fast 最终回复走新链路 | L2 全链路 | 中 |

---

## 6. 关键实现检查清单（可直接用）

```markdown
## Sprint 36 Phase 1 交付检查清单

### SQL 建表
- [ ] 执行 `backend/src/db/migrations/009_task_archive.sql`
- [ ] 验证三张表创建成功：`task_archives`, `task_commands`, `task_worker_results`
- [ ] 验证 FK 约束（`task_archives.current_command_id` → `task_commands.id`）
- [ ] 验证 `idempotency_key` 唯一索引
- [ ] tsc --noEmit 零错误

### Repository 层
- [ ] `TaskArchiveRepo.create()` 写入 + 返回正确
- [ ] `TaskArchiveRepo.getByTaskId()` 读取正确
- [ ] `TaskCommandRepo.create()` 幂等键防重
- [ ] `TaskCommandRepo.getLatestByTask()` 正确返回最新 queued 命令
- [ ] `TaskWorkerResultRepo.getByCommandId()` 正确关联
- [ ] 单元测试覆盖 3 个 Repo（mock pg）

### chat.ts 接入
- [ ] `handleManagerWorkerFlow()` 函数存在
- [ ] `handleDelegateToSlow()` 函数存在
- [ ] Archive + Command 写入成功
- [ ] `pollWorkerResult()` 自适应轮询正确
- [ ] SSE manager_decision 事件发出
- [ ] SSE command_issued 事件发出
- [ ] SSE worker_completed 事件发出
- [ ] Fallback 路径存在（旧 router 可达）

### 类型
- [ ] `types/index.ts` 导入 ManagerDecision / CommandPayload / WorkerResult
- [ ] ajv 校验函数 `validateManagerDecision()` 存在
- [ ] `parseManagerDecisionText()` 解析 JSON 正确

### Benchmark
- [ ] 手动测试：问"今天天气"
  - ManagerDecision 正确路由
  - Archive 写入成功
  - SSE 事件顺序正确
- [ ] Benchmark Suite L2 测试用例 ≥ 80% 通过
```

---

## 7. 与现有 DelegationArchiveEntry 的关系

Phase 1.5 已有的 `DelegationArchiveEntry`（`repositories.ts`）是轻量版：

| 维度 | DelegationArchiveEntry（Phase 1.5） | TaskArchive（Phase 3.0） |
|------|--------------------------------------|-------------------------|
| 定位 | Slow 模型共享工作台（简单版） | Manager-Worker 完整工作台 |
| command 结构 | `delegation_prompt`（文本） | `CommandPayload`（JSON） |
| worker result | `slow_result`（文本） | `WorkerResult`（结构化） |
| state 追踪 | 无 | 有（ArchiveState） |
| 幂等性 | 无 | idempotency_key |

**Phase 4 合并策略**：
- Phase 3.0 稳定后，将 `DelegationArchiveEntry` 的数据迁移到 `task_archives` + `task_commands`
- 删除 Phase 1.5 路径，保留迁移脚本

---

_文档日期：2026-04-19 | by 蟹小钳 🦀_
_对应：`PHASE-3-MANAGER-WORKER-SPEC.md` / `docs/MANAGER-DECISION-TYPES.md`_
