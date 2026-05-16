/**
 * Context Packaging V0 — Sprint 61P
 *
 * 目标：定义 Worker Context Package 的正式边界和组装契约。
 *
 * 现状（S54-S60P）：
 *   - buildManagerView()      → Manager Safe View ✅
 *   - extractActiveArtifactContext() → Artifact meta ✅
 *   - buildWorkerPrompt()      → Worker prompt 组装（分散在 worker-prompt.ts）✅
 *   - resolveArtifactRevisionSource() → Archive → artifact content ✅
 *   - buildWorkerResultEnvelope() → artifact/brief 双视图 ✅
 *
 * 缺口：没有统一的 ContextPackage 类型 + 组装函数
 * V0 目标：formalize the contract，不改现有行为
 *
 * Context Package 生命周期：
 *   1. Manager 构建 CommandPayload（通过 llm-native-router → routeByGatedDecision）
 *   2. ContextPackage 组装（这里）
 *   3. Worker prompt 渲染（worker-prompt.ts，V1 再迁移到这里）
 *   4. Worker 执行 → buildWorkerResultEnvelope → SSE done 事件
 */

import type { CommandPayload } from "../../types/delegation.js";
import type { WorkerArtifactContentType } from "./worker-result-envelope.js";
import type { ActiveArtifactContext } from "./active-artifact.js";

// ── WorkerContextBoundary ──────────────────────────────────────────────────────
/**
 * Manager ↔ Worker Context Boundary 的正式契约。
 * 规定了哪些信息 Manager 可以读、Worker 可以读。
 *
 * 核心不变量：
 *   ✓ Manager 不读 artifact.content（只读 summaryForManager）
 *   ✓ Worker 可以读 artifact.content（从 archive 拉取，resolveArtifactRevisionSource）
 *   ✓ Worker 不读 rawHistory / Manager 的 full session memory
 *   ✓ ContextPackage 是 Manager → Worker 的单向数据流
 */
export const WORKER_CONTEXT_BOUNDARY = {
  /** Worker 必须收到的东西 */
  mustInclude: [
    "command",      // 结构化任务命令（task_brief / goal / constraints）
    "message",       // 用户当前消息
    "language",      // 语言
  ] as const,

  /** Worker 可以选择性收到的补充数据 */
  mayInclude: [
    "archivedArtifactContent",  // revision 时从 archive 拉取的原始 artifact
    "confirmedFacts",           // 已确认事实（从 archive DB 读取）
    "evidenceContent",         // 证据内容（从 evidence 表读取）
    "memorySummary",           // 相关记忆摘要（从 memory-retrieval 读取）
    "activeArtifactContext",   // 当前可修订的 artifact 摘要（用于 revision 路由）
  ] as const,

  /** Worker 绝对不能接收的敏感数据 */
  forbidden: [
    "rawHistory",     // 完整对话历史（可能含敏感信息）
    "managerMemory", // Manager 的完整 session memory
    "userApiKey",    // 用户 API Key
    "fullRawBody",   // 原始请求 body
  ] as const,
} as const;

// ── ContextPackage 类型 ────────────────────────────────────────────────────────

export type ContextPackageMode =
  | "full_delegation"    // 完整委托（Manager LLM 决定 delegate_to_slow）
  | "bypass_revision"    // 绕过 Manager，直接 artifact revision（policy route = direct_artifact_revision）
  | "bypass_create";     // 绕过 Manager，直接创建 artifact（policy route = direct_create_artifact）

export type ContextPackageRevisionSource =
  | { type: "archive"; content: string; contentType: string; summaryForManager: string }
  | { type: "unavailable" }
  | { type: "none" }; // 非 revision 任务

export interface ContextPackageInput {
  command: CommandPayload;
  message: string;
  language: "zh" | "en";
  mode: ContextPackageMode;
  activeArtifactContext?: ActiveArtifactContext;
  archivedArtifactSource?: ContextPackageRevisionSource;
  confirmedFacts?: string[];
  evidenceContent?: string[];
  memorySummary?: string;
  intentCategory?: string;
}

