# SmartRouter Pro — ManagerDecision TypeScript 类型规范（Phase 3.0）

> 版本：v1.0 | 日期：2026-04-19 | 状态：**PROPOSED — 直接可贴入 `backend/src/types/index.ts`**
> 对应：`PHASE-3-MANAGER-WORKER-SPEC.md` / `docs/MANAGER-DECISION-SCHEMA.md`

---

## 1. 概述

本文档定义 Phase 3.0 Manager-Worker Runtime 的核心类型。

**设计原则**：
- Phase 0 最小化：只定义当前 Sprint 必须的类型
- 不为"可能用到"增加字段
- 与现有 `types/index.ts` 共存，不破坏现有类型

---

## 2. ManagerDecision 主类型（直接可贴入）

```typescript
// ── Phase 3.0: Manager-Worker Runtime ─────────────────────────────────────────

/**
 * ManagerDecision — Phase 3.0 Fast Manager 的标准输出协议。
 *
 * 职责：只表达"下一步怎么做"，不包含最终回答内容本身。
 * 流转：Fast Model → Runtime Orchestrator → 各 Worker / Archive
 *
 * @example
 * // direct_answer 示例
 * const decision: ManagerDecision = {
 *   schema_version: "manager_decision_v1",
 *   decision_type: "direct_answer",
 *   routing_layer: "L0",
 *   reason: "simple greeting, no context needed",
 *   confidence: 0.97,
 *   needs_archive: false,
 *   direct_response: {
 *     style: "concise",
 *     content: "你好！有什么可以帮你的吗？"
 *   }
 * };
 */
export interface ManagerDecision {
  /** Schema 版本，用于协议演进校验 */
  schema_version: "manager_decision_v1";
  /** 决策类型：Fast Manager 决定的下一步处理路径 */
  decision_type: ManagerDecisionType;
  /** 兼容现有前端/评测体系，与 decision_type 存在逻辑映射 */
  routing_layer: RoutingLayer;
  /** 决策原因，供日志/trace/debug 使用 */
  reason: string;
  /** 决策置信度 0.0 ~ 1.0 */
  confidence: number;
  /** 是否需要写入/更新 Task Archive */
  needs_archive: boolean;
  /** direct_answer 时的回复草稿 */
  direct_response?: DirectResponse;
  /** ask_clarification 时的澄清问题 */
  clarification?: ClarifyQuestion;
  /** delegate_to_slow / execute_task 时的结构化命令 */
  command?: CommandPayload;
}

/** 决策类型枚举（Phase 0 精简版，4 种） */
export type ManagerDecisionType =
  | "direct_answer"
  | "ask_clarification"
  | "delegate_to_slow"
  | "execute_task";

/** 路由层（兼容现有 L0/L1/L2/L3，与 decision_type 存在映射） */
export type RoutingLayer = "L0" | "L1" | "L2" | "L3";

/** decision_type ↔ routing_layer 默认映射表 */
export const DECISION_TO_LAYER: Record<ManagerDecisionType, RoutingLayer> = {
  direct_answer: "L0",
  ask_clarification: "L0",
  delegate_to_slow: "L2",
  execute_task: "L3",
};

/** 路由层 ↔ decision_type 默认反向映射（用于旧 router fallback） */
export const LAYER_TO_DECISION: Record<RoutingLayer, ManagerDecisionType> = {
  L0: "direct_answer",
  L1: "direct_answer",    // L1 web_search 仍走 direct_answer + tool 调用
  L2: "delegate_to_slow",
  L3: "execute_task",
};

// ── DirectResponse ─────────────────────────────────────────────────────────────

/**
 * Fast Manager 直接回答时的回复草稿。
 * 仅当 decision_type = "direct_answer" 时出现。
 */
export interface DirectResponse {
  /** 回复风格提示 */
  style: "concise" | "natural" | "structured";
  /** Manager 拟定的回复内容草稿 */
  content: string;
  /** 输出 token 数上限提示（可选） */
  max_tokens_hint?: number;
}

// ── ClarifyQuestion（Phase 1.5 Clarifying 复用）───────────────────────────────

/**
 * 澄清问题结构，与 Phase 1.5 Clarifying 完全对齐。
 * 仅当 decision_type = "ask_clarification" 时出现。
 */
export interface ClarifyQuestion {
  /** 唯一问题 ID */
  question_id: string;
  /** 给用户展示的问题文本 */
  question_text: string;
  /** 可选项列表（可选，无选项时用户自由输入） */
  options?: ClarifyOption[];
  /** 是否允许用户自由输入 */
  allow_free_text?: boolean;
  /** 为什么要问这个问题（供 trace/debug） */
  clarification_reason: string;
  /** 缺失的关键信息字段（供 trace/debug） */
  missing_fields?: string[];
}

export interface ClarifyOption {
  /** 展示文本 */
  label: string;
  /** 内部值 */
  value: string;
}

// ── CommandPayload ────────────────────────────────────────────────────────────

/**
 * Manager → Worker 的结构化任务命令。
 * 仅当 decision_type = "delegate_to_slow" 或 "execute_task" 时出现。
 *
 * @example
 * const cmd: CommandPayload = {
 *   command_type: "delegate_analysis",
 *   task_type: "reasoning",
 *   task_brief: "分析 Python 与 JavaScript 后端开发的差异，给出初学者建议",
 *   goal: "输出对比分析与建议",
 *   constraints: ["面向初中级开发者", "控制在 5 个要点内"],
 *   input_materials: [
 *     { type: "user_query", content: "Python和JavaScript做后端有什么区别？" }
 *   ],
 *   required_output: {
 *     format: "structured_analysis",
 *     sections: ["differences", "tradeoffs", "recommendation"],
 *     max_points: 5,
 *   }
 * };
 */
export interface CommandPayload {
  /** 命令类型（Phase 0 精简版，4 种） */
  command_type: CommandType;
  /** 任务类型描述（reasoning / search / code / summarize 等） */
  task_type: string;
  /** Manager 压缩后的任务摘要（不超过 2000 字） */
  task_brief: string;
  /** 最终目标（不超过 500 字） */
  goal: string;
  /** 约束条件列表 */
  constraints?: string[];
  /** 输入材料引用 */
  input_materials?: InputMaterial[];
  /** 输出格式要求 */
  required_output?: RequiredOutput;
  /** 允许使用的工具列表（execute_task 时必填） */
  tools_allowed?: string[];
  /** 优先级 */
  priority?: "low" | "normal" | "high";
  /** 超时秒数建议 */
  timeout_sec?: number;
  /** Worker 类型提示（帮助路由到正确的 Worker） */
  worker_hint?: WorkerHint;
}

/** 命令类型枚举（Phase 0 精简版，4 种） */
export type CommandType =
  | "delegate_analysis"   // 复杂推理/分析，委托 Slow Analyst
  | "delegate_summarization" // 长文本摘要，委托 Slow
  | "execute_plan"        // 执行计划，委托 Execute Runtime
  | "execute_research";   // 网络/数据库检索，委托 Search Worker

/** Worker 类型提示 */
export type WorkerHint =
  | "slow_analyst"     // Qwen2.5-72B，复杂推理
  | "execute_worker"   // ExecutionLoop，执行工具
  | "search_worker";   // 轻量搜索/检索

// ── InputMaterial ─────────────────────────────────────────────────────────────

/**
 * Command 的输入材料。
 * 用于传递 Manager 认为 Worker 需要知道的内容，而非直接传 history。
 */
export interface InputMaterial {
  /** 材料类型 */
  type: InputMaterialType;
  /** 直接内容（当 ref_id 不足以覆盖时使用） */
  content?: string;
  /** 关联对象 ID（evidence_ref / memory_ref / archive_fact） */
  ref_id?: string;
  /** 标题（可选） */
  title?: string;
  /** 重要性 0.0 ~ 1.0 */
  importance?: number;
}

export type InputMaterialType =
  | "user_query"       // 用户原始输入
  | "excerpt"          // 从 history 截取的片段
  | "evidence_ref"     // 关联的 evidence 记录
  | "memory_ref"       // 关联的 memory 记录
  | "archive_fact";    // Archive 中已确认的事实

// ── RequiredOutput ────────────────────────────────────────────────────────────

/**
 * Manager 对 Worker 产出的格式要求。
 */
export interface RequiredOutput {
  /** 输出格式 */
  format: OutputFormat;
  /** 分节要求（可选） */
  sections?: string[];
  /** 必须包含的点（可选） */
  must_include?: string[];
  /** 要点数上限（可选） */
  max_points?: number;
  /** 语气风格（可选） */
  tone?: "neutral" | "professional" | "concise";
}

export type OutputFormat =
  | "structured_analysis" // 分节结构化分析
  | "bullet_summary"     // 要点列表
  | "answer"             // 直接回答
  | "json";              // JSON 格式

// ── WorkerResult ───────────────────────────────────────────────────────────────

/**
 * Worker → Manager 的结构化结果。
 * Worker 完成后写入 Archive，Manager 读取后统一对外表达。
 *
 * @example
 * const result: WorkerResult = {
 *   task_id: "task_abc",
 *   worker_type: "slow_analyst",
 *   status: "completed",
 *   summary: "Python 适合 AI/数据，JavaScript 适合全栈。",
 *   structured_result: {
 *     differences: [...],
 *     recommendation: "按你的目标选择..."
 *   },
 *   confidence: 0.82
 * };
 */
export interface WorkerResult {
  /** 关联的任务 ID */
  task_id: string;
  /** 执行本次的 Worker 类型 */
  worker_type: WorkerHint;
  /** 执行状态 */
  status: WorkerResultStatus;
  /** 一句话摘要（Manager 用于快速判断是否满足需求） */
  summary: string;
  /** 结构化结果（格式由 required_output 指定） */
  structured_result: Record<string, unknown>;
  /** 结果置信度 0.0 ~ 1.0 */
  confidence: number;
  /** 如果缺少关键信息，列出缺失项（Worker 请求 Manager 补充） */
  ask_for_more_context?: string[];
  /** 错误信息（status = failed 时） */
  error_message?: string;
}

export type WorkerResultStatus =
  | "completed"
  | "partial"
  | "failed";

// ── SSE 事件扩展 ───────────────────────────────────────────────────────────────

/**
 * Phase 3.0 新增 SSE 事件类型。
 * 扩展现有 SSE 事件，覆盖 Manager-Worker 全链路。
 */
export type SSEEventTypePhase3 =
  | "manager_decision"    // Manager 决策完成
  | "clarifying_needed"     // 需要向用户澄清（复用 Phase 1.5）
  | "command_issued"       // Command 已写入 Archive
  | "worker_progress"       // Worker 执行中
  | "worker_completed"     // Worker 完成
  | "manager_synthesized"; // Manager 汇总完成，最终回复用户

export interface SSEManagerDecisionEvent {
  type: "manager_decision";
  decision: ManagerDecision;
  timestamp: string;
}

export interface SSECommandIssuedEvent {
  type: "command_issued";
  command_id: string;
  delegated_to: WorkerHint;
  task_id: string;
  timestamp: string;
}

export interface SSEWorkerCompletedEvent {
  type: "worker_completed";
  task_id: string;
  command_id: string;
  worker_type: WorkerHint;
  summary: string;
  timestamp: string;
}

// ── ajv 简化校验 Schema ───────────────────────────────────────────────────────

/**
 * ajv 运行时校验用简化 JSON Schema（可直接贴入 ajv.addSchema）。
 * 目的：Phase 0 不引入完整 JSON Schema Draft 2020-12，用简化版 + ajv 校验即可。
 *
 * 用法：
 * ```ts
 * import Ajv from 'ajv';
 * const ajv = new Ajv();
 * ajv.addSchema(managerDecisionSchema, 'ManagerDecision');
 * const valid = ajv.validate('ManagerDecision', rawOutput);
 * ```
 *
 * 注意：此 Schema 仅用于 Phase 0 运行时校验，
 * 完整 JSON Schema（Draft 2020-12）放在 docs/MANAGER-DECISION-SCHEMA.md 供文档参考。
 */
export const managerDecisionJsonSchema = {
  $id: "https://smartrouter.pro/schemas/manager-decision-v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "decision_type",
    "routing_layer",
    "reason",
    "confidence",
    "needs_archive",
  ],
  properties: {
    schema_version: { type: "string", const: "manager_decision_v1" },
    decision_type: {
      type: "string",
      enum: ["direct_answer", "ask_clarification", "delegate_to_slow", "execute_task"],
    },
    routing_layer: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
    reason: { type: "string", minLength: 1, maxLength: 300 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_archive: { type: "boolean" },
    direct_response: {
      type: "object",
      additionalProperties: false,
      required: ["style", "content"],
      properties: {
        style: { type: "string", enum: ["concise", "natural", "structured"] },
        content: { type: "string", minLength: 1, maxLength: 2000 },
        max_tokens_hint: { type: "integer", minimum: 1, maximum: 2000 },
      },
    },
    clarification: {
      type: "object",
      additionalProperties: false,
      required: ["question_id", "question_text", "clarification_reason"],
      properties: {
        question_id: { type: "string", minLength: 1, maxLength: 100 },
        question_text: { type: "string", minLength: 1, maxLength: 500 },
        options: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string", minLength: 1, maxLength: 200 },
              value: { type: "string", minLength: 1, maxLength: 100 },
            },
          },
          maxItems: 10,
        },
        allow_free_text: { type: "boolean" },
        clarification_reason: { type: "string", minLength: 1, maxLength: 300 },
        missing_fields: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
        },
      },
    },
    command: {
      type: "object",
      additionalProperties: false,
      required: ["command_type", "task_type", "task_brief", "goal"],
      properties: {
        command_type: {
          type: "string",
          enum: ["delegate_analysis", "delegate_summarization", "execute_plan", "execute_research"],
        },
        task_type: { type: "string", minLength: 1, maxLength: 100 },
        task_brief: { type: "string", minLength: 1, maxLength: 4000 },
        goal: { type: "string", minLength: 1, maxLength: 1000 },
        constraints: {
          type: "array",
          items: { type: "string", maxLength: 300 },
          maxItems: 20,
        },
        input_materials: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type"],
            properties: {
              type: {
                type: "string",
                enum: ["user_query", "excerpt", "evidence_ref", "memory_ref", "archive_fact"],
              },
              content: { type: "string", maxLength: 4000 },
              ref_id: { type: "string", maxLength: 100 },
              title: { type: "string", maxLength: 200 },
              importance: { type: "number", minimum: 0, maximum: 1 },
            },
          },
          maxItems: 30,
        },
        required_output: {
          type: "object",
          additionalProperties: false,
          properties: {
            format: {
              type: "string",
              enum: ["structured_analysis", "bullet_summary", "answer", "json"],
            },
            sections: { type: "array", items: { type: "string" }, maxItems: 20 },
            must_include: { type: "array", items: { type: "string" }, maxItems: 20 },
            max_points: { type: "integer", minimum: 1, maximum: 20 },
            tone: { type: "string", enum: ["neutral", "professional", "concise"] },
          },
        },
        tools_allowed: { type: "array", items: { type: "string" }, maxItems: 20 },
        priority: { type: "string", enum: ["low", "normal", "high"] },
        timeout_sec: { type: "integer", minimum: 1, maximum: 3600 },
        worker_hint: { type: "string", enum: ["slow_analyst", "execute_worker", "search_worker"] },
      },
    },
  },
  allOf: [
    {
      if: { properties: { decision_type: { const: "direct_answer" } } },
      then: { required: ["direct_response"] },
    },
    {
      if: { properties: { decision_type: { const: "ask_clarification" } } },
      then: { required: ["clarification"] },
    },
    {
      if: { properties: { decision_type: { enum: ["delegate_to_slow", "execute_task"] } } },
      then: { required: ["command"] },
    },
  ],
};
```

