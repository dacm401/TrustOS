// Sprint 61P: ContextPackage Builder
// 职责：在路由决策后、Worker 调用前，构建运行时审计 ContextPackage
//
// V0 目标：每次 Worker 调用都生成 ContextPackage，记录 allowed/denied context
//         不修改现有行为，只做 metadata 记录

import { v4 as uuid } from "uuid";
import type {
  ContextPackageV1,
  ContextPackageKind,
  ContextPackageSecurityScope,
  ContextPackageArtifactRef,
} from "./context-package.js";

// ── 类型工具：countBytes（粗略，用于 metrics.inputBytes） ─────────────────────
function countBytes(text: string | undefined | null): number {
  if (!text) return 0;
  // UTF-8 bytes 粗略估算（中文字符 ~3 bytes，ASCII ~1 byte）
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

// ── Builder 输入类型 ─────────────────────────────────────────────────────────

export interface BuildContextPackageInput {
  traceId: string;
  policyRoute: string;
  userInstruction: string;

  /** activeArtifact（revision 时存在） */
  activeArtifact?: {
    artifactId: string;
    taskId?: string;
    summaryForManager?: string;
    revisionOfArtifactId?: string;
    revisionOfTaskId?: string;
  };

  /** 任务类型 */
  taskKind: "create" | "revision" | "manager_delegation";

  /** V0 附加数据（可选） */
  artifactContentBytes?: number;
  artifactContentMode?: "none" | "summary" | "snippet" | "full";
  memorySummary?: string;

  /** Sprint 62P: 是否建议 Worker 输出 patch 而非 full rewrite */
  preferredOutputMode?: "full" | "patch";
}

// ── 核心 Builder ─────────────────────────────────────────────────────────────

/**
 * 构建运行时审计 ContextPackage。
 *
 * V0 目标：formalize the contract，不改现有行为
 * - 不访问 DB
 * - 不渲染 prompt
 * - 纯同步、纯内存计算
 *
 * @returns ContextPackageV1（运行时审计合同）
 */
export function buildContextPackage(
  input: BuildContextPackageInput
): ContextPackageV1 {
  const {
    traceId,
    policyRoute,
    userInstruction,
    activeArtifact,
    taskKind,
    artifactContentBytes = 0,
    artifactContentMode = "none",
    memorySummary,
    preferredOutputMode,
  } = input;

  // ── 1. 确定 kind ───────────────────────────────────────────────────────
  const kind = resolveKind(taskKind, policyRoute);

  // ── 2. 确定 securityScope ─────────────────────────────────────────────
  const isRevision =
    kind === "artifact_revision" &&
    Boolean(activeArtifact);
  const isCreate = kind === "artifact_create";
  const isDelegation = kind === "manager_delegation";

  const securityScope: ContextPackageSecurityScope = {
    // Sprint 60P 不变量：artifact 原文绝不发给 Manager
    sendArtifactToManager: false,
    // revision 时 artifact 原文发给 Worker；create/delegation 时不发
    sendArtifactToWorker: isRevision && artifactContentBytes > 0,
    // Context Boundary 不变量：raw history 不发给 Manager
    sendRawHistoryToManager: false,
    // Worker 不接收 raw history
    sendRawHistoryToWorker: false,
    // Manager 不接收 memory（Sprint 60P 不变量）
    sendMemoryToManager: false,
    // Worker 可选接收 memorySummary
    sendMemoryToWorker: Boolean(memorySummary),
    // V0 简化：始终 false（Sprint 60P 已验证）
    containsSensitiveMemory: false,
  };

  // ── 3. 构建 targetArtifact ──────────────────────────────────────────────
  let targetArtifact: ContextPackageArtifactRef | undefined;
  if (isRevision && activeArtifact) {
    targetArtifact = {
      artifactId: activeArtifact.artifactId,
      taskId: activeArtifact.taskId,
      source: "archive",
      contentMode: artifactContentMode,
      contentBytes: artifactContentBytes,
      summaryForManager: activeArtifact.summaryForManager,
    };
  }

  // ── 4. allowedContext ──────────────────────────────────────────────────
  // V0: 只记录 metadata，不实际截取 content
  const allowedContext: ContextPackageV1["allowedContext"] = {
    // artifactContent: revision 时由 Worker 从 archive 拉取，不在 package 中嵌入
    artifactContent: undefined,
    // artifactSummary: revision 时提供 brief
    artifactSummary: isRevision ? activeArtifact?.summaryForManager : undefined,
    // brief: 始终提供 task brief
    brief: userInstruction.substring(0, 200),
    // historySummary: V0 不提供
    historySummary: undefined,
    // memorySummary: 可选
    memorySummary,
  };

  // ── 5. deniedContext（不变量：始终为 true） ─────────────────────────────
  const deniedContext: ContextPackageV1["deniedContext"] = {
    rawHistory: true,
    rawMemory: true,
    managerInternalReasoning: true,
  };

  // ── 6. metrics ─────────────────────────────────────────────────────────
  const metrics = {
    inputBytes:
      countBytes(userInstruction) +
      (activeArtifact?.summaryForManager ? countBytes(activeArtifact.summaryForManager) : 0) +
      (memorySummary ? countBytes(memorySummary) : 0),
    artifactContentBytes,
    estimatedInputTokens: Math.round(
      (countBytes(userInstruction) + artifactContentBytes) / 3
    ),
  };

  // ── 7. 组装 ─────────────────────────────────────────────────────────────
  return {
    packageId: uuid(),
    traceId,
    kind,
    policyRoute,
    userInstruction: userInstruction.substring(0, 500),
    targetArtifact,
    revisionOfArtifactId: isRevision ? activeArtifact?.revisionOfArtifactId : undefined,
    revisionOfTaskId: isRevision ? activeArtifact?.revisionOfTaskId : undefined,
    allowedContext,
    deniedContext,
    securityScope,
    metrics,
    createdAt: new Date().toISOString(),
    preferredOutputMode,
  };
}

// ── kind 解析 ──────────────────────────────────────────────────────────────

function resolveKind(
  taskKind: "create" | "revision" | "manager_delegation",
  policyRoute: string
): ContextPackageKind {
  // 优先用 policyRoute 判断
  if (policyRoute === "direct_artifact_revision") return "artifact_revision";
  if (policyRoute === "direct_create_artifact") return "artifact_create";
  // manager_delegation: 走 Manager LLM 后委托
  if (taskKind === "manager_delegation" || policyRoute === "manager_llm_required") {
    return "manager_delegation";
  }
  // fallback
  if (taskKind === "create") return "artifact_create";
  if (taskKind === "revision") return "artifact_revision";
  return "manager_delegation";
}

// ── 便捷工具 ──────────────────────────────────────────────────────────────

/** 从 ContextPackageV1 提取 ledger 摘要字段 */
export function contextPackageToLedgerExtract(
  cp: ContextPackageV1
): Record<string, unknown> {
  return {
    packageId: cp.packageId,
    kind: cp.kind,
    policyRoute: cp.policyRoute,
    artifactContentBytes: cp.metrics.artifactContentBytes,
    contentMode: cp.targetArtifact?.contentMode ?? "none",
    sendArtifactToManager: cp.securityScope.sendArtifactToManager,
    sendArtifactToWorker: cp.securityScope.sendArtifactToWorker,
    sendRawHistoryToWorker: cp.securityScope.sendRawHistoryToWorker,
    sendMemoryToWorker: cp.securityScope.sendMemoryToWorker,
    preferredOutputMode: cp.preferredOutputMode,
  };
}