export interface ContextPackage {
  /** Schema 版本 */
  schema_version: "context_package_v0";
  /** 打包模式 */
  mode: ContextPackageMode;
  /** 任务 ID（来自 archive） */
  taskId?: string;
  /** Worker 收到的完整 user message（含 revision 前缀） */
  userMessage: string;
  /** 结构化命令 */
  command: CommandPayload;
  /** 语言 */
  language: "zh" | "en";
  /** 任务类型描述 */
  taskTypeLabel: string;
  /** 压缩后的摘要（用于日志 trace） */
  briefSummary: string;
  /** 是否有 archive artifact content */
  hasArchivedArtifact: boolean;
  /** archived artifact 内容（revision 任务时存在） */
  archivedArtifact?: {
    content: string;
    contentType: string;
    summaryForManager: string;
  };
  /** 是否为 revision 任务 */
  isRevisionTask: boolean;
  /** revision lineage 链（artifactId → parentArtifactId） */
  revisionLineage?: {
    artifactId: string;
    parentArtifactId?: string;
    parentTaskId?: string;
  };
  /** 上下文体积指标（用于 trace） */
  metrics: {
    commandGoalLen: number;
    commandBriefLen: number;
    commandConstraintsCount: number;
    archivedArtifactChars: number;
    confirmedFactsCount: number;
    evidenceContentCount: number;
    memorySummaryLen: number;
    /** 估算 Worker 最终收到的 context 总字符数（prompt 渲染后） */
    totalContextChars: number;
  };
  /** 边界合规标记 */
  boundary: {
    artifactContentFetchedFrom: "archive" | "none";
    rawHistoryIncluded: false;
    managerMemoryIncluded: false;
    userApiKeyIncluded: false;
  };
}

// ── Task Type 标签映射 ────────────────────────────────────────────────────────

const TASK_TYPE_LABELS: Record<string, string> = {
  delegate_analysis:   "深度分析委托",
  delegate_summarization: "摘要生成委托",
  execute_plan:        "计划执行任务",
  execute_research:    "研究执行任务",
  analysis:            "分析任务",
  creative:            "创作任务",
  code:                "代码任务",
  chat:                "对话任务",
  simple_qa:           "简单问答",
  reasoning:           "推理任务",
  knowledge:           "知识检索",
  unknown:             "通用任务",
};

function getTaskTypeLabel(command: CommandPayload): string {
  return TASK_TYPE_LABELS[command.task_type ?? ""] ?? TASK_TYPE_LABELS.unknown;
}

// ── 核心组装函数 ──────────────────────────────────────────────────────────────

/**
 * 组装 Worker 的 ContextPackage。
 *
 * 职责：收集所有组件（command + revision source + confirmed facts + evidence + memory），
 *       填充元数据，生成 userMessage（包含 revision 前缀），返回完整的 ContextPackage。
 *
 * 不做的事（V0）：
 *   - 不调用 LLM
 *   - 不访问 DB（调用方负责拉取 confirmedFacts / evidenceContent / archivedArtifact）
 *   - 不渲染 Worker prompt（worker-prompt.ts 继续用现有的）
 *
 * 调用点（V0 接入点，待后续 sprint 迁移）：
 *   - llm-native-router.ts → routeByGatedDecision → delegate_to_slow case
 *   - chat.ts → SSE streaming delegate path
 */