---

## 3. 与现有类型的共存策略

### 3.1 RoutingDecision vs ManagerDecision

现有 `RoutingDecision`（硬编码路由输出）**不删除**，降级为 fallback：

```typescript
// types/index.ts 中保留：
export interface RoutingDecision {
  router_version: string;
  scores: { fast: number; slow: number };
  confidence: number;
  selected_model: string;
  selected_role: ModelRole;
  selection_reason: string;
  fallback_model: string;
  routing_layer?: RoutingLayer;  // ← 已改为复用 Phase 3.0 的 RoutingLayer
}

// Phase 3.0 引入：
export type { ManagerDecision, ManagerDecisionType } from "./phase3";
```

### 3.2 Phase 1.5 Clarifying 复用

`ClarifyQuestion` 与 Phase 1.5 现有实现**完全对齐**，不需要新类型：

```typescript
// 现有 Task.task_brief 中已有 ClarifyQuestion，
// Phase 3.0 直接复用，不重复定义。
// 见：backend/src/types/index.ts 现有 Task 类型
```

### 3.3 TaskArchiveEntry（现有）vs Phase 3.0 Task Archive

Phase 1.5 已有一个 `DelegationArchiveEntry`（repositories.ts），是轻量版。

Phase 3.0 Task Archive 是升级版，两者并存：
- `DelegationArchiveEntry` → Phase 1.5 L2 委托（Simple 版本）
- Phase 3.0 `TaskArchiveEntry` → Manager-Worker 完整共享工作台

