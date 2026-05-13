/**
 * Context Boundary V0 — buildManagerView()
 *
 * TrustOS 的第一条上下文边界不变量：
 *   任何 Manager 模型调用不得直接消费 raw body.history。
 *   必须先经过 buildManagerView()，生成 Manager Safe View 和 Context Manifest。
 *
 * 这不是 history 压缩，而是 role-aware context boundary。
 * Worker artifact 不进入 Manager prompt；Manager 的 chat 即使很长也保留。
 * Legacy 无 meta 的长代码用启发式兜底，但不是主路径。
 */

// ── 轻量类型 ────────────────────────────────────────────────────────────────
// 定义在文件内，不依赖外部类型，避免扩大编译牵连范围

export type ContextOrigin =
  | "user"
  | "manager"
  | "worker"
  | "system"
  | "tool";

export type ContextContentKind =
  | "chat"
  | "status"
  | "thinking"
  | "artifact"
  | "brief"
  | "decision"
  | "permission"
  | "unknown";

export type ManagerViewMessageMeta = {
  origin?: ContextOrigin;
  contentKind?: ContextContentKind;
  taskId?: string;
  artifactId?: string;
  summaryForManager?: string;
  routingLayer?: string;
  /** Sprint 58: 当 artifact 是 revision 时，记录它从哪个旧 artifact 修订而来 */
  revisionOfArtifactId?: string;
  revisionOfTaskId?: string;
};

export type ManagerViewMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  meta?: ManagerViewMessageMeta;
};

export type ManagerViewManifest = {
  boundary: "ContextBoundaryV0";
  view: "manager";
  rawCount: number;
  safeCount: number;
  rawChars: number;
  safeChars: number;
  droppedWorkerArtifacts: number;
  replacedWorkerArtifactsWithBrief: number;
  keptWorkerBriefs: number;
  droppedStatusMessages: number;
  legacyArtifactCompressed: number;
  keptManagerMessages: number;
  /**
   * Context Boundary V1: 使用了 meta.summaryForManager 作为 brief 的次数
   * 区别于 fallbackSummary（无 summaryForManager 时的兜底）
   */
  usedWorkerSummaries: number;
};

export type ManagerViewResult = {
  messages: ManagerViewMessage[];
  manifest: ManagerViewManifest;
};

// ── 疑似 artifact 启发式检测（仅用于 legacy 无 meta 兜底） ────────────────
// 有 meta 时以 meta 为准，不靠长度/代码特征判断

const ARTIFACT_PATTERNS = [
  "```",
  "<html",
  "<!DOCTYPE",
  "import " as string,
  "export default",
  "function ",
  "className=",
  "const ",
  "interface ",
  "type ",
  "<div",
  "<span",
  "<button",
  "px-",
  "flex-",
];

function looksLikeLegacyArtifact(content: string, threshold: number): boolean {
  const text = content || "";
  if (text.length > threshold) return true;
  return ARTIFACT_PATTERNS.some((p) => text.includes(p));
}

// ── 摘要兜底 ────────────────────────────────────────────────────────────────

function fallbackSummary(msg: ManagerViewMessage): string {
  // 优先级 1: meta 中的 summaryForManager
  if (msg.meta?.summaryForManager) {
    return msg.meta.summaryForManager;
  }
  // 优先级 2: 有 taskId 时标记任务
  if (msg.meta?.taskId) {
    return `Worker 已完成任务 ${msg.meta.taskId}，完整结果已归档。`;
  }
  // 优先级 3: 通用 fallback
  return "Worker 已完成一项任务，完整结果已归档。";
}

// ── 核心函数 ────────────────────────────────────────────────────────────────

export function buildManagerView(
  rawHistory: ManagerViewMessage[] = [],
  options?: {
    maxMessages?: number;
    legacyArtifactCharThreshold?: number;
  }
): ManagerViewResult {
  const maxMessages = options?.maxMessages ?? 8;
  const legacyThreshold = options?.legacyArtifactCharThreshold ?? 800;

  const manifest: ManagerViewManifest = {
    boundary: "ContextBoundaryV0",
    view: "manager",
    rawCount: rawHistory.length,
    safeCount: 0,
    rawChars: 0,
    safeChars: 0,
    droppedWorkerArtifacts: 0,
    replacedWorkerArtifactsWithBrief: 0,
    keptWorkerBriefs: 0,
    droppedStatusMessages: 0,
    legacyArtifactCompressed: 0,
    keptManagerMessages: 0,
    usedWorkerSummaries: 0,
  };

  const safe: ManagerViewMessage[] = [];

  for (const msg of rawHistory) {
    const meta = msg.meta ?? {};
    const origin = meta.origin;
    const contentKind = meta.contentKind;

    // 规则 1: Worker artifact 不进入 Manager
    if (origin === "worker" && contentKind === "artifact") {
      manifest.droppedWorkerArtifacts += 1;
      // V1: 如果 meta 提供了 summaryForManager，计数以便区分 structured vs fallback
      if (msg.meta?.summaryForManager) {
        manifest.usedWorkerSummaries += 1;
      }
      const summary = fallbackSummary(msg);
      safe.push({
        role: "assistant",
        content: `[Worker结果摘要] ${summary}`,
        meta: {
          origin: "worker",
          contentKind: "brief",
          taskId: msg.meta?.taskId,
          artifactId: msg.meta?.artifactId,
          summaryForManager: summary,
        },
      });
      manifest.replacedWorkerArtifactsWithBrief += 1;
      continue;
    }

    // 规则 2: Worker brief 可以进入 Manager
    if (origin === "worker" && contentKind === "brief") {
      safe.push(msg);
      manifest.keptWorkerBriefs += 1;
      continue;
    }

    // 规则 4: status / thinking 不进入 Manager prompt
    if (contentKind === "status" || contentKind === "thinking") {
      manifest.droppedStatusMessages += 1;
      continue;
    }

    // 规则 3: Manager chat 保留（即使很长或含代码）
    if (origin === "manager" && contentKind === "chat") {
      safe.push(msg);
      manifest.keptManagerMessages += 1;
      continue;
    }

    // 规则 5: legacy 无 meta 的疑似 artifact 兜底压缩
    if (
      msg.role === "assistant" &&
      !origin &&
      looksLikeLegacyArtifact(msg.content || "", legacyThreshold)
    ) {
      safe.push({
        role: "assistant",
        content:
          "[Worker结果摘要] 上一轮生成了较长产物，完整结果已归档。",
        meta: {
          origin: "worker",
          contentKind: "brief",
          summaryForManager: "上一轮生成了较长产物，完整结果已归档。",
        },
      });
      manifest.legacyArtifactCompressed += 1;
      continue;
    }

    // 规则 6: 普通 user / system / tool 消息保留
    safe.push(msg);
  }

  // 规则 7: 过滤后再 slice，保留最近 maxMessages 条
  const clipped = safe.slice(-maxMessages);

  manifest.safeCount = clipped.length;
  manifest.rawChars = rawHistory.reduce(
    (n, m) => n + (m.content?.length ?? 0),
    0
  );
  manifest.safeChars = clipped.reduce(
    (n, m) => n + (m.content?.length ?? 0),
    0
  );

  return { messages: clipped, manifest };
}