export function buildWorkerContextPackage(
  input: ContextPackageInput
): ContextPackage {
  const {
    command,
    message,
    language,
    mode,
    activeArtifactContext,
    archivedArtifactSource,
    confirmedFacts = [],
    evidenceContent = [],
    memorySummary,
    intentCategory,
  } = input;

  const isRevisionTask =
    mode === "bypass_revision" ||
    (mode === "full_delegation" && Boolean(activeArtifactContext));

  // ── 构造 userMessage ────────────────────────────────────────────────────
  let userMessage = message;

  if (mode === "bypass_revision" && activeArtifactContext) {
    userMessage = buildRevisionUserMessage(
      activeArtifactContext,
      message,
      language
    );
  }

  // ── 构造 archived artifact ─────────────────────────────────────────────
  const hasArchivedArtifact =
    archivedArtifactSource?.type === "archive" &&
    Boolean(archivedArtifactSource.content);

  const archivedArtifact = hasArchivedArtifact
    ? {
        content: (archivedArtifactSource as Extract<typeof archivedArtifactSource, { type: "archive" }>).content,
        contentType: (archivedArtifactSource as Extract<typeof archivedArtifactSource, { type: "archive" }>).contentType,
        summaryForManager: (archivedArtifactSource as Extract<typeof archivedArtifactSource, { type: "archive" }>).summaryForManager,
      }
    : undefined;

  // ── revision lineage ───────────────────────────────────────────────────
  const revisionLineage = isRevisionTask && activeArtifactContext
    ? {
        artifactId: activeArtifactContext.artifactId ?? "",
        parentArtifactId: activeArtifactContext.revisionOfArtifactId,
        parentTaskId: activeArtifactContext.revisionOfTaskId,
      }
    : undefined;

  // ── metrics ─────────────────────────────────────────────────────────────
  const metrics = {
    commandGoalLen: command.goal?.length ?? 0,
    commandBriefLen: command.task_brief?.length ?? 0,
    commandConstraintsCount: command.constraints?.length ?? 0,
    archivedArtifactChars: archivedArtifact?.content.length ?? 0,
    confirmedFactsCount: confirmedFacts.length,
    evidenceContentCount: evidenceContent.length,
    memorySummaryLen: memorySummary?.length ?? 0,
    // V0: 简单加总（V1 会改为精确 token 计数）
    totalContextChars:
      (command.goal?.length ?? 0) +
      (command.task_brief?.length ?? 0) +
      (command.constraints?.join("").length ?? 0) +
      (archivedArtifact?.content.length ?? 0) +
      (memorySummary?.length ?? 0) +
      confirmedFacts.reduce((s, f) => s + f.length, 0) +
      evidenceContent.reduce((s, e) => s + e.length, 0),
  };

  // ── task type label ─────────────────────────────────────────────────────
  const taskTypeLabel = getTaskTypeLabel(command);

  // ── brief summary ───────────────────────────────────────────────────────
  const briefSummary =
    command.task_brief?.substring(0, 120) ??
    message.substring(0, 120);

  return {
    schema_version: "context_package_v0",
    mode,
    userMessage,
    command,
    language,
    taskTypeLabel,
    briefSummary,
    hasArchivedArtifact,
    archivedArtifact,
    isRevisionTask,
    revisionLineage,
    metrics,
    boundary: {
      artifactContentFetchedFrom: archivedArtifact ? "archive" : "none",
      rawHistoryIncluded: false,
      managerMemoryIncluded: false,
      userApiKeyIncluded: false,
    },
  };
}

// ── Revision 前缀消息构造 ──────────────────────────────────────────────────────

