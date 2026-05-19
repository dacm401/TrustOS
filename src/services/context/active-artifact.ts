/**
 * ActiveArtifactContext — 当前对话中最近的可修订 Worker 产物摘要。
 *
 * 从 rawHistory 的 provenance meta 中提取，只含 id + summary，
 * 不包含 artifact.content。
 *
 * Context Boundary 原则：
 *   Manager 不能读取 artifact 原文，只能看到 summaryForManager。
 */

import type { ManagerViewMessage } from "./manager-view.js";

export type ActiveArtifactContext = {
  taskId?: string;
  artifactId?: string;
  summaryForManager: string;
  contentType?: string;
  /** Sprint 58: 此 artifact 自己的 revision lineage（如果它本身是 revision） */
  revisionOfArtifactId?: string;
  revisionOfTaskId?: string;
};

/**
 * 从 rawHistory 中提取最近一条 Worker artifact/brief 的摘要。
 *
 * 倒序扫描，找第一条 origin=worker && contentKind∈{artifact,brief} 的消息，
 * 取其 meta 中的 id + summaryForManager 返回。
 *
 * 注意：输入必须是 rawHistory（有完整 provenance meta），
 * 不是 managerView.messages（brief 可能被重写过）。
 */
export function extractActiveArtifactContext(
  rawHistory: ManagerViewMessage[]
): ActiveArtifactContext | undefined {
  if (!rawHistory || rawHistory.length === 0) return undefined;

  // 倒序扫描
  for (let i = rawHistory.length - 1; i >= 0; i--) {
    const msg = rawHistory[i];
    const meta = msg.meta;
    console.log(`[active-artifact] [${i}] role=${msg.role}, origin=${meta?.origin}, kind=${meta?.contentKind}, hasSummary=${!!meta?.summaryForManager}`);
    if (
      meta?.origin === "worker" &&
      (meta.contentKind === "artifact" || meta.contentKind === "brief") &&
      meta.summaryForManager
    ) {
      const result = {
        taskId: meta.taskId,
        artifactId: meta.artifactId,
        summaryForManager: meta.summaryForManager,
        contentType: (meta as any).contentType,
        revisionOfArtifactId: (meta as any).revisionOfArtifactId,
        revisionOfTaskId: (meta as any).revisionOfTaskId,
      };
      console.log(`[active-artifact] FOUND artifact: ${JSON.stringify({artifactId: result.artifactId, summaryChars: result.summaryForManager?.length})}`);
      return result;
    }
  }
  console.log(`[active-artifact] NOT FOUND - no worker artifact in ${rawHistory.length} messages`);

  return undefined;
}
