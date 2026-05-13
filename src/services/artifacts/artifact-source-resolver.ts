/**
 * Artifact Source Resolver — Sprint 57
 *
 * 职责：在 Worker 收到 artifact revision task 时，
 *       从 archive 中解析出原始 artifact content。
 *
 * 优先级：
 *   1. artifactId (== archiveId) → task_archives.slow_execution.result
 *   2. taskId → 同上
 *   3. unavailable 降级
 *
 * 边界：
 *   - 只供 Worker 使用（Manager 不能调这个函数拿 artifact content）
 *   - 不读 Manager View / raw history / frontend history
 *   - 不改 DB schema
 */

import { TaskArchiveRepo } from "../../db/task-archive-repo.js";

export type ArtifactRevisionSource = {
  artifactId?: string;
  taskId?: string;
  content: string;
  contentType?: string;
  summaryForManager?: string;
  /**
   * 来源类型：
   * - "archive": 成功从 archive 读取
   * - "unavailable": archive 找不到或无执行结果
   */
  source: "archive" | "unavailable";
};

/**
 * 解析 artifact revision source。
 * 从 archiveId (== artifactId) 读取 task_archives.slow_execution.result。
 *
 * @param input.artifactId  artifact ID（与 archiveId 同值）
 * @param input.taskId       fallback：taskId（与 artfiactId 同值）
 * @param input.sessionId    未使用（V0 保留参数）
 * @param input.userId       未使用（V0 保留参数）
 */
export async function resolveArtifactRevisionSource(
  input: {
    artifactId?: string;
    taskId?: string;
    sessionId?: string;
    userId?: string;
  }
): Promise<ArtifactRevisionSource | undefined> {
  const archiveId = input.artifactId || input.taskId;
  if (!archiveId) {
    return {
      source: "unavailable",
      content: "",
    };
  }

  try {
    const archive = await TaskArchiveRepo.getById(archiveId);
    if (!archive) {
      return {
        artifactId: input.artifactId,
        taskId: input.taskId,
        source: "unavailable",
        content: "",
      };
    }

    const execution = archive.slow_execution as Record<string, unknown> | null;
    const result = execution?.result as string | undefined;

    if (result && result.trim()) {
      return {
        artifactId: input.artifactId,
        taskId: input.taskId,
        content: result,
        contentType: detectContentType(result),
        summaryForManager: (execution as any)?.summary_for_manager as string | undefined,
        source: "archive",
      };
    }

    // slow_execution 有记录但 result 为空 → 不可用
    return {
      artifactId: input.artifactId,
      taskId: input.taskId,
      source: "unavailable",
      content: "",
    };
  } catch (e: any) {
    console.warn("[resolveArtifactRevisionSource] Archive lookup failed:", e.message);
    return {
      artifactId: input.artifactId,
      taskId: input.taskId,
      source: "unavailable",
      content: "",
    };
  }
}

/** 轻量级内容类型检测（复用 worker-result-envelope 中的模式） */
function detectContentType(content: string): string {
  const text = content || "";
  if (/(import\s+React|from\s+['"]react['"])/.test(text)) return "tsx";
  if (/(<!DOCTYPE|<html|<body|<div)/.test(text)) return "html";
  if (/(export default|function\s+\w+\s*\(|className=)/.test(text)) return "code";
  if (text.startsWith("{") || text.startsWith("[")) {
    try { JSON.parse(text); return "json"; } catch { /* not json */ }
  }
  return "text";
}