**最终计划**：Phase 4 稳定后将两者合并，Phase 3.0 先独立跑通。

---

## 4. 服务端校验流程

```typescript
// backend/src/orchestrator/decision-validator.ts

import Ajv from "ajv";
import type { ManagerDecision } from "../types";
import { managerDecisionJsonSchema } from "../types";

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(managerDecisionJsonSchema);

/**
 * 校验 Fast Manager 输出的 ManagerDecision。
 * 不合法时返回 null，触发旧 router fallback。
 */
export function validateManagerDecision(
  raw: unknown
): ManagerDecision | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.schema_version !== "manager_decision_v1") return null;
  if (!validate(obj)) {
    console.warn("[ManagerDecision] validation failed:", validate.errors);
    return null;
  }
  return obj as ManagerDecision;
}

/**
 * 语义补充校验（在 schema 校验后执行）。
 * 例如：delegate_to_slow 必须带 worker_hint。
 */
export function validateManagerDecisionSemantic(
  decision: ManagerDecision
): boolean {
  if (decision.decision_type === "delegate_to_slow") {
    if (!decision.command?.worker_hint) {
      // 默认为 slow_analyst
      if (decision.command) decision.command.worker_hint = "slow_analyst";
    }
  }
  if (decision.decision_type === "execute_task") {
    if (!decision.command?.tools_allowed?.length) {
      console.warn("[ManagerDecision] execute_task requires tools_allowed");
      return false;
    }
  }
  return true;
}
```