function buildRevisionUserMessage(
  artifact: ActiveArtifactContext,
  userMessage: string,
  language: "zh" | "en"
): string {
  if (language === "zh") {
    return (
      "[Artifact Revision Task]\n" +
      `Artifact ID: ${artifact.artifactId ?? "unknown"}\n` +
      `Task ID: ${artifact.taskId ?? "unknown"}\n` +
      `Known summary: ${artifact.summaryForManager}\n\n` +
      `User instruction: ${userMessage}\n\n` +
      "Important: This is a revision of an existing Worker artifact. " +
      "Use the archived artifact as the source of truth. " +
      "Return the revised complete artifact."
    );
  }
  return (
    "[Artifact Revision Task]\n" +
    `Artifact ID: ${artifact.artifactId ?? "unknown"}\n` +
    `Task ID: ${artifact.taskId ?? "unknown"}\n` +
    `Known summary: ${artifact.summaryForManager}\n\n` +
    `User instruction: ${userMessage}\n\n` +
    "Important: This is a revision of an existing Worker artifact. " +
    "Use the archived artifact as the source of truth. " +
    "Return the revised complete artifact."
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 61P: ContextPackage V1 — Runtime Audit Contract
// PM spec: 每次 Worker 调用都生成结构化上下文包，记录 allowed/denied context
// ───────────────────────────────────────────────────────────────────────────────

/** ContextPackage 种类 — 标识本次 package 的任务类型 */
export type ContextPackageKind =
  | "artifact_create"      // 新建 artifact（policy route = direct_create_artifact）
  | "artifact_revision"    // 修订 artifact（policy route = direct_artifact_revision）
  | "direct_answer"        // 直接回答（无 Worker 调用）
  | "manager_delegation";  // Manager 决定委托（policy route = manager_llm_required → delegate）

/** ContextPackage 安全范围 — 记录每条信息发给了谁 */
export interface ContextPackageSecurityScope {
  /** artifact 原文是否发给 Manager 远端 */
  sendArtifactToManager: boolean;
  /** artifact 原文是否发给 Worker 远端 */
  sendArtifactToWorker: boolean;
  /** raw history 是否发给 Manager */
  sendRawHistoryToManager: boolean;
  /** raw history 是否发给 Worker */
  sendRawHistoryToWorker: boolean;
  /** memory 摘要是否发给 Manager */
  sendMemoryToManager: boolean;
  /** memory 摘要是否发给 Worker */
  sendMemoryToWorker: boolean;
  /** 是否含敏感标记的 memory 被发出 */
  containsSensitiveMemory: boolean;
}

/** ContextPackage 引用 — 标识被引用的 artifact */
export interface ContextPackageArtifactRef {
  artifactId: string;
  taskId?: string;
  /** artifact 内容来源 */
  source: "archive";
  /** 内容交付模式 */
  contentMode: "none" | "summary" | "snippet" | "full";
  /** artifact 内容大小（bytes） */
  contentBytes: number;
  /** 给 Manager 看的摘要（不含原文） */
  summaryForManager?: string;
}

/** ContextPackage — 运行时审计合同（Sprint 61P 新增） */
export interface ContextPackageV1 {
  /** 唯一 package ID */
  packageId: string;
  /** 关联的请求 trace ID */
  traceId: string;
  /** 任务种类 */
  kind: ContextPackageKind;
  /** policy route */
  policyRoute: string;
  /** 用户原始指令 */
  userInstruction: string;

  /** 被引用的 artifact（revision 时存在） */
  targetArtifact?: ContextPackageArtifactRef;
  /** revision 源 artifact ID */
  revisionOfArtifactId?: string;
  /** revision 源 task ID */
  revisionOfTaskId?: string;

  /** 允许发送给 Worker 的内容 */
  allowedContext: {
    artifactContent?: string;
    artifactSummary?: string;
    brief?: string;
    historySummary?: string;
    memorySummary?: string;
  };
  /** 明确拒绝发送的内容（类型字面量强制为 true） */
  deniedContext: {
    rawHistory: true;
    rawMemory: true;
    managerInternalReasoning: true;
  };

  /** 安全范围摘要 */
  securityScope: ContextPackageSecurityScope;

  /** 上下文度量 */
  metrics: {
    inputBytes: number;
    artifactContentBytes: number;
    estimatedInputTokens?: number;
  };

  /** 创建时间 */
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════

// ── 便捷工具：从 artifactSource 转换为 ContextPackageRevisionSource ──────────────

import type { ArtifactRevisionSource } from "../artifacts/artifact-source-resolver.js";

/**
 * 将 resolveArtifactRevisionSource() 的输出转换为 ContextPackageRevisionSource。
 * 供调用方在 buildWorkerContextPackage 之前使用。
 */
export function toContextPackageRevisionSource(
  source: ArtifactRevisionSource | undefined
): ContextPackageRevisionSource {
  if (!source) return { type: "none" };
  if (source.source === "archive" && source.content) {
    return {
      type: "archive",
      content: source.content,
      contentType: source.contentType ?? "text",
      summaryForManager: source.summaryForManager ?? "",
    };
  }
  if (source.source === "unavailable") {
    return { type: "unavailable" };
  }
  return { type: "none" };
}