---

## 5. Manager Prompt 注入（Phase 2）

```typescript
// backend/src/prompt/manager-prompt.ts

/**
 * Phase 3.0 Manager (Fast Model) 系统 Prompt。
 *
 * 注入方式：替换现有的 fast_model_system_prompt，
 * 在 Phase 0/1 中仅注入决策规则，不要求 JSON Schema 强制约束。
 * Phase 1 之后升级为 function calling。
 */

export const MANAGER_SYSTEM_PROMPT = `
你是一个高效的任务管理助手（Manager）。

你的职责不是回答问题本身，而是决定：
1. 你能否直接回答？
2. 需要先向用户澄清什么？
3. 需要委托给深度分析模型处理？
4. 需要进入工具执行模式？

【决策规则】
- 闲聊/打招呼/情绪表达 → 直接回答，简短友好
- 需要实时数据（新闻/天气/股价/搜索）→ 直接调用 web_search 工具
- 需要复杂推理/分析/多步思考 → 输出决策 JSON，请求委托
- 其他 → 尝试直接回答，无法回答时请求委托

【输出格式（Phase 1 使用，Phase 2 改为 function calling）】
当需要委托时，输出以下 JSON：
{
  "schema_version": "manager_decision_v1",
  "decision_type": "delegate_to_slow",
  "routing_layer": "L2",
  "reason": "需要多步推理",
  "confidence": 0.85,
  "needs_archive": true,
  "command": {
    "command_type": "delegate_analysis",
    "task_type": "reasoning",
    "task_brief": "...",
    "goal": "...",
    "constraints": [],
    "required_output": { "format": "structured_analysis" }
  }
}

【用户体验原则】
- 如果你决定直接回答，风格与用户偏好保持一致
- 如果你决定委托，先说一句安抚/确认的话
- 不要让用户感觉到"模型在切换"
`.trim();
```

---

## 6. Phase 0~1 路线图

| Phase | 行为 | 技术手段 |
|--------|------|---------|
| Phase 0 | Fast 输出带特殊标记的文本，解析成 ManagerDecision | 特殊标记正则解析（降级方案） |
| Phase 1 | Fast 输出 JSON 文本，schema 校验 | 正则 + ajv |
| Phase 2 | Fast 使用 function calling | tools 参数注入 + function_call 解析 |
| Phase 3+ | Fast 自动决策，Archive 完整流转 | 完整 Manager-Worker Runtime |

---

_文档日期：2026-04-19 | by 蟹小钳 🦀_
_对应：`PHASE-3-MANAGER-WORKER-SPEC.md`_
